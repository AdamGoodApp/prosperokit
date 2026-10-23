//! PS5 on-screen keyboard: the system IME dialog. Opening does not block: the
//! system draws it over the app and `poll` asks every frame whether it is done
//! (status 2 = finished → `sceImeDialogGetResult`, then `sceImeDialogTerm`).
//! The text crosses the boundary as UTF-16.

use std::ptr;
use std::time::{Duration, Instant};

use super::layout::{from_utf16_z, to_utf16_z};
use super::sys;
use crate::{Ime, ImeKind, ImePoll, ImeRequest, PlatformError};

const MAX_LEN: u32 = 512;
const MAX_LABEL_UNITS: usize = 64;
/// Right after `Init` the status can still read 0 for a moment.
const START_GRACE: Duration = Duration::from_millis(1000);
/// A finished dialog gets this long to be closed by `Term`.
const CLOSE_GRACE: Duration = Duration::from_millis(2000);

struct Dialog {
    /// The text buffer the dialog edits in place (UTF-16, zero-terminated).
    buffer: Vec<u16>,
    _title: Vec<u16>,
    _placeholder: Vec<u16>,
    opened: Instant,
    closing_since: Option<Instant>,
}

#[derive(Default)]
pub struct Ps5Ime {
    ready: bool,
    dialog: Option<Dialog>,
}

fn failed(what: &str, code: i32) -> PlatformError {
    PlatformError::Failed {
        what: what.to_string(),
        code: i64::from(code),
    }
}

/// The `type` field of the dialog parameters.
fn dialog_type(kind: ImeKind) -> i32 {
    match kind {
        ImeKind::Text | ImeKind::Password => 0,
        ImeKind::Number => 4,
        ImeKind::Url => 2,
        ImeKind::Email => 3,
    }
}

impl Ps5Ime {
    pub fn new() -> Ps5Ime {
        Ps5Ime::default()
    }

    /// Once: the system's dialog support, then the keyboard's module.
    fn prepare(&mut self) -> Result<(), PlatformError> {
        if self.ready {
            return Ok(());
        }
        // SAFETY: plain FFI calls.
        unsafe {
            let r = sys::sceCommonDialogInitialize();
            if r < 0 && r as u32 != sys::IME_ALREADY_INITIALIZED {
                return Err(failed("sceCommonDialogInitialize", r));
            }
            let r = sys::sceSysmoduleLoadModule(sys::SYSMODULE_IME_DIALOG);
            if r < 0 {
                return Err(failed("sceSysmoduleLoadModule(IME dialog)", r));
            }
        }
        self.ready = true;
        Ok(())
    }
}

impl Ime for Ps5Ime {
    fn open(&mut self, req: ImeRequest) -> Result<(), PlatformError> {
        if self.dialog.is_some() {
            return Err(PlatformError::Busy);
        }
        self.prepare()?;
        let max_len = req.max_len.clamp(1, MAX_LEN);
        let mut buffer = to_utf16_z(&req.initial, max_len as usize + 1);
        buffer.resize(max_len as usize + 1, 0);
        let title = to_utf16_z(&req.title, MAX_LABEL_UNITS);
        let placeholder = to_utf16_z(&req.placeholder, MAX_LABEL_UNITS);
        let mut param = sys::ImeParam {
            user_id: 0,
            kind: dialog_type(req.kind),
            supported_languages: 0,
            enter_label: 0,
            input_method: 0,
            filter: ptr::null_mut(),
            option: 0,
            max_text_length: max_len,
            input_text_buffer: buffer.as_mut_ptr(),
            // A point on the 1920×1080 screen; alignment 1,1 centres the panel there.
            pos_x: 960.0,
            pos_y: 540.0,
            horizontal_alignment: 1,
            vertical_alignment: 1,
            placeholder: placeholder.as_ptr(),
            title: title.as_ptr(),
            reserved: [0; 16],
        };
        // SAFETY: the buffers outlive the dialog (stored in `Dialog`); their heap
        // blocks do not move when the `Vec`s are moved.
        unsafe {
            let r = sys::sceUserServiceGetForegroundUser(&mut param.user_id);
            if r < 0 {
                return Err(failed("sceUserServiceGetForegroundUser", r));
            }
            let r = sys::sceImeDialogInit(&param, ptr::null());
            if r != 0 {
                return Err(failed("sceImeDialogInit", r));
            }
        }
        self.dialog = Some(Dialog {
            buffer,
            _title: title,
            _placeholder: placeholder,
            opened: Instant::now(),
            closing_since: None,
        });
        Ok(())
    }

    fn poll(&mut self) -> ImePoll {
        let Some(dialog) = self.dialog.as_mut() else {
            return ImePoll::Closed;
        };
        // SAFETY: plain FFI call.
        let status = unsafe { sys::sceImeDialogGetStatus() };
        if status == sys::IME_STATUS_RUNNING
            || (status == 0 && dialog.opened.elapsed() < START_GRACE)
        {
            return ImePoll::Open;
        }
        let mut text = None;
        if status == sys::IME_STATUS_FINISHED {
            let mut result = sys::ImeResult::default();
            // SAFETY: valid 16-byte result block.
            if unsafe { sys::sceImeDialogGetResult(&mut result) } >= 0 && result.outcome == 0 {
                text = Some(from_utf16_z(&dialog.buffer));
            }
        }
        // Still closing: the controller is not the app's again until this works,
        // but not forever.
        // SAFETY: plain FFI call.
        if unsafe { sys::sceImeDialogTerm() } < 0 {
            let since = *dialog.closing_since.get_or_insert_with(Instant::now);
            if status == sys::IME_STATUS_FINISHED && since.elapsed() < CLOSE_GRACE {
                return ImePoll::Open;
            }
            text = None;
        }
        self.dialog = None;
        ImePoll::Done(text)
    }
}
