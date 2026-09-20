use std::{
    path::PathBuf,
    sync::{atomic::{AtomicBool, Ordering}, Arc},
};

use tauri::{path::BaseDirectory, AppHandle, Manager};

use crate::{
    application::{
        activity_worker::ActivityWorker, fatigue_service::FatigueService,
        notification_worker::NotificationWorker,
    },
    domain::fatigue::FatigueSnapshot,
    error::{AppError, AppResult},
    infrastructure::database::{Database, StatusSnapshot},
};

pub struct AppState {
    pub database: Arc<Database>,
    fatigue_service: Arc<FatigueService>,
    activity_worker: ActivityWorker,
    notification_worker: NotificationWorker,
    quitting: AtomicBool,
}

impl AppState {
    pub fn open() -> AppResult<Self> {
        Ok(Self {
            database: Arc::new(Database::open_default()?),
            fatigue_service: Arc::new(FatigueService::system()),
            activity_worker: ActivityWorker::new(),
            notification_worker: NotificationWorker::new(),
            quitting: AtomicBool::new(false),
        })
    }

    pub fn start_activity_worker(&self, app: AppHandle) -> AppResult<()> {
        self.activity_worker.start(
            Arc::clone(&self.database),
            monitor_script_path(&app)?,
            app.clone(),
        );
        self.notification_worker.start(
            Arc::clone(&self.database),
            Arc::clone(&self.fatigue_service),
            app,
        );
        Ok(())
    }

    pub fn recording_status(&self) -> bool {
        self.activity_worker.is_recording()
    }

    pub fn start_recording(&self) -> bool {
        self.activity_worker.start_recording()
    }

    pub fn stop_recording(&self) -> bool {
        self.activity_worker.stop_recording()
    }

    pub fn status(&self) -> StatusSnapshot {
        self.activity_worker.status()
    }

    pub fn fatigue(&self) -> AppResult<FatigueSnapshot> {
        self.fatigue_service.snapshot(&self.database)
    }

    pub fn show_mini_on_close(&self) -> bool {
        self.database
            .setting_is_enabled("show_mini_on_close", true)
            .unwrap_or(true)
    }

    pub fn mini_window_position(&self) -> AppResult<Option<(i32, i32)>> {
        self.database.mini_window_position()
    }

    pub fn save_mini_window_position(&self, x: i32, y: i32) -> AppResult<()> {
        self.database.save_mini_window_position(x, y)
    }

    pub fn begin_quit(&self) {
        self.quitting.store(true, Ordering::SeqCst);
        self.shutdown();
    }

    pub fn is_quitting(&self) -> bool {
        self.quitting.load(Ordering::SeqCst)
    }

    pub fn shutdown(&self) {
        self.activity_worker.shutdown();
        self.notification_worker.shutdown();
    }
}

fn monitor_script_path(app: &AppHandle) -> AppResult<PathBuf> {
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("monitor.ps1"));
    }
    app.path()
        .resolve("monitor.ps1", BaseDirectory::Resource)
        .map_err(|error| AppError::ActivitySource(error.to_string()))
}
