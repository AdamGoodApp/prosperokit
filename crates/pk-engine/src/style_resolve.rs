//! Style resolution (Phase 3 §2): `classes` resolve through the style table
//! (cached by id tuple) and merge *under* the node's explicit `style*` props;
//! the effective style is base ⊕ focus ⊕ active ⊕ disabled. Effective-style
//! changes start transitions (`anim.rs`) and mark layout/visual dirtiness.

use std::sync::Arc;

use pk_protocol::ops::{AnimProp, AnimValue};
use pk_protocol::style::{Style, Transition};
use pk_protocol::{NodeId, ResolvedClasses};

use crate::Engine;
use crate::anim::{Xform, apply_value, target_of};

const ANIMATABLE: [AnimProp; 13] = [
    AnimProp::Opacity,
    AnimProp::TranslateX,
    AnimProp::TranslateY,
    AnimProp::Scale,
    AnimProp::ScaleX,
    AnimProp::ScaleY,
    AnimProp::Rotate,
    AnimProp::BackgroundColor,
    AnimProp::BorderColor,
    AnimProp::Color,
    AnimProp::Width,
    AnimProp::Height,
    AnimProp::Top,
];

/// True if any property that changes shaping or measuring differs.
pub fn text_differs(a: &Style, b: &Style) -> bool {
    a.font_size != b.font_size
        || a.font_weight != b.font_weight
        || a.font_family != b.font_family
        || a.font_style != b.font_style
        || a.line_height != b.line_height
        || a.letter_spacing != b.letter_spacing
        || a.text_align != b.text_align
        || a.text_transform != b.text_transform
}

impl Engine {
    /// Install the compiled Tailwind table (`app.styles.json`) and restyle every node.
    pub fn set_style_table(&mut self, table: pk_protocol::StyleTable) {
        self.table = table;
        self.class_cache.clear();
        let ids: Vec<NodeId> = self.tree.nodes.keys().copied().collect();
        for id in ids {
            let classes = self
                .tree
                .get(id)
                .map(|n| n.props.classes.clone())
                .unwrap_or_default();
            let resolved = if classes.is_empty() {
                None
            } else {
                Some(self.resolve_classes(&classes))
            };
            if let Some(n) = self.tree.get_mut(id) {
                n.classes = resolved;
            }
            self.restyle(id, false);
        }
    }

    pub(crate) fn resolve_classes(&mut self, ids: &[u32]) -> Arc<ResolvedClasses> {
        if let Some(r) = self.class_cache.get(ids) {
            return r.clone();
        }
        let r = Arc::new(self.table.resolve(ids));
        self.class_cache.insert(ids.to_vec(), r.clone());
        r
    }

    /// Recompute the effective style of `id`. With `transitions`, animatable
    /// property changes run through the node's `transition`.
    pub(crate) fn restyle(&mut self, id: NodeId, transitions: bool) {
        let force = !transitions;
        let Some(node) = self.tree.get(id) else {
            return;
        };
        let classes = node.classes.clone();
        let mut target = match &classes {
            Some(c) => c.base.merge(&node.props.style),
            None => node.props.style.clone(),
        };
        let variants: [(bool, Option<&Style>, &Style); 3] = [
            (
                node.state.focused,
                classes.as_ref().map(|c| &c.focus),
                &node.props.style_focus,
            ),
            (
                node.state.pressed,
                classes.as_ref().map(|c| &c.active),
                &node.props.style_active,
            ),
            (
                node.state.disabled,
                classes.as_ref().map(|c| &c.disabled),
                &node.props.style_disabled,
            ),
        ];
        for (on, from_class, explicit) in variants {
            if !on {
                continue;
            }
            if let Some(c) = from_class {
                target = target.merge(c);
            }
            target = target.merge(explicit);
        }
        let transition: Option<Transition> = node
            .props
            .transition
            .clone()
            .or_else(|| classes.as_ref().and_then(|c| c.transition.clone()));
        let new_xf = Xform::from_list(target.transform.as_ref());
        let old_target = node.target.clone();
        let old_xf = Xform::from_list(old_target.transform.as_ref());

        let layout_changed = old_target.layout_differs(&target);
        let text_changed = text_differs(&old_target, &target);
        if !force && old_target == target {
            return;
        }

        // Which animatable props changed value, and which of those animate?
        let mut changed_props: Vec<AnimProp> = Vec::new();
        let mut starts: Vec<(AnimProp, AnimValue, AnimValue)> = Vec::new();
        for prop in ANIMATABLE {
            let a = target_of(&old_target, &old_xf, prop);
            let b = target_of(&target, &new_xf, prop);
            if a != b {
                changed_props.push(prop);
                if let (Some(a), Some(b), Some(tr)) = (a, b, transition.as_ref()) {
                    if !force
                        && (tr.duration_ms > 0.0 || tr.delay_ms > 0.0)
                        && tr.applies_to(prop.as_str())
                    {
                        starts.push((prop, a, b));
                    }
                }
            }
        }

        {
            let Some(node) = self.tree.get_mut(id) else {
                return;
            };
            node.target = target;
            // A style change wins over persistent imperative values and stale runs of the
            // props it changed; props that are about to transition keep their current value.
            node.anim.slots.retain(|s| {
                !changed_props.contains(&s.prop)
                    || starts.iter().any(|(p, _, _)| *p == s.prop) && !s.persistent
            });
            let (mut cur, mut xf) = (node.target.clone(), new_xf);
            for s in &node.anim.slots {
                apply_value(&mut cur, &mut xf, s.prop, s.value);
            }
            node.cur = cur;
            node.xform = xf;
        }

        if let Some(tr) = transition {
            for (prop, from, to) in starts {
                self.start_run(
                    id,
                    prop,
                    Some(from),
                    to,
                    tr.duration_ms,
                    tr.delay_ms,
                    tr.easing,
                    None,
                    false,
                );
            }
        }
        if layout_changed {
            self.mark_layout(id);
        }
        if text_changed {
            self.invalidate_text(id);
        }
        self.scene_dirty = true;
    }

    /// Queue a taffy style update and a layout pass.
    pub(crate) fn mark_layout(&mut self, id: NodeId) {
        self.layout.style_dirty.push(id);
        self.layout.needs = true;
        self.scene_dirty = true;
    }

    /// Visual-only change notification (damage is found by diffing the display list).
    pub(crate) fn mark_visual(&mut self, _id: NodeId, _subtree: bool) {
        self.scene_dirty = true;
    }
}
