use std::{
    io::{BufRead, BufReader, Write},
    path::Path,
    process::{Child, ChildStdin, Command, Stdio},
    sync::mpsc::{self, Receiver},
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySample {
    pub app_name: Option<String>,
    pub window_title: Option<String>,
    pub idle_seconds: f64,
    pub timestamp: String,
}

pub struct PowerShellActivitySource {
    child: Child,
    stdin: ChildStdin,
    responses: Receiver<Result<ActivitySample, String>>,
}

impl PowerShellActivitySource {
    pub fn start(script_path: &Path) -> AppResult<Self> {
        let mut child = Command::new("powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
            ])
            .arg(script_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        let stdin = child.stdin.take().ok_or_else(|| {
            AppError::ActivitySource("PowerShell stdin is unavailable".to_owned())
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            AppError::ActivitySource("PowerShell stdout is unavailable".to_owned())
        })?;
        let (sender, responses) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let result = line
                    .map_err(|error| error.to_string())
                    .and_then(|line| parse_sample(line.trim_start_matches('\u{feff}')));
                if sender.send(result).is_err() {
                    break;
                }
            }
        });
        Ok(Self {
            child,
            stdin,
            responses,
        })
    }

    pub fn sample(&mut self, timeout: Duration) -> AppResult<ActivitySample> {
        self.stdin.write_all(b"sample\n")?;
        self.stdin.flush()?;
        match self.responses.recv_timeout(timeout) {
            Ok(Ok(sample)) => Ok(sample),
            Ok(Err(error)) => Err(AppError::ActivitySource(error)),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.stop();
                Err(AppError::ActivitySource(
                    "PowerShell sample timed out".to_owned(),
                ))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(AppError::ActivitySource(
                "PowerShell monitor closed its output".to_owned(),
            )),
        }
    }

    pub fn stop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for PowerShellActivitySource {
    fn drop(&mut self) {
        self.stop();
    }
}

fn parse_sample(line: &str) -> Result<ActivitySample, String> {
    let sample: ActivitySample = serde_json::from_str(line).map_err(|error| error.to_string())?;
    if !sample.idle_seconds.is_finite() || sample.idle_seconds < 0.0 || sample.timestamp.is_empty()
    {
        return Err("Invalid monitor response".to_owned());
    }
    Ok(sample)
}

#[cfg(test)]
mod tests {
    use std::{path::PathBuf, time::Duration};

    use super::{parse_sample, PowerShellActivitySource};

    #[test]
    fn parses_the_existing_powershell_protocol() {
        let sample = parse_sample(
            r#"{"appName":"Code","windowTitle":"ゆとリズム","idleSeconds":12.5,"timestamp":"2026-09-20 10:00:00"}"#,
        )
        .unwrap();
        assert_eq!(sample.app_name.as_deref(), Some("Code"));
        assert_eq!(sample.idle_seconds, 12.5);
    }

    #[cfg(windows)]
    #[test]
    fn reuses_the_existing_monitor_for_multiple_samples() {
        let script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("backend")
            .join("monitor.ps1");
        let mut source = PowerShellActivitySource::start(&script).unwrap();
        let first = source.sample(Duration::from_secs(10)).unwrap();
        let second = source.sample(Duration::from_secs(10)).unwrap();
        assert!(!first.timestamp.is_empty());
        assert!(!second.timestamp.is_empty());
        source.stop();
    }
}
