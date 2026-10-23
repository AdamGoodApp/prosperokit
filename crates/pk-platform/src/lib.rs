//! ProsperoKit platform layer: everything that touches the operating system,
//! behind traits. Two backends: `ps5` (the console, hand-declared `sce*` FFI)
//! and `host` (macOS/Linux desktop: winit + softbuffer + gilrs + cpal + std).
//!
//! The runtime never calls the OS directly; it receives a [`Platform`], takes
//! its shared [`Services`] and hands the platform a per-frame callback. The
//! platform owns the frame loop (vblank on the PS5, the winit event loop on
//! the desktop) and calls back once per frame with a [`FrameHost`].
//!
//! Pixel format: a frame is 1920×1080 `u32`s, each one holding the bytes
//! R, G, B, A in memory order (little-endian `0xAABBGGRR`), premultiplied —
//! exactly what tiny-skia produces and what the PS5 scanout expects. The root
//! is opaque, so alpha is always 255 at the end of a frame.

pub mod types;

#[cfg(not(target_vendor = "sie"))]
pub mod host;
#[cfg(target_vendor = "sie")]
pub mod ps5;

pub use types::*;

use std::sync::Arc;

/// Per-frame access to the platform, valid only inside the frame callback.
pub trait FrameHost {
    /// The controller state since the last frame.
    fn pad(&mut self) -> PadSnapshot;
    /// Copies the dirty tiles of `frame` to the screen and flips. An empty
    /// `dirty` set does nothing (the previous image stays on screen).
    fn present(&mut self, frame: &[u32], dirty: &pk_protocol::TileSet);
    /// Milliseconds of monotonic time.
    fn now_ms(&self) -> f64;
    fn pad_control(&mut self) -> &mut dyn PadControl;
    fn ime(&mut self) -> &mut dyn Ime;
    fn audio(&mut self) -> &mut dyn AudioOut;
    /// Desktop only: text typed while the host IME overlay is open, and
    /// window-level requests (close). The PS5 returns `None`.
    fn host_events(&mut self) -> Vec<HostEvent> {
        Vec::new()
    }
    /// Ask the platform to end the process after this frame.
    fn request_exit(&mut self);
    /// JS is not idle this frame: the runtime handled a UI-thread message (a
    /// commit, a native call, a server-function request) or a JS runtime is
    /// still running or has messages queued. Headless runs wait for this to
    /// go quiet before each scripted press; other platforms ignore it.
    fn js_activity(&mut self) {}
}

/// Shared, thread-safe services: usable from any thread (workers, JS threads).
#[derive(Clone)]
pub struct Services {
    pub fs: Arc<dyn Fs>,
    pub http: Arc<dyn Http>,
    pub clock: Arc<dyn Clock>,
    pub notify: Arc<dyn Notify>,
    pub log: Arc<dyn Log>,
    pub app: Arc<dyn AppControl>,
}

/// The whole platform. `run` never returns: the process ends through
/// [`AppControl::exit`] / [`FrameHost::request_exit`] or the system closing
/// the app.
pub trait Platform {
    fn services(&self) -> Services;
    /// The directory the app's files live in (`/app0` on the PS5).
    fn app_dir(&self) -> String;
    /// Runs the frame loop. `frame` is called once per display frame (60 Hz)
    /// on the platform's main thread and must return quickly.
    fn run(self: Box<Self>, frame: Box<dyn FnMut(&mut dyn FrameHost) + 'static>) -> !;
}

pub trait PadControl {
    fn set_light_bar(&mut self, r: u8, g: u8, b: u8);
    /// `large`/`small` are motor strengths 0..=255.
    fn vibrate(&mut self, large: u8, small: u8);
}

pub trait Ime {
    /// Opens the system keyboard. Only one dialog at a time: `Err(Busy)`
    /// while another is open.
    fn open(&mut self, req: ImeRequest) -> Result<(), PlatformError>;
    fn poll(&mut self) -> ImePoll;
    /// The text typed so far while a dialog is open, for platforms where the
    /// app draws the keyboard UI itself (the desktop host). The PS5 system
    /// dialog draws its own UI, so the default is `None`.
    fn live_text(&self) -> Option<String> {
        None
    }
}

pub trait AudioOut {
    /// Starts the output stream (48 kHz, stereo, interleaved i16). `render`
    /// is called from the audio thread to fill each buffer of frames.
    fn start(&mut self, render: Box<dyn FnMut(&mut [i16]) + Send>) -> Result<(), PlatformError>;
    fn is_running(&self) -> bool;
}

pub trait Fs: Send + Sync {
    fn read(&self, path: &str) -> Result<Vec<u8>, FsError>;
    /// Writes atomically (`<path>.tmp` then rename).
    fn write(&self, path: &str, data: &[u8]) -> Result<(), FsError>;
    fn read_dir(&self, path: &str) -> Result<Vec<DirEntry>, FsError>;
    fn stat(&self, path: &str) -> Result<FileStat, FsError>;
    fn mkdir_all(&self, path: &str) -> Result<(), FsError>;
    /// Removes a file or an empty directory.
    fn remove(&self, path: &str) -> Result<(), FsError>;
    fn rename(&self, from: &str, to: &str) -> Result<(), FsError>;
    fn exists(&self, path: &str) -> bool;
    /// Resolves `app0://`, `data://` and plain paths to the backend's real path.
    fn resolve(&self, path: &str) -> String;
}

pub trait Http: Send + Sync {
    /// Blocking; call from a worker thread.
    fn request(&self, req: HttpRequest) -> Result<HttpResponse, HttpError>;
}

pub trait Clock: Send + Sync {
    /// Monotonic milliseconds (fractional).
    fn now_ms(&self) -> f64;
    fn now_us(&self) -> u64;
    /// Wall-clock milliseconds since the Unix epoch.
    fn wall_ms(&self) -> f64;
    fn sleep_ms(&self, ms: u64);
}

pub trait Notify: Send + Sync {
    /// A system notification (the pop-up in the top corner).
    fn notify(&self, message: &str);
}

pub trait Log: Send + Sync {
    fn log(&self, level: LogLevel, message: &str);
    /// The most recent `n` lines (newest last), for the dev overlay.
    fn recent(&self, n: usize) -> Vec<(LogLevel, String)>;
}

pub trait AppControl: Send + Sync {
    /// Ends the process (`sceSystemServiceLoadExec("exit")` on the PS5).
    fn exit(&self) -> !;
    fn info(&self) -> SystemInfo;
}

/// Convenience: log through `Services`.
impl Services {
    pub fn info(&self, msg: impl AsRef<str>) {
        self.log.log(LogLevel::Info, msg.as_ref());
    }
    pub fn warn(&self, msg: impl AsRef<str>) {
        self.log.log(LogLevel::Warn, msg.as_ref());
    }
    pub fn error(&self, msg: impl AsRef<str>) {
        self.log.log(LogLevel::Error, msg.as_ref());
    }
    pub fn debug(&self, msg: impl AsRef<str>) {
        self.log.log(LogLevel::Debug, msg.as_ref());
    }
}
