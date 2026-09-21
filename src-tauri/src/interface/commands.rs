use std::collections::HashMap;

use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State};

use crate::{
    app_state::AppState,
    domain::fatigue::FatigueSnapshot,
    infrastructure::database::{
        ActivityLog, HeatmapCell, Statistic, StatusSnapshot, WindowRule, WindowRuleInput,
    },
};

type CommandResult<T> = Result<T, String>;

fn command_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> CommandResult<HashMap<String, String>> {
    state.database.settings().map_err(command_error)
}

#[tauri::command]
pub fn get_window_rules(state: State<'_, AppState>) -> CommandResult<Vec<WindowRule>> {
    state.database.window_rules().map_err(command_error)
}

#[tauri::command]
pub fn get_window_titles(state: State<'_, AppState>) -> CommandResult<Vec<String>> {
    state.database.window_titles().map_err(command_error)
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_activity_statistics(
    state: State<'_, AppState>,
    start_date: Option<String>,
    end_date: Option<String>,
    group_by: Option<String>,
) -> CommandResult<Vec<Statistic>> {
    state
        .database
        .statistics(
            start_date.as_deref(),
            end_date.as_deref(),
            group_by.as_deref(),
        )
        .map_err(command_error)
}

#[tauri::command]
pub fn get_activity_history(state: State<'_, AppState>) -> CommandResult<Vec<ActivityLog>> {
    state.database.activity_history().map_err(command_error)
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_history_csv(
    state: State<'_, AppState>,
    start_date: Option<String>,
    end_date: Option<String>,
) -> CommandResult<String> {
    state
        .database
        .history_csv(start_date.as_deref(), end_date.as_deref())
        .map_err(command_error)
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_timetable_csv(
    state: State<'_, AppState>,
    start_date: Option<String>,
    end_date: Option<String>,
) -> CommandResult<String> {
    state
        .database
        .timetable_csv(start_date.as_deref(), end_date.as_deref())
        .map_err(command_error)
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_heatmap(
    state: State<'_, AppState>,
    start_date: Option<String>,
    end_date: Option<String>,
) -> CommandResult<Vec<HeatmapCell>> {
    state
        .database
        .heatmap(start_date.as_deref(), end_date.as_deref())
        .map_err(command_error)
}

#[tauri::command]
pub fn get_fatigue(state: State<'_, AppState>) -> CommandResult<FatigueSnapshot> {
    state.fatigue().map_err(command_error)
}

#[tauri::command]
pub fn get_status(state: State<'_, AppState>) -> StatusSnapshot {
    state.status()
}

#[tauri::command]
pub fn get_recording_status(state: State<'_, AppState>) -> bool {
    state.recording_status()
}

#[tauri::command]
pub fn start_recording(app: AppHandle, state: State<'_, AppState>) -> bool {
    let recording = state.start_recording();
    let _ = app.emit("activity-updated", ());
    recording
}

#[tauri::command]
pub fn stop_recording(app: AppHandle, state: State<'_, AppState>) -> bool {
    let recording = state.stop_recording();
    let _ = app.emit("activity-updated", ());
    recording
}

#[tauri::command]
pub fn update_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: HashMap<String, String>,
) -> CommandResult<bool> {
    state.database.update_settings(settings).map_err(command_error)?;
    let _ = app.emit("activity-updated", ());
    Ok(true)
}

#[tauri::command]
pub fn control_pomodoro(
    app: AppHandle,
    state: State<'_, AppState>,
    action: String,
) -> CommandResult<bool> {
    state
        .database
        .control_pomodoro(&action, now_ms())
        .map_err(command_error)?;
    let _ = app.emit("activity-updated", ());
    Ok(true)
}

#[tauri::command]
pub fn clear_activity_history(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<i64> {
    let deleted = state.database.clear_activity_history().map_err(command_error)?;
    let _ = app.emit("activity-updated", ());
    Ok(deleted)
}

#[tauri::command]
pub fn reset_fatigue(app: AppHandle, state: State<'_, AppState>) -> CommandResult<i64> {
    let deleted = state.database.reset_fatigue().map_err(command_error)?;
    let _ = app.emit("activity-updated", ());
    Ok(deleted)
}

#[tauri::command]
pub fn create_window_rule(
    app: AppHandle,
    state: State<'_, AppState>,
    rule: WindowRuleInput,
) -> CommandResult<i64> {
    let id = state.database.create_window_rule(rule).map_err(command_error)?;
    let _ = app.emit("activity-updated", ());
    Ok(id)
}

#[tauri::command]
pub fn update_window_rule(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
    rule: WindowRuleInput,
) -> CommandResult<bool> {
    state.database.update_window_rule(id, rule).map_err(command_error)?;
    let _ = app.emit("activity-updated", ());
    Ok(true)
}

#[tauri::command]
pub fn delete_window_rule(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
) -> CommandResult<bool> {
    state.database.delete_window_rule(id).map_err(command_error)?;
    let _ = app.emit("activity-updated", ());
    Ok(true)
}

#[tauri::command]
pub fn notify_app_changed(app: AppHandle) {
    let _ = app.emit("activity-updated", ());
}

#[tauri::command]
pub fn show_mini_window(app: AppHandle) -> CommandResult<()> {
    crate::application::window_lifecycle::show_mini(&app).map_err(command_error)
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) -> CommandResult<()> {
    crate::application::window_lifecycle::show_main(&app).map_err(command_error)
}

#[tauri::command]
pub fn get_mini_window_position(app: AppHandle) -> CommandResult<(i32, i32)> {
    let mini = app
        .get_webview_window("mini")
        .ok_or_else(|| "ミニ画面が見つかりません".to_owned())?;
    let position = mini.outer_position().map_err(command_error)?;
    Ok((position.x, position.y))
}

#[tauri::command]
pub fn move_mini_window(app: AppHandle, x: i32, y: i32) -> CommandResult<()> {
    let mini = app
        .get_webview_window("mini")
        .ok_or_else(|| "ミニ画面が見つかりません".to_owned())?;
    mini.set_position(PhysicalPosition::new(x, y))
        .map_err(command_error)
}

#[tauri::command]
pub fn quit_application(app: AppHandle) {
    crate::application::window_lifecycle::quit(&app);
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_activity_breakdown(
    state: State<'_, AppState>,
    date: String,
    hour: i64,
    minute: i64,
) -> CommandResult<Vec<ActivityLog>> {
    state
        .database
        .activity_breakdown(&date, hour, minute)
        .map_err(command_error)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
