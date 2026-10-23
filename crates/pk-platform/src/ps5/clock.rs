//! Time from `clock_gettime`.

use crate::Clock;

pub struct Ps5Clock;

fn read(clock: libc::clockid_t) -> (u64, u32) {
    let mut ts = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: valid out-pointer.
    unsafe { libc::clock_gettime(clock, &mut ts) };
    (ts.tv_sec.max(0) as u64, ts.tv_nsec.max(0) as u32)
}

/// Monotonic milliseconds (fractional).
pub fn now_ms() -> f64 {
    let (s, ns) = read(libc::CLOCK_MONOTONIC);
    s as f64 * 1000.0 + f64::from(ns) / 1_000_000.0
}

impl Clock for Ps5Clock {
    fn now_ms(&self) -> f64 {
        now_ms()
    }

    fn now_us(&self) -> u64 {
        let (s, ns) = read(libc::CLOCK_MONOTONIC);
        s * 1_000_000 + u64::from(ns) / 1000
    }

    fn wall_ms(&self) -> f64 {
        let (s, ns) = read(libc::CLOCK_REALTIME);
        s as f64 * 1000.0 + f64::from(ns) / 1_000_000.0
    }

    fn sleep_ms(&self, ms: u64) {
        std::thread::sleep(std::time::Duration::from_millis(ms));
    }
}
