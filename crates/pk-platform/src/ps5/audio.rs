//! PS5 audio: `sceAudioOutOpen(0xff, 0, 0, 256, 48000, S16 stereo)` and an
//! unnamed thread that calls `render` for each 256-frame grain, then
//! `sceAudioOutOutput`, which blocks until the previous grain has started
//! playing (so the loop runs at the speed sound plays and needs no timer).
//! Threads are never named on the PS5: `pthread_setname_np` hangs there.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use super::sys;
use crate::{AudioOut, PlatformError};

const GRAIN: usize = 256;
const SAMPLE_RATE: u32 = 48_000;
const FORMAT_S16_STEREO: u32 = 1;

#[repr(C, align(64))]
struct Grain([i16; GRAIN * 2]);

pub struct Ps5Audio {
    running: Arc<AtomicBool>,
    started: bool,
}

impl Ps5Audio {
    pub fn new() -> Ps5Audio {
        Ps5Audio {
            running: Arc::new(AtomicBool::new(false)),
            started: false,
        }
    }
}

impl Default for Ps5Audio {
    fn default() -> Self {
        Ps5Audio::new()
    }
}

fn failed(what: &str, code: i32) -> PlatformError {
    PlatformError::Failed {
        what: what.to_string(),
        code: i64::from(code),
    }
}

impl AudioOut for Ps5Audio {
    fn start(
        &mut self,
        mut render: Box<dyn FnMut(&mut [i16]) + Send>,
    ) -> Result<(), PlatformError> {
        if self.started {
            return Err(PlatformError::Busy);
        }
        // SAFETY: plain FFI calls.
        let handle = unsafe {
            let r = sys::sceAudioOutInit();
            if r != 0 && r as u32 != sys::AUDIO_ALREADY_INITIALIZED {
                return Err(failed("sceAudioOutInit", r));
            }
            let handle =
                sys::sceAudioOutOpen(0xff, 0, 0, GRAIN as u32, SAMPLE_RATE, FORMAT_S16_STEREO);
            if handle < 0 {
                return Err(failed("sceAudioOutOpen", handle));
            }
            handle
        };
        let running = self.running.clone();
        running.store(true, Ordering::Release);
        let spawned = std::thread::Builder::new().spawn(move || {
            let mut grain = Grain([0; GRAIN * 2]);
            loop {
                render(&mut grain.0);
                // SAFETY: `grain` holds GRAIN stereo frames.
                if unsafe { sys::sceAudioOutOutput(handle, grain.0.as_ptr().cast()) } < 0 {
                    break; // the output is gone: stay silent
                }
            }
            running.store(false, Ordering::Release);
        });
        if spawned.is_err() {
            self.running.store(false, Ordering::Release);
            return Err(failed("audio thread", 11));
        }
        self.started = true;
        Ok(())
    }

    fn is_running(&self) -> bool {
        self.running.load(Ordering::Acquire)
    }
}
