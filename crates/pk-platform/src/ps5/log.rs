//! Logging: a ring of the last 500 lines (for the dev overlay) plus an append
//! sink at `/download0/prosperokit.log` that rotates to `.1` at 1 MiB. The
//! sink needs `downloadDataSize > 0` in `param.json`; when the file cannot be
//! opened the log keeps working as a ring only.

use std::collections::VecDeque;
use std::time::Instant;

use parking_lot::Mutex;

use super::fs::File;
use super::layout::DATA_ROOT;
use super::sys;
use crate::{Log, LogLevel};

const RING: usize = 500;
const ROTATE_AT: u64 = 1024 * 1024;

struct Sink {
    file: File,
    size: u64,
}

pub struct Ps5Log {
    start: Instant,
    ring: Mutex<VecDeque<(LogLevel, String)>>,
    sink: Mutex<Option<Sink>>,
    /// Opening failed once: do not retry on every line.
    sink_failed: Mutex<bool>,
    path: String,
}

impl Ps5Log {
    pub fn new() -> Ps5Log {
        Ps5Log {
            start: Instant::now(),
            ring: Mutex::new(VecDeque::with_capacity(RING)),
            sink: Mutex::new(None),
            sink_failed: Mutex::new(false),
            path: format!("{DATA_ROOT}/prosperokit.log"),
        }
    }

    fn open_sink(&self) -> Option<Sink> {
        let file = File::open(
            &self.path,
            sys::O_WRONLY | sys::O_CREAT | sys::O_APPEND,
            0o666,
        )
        .ok()?;
        let size = file.size().unwrap_or(0);
        Some(Sink { file, size })
    }

    fn append(&self, line: &str) {
        let mut sink = self.sink.lock();
        if sink.is_none() {
            let mut failed = self.sink_failed.lock();
            if *failed {
                return;
            }
            *sink = self.open_sink();
            if sink.is_none() {
                *failed = true;
                return;
            }
        }
        let Some(open) = sink.as_mut() else { return };
        if open.size + line.len() as u64 > ROTATE_AT {
            *sink = None; // closes the file
            let rotated = format!("{}.1", self.path);
            if let (Ok(from), Ok(to)) = (
                std::ffi::CString::new(self.path.as_str()),
                std::ffi::CString::new(rotated),
            ) {
                // SAFETY: valid NUL-terminated paths.
                unsafe { sys::sceKernelRename(from.as_ptr(), to.as_ptr()) };
            }
            *sink = self.open_sink();
            if sink.is_none() {
                *self.sink_failed.lock() = true;
                return;
            }
        }
        if let Some(open) = sink.as_mut()
            && open.file.write_all(line.as_bytes()).is_ok()
        {
            open.size += line.len() as u64;
        }
    }
}

impl Default for Ps5Log {
    fn default() -> Self {
        Ps5Log::new()
    }
}

impl Log for Ps5Log {
    fn log(&self, level: LogLevel, message: &str) {
        {
            let mut ring = self.ring.lock();
            if ring.len() == RING {
                ring.pop_front();
            }
            ring.push_back((level, message.to_string()));
        }
        let t = self.start.elapsed();
        let line = format!(
            "[{:>6}.{:03}] {:<5} {}\n",
            t.as_secs(),
            t.subsec_millis(),
            level.as_str(),
            message
        );
        self.append(&line);
    }

    fn recent(&self, n: usize) -> Vec<(LogLevel, String)> {
        let ring = self.ring.lock();
        ring.iter()
            .skip(ring.len().saturating_sub(n))
            .cloned()
            .collect()
    }
}
