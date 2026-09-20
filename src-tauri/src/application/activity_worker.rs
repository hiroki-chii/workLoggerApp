use std::{
    env,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use tauri::{AppHandle, Emitter};

use crate::infrastructure::{
    database::{Database, StatusSnapshot},
    powershell::{ActivitySample, PowerShellActivitySource},
    windows::WindowsActivitySource,
};

const IDLE_LOG_THRESHOLD_SECONDS: f64 = 60.0;
const SAMPLE_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ActivitySourceMode {
    PowerShell,
    Compare,
    Native,
}

impl ActivitySourceMode {
    fn current() -> Self {
        match env::var("WORKLOGGER_ACTIVITY_SOURCE").as_deref() {
            Ok("powershell") => Self::PowerShell,
            Ok("compare") => Self::Compare,
            _ => Self::Native,
        }
    }
}

pub struct ActivityWorker {
    recording: Arc<AtomicBool>,
    stop_requested: Arc<AtomicBool>,
    status: Arc<Mutex<StatusSnapshot>>,
}

impl ActivityWorker {
    pub fn new() -> Self {
        Self {
            recording: Arc::new(AtomicBool::new(true)),
            stop_requested: Arc::new(AtomicBool::new(false)),
            status: Arc::new(Mutex::new(StatusSnapshot {
                idle_seconds: 0,
                last_update: now_ms(),
            })),
        }
    }

    pub fn start(&self, database: Arc<Database>, script_path: PathBuf, app: AppHandle) {
        let recording = Arc::clone(&self.recording);
        let stop_requested = Arc::clone(&self.stop_requested);
        let status = Arc::clone(&self.status);
        thread::spawn(move || {
            run_worker(
                database,
                script_path,
                app,
                recording,
                stop_requested,
                status,
            )
        });
    }

    pub fn is_recording(&self) -> bool {
        self.recording.load(Ordering::Acquire)
    }

    pub fn start_recording(&self) -> bool {
        self.recording.store(true, Ordering::Release);
        true
    }

    pub fn stop_recording(&self) -> bool {
        self.recording.store(false, Ordering::Release);
        false
    }

    pub fn status(&self) -> StatusSnapshot {
        self.status
            .lock()
            .map(|status| status.clone())
            .unwrap_or(StatusSnapshot {
                idle_seconds: 0,
                last_update: now_ms(),
            })
    }

    pub fn shutdown(&self) {
        self.stop_requested.store(true, Ordering::Release);
    }
}

fn run_worker(
    database: Arc<Database>,
    script_path: PathBuf,
    app: AppHandle,
    recording: Arc<AtomicBool>,
    stop_requested: Arc<AtomicBool>,
    status: Arc<Mutex<StatusSnapshot>>,
) {
    let source_mode = ActivitySourceMode::current();
    let mut failures = 0u32;
    let mut source = None;
    while !stop_requested.load(Ordering::Acquire) {
        if !recording.load(Ordering::Acquire) {
            source = None;
            sleep_interruptibly(Duration::from_millis(200), &stop_requested);
            continue;
        }
        if source_mode != ActivitySourceMode::Native && source.is_none() {
            match PowerShellActivitySource::start(&script_path) {
                Ok(new_source) => source = Some(new_source),
                Err(_) => {
                    sleep_interruptibly(retry_delay(failures), &stop_requested);
                    failures = failures.saturating_add(1);
                    continue;
                }
            }
        }

        let started = Instant::now();
        let result = sample_activity(source_mode, &mut source, &app);
        match result {
            Ok(sample) => {
                if persist_sample(&database, &sample, &status).is_err() {
                    source = None;
                    sleep_interruptibly(retry_delay(failures), &stop_requested);
                    failures = failures.saturating_add(1);
                    continue;
                }
                let _ = app.emit("activity-updated", ());
                failures = 0;
                let interval = database.sampling_interval_seconds().unwrap_or(10).max(1) as u64;
                sleep_interruptibly(
                    Duration::from_secs(interval).saturating_sub(started.elapsed()),
                    &stop_requested,
                );
            }
            Err(_) => {
                source = None;
                sleep_interruptibly(retry_delay(failures), &stop_requested);
                failures = failures.saturating_add(1);
            }
        }
    }
}

fn sample_activity(
    mode: ActivitySourceMode,
    source: &mut Option<PowerShellActivitySource>,
    app: &AppHandle,
) -> Result<ActivitySample, crate::error::AppError> {
    match mode {
        ActivitySourceMode::Native => WindowsActivitySource::sample(),
        ActivitySourceMode::PowerShell => source
            .as_mut()
            .expect("PowerShell source is initialized")
            .sample(SAMPLE_TIMEOUT),
        ActivitySourceMode::Compare => {
            let powershell = source
                .as_mut()
                .expect("PowerShell source is initialized")
                .sample(SAMPLE_TIMEOUT)?;
            if let Ok(native) = WindowsActivitySource::sample() {
                if samples_differ(&powershell, &native) {
                    let _ = app.emit("activity-source-difference", (&powershell, &native));
                }
            }
            Ok(powershell)
        }
    }
}

fn samples_differ(powershell: &ActivitySample, native: &ActivitySample) -> bool {
    normalized_app_name(powershell) != normalized_app_name(native)
        || normalized_window_title(powershell) != normalized_window_title(native)
        || (powershell.idle_seconds - native.idle_seconds).abs() >= 1.0
}

fn normalized_app_name(sample: &ActivitySample) -> Option<&str> {
    sample
        .app_name
        .as_deref()
        .filter(|name| !name.is_empty() && *name != "None")
}

fn normalized_window_title(sample: &ActivitySample) -> Option<&str> {
    sample
        .window_title
        .as_deref()
        .filter(|title| !title.is_empty())
}

fn persist_sample(
    database: &Database,
    sample: &ActivitySample,
    status: &Mutex<StatusSnapshot>,
) -> Result<(), crate::error::AppError> {
    if sample.idle_seconds < IDLE_LOG_THRESHOLD_SECONDS
        && sample
            .app_name
            .as_deref()
            .is_some_and(|name| !name.is_empty() && name != "None")
    {
        database.record_activity(
            sample.app_name.as_deref().unwrap_or_default(),
            sample.window_title.as_deref().unwrap_or_default(),
            &sample.timestamp,
        )?;
    }
    if let Ok(mut current) = status.lock() {
        current.idle_seconds = sample.idle_seconds.floor() as i64;
        current.last_update = now_ms();
    }
    Ok(())
}

fn retry_delay(failures: u32) -> Duration {
    Duration::from_secs((5 * 2_u64.pow(failures.min(4))).min(60))
}

fn sleep_interruptibly(duration: Duration, stop_requested: &AtomicBool) {
    let deadline = Instant::now() + duration;
    while !stop_requested.load(Ordering::Acquire) {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        thread::sleep(remaining.min(Duration::from_millis(200)));
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use std::{path::PathBuf, sync::Mutex, time::Duration};

    use super::*;
    use crate::infrastructure::{
        powershell::PowerShellActivitySource, windows::WindowsActivitySource,
    };

    #[test]
    fn stores_only_active_samples_and_updates_live_status() {
        let database = Database::open_writable(":memory:").unwrap();
        let status = Mutex::new(StatusSnapshot {
            idle_seconds: 0,
            last_update: 0,
        });
        persist_sample(
            &database,
            &ActivitySample {
                app_name: Some("Code".to_owned()),
                window_title: Some("main.rs".to_owned()),
                idle_seconds: 59.9,
                timestamp: "2026-09-20 10:00:00".to_owned(),
            },
            &status,
        )
        .unwrap();
        persist_sample(
            &database,
            &ActivitySample {
                app_name: Some("Code".to_owned()),
                window_title: Some("main.rs".to_owned()),
                idle_seconds: 60.0,
                timestamp: "2026-09-20 10:00:10".to_owned(),
            },
            &status,
        )
        .unwrap();
        assert_eq!(database.activity_history().unwrap().len(), 1);
        assert_eq!(status.lock().unwrap().idle_seconds, 60);
    }

    #[test]
    fn uses_the_existing_collector_backoff_schedule() {
        assert_eq!(retry_delay(0), Duration::from_secs(5));
        assert_eq!(retry_delay(1), Duration::from_secs(10));
        assert_eq!(retry_delay(4), Duration::from_secs(60));
        assert_eq!(retry_delay(10), Duration::from_secs(60));
    }

    #[test]
    fn comparison_tolerates_subsecond_idle_time_drift() {
        let powershell = ActivitySample {
            app_name: Some("Code".to_owned()),
            window_title: Some("main.rs".to_owned()),
            idle_seconds: 10.1,
            timestamp: "2026-09-20 10:00:00".to_owned(),
        };
        let mut native = powershell.clone();
        native.idle_seconds = 10.9;
        assert!(!samples_differ(&powershell, &native));
        native.window_title = Some("lib.rs".to_owned());
        assert!(samples_differ(&powershell, &native));
    }

    #[test]
    fn uses_native_monitoring_by_default() {
        assert_eq!(ActivitySourceMode::current(), ActivitySourceMode::Native);
    }

    #[cfg(windows)]
    #[test]
    fn native_sample_matches_the_existing_powershell_monitor() {
        let script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("monitor.ps1");
        let mut powershell = PowerShellActivitySource::start(&script).unwrap();
        let legacy = powershell.sample(Duration::from_secs(10)).unwrap();
        let native = WindowsActivitySource::sample().unwrap();
        powershell.stop();

        assert!(!samples_differ(&legacy, &native));
    }
}
