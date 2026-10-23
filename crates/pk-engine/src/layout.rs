//! Layout (Phase 3 §3): one taffy node per engine node (`RawText` and nested
//! `Text` spans have none), text/image/icon leaves measured through a measure
//! function backed by the text measure cache. Only dirty subtrees are
//! recomputed (taffy caches clean ones); afterwards computed rects are read
//! back into the tree and `layout` events are queued.
//!
//! Defaults follow React Native (the API is RN-shaped): `flexDirection` is
//! `column`, `flexShrink` is `0`, `alignContent` is `flex-start`.

use std::sync::Arc;

use pk_protocol::events::{EventKind, UiEvent};
use pk_protocol::ops::NodeKind;
use pk_protocol::props::{OVERLAY_ID, ROOT_ID};
use pk_protocol::style::{self as ps, GridTrack, Length, Style};
use pk_protocol::{NodeId, Rect, SCREEN_HEIGHT, SCREEN_WIDTH};
use taffy::prelude::*;
use taffy::style_helpers::{auto as t_auto, fr as t_fr, length as t_length, line as t_line};
use taffy::{
    AvailableSpace, GridPlacement, GridTemplateComponent, LayoutInput, LayoutOutput, Line as TLine,
    Overflow as TOverflow, Point as TPoint, Rect as TRect, Size, TrackSizingFunction,
};

use crate::Engine;
use crate::hash::{FxMap, FxSet};
use crate::text::{TextContent, TextStyle, TextSystem};
use crate::tree::{Node, Tree};

pub const ROOT_BACKGROUND: pk_protocol::Color = pk_protocol::Color::rgb8(0x0b, 0x0f, 0x17);

pub struct LayoutState {
    pub taffy: TaffyTree<NodeId>,
    pub map: FxMap<NodeId, taffy::NodeId>,
    pub struct_dirty: Vec<NodeId>,
    pub style_dirty: Vec<NodeId>,
    pub text_dirty: Vec<NodeId>,
    pub needs: bool,
    /// Taffy nodes of destroyed engine nodes, detached but not yet freed.
    /// Taffy records absolutely positioned boxes in their containing block's
    /// `hoisted_children` and `TaffyTree::remove` does not clean those lists
    /// (a containing block laid out through its own parent's hoisted path,
    /// like the absolute overlay, keeps the entry). Freeing such a node right
    /// away leaves a dangling key that `round_layout` dereferences, so a node
    /// is only freed once no hoisted list refers to it any more.
    pub orphans: Vec<taffy::NodeId>,
}

impl LayoutState {
    pub fn new() -> LayoutState {
        LayoutState {
            taffy: TaffyTree::new(),
            map: FxMap::default(),
            struct_dirty: Vec::new(),
            style_dirty: Vec::new(),
            text_dirty: Vec::new(),
            needs: true,
            orphans: Vec::new(),
        }
    }
}

impl Default for LayoutState {
    fn default() -> Self {
        Self::new()
    }
}

/// Text content + style of a measured/painted text node.
#[derive(Debug)]
pub struct TextData {
    pub content: TextContent,
    pub style: TextStyle,
}

fn dim(l: Option<Length>) -> Dimension {
    match l {
        Some(Length::Px(v)) => Dimension::length(v),
        Some(Length::Percent(p)) => Dimension::percent(p / 100.0),
        Some(Length::Auto) | None => Dimension::auto(),
    }
}

fn lpa(l: Option<Length>) -> LengthPercentageAuto {
    match l {
        Some(Length::Px(v)) => LengthPercentageAuto::length(v),
        Some(Length::Percent(p)) => LengthPercentageAuto::percent(p / 100.0),
        Some(Length::Auto) | None => LengthPercentageAuto::auto(),
    }
}

fn lpa_zero(l: Option<Length>) -> LengthPercentageAuto {
    match l {
        None => LengthPercentageAuto::length(0.0),
        other => lpa(other),
    }
}

fn lp(l: Option<Length>) -> LengthPercentage {
    match l {
        Some(Length::Px(v)) => LengthPercentage::length(v),
        Some(Length::Percent(p)) => LengthPercentage::percent(p / 100.0),
        Some(Length::Auto) | None => LengthPercentage::length(0.0),
    }
}

fn overflow(o: Option<ps::Overflow>, scroll_axis: bool) -> TOverflow {
    if scroll_axis {
        return TOverflow::Scroll;
    }
    match o {
        Some(ps::Overflow::Hidden) => TOverflow::Hidden,
        Some(ps::Overflow::Scroll) => TOverflow::Scroll,
        _ => TOverflow::Visible,
    }
}

fn track(t: &GridTrack) -> GridTemplateComponent<String> {
    GridTemplateComponent::Single(match *t {
        GridTrack::Px(v) => t_length::<f32, TrackSizingFunction>(v),
        GridTrack::Fr(f) => t_fr::<f32, TrackSizingFunction>(f),
        GridTrack::Auto => t_auto::<TrackSizingFunction>(),
    })
}

fn placement(v: Option<i16>) -> GridPlacement {
    match v {
        Some(n) if n != 0 => t_line::<GridPlacement>(n),
        _ => GridPlacement::Auto,
    }
}

/// Engine style → taffy style.
pub fn to_taffy(node: &Node) -> taffy::Style {
    let s: &Style = &node.cur;
    let mut t = taffy::Style::default();
    t.display = match s.display {
        Some(ps::Display::Grid) => taffy::Display::Grid,
        Some(ps::Display::None) => taffy::Display::None,
        _ => taffy::Display::Flex,
    };
    t.position = match s.position {
        Some(ps::Position::Absolute) => taffy::Position::Absolute,
        _ => taffy::Position::Relative,
    };
    t.inset = TRect {
        left: lpa(s.inset.left),
        right: lpa(s.inset.right),
        top: lpa(s.inset.top),
        bottom: lpa(s.inset.bottom),
    };
    t.size = Size {
        width: dim(s.width),
        height: dim(s.height),
    };
    t.min_size = Size {
        width: lpa(s.min_width),
        height: lpa(s.min_height),
    };
    t.max_size = Size {
        width: lpa(s.max_width),
        height: lpa(s.max_height),
    };
    t.margin = TRect {
        left: lpa_zero(s.margin.left),
        right: lpa_zero(s.margin.right),
        top: lpa_zero(s.margin.top),
        bottom: lpa_zero(s.margin.bottom),
    };
    t.padding = TRect {
        left: lp(s.padding.left),
        right: lp(s.padding.right),
        top: lp(s.padding.top),
        bottom: lp(s.padding.bottom),
    };
    t.border = TRect {
        left: LengthPercentage::length(s.border_width.left.unwrap_or(0.0)),
        right: LengthPercentage::length(s.border_width.right.unwrap_or(0.0)),
        top: LengthPercentage::length(s.border_width.top.unwrap_or(0.0)),
        bottom: LengthPercentage::length(s.border_width.bottom.unwrap_or(0.0)),
    };
    t.flex_direction = match s.flex_direction {
        Some(ps::FlexDirection::Row) => FlexDirection::Row,
        Some(ps::FlexDirection::RowReverse) => FlexDirection::RowReverse,
        Some(ps::FlexDirection::ColumnReverse) => FlexDirection::ColumnReverse,
        Some(ps::FlexDirection::Column) => FlexDirection::Column,
        None if node.kind == NodeKind::Scroll && node.props.horizontal => FlexDirection::Row,
        None => FlexDirection::Column,
    };
    t.flex_wrap = match s.flex_wrap {
        Some(ps::FlexWrap::Wrap) => FlexWrap::Wrap,
        Some(ps::FlexWrap::WrapReverse) => FlexWrap::WrapReverse,
        _ => FlexWrap::NoWrap,
    };
    t.justify_content = match s.justify_content {
        Some(ps::JustifyContent::FlexEnd) => JustifyContent::FLEX_END,
        Some(ps::JustifyContent::Center) => JustifyContent::CENTER,
        Some(ps::JustifyContent::SpaceBetween) => JustifyContent::SPACE_BETWEEN,
        Some(ps::JustifyContent::SpaceAround) => JustifyContent::SPACE_AROUND,
        Some(ps::JustifyContent::SpaceEvenly) => JustifyContent::SPACE_EVENLY,
        Some(ps::JustifyContent::Start) => JustifyContent::START,
        Some(ps::JustifyContent::End) => JustifyContent::END,
        _ => JustifyContent::FLEX_START,
    };
    t.align_items = match s.align_items {
        Some(ps::AlignItems::FlexStart) => AlignItems::FLEX_START,
        Some(ps::AlignItems::FlexEnd) => AlignItems::FLEX_END,
        Some(ps::AlignItems::Center) => AlignItems::CENTER,
        Some(ps::AlignItems::Baseline) => AlignItems::BASELINE,
        Some(ps::AlignItems::Start) => AlignItems::START,
        Some(ps::AlignItems::End) => AlignItems::END,
        _ => AlignItems::STRETCH,
    };
    t.align_self = match s.align_self {
        Some(ps::AlignSelf::FlexStart) => Some(AlignSelf::FLEX_START),
        Some(ps::AlignSelf::FlexEnd) => Some(AlignSelf::FLEX_END),
        Some(ps::AlignSelf::Center) => Some(AlignSelf::CENTER),
        Some(ps::AlignSelf::Stretch) => Some(AlignSelf::STRETCH),
        Some(ps::AlignSelf::Baseline) => Some(AlignSelf::BASELINE),
        Some(ps::AlignSelf::Start) => Some(AlignSelf::START),
        Some(ps::AlignSelf::End) => Some(AlignSelf::END),
        // An icon has an intrinsic size: it does not stretch across its parent.
        _ if node.kind == NodeKind::Icon => Some(AlignSelf::FLEX_START),
        _ => None,
    };
    t.align_content = match s.align_content {
        Some(ps::AlignContent::Stretch) => AlignContent::STRETCH,
        Some(ps::AlignContent::Center) => AlignContent::CENTER,
        Some(ps::AlignContent::FlexEnd) => AlignContent::FLEX_END,
        Some(ps::AlignContent::SpaceBetween) => AlignContent::SPACE_BETWEEN,
        Some(ps::AlignContent::SpaceAround) => AlignContent::SPACE_AROUND,
        Some(ps::AlignContent::SpaceEvenly) => AlignContent::SPACE_EVENLY,
        Some(ps::AlignContent::Start) => AlignContent::START,
        Some(ps::AlignContent::End) => AlignContent::END,
        _ => AlignContent::FLEX_START,
    };
    t.flex_grow = s.flex_grow.unwrap_or(0.0);
    t.flex_shrink = s.flex_shrink.unwrap_or(0.0);
    t.flex_basis = dim(s.flex_basis);
    t.gap = Size {
        width: LengthPercentage::length(s.column_gap.unwrap_or(0.0)),
        height: LengthPercentage::length(s.row_gap.unwrap_or(0.0)),
    };
    t.aspect_ratio = s.aspect_ratio;
    let scroll_x = node.kind == NodeKind::Scroll && node.props.horizontal;
    let scroll_y = node.kind == NodeKind::Scroll && !node.props.horizontal;
    t.overflow = TPoint {
        x: overflow(s.overflow, scroll_x),
        y: overflow(s.overflow, scroll_y),
    };
    if let Some(cols) = &s.grid_template_columns {
        t.grid_template_columns = cols.iter().map(track).collect();
    }
    if let Some(rows) = &s.grid_template_rows {
        t.grid_template_rows = rows.iter().map(track).collect();
    }
    t.grid_column = TLine {
        start: placement(s.grid_column_start),
        end: placement(s.grid_column_end),
    };
    t.grid_row = TLine {
        start: placement(s.grid_row_start),
        end: placement(s.grid_row_end),
    };
    t
}

fn root_style(id: NodeId) -> taffy::Style {
    let mut t = taffy::Style::default();
    t.flex_direction = FlexDirection::Column;
    if id == ROOT_ID {
        t.size = Size {
            width: Dimension::length(SCREEN_WIDTH as f32),
            height: Dimension::length(SCREEN_HEIGHT as f32),
        };
    } else {
        t.position = taffy::Position::Absolute;
        t.inset = TRect {
            left: LengthPercentageAuto::length(0.0),
            right: LengthPercentageAuto::length(0.0),
            top: LengthPercentageAuto::length(0.0),
            bottom: LengthPercentageAuto::length(0.0),
        };
        t.size = Size {
            width: Dimension::percent(1.0),
            height: Dimension::percent(1.0),
        };
    }
    t
}

/// Display string of an `Input` node: the value (`•` per char when secure) or
/// the placeholder.
pub fn input_display(node: &Node) -> (String, bool) {
    if node.props.value.is_empty() {
        (node.props.placeholder.clone(), true)
    } else if node.props.secure {
        ("•".repeat(node.props.value.chars().count()), false)
    } else {
        (node.props.value.clone(), false)
    }
}

impl Engine {
    pub(crate) fn create_taffy_node(&mut self, id: NodeId) {
        let Some(node) = self.tree.get(id) else {
            return;
        };
        if node.kind == NodeKind::RawText {
            return;
        }
        let style = if id == ROOT_ID || id == OVERLAY_ID {
            root_style(id)
        } else {
            to_taffy(node)
        };
        if let Ok(t) = self.layout.taffy.new_leaf_with_context(style, id) {
            self.layout.map.insert(id, t);
            if let Some(n) = self.tree.get_mut(id) {
                n.taffy = Some(t);
            }
            if matches!(
                self.tree.get(id).map(|n| n.kind),
                Some(NodeKind::Text | NodeKind::Input)
            ) {
                self.layout.text_dirty.push(id);
            }
            self.layout.needs = true;
        }
    }

    /// Run layout if anything affecting it changed.
    pub(crate) fn update_layout(&mut self) {
        if !self.layout.needs {
            return;
        }
        self.layout.needs = false;
        self.refresh_text_data();
        self.sync_structure();
        let dirty = std::mem::take(&mut self.layout.style_dirty);
        for id in dirty {
            let Some(node) = self.tree.get(id) else {
                continue;
            };
            let Some(t) = node.taffy else { continue };
            let style = if id == ROOT_ID || id == OVERLAY_ID {
                root_style(id)
            } else {
                to_taffy(node)
            };
            let _ = self.layout.taffy.set_style(t, style);
        }
        let Some(root) = self.tree.get(ROOT_ID).and_then(|n| n.taffy) else {
            return;
        };
        {
            let tree = &self.tree;
            let text = &mut self.text;
            let images = &self.images;
            let avail = Size {
                width: AvailableSpace::Definite(SCREEN_WIDTH as f32),
                height: AvailableSpace::Definite(SCREEN_HEIGHT as f32),
            };
            let _ = self.layout.taffy.compute_layout_with_measure(
                root,
                avail,
                |inputs, _t, ctx, style| {
                    measure_leaf(tree, text, images, inputs, ctx.copied(), style)
                },
            );
        }
        self.read_back_layout();
        self.free_orphans();
        self.scene_dirty = true;
        self.focus.dirty = true;
    }

    /// (Re)build the content and style of text nodes whose text changed.
    fn refresh_text_data(&mut self) {
        let ids = std::mem::take(&mut self.layout.text_dirty);
        for id in ids {
            let Some(node) = self.tree.get(id) else {
                continue;
            };
            if node.text_data.is_some() {
                continue;
            }
            let data = match node.kind {
                NodeKind::Text => TextData {
                    content: self.tree.collect_text(id),
                    style: TextStyle::from_style(&node.cur, node.props.number_of_lines),
                },
                NodeKind::Input => {
                    let (text, _) = input_display(node);
                    TextData {
                        content: TextContent::plain(&text),
                        style: TextStyle::from_style(&node.cur, 1),
                    }
                }
                _ => continue,
            };
            if let Some(n) = self.tree.get_mut(id) {
                n.text_data = Some(Arc::new(data));
            }
        }
    }

    /// Free the orphaned taffy nodes that no `hoisted_children` list refers to
    /// (see [`LayoutState::orphans`]). Orphans' own lists count too: a still
    /// referenced orphan subtree is walked by `round_layout`.
    fn free_orphans(&mut self) {
        if self.layout.orphans.is_empty() {
            return;
        }
        let taffy = &self.layout.taffy;
        let mut referenced: FxSet<taffy::NodeId> = FxSet::default();
        let live = self.tree.nodes.values().filter_map(|n| n.taffy);
        for t in live.chain(self.layout.orphans.iter().copied()) {
            if let Ok(hoisted) = taffy.hoisted_children(t) {
                referenced.extend(hoisted.iter().copied());
            }
        }
        let taffy = &mut self.layout.taffy;
        self.layout.orphans.retain(|t| {
            if referenced.contains(t) {
                return true;
            }
            let _ = taffy.remove(*t);
            false
        });
    }

    fn sync_structure(&mut self) {
        let mut parents = std::mem::take(&mut self.layout.struct_dirty);
        parents.sort_unstable();
        parents.dedup();
        let live: Vec<NodeId> = parents
            .into_iter()
            .filter(|p| self.tree.get(*p).is_some_and(|n| n.taffy.is_some()))
            .collect();
        // Pass 1 clears stale links (a child may have moved between two dirty parents).
        for p in &live {
            if let Some(t) = self.tree.get(*p).and_then(|n| n.taffy) {
                let _ = self.layout.taffy.set_children(t, &[]);
            }
        }
        for p in &live {
            let Some(node) = self.tree.get(*p) else {
                continue;
            };
            let Some(t) = node.taffy else { continue };
            // A `Text` is a measured leaf: its children are content, not layout nodes.
            let kids: Vec<taffy::NodeId> = if matches!(node.kind, NodeKind::Text | NodeKind::Input)
            {
                Vec::new()
            } else {
                node.children
                    .iter()
                    .filter_map(|c| self.tree.get(*c).and_then(|n| n.taffy))
                    .collect()
            };
            let _ = self.layout.taffy.set_children(t, &kids);
        }
    }

    fn read_back_layout(&mut self) {
        let mut stack: Vec<NodeId> = vec![ROOT_ID];
        let mut events: Vec<UiEvent> = Vec::new();
        while let Some(id) = stack.pop() {
            let (parent_abs, parent_scroll) = match self
                .tree
                .get(id)
                .and_then(|n| n.parent)
                .and_then(|p| self.tree.get(p))
            {
                Some(p) => ((p.abs.x, p.abs.y), p.scroll),
                None => ((0.0, 0.0), (0.0, 0.0)),
            };
            let Some(node) = self.tree.get_mut(id) else {
                continue;
            };
            if let Some(t) = node.taffy {
                if let Ok(l) = self.layout.taffy.layout(t) {
                    let rect = Rect::new(l.location.x, l.location.y, l.size.width, l.size.height);
                    node.rect = rect;
                    node.abs = Rect::new(
                        parent_abs.0 + rect.x - parent_scroll.0,
                        parent_abs.1 + rect.y - parent_scroll.1,
                        rect.w,
                        rect.h,
                    );
                    node.inset = [
                        l.border.left + l.padding.left,
                        l.border.top + l.padding.top,
                        l.border.right + l.padding.right,
                        l.border.bottom + l.padding.bottom,
                    ];
                    if node.kind == NodeKind::Scroll {
                        let so = l.scrollable_overflow_rect;
                        let pad_w = rect.w - l.border.left - l.border.right;
                        let pad_h = rect.h - l.border.top - l.border.bottom;
                        node.viewport = (pad_w, pad_h);
                        node.content = (so.right.max(pad_w), so.bottom.max(pad_h));
                        let max_x = (node.content.0 - pad_w).max(0.0);
                        let max_y = (node.content.1 - pad_h).max(0.0);
                        node.scroll = (
                            node.scroll.0.clamp(0.0, max_x),
                            node.scroll.1.clamp(0.0, max_y),
                        );
                    }
                    if node.last_layout_event != Some(rect) {
                        node.last_layout_event = Some(rect);
                        if node.subscribed(EventKind::Layout.bit()) {
                            events.push(UiEvent::with_payload(
                                id,
                                EventKind::Layout,
                                rect.to_value(),
                            ));
                        }
                    }
                }
            } else {
                node.rect = Rect::default();
                node.abs = Rect::new(parent_abs.0, parent_abs.1, 0.0, 0.0);
            }
            let node = &self.tree.nodes[&id];
            stack.extend(node.children.iter().rev().copied());
        }
        self.events.extend(events);
    }
}

fn measure_leaf(
    tree: &Tree,
    text: &mut TextSystem,
    images: &crate::images::ImageStore,
    inputs: LayoutInput,
    ctx: Option<NodeId>,
    style: &taffy::Style,
) -> LayoutOutput {
    let Some(id) = ctx.and_then(|id| tree.get(id)) else {
        return taffy::compute_leaf_layout(inputs, style, |_, _| 0.0, |_, _| Size::ZERO);
    };
    taffy::compute_leaf_layout(
        inputs,
        style,
        |_, _| 0.0,
        |known, avail| match id.kind {
            NodeKind::Text | NodeKind::Input => {
                let Some(data) = &id.text_data else {
                    return Size::ZERO;
                };
                let single_line = id.kind == NodeKind::Input;
                let width = match (known.width, avail.width) {
                    (Some(w), _) => Some(w),
                    (None, AvailableSpace::Definite(w)) => Some(w),
                    (None, AvailableSpace::MaxContent) => None,
                    (None, AvailableSpace::MinContent) => Some(0.0),
                };
                let (w, h) = if single_line {
                    text.measure(&data.content, &data.style, None)
                } else if matches!(avail.width, AvailableSpace::MinContent) && known.width.is_none()
                {
                    text.measure_min_content(&data.content, &data.style)
                } else {
                    text.measure(&data.content, &data.style, width)
                };
                let h = if single_line {
                    h.max(data.style.line_height)
                } else {
                    h
                };
                Size {
                    width: known.width.unwrap_or(w),
                    height: known.height.unwrap_or(h),
                }
            }
            NodeKind::Image => {
                let (nw, nh) = id
                    .props
                    .src
                    .as_deref()
                    .and_then(|s| images.size(s))
                    .unwrap_or((0, 0));
                let (nw, nh) = (nw as f32, nh as f32);
                match (known.width, known.height) {
                    (Some(w), Some(h)) => Size {
                        width: w,
                        height: h,
                    },
                    (Some(w), None) => Size {
                        width: w,
                        height: if nw > 0.0 { w * nh / nw } else { 0.0 },
                    },
                    (None, Some(h)) => Size {
                        width: if nh > 0.0 { h * nw / nh } else { 0.0 },
                        height: h,
                    },
                    (None, None) => Size {
                        width: nw,
                        height: nh,
                    },
                }
            }
            NodeKind::Icon => Size {
                width: known.width.unwrap_or(id.props.size),
                height: known.height.unwrap_or(id.props.size),
            },
            _ => Size::ZERO,
        },
    )
}
