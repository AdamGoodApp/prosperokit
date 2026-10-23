//! System notifications: `sceKernelSendNotificationRequest(0, &req, size, 0)`
//! with `req = { u8 reserved[45]; char message[3075] }`.

use std::ffi::c_void;

use super::sys;
use crate::Notify;

pub struct Ps5Notify;

/// Posts `message` (truncated to fit, at a character boundary).
pub fn notify(message: &str) {
    let mut req = sys::NotificationRequest {
        reserved: [0; 45],
        message: [0; 3075],
    };
    let mut end = message.len().min(req.message.len() - 1);
    while !message.is_char_boundary(end) {
        end -= 1;
    }
    req.message[..end].copy_from_slice(&message.as_bytes()[..end]);
    // SAFETY: `req` is a valid request block of the size passed.
    unsafe {
        sys::sceKernelSendNotificationRequest(
            0,
            (&mut req as *mut sys::NotificationRequest).cast::<c_void>(),
            size_of::<sys::NotificationRequest>(),
            0,
        );
    }
}

impl Notify for Ps5Notify {
    fn notify(&self, message: &str) {
        notify(message);
    }
}
