use std::{mem::size_of, path::Path};

use windows_sys::Win32::{
    Foundation::{CloseHandle, HWND, SYSTEMTIME},
    System::{
        SystemInformation::{GetSystemTime, GetTickCount},
        Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION},
    },
    UI::{
        Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO},
        WindowsAndMessaging::{
            GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
        },
    },
};

use crate::{
    error::{AppError, AppResult},
    infrastructure::powershell::ActivitySample,
};

pub struct WindowsActivitySource;

impl WindowsActivitySource {
    pub fn sample() -> AppResult<ActivitySample> {
        let idle_seconds = idle_seconds()?;
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.is_null() {
            return Ok(ActivitySample {
                app_name: None,
                window_title: Some(String::new()),
                idle_seconds,
                timestamp: utc_timestamp(),
            });
        }

        let title = window_title(hwnd);
        let mut process_id = 0;
        unsafe { GetWindowThreadProcessId(hwnd, &mut process_id) };
        let app_name = (process_id != 0)
            .then(|| process_name(process_id))
            .flatten();
        Ok(ActivitySample {
            app_name,
            window_title: Some(title),
            idle_seconds,
            timestamp: utc_timestamp(),
        })
    }
}

fn idle_seconds() -> AppResult<f64> {
    let mut info = LASTINPUTINFO {
        cbSize: size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    if unsafe { GetLastInputInfo(&mut info) } == 0 {
        return Err(AppError::ActivitySource(
            "GetLastInputInfo failed".to_owned(),
        ));
    }
    Ok(unsafe { GetTickCount() }.wrapping_sub(info.dwTime) as f64 / 1_000.0)
}

fn window_title(hwnd: HWND) -> String {
    let length = unsafe { GetWindowTextLengthW(hwnd) }.max(0) as usize;
    let mut buffer = vec![0u16; length + 1];
    let written = unsafe { GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32) };
    String::from_utf16_lossy(&buffer[..written.max(0) as usize])
}

fn process_name(process_id: u32) -> Option<String> {
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
    if handle.is_null() {
        return None;
    }
    let mut path = vec![0u16; 32_768];
    let mut length = path.len() as u32;
    let success =
        unsafe { QueryFullProcessImageNameW(handle, 0, path.as_mut_ptr(), &mut length) } != 0;
    unsafe { CloseHandle(handle) };
    success.then(|| {
        let path = String::from_utf16_lossy(&path[..length as usize]);
        Path::new(&path)
            .file_stem()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or(path)
    })
}

fn utc_timestamp() -> String {
    let mut time = SYSTEMTIME {
        wYear: 0,
        wMonth: 0,
        wDayOfWeek: 0,
        wDay: 0,
        wHour: 0,
        wMinute: 0,
        wSecond: 0,
        wMilliseconds: 0,
    };
    unsafe { GetSystemTime(&mut time) };
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
        time.wYear, time.wMonth, time.wDay, time.wHour, time.wMinute, time.wSecond
    )
}

#[cfg(test)]
mod tests {
    use super::WindowsActivitySource;

    #[test]
    fn samples_the_foreground_window_without_powershell() {
        let sample = WindowsActivitySource::sample().unwrap();
        assert!(sample.idle_seconds.is_finite());
        assert!(!sample.timestamp.is_empty());
    }
}
