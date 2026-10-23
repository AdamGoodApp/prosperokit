//! Desktop backend (macOS / Linux): winit window + softbuffer scanout, gilrs
//! gamepads, cpal audio, `std` for files / HTTP / time. Also a headless mode
//! for CI that runs a fixed number of frames at simulated 60 Hz, feeds scripted
//! button presses and writes the last frame as a PNG.

mod audio;
mod fs;
mod headless;
mod http;
mod ime;
mod pad;
mod services;
mod video;
mod window;

#[cfg(test)]
#[path = "../ps5/layout.rs"]
mod ps5_layout;
#[cfg(test)]
#[path = "../ps5/tcp_http.rs"]
mod ps5_tcp_http;

use std::path::PathBuf;
use std::sync::Arc;

use pk_protocol::TileSet;

pub use audio::HostAudio;
pub use fs::HostFs;
pub use http::HostHttp;
pub use ime::HostIme;
pub use services::{HostApp, HostClock, HostLog, HostNotify};

use crate::{
    AudioOut, FrameHost, HostEvent, Ime, PadControl, PadSnapshot, Platform, PlatformError, Services,
};
use pad::HostPad;
use video::HostVideo;

/// Headless (no window) run parameters.
#[derive(Clone, Debug, Default)]
pub struct HeadlessOptions {
    /// Number of frames to run before exiting 0.
    pub frames: u32,
    /// Button names pressed one after another: input `i` is held for frames
    /// `10 + 10·i .. 15 + 10·i` (see [`headless::scripted_buttons`]).
    pub input: Vec<String>,
    /// Where to write the last presented frame as a 1920×1080 PNG.
    pub screenshot: Option<PathBuf>,
}

#[derive(Clone, Debug)]
pub struct HostOptions {
    /// The app folder (`app0://`).
    pub app_dir: PathBuf,
    /// `Some` runs without a window.
    pub headless: Option<HeadlessOptions>,
    pub window_title: String,
}

pub struct HostPlatform {
    opts: HostOptions,
    app_dir: PathBuf,
    notify: Arc<HostNotify>,
    services: Services,
}

impl HostPlatform {
    pub fn new(opts: HostOptions) -> Result<HostPlatform, PlatformError> {
        let app_dir = std::fs::canonicalize(&opts.app_dir).map_err(|e| PlatformError::Failed {
            what: format!("app directory {}: {e}", opts.app_dir.display()),
            code: i64::from(e.raw_os_error().unwrap_or(2)),
        })?;
        if !app_dir.is_dir() {
            return Err(PlatformError::Failed {
                what: format!("{} is not a directory", app_dir.display()),
                code: 20,
            });
        }
        if let Some(h) = &opts.headless {
            for name in &h.input {
                if pad::button_by_name(name).is_none() {
                    return Err(PlatformError::Unsupported(format!(
                        "unknown input button {name:?}"
                    )));
                }
            }
        }
        let notify = Arc::new(HostNotify::new());
        let services = Services {
            fs: Arc::new(HostFs::new(&app_dir)),
            http: Arc::new(HostHttp::new()),
            clock: Arc::new(HostClock::new()),
            notify: notify.clone(),
            log: Arc::new(HostLog::new()),
            app: Arc::new(HostApp::new(&app_dir)),
        };
        Ok(HostPlatform {
            opts,
            app_dir,
            notify,
            services,
        })
    }

    /// The concrete notification sink: the runtime may drain it with
    /// [`HostNotify::take`] to draw its own toast.
    pub fn notifications(&self) -> Arc<HostNotify> {
        self.notify.clone()
    }
}

impl Platform for HostPlatform {
    fn services(&self) -> Services {
        self.services.clone()
    }

    fn app_dir(&self) -> String {
        self.app_dir.to_string_lossy().into_owned()
    }

    fn run(self: Box<Self>, frame: Box<dyn FnMut(&mut dyn FrameHost) + 'static>) -> ! {
        let this = *self;
        let headless = this.opts.headless.is_some();
        let host = HostFrameHost::new(headless);
        match this.opts.headless {
            Some(opts) => headless::run(host, frame, &opts),
            None => window::run(host, frame, &this.opts.window_title),
        }
    }
}

/// The per-frame view of the desktop platform.
pub struct HostFrameHost {
    pub(crate) pad: HostPad,
    pub(crate) ime: HostIme,
    pub(crate) audio: HostAudio,
    pub(crate) video: HostVideo,
    clock: HostClock,
    /// Headless runs advance a simulated clock instead of reading the real one.
    simulated_ms: Option<f64>,
    events: Vec<HostEvent>,
    exit_requested: bool,
    /// Set by `js_activity`, taken once per headless frame.
    js_active: bool,
}

impl HostFrameHost {
    fn new(headless: bool) -> HostFrameHost {
        HostFrameHost {
            pad: HostPad::new(!headless),
            ime: HostIme::new(),
            audio: HostAudio::new(),
            video: HostVideo::new(),
            clock: HostClock::new(),
            simulated_ms: headless.then_some(0.0),
            events: Vec::new(),
            exit_requested: false,
            js_active: false,
        }
    }

    /// The text typed so far while the host IME overlay is open.
    pub fn ime_live_text(&self) -> Option<String> {
        self.ime.live_text().map(str::to_string)
    }

    pub(crate) fn push_event(&mut self, event: HostEvent) {
        self.events.push(event);
    }

    pub(crate) fn exit_requested(&self) -> bool {
        self.exit_requested
    }

    /// Whether the runtime reported JS activity since the last call.
    pub(crate) fn take_js_activity(&mut self) -> bool {
        std::mem::take(&mut self.js_active)
    }
}

impl FrameHost for HostFrameHost {
    fn pad(&mut self) -> PadSnapshot {
        let mut snap = self.pad.snapshot();
        if self.ime.is_open() {
            // The "system keyboard" owns the controller, like on the PS5.
            snap = PadSnapshot {
                intercepted: true,
                connected: snap.connected,
                ..PadSnapshot::default()
            };
        }
        snap
    }

    fn present(&mut self, frame: &[u32], dirty: &TileSet) {
        self.video.present(frame, dirty);
    }

    fn now_ms(&self) -> f64 {
        use crate::Clock;
        self.simulated_ms.unwrap_or_else(|| self.clock.now_ms())
    }

    fn pad_control(&mut self) -> &mut dyn PadControl {
        &mut self.pad
    }

    fn ime(&mut self) -> &mut dyn Ime {
        &mut self.ime
    }

    fn audio(&mut self) -> &mut dyn AudioOut {
        &mut self.audio
    }

    fn host_events(&mut self) -> Vec<HostEvent> {
        std::mem::take(&mut self.events)
    }

    fn request_exit(&mut self) {
        self.exit_requested = true;
    }

    fn js_activity(&mut self) {
        self.js_active = true;
    }
}
