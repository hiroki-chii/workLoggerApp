use std::io;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("application data directory is unavailable")]
    AppDataDirectoryUnavailable,
    #[error("invalid date range")]
    InvalidDateRange,
    #[error("invalid time slot")]
    InvalidTimeSlot,
    #[error("database mutex was poisoned")]
    DatabasePoisoned,
    #[error("activity source error: {0}")]
    ActivitySource(String),
    #[error(transparent)]
    Database(#[from] rusqlite::Error),
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
}

pub type AppResult<T> = Result<T, AppError>;
