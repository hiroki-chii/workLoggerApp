use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct ActivityWindow {
    pub settings: HashMap<String, String>,
    pub start_time_ms: Option<i64>,
    pub active_logs: i64,
    pub recent_active_logs: i64,
}
