//! Process control and app identity: exit through the system service, title
//! id / name / version from `/app0/sce_sys/param.json`.

use std::ptr;
use std::time::Instant;

use super::fs::read_real;
use super::layout::APP0_ROOT;
use super::sys;
use crate::{AppControl, SystemInfo, parse_param_json};

pub struct Ps5App {
    title_id: String,
    app_name: String,
    app_version: String,
    start: Instant,
}

impl Ps5App {
    /// Reads `param.json` (missing or malformed: empty fields).
    pub fn new() -> Ps5App {
        let text = read_real(&format!("{APP0_ROOT}/sce_sys/param.json"))
            .map(|b| String::from_utf8_lossy(&b).into_owned())
            .unwrap_or_default();
        let (title_id, app_version, app_name) = parse_param_json(&text);
        Ps5App {
            title_id,
            app_name,
            app_version,
            start: Instant::now(),
        }
    }
}

impl Default for Ps5App {
    fn default() -> Self {
        Ps5App::new()
    }
}

impl AppControl for Ps5App {
    fn exit(&self) -> ! {
        // SAFETY: a NUL-terminated path and a null argv.
        unsafe { sys::sceSystemServiceLoadExec(c"exit".as_ptr(), ptr::null()) };
        // Returning from here would crash the launch context: wait to be closed.
        loop {
            // SAFETY: plain FFI call.
            unsafe { sys::sceKernelUsleep(1_000_000) };
        }
    }

    fn info(&self) -> SystemInfo {
        SystemInfo {
            platform: "ps5",
            title_id: self.title_id.clone(),
            app_name: self.app_name.clone(),
            app_version: self.app_version.clone(),
            uptime_ms: self.start.elapsed().as_millis() as u64,
        }
    }
}
