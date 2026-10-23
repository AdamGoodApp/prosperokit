//! Events the engine sends to JS (`__pk_dispatch(id, type, payload)`), and the
//! subscription bitmask JS sets through the `events` prop.

use crate::props::NodeId;
use crate::value::Value;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum EventKind {
    Focus,
    Blur,
    Press,
    PressIn,
    PressOut,
    LongPress,
    Back,
    Key,
    Scroll,
    Layout,
    Change,
    Submit,
    Load,
    Error,
    AnimationEnd,
    FocusBoundary,
}

impl EventKind {
    pub const ALL: [EventKind; 16] = [
        EventKind::Focus,
        EventKind::Blur,
        EventKind::Press,
        EventKind::PressIn,
        EventKind::PressOut,
        EventKind::LongPress,
        EventKind::Back,
        EventKind::Key,
        EventKind::Scroll,
        EventKind::Layout,
        EventKind::Change,
        EventKind::Submit,
        EventKind::Load,
        EventKind::Error,
        EventKind::AnimationEnd,
        EventKind::FocusBoundary,
    ];

    /// The subscription bit (`protocol.json` `events`).
    pub fn bit(self) -> u32 {
        match self {
            EventKind::Focus => 1,
            EventKind::Blur => 2,
            EventKind::Press => 4,
            EventKind::PressIn => 8,
            EventKind::PressOut => 16,
            EventKind::LongPress => 32,
            EventKind::Back => 64,
            EventKind::Key => 128,
            EventKind::Scroll => 256,
            EventKind::Layout => 512,
            EventKind::Change => 1024,
            EventKind::Submit => 2048,
            EventKind::Load => 4096,
            EventKind::Error => 8192,
            EventKind::AnimationEnd => 16384,
            EventKind::FocusBoundary => 32768,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            EventKind::Focus => "focus",
            EventKind::Blur => "blur",
            EventKind::Press => "press",
            EventKind::PressIn => "pressIn",
            EventKind::PressOut => "pressOut",
            EventKind::LongPress => "longPress",
            EventKind::Back => "back",
            EventKind::Key => "key",
            EventKind::Scroll => "scroll",
            EventKind::Layout => "layout",
            EventKind::Change => "change",
            EventKind::Submit => "submit",
            EventKind::Load => "load",
            EventKind::Error => "error",
            EventKind::AnimationEnd => "animationEnd",
            EventKind::FocusBoundary => "focusBoundary",
        }
    }

    pub fn parse(s: &str) -> Option<EventKind> {
        EventKind::ALL.iter().copied().find(|k| k.as_str() == s)
    }

    /// Events that bubble to ancestors in JS (the engine still targets the
    /// focused node; JS walks `parentId`).
    pub fn bubbles(self) -> bool {
        matches!(self, EventKind::Back | EventKind::Key)
    }

    /// Events that are always delivered, regardless of the `events` mask
    /// (`animationEnd` carries a callback id; `focusBoundary` is informational
    /// and cheap).
    pub fn always_delivered(self) -> bool {
        matches!(self, EventKind::AnimationEnd)
    }
}

/// Pad buttons as the engine names them for `key` events.
pub const BUTTON_NAMES: [(&str, u32); 16] = [
    ("l3", 0x0002),
    ("r3", 0x0004),
    ("options", 0x0008),
    ("up", 0x0010),
    ("right", 0x0020),
    ("down", 0x0040),
    ("left", 0x0080),
    ("l2", 0x0100),
    ("r2", 0x0200),
    ("l1", 0x0400),
    ("r1", 0x0800),
    ("triangle", 0x1000),
    ("circle", 0x2000),
    ("cross", 0x4000),
    ("square", 0x8000),
    ("touchpad", 0x100000),
];

pub const BUTTON_INTERCEPTED: u32 = 0x8000_0000;

pub fn button_name(bit: u32) -> Option<&'static str> {
    BUTTON_NAMES
        .iter()
        .find(|(_, b)| *b == bit)
        .map(|(n, _)| *n)
}

pub fn button_bit(name: &str) -> Option<u32> {
    BUTTON_NAMES
        .iter()
        .find(|(n, _)| *n == name)
        .map(|(_, b)| *b)
}

/// One event for JS.
#[derive(Clone, Debug, PartialEq)]
pub struct UiEvent {
    pub target: NodeId,
    pub kind: EventKind,
    pub payload: Value,
}

impl UiEvent {
    pub fn new(target: NodeId, kind: EventKind) -> UiEvent {
        UiEvent {
            target,
            kind,
            payload: Value::Null,
        }
    }

    pub fn with_payload(target: NodeId, kind: EventKind, payload: Value) -> UiEvent {
        UiEvent {
            target,
            kind,
            payload,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bits_are_unique_powers_of_two_in_order() {
        let mut expected = 1u32;
        for k in EventKind::ALL {
            assert_eq!(k.bit(), expected, "{}", k.as_str());
            expected <<= 1;
            assert_eq!(EventKind::parse(k.as_str()), Some(k));
        }
    }

    #[test]
    fn protocol_json_matches_the_rust_constants() {
        let json: serde_json::Value = serde_json::from_str(crate::PROTOCOL_JSON).unwrap();
        for k in EventKind::ALL {
            assert_eq!(
                json["events"][k.as_str()].as_u64().unwrap() as u32,
                k.bit(),
                "{}",
                k.as_str()
            );
        }
        for (name, bit) in BUTTON_NAMES {
            assert_eq!(
                json["buttons"][name].as_u64().unwrap() as u32,
                bit,
                "{name}"
            );
        }
        assert_eq!(
            json["buttons"]["intercepted"].as_u64().unwrap() as u32,
            BUTTON_INTERCEPTED
        );
        assert_eq!(
            json["ops"]["create"].as_u64().unwrap() as u32,
            crate::ops::OP_CREATE
        );
        assert_eq!(
            json["ops"]["measure"].as_u64().unwrap() as u32,
            crate::ops::OP_MEASURE
        );
        for kind in json["kinds"].as_array().unwrap() {
            assert!(crate::ops::NodeKind::parse(kind.as_str().unwrap()).is_some());
        }
        for prop in json["animatableProps"].as_array().unwrap() {
            assert!(crate::ops::AnimProp::parse(prop.as_str().unwrap()).is_some());
        }
    }
}
