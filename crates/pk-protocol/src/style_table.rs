//! `app.styles.json` (Phase 6 §2): the table of compiled Tailwind tokens the
//! engine loads once per bundle. Nodes reference entries by id through the
//! `classes` prop; entries are merged left-to-right (last wins per property).
//!
//! ```json
//! { "tokens": { "p-4": 0, "focus:ring-2": 1 },
//!   "styles": [ { "base": { "padding": 16 } },
//!               { "focus": { "outlineWidth": 2 } } ] }
//! ```
//!
//! Each entry may have `base`, `focus`, `active`, `disabled` (style objects in
//! the React Native key format), `transition` (a transition object) and
//! `gradient` (`{ "angle": 90, "from": color, "via": color, "to": color }`;
//! fragments from several tokens combine into one `backgroundGradient`).

use std::collections::HashMap;

use crate::color::Color;
use crate::style::{Easing, Gradient, Style, Transition, TransitionProps};
use crate::value::Value;

/// A partial transition from one token (`transition-all` sets `props`,
/// `duration-200` sets `duration_ms`, …); fragments merge left-to-right and
/// unset fields take the defaults (`all`, 150 ms, 0 ms, `ease`).
#[derive(Clone, Debug, PartialEq, Default)]
pub struct TransitionFragment {
    pub props: Option<TransitionProps>,
    pub duration_ms: Option<f32>,
    pub delay_ms: Option<f32>,
    pub easing: Option<Easing>,
}

impl TransitionFragment {
    pub fn from_value(v: &Value) -> Option<TransitionFragment> {
        match v {
            Value::Bool(true) => Some(TransitionFragment {
                props: Some(TransitionProps::All),
                ..Default::default()
            }),
            Value::Num(n) => Some(TransitionFragment {
                duration_ms: Some(*n as f32),
                ..Default::default()
            }),
            Value::Obj(_) => {
                let props = match v.get("props") {
                    None | Some(Value::Null) => None,
                    Some(Value::Str(s)) if s == "all" => Some(TransitionProps::All),
                    Some(Value::Str(s)) => Some(TransitionProps::Named(
                        s.split(',').map(|p| p.trim().to_string()).collect(),
                    )),
                    Some(Value::Arr(a)) => {
                        let names: Vec<String> = a
                            .iter()
                            .filter_map(|x| x.as_str().map(str::to_string))
                            .collect();
                        Some(if names.iter().any(|n| n == "all") {
                            TransitionProps::All
                        } else {
                            TransitionProps::Named(names)
                        })
                    }
                    _ => return None,
                };
                Some(TransitionFragment {
                    props,
                    duration_ms: v.get_f64("duration").map(|d| d as f32),
                    delay_ms: v.get_f64("delay").map(|d| d as f32),
                    easing: v.get("easing").and_then(Easing::parse),
                })
            }
            _ => None,
        }
    }

    pub fn merge_from(&mut self, other: &TransitionFragment) {
        if other.props.is_some() {
            self.props = other.props.clone();
        }
        if other.duration_ms.is_some() {
            self.duration_ms = other.duration_ms;
        }
        if other.delay_ms.is_some() {
            self.delay_ms = other.delay_ms;
        }
        if other.easing.is_some() {
            self.easing = other.easing;
        }
    }

    pub fn to_transition(&self) -> Transition {
        let d = Transition::default();
        Transition {
            props: self.props.clone().unwrap_or(d.props),
            duration_ms: self.duration_ms.unwrap_or(d.duration_ms),
            delay_ms: self.delay_ms.unwrap_or(d.delay_ms),
            easing: self.easing.unwrap_or(d.easing),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct GradientFragment {
    pub angle_deg: Option<f32>,
    pub from: Option<Color>,
    pub via: Option<Color>,
    pub to: Option<Color>,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct TokenStyle {
    pub base: Style,
    pub focus: Option<Style>,
    pub active: Option<Style>,
    pub disabled: Option<Style>,
    pub transition: Option<TransitionFragment>,
    pub gradient: Option<GradientFragment>,
}

/// The merged result of a list of token ids.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct ResolvedClasses {
    pub base: Style,
    pub focus: Style,
    pub active: Style,
    pub disabled: Style,
    pub transition: Option<Transition>,
}

#[derive(Clone, Debug, Default)]
pub struct StyleTable {
    pub tokens: HashMap<String, u32>,
    pub styles: Vec<TokenStyle>,
}

impl StyleTable {
    pub fn parse_json(text: &str) -> Result<StyleTable, String> {
        let json: serde_json::Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
        Ok(StyleTable::from_value(&Value::from_json(&json)))
    }

    pub fn from_value(v: &Value) -> StyleTable {
        let mut table = StyleTable::default();
        if let Some(tokens) = v.get("tokens").and_then(Value::as_obj) {
            for (name, id) in tokens {
                if let Some(id) = id.as_u32() {
                    table.tokens.insert(name.clone(), id);
                }
            }
        }
        if let Some(styles) = v.get("styles").and_then(Value::as_arr) {
            table.styles = styles.iter().map(TokenStyle::from_value).collect();
        }
        table
    }

    pub fn get(&self, id: u32) -> Option<&TokenStyle> {
        self.styles.get(id as usize)
    }

    /// Merge a list of ids left-to-right.
    pub fn resolve(&self, ids: &[u32]) -> ResolvedClasses {
        let mut out = ResolvedClasses::default();
        let mut gradient = GradientFragment::default();
        let mut has_gradient = false;
        let mut transition = TransitionFragment::default();
        let mut has_transition = false;
        for id in ids {
            let Some(token) = self.get(*id) else { continue };
            out.base.merge_into(&token.base);
            if let Some(f) = &token.focus {
                out.focus.merge_into(f);
            }
            if let Some(a) = &token.active {
                out.active.merge_into(a);
            }
            if let Some(d) = &token.disabled {
                out.disabled.merge_into(d);
            }
            if let Some(t) = &token.transition {
                has_transition = true;
                transition.merge_from(t);
            }
            if let Some(g) = &token.gradient {
                has_gradient = true;
                if g.angle_deg.is_some() {
                    gradient.angle_deg = g.angle_deg;
                }
                if g.from.is_some() {
                    gradient.from = g.from;
                }
                if g.via.is_some() {
                    gradient.via = g.via;
                }
                if g.to.is_some() {
                    gradient.to = g.to;
                }
            }
        }
        if has_gradient && let Some(g) = gradient.to_gradient() {
            out.base.background_gradient = Some(g);
        }
        if has_transition {
            out.transition = Some(transition.to_transition());
        }
        out
    }
}

impl GradientFragment {
    pub fn to_gradient(&self) -> Option<Gradient> {
        let angle_deg = self.angle_deg?;
        let mut stops = Vec::new();
        match (self.from, self.via, self.to) {
            (Some(f), Some(v), Some(t)) => {
                stops.push((0.0, f));
                stops.push((0.5, v));
                stops.push((1.0, t));
            }
            (Some(f), None, Some(t)) => {
                stops.push((0.0, f));
                stops.push((1.0, t));
            }
            (Some(f), Some(v), None) => {
                stops.push((0.0, f));
                stops.push((0.5, v));
                stops.push((1.0, v.with_alpha(0.0)));
            }
            (Some(f), None, None) => {
                stops.push((0.0, f));
                stops.push((1.0, f.with_alpha(0.0)));
            }
            (None, _, Some(t)) => {
                stops.push((0.0, t.with_alpha(0.0)));
                stops.push((1.0, t));
            }
            (None, Some(v), None) => {
                stops.push((0.0, v.with_alpha(0.0)));
                stops.push((0.5, v));
                stops.push((1.0, v.with_alpha(0.0)));
            }
            (None, None, None) => return None,
        }
        Some(Gradient { angle_deg, stops })
    }

    fn from_value(v: &Value) -> GradientFragment {
        GradientFragment {
            angle_deg: v.get_f64("angle").map(|a| a as f32),
            from: v.get("from").and_then(Color::from_value),
            via: v.get("via").and_then(Color::from_value),
            to: v.get("to").and_then(Color::from_value),
        }
    }
}

impl TokenStyle {
    pub fn from_value(v: &Value) -> TokenStyle {
        let style = |key: &str| {
            v.get(key)
                .filter(|s| !s.is_null())
                .map(|s| Style::parse(s).style)
        };
        TokenStyle {
            base: style("base").unwrap_or_default(),
            focus: style("focus"),
            active: style("active"),
            disabled: style("disabled"),
            transition: v
                .get("transition")
                .filter(|t| !t.is_null())
                .and_then(TransitionFragment::from_value),
            gradient: v
                .get("gradient")
                .filter(|g| !g.is_null())
                .map(GradientFragment::from_value),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::style::Length;

    #[test]
    fn resolves_tokens_left_to_right_and_builds_gradients() {
        let table = StyleTable::parse_json(
            r##"{"tokens":{"p-4":0,"p-2":1,"focus:ring-2":2,"bg-gradient-to-r":3,"from-red":4,"to-blue":5,"transition":6},
                "styles":[{"base":{"padding":16}},{"base":{"padding":8}},{"focus":{"outlineWidth":2}},
                {"gradient":{"angle":90}},{"gradient":{"from":"#f00"}},{"gradient":{"to":"#00f"}},
                {"transition":{"duration":150,"easing":"ease-out"}},{"transition":{"props":"all"}},{"transition":{"duration":200}},{"transition":{"props":[]}}]}"##,
        )
        .unwrap();
        let r = table.resolve(&[0, 1, 2, 3, 4, 5, 6]);
        assert_eq!(r.base.padding.left, Some(Length::Px(8.0)));
        assert_eq!(r.focus.outline_width, Some(2.0));
        let g = r.base.background_gradient.unwrap();
        assert_eq!(g.angle_deg, 90.0);
        assert_eq!(g.stops.len(), 2);
        assert_eq!(g.stops[1].1, Color::rgb8(0, 0, 255));
        let t = r.transition.unwrap();
        assert_eq!((t.duration_ms, t.easing), (150.0, Easing::EaseOut));
        assert!(t.applies_to("opacity"));
        // fragments merge field-wise: `transition-all duration-200 ease-out`
        let t2 = table.resolve(&[7, 8, 6]).transition.unwrap();
        assert_eq!(
            (t2.duration_ms, t2.easing, t2.delay_ms),
            (150.0, Easing::EaseOut, 0.0)
        );
        let t3 = table.resolve(&[7, 8]).transition.unwrap();
        assert_eq!((t3.duration_ms, t3.easing), (200.0, Easing::Ease));
        assert!(
            !table
                .resolve(&[9])
                .transition
                .unwrap()
                .applies_to("opacity")
        );
        assert_eq!(table.tokens["p-2"], 1);
        // unknown ids are ignored
        assert_eq!(table.resolve(&[99]).base, Style::default());
    }
}
