//! The shadow tree (Phase 3 §1) and the mutation-op glue (Phase 4 §4).
//!
//! Ids are JS-assigned and never reused. `Append`/`InsertBefore` of an
//! attached child MOVES it (DOM semantics); `Remove` detaches and destroys the
//! whole subtree.

use std::sync::Arc;

use pk_protocol::ops::{NodeKind, Op};
use pk_protocol::props::{IconPath, OVERLAY_ID, PropKey, PropUpdate, Props, ROOT_ID};
use pk_protocol::style::{Display, Overflow, Style};
use pk_protocol::{Color, NodeId, Rect};

use crate::Engine;
use crate::anim::{NodeAnim, Xform};
use crate::hash::FxMap;
use crate::layout::TextData;
use crate::text::{Span, TextContent, TextRun};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NodeState {
    pub focused: bool,
    pub pressed: bool,
    pub disabled: bool,
}

/// Parsed icon geometry (one entry per SVG path).
#[derive(Debug)]
pub struct IconGeom {
    pub path: tiny_skia::Path,
    pub spec: IconPath,
}

pub struct Node {
    pub id: NodeId,
    pub kind: NodeKind,
    pub parent: Option<NodeId>,
    pub children: Vec<NodeId>,
    pub props: Props,
    /// Raw text content (`RawText` nodes).
    pub text: String,
    pub classes: Option<Arc<pk_protocol::ResolvedClasses>>,
    /// State-resolved style (base ⊕ focus ⊕ active ⊕ disabled), before animation.
    pub target: Style,
    /// Displayed style: `target` with animated slot values applied.
    pub cur: Style,
    pub xform: Xform,
    pub state: NodeState,
    pub anim: NodeAnim,
    /// Layout rect relative to the parent's border-box origin.
    pub rect: Rect,
    /// Screen-space layout rect (transforms excluded, scroll offsets included).
    pub abs: Rect,
    pub scroll: (f32, f32),
    pub content: (f32, f32),
    /// Border + padding: `[left, top, right, bottom]` offsets from the border box to the content box.
    pub inset: [f32; 4],
    /// Padding-box size of a `Scroll` node (the scroll viewport).
    pub viewport: (f32, f32),
    pub text_data: Option<Arc<TextData>>,
    pub text_run: Option<(u64, Arc<TextRun>)>,
    pub icon: Option<Arc<Vec<IconGeom>>>,
    pub taffy: Option<taffy::NodeId>,
    pub last_layout_event: Option<Rect>,
    pub last_scroll_event: Option<(f32, f32)>,
}

impl Node {
    pub fn new(id: NodeId, kind: NodeKind) -> Node {
        Node {
            id,
            kind,
            parent: None,
            children: Vec::new(),
            props: Props::default(),
            text: String::new(),
            classes: None,
            target: Style::default(),
            cur: Style::default(),
            xform: Xform::IDENTITY,
            state: NodeState::default(),
            anim: NodeAnim::default(),
            rect: Rect::default(),
            abs: Rect::default(),
            scroll: (0.0, 0.0),
            content: (0.0, 0.0),
            inset: [0.0; 4],
            viewport: (0.0, 0.0),
            text_data: None,
            text_run: None,
            icon: None,
            taffy: None,
            last_layout_event: None,
            last_scroll_event: None,
        }
    }

    pub fn display_none(&self) -> bool {
        self.cur.display == Some(Display::None)
    }

    pub fn is_scroll(&self) -> bool {
        self.kind == NodeKind::Scroll
    }

    pub fn clips(&self) -> bool {
        self.kind == NodeKind::Scroll
            || matches!(self.cur.overflow, Some(Overflow::Hidden | Overflow::Scroll))
    }

    pub fn subscribed(&self, bit: u32) -> bool {
        self.props.events & bit != 0
    }

    /// Node colour for icons/inputs: `color` prop, then the style colour, then white.
    pub fn text_color(&self) -> Color {
        self.props.color.or(self.cur.color).unwrap_or(Color::WHITE)
    }
}

#[derive(Default)]
pub struct Tree {
    pub nodes: FxMap<NodeId, Node>,
}

impl Tree {
    pub fn get(&self, id: NodeId) -> Option<&Node> {
        self.nodes.get(&id)
    }

    pub fn get_mut(&mut self, id: NodeId) -> Option<&mut Node> {
        self.nodes.get_mut(&id)
    }

    pub fn contains(&self, id: NodeId) -> bool {
        self.nodes.contains_key(&id)
    }

    /// True when `id` is reachable from the root.
    pub fn attached(&self, id: NodeId) -> bool {
        let mut cur = id;
        loop {
            if cur == ROOT_ID {
                return true;
            }
            match self.get(cur).and_then(|n| n.parent) {
                Some(p) => cur = p,
                None => return false,
            }
        }
    }

    /// `ancestor` is a strict ancestor of `id`.
    pub fn is_ancestor(&self, ancestor: NodeId, id: NodeId) -> bool {
        let mut cur = self.get(id).and_then(|n| n.parent);
        while let Some(p) = cur {
            if p == ancestor {
                return true;
            }
            cur = self.get(p).and_then(|n| n.parent);
        }
        false
    }

    /// Pre-order (tree-order) ids of the subtree rooted at `id`, including `id`.
    pub fn subtree(&self, id: NodeId) -> Vec<NodeId> {
        let mut out = Vec::new();
        let mut stack = vec![id];
        while let Some(n) = stack.pop() {
            out.push(n);
            if let Some(node) = self.get(n) {
                stack.extend(node.children.iter().rev().copied());
            }
        }
        out
    }

    /// The `Text` node that owns the text content `id` contributes to
    /// (the outermost `Text` ancestor chain), if any.
    pub fn text_root(&self, id: NodeId) -> Option<NodeId> {
        let mut cur = id;
        let mut found = None;
        loop {
            let n = self.get(cur)?;
            if matches!(n.kind, NodeKind::Text | NodeKind::RawText) {
                found = Some(cur);
            } else {
                break;
            }
            match n.parent {
                Some(p) => cur = p,
                None => break,
            }
        }
        // A RawText with no Text ancestor contributes nothing.
        found.filter(|f| self.get(*f).is_some_and(|n| n.kind == NodeKind::Text))
    }

    /// Concatenate the content of a `Text` node (RawText children and nested
    /// `Text` spans with colour/weight/size overrides).
    pub fn collect_text(&self, id: NodeId) -> TextContent {
        let mut spans = Vec::new();
        self.collect_into(id, &mut spans);
        TextContent::new(spans)
    }

    fn collect_into(&self, id: NodeId, spans: &mut Vec<Span>) {
        let Some(node) = self.get(id) else { return };
        for c in &node.children {
            let Some(child) = self.get(*c) else { continue };
            match child.kind {
                NodeKind::RawText => spans.push(Span {
                    text: child.text.clone(),
                    color: None,
                    weight: None,
                    size: None,
                }),
                NodeKind::Text => {
                    let start = spans.len();
                    self.collect_into(*c, spans);
                    let (color, weight, size) =
                        (child.cur.color, child.cur.font_weight, child.cur.font_size);
                    for s in &mut spans[start..] {
                        s.color = s.color.or(color);
                        s.weight = s.weight.or(weight);
                        s.size = s.size.or(size);
                    }
                }
                _ => {}
            }
        }
    }
}

impl Engine {
    /// Apply one React commit atomically. Returns warnings (unknown props,
    /// ops on missing nodes) for the caller to log.
    pub fn apply_commit(&mut self, ops: &[Op]) -> Vec<String> {
        let mut warnings = Vec::new();
        for op in ops {
            match op {
                Op::Create { id, kind, props } => self.op_create(*id, *kind, props, &mut warnings),
                Op::Update { id, props } => {
                    for k in &props.unknown {
                        warnings.push(format!("node {id}: unknown or invalid prop \"{k}\""));
                    }
                    if !self.update_props(*id, &props.updates) {
                        warnings.push(format!("update: node {id} does not exist"));
                    }
                }
                Op::Append { parent, child } => {
                    if !self.op_attach(*parent, *child, None) {
                        warnings.push(format!("append: cannot attach node {child} to {parent}"));
                    }
                }
                Op::InsertBefore {
                    parent,
                    child,
                    before,
                } => {
                    if !self.op_attach(*parent, *child, Some(*before)) {
                        warnings.push(format!(
                            "insertBefore: cannot attach node {child} to {parent}"
                        ));
                    }
                }
                Op::Remove { parent, child } => {
                    let ok = self
                        .tree
                        .get(*child)
                        .is_some_and(|n| n.parent == Some(*parent));
                    if ok {
                        self.detach(*child);
                        self.destroy_subtree(*child);
                    } else {
                        warnings.push(format!("remove: node {child} is not a child of {parent}"));
                    }
                }
                Op::SetText { id, text } => {
                    let Some(node) = self.tree.get_mut(*id) else {
                        warnings.push(format!("setText: node {id} does not exist"));
                        continue;
                    };
                    if node.text != *text {
                        node.text.clone_from(text);
                        self.invalidate_text(*id);
                    }
                }
                Op::ScrollTo { id, x, y, animated } => {
                    if !self.tree.contains(*id) {
                        warnings.push(format!("scrollTo: node {id} does not exist"));
                    } else {
                        self.pending_scroll_to.push((*id, *x, *y, *animated));
                        self.scene_dirty = true;
                    }
                }
                Op::Focus { id } => {
                    if !self.set_focus(*id) {
                        warnings.push(format!("focus: node {id} is not focusable"));
                    }
                }
                Op::Animate {
                    id,
                    prop,
                    to,
                    duration_ms,
                    easing,
                    callback,
                } => {
                    if !self.tree.contains(*id) {
                        warnings.push(format!("animate: node {id} does not exist"));
                        // The caller waits for animationEnd; resolve it now.
                        self.events.push(pk_protocol::UiEvent::with_payload(
                            *id,
                            pk_protocol::EventKind::AnimationEnd,
                            pk_protocol::Value::obj([(
                                "callback",
                                pk_protocol::Value::from(*callback),
                            )]),
                        ));
                    } else {
                        self.op_animate(*id, *prop, *to, *duration_ms, *easing, *callback);
                    }
                }
                Op::Measure { id, callback } => {
                    self.pending_measures.push((*callback, *id));
                    self.scene_dirty = true;
                }
            }
        }
        warnings
    }

    fn op_create(
        &mut self,
        id: NodeId,
        kind: NodeKind,
        props: &pk_protocol::props::PropsParse,
        warnings: &mut Vec<String>,
    ) {
        if id == ROOT_ID || id == OVERLAY_ID || self.tree.contains(id) {
            warnings.push(format!("create: node {id} already exists"));
            return;
        }
        for k in &props.unknown {
            warnings.push(format!("node {id}: unknown or invalid prop \"{k}\""));
        }
        let mut node = Node::new(id, kind);
        for u in &props.updates {
            node.props.apply(u);
        }
        node.state.disabled = node.props.disabled;
        self.tree.nodes.insert(id, node);
        self.create_taffy_node(id);
        self.after_props_changed(id, &props.updates, true);
    }

    /// Apply a props diff to an existing node. Returns false if the node is unknown.
    pub fn update_props(&mut self, id: NodeId, updates: &[PropUpdate]) -> bool {
        let Some(node) = self.tree.get_mut(id) else {
            return false;
        };
        for u in updates {
            node.props.apply(u);
        }
        node.state.disabled = node.props.disabled;
        self.after_props_changed(id, updates, false);
        true
    }

    fn after_props_changed(&mut self, id: NodeId, updates: &[PropUpdate], created: bool) {
        let mut restyle = created;
        let mut text = false;
        let mut layout = false;
        let mut icon = false;
        let mut scope = false;
        let mut auto_focus = false;
        let mut src = false;
        for u in updates {
            let key = match u {
                PropUpdate::Set(p) => PropKey::of(p),
                PropUpdate::Remove(k) => *k,
            };
            match key {
                PropKey::Style
                | PropKey::StyleFocus
                | PropKey::StyleActive
                | PropKey::StyleDisabled
                | PropKey::Disabled
                | PropKey::Transition => restyle = true,
                PropKey::Classes => {
                    let ids = self
                        .tree
                        .get(id)
                        .map(|n| n.props.classes.clone())
                        .unwrap_or_default();
                    let resolved = if ids.is_empty() {
                        None
                    } else {
                        Some(self.resolve_classes(&ids))
                    };
                    if let Some(n) = self.tree.get_mut(id) {
                        n.classes = resolved;
                    }
                    restyle = true;
                }
                PropKey::Value
                | PropKey::Placeholder
                | PropKey::Secure
                | PropKey::NumberOfLines => text = true,
                PropKey::Horizontal | PropKey::Size => layout = true,
                PropKey::ViewBox | PropKey::Paths => {
                    icon = true;
                    layout = true;
                }
                PropKey::FocusScope => scope = true,
                PropKey::AutoFocus => auto_focus = true,
                PropKey::Src => src = true,
                PropKey::Focusable => self.focus.dirty = true,
                _ => {}
            }
        }
        if icon {
            self.rebuild_icon(id);
        }
        if restyle {
            self.restyle(id, !created);
        }
        if text {
            self.invalidate_text(id);
        }
        if layout {
            self.mark_layout(id);
        }
        if src {
            self.request_image(id);
        }
        if self.tree.attached(id) {
            if scope {
                self.sync_scope(id);
            }
            if auto_focus && self.tree.get(id).is_some_and(|n| n.props.auto_focus) {
                self.pending_autofocus.push(id);
            }
        }
        self.focus.dirty = true;
        self.scene_dirty = true;
    }

    fn rebuild_icon(&mut self, id: NodeId) {
        let Some(node) = self.tree.get_mut(id) else {
            return;
        };
        if node.kind != NodeKind::Icon {
            return;
        }
        let geoms: Vec<IconGeom> = node
            .props
            .paths
            .iter()
            .filter_map(|p| {
                crate::svgpath::parse_svg_path(&p.d).map(|path| IconGeom {
                    path,
                    spec: p.clone(),
                })
            })
            .collect();
        node.icon = Some(Arc::new(geoms));
    }

    fn op_attach(&mut self, parent: NodeId, child: NodeId, before: Option<NodeId>) -> bool {
        if parent == child
            || child == ROOT_ID
            || child == OVERLAY_ID
            || !self.tree.contains(parent)
            || !self.tree.contains(child)
        {
            return false;
        }
        if self.tree.is_ancestor(child, parent) {
            return false;
        }
        if before == Some(child) {
            return true;
        }
        if self.tree.get(child).is_some_and(|n| n.parent.is_some()) {
            self.detach(child);
        }
        let Some(p) = self.tree.get_mut(parent) else {
            return false;
        };
        let index = before.and_then(|b| p.children.iter().position(|c| *c == b));
        match index {
            Some(i) => p.children.insert(i, child),
            None => p.children.push(child),
        }
        if let Some(c) = self.tree.get_mut(child) {
            c.parent = Some(parent);
        }
        self.layout.struct_dirty.push(parent);
        self.layout.needs = true;
        self.invalidate_text(child);
        self.invalidate_text(parent);
        if self.tree.attached(child) {
            self.on_subtree_attached(child);
        }
        self.scene_dirty = true;
        self.focus.dirty = true;
        true
    }

    /// Remove `child` from its parent's child list (the node and its subtree stay alive).
    pub(crate) fn detach(&mut self, child: NodeId) {
        let Some(parent) = self.tree.get(child).and_then(|n| n.parent) else {
            return;
        };
        if let Some(p) = self.tree.get_mut(parent) {
            p.children.retain(|c| *c != child);
        }
        if let Some(c) = self.tree.get_mut(child) {
            c.parent = None;
        }
        self.layout.struct_dirty.push(parent);
        self.layout.needs = true;
        self.invalidate_text(parent);
        self.scene_dirty = true;
        self.focus.dirty = true;
    }

    /// Drop a detached subtree for good.
    pub(crate) fn destroy_subtree(&mut self, id: NodeId) {
        let ids = self.tree.subtree(id);
        for n in &ids {
            self.on_node_destroyed(*n);
        }
        for n in ids {
            if let Some(node) = self.tree.nodes.remove(&n) {
                if let Some(t) = node.taffy {
                    // Freed after layout (see `LayoutState::orphans`); the
                    // parent's next `sync_structure` unlinks it.
                    self.layout.orphans.push(t);
                }
                self.layout.map.remove(&n);
            }
        }
        self.scene_dirty = true;
        self.layout.needs = true;
        self.focus.dirty = true;
    }

    /// Mark the text owned by (or containing) `id` as needing re-measure/re-shape.
    pub(crate) fn invalidate_text(&mut self, id: NodeId) {
        let root = self.tree.text_root(id);
        let Some(root) = root.or_else(|| {
            self.tree
                .get(id)
                .filter(|n| matches!(n.kind, NodeKind::Input))
                .map(|n| n.id)
        }) else {
            return;
        };
        if let Some(n) = self.tree.get_mut(root) {
            n.text_data = None;
            n.text_run = None;
            let t = n.taffy;
            if let Some(t) = t {
                let _ = self.layout.taffy.mark_dirty(t);
            }
        }
        self.layout.text_dirty.push(root);
        self.layout.needs = true;
        self.scene_dirty = true;
    }
}
