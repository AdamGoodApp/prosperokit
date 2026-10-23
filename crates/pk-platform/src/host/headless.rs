//! Headless run: no window, simulated 60 Hz time, scripted input, PNG of the
//! last presented frame.
//!
//! Simulated frames take ~1–2 ms of real time, while the JS side (bundle load,
//! React commits, native and server calls) runs in real time. Scripted presses
//! therefore wait for the app to settle — no JS activity for [`QUIET_MS`] of
//! real time — so a press never lands on a half-mounted screen and the
//! screenshot shows the final state. `--frames` is a minimum: the run continues
//! until every press was delivered and the app settled afterwards.

use std::time::{Duration, Instant};

use super::pad::button_by_name;
use super::{HeadlessOptions, HostFrameHost};
use crate::FrameHost;

/// Real time without JS activity that counts as settled.
const QUIET_MS: f64 = 50.0;
/// Longest wait for a settle between presses (apps that commit every frame).
const SETTLE_CAP_MS: f64 = 1_000.0;
/// Longest wait for the app's first JS activity (an app that renders nothing).
const START_CAP_MS: f64 = 10_000.0;
/// Frames a button stays down.
const PRESS_HELD: u32 = 5;
/// Frames a button stays up before the next press may start.
const RELEASE_GAP: u32 = 5;

#[derive(Debug, Clone, Copy, PartialEq)]
enum Phase {
    /// Waiting for the app to settle; `since_ms` is when the wait began.
    Settling {
        since_ms: f64,
    },
    Down {
        frames_left: u32,
    },
    Up {
        frames_left: u32,
    },
    Done,
}

/// Scripted controller input that waits for the app between presses.
/// Time is passed in explicitly (real milliseconds) so it can be tested.
pub(crate) struct Script {
    inputs: Vec<u32>,
    next: usize,
    phase: Phase,
    /// Real time of the latest JS activity, `None` before the first one.
    last_activity_ms: Option<f64>,
}

impl Script {
    pub(crate) fn new(inputs: Vec<u32>, now_ms: f64) -> Script {
        Script {
            inputs,
            next: 0,
            phase: Phase::Settling { since_ms: now_ms },
            last_activity_ms: None,
        }
    }

    /// Every press was delivered and the app settled after the last one.
    pub(crate) fn finished(&self) -> bool {
        self.phase == Phase::Done
    }

    /// Buttons held during this frame. `activity`: the runtime handled JS work
    /// during the previous frame; `now_ms`: real monotonic time.
    pub(crate) fn step(&mut self, activity: bool, now_ms: f64) -> u32 {
        if activity {
            self.last_activity_ms = Some(now_ms);
        }
        if let Phase::Settling { since_ms } = self.phase {
            if !self.settled(since_ms, now_ms) {
                return 0;
            }
            self.phase = if self.next < self.inputs.len() {
                Phase::Down {
                    frames_left: PRESS_HELD,
                }
            } else {
                Phase::Done
            };
        }
        match self.phase {
            Phase::Down { frames_left } => {
                let bit = self.inputs[self.next];
                self.phase = if frames_left > 1 {
                    Phase::Down {
                        frames_left: frames_left - 1,
                    }
                } else {
                    self.next += 1;
                    Phase::Up {
                        frames_left: RELEASE_GAP,
                    }
                };
                bit
            }
            Phase::Up { frames_left } => {
                self.phase = if frames_left > 1 {
                    Phase::Up {
                        frames_left: frames_left - 1,
                    }
                } else {
                    Phase::Settling { since_ms: now_ms }
                };
                0
            }
            Phase::Settling { .. } | Phase::Done => 0,
        }
    }

    fn settled(&self, since_ms: f64, now_ms: f64) -> bool {
        match self.last_activity_ms {
            // Nothing rendered yet: wait for the app, but not forever.
            None => now_ms - since_ms >= START_CAP_MS,
            // Quiet is measured from the later of the last activity and the
            // start of this wait, so a reaction still in flight is waited for.
            Some(last) => {
                now_ms - last.max(since_ms) >= QUIET_MS || now_ms - since_ms >= SETTLE_CAP_MS
            }
        }
    }
}

pub(super) fn run(
    mut host: HostFrameHost,
    mut frame: Box<dyn FnMut(&mut dyn FrameHost)>,
    opts: &HeadlessOptions,
) -> ! {
    let inputs: Vec<u32> = opts
        .input
        .iter()
        .filter_map(|n| button_by_name(n))
        .collect();
    let start = Instant::now();
    let real_ms = || start.elapsed().as_secs_f64() * 1000.0;
    let mut script = Script::new(inputs, real_ms());
    let mut index: u64 = 0;
    while index < u64::from(opts.frames) || !script.finished() {
        let activity = host.take_js_activity();
        host.pad.set_scripted(script.step(activity, real_ms()));
        host.simulated_ms = Some(index as f64 * 1000.0 / 60.0);
        frame(&mut host);
        if host.exit_requested() {
            break;
        }
        index += 1;
        // Give the runtime's worker threads a slice of real time per frame.
        std::thread::sleep(Duration::from_millis(1));
    }
    if let Some(path) = &opts.screenshot
        && let Err(e) = host.video.write_png(path)
    {
        eprintln!("[pk-host] could not write {}: {e}", path.display());
        std::process::exit(1);
    }
    std::process::exit(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOWN: u32 = 0x40;
    const CROSS: u32 = 0x4000;

    /// Steps one frame per millisecond from `t`, returning the buttons held.
    fn run_frames(s: &mut Script, t: &mut f64, frames: usize, activity_at: &[f64]) -> Vec<u32> {
        (0..frames)
            .map(|_| {
                let active = activity_at.contains(t);
                let b = s.step(active, *t);
                *t += 1.0;
                b
            })
            .collect()
    }

    #[test]
    fn waits_for_the_first_activity_then_for_quiet_before_pressing() {
        let mut s = Script::new(vec![DOWN], 0.0);
        let mut t = 0.0;
        // No JS activity yet: nothing is pressed.
        assert!(run_frames(&mut s, &mut t, 100, &[]).iter().all(|b| *b == 0));
        // The app commits at t=100; the press waits 50 ms of quiet after it.
        let held = run_frames(&mut s, &mut t, 60, &[100.0]);
        assert!(held[..50].iter().all(|b| *b == 0));
        assert_eq!(&held[50..55], &[DOWN; 5]);
        assert!(held[55..].iter().all(|b| *b == 0));
    }

    #[test]
    fn a_reaction_after_the_release_restarts_the_quiet_window() {
        let mut s = Script::new(vec![DOWN, CROSS], 0.0);
        let mut t = 0.0;
        run_frames(&mut s, &mut t, 1, &[0.0]);
        // Settle 0..50, DOWN at 50..55, up 55..60, settling from t=60.
        let first = run_frames(&mut s, &mut t, 59, &[]);
        assert_eq!(first.iter().filter(|b| **b == DOWN).count(), 5);
        // JS reacts to the press at t=80: CROSS waits until t=130.
        let start = t;
        let rest = run_frames(&mut s, &mut t, 80, &[80.0]);
        let first_cross = rest
            .iter()
            .position(|b| *b == CROSS)
            .expect("cross pressed");
        assert_eq!(start + first_cross as f64, 130.0);
        assert!(!s.finished());
        run_frames(&mut s, &mut t, 100, &[]);
        assert!(s.finished());
    }

    #[test]
    fn continuous_activity_is_capped_and_a_silent_app_times_out() {
        let mut busy = Script::new(vec![CROSS], 0.0);
        let mut t = 0.0;
        let every_frame: Vec<f64> = (0..2_000).map(f64::from).collect();
        let held = run_frames(&mut busy, &mut t, 1_100, &every_frame);
        assert_eq!(held.iter().position(|b| *b == CROSS), Some(1_000));

        let mut silent = Script::new(Vec::new(), 0.0);
        let mut t = 0.0;
        run_frames(&mut silent, &mut t, 10_000, &[]);
        assert!(!silent.finished());
        run_frames(&mut silent, &mut t, 1, &[]);
        assert!(silent.finished());
    }

    #[test]
    fn no_input_still_waits_for_the_app_to_settle() {
        let mut s = Script::new(Vec::new(), 0.0);
        let mut t = 0.0;
        // Activity at t=10: settled 50 ms later, at t=60.
        run_frames(&mut s, &mut t, 60, &[10.0]);
        assert!(!s.finished());
        run_frames(&mut s, &mut t, 1, &[]);
        assert!(s.finished());
    }
}
