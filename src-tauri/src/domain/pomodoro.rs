use std::collections::HashMap;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroState {
    pub mode: String,
    pub phase: String,
    pub status: String,
    pub work_min: i64,
    pub break_min: i64,
    pub remaining_seconds: i64,
    pub deadline_ms: Option<i64>,
    pub phase_sequence: i64,
}

pub fn calculate(settings: &HashMap<String, String>, now_ms: i64) -> Option<PomodoroState> {
    let mode = settings.get("current_mode")?.clone();
    let work_min = match mode.as_str() {
        "pomodoro15" => 15,
        "pomodoro25" => 25,
        "pomodoro50" => 50,
        _ => return None,
    };
    let break_min = match work_min {
        15 => 3,
        25 => 5,
        _ => 10,
    };
    let work_ms = work_min * 60_000;
    let cycle_ms = (work_min + break_min) * 60_000;
    let start_ms = settings
        .get("pomodoro_start_ms")
        .and_then(|value| value.parse().ok())
        .unwrap_or(now_ms);
    let elapsed = (now_ms - start_ms).max(0);
    let position = elapsed % cycle_ms;
    let status = settings
        .get("pomodoro_status")
        .cloned()
        .unwrap_or_else(|| "running".to_owned());
    let phase = if status == "paused" {
        settings
            .get("pomodoro_paused_phase")
            .cloned()
            .unwrap_or_else(|| if position < work_ms { "work" } else { "break" }.to_owned())
    } else if position < work_ms {
        "work".to_owned()
    } else {
        "break".to_owned()
    };
    let remaining_ms = if status == "paused" {
        settings
            .get("pomodoro_remaining_ms")
            .and_then(|value| value.parse().ok())
            .unwrap_or(0)
            .max(0)
    } else if phase == "work" {
        work_ms - position
    } else {
        cycle_ms - position
    };
    Some(PomodoroState {
        mode,
        phase: phase.clone(),
        status: status.clone(),
        work_min,
        break_min,
        remaining_seconds: (remaining_ms + 999) / 1_000,
        deadline_ms: (status == "running").then_some(now_ms + remaining_ms),
        phase_sequence: (elapsed / cycle_ms) * 2 + i64::from(phase == "break"),
    })
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::calculate;

    #[test]
    fn golden_master_preserves_running_deadline_and_phase_sequence() {
        let start = 1_789_862_400_000;
        let settings = HashMap::from([
            ("current_mode".to_owned(), "pomodoro25".to_owned()),
            ("pomodoro_start_ms".to_owned(), start.to_string()),
            ("pomodoro_status".to_owned(), "running".to_owned()),
        ]);
        let work = calculate(&settings, start + 24 * 60_000).unwrap();
        assert_eq!(work.phase, "work");
        assert_eq!(work.remaining_seconds, 60);
        assert_eq!(work.deadline_ms, Some(start + 25 * 60_000));

        let rest = calculate(&settings, start + 26 * 60_000).unwrap();
        assert_eq!(rest.phase, "break");
        assert_eq!(rest.phase_sequence, 1);
        assert_eq!(rest.remaining_seconds, 4 * 60);
    }

    #[test]
    fn golden_master_keeps_paused_phase_stable() {
        let settings = HashMap::from([
            ("current_mode".to_owned(), "pomodoro25".to_owned()),
            ("pomodoro_start_ms".to_owned(), "1".to_owned()),
            ("pomodoro_status".to_owned(), "paused".to_owned()),
            ("pomodoro_paused_phase".to_owned(), "break".to_owned()),
            ("pomodoro_remaining_ms".to_owned(), "120000".to_owned()),
        ]);
        let state = calculate(&settings, 1_789_862_400_000).unwrap();
        assert_eq!(state.phase, "break");
        assert_eq!(state.remaining_seconds, 120);
        assert_eq!(state.deadline_ms, None);
    }
}
