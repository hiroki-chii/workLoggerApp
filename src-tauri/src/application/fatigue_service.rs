use std::time::{SystemTime, UNIX_EPOCH};

use crate::{
    domain::fatigue::FatigueSnapshot, error::AppResult, infrastructure::database::Database,
};

pub trait Clock: Send + Sync {
    fn now_ms(&self) -> i64;
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64
    }
}

pub struct FatigueService<C = SystemClock> {
    clock: C,
}

impl FatigueService<SystemClock> {
    pub fn system() -> Self {
        Self { clock: SystemClock }
    }
}

impl<C: Clock> FatigueService<C> {
    pub fn snapshot(&self, database: &Database) -> AppResult<FatigueSnapshot> {
        let now_ms = self.clock.now_ms();
        Ok(crate::domain::fatigue::calculate(
            database.fatigue_window(now_ms)?,
            now_ms,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FixedClock(i64);

    impl Clock for FixedClock {
        fn now_ms(&self) -> i64 {
            self.0
        }
    }

    #[test]
    fn injects_the_clock_for_deterministic_snapshot_reads() {
        let database = Database::open_writable(":memory:").unwrap();
        let service = FatigueService {
            clock: FixedClock(1_789_689_600_000),
        };
        let snapshot = service.snapshot(&database).unwrap();
        assert_eq!(snapshot.elapsed_seconds, 0);
        assert_eq!(snapshot.status_name, "Initializing");
    }
}
