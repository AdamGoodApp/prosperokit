//! PS5 backend: hand-declared `sce*` FFI (`sys`), scanout video, pad, system
//! keyboard, audio, a `sceKernel*` file system, libSceHttp (with a plain-TCP
//! fallback), clock, notifications, log and app control. Compiled only for the
//! `x86_64-sie-ps5` target (`target_vendor = "sie"`); the pure data layouts in
//! `layout.rs` and the fallback HTTP client are also built for the host tests.

mod app;
mod audio;
mod clock;
mod fs;
mod ime;
mod layout;
mod log;
mod notify;
mod pad;
mod sce_http;
mod sys;
mod tcp_http;
mod video;

use std::sync::Arc;

use pk_protocol::TileSet;

pub use app::Ps5App;
pub use audio::Ps5Audio;
pub use clock::Ps5Clock;
pub use fs::Ps5Fs;
pub use ime::Ps5Ime;
pub use log::Ps5Log;
pub use notify::{Ps5Notify, notify};
pub use pad::Ps5Pad;
pub use sce_http::{Ps5Http, USE_SCE_HTTP};
pub use video::Ps5Video;

use crate::{AudioOut, FrameHost, Ime, PadControl, PadSnapshot, Platform, PlatformError, Services};

/// The console: `/app0` is the app folder, `/download0` the persistent sandbox.
pub struct Ps5Platform {
    services: Services,
    video: Ps5Video,
    pad: Ps5Pad,
    ime: Ps5Ime,
    audio: Ps5Audio,
}

impl Ps5Platform {
    /// Opens video, pad and the shared services. Fails (with the failing call
    /// in the error) when the display cannot be set up.
    pub fn new() -> Result<Ps5Platform, PlatformError> {
        let log: Arc<dyn crate::Log> = Arc::new(Ps5Log::new());
        let services = Services {
            fs: Arc::new(Ps5Fs::new()),
            http: Arc::new(Ps5Http::new()),
            clock: Arc::new(Ps5Clock),
            notify: Arc::new(Ps5Notify),
            log: log.clone(),
            app: Arc::new(Ps5App::new()),
        };
        let video = Ps5Video::new()?;
        let pad = Ps5Pad::new(log);
        Ok(Ps5Platform {
            services,
            video,
            pad,
            ime: Ps5Ime::new(),
            audio: Ps5Audio::new(),
        })
    }
}

impl Platform for Ps5Platform {
    fn services(&self) -> Services {
        self.services.clone()
    }

    fn app_dir(&self) -> String {
        layout::APP0_ROOT.to_string()
    }

    /// The vblank loop: wait for the display, then call back once per frame.
    fn run(self: Box<Self>, mut frame: Box<dyn FnMut(&mut dyn FrameHost) + 'static>) -> ! {
        let this = *self;
        let mut host = Ps5FrameHost {
            video: this.video,
            pad: this.pad,
            ime: this.ime,
            audio: this.audio,
            exit_requested: false,
        };
        loop {
            host.video.wait_vblank();
            frame(&mut host);
            if host.exit_requested {
                this.services.app.exit();
            }
        }
    }
}

struct Ps5FrameHost {
    video: Ps5Video,
    pad: Ps5Pad,
    ime: Ps5Ime,
    audio: Ps5Audio,
    exit_requested: bool,
}

impl FrameHost for Ps5FrameHost {
    fn pad(&mut self) -> PadSnapshot {
        self.pad.poll()
    }

    fn present(&mut self, frame: &[u32], dirty: &TileSet) {
        self.video.present(frame, dirty);
    }

    fn now_ms(&self) -> f64 {
        clock::now_ms()
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

    fn request_exit(&mut self) {
        self.exit_requested = true;
    }
}
