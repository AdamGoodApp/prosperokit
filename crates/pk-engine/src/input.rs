//! Input mapping (Phase 3 §7): pad snapshots → focus navigation, presses and
//! scrolling.
//!
//! * D-pad and left stick (dead zone 0.5, dominant axis) produce `Nav` with
//!   repeat: first repeat after 350 ms, then every 80 ms while held.
//! * Cross: down → `pressIn`; up → `press` (if the focused node is unchanged)
//!   and `pressOut`; held ≥ 500 ms → `longPress` once (a node that handles
//!   `longPress` does not also get `press` for that hold).
//! * Circle → `back`; other buttons → `key {button, phase}`. Both go to the
//!   focused node and bubble up the ancestors to the root, which the engine
//!   implements by targeting the nearest node that subscribed (JS then walks
//!   `parentId` itself).
//! * Right stick scrolls the nearest `Scroll` ancestor of the focused node (or
//!   the first `Scroll` in tree order) at 1400 px/s × axis.
//! * `intercepted` suspends all input state: held buttons are released
//!   without events firing presses, and buttons still held when the system
//!   gives the pad back are ignored until released.

use pk_platform::PadSnapshot;
use pk_protocol::events::{BUTTON_INTERCEPTED, EventKind, UiEvent, button_name};
use pk_protocol::ops::NodeKind;
use pk_protocol::props::{Direction, ROOT_ID};
use pk_protocol::{NodeId, Value};

use crate::{Engine, SoundCue};

pub const REPEAT_FIRST_MS: f64 = 350.0;
pub const REPEAT_MS: f64 = 80.0;
pub const LONG_PRESS_MS: f64 = 500.0;
pub const STICK_DEAD_ZONE: f32 = 0.5;
pub const RIGHT_STICK_DEAD_ZONE: f32 = 0.15;
pub const SCROLL_SPEED: f32 = 1400.0;

const DPAD_UP: u32 = 0x0010;
const DPAD_RIGHT: u32 = 0x0020;
const DPAD_DOWN: u32 = 0x0040;
const DPAD_LEFT: u32 = 0x0080;
const CIRCLE: u32 = 0x2000;
const CROSS: u32 = 0x4000;
const DPAD_MASK: u32 = DPAD_UP | DPAD_RIGHT | DPAD_DOWN | DPAD_LEFT;
/// Buttons mapped to `key` events.
const KEY_BUTTONS: [u32; 10] = [
    0x0002, 0x0004, 0x0008, 0x0100, 0x0200, 0x0400, 0x0800, 0x1000, 0x8000, 0x10_0000,
];

#[derive(Default)]
pub struct InputState {
    prev: u32,
    suspended: bool,
    nav_dir: Option<Direction>,
    nav_next: f64,
    cross_target: Option<NodeId>,
    cross_down_at: f64,
    long_fired: bool,
    /// Buttons that were already held when input resumed (ignored until released).
    ignore: u32,
}

fn stick_dir(x: i8, y: i8) -> Option<Direction> {
    let fx = x as f32 / 127.0;
    let fy = y as f32 / 127.0;
    if fx.abs().max(fy.abs()) < STICK_DEAD_ZONE {
        return None;
    }
    Some(if fx.abs() >= fy.abs() {
        if fx > 0.0 {
            Direction::Right
        } else {
            Direction::Left
        }
    } else if fy > 0.0 {
        Direction::Down
    } else {
        Direction::Up
    })
}

impl Engine {
    /// Target of `back`/`key` events: the focused node, or the root. These are
    /// always delivered (JS bubbles them along `parentId`).
    fn key_target(&self) -> NodeId {
        self.focused().unwrap_or(ROOT_ID)
    }

    fn emit_key(&mut self, button: &str, phase: &str) {
        let t = self.key_target();
        self.events.push(UiEvent::with_payload(
            t,
            EventKind::Key,
            Value::obj([
                ("button", Value::from(button)),
                ("phase", Value::from(phase)),
            ]),
        ));
    }

    fn release_cross(&mut self, fire_press: bool) {
        let Some(target) = self.input.cross_target.take() else {
            return;
        };
        let long = self.input.long_fired;
        self.input.long_fired = false;
        if let Some(n) = self.tree.get_mut(target) {
            n.state.pressed = false;
            let sub_long = n.subscribed(EventKind::LongPress.bit());
            let same = self.focus.focused == Some(target);
            if fire_press && same && !(long && sub_long) {
                if n.subscribed(EventKind::Press.bit()) {
                    self.events.push(UiEvent::new(target, EventKind::Press));
                }
                if self.cfg.ui_sounds {
                    self.sounds.push(SoundCue::Select);
                }
            }
            if n.subscribed(EventKind::PressOut.bit()) {
                self.events.push(UiEvent::new(target, EventKind::PressOut));
            }
        }
        self.restyle(target, true);
    }

    pub(crate) fn process_input(&mut self, snap: &PadSnapshot, now: f64, dt_ms: f64) {
        if snap.intercepted || snap.buttons & BUTTON_INTERCEPTED != 0 {
            if !self.input.suspended {
                self.input.suspended = true;
                if let Some(o) = self.input.nav_dir.take() {
                    self.emit_key(o.as_str(), "up");
                }
                self.release_cross(false);
                self.input.long_fired = false;
            }
            self.input.prev = 0;
            return;
        }
        let mut buttons = snap.buttons & !BUTTON_INTERCEPTED;
        if self.input.suspended {
            // Whatever is held now was pressed while the system owned the pad.
            self.input.suspended = false;
            self.input.ignore = buttons;
        }
        self.input.ignore &= buttons;
        buttons &= !self.input.ignore;

        let prev = self.input.prev;
        let down = buttons & !prev;
        let up = prev & !buttons;
        self.input.prev = buttons;

        // Navigation: d-pad wins over the stick.
        let dpad = buttons & DPAD_MASK;
        let dir = if dpad & DPAD_UP != 0 {
            Some(Direction::Up)
        } else if dpad & DPAD_DOWN != 0 {
            Some(Direction::Down)
        } else if dpad & DPAD_LEFT != 0 {
            Some(Direction::Left)
        } else if dpad & DPAD_RIGHT != 0 {
            Some(Direction::Right)
        } else {
            stick_dir(snap.lx, snap.ly)
        };
        match (dir, self.input.nav_dir) {
            (Some(d), cur) if Some(d) != cur => {
                if let Some(o) = cur {
                    self.emit_key(o.as_str(), "up");
                }
                self.input.nav_dir = Some(d);
                self.input.nav_next = now + REPEAT_FIRST_MS;
                self.emit_key(d.as_str(), "down");
                self.move_focus(d);
            }
            (Some(d), Some(_)) => {
                if now >= self.input.nav_next {
                    self.input.nav_next += REPEAT_MS;
                    if self.input.nav_next <= now {
                        self.input.nav_next = now + REPEAT_MS;
                    }
                    self.emit_key(d.as_str(), "down");
                    self.move_focus(d);
                }
            }
            (None, Some(o)) => {
                self.input.nav_dir = None;
                self.emit_key(o.as_str(), "up");
            }
            _ => {}
        }

        // Cross: pressIn / longPress / press + pressOut.
        if down & CROSS != 0 {
            if let Some(f) = self.focused() {
                self.input.cross_target = Some(f);
                self.input.cross_down_at = now;
                self.input.long_fired = false;
                if let Some(n) = self.tree.get_mut(f) {
                    n.state.pressed = true;
                    if n.subscribed(EventKind::PressIn.bit()) {
                        self.events.push(UiEvent::new(f, EventKind::PressIn));
                    }
                }
                self.restyle(f, true);
            }
        }
        if let Some(t) = self.input.cross_target {
            if buttons & CROSS != 0
                && !self.input.long_fired
                && now - self.input.cross_down_at >= LONG_PRESS_MS
            {
                self.input.long_fired = true;
                if self
                    .tree
                    .get(t)
                    .is_some_and(|n| n.subscribed(EventKind::LongPress.bit()))
                {
                    self.events.push(UiEvent::new(t, EventKind::LongPress));
                }
            }
        }
        if up & CROSS != 0 {
            self.release_cross(true);
        }

        // Circle → back (always delivered: JS bubbles it and owns the default handler).
        if down & CIRCLE != 0 {
            let t = self.key_target();
            self.events.push(UiEvent::new(t, EventKind::Back));
            if self.cfg.ui_sounds {
                self.sounds.push(SoundCue::Back);
            }
        }

        // Everything else → key events.
        for bit in KEY_BUTTONS {
            for (mask, phase) in [(down, "down"), (up, "up")] {
                if mask & bit != 0 {
                    if let Some(name) = button_name(bit) {
                        self.emit_key(name, phase);
                    }
                }
            }
        }

        // Right stick scrolling.
        let rx = snap.rx as f32 / 127.0;
        let ry = snap.ry as f32 / 127.0;
        let ax = if rx.abs() > RIGHT_STICK_DEAD_ZONE {
            rx.clamp(-1.0, 1.0)
        } else {
            0.0
        };
        let ay = if ry.abs() > RIGHT_STICK_DEAD_ZONE {
            ry.clamp(-1.0, 1.0)
        } else {
            0.0
        };
        if ax != 0.0 || ay != 0.0 {
            let target = self
                .focused()
                .and_then(|f| self.nearest_scroll(f))
                .or_else(|| self.first_scroll());
            if let Some(s) = target {
                let step = SCROLL_SPEED * dt_ms as f32 / 1000.0;
                self.scroll_by(s, ax * step, ay * step);
            }
        }
    }

    fn first_scroll(&self) -> Option<NodeId> {
        self.tree.subtree(ROOT_ID).into_iter().find(|id| {
            self.tree
                .get(*id)
                .is_some_and(|n| n.kind == NodeKind::Scroll && !n.display_none())
        })
    }
}
