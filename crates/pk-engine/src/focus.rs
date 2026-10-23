//! Spatial focus engine (Phase 3 §6).
//!
//! * Candidates are focusable, enabled, laid-out nodes inside the innermost
//!   trapping scope (or the whole tree), at least partially inside the clip
//!   rects of their `overflow: hidden` ancestors. Nodes inside a `Scroll` are
//!   candidates even when scrolled out of view (focusing them scrolls them in).
//! * A candidate is "ahead" if its near edge is at or beyond the far edge of
//!   the focused rect in the direction (1 px tolerance).
//!   score = primary + 0.3 × lateral + (overlaps on the cross axis ? 0 : 100000);
//!   lowest wins, ties → tree order. `nextFocus*` props override the search.
//! * Trapping scopes form a stack in attach order; focus cannot leave the
//!   innermost one. Scopes with `restore` give focus back to what had it
//!   before they activated once they are removed.

use pk_protocol::events::{EventKind, UiEvent};
use pk_protocol::ops::NodeKind;
use pk_protocol::props::{Direction, OVERLAY_ID, ROOT_ID};
use pk_protocol::{NodeId, Rect, Value};

use crate::hash::FxMap;
use crate::{Engine, SoundCue};

const TOLERANCE: f32 = 1.0;
const LATERAL_WEIGHT: f32 = 0.3;
const NO_OVERLAP_PENALTY: f32 = 100_000.0;

#[derive(Clone, Copy, Debug, Default)]
pub struct ScopeState {
    /// Focus before this scope activated (for `restore`).
    pub restore_to: Option<NodeId>,
    /// Last focused node inside the scope when focus left it.
    pub last_focused: Option<NodeId>,
}

#[derive(Default)]
pub struct FocusState {
    pub focused: Option<NodeId>,
    /// Active trapping scopes in activation order; the last live one is innermost.
    pub scopes: Vec<NodeId>,
    pub scope_state: FxMap<NodeId, ScopeState>,
    pub pending_restore: Option<NodeId>,
    pub dirty: bool,
}

/// Score of `c` relative to `f` when moving in `dir`, or `None` if `c` is not ahead.
pub fn score(f: &Rect, c: &Rect, dir: Direction) -> Option<f32> {
    let (primary, lateral, overlaps) = match dir {
        Direction::Right => {
            if c.x < f.right() - TOLERANCE {
                return None;
            }
            (
                (c.x - f.right()).max(0.0),
                (c.center().1 - f.center().1).abs(),
                c.y < f.bottom() && f.y < c.bottom(),
            )
        }
        Direction::Left => {
            if c.right() > f.x + TOLERANCE {
                return None;
            }
            (
                (f.x - c.right()).max(0.0),
                (c.center().1 - f.center().1).abs(),
                c.y < f.bottom() && f.y < c.bottom(),
            )
        }
        Direction::Down => {
            if c.y < f.bottom() - TOLERANCE {
                return None;
            }
            (
                (c.y - f.bottom()).max(0.0),
                (c.center().0 - f.center().0).abs(),
                c.x < f.right() && f.x < c.right(),
            )
        }
        Direction::Up => {
            if c.bottom() > f.y + TOLERANCE {
                return None;
            }
            (
                (f.y - c.bottom()).max(0.0),
                (c.center().0 - f.center().0).abs(),
                c.x < f.right() && f.x < c.right(),
            )
        }
    };
    Some(primary + LATERAL_WEIGHT * lateral + if overlaps { 0.0 } else { NO_OVERLAP_PENALTY })
}

impl Engine {
    pub fn focused(&self) -> Option<NodeId> {
        self.focus.focused.filter(|id| self.tree.contains(*id))
    }

    /// Screen-space layout rect of a node.
    pub fn node_rect(&self, id: NodeId) -> Option<Rect> {
        self.tree.get(id).map(|n| n.abs)
    }

    pub fn find_by_test_id(&self, test_id: &str) -> Option<NodeId> {
        let mut best: Option<NodeId> = None;
        for id in self.tree.subtree(ROOT_ID) {
            if self
                .tree
                .get(id)
                .is_some_and(|n| n.props.test_id.as_deref() == Some(test_id))
            {
                best = Some(id);
                break;
            }
        }
        best
    }

    /// Focus `id` if it is focusable (and inside the innermost trapping scope).
    pub fn set_focus(&mut self, id: NodeId) -> bool {
        if !self.is_focusable(id) {
            return false;
        }
        if let Some(scope) = self.innermost_scope() {
            if id != scope && !self.tree.is_ancestor(scope, id) {
                return false;
            }
        }
        self.focus_node(Some(id), false);
        true
    }

    /// Focusable, enabled, attached and not hidden by `display: none`.
    pub(crate) fn is_focusable(&self, id: NodeId) -> bool {
        let Some(n) = self.tree.get(id) else {
            return false;
        };
        if !n.props.focusable || n.props.disabled || n.state.disabled || n.kind == NodeKind::RawText
        {
            return false;
        }
        let mut cur = Some(id);
        while let Some(c) = cur {
            let Some(node) = self.tree.get(c) else {
                return false;
            };
            if node.display_none() {
                return false;
            }
            cur = node.parent;
        }
        self.tree.attached(id)
    }

    pub(crate) fn innermost_scope(&self) -> Option<NodeId> {
        self.focus
            .scopes
            .iter()
            .rev()
            .copied()
            .find(|s| self.tree.contains(*s) && self.tree.attached(*s))
    }

    /// Candidates in tree order: `(id, rect)`; the overlay layer comes last.
    fn candidates(&self, scope: Option<NodeId>) -> Vec<(NodeId, Rect)> {
        let mut out = Vec::new();
        let start = scope.unwrap_or(ROOT_ID);
        // Clip inherited from ancestors of the start node.
        let mut clip: Option<Rect> = None;
        let mut cur = self.tree.get(start).and_then(|n| n.parent);
        while let Some(p) = cur {
            let Some(n) = self.tree.get(p) else { break };
            if n.clips() && n.kind != NodeKind::Scroll {
                clip = Some(clip.map_or(n.abs, |c| c.intersection(&n.abs)));
            }
            cur = n.parent;
        }
        self.collect_candidates(start, clip, &mut out);
        out
    }

    fn collect_candidates(&self, id: NodeId, clip: Option<Rect>, out: &mut Vec<(NodeId, Rect)>) {
        let Some(n) = self.tree.get(id) else { return };
        if n.display_none() || n.kind == NodeKind::RawText {
            return;
        }
        let r = n.abs;
        if n.props.focusable
            && !n.props.disabled
            && !n.state.disabled
            && !r.is_empty()
            && clip.is_none_or(|c| c.intersects(&r))
        {
            out.push((id, r));
        }
        let child_clip = if n.clips() && n.kind != NodeKind::Scroll {
            Some(clip.map_or(r, |c| c.intersection(&r)))
        } else {
            clip
        };
        if matches!(n.kind, NodeKind::Text | NodeKind::Input) {
            return;
        }
        let mut overlay = false;
        for c in &n.children {
            if id == ROOT_ID && *c == OVERLAY_ID {
                overlay = true;
                continue;
            }
            self.collect_candidates(*c, child_clip, out);
        }
        if overlay {
            self.collect_candidates(OVERLAY_ID, child_clip, out);
        }
    }

    /// Directional navigation from the focused node. Returns true if focus moved.
    pub(crate) fn move_focus(&mut self, dir: Direction) -> bool {
        let Some(f) = self.focused() else {
            // Nothing focused: pick the first focusable.
            self.focus.dirty = true;
            return false;
        };
        let scope = self.innermost_scope();
        let in_scope = |this: &Engine, id: NodeId| {
            scope.is_none_or(|s| id == s || this.tree.is_ancestor(s, id))
        };
        // Explicit override.
        if let Some(Some(target)) = self.tree.get(f).map(|n| n.props.next_focus[dir.index()]) {
            if target == f {
                // A node that points `nextFocus<Dir>` at itself pins focus for that direction.
                return false;
            }
            if self.is_focusable(target) && in_scope(self, target) {
                self.focus_node(Some(target), true);
                return true;
            }
        }
        let Some(frect) = self.tree.get(f).map(|n| n.abs) else {
            return false;
        };
        let mut best: Option<(f32, NodeId)> = None;
        for (id, r) in self.candidates(scope) {
            if id == f {
                continue;
            }
            if let Some(s) = score(&frect, &r, dir) {
                if best.is_none_or(|(b, _)| s < b) {
                    best = Some((s, id));
                }
            }
        }
        match best {
            Some((_, id)) => {
                self.focus_node(Some(id), true);
                true
            }
            None => {
                if let Some(scope) = scope {
                    if self
                        .tree
                        .get(scope)
                        .is_some_and(|n| n.subscribed(EventKind::FocusBoundary.bit()))
                    {
                        self.events.push(UiEvent::with_payload(
                            scope,
                            EventKind::FocusBoundary,
                            Value::obj([("direction", Value::from(dir.as_str()))]),
                        ));
                    }
                    if self.cfg.ui_sounds {
                        self.sounds.push(SoundCue::Error);
                    }
                }
                false
            }
        }
    }

    /// Move focus to `new`, firing blur/focus, restyling both and revealing the new node.
    pub(crate) fn focus_node(&mut self, new: Option<NodeId>, via_nav: bool) {
        let old = self.focus.focused;
        if old == new {
            return;
        }
        if let Some(o) = old {
            if self.tree.contains(o) {
                // Scopes the focus is leaving remember where it was.
                let mut cur = self.tree.get(o).and_then(|n| n.parent);
                while let Some(p) = cur {
                    let Some(pn) = self.tree.get(p) else { break };
                    if pn.props.focus_scope.is_some()
                        && new.is_none_or(|n| !self.tree.is_ancestor(p, n))
                    {
                        self.focus.scope_state.entry(p).or_default().last_focused = Some(o);
                    }
                    cur = pn.parent;
                }
                if let Some(n) = self.tree.get_mut(o) {
                    n.state.focused = false;
                    n.state.pressed = false;
                    if n.subscribed(EventKind::Blur.bit()) {
                        self.events.push(UiEvent::new(o, EventKind::Blur));
                    }
                }
                self.restyle(o, true);
            }
        }
        self.focus.focused = new;
        if let Some(n) = new {
            if let Some(node) = self.tree.get_mut(n) {
                node.state.focused = true;
                if node.subscribed(EventKind::Focus.bit()) {
                    self.events.push(UiEvent::new(n, EventKind::Focus));
                }
            }
            self.restyle(n, true);
            self.pending_reveal = Some(n);
            if via_nav && self.cfg.ui_sounds {
                self.sounds.push(SoundCue::Navigate);
            }
        }
        self.scene_dirty = true;
    }

    /// Register or unregister `id` as a trapping scope after its props changed.
    pub(crate) fn sync_scope(&mut self, id: NodeId) {
        let Some(n) = self.tree.get(id) else { return };
        let trap = n.props.focus_scope.is_some_and(|s| s.trap);
        let restore = n.props.focus_scope.is_some_and(|s| s.restore);
        let present = self.focus.scopes.contains(&id);
        if trap && !present {
            self.focus.scopes.push(id);
            let before = self
                .focused()
                .filter(|f| *f != id && !self.tree.is_ancestor(id, *f));
            self.focus.scope_state.insert(
                id,
                ScopeState {
                    restore_to: if restore { before } else { None },
                    last_focused: None,
                },
            );
            self.focus.dirty = true;
        } else if !trap && present {
            self.focus.scopes.retain(|s| *s != id);
            self.focus.dirty = true;
        }
    }

    pub(crate) fn on_subtree_attached(&mut self, id: NodeId) {
        for n in self.tree.subtree(id) {
            self.sync_scope(n);
            if self.tree.get(n).is_some_and(|node| node.props.auto_focus) {
                self.pending_autofocus.push(n);
            }
        }
    }

    pub(crate) fn on_node_destroyed(&mut self, id: NodeId) {
        if self.focus.scopes.contains(&id) {
            self.focus.scopes.retain(|s| *s != id);
            if let Some(st) = self.focus.scope_state.remove(&id) {
                if self
                    .tree
                    .get(id)
                    .is_some_and(|n| n.props.focus_scope.is_some_and(|s| s.restore))
                {
                    self.focus.pending_restore = st.restore_to.or(self.focus.pending_restore);
                }
            }
        } else {
            self.focus.scope_state.remove(&id);
        }
        self.animating.retain(|a| *a != id);
        self.pending_autofocus.retain(|a| *a != id);
        self.scroll_dirty.retain(|a| *a != id);
    }

    /// First autoFocus node, else first focusable, in tree order inside `scope`.
    fn first_focusable(&self, scope: Option<NodeId>) -> Option<NodeId> {
        let cands = self.candidates(scope);
        cands
            .iter()
            .find(|(id, _)| self.tree.get(*id).is_some_and(|n| n.props.auto_focus))
            .or_else(|| cands.first())
            .map(|(id, _)| *id)
    }

    /// Re-validate focus after layout: honour autoFocus mounts, move focus out of
    /// removed/disabled nodes and into freshly activated trapping scopes, and
    /// give an initial focus.
    pub(crate) fn focus_fix(&mut self) {
        let scope = self.innermost_scope();
        let in_scope = |this: &Engine, id: NodeId| {
            scope.is_none_or(|s| id == s || this.tree.is_ancestor(s, id))
        };

        // autoFocus on mount (any commit): the last mounted autoFocus node wins; a
        // `FocusScope` with autoFocus hands focus to its autoFocus descendant, else its
        // first focusable descendant.
        let pending = std::mem::take(&mut self.pending_autofocus);
        let resolved = pending.into_iter().rev().find_map(|n| {
            let target = if self.is_focusable(n) {
                Some(n)
            } else if self
                .tree
                .get(n)
                .is_some_and(|node| node.props.focus_scope.is_some())
            {
                self.first_focusable(Some(n))
            } else {
                None
            };
            target.filter(|t| in_scope(self, *t))
        });
        if let Some(n) = resolved {
            self.focus_node(Some(n), false);
        }

        let current = self.focus.focused;
        let valid = current.is_some_and(|f| self.is_focusable(f) && in_scope(self, f));
        if valid {
            self.reveal_pending();
            return;
        }
        // The old node may be gone; make sure its state does not linger.
        let restore = self.focus.pending_restore.take();
        let target = restore
            .filter(|r| self.is_focusable(*r) && in_scope(self, *r))
            .or_else(|| {
                scope
                    .and_then(|s| {
                        self.focus
                            .scope_state
                            .get(&s)
                            .and_then(|st| st.last_focused)
                    })
                    .filter(|r| self.is_focusable(*r) && in_scope(self, *r))
            })
            .or_else(|| self.first_focusable(scope));
        if let Some(t) = target {
            self.focus_node(Some(t), false);
        } else if current.is_some() {
            // Nothing to focus: drop the stale handle.
            if let Some(f) = current {
                if let Some(n) = self.tree.get_mut(f) {
                    n.state.focused = false;
                    n.state.pressed = false;
                }
                self.restyle(f, true);
            }
            self.focus.focused = None;
        }
        self.reveal_pending();
    }

    fn reveal_pending(&mut self) {
        if let Some(id) = self.pending_reveal.take() {
            if self.tree.contains(id) {
                self.scroll_into_view(id);
            }
        }
    }
}
