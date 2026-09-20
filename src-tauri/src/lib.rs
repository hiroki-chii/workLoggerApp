mod app_state;
mod application;
mod domain;
mod error;
mod infrastructure;
mod interface;

use tauri::Manager;

use app_state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            let _ = application::window_lifecycle::show_main(app);
        }))
        .manage(AppState::open().expect("failed to open the application database"))
        .setup(|app| {
            application::window_lifecycle::setup(app.handle())?;
            app.state::<AppState>()
                .start_activity_worker(app.handle().clone())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            interface::commands::get_settings,
            interface::commands::get_window_rules,
            interface::commands::get_window_titles,
            interface::commands::get_activity_statistics,
            interface::commands::get_activity_history,
            interface::commands::get_history_csv,
            interface::commands::get_timetable_csv,
            interface::commands::get_heatmap,
            interface::commands::get_fatigue,
            interface::commands::get_status,
            interface::commands::get_recording_status,
            interface::commands::start_recording,
            interface::commands::stop_recording,
            interface::commands::update_settings,
            interface::commands::control_pomodoro,
            interface::commands::clear_activity_history,
            interface::commands::reset_fatigue,
            interface::commands::create_window_rule,
            interface::commands::update_window_rule,
            interface::commands::delete_window_rule,
            interface::commands::notify_app_changed,
            interface::commands::show_mini_window,
            interface::commands::show_main_window,
            interface::commands::quit_application,
            interface::commands::get_activity_breakdown,
        ])
        .build(tauri::generate_context!())
        .expect("Tauri application error")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
                app.state::<AppState>().begin_quit();
            }
        });
}
