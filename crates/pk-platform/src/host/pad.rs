//! Desktop controller: keyboard (the Phase 1 mapping), gilrs gamepads
//! (DualSense / Xbox style) and the scripted input of headless runs, all
//! merged into one [`PadSnapshot`].

use gilrs::{Axis, Button, EventType, GamepadId, Gilrs, ff};
use winit::keyboard::KeyCode;

use crate::{PadControl, PadSnapshot};

pub(crate) mod btn {
    pub const L3: u32 = 0x0002;
    pub const R3: u32 = 0x0004;
    pub const OPTIONS: u32 = 0x0008;
    pub const UP: u32 = 0x0010;
    pub const RIGHT: u32 = 0x0020;
    pub const DOWN: u32 = 0x0040;
    pub const LEFT: u32 = 0x0080;
    pub const L2: u32 = 0x0100;
    pub const R2: u32 = 0x0200;
    pub const L1: u32 = 0x0400;
    pub const R1: u32 = 0x0800;
    pub const TRIANGLE: u32 = 0x1000;
    pub const CIRCLE: u32 = 0x2000;
    pub const CROSS: u32 = 0x4000;
    pub const SQUARE: u32 = 0x8000;
    pub const TOUCHPAD: u32 = 0x10_0000;
}

/// Keyboard → pad button (Phase 1 §4).
pub(crate) fn key_button(code: KeyCode) -> Option<u32> {
    Some(match code {
        KeyCode::ArrowUp => btn::UP,
        KeyCode::ArrowDown => btn::DOWN,
        KeyCode::ArrowLeft => btn::LEFT,
        KeyCode::ArrowRight => btn::RIGHT,
        KeyCode::Enter | KeyCode::NumpadEnter => btn::CROSS,
        KeyCode::Backspace | KeyCode::Escape => btn::CIRCLE,
        KeyCode::Space => btn::SQUARE,
        KeyCode::Tab => btn::TRIANGLE,
        KeyCode::KeyQ => btn::L1,
        KeyCode::KeyE => btn::R1,
        KeyCode::KeyZ => btn::L2,
        KeyCode::KeyC => btn::R2,
        KeyCode::F1 => btn::OPTIONS,
        KeyCode::F2 => btn::TOUCHPAD,
        _ => return None,
    })
}

/// Button names accepted by `--input` (the engine's names plus a few aliases).
pub(crate) fn button_by_name(name: &str) -> Option<u32> {
    let name = name.trim().to_ascii_lowercase();
    match name.as_str() {
        "start" => Some(btn::OPTIONS),
        "a" => Some(btn::CROSS),
        "b" => Some(btn::CIRCLE),
        "x" => Some(btn::SQUARE),
        "y" => Some(btn::TRIANGLE),
        other => pk_protocol::events::button_bit(other),
    }
}

const STICK_DEADZONE: f32 = 0.12;

fn stick(v: f32) -> i8 {
    if v.abs() < STICK_DEADZONE {
        0
    } else {
        (v.clamp(-1.0, 1.0) * 127.0).round() as i8
    }
}

struct Gamepads {
    gilrs: Gilrs,
    active: Option<GamepadId>,
    effect: Option<ff::Effect>,
}

pub(crate) struct HostPad {
    keys: u32,
    scripted: u32,
    pads: Option<Gamepads>,
}

impl HostPad {
    pub(crate) fn new(use_gamepads: bool) -> HostPad {
        let pads = if use_gamepads {
            match Gilrs::new() {
                Ok(gilrs) => {
                    let active = gilrs
                        .gamepads()
                        .find(|(_, g)| g.is_connected())
                        .map(|(id, _)| id);
                    Some(Gamepads {
                        gilrs,
                        active,
                        effect: None,
                    })
                }
                Err(gilrs::Error::NotImplemented(gilrs)) => Some(Gamepads {
                    gilrs,
                    active: None,
                    effect: None,
                }),
                Err(e) => {
                    eprintln!("[pk-platform] gamepad support unavailable: {e}");
                    None
                }
            }
        } else {
            None
        };
        HostPad {
            keys: 0,
            scripted: 0,
            pads,
        }
    }

    pub(crate) fn key(&mut self, code: KeyCode, pressed: bool) {
        if let Some(bit) = key_button(code) {
            if pressed {
                self.keys |= bit;
            } else {
                self.keys &= !bit;
            }
        }
    }

    /// Releases every key (the window lost focus: no key-up will arrive).
    pub(crate) fn release_keys(&mut self) {
        self.keys = 0;
    }

    pub(crate) fn set_scripted(&mut self, buttons: u32) {
        self.scripted = buttons;
    }

    pub(crate) fn snapshot(&mut self) -> PadSnapshot {
        let mut snap = PadSnapshot {
            buttons: self.keys | self.scripted,
            connected: true,
            ..PadSnapshot::default()
        };
        if let Some(pads) = &mut self.pads {
            while let Some(event) = pads.gilrs.next_event() {
                match event.event {
                    EventType::Connected => pads.active = Some(event.id),
                    EventType::Disconnected if pads.active == Some(event.id) => {
                        pads.active = None;
                        pads.effect = None;
                    }
                    EventType::Disconnected => {}
                    _ => pads.active = Some(event.id),
                }
            }
            if let Some(id) = pads.active {
                let pad = pads.gilrs.gamepad(id);
                let map = [
                    (Button::South, btn::CROSS),
                    (Button::East, btn::CIRCLE),
                    (Button::West, btn::SQUARE),
                    (Button::North, btn::TRIANGLE),
                    (Button::LeftTrigger, btn::L1),
                    (Button::RightTrigger, btn::R1),
                    (Button::LeftTrigger2, btn::L2),
                    (Button::RightTrigger2, btn::R2),
                    (Button::Start, btn::OPTIONS),
                    (Button::Mode, btn::TOUCHPAD),
                    (Button::LeftThumb, btn::L3),
                    (Button::RightThumb, btn::R3),
                    (Button::DPadUp, btn::UP),
                    (Button::DPadDown, btn::DOWN),
                    (Button::DPadLeft, btn::LEFT),
                    (Button::DPadRight, btn::RIGHT),
                ];
                for (button, bit) in map {
                    if pad.is_pressed(button) {
                        snap.buttons |= bit;
                    }
                }
                // gilrs: stick Y grows upward; the pad (and the engine) grow downward.
                snap.lx = stick(pad.value(Axis::LeftStickX));
                snap.ly = stick(-pad.value(Axis::LeftStickY));
                snap.rx = stick(pad.value(Axis::RightStickX));
                snap.ry = stick(-pad.value(Axis::RightStickY));
            }
        }
        snap
    }
}

impl PadControl for HostPad {
    /// The desktop has no light bar.
    fn set_light_bar(&mut self, _r: u8, _g: u8, _b: u8) {}

    fn vibrate(&mut self, large: u8, small: u8) {
        let Some(pads) = &mut self.pads else { return };
        pads.effect = None; // dropping the handle stops the previous rumble
        let Some(id) = pads.active else { return };
        if (large == 0 && small == 0) || !pads.gilrs.gamepad(id).is_ff_supported() {
            return;
        }
        let strong = ff::BaseEffect {
            kind: ff::BaseEffectType::Strong {
                magnitude: u16::from(large) * 257,
            },
            ..Default::default()
        };
        let weak = ff::BaseEffect {
            kind: ff::BaseEffectType::Weak {
                magnitude: u16::from(small) * 257,
            },
            ..Default::default()
        };
        let built = ff::EffectBuilder::new()
            .add_effect(strong)
            .add_effect(weak)
            .gamepads(&[id])
            .repeat(ff::Repeat::For(ff::Ticks::from_ms(2000)))
            .finish(&mut pads.gilrs);
        match built {
            Ok(effect) => {
                if effect.play().is_ok() {
                    pads.effect = Some(effect);
                }
            }
            Err(e) => eprintln!("[pk-platform] force feedback failed: {e}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keyboard_mapping_matches_the_plan() {
        assert_eq!(key_button(KeyCode::ArrowUp), Some(btn::UP));
        assert_eq!(key_button(KeyCode::Enter), Some(btn::CROSS));
        assert_eq!(key_button(KeyCode::Backspace), Some(btn::CIRCLE));
        assert_eq!(key_button(KeyCode::Escape), Some(btn::CIRCLE));
        assert_eq!(key_button(KeyCode::Space), Some(btn::SQUARE));
        assert_eq!(key_button(KeyCode::Tab), Some(btn::TRIANGLE));
        assert_eq!(key_button(KeyCode::KeyQ), Some(btn::L1));
        assert_eq!(key_button(KeyCode::KeyE), Some(btn::R1));
        assert_eq!(key_button(KeyCode::KeyZ), Some(btn::L2));
        assert_eq!(key_button(KeyCode::KeyC), Some(btn::R2));
        assert_eq!(key_button(KeyCode::F1), Some(btn::OPTIONS));
        assert_eq!(key_button(KeyCode::F2), Some(btn::TOUCHPAD));
        assert_eq!(key_button(KeyCode::KeyX), None);
    }

    #[test]
    fn names_resolve_to_protocol_bits() {
        for (name, bit) in pk_protocol::events::BUTTON_NAMES {
            assert_eq!(button_by_name(name), Some(bit), "{name}");
        }
        assert_eq!(button_by_name(" Down "), Some(btn::DOWN));
        assert_eq!(button_by_name("nope"), None);
    }

    #[test]
    fn keys_accumulate_and_release() {
        let mut pad = HostPad::new(false);
        pad.key(KeyCode::ArrowDown, true);
        pad.key(KeyCode::Enter, true);
        assert_eq!(pad.snapshot().buttons, btn::DOWN | btn::CROSS);
        pad.key(KeyCode::ArrowDown, false);
        assert_eq!(pad.snapshot().buttons, btn::CROSS);
        pad.release_keys();
        assert_eq!(pad.snapshot().buttons, 0);
    }

    #[test]
    fn stick_has_a_deadzone() {
        assert_eq!(stick(0.05), 0);
        assert_eq!(stick(1.0), 127);
        assert_eq!(stick(-1.0), -127);
    }
}
