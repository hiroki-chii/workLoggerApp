use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

use crate::{
    application::fatigue_service::FatigueService,
    domain::{fatigue::FatigueSnapshot, pomodoro::PomodoroState},
    infrastructure::database::Database,
};

const DEFAULT_POLL_INTERVAL: Duration = Duration::from_secs(10);

pub struct NotificationWorker {
    stop_requested: Arc<AtomicBool>,
}

impl NotificationWorker {
    pub fn new() -> Self {
        Self {
            stop_requested: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn start(
        &self,
        database: Arc<Database>,
        fatigue_service: Arc<FatigueService>,
        app: AppHandle,
    ) {
        let stop_requested = Arc::clone(&self.stop_requested);
        thread::spawn(move || {
            let mut tracker = NotificationTracker::default();
            while !stop_requested.load(Ordering::Acquire) {
                let delay = fatigue_service
                    .snapshot(&database)
                    .and_then(|fatigue| {
                        let settings = database.settings()?;
                        for message in tracker.update(&fatigue, &settings) {
                            app.notification()
                                .builder()
                                .title("ゆとリズム")
                                .body(message.clone())
                                .show()
                                .unwrap_or_else(|error| {
                                    eprintln!(
                                        "[Notification] failed to show notification: {error}"
                                    );
                                });
                            let _ = crate::application::window_lifecycle::show_main(&app);
                            let _ = app.emit_to("main", "fatigue-alert", &message);
                        }
                        Ok(next_delay(&fatigue))
                    })
                    .unwrap_or(DEFAULT_POLL_INTERVAL);
                sleep_interruptibly(delay, &stop_requested);
            }
        });
    }

    pub fn shutdown(&self) {
        self.stop_requested.store(true, Ordering::Release);
    }
}

#[derive(Default)]
struct NotificationTracker {
    previous_status: Option<String>,
    previous_pomodoro: Option<PomodoroState>,
}

impl NotificationTracker {
    fn update(
        &mut self,
        fatigue: &FatigueSnapshot,
        settings: &HashMap<String, String>,
    ) -> Vec<String> {
        let mut messages = Vec::new();
        if fatigue.status_name == "Critical"
            && self.previous_status.as_deref() != Some("Critical")
            && settings
                .get("enable_fatigue_alert")
                .is_some_and(|value| value == "true")
        {
            messages.push("長時間の作業お疲れ様です。そろそろ休憩を取りませんか？".to_owned());
        }
        self.previous_status = Some(fatigue.status_name.clone());

        if let (Some(current), Some(previous)) =
            (fatigue.pomodoro.as_ref(), self.previous_pomodoro.as_ref())
        {
            if current.status == "running"
                && previous.status == "running"
                && current.mode == previous.mode
                && current.phase_sequence > previous.phase_sequence
            {
                messages.push(if current.phase == "work" {
                    format!(
                        "【作業開始】\n\n{}分間の集中タイムです。頑張りましょう！",
                        current.work_min
                    )
                } else {
                    format!(
                        "【休憩時間】\n\n{}分間の休憩です。リラックスしてください。",
                        current.break_min
                    )
                });
            }
        }
        self.previous_pomodoro = fatigue.pomodoro.clone();
        messages
    }
}

fn next_delay(fatigue: &FatigueSnapshot) -> Duration {
    fatigue
        .pomodoro
        .as_ref()
        .filter(|pomodoro| pomodoro.status == "running")
        .and_then(|pomodoro| pomodoro.deadline_ms)
        .map(|deadline| Duration::from_millis((deadline - now_ms()).max(100) as u64))
        .map(|delay| delay.min(DEFAULT_POLL_INTERVAL))
        .unwrap_or(DEFAULT_POLL_INTERVAL)
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
    use super::*;

    #[test]
    fn emits_the_existing_critical_alert_only_on_transition() {
        let fatigue = FatigueSnapshot {
            fatigue_level: 100,
            idle_rate: 0,
            status_name: "Critical".to_owned(),
            start_time: None,
            elapsed_seconds: 0,
            active_logs: 1,
            expected_logs: 1,
            current_mode: "tracking".to_owned(),
            pomodoro: None,
        };
        let settings = HashMap::from([("enable_fatigue_alert".to_owned(), "true".to_owned())]);
        let mut tracker = NotificationTracker::default();
        assert_eq!(tracker.update(&fatigue, &settings).len(), 1);
        assert!(tracker.update(&fatigue, &settings).is_empty());
    }
}
