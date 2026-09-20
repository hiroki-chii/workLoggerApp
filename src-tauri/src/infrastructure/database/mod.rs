use std::{
    collections::{BTreeSet, HashMap},
    env, fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, params_from_iter, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::{
    domain::activity::ActivityWindow,
    error::{AppError, AppResult},
};

const WORKDAY_FILTER: &str =
    "timestamp >= datetime(date('now', 'localtime', '-4 hours'), '+4 hours', 'utc')
  AND timestamp < datetime(date('now', 'localtime', '-4 hours'), '+1 day', '+4 hours', 'utc')";

pub struct Database {
    connection: Mutex<Connection>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct WindowRule {
    pub id: i64,
    pub keyword: String,
    pub replace_with: String,
    pub match_type: String,
    pub color: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct WindowRuleInput {
    pub keyword: String,
    pub replace_with: String,
    pub match_type: String,
    pub color: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Statistic {
    pub name: Option<String>,
    pub count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityLog {
    pub id: i64,
    pub app_name: Option<String>,
    pub window_title: Option<String>,
    pub timestamp: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeatmapCell {
    pub log_date: String,
    pub hour: String,
    pub minute: i64,
    pub top_app: Option<String>,
    pub top_window: Option<String>,
    pub task_count: i64,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusSnapshot {
    pub idle_seconds: i64,
    pub last_update: i64,
}

impl Database {
    pub fn open_default() -> AppResult<Self> {
        let directory = env::var_os("WORKLOGGER_DATA_DIR")
            .map(PathBuf::from)
            .or_else(|| {
                env::var_os("APPDATA").map(|path| PathBuf::from(path).join("workloggerapp"))
            })
            .ok_or(AppError::AppDataDirectoryUnavailable)?;
        Self::open_writable(directory.join("logs.db"))
    }

    pub fn open(path: impl AsRef<Path>) -> AppResult<Self> {
        let path = path.as_ref();
        if path == Path::new(":memory:") {
            let connection = Connection::open_in_memory()?;
            Self::initialize(&connection)?;
            return Ok(Self {
                connection: Mutex::new(connection),
            });
        }

        if path.exists() {
            // Phase 3 only reads the existing Electron database. Opening it read-only avoids
            // journal and default-setting writes until the Rust writer is introduced in Phase 4.
            let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
            return Ok(Self {
                connection: Mutex::new(connection),
            });
        }

        if let Some(parent) = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            fs::create_dir_all(parent)?;
        }
        let connection = Connection::open(path)?;
        Self::initialize(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn open_writable(path: impl AsRef<Path>) -> AppResult<Self> {
        let path = path.as_ref();
        if path == Path::new(":memory:") {
            return Self::open(path);
        }
        if let Some(parent) = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            fs::create_dir_all(parent)?;
        }
        let connection = Connection::open(path)?;
        Self::initialize(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    fn initialize(connection: &Connection) -> AppResult<()> {
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                appName TEXT,
                windowTitle TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );
            CREATE TABLE IF NOT EXISTS window_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                keyword TEXT NOT NULL,
                replace_with TEXT NOT NULL,
                match_type TEXT NOT NULL,
                color TEXT
            );",
        )?;

        let now_ms = now_ms();
        for (key, value) in [
            ("sampling_interval", "10".to_owned()),
            ("default_activity_color", "#6366f1".to_owned()),
            ("show_mini_on_close", "true".to_owned()),
            ("mini_window_position", "右下".to_owned()),
            ("show_pet_in_mini", "true".to_owned()),
            ("current_mode", "tracking".to_owned()),
            ("enable_fatigue_alert", "true".to_owned()),
            ("pomodoro_start_ms", now_ms.to_string()),
            ("pomodoro_status", "running".to_owned()),
            ("pomodoro_remaining_ms", "0".to_owned()),
            ("sliding_window_size", "90".to_owned()),
            ("power_saving", "true".to_owned()),
        ] {
            connection.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
                params![key, value],
            )?;
        }
        connection.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            params!["idle_threshold", "60"],
        )?;
        connection.execute(
            "UPDATE settings SET value = '右下' WHERE key = 'mini_window_position' AND value = '右上'",
            [],
        )?;
        Ok(())
    }

    fn with_connection<T>(
        &self,
        operation: impl FnOnce(&mut Connection) -> AppResult<T>,
    ) -> AppResult<T> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| AppError::DatabasePoisoned)?;
        operation(&mut connection)
    }

    pub fn settings(&self) -> AppResult<HashMap<String, String>> {
        self.with_connection(|connection| read_settings(connection))
    }

    pub fn setting_is_enabled(&self, key: &str, default: bool) -> AppResult<bool> {
        self.with_connection(|connection| {
            let value = connection
                .query_row("SELECT value FROM settings WHERE key = ?", [key], |row| {
                    row.get::<_, String>(0)
                })
                .optional()?;
            Ok(value
                .as_deref()
                .map(|value| value == "true")
                .unwrap_or(default))
        })
    }

    pub fn mini_window_position(&self) -> AppResult<Option<(i32, i32)>> {
        self.with_connection(|connection| {
            let x = connection
                .query_row(
                    "SELECT value FROM settings WHERE key = 'mini_window_x'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .optional();
            let y = connection
                .query_row(
                    "SELECT value FROM settings WHERE key = 'mini_window_y'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .optional();
            match (x?, y?) {
                (Some(x), Some(y)) => Ok(x.parse().ok().zip(y.parse().ok())),
                _ => Ok(None),
            }
        })
    }

    pub fn save_mini_window_position(&self, x: i32, y: i32) -> AppResult<()> {
        self.with_connection(|connection| {
            connection.execute(
                "INSERT INTO settings (key, value) VALUES ('mini_window_x', ?) \
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [x.to_string()],
            )?;
            connection.execute(
                "INSERT INTO settings (key, value) VALUES ('mini_window_y', ?) \
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [y.to_string()],
            )?;
            Ok(())
        })
    }

    pub fn update_settings(&self, values: HashMap<String, String>) -> AppResult<()> {
        if values.is_empty() || values.keys().any(|key| key == "undefined") {
            return Err(AppError::ActivitySource("invalid settings".to_owned()));
        }
        if values
            .get("sampling_interval")
            .is_some_and(|value| value.parse::<i64>().ok().is_none_or(|value| value < 1))
        {
            return Err(AppError::ActivitySource("invalid sampling interval".to_owned()));
        }
        self.with_connection(|connection| {
            let transaction = connection.transaction()?;
            for (key, value) in values {
                transaction.execute(
                    "INSERT INTO settings (key, value) VALUES (?, ?) \
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    params![key, value],
                )?;
            }
            transaction.commit()?;
            Ok(())
        })
    }

    pub fn control_pomodoro(&self, action: &str, now_ms: i64) -> AppResult<()> {
        if !matches!(action, "pause" | "start" | "reset") {
            return Err(AppError::ActivitySource("invalid pomodoro action".to_owned()));
        }
        self.with_connection(|connection| {
            let transaction = connection.transaction()?;
            let settings = read_settings(&transaction)?;
            let state = crate::domain::pomodoro::calculate(&settings, now_ms)
                .ok_or_else(|| AppError::ActivitySource("not in Pomodoro mode".to_owned()))?;
            let save = |key: &str, value: String| -> AppResult<()> {
                transaction.execute(
                    "INSERT INTO settings (key, value) VALUES (?, ?) \
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    params![key, value],
                )?;
                Ok(())
            };
            match action {
                "pause" if state.status == "running" => {
                    save("pomodoro_status", "paused".to_owned())?;
                    save(
                        "pomodoro_remaining_ms",
                        state.deadline_ms.unwrap_or(now_ms).saturating_sub(now_ms).to_string(),
                    )?;
                    save("pomodoro_paused_phase", state.phase)?;
                }
                "start" if state.status == "paused" => {
                    let end = if state.phase == "work" {
                        state.work_min
                    } else {
                        state.work_min + state.break_min
                    } * 60_000;
                    let remaining = settings
                        .get("pomodoro_remaining_ms")
                        .and_then(|value| value.parse::<i64>().ok())
                        .unwrap_or(0);
                    save("pomodoro_start_ms", (now_ms - end + remaining).to_string())?;
                    save("pomodoro_status", "running".to_owned())?;
                }
                "reset" => {
                    save("pomodoro_start_ms", now_ms.to_string())?;
                    save("pomodoro_status", "paused".to_owned())?;
                    save("pomodoro_remaining_ms", (state.work_min * 60_000).to_string())?;
                    save("pomodoro_paused_phase", "work".to_owned())?;
                }
                _ => {}
            }
            transaction.commit()?;
            Ok(())
        })
    }

    pub fn clear_activity_history(&self) -> AppResult<i64> {
        self.with_connection(|connection| {
            let deleted = connection.execute("DELETE FROM logs", [])? as i64;
            connection.execute_batch("VACUUM")?;
            Ok(deleted)
        })
    }

    pub fn reset_fatigue(&self) -> AppResult<i64> {
        self.with_connection(|connection| {
            Ok(connection.execute(&format!("DELETE FROM logs WHERE {WORKDAY_FILTER}"), [])? as i64)
        })
    }

    pub fn create_window_rule(&self, rule: WindowRuleInput) -> AppResult<i64> {
        validate_window_rule(&rule)?;
        self.with_connection(|connection| {
            connection.execute(
                "INSERT INTO window_rules (keyword, replace_with, match_type, color) VALUES (?, ?, ?, ?)",
                params![rule.keyword, rule.replace_with, rule.match_type, rule.color],
            )?;
            Ok(connection.last_insert_rowid())
        })
    }

    pub fn update_window_rule(&self, id: i64, rule: WindowRuleInput) -> AppResult<()> {
        validate_window_rule(&rule)?;
        self.with_connection(|connection| {
            connection.execute(
                "UPDATE window_rules SET keyword = ?, replace_with = ?, match_type = ?, color = ? WHERE id = ?",
                params![rule.keyword, rule.replace_with, rule.match_type, rule.color, id],
            )?;
            Ok(())
        })
    }

    pub fn delete_window_rule(&self, id: i64) -> AppResult<()> {
        self.with_connection(|connection| {
            connection.execute("DELETE FROM window_rules WHERE id = ?", [id])?;
            Ok(())
        })
    }

    pub fn window_rules(&self) -> AppResult<Vec<WindowRule>> {
        self.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT id, keyword, replace_with, match_type, color FROM window_rules ORDER BY id DESC",
            )?;
            let rows = statement.query_map([], |row| {
                Ok(WindowRule {
                    id: row.get(0)?,
                    keyword: row.get(1)?,
                    replace_with: row.get(2)?,
                    match_type: row.get(3)?,
                    color: row.get(4)?,
                })
            })?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?)
        })
    }

    pub fn window_titles(&self) -> AppResult<Vec<String>> {
        self.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT windowTitle FROM logs
                WHERE windowTitle IS NOT NULL AND windowTitle NOT IN ('アイドル状態', '無操作')
                GROUP BY windowTitle ORDER BY MAX(timestamp) DESC LIMIT 500",
            )?;
            let rows = statement.query_map([], |row| row.get(0))?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?)
        })
    }

    pub fn statistics(
        &self,
        start_date: Option<&str>,
        end_date: Option<&str>,
        group_by: Option<&str>,
    ) -> AppResult<Vec<Statistic>> {
        let group_column = if group_by == Some("windowTitle") {
            "windowTitle"
        } else {
            "appName"
        };
        let (clause, parameters) = period_filter(start_date, end_date, true)?;
        self.with_connection(|connection| {
            let query = format!("SELECT {group_column} AS name, COUNT(*) AS count FROM logs{clause} GROUP BY name ORDER BY count DESC");
            let mut statement = connection.prepare(&query)?;
            let rows = statement.query_map(params_from_iter(parameters), |row| {
                Ok(Statistic { name: row.get(0)?, count: row.get(1)? })
            })?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?)
        })
    }

    pub fn activity_history(&self) -> AppResult<Vec<ActivityLog>> {
        self.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT id, appName, windowTitle, datetime(timestamp, 'localtime') AS timestamp
                FROM logs ORDER BY logs.timestamp DESC LIMIT 1000",
            )?;
            let rows = statement.query_map([], |row| {
                Ok(ActivityLog {
                    id: row.get(0)?,
                    app_name: row.get(1)?,
                    window_title: row.get(2)?,
                    timestamp: row.get(3)?,
                })
            })?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?)
        })
    }

    pub fn activity_breakdown(
        &self,
        date: &str,
        hour: i64,
        minute: i64,
    ) -> AppResult<Vec<ActivityLog>> {
        if !is_valid_date(date) || !(0..=23).contains(&hour) || ![0, 15, 30, 45].contains(&minute) {
            return Err(AppError::InvalidTimeSlot);
        }
        let start = format!("{date} {hour:02}:{minute:02}:00");
        self.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT id, appName, windowTitle, datetime(timestamp, 'localtime') AS timestamp
                FROM logs WHERE timestamp >= datetime(?, 'utc')
                AND timestamp < datetime(?, '+15 minutes', 'utc') ORDER BY logs.timestamp ASC",
            )?;
            let rows = statement.query_map(params![&start, &start], |row| {
                Ok(ActivityLog {
                    id: row.get(0)?,
                    app_name: row.get(1)?,
                    window_title: row.get(2)?,
                    timestamp: row.get(3)?,
                })
            })?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?)
        })
    }

    pub fn history_csv(
        &self,
        start_date: Option<&str>,
        end_date: Option<&str>,
    ) -> AppResult<String> {
        let (clause, parameters) = period_filter(start_date, end_date, false)?;
        self.with_connection(|connection| {
            let query = format!(
                "SELECT datetime(timestamp, 'localtime'), appName, windowTitle FROM logs{clause} ORDER BY logs.timestamp DESC"
            );
            let mut statement = connection.prepare(&query)?;
            let logs = statement
                .query_map(params_from_iter(parameters), |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            let rules = export_rules(connection)?;
            let records = logs
                .into_iter()
                .map(|(timestamp, app_name, window_title)| {
                    vec![
                        timestamp.unwrap_or_default(),
                        app_name.unwrap_or_default(),
                        apply_window_rules(window_title.as_deref(), &rules),
                    ]
                })
                .collect();
            Ok(csv_text(
                &["日時", "アプリ名", "ウィンドウタイトル"],
                records,
            ))
        })
    }

    pub fn timetable_csv(
        &self,
        start_date: Option<&str>,
        end_date: Option<&str>,
    ) -> AppResult<String> {
        let cells = self.heatmap(start_date, end_date)?;
        self.with_connection(|connection| {
            let rules = export_rules(connection)?;
            let dates = cells
                .iter()
                .map(|cell| cell.log_date.clone())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect::<Vec<_>>();
            let mut records = Vec::with_capacity(96);
            for hour in 0..24 {
                for minute in (0..60).step_by(15) {
                    let mut row = vec![format!("{hour:02}:{minute:02}")];
                    for date in &dates {
                        let value = cells
                            .iter()
                            .find(|cell| {
                                cell.log_date == *date
                                    && cell.hour == format!("{hour:02}")
                                    && cell.minute == minute
                            })
                            .map(|cell| {
                                match cell.top_window.as_deref().filter(|value| !value.is_empty()) {
                                    Some(title) => apply_window_rules(Some(title), &rules),
                                    None => cell.top_app.clone().unwrap_or_default(),
                                }
                            })
                            .unwrap_or_default();
                        row.push(value);
                    }
                    records.push(row);
                }
            }
            let mut headers = vec!["時刻".to_owned()];
            headers.extend(dates);
            Ok(csv_text(
                &headers.iter().map(String::as_str).collect::<Vec<_>>(),
                records,
            ))
        })
    }

    pub fn heatmap(
        &self,
        start_date: Option<&str>,
        end_date: Option<&str>,
    ) -> AppResult<Vec<HeatmapCell>> {
        let (clause, parameters) = period_filter(start_date, end_date, true)?;
        self.with_connection(|connection| {
            let query = format!(
                "WITH BucketCounts AS (
                    SELECT date(timestamp, 'localtime') AS logDate,
                      strftime('%H', timestamp, 'localtime') AS hour,
                      (strftime('%M', timestamp, 'localtime') / 15) * 15 AS minute,
                      appName, windowTitle AS groupWindow, COUNT(*) AS taskCount
                    FROM logs{clause}
                    GROUP BY logDate, hour, minute, appName, groupWindow
                ), RankedBuckets AS (
                    SELECT b.logDate, b.hour, b.minute, b.appName, b.groupWindow, b.taskCount,
                      SUM(b.taskCount) OVER(PARTITION BY b.logDate, b.hour, b.minute) AS totalCount,
                      ROW_NUMBER() OVER(PARTITION BY b.logDate, b.hour, b.minute ORDER BY b.taskCount DESC) AS rank
                    FROM BucketCounts b
                ) SELECT logDate, hour, minute, appName AS topApp, groupWindow AS topWindow,
                  taskCount, totalCount AS count FROM RankedBuckets WHERE rank = 1"
            );
            let mut statement = connection.prepare(&query)?;
            let rows = statement.query_map(params_from_iter(parameters), |row| {
                Ok(HeatmapCell {
                    log_date: row.get(0)?, hour: row.get(1)?, minute: row.get(2)?,
                    top_app: row.get(3)?, top_window: row.get(4)?, task_count: row.get(5)?, count: row.get(6)?,
                })
            })?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?)
        })
    }

    pub fn fatigue_window(&self, now_ms: i64) -> AppResult<ActivityWindow> {
        self.with_connection(|connection| {
            let settings = read_settings(connection)?;
            let (start_time_ms, active_logs): (Option<i64>, i64) = connection.query_row(
                &format!("SELECT MIN(CAST(strftime('%s', timestamp) AS INTEGER) * 1000), COUNT(*) FROM logs WHERE {WORKDAY_FILTER}"),
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            let sliding_window_seconds = setting_positive(&settings, "sliding_window_size", 90) * 60;
            let recent_active_logs: i64 = connection.query_row(
                "SELECT COUNT(*) FROM logs WHERE timestamp >= datetime(?, 'unixepoch')",
                [(now_ms / 1_000) - sliding_window_seconds],
                |row| row.get(0),
            )?;
            Ok(ActivityWindow {
                settings,
                start_time_ms,
                active_logs,
                recent_active_logs,
            })
        })
    }

    pub fn sampling_interval_seconds(&self) -> AppResult<i64> {
        self.with_connection(|connection| {
            let settings = read_settings(connection)?;
            Ok(setting_positive(&settings, "sampling_interval", 10))
        })
    }

    pub fn record_activity(
        &self,
        app_name: &str,
        window_title: &str,
        timestamp: &str,
    ) -> AppResult<()> {
        self.with_connection(|connection| {
            connection.execute(
                "INSERT INTO logs (appName, windowTitle, timestamp) VALUES (?, ?, ?)",
                params![app_name, window_title, timestamp],
            )?;
            Ok(())
        })
    }
}

fn read_settings(connection: &Connection) -> AppResult<HashMap<String, String>> {
    let mut statement = connection.prepare("SELECT key, value FROM settings")?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    Ok(rows.collect::<Result<HashMap<_, _>, _>>()?)
}

fn export_rules(connection: &Connection) -> AppResult<Vec<WindowRule>> {
    let mut statement = connection.prepare(
        "SELECT id, keyword, replace_with, match_type, color FROM window_rules ORDER BY id ASC",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(WindowRule {
            id: row.get(0)?,
            keyword: row.get(1)?,
            replace_with: row.get(2)?,
            match_type: row.get(3)?,
            color: row.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn apply_window_rules(title: Option<&str>, rules: &[WindowRule]) -> String {
    let Some(title) = title else {
        return String::new();
    };
    if matches!(title, "アイドル状態" | "無操作") {
        return title.to_owned();
    }
    for rule in rules {
        let matches = match rule.match_type.as_str() {
            "exact" => title == rule.keyword,
            "startsWith" => title.starts_with(&rule.keyword),
            _ => title.contains(&rule.keyword),
        };
        if matches {
            return rule.replace_with.clone();
        }
    }
    title.to_owned()
}

fn csv_text(headers: &[&str], records: Vec<Vec<String>>) -> String {
    let mut output = String::new();
    output.push_str(
        &headers
            .iter()
            .map(|field| csv_field(field))
            .collect::<Vec<_>>()
            .join(","),
    );
    output.push('\n');
    for record in records {
        output.push_str(
            &record
                .iter()
                .map(|field| csv_field(field))
                .collect::<Vec<_>>()
                .join(","),
        );
        output.push('\n');
    }
    output
}

fn csv_field(value: &str) -> String {
    if value.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_owned()
    }
}

fn period_filter(
    start_date: Option<&str>,
    end_date: Option<&str>,
    default_workday: bool,
) -> AppResult<(String, Vec<String>)> {
    match (start_date, end_date) {
        (Some(start), Some(end)) if is_valid_date(start) && is_valid_date(end) && start <= end => Ok((
            " WHERE timestamp >= datetime(?, 'utc') AND timestamp < datetime(?, '+1 day', 'utc') ".to_owned(),
            vec![start.to_owned(), end.to_owned()],
        )),
        (Some(_), Some(_)) | (Some(_), None) | (None, Some(_)) => Err(AppError::InvalidDateRange),
        (None, None) if default_workday => Ok((format!(" WHERE {WORKDAY_FILTER} "), vec![])),
        (None, None) => Ok((String::new(), vec![])),
    }
}

fn is_valid_date(value: &str) -> bool {
    let parts: Vec<_> = value.split('-').collect();
    if parts.len() != 3
        || parts
            .iter()
            .enumerate()
            .any(|(index, part)| part.len() != if index == 0 { 4 } else { 2 })
    {
        return false;
    }
    let (Ok(year), Ok(month), Ok(day)) = (
        parts[0].parse::<i32>(),
        parts[1].parse::<u32>(),
        parts[2].parse::<u32>(),
    ) else {
        return false;
    };
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days).contains(&day)
}

fn setting_positive(settings: &HashMap<String, String>, key: &str, default: i64) -> i64 {
    settings
        .get(key)
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
        .max(1)
}

fn validate_window_rule(rule: &WindowRuleInput) -> AppResult<()> {
    if rule.keyword.is_empty() || rule.replace_with.is_empty() || rule.match_type.is_empty() {
        return Err(AppError::ActivitySource("missing required window rule fields".to_owned()));
    }
    Ok(())
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
    fn initializes_the_existing_schema_and_default_settings() {
        let database = Database::open(":memory:").unwrap();
        let settings = database.settings().unwrap();
        assert_eq!(settings.get("sampling_interval"), Some(&"10".to_owned()));
        assert_eq!(settings.get("sliding_window_size"), Some(&"90".to_owned()));
        assert_eq!(database.activity_history().unwrap().len(), 0);
    }

    #[test]
    fn persists_mini_window_position_without_changing_existing_defaults() {
        let database = Database::open(":memory:").unwrap();
        assert!(database.setting_is_enabled("show_mini_on_close", false).unwrap());
        assert_eq!(database.mini_window_position().unwrap(), None);

        database.save_mini_window_position(1240, 760).unwrap();
        assert_eq!(database.mini_window_position().unwrap(), Some((1240, 760)));
    }

    #[test]
    fn preserves_existing_write_use_cases() {
        let database = Database::open(":memory:").unwrap();
        database
            .update_settings(HashMap::from([
                ("sampling_interval".to_owned(), "30".to_owned()),
                ("current_mode".to_owned(), "pomodoro25".to_owned()),
                ("pomodoro_start_ms".to_owned(), "1".to_owned()),
                ("pomodoro_status".to_owned(), "paused".to_owned()),
                ("pomodoro_remaining_ms".to_owned(), "120000".to_owned()),
                ("pomodoro_paused_phase".to_owned(), "work".to_owned()),
            ]))
            .unwrap();
        assert!(database
            .update_settings(HashMap::from([(
                "sampling_interval".to_owned(),
                "0".to_owned(),
            )]))
            .is_err());
        assert_eq!(
            database.settings().unwrap().get("sampling_interval"),
            Some(&"30".to_owned())
        );

        database.control_pomodoro("start", 1_000_000).unwrap();
        let settings = database.settings().unwrap();
        assert_eq!(settings.get("pomodoro_status"), Some(&"running".to_owned()));
        assert_eq!(settings.get("pomodoro_start_ms"), Some(&"-380000".to_owned()));

        let id = database
            .create_window_rule(WindowRuleInput {
                keyword: "Project".to_owned(),
                replace_with: "作業".to_owned(),
                match_type: "contains".to_owned(),
                color: Some("#8b5cf6".to_owned()),
            })
            .unwrap();
        database
            .update_window_rule(
                id,
                WindowRuleInput {
                    keyword: "Project X".to_owned(),
                    replace_with: "移行".to_owned(),
                    match_type: "exact".to_owned(),
                    color: None,
                },
            )
            .unwrap();
        assert_eq!(database.window_rules().unwrap()[0].replace_with, "移行");
        database.delete_window_rule(id).unwrap();
        assert!(database.window_rules().unwrap().is_empty());

        database
            .record_activity("Code", "main.rs", "2026-09-20 10:00:00")
            .unwrap();
        assert_eq!(database.clear_activity_history().unwrap(), 1);
        assert!(database.activity_history().unwrap().is_empty());
    }

    #[test]
    fn validates_calendar_dates() {
        assert!(is_valid_date("2024-02-29"));
        assert!(!is_valid_date("2026-02-29"));
        assert!(!is_valid_date("2026-13-01"));
    }

    #[test]
    fn reads_existing_log_rows_without_schema_migration() {
        let database = Database::open(":memory:").unwrap();
        database
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO logs (appName, windowTitle, timestamp) VALUES (?, ?, ?)",
                    params!["Code", "migration.md", "2026-09-20 01:05:00"],
                )?;
                connection.execute(
                    "INSERT INTO logs (appName, windowTitle, timestamp) VALUES (?, ?, ?)",
                    params!["Code", "migration.md", "2026-09-20 01:10:00"],
                )?;
                connection.execute(
                    "INSERT INTO logs (appName, windowTitle, timestamp) VALUES (?, ?, ?)",
                    params!["Browser", "Tauri docs", "2026-09-20 02:15:00"],
                )?;
                connection.execute(
                    "INSERT INTO window_rules (keyword, replace_with, match_type) VALUES (?, ?, ?)",
                    params!["migration", "移行計画", "contains"],
                )?;
                Ok(())
            })
            .unwrap();

        let statistics = database
            .statistics(Some("2026-09-20"), Some("2026-09-20"), None)
            .unwrap();
        assert_eq!(statistics[0].name.as_deref(), Some("Code"));
        assert_eq!(statistics[0].count, 2);

        let history = database.activity_history().unwrap();
        assert_eq!(history.len(), 3);
        assert_eq!(history[0].app_name.as_deref(), Some("Browser"));

        let heatmap = database
            .heatmap(Some("2026-09-20"), Some("2026-09-20"))
            .unwrap();
        assert_eq!(heatmap.iter().map(|cell| cell.count).sum::<i64>(), 3);

        let history_csv = database
            .history_csv(Some("2026-09-20"), Some("2026-09-20"))
            .unwrap();
        assert!(history_csv.starts_with("日時,アプリ名,ウィンドウタイトル\n"));
        assert!(history_csv.contains(",Code,移行計画\n"));

        let timetable_csv = database
            .timetable_csv(Some("2026-09-20"), Some("2026-09-20"))
            .unwrap();
        assert!(timetable_csv.starts_with("時刻,2026-09-20\n"));
        assert!(timetable_csv.contains("移行計画"));
    }
}
