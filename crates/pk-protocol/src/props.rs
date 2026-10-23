//! Node props (Phase 4 §4): what JS attaches to a node besides its children.

use crate::color::Color;
use crate::style::{ResizeMode, Style, Transition};
use crate::value::Value;

pub type NodeId = u32;
pub const ROOT_ID: NodeId = 0;
pub const OVERLAY_ID: NodeId = 1;
pub const FIRST_USER_ID: NodeId = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Direction {
    Up,
    Down,
    Left,
    Right,
}

impl Direction {
    pub const ALL: [Direction; 4] = [
        Direction::Up,
        Direction::Down,
        Direction::Left,
        Direction::Right,
    ];
    pub fn index(self) -> usize {
        match self {
            Direction::Up => 0,
            Direction::Down => 1,
            Direction::Left => 2,
            Direction::Right => 3,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Direction::Up => "up",
            Direction::Down => "down",
            Direction::Left => "left",
            Direction::Right => "right",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct FocusScope {
    pub trap: bool,
    pub restore: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum InputKind {
    #[default]
    Text,
    Number,
    Url,
    Email,
    Password,
}

impl InputKind {
    pub fn parse(s: &str) -> Option<InputKind> {
        match s {
            "text" | "default" => Some(InputKind::Text),
            "number" | "numeric" | "decimal" => Some(InputKind::Number),
            "url" => Some(InputKind::Url),
            "email" | "email-address" => Some(InputKind::Email),
            "password" => Some(InputKind::Password),
            _ => None,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            InputKind::Text => "text",
            InputKind::Number => "number",
            InputKind::Url => "url",
            InputKind::Email => "email",
            InputKind::Password => "password",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum LineCap {
    #[default]
    Butt,
    Round,
    Square,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum LineJoin {
    #[default]
    Miter,
    Round,
    Bevel,
}

/// One SVG path of an icon. `None` fill/stroke colours mean `currentColor`.
#[derive(Clone, Debug, PartialEq)]
pub struct IconPath {
    pub d: String,
    pub fill: Option<Color>,
    pub fill_current: bool,
    pub stroke: Option<Color>,
    pub stroke_current: bool,
    pub stroke_width: f32,
    pub line_cap: LineCap,
    pub line_join: LineJoin,
}

impl IconPath {
    fn from_value(v: &Value) -> Option<IconPath> {
        let d = v.get_str("d")?.to_string();
        let (fill, fill_current) = match v.get("fill") {
            None | Some(Value::Null) => (None, false),
            Some(Value::Str(s)) if s == "none" => (None, false),
            Some(Value::Str(s)) if s == "currentColor" => (None, true),
            Some(c) => (Color::from_value(c), false),
        };
        let (stroke, stroke_current) = match v.get("stroke") {
            None | Some(Value::Null) => (None, false),
            Some(Value::Str(s)) if s == "none" => (None, false),
            Some(Value::Str(s)) if s == "currentColor" => (None, true),
            Some(c) => (Color::from_value(c), false),
        };
        let line_cap = match v.get_str("lineCap") {
            Some("round") => LineCap::Round,
            Some("square") => LineCap::Square,
            _ => LineCap::Butt,
        };
        let line_join = match v.get_str("lineJoin") {
            Some("round") => LineJoin::Round,
            Some("bevel") => LineJoin::Bevel,
            _ => LineJoin::Miter,
        };
        Some(IconPath {
            d,
            fill,
            fill_current,
            stroke,
            stroke_current,
            stroke_width: v.get_f64("strokeWidth").unwrap_or(0.0) as f32,
            line_cap,
            line_join,
        })
    }
}

/// A single typed prop value.
#[derive(Clone, Debug, PartialEq)]
pub enum Prop {
    Style(Style),
    StyleFocus(Style),
    StyleActive(Style),
    StyleDisabled(Style),
    Classes(Vec<u32>),
    Focusable(bool),
    AutoFocus(bool),
    Disabled(bool),
    FocusScope(FocusScope),
    NextFocus(Direction, NodeId),
    Events(u32),
    TestId(String),
    Src(String),
    ResizeMode(ResizeMode),
    NumberOfLines(u32),
    Horizontal(bool),
    Value(String),
    Placeholder(String),
    InputKind(InputKind),
    MaxLength(u32),
    Secure(bool),
    Transition(Transition),
    ViewBox(f32, f32),
    Paths(Vec<IconPath>),
    Size(f32),
    Color(Color),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum PropKey {
    Style,
    StyleFocus,
    StyleActive,
    StyleDisabled,
    Classes,
    Focusable,
    AutoFocus,
    Disabled,
    FocusScope,
    NextFocus(Direction),
    Events,
    TestId,
    Src,
    ResizeMode,
    NumberOfLines,
    Horizontal,
    Value,
    Placeholder,
    InputKind,
    MaxLength,
    Secure,
    Transition,
    ViewBox,
    Paths,
    Size,
    Color,
}

impl PropKey {
    pub fn parse(key: &str) -> Option<PropKey> {
        Some(match key {
            "style" => PropKey::Style,
            "styleFocus" => PropKey::StyleFocus,
            "styleActive" => PropKey::StyleActive,
            "styleDisabled" => PropKey::StyleDisabled,
            "classes" => PropKey::Classes,
            "focusable" => PropKey::Focusable,
            "autoFocus" => PropKey::AutoFocus,
            "disabled" => PropKey::Disabled,
            "focusScope" => PropKey::FocusScope,
            "nextFocusUp" => PropKey::NextFocus(Direction::Up),
            "nextFocusDown" => PropKey::NextFocus(Direction::Down),
            "nextFocusLeft" => PropKey::NextFocus(Direction::Left),
            "nextFocusRight" => PropKey::NextFocus(Direction::Right),
            "events" => PropKey::Events,
            "testID" => PropKey::TestId,
            "src" => PropKey::Src,
            "resizeMode" => PropKey::ResizeMode,
            "numberOfLines" => PropKey::NumberOfLines,
            "horizontal" => PropKey::Horizontal,
            "value" => PropKey::Value,
            "placeholder" => PropKey::Placeholder,
            "inputKind" => PropKey::InputKind,
            "maxLength" => PropKey::MaxLength,
            "secure" => PropKey::Secure,
            "transition" => PropKey::Transition,
            "viewBox" => PropKey::ViewBox,
            "paths" => PropKey::Paths,
            "size" => PropKey::Size,
            "color" => PropKey::Color,
            _ => return None,
        })
    }

    pub fn of(prop: &Prop) -> PropKey {
        match prop {
            Prop::Style(_) => PropKey::Style,
            Prop::StyleFocus(_) => PropKey::StyleFocus,
            Prop::StyleActive(_) => PropKey::StyleActive,
            Prop::StyleDisabled(_) => PropKey::StyleDisabled,
            Prop::Classes(_) => PropKey::Classes,
            Prop::Focusable(_) => PropKey::Focusable,
            Prop::AutoFocus(_) => PropKey::AutoFocus,
            Prop::Disabled(_) => PropKey::Disabled,
            Prop::FocusScope(_) => PropKey::FocusScope,
            Prop::NextFocus(d, _) => PropKey::NextFocus(*d),
            Prop::Events(_) => PropKey::Events,
            Prop::TestId(_) => PropKey::TestId,
            Prop::Src(_) => PropKey::Src,
            Prop::ResizeMode(_) => PropKey::ResizeMode,
            Prop::NumberOfLines(_) => PropKey::NumberOfLines,
            Prop::Horizontal(_) => PropKey::Horizontal,
            Prop::Value(_) => PropKey::Value,
            Prop::Placeholder(_) => PropKey::Placeholder,
            Prop::InputKind(_) => PropKey::InputKind,
            Prop::MaxLength(_) => PropKey::MaxLength,
            Prop::Secure(_) => PropKey::Secure,
            Prop::Transition(_) => PropKey::Transition,
            Prop::ViewBox(_, _) => PropKey::ViewBox,
            Prop::Paths(_) => PropKey::Paths,
            Prop::Size(_) => PropKey::Size,
            Prop::Color(_) => PropKey::Color,
        }
    }
}

/// A prop change: set a value or remove the key (JS sends `null`).
///
/// `Set` is large (a `Prop` can hold a full `Style`) and `Remove` is small;
/// updates live only for one commit, so boxing would add an allocation per
/// prop for no benefit.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, PartialEq)]
pub enum PropUpdate {
    Set(Prop),
    Remove(PropKey),
}

/// Result of parsing a props object: the updates plus the keys that were not
/// recognised (or whose value had the wrong shape) and the style keys the
/// style parser rejected.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PropsParse {
    pub updates: Vec<PropUpdate>,
    pub unknown: Vec<String>,
}

fn parse_prop(key: PropKey, val: &Value) -> Result<Prop, ()> {
    fn style(v: &Value) -> Result<Style, ()> {
        let p = Style::parse(v);
        if v.as_obj().is_none() {
            Err(())
        } else {
            Ok(p.style)
        }
    }
    fn string(v: &Value) -> Result<String, ()> {
        v.as_str().map(str::to_string).ok_or(())
    }
    fn boolean(v: &Value) -> Result<bool, ()> {
        v.as_bool().ok_or(())
    }
    fn num(v: &Value) -> Result<f32, ()> {
        v.as_f64().map(|n| n as f32).ok_or(())
    }
    Ok(match key {
        PropKey::Style => Prop::Style(style(val)?),
        PropKey::StyleFocus => Prop::StyleFocus(style(val)?),
        PropKey::StyleActive => Prop::StyleActive(style(val)?),
        PropKey::StyleDisabled => Prop::StyleDisabled(style(val)?),
        PropKey::Classes => Prop::Classes(
            val.as_arr()
                .ok_or(())?
                .iter()
                .map(|x| x.as_u32().ok_or(()))
                .collect::<Result<_, _>>()?,
        ),
        PropKey::Focusable => Prop::Focusable(boolean(val)?),
        PropKey::AutoFocus => Prop::AutoFocus(boolean(val)?),
        PropKey::Disabled => Prop::Disabled(boolean(val)?),
        PropKey::FocusScope => match val {
            Value::Bool(b) => Prop::FocusScope(FocusScope {
                trap: *b,
                restore: *b,
            }),
            Value::Obj(_) => Prop::FocusScope(FocusScope {
                trap: val.get_bool("trap").unwrap_or(false),
                restore: val.get_bool("restore").unwrap_or(false),
            }),
            _ => return Err(()),
        },
        PropKey::NextFocus(d) => Prop::NextFocus(d, val.as_u32().ok_or(())?),
        PropKey::Events => Prop::Events(val.as_u32().ok_or(())?),
        PropKey::TestId => Prop::TestId(string(val)?),
        PropKey::Src => Prop::Src(string(val)?),
        PropKey::ResizeMode => {
            Prop::ResizeMode(val.as_str().and_then(ResizeMode::parse).ok_or(())?)
        }
        PropKey::NumberOfLines => Prop::NumberOfLines(val.as_u32().ok_or(())?),
        PropKey::Horizontal => Prop::Horizontal(boolean(val)?),
        PropKey::Value => Prop::Value(match val {
            Value::Num(n) => n.to_string(),
            other => string(other)?,
        }),
        PropKey::Placeholder => Prop::Placeholder(string(val)?),
        PropKey::InputKind => Prop::InputKind(val.as_str().and_then(InputKind::parse).ok_or(())?),
        PropKey::MaxLength => Prop::MaxLength(val.as_u32().ok_or(())?.clamp(1, 512)),
        PropKey::Secure => Prop::Secure(boolean(val)?),
        PropKey::Transition => Prop::Transition(Transition::from_value(val).ok_or(())?),
        PropKey::ViewBox => {
            let a = val.as_arr().ok_or(())?;
            if a.len() == 2 {
                Prop::ViewBox(num(&a[0])?, num(&a[1])?)
            } else if a.len() == 4 {
                Prop::ViewBox(num(&a[2])?, num(&a[3])?)
            } else {
                return Err(());
            }
        }
        PropKey::Paths => Prop::Paths(
            val.as_arr()
                .ok_or(())?
                .iter()
                .map(|p| IconPath::from_value(p).ok_or(()))
                .collect::<Result<_, _>>()?,
        ),
        PropKey::Size => Prop::Size(num(val)?),
        PropKey::Color => Prop::Color(Color::from_value(val).ok_or(())?),
    })
}

/// Parse a props object (create) or a props diff (update): a `null` value
/// removes the prop.
pub fn parse_props(v: &Value) -> PropsParse {
    let mut out = PropsParse::default();
    let Some(entries) = v.as_obj() else {
        if !v.is_null() {
            out.unknown.push("<props not an object>".into());
        }
        return out;
    };
    for (key, val) in entries {
        let Some(k) = PropKey::parse(key) else {
            out.unknown.push(key.clone());
            continue;
        };
        if val.is_null() {
            out.updates.push(PropUpdate::Remove(k));
            continue;
        }
        match parse_prop(k, val) {
            Ok(p) => out.updates.push(PropUpdate::Set(p)),
            Err(()) => out.unknown.push(key.clone()),
        }
    }
    out
}

/// The stored props of a node, with every prop at its default.
#[derive(Clone, Debug, PartialEq)]
pub struct Props {
    pub style: Style,
    pub style_focus: Style,
    pub style_active: Style,
    pub style_disabled: Style,
    pub classes: Vec<u32>,
    pub focusable: bool,
    pub auto_focus: bool,
    pub disabled: bool,
    pub focus_scope: Option<FocusScope>,
    pub next_focus: [Option<NodeId>; 4],
    pub events: u32,
    pub test_id: Option<String>,
    pub src: Option<String>,
    pub resize_mode: ResizeMode,
    pub number_of_lines: u32,
    pub horizontal: bool,
    pub value: String,
    pub placeholder: String,
    pub input_kind: InputKind,
    pub max_length: u32,
    pub secure: bool,
    pub transition: Option<Transition>,
    pub view_box: (f32, f32),
    pub paths: Vec<IconPath>,
    pub size: f32,
    pub color: Option<Color>,
}

impl Default for Props {
    fn default() -> Self {
        Props {
            style: Style::default(),
            style_focus: Style::default(),
            style_active: Style::default(),
            style_disabled: Style::default(),
            classes: Vec::new(),
            focusable: false,
            auto_focus: false,
            disabled: false,
            focus_scope: None,
            next_focus: [None; 4],
            events: 0,
            test_id: None,
            src: None,
            resize_mode: ResizeMode::Cover,
            number_of_lines: 0,
            horizontal: false,
            value: String::new(),
            placeholder: String::new(),
            input_kind: InputKind::Text,
            max_length: 512,
            secure: false,
            transition: None,
            view_box: (24.0, 24.0),
            paths: Vec::new(),
            size: 32.0,
            color: None,
        }
    }
}

impl Props {
    pub fn apply(&mut self, update: &PropUpdate) {
        match update {
            PropUpdate::Set(p) => match p {
                Prop::Style(s) => self.style = s.clone(),
                Prop::StyleFocus(s) => self.style_focus = s.clone(),
                Prop::StyleActive(s) => self.style_active = s.clone(),
                Prop::StyleDisabled(s) => self.style_disabled = s.clone(),
                Prop::Classes(c) => self.classes = c.clone(),
                Prop::Focusable(b) => self.focusable = *b,
                Prop::AutoFocus(b) => self.auto_focus = *b,
                Prop::Disabled(b) => self.disabled = *b,
                Prop::FocusScope(f) => self.focus_scope = Some(*f),
                Prop::NextFocus(d, id) => self.next_focus[d.index()] = Some(*id),
                Prop::Events(e) => self.events = *e,
                Prop::TestId(s) => self.test_id = Some(s.clone()),
                Prop::Src(s) => self.src = Some(s.clone()),
                Prop::ResizeMode(m) => self.resize_mode = *m,
                Prop::NumberOfLines(n) => self.number_of_lines = *n,
                Prop::Horizontal(b) => self.horizontal = *b,
                Prop::Value(s) => self.value = s.clone(),
                Prop::Placeholder(s) => self.placeholder = s.clone(),
                Prop::InputKind(k) => self.input_kind = *k,
                Prop::MaxLength(n) => self.max_length = *n,
                Prop::Secure(b) => self.secure = *b,
                Prop::Transition(t) => self.transition = Some(t.clone()),
                Prop::ViewBox(w, h) => self.view_box = (*w, *h),
                Prop::Paths(p) => self.paths = p.clone(),
                Prop::Size(s) => self.size = *s,
                Prop::Color(c) => self.color = Some(*c),
            },
            PropUpdate::Remove(k) => match k {
                PropKey::Style => self.style = Style::default(),
                PropKey::StyleFocus => self.style_focus = Style::default(),
                PropKey::StyleActive => self.style_active = Style::default(),
                PropKey::StyleDisabled => self.style_disabled = Style::default(),
                PropKey::Classes => self.classes.clear(),
                PropKey::Focusable => self.focusable = false,
                PropKey::AutoFocus => self.auto_focus = false,
                PropKey::Disabled => self.disabled = false,
                PropKey::FocusScope => self.focus_scope = None,
                PropKey::NextFocus(d) => self.next_focus[d.index()] = None,
                PropKey::Events => self.events = 0,
                PropKey::TestId => self.test_id = None,
                PropKey::Src => self.src = None,
                PropKey::ResizeMode => self.resize_mode = ResizeMode::Cover,
                PropKey::NumberOfLines => self.number_of_lines = 0,
                PropKey::Horizontal => self.horizontal = false,
                PropKey::Value => self.value.clear(),
                PropKey::Placeholder => self.placeholder.clear(),
                PropKey::InputKind => self.input_kind = InputKind::Text,
                PropKey::MaxLength => self.max_length = 512,
                PropKey::Secure => self.secure = false,
                PropKey::Transition => self.transition = None,
                PropKey::ViewBox => self.view_box = (24.0, 24.0),
                PropKey::Paths => self.paths.clear(),
                PropKey::Size => self.size = 32.0,
                PropKey::Color => self.color = None,
            },
        }
    }

    pub fn subscribed(&self, bit: u32) -> bool {
        self.events & bit != 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(json: &str) -> Value {
        Value::from_json(&serde_json::from_str(json).unwrap())
    }

    #[test]
    fn parses_props_and_removals() {
        let p = parse_props(&v(
            r#"{"focusable":true,"events":5,"classes":[1,2],"nextFocusDown":7,
            "style":{"padding":4},"transition":{"duration":200},"focusScope":{"trap":true},
            "value":null,"bogus":1,"maxLength":9999,"paths":[{"d":"M0 0h24v24H0z","fill":"currentColor"}]}"#,
        ));
        assert_eq!(p.unknown, vec!["bogus".to_string()]);
        let mut props = Props::default();
        for u in &p.updates {
            props.apply(u);
        }
        assert!(props.focusable);
        assert_eq!(props.events, 5);
        assert_eq!(props.classes, vec![1, 2]);
        assert_eq!(props.next_focus[Direction::Down.index()], Some(7));
        assert_eq!(props.style.padding.top, Some(crate::style::Length::Px(4.0)));
        assert_eq!(props.transition.as_ref().unwrap().duration_ms, 200.0);
        assert_eq!(
            props.focus_scope,
            Some(FocusScope {
                trap: true,
                restore: false
            })
        );
        assert_eq!(props.max_length, 512);
        assert!(props.paths[0].fill_current);
        assert!(p.updates.contains(&PropUpdate::Remove(PropKey::Value)));
    }
}
