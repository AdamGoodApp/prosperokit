//! Small desktop services: clock, notifications, log, app control.

use std::collections::VecDeque;
use std::path::Path;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;

use crate::{AppControl, Clock, Log, LogLevel, Notify, SystemInfo, parse_param_json};

pub struct HostClock {
    start: Instant,
}

impl HostClock {
    pub fn new() -> HostClock {
        HostClock {
            start: Instant::now(),
        }
    }
}

impl Default for HostClock {
    fn default() -> Self {
        HostClock::new()
    }
}

impl Clock for HostClock {
    fn now_ms(&self) -> f64 {
        self.start.elapsed().as_secs_f64() * 1000.0
    }

    fn now_us(&self) -> u64 {
        self.start.elapsed().as_micros() as u64
    }

    fn wall_ms(&self) -> f64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs_f64() * 1000.0)
            .unwrap_or(0.0)
    }

    fn sleep_ms(&self, ms: u64) {
        std::thread::sleep(std::time::Duration::from_millis(ms));
    }
}

/// Keeps the most recent notifications so the runtime can draw its own toast.
const NOTIFY_KEEP: usize = 64;

#[derive(Default)]
pub struct HostNotify {
    pending: Mutex<VecDeque<String>>,
}

impl HostNotify {
    pub fn new() -> HostNotify {
        HostNotify::default()
    }

    /// Drains the notifications posted since the last call.
    pub fn take(&self) -> Vec<String> {
        self.pending.lock().drain(..).collect()
    }
}

impl Notify for HostNotify {
    fn notify(&self, message: &str) {
        eprintln!("[notify] {message}");
        let mut pending = self.pending.lock();
        if pending.len() >= NOTIFY_KEEP {
            pending.pop_front();
        }
        pending.push_back(message.to_string());
    }
}

const LOG_KEEP: usize = 500;

#[derive(Default)]
pub struct HostLog {
    ring: Mutex<VecDeque<(LogLevel, String)>>,
}

impl HostLog {
    pub fn new() -> HostLog {
        HostLog::default()
    }
}

impl Log for HostLog {
    fn log(&self, level: LogLevel, message: &str) {
        eprintln!("[{}] {message}", level.as_str());
        let mut ring = self.ring.lock();
        if ring.len() >= LOG_KEEP {
            ring.pop_front();
        }
        ring.push_back((level, message.to_string()));
    }

    fn recent(&self, n: usize) -> Vec<(LogLevel, String)> {
        let ring = self.ring.lock();
        ring.iter()
            .skip(ring.len().saturating_sub(n))
            .cloned()
            .collect()
    }
}

pub struct HostApp {
    title_id: String,
    app_name: String,
    app_version: String,
    start: Instant,
}

impl HostApp {
    /// Reads `<app_dir>/sce_sys/param.json` (missing or malformed: empty fields).
    pub fn new(app_dir: &Path) -> HostApp {
        let text = std::fs::read_to_string(app_dir.join("sce_sys/param.json")).unwrap_or_default();
        let (title_id, app_version, app_name) = parse_param_json(&text);
        HostApp {
            title_id,
            app_name,
            app_version,
            start: Instant::now(),
        }
    }
}

impl AppControl for HostApp {
    fn exit(&self) -> ! {
        std::process::exit(0)
    }

    fn info(&self) -> SystemInfo {
        SystemInfo {
            platform: "host",
            title_id: self.title_id.clone(),
            app_name: self.app_name.clone(),
            app_version: self.app_version.clone(),
            uptime_ms: self.start.elapsed().as_millis() as u64,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_keeps_the_last_500_lines() {
        let log = HostLog::new();
        for i in 0..600 {
            log.log(LogLevel::Debug, &format!("line {i}"));
        }
        let all = log.recent(1000);
        assert_eq!(all.len(), 500);
        assert_eq!(all[0].1, "line 100");
        assert_eq!(
            log.recent(2)
                .iter()
                .map(|l| l.1.as_str())
                .collect::<Vec<_>>(),
            ["line 598", "line 599"]
        );
    }

    #[test]
    fn notify_records_and_drains() {
        let notify = HostNotify::new();
        notify.notify("a");
        notify.notify("b");
        assert_eq!(notify.take(), ["a", "b"]);
        assert!(notify.take().is_empty());
    }

    #[test]
    fn app_info_comes_from_param_json() {
        let dir = std::env::temp_dir().join(format!("pk-platform-app-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sce_sys")).unwrap();
        std::fs::write(
            dir.join("sce_sys/param.json"),
            r#"{"titleId":"PPSA90000","contentVersion":"01.002.003","localizedParameters":{"defaultLanguage":"en-US","en-US":{"titleName":"Spike"}}}"#,
        )
        .unwrap();
        let info = HostApp::new(&dir).info();
        assert_eq!(
            (
                info.platform,
                info.title_id.as_str(),
                info.app_name.as_str(),
                info.app_version.as_str()
            ),
            ("host", "PPSA90000", "Spike", "01.002.003")
        );
        let none = HostApp::new(&dir.join("nope")).info();
        assert_eq!((none.title_id.as_str(), none.app_name.as_str()), ("", ""));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
