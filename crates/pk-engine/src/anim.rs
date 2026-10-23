//! Animations (Phase 3 §9): CSS-like transitions driven by effective-style
//! changes and imperative `Animate` ops. Pure data + sampling here; the engine
//! glue (`Engine::start_transition`, `Engine::tick_animations`) lives at the
//! bottom of this file.

use pk_protocol::events::{EventKind, UiEvent};
use pk_protocol::ops::{AnimProp, AnimValue};
use pk_protocol::style::{Easing, Length, Style, Transform};
use pk_protocol::{Color, NodeId, Value};

use crate::Engine;

/// Decomposed `transform` list (applied about the node centre as
/// translate · rotate · scale).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Xform {
    pub tx: f32,
    pub ty: f32,
    pub sx: f32,
    pub sy: f32,
    pub rot: f32,
}

impl Xform {
    pub const IDENTITY: Xform = Xform {
        tx: 0.0,
        ty: 0.0,
        sx: 1.0,
        sy: 1.0,
        rot: 0.0,
    };

    pub fn from_list(list: Option<&Vec<Transform>>) -> Xform {
        let mut x = Xform::IDENTITY;
        if let Some(list) = list {
            for t in list {
                match *t {
                    Transform::TranslateX(v) => x.tx += v,
                    Transform::TranslateY(v) => x.ty += v,
                    Transform::Scale(v) => {
                        x.sx *= v;
                        x.sy *= v;
                    }
                    Transform::ScaleX(v) => x.sx *= v,
                    Transform::ScaleY(v) => x.sy *= v,
                    Transform::Rotate(v) => x.rot += v,
                }
            }
        }
        x
    }

    pub fn is_identity(&self) -> bool {
        *self == Xform::IDENTITY
    }

    /// True when only a translation is present (text can use the bitmap fast path).
    pub fn is_translation_only(&self) -> bool {
        self.sx == 1.0 && self.sy == 1.0 && self.rot == 0.0
    }
}

/// The animatable value of `prop` in a style (+ decomposed transform), or
/// `None` when it cannot be interpolated (e.g. a percentage width).
pub fn target_of(style: &Style, xf: &Xform, prop: AnimProp) -> Option<AnimValue> {
    Some(match prop {
        AnimProp::Opacity => AnimValue::Num(style.opacity.unwrap_or(1.0)),
        AnimProp::TranslateX => AnimValue::Num(xf.tx),
        AnimProp::TranslateY => AnimValue::Num(xf.ty),
        AnimProp::Scale | AnimProp::ScaleX => AnimValue::Num(xf.sx),
        AnimProp::ScaleY => AnimValue::Num(xf.sy),
        AnimProp::Rotate => AnimValue::Num(xf.rot),
        AnimProp::BackgroundColor => {
            AnimValue::Color(style.background_color.unwrap_or(Color::TRANSPARENT))
        }
        AnimProp::BorderColor => {
            AnimValue::Color(style.border_color.top.unwrap_or(Color::TRANSPARENT))
        }
        AnimProp::Color => AnimValue::Color(style.color.unwrap_or(Color::WHITE)),
        AnimProp::Width => AnimValue::Num(style.width?.px()?),
        AnimProp::Height => AnimValue::Num(style.height?.px()?),
        AnimProp::Top => AnimValue::Num(style.inset.top?.px()?),
        AnimProp::Left => AnimValue::Num(style.inset.left?.px()?),
        AnimProp::ScrollX | AnimProp::ScrollY => return None,
    })
}

/// Write an animated value into the current style / transform.
pub fn apply_value(style: &mut Style, xf: &mut Xform, prop: AnimProp, v: AnimValue) {
    match (prop, v) {
        (AnimProp::Opacity, AnimValue::Num(n)) => style.opacity = Some(n),
        (AnimProp::TranslateX, AnimValue::Num(n)) => xf.tx = n,
        (AnimProp::TranslateY, AnimValue::Num(n)) => xf.ty = n,
        (AnimProp::Scale, AnimValue::Num(n)) => {
            xf.sx = n;
            xf.sy = n;
        }
        (AnimProp::ScaleX, AnimValue::Num(n)) => xf.sx = n,
        (AnimProp::ScaleY, AnimValue::Num(n)) => xf.sy = n,
        (AnimProp::Rotate, AnimValue::Num(n)) => xf.rot = n,
        (AnimProp::BackgroundColor, AnimValue::Color(c)) => style.background_color = Some(c),
        (AnimProp::BorderColor, AnimValue::Color(c)) => {
            style.border_color = pk_protocol::style::Sides::all(c)
        }
        (AnimProp::Color, AnimValue::Color(c)) => style.color = Some(c),
        (AnimProp::Width, AnimValue::Num(n)) => style.width = Some(Length::Px(n)),
        (AnimProp::Height, AnimValue::Num(n)) => style.height = Some(Length::Px(n)),
        (AnimProp::Top, AnimValue::Num(n)) => style.inset.top = Some(Length::Px(n)),
        (AnimProp::Left, AnimValue::Num(n)) => style.inset.left = Some(Length::Px(n)),
        _ => {}
    }
}

pub fn lerp_value(from: AnimValue, to: AnimValue, t: f32) -> AnimValue {
    match (from, to) {
        (AnimValue::Num(a), AnimValue::Num(b)) => AnimValue::Num(a + (b - a) * t),
        (AnimValue::Color(a), AnimValue::Color(b)) => AnimValue::Color(a.lerp(b, t)),
        (_, to) => to,
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Run {
    pub from: AnimValue,
    pub to: AnimValue,
    pub start_ms: f64,
    pub duration_ms: f32,
    pub delay_ms: f32,
    pub easing: Easing,
    /// `Some(callback_id)` for imperative `Animate` ops: `animationEnd` fires at the end.
    pub callback: Option<u32>,
}

impl Run {
    /// Value at absolute time `now_ms`, and whether the run has finished.
    pub fn sample(&self, now_ms: f64) -> (AnimValue, bool) {
        let elapsed = (now_ms - self.start_ms) as f32 - self.delay_ms;
        if elapsed < 0.0 {
            return (self.from, false);
        }
        if self.duration_ms <= 0.0 || elapsed >= self.duration_ms {
            return (self.to, true);
        }
        let p = self.easing.apply(elapsed / self.duration_ms);
        (lerp_value(self.from, self.to, p), false)
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Slot {
    pub prop: AnimProp,
    pub value: AnimValue,
    pub run: Option<Run>,
    /// Imperative animations keep their final value until the style changes that prop.
    pub persistent: bool,
}

#[derive(Clone, Debug, Default)]
pub struct NodeAnim {
    pub slots: Vec<Slot>,
}

impl NodeAnim {
    pub fn slot(&self, prop: AnimProp) -> Option<&Slot> {
        self.slots.iter().find(|s| s.prop == prop)
    }
    pub fn is_running(&self) -> bool {
        self.slots.iter().any(|s| s.run.is_some())
    }
}

impl Engine {
    /// Start (or retarget) an animation of `prop` on `id` from its currently
    /// displayed value.
    pub(crate) fn start_run(
        &mut self,
        id: NodeId,
        prop: AnimProp,
        from: Option<AnimValue>,
        to: AnimValue,
        duration_ms: f32,
        delay_ms: f32,
        easing: Easing,
        callback: Option<u32>,
        persistent: bool,
    ) {
        let Some(node) = self.tree.get_mut(id) else {
            return;
        };
        let current = node
            .anim
            .slot(prop)
            .map(|s| s.value)
            .or(from)
            .or_else(|| target_of(&node.cur, &node.xform, prop));
        let from = current.unwrap_or(to);
        let run = Run {
            from,
            to,
            start_ms: f64::NAN,
            duration_ms,
            delay_ms,
            easing,
            callback,
        };
        if let Some(slot) = node.anim.slots.iter_mut().find(|s| s.prop == prop) {
            slot.value = from;
            slot.run = Some(run);
            slot.persistent = persistent;
        } else {
            node.anim.slots.push(Slot {
                prop,
                value: from,
                run: Some(run),
                persistent,
            });
        }
        if !self.animating.contains(&id) {
            self.animating.push(id);
        }
    }

    /// Imperative `Animate` op: animate `prop` to `to`; `animationEnd {callback}` fires at the end.
    pub(crate) fn op_animate(
        &mut self,
        id: NodeId,
        prop: AnimProp,
        to: AnimValue,
        duration_ms: f32,
        easing: Easing,
        callback: u32,
    ) {
        let is_scroll = matches!(prop, AnimProp::ScrollX | AnimProp::ScrollY);
        let from = if is_scroll {
            let s = self.tree.get(id).map(|n| n.scroll).unwrap_or((0.0, 0.0));
            Some(AnimValue::Num(if prop == AnimProp::ScrollX {
                s.0
            } else {
                s.1
            }))
        } else {
            None
        };
        self.start_run(
            id,
            prop,
            from,
            to,
            duration_ms.max(0.0),
            0.0,
            easing,
            Some(callback),
            !is_scroll,
        );
    }

    /// Advance every running animation to `now_ms`.
    pub(crate) fn tick_animations(&mut self, now_ms: f64, events: &mut Vec<UiEvent>) {
        let ids = std::mem::take(&mut self.animating);
        let mut keep = Vec::with_capacity(ids.len());
        for id in ids {
            let mut ended: Vec<u32> = Vec::new();
            let mut scroll_changes: Vec<(AnimProp, f32)> = Vec::new();
            let mut touched = false;
            let mut layout = false;
            {
                let Some(node) = self.tree.get_mut(id) else {
                    continue;
                };
                let mut finished_transition: Vec<AnimProp> = Vec::new();
                for slot in node.anim.slots.iter_mut() {
                    if let Some(r) = slot.run.as_mut() {
                        // Runs started between ticks are anchored to the next frame's time.
                        if r.start_ms.is_nan() {
                            r.start_ms = now_ms;
                        }
                    }
                    let Some(run) = slot.run else { continue };
                    let (v, done) = run.sample(now_ms);
                    slot.value = v;
                    touched = true;
                    layout |= slot.prop.affects_layout();
                    if matches!(slot.prop, AnimProp::ScrollX | AnimProp::ScrollY) {
                        if let AnimValue::Num(n) = v {
                            scroll_changes.push((slot.prop, n));
                        }
                    }
                    if done {
                        slot.run = None;
                        if let Some(cb) = run.callback {
                            ended.push(cb);
                        }
                        if !slot.persistent {
                            finished_transition.push(slot.prop);
                        }
                    }
                }
                // Write values into the current style first, then drop finished
                // non-persistent slots (their final value equals the style target).
                let (cur, xform) = (&mut node.cur, &mut node.xform);
                for slot in node.anim.slots.iter() {
                    if !matches!(slot.prop, AnimProp::ScrollX | AnimProp::ScrollY) {
                        apply_value(cur, xform, slot.prop, slot.value);
                    }
                }
                node.anim
                    .slots
                    .retain(|s| !(s.run.is_none() && !s.persistent));
                if node.anim.is_running() {
                    keep.push(id);
                }
            }
            for (prop, n) in scroll_changes {
                self.set_scroll_axis(id, prop == AnimProp::ScrollX, n);
            }
            if touched {
                self.mark_visual(id, true);
                if layout {
                    self.mark_layout(id);
                }
            }
            for cb in ended {
                events.push(UiEvent::with_payload(
                    id,
                    EventKind::AnimationEnd,
                    Value::obj([("callback", Value::from(cb))]),
                ));
            }
        }
        self.animating = keep;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ease_out_at_half() {
        let run = Run {
            from: AnimValue::Num(0.0),
            to: AnimValue::Num(100.0),
            start_ms: 1000.0,
            duration_ms: 200.0,
            delay_ms: 0.0,
            easing: Easing::EaseOut,
            callback: None,
        };
        let (v, done) = run.sample(1100.0);
        let AnimValue::Num(n) = v else { panic!() };
        // cubic-bezier(0, 0, 0.58, 1) at x = 0.5 -> y ~= 0.8 (well above linear 0.5)
        assert!(!done);
        let expected = Easing::EaseOut.apply(0.5) * 100.0;
        assert!((n - expected).abs() < 1e-3);
        // cubic-bezier(0, 0, 0.58, 1) at x = 0.5 gives y ≈ 0.68: well above the linear 0.5.
        assert!(n > 65.0 && n < 72.0, "{n}");
        assert!(run.sample(1200.0).1);
        assert_eq!(run.sample(900.0).0, AnimValue::Num(0.0));
    }

    #[test]
    fn xform_decomposes() {
        let x = Xform::from_list(Some(&vec![
            Transform::TranslateX(5.0),
            Transform::Scale(2.0),
            Transform::Rotate(10.0),
        ]));
        assert_eq!((x.tx, x.sx, x.sy, x.rot), (5.0, 2.0, 2.0, 10.0));
    }
}
