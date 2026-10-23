//! The style model (Phase 3 §2): exactly the properties the engine supports,
//! parsed from React-Native-shaped JS objects. Every field is optional so a
//! style can be merged over another (`merge`: the right-hand side wins per
//! property).

use crate::color::Color;
use crate::value::Value;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Length {
    Px(f32),
    Percent(f32),
    Auto,
}

impl Length {
    pub fn px(self) -> Option<f32> {
        match self {
            Length::Px(v) => Some(v),
            _ => None,
        }
    }

    fn from_value(v: &Value) -> Option<Length> {
        match v {
            Value::Num(n) => Some(Length::Px(*n as f32)),
            Value::Str(s) => {
                let s = s.trim();
                if s == "auto" {
                    Some(Length::Auto)
                } else if let Some(p) = s.strip_suffix('%') {
                    p.trim().parse::<f32>().ok().map(Length::Percent)
                } else if let Some(p) = s.strip_suffix("px") {
                    p.trim().parse::<f32>().ok().map(Length::Px)
                } else {
                    s.parse::<f32>().ok().map(Length::Px)
                }
            }
            _ => None,
        }
    }
}

macro_rules! str_enum {
    ($name:ident { $($variant:ident = $text:literal),+ $(,)? }) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
        pub enum $name { $($variant),+ }
        impl $name {
            pub fn parse(text: &str) -> Option<Self> {
                match text { $($text => Some(Self::$variant),)+ _ => None }
            }
            pub fn as_str(self) -> &'static str {
                match self { $(Self::$variant => $text,)+ }
            }
        }
    };
}

str_enum!(Display { Flex = "flex", Grid = "grid", None = "none" });
str_enum!(Position { Relative = "relative", Absolute = "absolute" });
str_enum!(FlexDirection { Row = "row", Column = "column", RowReverse = "row-reverse", ColumnReverse = "column-reverse" });
str_enum!(FlexWrap { NoWrap = "nowrap", Wrap = "wrap", WrapReverse = "wrap-reverse" });
str_enum!(JustifyContent {
    FlexStart = "flex-start",
    FlexEnd = "flex-end",
    Center = "center",
    SpaceBetween = "space-between",
    SpaceAround = "space-around",
    SpaceEvenly = "space-evenly",
    Start = "start",
    End = "end",
});
str_enum!(AlignItems {
    FlexStart = "flex-start",
    FlexEnd = "flex-end",
    Center = "center",
    Stretch = "stretch",
    Baseline = "baseline",
    Start = "start",
    End = "end",
});
str_enum!(AlignContent {
    FlexStart = "flex-start",
    FlexEnd = "flex-end",
    Center = "center",
    Stretch = "stretch",
    SpaceBetween = "space-between",
    SpaceAround = "space-around",
    SpaceEvenly = "space-evenly",
    Start = "start",
    End = "end",
});
str_enum!(AlignSelf {
    Auto = "auto",
    FlexStart = "flex-start",
    FlexEnd = "flex-end",
    Center = "center",
    Stretch = "stretch",
    Baseline = "baseline",
    Start = "start",
    End = "end",
});
str_enum!(Overflow { Visible = "visible", Hidden = "hidden", Scroll = "scroll" });
str_enum!(TextAlign { Left = "left", Center = "center", Right = "right", Justify = "justify", Auto = "auto" });
str_enum!(TextTransform { None = "none", Uppercase = "uppercase", Lowercase = "lowercase", Capitalize = "capitalize" });
str_enum!(FontStyle { Normal = "normal", Italic = "italic" });
str_enum!(ResizeMode { Cover = "cover", Contain = "contain", Stretch = "stretch", Center = "center" });

/// One grid track: `px`, `fr` or `auto`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum GridTrack {
    Px(f32),
    Fr(f32),
    Auto,
}

impl GridTrack {
    fn from_value(v: &Value) -> Option<GridTrack> {
        match v {
            Value::Num(n) => Some(GridTrack::Px(*n as f32)),
            Value::Str(s) => {
                let s = s.trim();
                if s == "auto" {
                    Some(GridTrack::Auto)
                } else if let Some(f) = s.strip_suffix("fr") {
                    f.trim().parse::<f32>().ok().map(GridTrack::Fr)
                } else if let Some(p) = s.strip_suffix("px") {
                    p.trim().parse::<f32>().ok().map(GridTrack::Px)
                } else {
                    s.parse::<f32>().ok().map(GridTrack::Px)
                }
            }
            _ => None,
        }
    }

    fn list_from_value(v: &Value) -> Option<Vec<GridTrack>> {
        match v {
            Value::Arr(items) => items.iter().map(GridTrack::from_value).collect(),
            Value::Str(s) => s
                .split_whitespace()
                .map(|t| GridTrack::from_value(&Value::Str(t.into())))
                .collect(),
            Value::Num(_) => GridTrack::from_value(v).map(|t| vec![t]),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Gradient {
    pub angle_deg: f32,
    pub stops: Vec<(f32, Color)>,
}

impl Gradient {
    fn from_value(v: &Value) -> Option<Gradient> {
        let angle_deg = v.get_f64("angle").unwrap_or(180.0) as f32;
        let stops_v = v.get("stops")?.as_arr()?;
        let mut stops = Vec::with_capacity(stops_v.len());
        for (i, stop) in stops_v.iter().enumerate() {
            let (offset, color) = match stop {
                Value::Arr(pair) if pair.len() == 2 => {
                    (pair[0].as_f64()? as f32, Color::from_value(&pair[1])?)
                }
                Value::Obj(_) => (
                    stop.get_f64("offset")
                        .map(|o| o as f32)
                        .unwrap_or(if stops_v.len() > 1 {
                            i as f32 / (stops_v.len() - 1) as f32
                        } else {
                            0.0
                        }),
                    Color::from_value(stop.get("color")?)?,
                ),
                other => (
                    if stops_v.len() > 1 {
                        i as f32 / (stops_v.len() - 1) as f32
                    } else {
                        0.0
                    },
                    Color::from_value(other)?,
                ),
            };
            stops.push((offset, color));
        }
        if stops.is_empty() {
            return None;
        }
        Some(Gradient { angle_deg, stops })
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Transform {
    TranslateX(f32),
    TranslateY(f32),
    Scale(f32),
    ScaleX(f32),
    ScaleY(f32),
    /// Degrees, clockwise.
    Rotate(f32),
}

impl Transform {
    fn list_from_value(v: &Value) -> Option<Vec<Transform>> {
        let items = v.as_arr()?;
        let mut out = Vec::with_capacity(items.len());
        for item in items {
            let entries = item.as_obj()?;
            for (key, val) in entries {
                let t = match key.as_str() {
                    "translateX" => Transform::TranslateX(val.as_f64()? as f32),
                    "translateY" => Transform::TranslateY(val.as_f64()? as f32),
                    "scale" => Transform::Scale(val.as_f64()? as f32),
                    "scaleX" => Transform::ScaleX(val.as_f64()? as f32),
                    "scaleY" => Transform::ScaleY(val.as_f64()? as f32),
                    "rotate" | "rotateZ" => Transform::Rotate(parse_angle(val)?),
                    _ => return None,
                };
                out.push(t);
            }
        }
        Some(out)
    }
}

fn parse_angle(v: &Value) -> Option<f32> {
    match v {
        Value::Num(n) => Some(*n as f32),
        Value::Str(s) => {
            let s = s.trim();
            if let Some(d) = s.strip_suffix("deg") {
                d.trim().parse().ok()
            } else if let Some(r) = s.strip_suffix("rad") {
                r.trim().parse::<f32>().ok().map(|r| r.to_degrees())
            } else if let Some(t) = s.strip_suffix("turn") {
                t.trim().parse::<f32>().ok().map(|t| t * 360.0)
            } else {
                s.parse().ok()
            }
        }
        _ => None,
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Easing {
    Linear,
    Ease,
    EaseIn,
    EaseOut,
    EaseInOut,
    CubicBezier(f32, f32, f32, f32),
}

impl Easing {
    pub fn parse(v: &Value) -> Option<Easing> {
        match v {
            Value::Str(s) => match s.trim() {
                "linear" => Some(Easing::Linear),
                "ease" => Some(Easing::Ease),
                "ease-in" | "easeIn" => Some(Easing::EaseIn),
                "ease-out" | "easeOut" => Some(Easing::EaseOut),
                "ease-in-out" | "easeInOut" => Some(Easing::EaseInOut),
                other => {
                    let inner = other.strip_prefix("cubic-bezier(")?.strip_suffix(')')?;
                    let p: Vec<f32> = inner
                        .split(',')
                        .map(|x| x.trim().parse::<f32>())
                        .collect::<Result<_, _>>()
                        .ok()?;
                    if p.len() == 4 {
                        Some(Easing::CubicBezier(p[0], p[1], p[2], p[3]))
                    } else {
                        None
                    }
                }
            },
            Value::Arr(a) if a.len() == 4 => Some(Easing::CubicBezier(
                a[0].as_f64()? as f32,
                a[1].as_f64()? as f32,
                a[2].as_f64()? as f32,
                a[3].as_f64()? as f32,
            )),
            _ => None,
        }
    }

    /// The control points of the equivalent cubic Bézier (CSS definitions).
    pub fn bezier(self) -> (f32, f32, f32, f32) {
        match self {
            Easing::Linear => (0.0, 0.0, 1.0, 1.0),
            Easing::Ease => (0.25, 0.1, 0.25, 1.0),
            Easing::EaseIn => (0.42, 0.0, 1.0, 1.0),
            Easing::EaseOut => (0.0, 0.0, 0.58, 1.0),
            Easing::EaseInOut => (0.42, 0.0, 0.58, 1.0),
            Easing::CubicBezier(a, b, c, d) => (a, b, c, d),
        }
    }

    /// Progress 0..1 → eased 0..1, sampled like CSS (solve x(t) = p for t).
    pub fn apply(self, p: f32) -> f32 {
        let p = p.clamp(0.0, 1.0);
        if matches!(self, Easing::Linear) {
            return p;
        }
        let (x1, y1, x2, y2) = self.bezier();
        let sample = |a1: f32, a2: f32, t: f32| {
            ((1.0 - 3.0 * a2 + 3.0 * a1) * t + (3.0 * a2 - 6.0 * a1)) * t * t + 3.0 * a1 * t
        };
        // Newton-Raphson then bisection fallback.
        let mut t = p;
        for _ in 0..8 {
            let x = sample(x1, x2, t) - p;
            let dx = 3.0 * (1.0 - 3.0 * x2 + 3.0 * x1) * t * t
                + 2.0 * (3.0 * x2 - 6.0 * x1) * t
                + 3.0 * x1;
            if dx.abs() < 1e-6 {
                break;
            }
            let nt = t - x / dx;
            if (nt - t).abs() < 1e-6 {
                t = nt;
                break;
            }
            t = nt.clamp(0.0, 1.0);
        }
        if (sample(x1, x2, t) - p).abs() > 1e-4 {
            let (mut lo, mut hi) = (0.0f32, 1.0f32);
            for _ in 0..32 {
                t = (lo + hi) / 2.0;
                if sample(x1, x2, t) < p {
                    lo = t
                } else {
                    hi = t
                }
            }
        }
        sample(y1, y2, t)
    }
}

/// Which properties a `Transition` applies to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TransitionProps {
    All,
    Named(Vec<String>),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Transition {
    pub props: TransitionProps,
    pub duration_ms: f32,
    pub delay_ms: f32,
    pub easing: Easing,
}

impl Default for Transition {
    fn default() -> Self {
        Transition {
            props: TransitionProps::All,
            duration_ms: 150.0,
            delay_ms: 0.0,
            easing: Easing::Ease,
        }
    }
}

impl Transition {
    pub fn from_value(v: &Value) -> Option<Transition> {
        match v {
            Value::Bool(true) => Some(Transition::default()),
            Value::Num(n) => Some(Transition {
                duration_ms: *n as f32,
                ..Transition::default()
            }),
            Value::Obj(_) => {
                let props = match v.get("props") {
                    None => TransitionProps::All,
                    Some(Value::Str(s)) if s == "all" => TransitionProps::All,
                    Some(Value::Str(s)) => {
                        TransitionProps::Named(s.split(',').map(|p| p.trim().to_string()).collect())
                    }
                    Some(Value::Arr(a)) => {
                        let names: Vec<String> = a
                            .iter()
                            .filter_map(|x| x.as_str().map(str::to_string))
                            .collect();
                        if names.iter().any(|n| n == "all") {
                            TransitionProps::All
                        } else {
                            TransitionProps::Named(names)
                        }
                    }
                    _ => return None,
                };
                Some(Transition {
                    props,
                    duration_ms: v.get_f64("duration").unwrap_or(150.0) as f32,
                    delay_ms: v.get_f64("delay").unwrap_or(0.0) as f32,
                    easing: v
                        .get("easing")
                        .and_then(Easing::parse)
                        .unwrap_or(Easing::Ease),
                })
            }
            _ => None,
        }
    }

    pub fn applies_to(&self, prop: &str) -> bool {
        match &self.props {
            TransitionProps::All => true,
            TransitionProps::Named(names) => names.iter().any(|n| {
                n == prop
                    || (n == "transform" && is_transform_prop(prop))
                    || (n == "colors" && is_color_prop(prop))
            }),
        }
    }
}

pub fn is_transform_prop(prop: &str) -> bool {
    matches!(
        prop,
        "translateX" | "translateY" | "scale" | "scaleX" | "scaleY" | "rotate"
    )
}

pub fn is_color_prop(prop: &str) -> bool {
    matches!(
        prop,
        "backgroundColor" | "borderColor" | "color" | "outlineColor" | "tintColor"
    )
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sides<T: Copy> {
    pub top: Option<T>,
    pub right: Option<T>,
    pub bottom: Option<T>,
    pub left: Option<T>,
}

impl<T: Copy> Default for Sides<T> {
    fn default() -> Self {
        Sides {
            top: None,
            right: None,
            bottom: None,
            left: None,
        }
    }
}

impl<T: Copy> Sides<T> {
    pub fn all(v: T) -> Self {
        Sides {
            top: Some(v),
            right: Some(v),
            bottom: Some(v),
            left: Some(v),
        }
    }
    fn merge(self, other: Self) -> Self {
        Sides {
            top: other.top.or(self.top),
            right: other.right.or(self.right),
            bottom: other.bottom.or(self.bottom),
            left: other.left.or(self.left),
        }
    }
    pub fn is_empty(&self) -> bool {
        self.top.is_none() && self.right.is_none() && self.bottom.is_none() && self.left.is_none()
    }
}

/// Corner radii: top-left, top-right, bottom-right, bottom-left.
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct Corners {
    pub tl: Option<f32>,
    pub tr: Option<f32>,
    pub br: Option<f32>,
    pub bl: Option<f32>,
}

impl Corners {
    fn merge(self, other: Self) -> Self {
        Corners {
            tl: other.tl.or(self.tl),
            tr: other.tr.or(self.tr),
            br: other.br.or(self.br),
            bl: other.bl.or(self.bl),
        }
    }
    pub fn resolved(&self) -> [f32; 4] {
        [
            self.tl.unwrap_or(0.0),
            self.tr.unwrap_or(0.0),
            self.br.unwrap_or(0.0),
            self.bl.unwrap_or(0.0),
        ]
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct Shadow {
    pub color: Option<Color>,
    pub offset: Option<(f32, f32)>,
    pub opacity: Option<f32>,
    pub radius: Option<f32>,
}

impl Shadow {
    fn merge(self, other: Self) -> Self {
        Shadow {
            color: other.color.or(self.color),
            offset: other.offset.or(self.offset),
            opacity: other.opacity.or(self.opacity),
            radius: other.radius.or(self.radius),
        }
    }
    pub fn is_empty(&self) -> bool {
        self.color.is_none()
            && self.offset.is_none()
            && self.opacity.is_none()
            && self.radius.is_none()
    }
}

/// Every supported style property (all optional). Unknown keys are reported
/// through [`StyleParse::unknown`] so the Vite preset can reject them at build
/// time and the engine can ignore them at run time.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Style {
    // layout
    pub display: Option<Display>,
    pub position: Option<Position>,
    pub inset: Sides<Length>,
    pub width: Option<Length>,
    pub height: Option<Length>,
    pub min_width: Option<Length>,
    pub min_height: Option<Length>,
    pub max_width: Option<Length>,
    pub max_height: Option<Length>,
    pub margin: Sides<Length>,
    pub padding: Sides<Length>,
    pub flex_direction: Option<FlexDirection>,
    pub flex_wrap: Option<FlexWrap>,
    pub justify_content: Option<JustifyContent>,
    pub align_items: Option<AlignItems>,
    pub align_self: Option<AlignSelf>,
    pub align_content: Option<AlignContent>,
    pub flex_grow: Option<f32>,
    pub flex_shrink: Option<f32>,
    pub flex_basis: Option<Length>,
    pub row_gap: Option<f32>,
    pub column_gap: Option<f32>,
    pub aspect_ratio: Option<f32>,
    pub overflow: Option<Overflow>,
    pub grid_template_columns: Option<Vec<GridTrack>>,
    pub grid_template_rows: Option<Vec<GridTrack>>,
    pub grid_column_start: Option<i16>,
    pub grid_column_end: Option<i16>,
    pub grid_row_start: Option<i16>,
    pub grid_row_end: Option<i16>,
    // visual
    pub background_color: Option<Color>,
    pub background_gradient: Option<Gradient>,
    pub opacity: Option<f32>,
    pub border_radius: Corners,
    pub border_width: Sides<f32>,
    pub border_color: Sides<Color>,
    pub outline_width: Option<f32>,
    pub outline_color: Option<Color>,
    pub outline_offset: Option<f32>,
    pub transform: Option<Vec<Transform>>,
    pub shadow: Shadow,
    pub z_index: Option<i32>,
    // text
    pub color: Option<Color>,
    pub font_size: Option<f32>,
    pub font_weight: Option<u16>,
    pub font_family: Option<String>,
    pub font_style: Option<FontStyle>,
    pub line_height: Option<f32>,
    pub letter_spacing: Option<f32>,
    pub text_align: Option<TextAlign>,
    pub text_transform: Option<TextTransform>,
    // image
    pub resize_mode: Option<ResizeMode>,
    pub tint_color: Option<Color>,
}

/// Result of parsing a style object: the style plus the keys that were not
/// recognised (or had an unusable value).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct StyleParse {
    pub style: Style,
    pub unknown: Vec<String>,
}

fn weight_from_value(v: &Value) -> Option<u16> {
    match v {
        Value::Num(n) => Some((*n as i32).clamp(100, 900) as u16),
        Value::Str(s) => match s.trim() {
            "normal" | "regular" => Some(400),
            "bold" => Some(700),
            "thin" => Some(100),
            "extralight" | "ultralight" => Some(200),
            "light" => Some(300),
            "medium" => Some(500),
            "semibold" => Some(600),
            "extrabold" | "ultrabold" => Some(800),
            "black" | "heavy" => Some(900),
            other => other.parse::<i32>().ok().map(|n| n.clamp(100, 900) as u16),
        },
        _ => None,
    }
}

fn f32_from_value(v: &Value) -> Option<f32> {
    v.as_f64().map(|n| n as f32)
}

impl Style {
    /// Parse a JS style object. Keys use the React Native names; shorthand
    /// keys (`margin`, `paddingHorizontal`, …) expand to their sides.
    pub fn parse(v: &Value) -> StyleParse {
        let mut out = StyleParse::default();
        let Some(entries) = v.as_obj() else {
            if !v.is_null() {
                out.unknown.push("<not an object>".into());
            }
            return out;
        };
        let s = &mut out.style;
        for (key, val) in entries {
            if val.is_null() {
                continue; // `null` = "unset" in a style object
            }
            let ok = s.set(key, val);
            if !ok {
                out.unknown.push(key.clone());
            }
        }
        out
    }

    /// Set one property from its JS value. Returns false if the key or value
    /// is not understood.
    pub fn set(&mut self, key: &str, val: &Value) -> bool {
        macro_rules! len {
            ($field:expr) => {{
                match Length::from_value(val) {
                    Some(l) => {
                        $field = Some(l);
                        true
                    }
                    None => false,
                }
            }};
        }
        macro_rules! num {
            ($field:expr) => {{
                match f32_from_value(val) {
                    Some(n) => {
                        $field = Some(n);
                        true
                    }
                    None => false,
                }
            }};
        }
        macro_rules! color {
            ($field:expr) => {{
                match Color::from_value(val) {
                    Some(c) => {
                        $field = Some(c);
                        true
                    }
                    None => false,
                }
            }};
        }
        macro_rules! enm {
            ($field:expr, $ty:ty) => {{
                match val.as_str().and_then(<$ty>::parse) {
                    Some(e) => {
                        $field = Some(e);
                        true
                    }
                    None => false,
                }
            }};
        }
        match key {
            "display" => enm!(self.display, Display),
            "position" => enm!(self.position, Position),
            "top" => len!(self.inset.top),
            "right" => len!(self.inset.right),
            "bottom" => len!(self.inset.bottom),
            "left" => len!(self.inset.left),
            "inset" => match Length::from_value(val) {
                Some(l) => {
                    self.inset = Sides::all(l);
                    true
                }
                None => false,
            },
            "width" => len!(self.width),
            "height" => len!(self.height),
            "minWidth" => len!(self.min_width),
            "minHeight" => len!(self.min_height),
            "maxWidth" => len!(self.max_width),
            "maxHeight" => len!(self.max_height),
            "margin" => match Length::from_value(val) {
                Some(l) => {
                    self.margin = Sides::all(l);
                    true
                }
                None => false,
            },
            "marginTop" => len!(self.margin.top),
            "marginRight" => len!(self.margin.right),
            "marginBottom" => len!(self.margin.bottom),
            "marginLeft" => len!(self.margin.left),
            "marginHorizontal" => match Length::from_value(val) {
                Some(l) => {
                    self.margin.left = Some(l);
                    self.margin.right = Some(l);
                    true
                }
                None => false,
            },
            "marginVertical" => match Length::from_value(val) {
                Some(l) => {
                    self.margin.top = Some(l);
                    self.margin.bottom = Some(l);
                    true
                }
                None => false,
            },
            "padding" => match Length::from_value(val) {
                Some(l) => {
                    self.padding = Sides::all(l);
                    true
                }
                None => false,
            },
            "paddingTop" => len!(self.padding.top),
            "paddingRight" => len!(self.padding.right),
            "paddingBottom" => len!(self.padding.bottom),
            "paddingLeft" => len!(self.padding.left),
            "paddingHorizontal" => match Length::from_value(val) {
                Some(l) => {
                    self.padding.left = Some(l);
                    self.padding.right = Some(l);
                    true
                }
                None => false,
            },
            "paddingVertical" => match Length::from_value(val) {
                Some(l) => {
                    self.padding.top = Some(l);
                    self.padding.bottom = Some(l);
                    true
                }
                None => false,
            },
            "flexDirection" => enm!(self.flex_direction, FlexDirection),
            "flexWrap" => enm!(self.flex_wrap, FlexWrap),
            "justifyContent" => enm!(self.justify_content, JustifyContent),
            "alignItems" => enm!(self.align_items, AlignItems),
            "alignSelf" => enm!(self.align_self, AlignSelf),
            "alignContent" => enm!(self.align_content, AlignContent),
            "flex" => match f32_from_value(val) {
                Some(n) if n > 0.0 => {
                    self.flex_grow = Some(n);
                    self.flex_shrink = Some(1.0);
                    self.flex_basis = Some(Length::Px(0.0));
                    true
                }
                Some(0.0) => {
                    self.flex_grow = Some(0.0);
                    self.flex_shrink = Some(0.0);
                    self.flex_basis = Some(Length::Auto);
                    true
                }
                Some(_) => {
                    self.flex_grow = Some(0.0);
                    self.flex_shrink = Some(1.0);
                    self.flex_basis = Some(Length::Auto);
                    true
                }
                None => false,
            },
            "flexGrow" => num!(self.flex_grow),
            "flexShrink" => num!(self.flex_shrink),
            "flexBasis" => len!(self.flex_basis),
            "gap" => match f32_from_value(val) {
                Some(n) => {
                    self.row_gap = Some(n);
                    self.column_gap = Some(n);
                    true
                }
                None => false,
            },
            "rowGap" => num!(self.row_gap),
            "columnGap" => num!(self.column_gap),
            "aspectRatio" => match val {
                Value::Str(s) => {
                    let mut parts = s.split('/').map(|p| p.trim().parse::<f32>());
                    match (parts.next(), parts.next()) {
                        (Some(Ok(w)), Some(Ok(h))) if h != 0.0 => {
                            self.aspect_ratio = Some(w / h);
                            true
                        }
                        (Some(Ok(r)), None) => {
                            self.aspect_ratio = Some(r);
                            true
                        }
                        _ => false,
                    }
                }
                _ => num!(self.aspect_ratio),
            },
            "overflow" => enm!(self.overflow, Overflow),
            "gridTemplateColumns" => match GridTrack::list_from_value(val) {
                Some(t) => {
                    self.grid_template_columns = Some(t);
                    true
                }
                None => false,
            },
            "gridTemplateRows" => match GridTrack::list_from_value(val) {
                Some(t) => {
                    self.grid_template_rows = Some(t);
                    true
                }
                None => false,
            },
            "gridColumnStart" => match val.as_i64() {
                Some(n) => {
                    self.grid_column_start = Some(n as i16);
                    true
                }
                None => false,
            },
            "gridColumnEnd" => match val.as_i64() {
                Some(n) => {
                    self.grid_column_end = Some(n as i16);
                    true
                }
                None => false,
            },
            "gridRowStart" => match val.as_i64() {
                Some(n) => {
                    self.grid_row_start = Some(n as i16);
                    true
                }
                None => false,
            },
            "gridRowEnd" => match val.as_i64() {
                Some(n) => {
                    self.grid_row_end = Some(n as i16);
                    true
                }
                None => false,
            },
            "backgroundColor" => color!(self.background_color),
            "backgroundGradient" => match Gradient::from_value(val) {
                Some(g) => {
                    self.background_gradient = Some(g);
                    true
                }
                None => false,
            },
            "opacity" => num!(self.opacity),
            "borderRadius" => match f32_from_value(val) {
                Some(r) => {
                    self.border_radius = Corners {
                        tl: Some(r),
                        tr: Some(r),
                        br: Some(r),
                        bl: Some(r),
                    };
                    true
                }
                None => false,
            },
            "borderTopLeftRadius" => num!(self.border_radius.tl),
            "borderTopRightRadius" => num!(self.border_radius.tr),
            "borderBottomRightRadius" => num!(self.border_radius.br),
            "borderBottomLeftRadius" => num!(self.border_radius.bl),
            "borderWidth" => match f32_from_value(val) {
                Some(w) => {
                    self.border_width = Sides::all(w);
                    true
                }
                None => false,
            },
            "borderTopWidth" => num!(self.border_width.top),
            "borderRightWidth" => num!(self.border_width.right),
            "borderBottomWidth" => num!(self.border_width.bottom),
            "borderLeftWidth" => num!(self.border_width.left),
            "borderColor" => match Color::from_value(val) {
                Some(c) => {
                    self.border_color = Sides::all(c);
                    true
                }
                None => false,
            },
            "borderTopColor" => color!(self.border_color.top),
            "borderRightColor" => color!(self.border_color.right),
            "borderBottomColor" => color!(self.border_color.bottom),
            "borderLeftColor" => color!(self.border_color.left),
            "outlineWidth" => num!(self.outline_width),
            "outlineColor" => color!(self.outline_color),
            "outlineOffset" => num!(self.outline_offset),
            "transform" => match Transform::list_from_value(val) {
                Some(t) => {
                    self.transform = Some(t);
                    true
                }
                None => false,
            },
            "shadowColor" => color!(self.shadow.color),
            "shadowOffset" => match (val.get_f64("width"), val.get_f64("height")) {
                (Some(w), Some(h)) => {
                    self.shadow.offset = Some((w as f32, h as f32));
                    true
                }
                _ => false,
            },
            "shadowOpacity" => num!(self.shadow.opacity),
            "shadowRadius" => num!(self.shadow.radius),
            "elevation" => true, // Android-only in RN; accepted and ignored
            "zIndex" => match val.as_i64() {
                Some(z) => {
                    self.z_index = Some(z as i32);
                    true
                }
                None => false,
            },
            "color" => color!(self.color),
            "fontSize" => num!(self.font_size),
            "fontWeight" => match weight_from_value(val) {
                Some(w) => {
                    self.font_weight = Some(w);
                    true
                }
                None => false,
            },
            "fontFamily" => match val.as_str() {
                Some(f) => {
                    self.font_family = Some(f.to_string());
                    true
                }
                None => false,
            },
            "fontStyle" => enm!(self.font_style, FontStyle),
            "lineHeight" => num!(self.line_height),
            "letterSpacing" => num!(self.letter_spacing),
            "textAlign" => enm!(self.text_align, TextAlign),
            "textTransform" => enm!(self.text_transform, TextTransform),
            "resizeMode" | "objectFit" => enm!(self.resize_mode, ResizeMode),
            "tintColor" => color!(self.tint_color),
            _ => false,
        }
    }

    /// `other` wins per property; unset properties in `other` keep `self`.
    pub fn merge(&self, other: &Style) -> Style {
        macro_rules! o {
            ($f:ident) => {
                other.$f.clone().or_else(|| self.$f.clone())
            };
        }
        Style {
            display: o!(display),
            position: o!(position),
            inset: self.inset.merge(other.inset),
            width: o!(width),
            height: o!(height),
            min_width: o!(min_width),
            min_height: o!(min_height),
            max_width: o!(max_width),
            max_height: o!(max_height),
            margin: self.margin.merge(other.margin),
            padding: self.padding.merge(other.padding),
            flex_direction: o!(flex_direction),
            flex_wrap: o!(flex_wrap),
            justify_content: o!(justify_content),
            align_items: o!(align_items),
            align_self: o!(align_self),
            align_content: o!(align_content),
            flex_grow: o!(flex_grow),
            flex_shrink: o!(flex_shrink),
            flex_basis: o!(flex_basis),
            row_gap: o!(row_gap),
            column_gap: o!(column_gap),
            aspect_ratio: o!(aspect_ratio),
            overflow: o!(overflow),
            grid_template_columns: o!(grid_template_columns),
            grid_template_rows: o!(grid_template_rows),
            grid_column_start: o!(grid_column_start),
            grid_column_end: o!(grid_column_end),
            grid_row_start: o!(grid_row_start),
            grid_row_end: o!(grid_row_end),
            background_color: o!(background_color),
            background_gradient: o!(background_gradient),
            opacity: o!(opacity),
            border_radius: self.border_radius.merge(other.border_radius),
            border_width: self.border_width.merge(other.border_width),
            border_color: self.border_color.merge(other.border_color),
            outline_width: o!(outline_width),
            outline_color: o!(outline_color),
            outline_offset: o!(outline_offset),
            transform: o!(transform),
            shadow: self.shadow.merge(other.shadow),
            z_index: o!(z_index),
            color: o!(color),
            font_size: o!(font_size),
            font_weight: o!(font_weight),
            font_family: o!(font_family),
            font_style: o!(font_style),
            line_height: o!(line_height),
            letter_spacing: o!(letter_spacing),
            text_align: o!(text_align),
            text_transform: o!(text_transform),
            resize_mode: o!(resize_mode),
            tint_color: o!(tint_color),
        }
    }

    pub fn merge_into(&mut self, other: &Style) {
        *self = self.merge(other);
    }

    /// True if any layout-affecting property differs between the two styles.
    pub fn layout_differs(&self, other: &Style) -> bool {
        self.display != other.display
            || self.position != other.position
            || self.inset != other.inset
            || self.width != other.width
            || self.height != other.height
            || self.min_width != other.min_width
            || self.min_height != other.min_height
            || self.max_width != other.max_width
            || self.max_height != other.max_height
            || self.margin != other.margin
            || self.padding != other.padding
            || self.flex_direction != other.flex_direction
            || self.flex_wrap != other.flex_wrap
            || self.justify_content != other.justify_content
            || self.align_items != other.align_items
            || self.align_self != other.align_self
            || self.align_content != other.align_content
            || self.flex_grow != other.flex_grow
            || self.flex_shrink != other.flex_shrink
            || self.flex_basis != other.flex_basis
            || self.row_gap != other.row_gap
            || self.column_gap != other.column_gap
            || self.aspect_ratio != other.aspect_ratio
            || self.overflow != other.overflow
            || self.grid_template_columns != other.grid_template_columns
            || self.grid_template_rows != other.grid_template_rows
            || self.grid_column_start != other.grid_column_start
            || self.grid_column_end != other.grid_column_end
            || self.grid_row_start != other.grid_row_start
            || self.grid_row_end != other.grid_row_end
            || self.border_width != other.border_width
            || self.font_size != other.font_size
            || self.font_weight != other.font_weight
            || self.font_family != other.font_family
            || self.font_style != other.font_style
            || self.line_height != other.line_height
            || self.letter_spacing != other.letter_spacing
            || self.text_align != other.text_align
            || self.text_transform != other.text_transform
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(json: &str) -> Value {
        Value::from_json(&serde_json::from_str(json).unwrap())
    }

    #[test]
    fn parses_rn_style_object() {
        let p = Style::parse(&v(
            r##"{"flexDirection":"row","paddingHorizontal":24,"width":"50%","height":"auto",
            "backgroundColor":"#0070d1","borderRadius":12,"transform":[{"scale":1.08},{"rotate":"45deg"}],
            "shadowOffset":{"width":1,"height":2},"fontWeight":"semibold","gap":16,"bogus":1,"zIndex":3}"##,
        ));
        let s = &p.style;
        assert_eq!(s.flex_direction, Some(FlexDirection::Row));
        assert_eq!(s.padding.left, Some(Length::Px(24.0)));
        assert_eq!(s.padding.right, Some(Length::Px(24.0)));
        assert_eq!(s.padding.top, None);
        assert_eq!(s.width, Some(Length::Percent(50.0)));
        assert_eq!(s.height, Some(Length::Auto));
        assert_eq!(s.background_color, Some(Color::rgb8(0, 0x70, 0xd1)));
        assert_eq!(s.border_radius.resolved(), [12.0; 4]);
        assert_eq!(
            s.transform,
            Some(vec![Transform::Scale(1.08), Transform::Rotate(45.0)])
        );
        assert_eq!(s.shadow.offset, Some((1.0, 2.0)));
        assert_eq!(s.font_weight, Some(600));
        assert_eq!(s.row_gap, Some(16.0));
        assert_eq!(s.z_index, Some(3));
        assert_eq!(p.unknown, vec!["bogus".to_string()]);
    }

    #[test]
    fn merge_prefers_right_hand_side_per_property() {
        let base = Style::parse(&v(
            r##"{"padding":8,"backgroundColor":"#000","opacity":0.5}"##,
        ))
        .style;
        let focus = Style::parse(&v(r##"{"paddingLeft":20,"backgroundColor":"#fff"}"##)).style;
        let m = base.merge(&focus);
        assert_eq!(m.padding.left, Some(Length::Px(20.0)));
        assert_eq!(m.padding.top, Some(Length::Px(8.0)));
        assert_eq!(m.background_color, Some(Color::WHITE));
        assert_eq!(m.opacity, Some(0.5));
        assert!(base.layout_differs(&m));
        assert!(!base.layout_differs(&base.merge(&Style::parse(&v(r#"{"opacity":1}"#)).style)));
    }

    #[test]
    fn easing_matches_css_reference_points() {
        assert!((Easing::EaseOut.apply(0.5) - 0.685).abs() < 0.01);
        assert!((Easing::EaseIn.apply(0.5) - 0.3155).abs() < 0.01);
        assert_eq!(Easing::Linear.apply(0.25), 0.25);
        assert!((Easing::Ease.apply(1.0) - 1.0).abs() < 1e-5);
        assert_eq!(
            Easing::parse(&Value::Str("cubic-bezier(0.1, 0.2, 0.3, 0.4)".into())),
            Some(Easing::CubicBezier(0.1, 0.2, 0.3, 0.4))
        );
    }

    #[test]
    fn transition_parsing() {
        let t = Transition::from_value(&v(
            r#"{"props":["opacity","transform"],"duration":200,"easing":"ease-out"}"#,
        ))
        .unwrap();
        assert!(t.applies_to("opacity"));
        assert!(t.applies_to("scale"));
        assert!(!t.applies_to("backgroundColor"));
        assert_eq!(t.duration_ms, 200.0);
        assert_eq!(t.easing, Easing::EaseOut);
        assert!(
            Transition::from_value(&Value::Bool(true))
                .unwrap()
                .applies_to("width")
        );
    }
}
