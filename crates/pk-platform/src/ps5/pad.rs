//! PS5 controller: UserService → `scePadOpen` of the initial user, one
//! `scePadRead` of up to 32 samples (120 bytes each) per frame.
//!
//! Sample layout: buttons u32 at 0 (bit `0x8000_0000` = the system owns the
//! controller), sticks u8 at 4..8 (lx, ly, rx, ry; 128 at rest), touch count u8
//! at 52, first finger x/y u16 at 60/62. The touchpad resolution comes from
//! `scePadGetControllerInformation` (u16 at 4 and 6).

use std::ffi::c_void;
use std::ptr;
use std::sync::Arc;

use super::sys;
use crate::{Log, LogLevel, PadControl, PadSnapshot};

const SAMPLES: usize = 32;
const INTERCEPTED: u32 = 0x8000_0000;
const TOUCH_COUNT_AT: usize = 52;
const TOUCH_X_AT: usize = 60;
const TOUCH_Y_AT: usize = 62;
/// Every button bit the engine knows (`pk_protocol::BUTTON_NAMES`).
const BUTTON_MASK: u32 = 0x0010_0000 | 0xfffe;

#[repr(C, align(16))]
struct Samples([[u8; sys::PAD_SAMPLE_SIZE]; SAMPLES]);

pub struct Ps5Pad {
    handle: i32,
    samples: Box<Samples>,
    /// The last sample of the previous read, to find presses inside a batch.
    last_buttons: u32,
    touch_w: f32,
    touch_h: f32,
    log: Arc<dyn Log>,
    reported_light: bool,
    reported_vibration: bool,
}

/// A stick byte (0..=255, 128 at rest) as -127..=127.
fn stick(raw: u8) -> i8 {
    (i16::from(raw) - 128).clamp(-127, 127) as i8
}

impl Ps5Pad {
    /// Opens the initial user's controller. A missing controller is not an
    /// error: the snapshots then report `connected: false`.
    pub fn new(log: Arc<dyn Log>) -> Ps5Pad {
        let mut handle = -1;
        let (mut touch_w, mut touch_h) = (1920.0, 1080.0);
        // SAFETY: plain FFI calls with valid out-pointers.
        unsafe {
            // Refused when already initialised: harmless.
            sys::sceUserServiceInitialize(ptr::null());
            let mut user: i32 = -1;
            if sys::sceUserServiceGetInitialUser(&mut user) >= 0
                && user >= 0
                && sys::scePadInit() >= 0
            {
                handle = sys::scePadOpen(user, 0, 0, ptr::null());
                if handle < 0 {
                    handle = sys::scePadGetHandle(user, 0, 0);
                }
            }
            if handle >= 0 {
                let mut info = [0u8; 64];
                if sys::scePadGetControllerInformation(handle, info.as_mut_ptr().cast::<c_void>())
                    == 0
                {
                    let rx = u16::from_le_bytes([info[4], info[5]]);
                    let ry = u16::from_le_bytes([info[6], info[7]]);
                    if rx > 100 && ry > 100 {
                        touch_w = f32::from(rx);
                        touch_h = f32::from(ry);
                    }
                }
            }
        }
        if handle < 0 {
            log.log(
                LogLevel::Warn,
                &format!("pad: no controller handle ({handle:#x})"),
            );
        }
        Ps5Pad {
            handle,
            samples: Box::new(Samples([[0; sys::PAD_SAMPLE_SIZE]; SAMPLES])),
            last_buttons: 0,
            touch_w,
            touch_h,
            log,
            reported_light: false,
            reported_vibration: false,
        }
    }

    /// The controller state since the last call.
    pub fn poll(&mut self) -> PadSnapshot {
        if self.handle < 0 {
            return PadSnapshot::default();
        }
        // SAFETY: `samples` holds SAMPLES records of the size the call writes.
        let count = unsafe {
            sys::scePadRead(
                self.handle,
                self.samples.0.as_mut_ptr().cast::<c_void>(),
                SAMPLES as i32,
            )
        };
        let count = usize::try_from(count).unwrap_or(0).min(SAMPLES);
        if count == 0 {
            // Nothing new: the controller is still connected, the state unchanged.
            return PadSnapshot {
                buttons: self.last_buttons & BUTTON_MASK,
                connected: true,
                ..PadSnapshot::default()
            };
        }
        let mut pressed = 0u32;
        let mut previous = self.last_buttons;
        for sample in &self.samples.0[..count] {
            let raw = u32::from_le_bytes([sample[0], sample[1], sample[2], sample[3]]);
            pressed |= raw & !previous;
            previous = raw;
        }
        self.last_buttons = previous;
        let newest = &self.samples.0[count - 1];
        if previous & INTERCEPTED != 0 {
            return PadSnapshot {
                intercepted: true,
                connected: true,
                ..PadSnapshot::default()
            };
        }
        let touch = (newest[TOUCH_COUNT_AT] > 0).then(|| {
            let x = f32::from(u16::from_le_bytes([
                newest[TOUCH_X_AT],
                newest[TOUCH_X_AT + 1],
            ]));
            let y = f32::from(u16::from_le_bytes([
                newest[TOUCH_Y_AT],
                newest[TOUCH_Y_AT + 1],
            ]));
            // Grow the range to the largest coordinate seen so the far edges reach 1.
            self.touch_w = self.touch_w.max(x + 1.0);
            self.touch_h = self.touch_h.max(y + 1.0);
            (x / (self.touch_w - 1.0), y / (self.touch_h - 1.0))
        });
        PadSnapshot {
            // A press shorter than one frame still shows up for this frame.
            buttons: (previous | pressed) & BUTTON_MASK,
            lx: stick(newest[4]),
            ly: stick(newest[5]),
            rx: stick(newest[6]),
            ry: stick(newest[7]),
            touch,
            intercepted: false,
            connected: true,
        }
    }
}

impl PadControl for Ps5Pad {
    fn set_light_bar(&mut self, r: u8, g: u8, b: u8) {
        if self.handle < 0 {
            return;
        }
        let param = sys::PadLightBar {
            r,
            g,
            b,
            reserved: 0,
        };
        // SAFETY: valid handle and parameter block.
        let code = unsafe { sys::scePadSetLightBar(self.handle, &param) };
        if code < 0 && !self.reported_light {
            self.reported_light = true;
            self.log.log(
                LogLevel::Warn,
                &format!("scePadSetLightBar failed: {code:#x}"),
            );
        }
    }

    fn vibrate(&mut self, large: u8, small: u8) {
        if self.handle < 0 {
            return;
        }
        let param = sys::PadVibration {
            large_motor: large,
            small_motor: small,
        };
        // SAFETY: valid handle and parameter block.
        let code = unsafe { sys::scePadSetVibration(self.handle, &param) };
        if code < 0 && !self.reported_vibration {
            self.reported_vibration = true;
            self.log.log(
                LogLevel::Warn,
                &format!("scePadSetVibration failed: {code:#x}"),
            );
        }
    }
}
