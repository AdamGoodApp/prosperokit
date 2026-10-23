//! Scroll nodes (Phase 3 §8): `Scroll` nodes clip their children and own the
//! scroll offset; `onScroll` events fire at most once per frame; `scrollTo`
//! may animate; focus changes scroll the nearest `Scroll` ancestors so the
//! focused node is visible with 48 px padding (150 ms ease-out).

use pk_protocol::events::{EventKind, UiEvent};
use pk_protocol::ops::{AnimProp, AnimValue, NodeKind};
use pk_protocol::style::Easing;
use pk_protocol::{NodeId, Rect, Value};

use crate::Engine;

/// Padding kept between a revealed node and the scroll viewport edge.
pub const REVEAL_PADDING: f32 = 48.0;
pub const REVEAL_MS: f32 = 150.0;
const SCROLL_TO_MS: f32 = 250.0;

impl Engine {
    /// Largest valid scroll offset of a `Scroll` node.
    pub(crate) fn max_scroll(&self, id: NodeId) -> (f32, f32) {
        let Some(n) = self.tree.get(id) else {
            return (0.0, 0.0);
        };
        (
            (n.content.0 - n.viewport.0).max(0.0),
            (n.content.1 - n.viewport.1).max(0.0),
        )
    }

    /// Scroll `id` to `(x, y)` (clamped), optionally animated.
    pub fn scroll_to(&mut self, id: NodeId, x: f32, y: f32, animated: bool) {
        self.update_layout();
        let Some(n) = self.tree.get(id) else { return };
        if n.kind != NodeKind::Scroll {
            return;
        }
        let (mx, my) = self.max_scroll(id);
        let (x, y) = (x.clamp(0.0, mx), y.clamp(0.0, my));
        if animated {
            let cur = n.scroll;
            if (cur.0 - x).abs() > 0.01 {
                self.start_run(
                    id,
                    AnimProp::ScrollX,
                    Some(AnimValue::Num(cur.0)),
                    AnimValue::Num(x),
                    SCROLL_TO_MS,
                    0.0,
                    Easing::EaseInOut,
                    None,
                    false,
                );
            }
            if (cur.1 - y).abs() > 0.01 {
                self.start_run(
                    id,
                    AnimProp::ScrollY,
                    Some(AnimValue::Num(cur.1)),
                    AnimValue::Num(y),
                    SCROLL_TO_MS,
                    0.0,
                    Easing::EaseInOut,
                    None,
                    false,
                );
            }
        } else {
            self.cancel_scroll_runs(id);
            self.set_scroll_axis(id, true, x);
            self.set_scroll_axis(id, false, y);
        }
    }

    fn cancel_scroll_runs(&mut self, id: NodeId) {
        if let Some(n) = self.tree.get_mut(id) {
            n.anim
                .slots
                .retain(|s| !matches!(s.prop, AnimProp::ScrollX | AnimProp::ScrollY));
        }
    }

    /// Scroll by a delta (right stick); cancels animated scrolls on that node.
    pub(crate) fn scroll_by(&mut self, id: NodeId, dx: f32, dy: f32) {
        let Some(n) = self.tree.get(id) else { return };
        let (x, y) = n.scroll;
        self.cancel_scroll_runs(id);
        self.set_scroll_axis(id, true, x + dx);
        self.set_scroll_axis(id, false, y + dy);
    }

    /// Set one scroll axis (clamped); descendants' screen rects move with it.
    pub(crate) fn set_scroll_axis(&mut self, id: NodeId, is_x: bool, v: f32) {
        let (mx, my) = self.max_scroll(id);
        let Some(n) = self.tree.get_mut(id) else {
            return;
        };
        let v = v.clamp(0.0, if is_x { mx } else { my });
        let old = if is_x { n.scroll.0 } else { n.scroll.1 };
        if v == old {
            return;
        }
        if is_x {
            n.scroll.0 = v;
        } else {
            n.scroll.1 = v;
        }
        let delta = old - v;
        let (dx, dy) = if is_x { (delta, 0.0) } else { (0.0, delta) };
        let ids = self.tree.subtree(id);
        for c in ids.into_iter().skip(1) {
            if let Some(node) = self.tree.get_mut(c) {
                node.abs = node.abs.translate(dx, dy);
            }
        }
        if !self.scroll_dirty.contains(&id) {
            self.scroll_dirty.push(id);
        }
        self.scene_dirty = true;
        self.focus.dirty = true;
    }

    /// Fire queued `scroll` events (at most one per node per frame).
    pub(crate) fn flush_scroll_events(&mut self) {
        let ids = std::mem::take(&mut self.scroll_dirty);
        for id in ids {
            let Some(n) = self.tree.get_mut(id) else {
                continue;
            };
            if n.last_scroll_event == Some(n.scroll) {
                continue;
            }
            n.last_scroll_event = Some(n.scroll);
            if n.subscribed(EventKind::Scroll.bit()) {
                let payload = Value::obj([
                    ("x", Value::from(n.scroll.0)),
                    ("y", Value::from(n.scroll.1)),
                    ("contentW", Value::from(n.content.0)),
                    ("contentH", Value::from(n.content.1)),
                    ("viewportW", Value::from(n.viewport.0)),
                    ("viewportH", Value::from(n.viewport.1)),
                ]);
                self.events
                    .push(UiEvent::with_payload(id, EventKind::Scroll, payload));
            }
        }
    }

    /// The scroll offset that makes `item` visible inside `view` with padding,
    /// or `None` if it is already fully visible.
    pub(crate) fn reveal_offset(
        item: &Rect,
        view: &Rect,
        cur: f32,
        horizontal: bool,
        max: f32,
    ) -> Option<f32> {
        let (i0, i1, v0, v1) = if horizontal {
            (item.x, item.right(), view.x, view.right())
        } else {
            (item.y, item.bottom(), view.y, view.bottom())
        };
        let target = if i0 < v0 {
            cur - (v0 - i0) - REVEAL_PADDING
        } else if i1 > v1 {
            let t = cur + (i1 - v1) + REVEAL_PADDING;
            // An item taller than the viewport aligns its start instead of its end.
            let max_fit = cur + (i0 - v0) - REVEAL_PADDING;
            t.min(max_fit.max(cur))
        } else {
            return None;
        };
        let target = target.clamp(0.0, max);
        ((target - cur).abs() > 0.01).then_some(target)
    }

    /// Scroll every `Scroll` ancestor of `id` so `id` is visible.
    pub(crate) fn scroll_into_view(&mut self, id: NodeId) {
        self.update_layout();
        let Some(item) = self.tree.get(id).map(|n| n.abs) else {
            return;
        };
        let mut cur = self.tree.get(id).and_then(|n| n.parent);
        // Rect of the item as it will be after outer scrolls have been applied is unknowable
        // cheaply; ancestors are handled inner to outer using the current layout.
        let mut item = item;
        while let Some(p) = cur {
            let Some(n) = self.tree.get(p) else { break };
            let next = n.parent;
            if n.kind == NodeKind::Scroll {
                let view = n.abs;
                let (mx, my) = self.max_scroll(p);
                let scroll = n.scroll;
                let horizontal = n.props.horizontal;
                let mut targets = (None, None);
                if let Some(t) = Engine::reveal_offset(&item, &view, scroll.0, true, mx) {
                    targets.0 = Some(t);
                }
                if let Some(t) = Engine::reveal_offset(&item, &view, scroll.1, false, my) {
                    targets.1 = Some(t);
                }
                let _ = horizontal;
                if let Some(x) = targets.0 {
                    self.start_run(
                        p,
                        AnimProp::ScrollX,
                        Some(AnimValue::Num(scroll.0)),
                        AnimValue::Num(x),
                        REVEAL_MS,
                        0.0,
                        Easing::EaseOut,
                        None,
                        false,
                    );
                    item = item.translate(scroll.0 - x, 0.0);
                }
                if let Some(y) = targets.1 {
                    self.start_run(
                        p,
                        AnimProp::ScrollY,
                        Some(AnimValue::Num(scroll.1)),
                        AnimValue::Num(y),
                        REVEAL_MS,
                        0.0,
                        Easing::EaseOut,
                        None,
                        false,
                    );
                    item = item.translate(0.0, scroll.1 - y);
                }
            }
            cur = next;
        }
    }

    /// Nearest `Scroll` node at or above `id`.
    pub(crate) fn nearest_scroll(&self, id: NodeId) -> Option<NodeId> {
        let mut cur = Some(id);
        while let Some(c) = cur {
            let n = self.tree.get(c)?;
            if n.kind == NodeKind::Scroll {
                return Some(c);
            }
            cur = n.parent;
        }
        None
    }
}
