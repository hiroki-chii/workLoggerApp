use serde::Serialize;

use super::{
    activity::ActivityWindow,
    pomodoro::{self, PomodoroState},
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FatigueSnapshot {
    pub fatigue_level: i64,
    pub idle_rate: i64,
    pub status_name: String,
    pub start_time: Option<String>,
    pub elapsed_seconds: i64,
    pub active_logs: i64,
    pub expected_logs: i64,
    pub current_mode: String,
    pub pomodoro: Option<PomodoroState>,
}

pub fn calculate(window: ActivityWindow, now_ms: i64) -> FatigueSnapshot {
    let interval = positive_setting(&window.settings, "sampling_interval", 10);
    let current_mode = window
        .settings
        .get("current_mode")
        .cloned()
        .unwrap_or_else(|| "tracking".to_owned());
    let elapsed_seconds = window
        .start_time_ms
        .map(|start| ((now_ms - start).max(0)) / 1_000)
        .unwrap_or(0);
    let start_time = window.start_time_ms.map(iso_timestamp);
    let mut idle_rate = 0;
    let mut status_name = if window.active_logs > 0 {
        "Active"
    } else {
        "Initializing"
    }
    .to_owned();
    if current_mode == "tracking" && window.active_logs > 0 {
        let seconds = positive_setting(&window.settings, "sliding_window_size", 90) * 60;
        let expected = (seconds / interval).max(1);
        idle_rate = (((expected - window.recent_active_logs) * 100) as f64 / expected as f64)
            .round()
            .clamp(0.0, 100.0) as i64;
        status_name = match idle_rate {
            40.. => "Restored",
            25..=39 => "Calm",
            15..=24 => "Focused",
            10..=14 => "Strained",
            _ => "Critical",
        }
        .to_owned();
    }
    FatigueSnapshot {
        fatigue_level: if current_mode == "tracking" && window.active_logs > 0 {
            100 - idle_rate
        } else {
            0
        },
        idle_rate,
        status_name,
        start_time,
        elapsed_seconds,
        active_logs: window.active_logs,
        expected_logs: (elapsed_seconds / interval).max(1),
        current_mode,
        pomodoro: pomodoro::calculate(&window.settings, now_ms),
    }
}

fn positive_setting(
    settings: &std::collections::HashMap<String, String>,
    key: &str,
    default: i64,
) -> i64 {
    settings
        .get(key)
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
        .max(1)
}

fn iso_timestamp(timestamp_ms: i64) -> String {
    // SQLite stores UTC seconds, matching the existing Node Date.parse conversion.
    let seconds = timestamp_ms.div_euclid(1_000);
    let days = seconds.div_euclid(86_400);
    let seconds_of_day = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_date(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        seconds_of_day / 3_600,
        (seconds_of_day % 3_600) / 60,
        seconds_of_day % 60
    )
}

fn civil_date(days_since_unix_epoch: i64) -> (i64, i64, i64) {
    let z = days_since_unix_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    (
        year + i64::from(mp >= 10),
        mp + if mp < 10 { 3 } else { -9 },
        doy - (153 * mp + 2) / 5 + 1,
    )
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn window(active_logs: i64, recent_active_logs: i64) -> ActivityWindow {
        ActivityWindow {
            settings: HashMap::from([
                ("sampling_interval".to_owned(), "10".to_owned()),
                ("sliding_window_size".to_owned(), "90".to_owned()),
                ("current_mode".to_owned(), "tracking".to_owned()),
            ]),
            start_time_ms: Some(1_789_689_600_000),
            active_logs,
            recent_active_logs,
        }
    }

    #[test]
    fn golden_master_preserves_five_fatigue_thresholds() {
        let now = 1_789_693_200_000;
        assert_eq!(calculate(window(1, 324), now).status_name, "Restored");
        assert_eq!(calculate(window(1, 405), now).status_name, "Calm");
        assert_eq!(calculate(window(1, 459), now).status_name, "Focused");
        assert_eq!(calculate(window(1, 486), now).status_name, "Strained");
        assert_eq!(calculate(window(1, 489), now).status_name, "Critical");
    }
}
