//! pk-engine: the ProsperoKit UI engine. Pure Rust, platform independent:
//! it applies React mutation commits to a shadow tree, lays it out with taffy,
//! shapes text with cosmic-text, rasterises dirty 128×128 tiles into a
//! caller-owned `&mut [u32]` frame with tiny-skia, and runs the spatial focus
//! engine, input mapping, scrolling, transitions, image cache and overlays.
//!
//! Frame loop (driven by `pk-runtime`): `apply_commit` for every JS commit,
//! then once per frame `tick(pad, now_ms)` (events out), then `render(frame)`
//! (dirty tiles out). An idle frame produces an empty `TileSet`.

// Deliberate style choices: nested `if let` + condition reads better than let-chains in the
// engine's event code, taffy styles are built by assignment, and the animation entry points
// take the full set of run parameters.
#![allow(
    clippy::collapsible_if,
    clippy::field_reassign_with_default,
    clippy::too_many_arguments,
    clippy::chunks_exact_to_as_chunks
)]

pub mod anim;
pub mod display;
pub mod focus;
pub mod hash;
pub mod images;
pub mod input;
pub mod layout;
pub mod lru;
pub mod overlay;
pub mod raster;
pub mod scroll;
pub mod style_resolve;
pub mod svgpath;
pub mod text;
pub mod tree;

#[cfg(test)]
mod tests;

use std::sync::Arc;

use pk_platform::PadSnapshot;
use pk_protocol::events::UiEvent;
use pk_protocol::props::{OVERLAY_ID, ROOT_ID};
use pk_protocol::{NodeId, Rect, ResolvedClasses, StyleTable, TileSet};

pub use images::DecodedImage;

use crate::hash::FxMap;
use crate::tree::{Node, Tree};

/// Engine construction options.
#[derive(Clone, Debug, Default)]
pub struct EngineConfig {
    /// Extra font files `(file name, data)` from `/app0/fonts/*.ttf`; selectable by `fontFamily`.
    pub extra_fonts: Vec<(String, Vec<u8>)>,
    /// Emit `SoundCue`s for focus moves, presses, back and boundary hits.
    pub ui_sounds: bool,
    /// Development build (reserved for dev-only behaviour; no effect on rendering).
    pub dev: bool,
}

/// Built-in UI sounds the runtime should play.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SoundCue {
    Navigate,
    Select,
    Back,
    Error,
}

/// Everything one `tick` produces for the runtime.
#[derive(Debug, Default)]
pub struct FrameOutput {
    /// Events for `__pk_dispatch`.
    pub events: Vec<UiEvent>,
    /// Replies to measure ops: `(callback id, screen-space rect)`.
    pub measures: Vec<(u32, Rect)>,
    pub sounds: Vec<SoundCue>,
    /// True when tiles are dirty: call `render`.
    pub needs_render: bool,
}

/// Timings the runtime feeds back for the dev stats overlay.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct FrameStats {
    pub frame_ms: f32,
    pub raster_ms: f32,
    pub dirty_tiles: u32,
    pub js_commit_ms: f32,
}

/// The host-drawn text-entry overlay (desktop only; the console uses the system dialog).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ImeOverlay {
    pub title: String,
    pub text: String,
    pub placeholder: String,
    pub secure: bool,
}

pub struct Engine {
    pub(crate) cfg: EngineConfig,
    pub(crate) tree: Tree,
    pub(crate) table: StyleTable,
    pub(crate) class_cache: FxMap<Vec<u32>, Arc<ResolvedClasses>>,
    pub(crate) layout: layout::LayoutState,
    pub(crate) text: text::TextSystem,
    pub(crate) images: images::ImageStore,
    pub(crate) focus: focus::FocusState,
    pub(crate) input: input::InputState,
    pub(crate) overlay: overlay::OverlayState,
    pub(crate) rasterizer: raster::Rasterizer,
    /// The display list of the last prepared scene.
    pub(crate) list: display::DisplayList,
    /// Tiles damaged since the last `render`.
    pub(crate) dirty: TileSet,
    pub(crate) scene_dirty: bool,
    pub(crate) now_ms: f64,
    pub(crate) last_tick: Option<f64>,
    pub(crate) animating: Vec<NodeId>,
    pub(crate) events: Vec<UiEvent>,
    pub(crate) sounds: Vec<SoundCue>,
    pub(crate) pending_measures: Vec<(u32, NodeId)>,
    pub(crate) pending_scroll_to: Vec<(NodeId, f32, f32, bool)>,
    pub(crate) pending_autofocus: Vec<NodeId>,
    pub(crate) pending_reveal: Option<NodeId>,
    pub(crate) scroll_dirty: Vec<NodeId>,
}

impl Engine {
    pub fn new(cfg: EngineConfig) -> Engine {
        let text = text::TextSystem::new(&cfg.extra_fonts);
        let mut e = Engine {
            cfg,
            tree: Tree::default(),
            table: StyleTable::default(),
            class_cache: FxMap::default(),
            layout: layout::LayoutState::new(),
            text,
            images: images::ImageStore::new(),
            focus: focus::FocusState::default(),
            input: input::InputState::default(),
            overlay: overlay::OverlayState::default(),
            rasterizer: raster::Rasterizer::new(),
            list: display::DisplayList::default(),
            dirty: TileSet::empty(),
            scene_dirty: true,
            now_ms: 0.0,
            last_tick: None,
            animating: Vec::new(),
            events: Vec::new(),
            sounds: Vec::new(),
            pending_measures: Vec::new(),
            pending_scroll_to: Vec::new(),
            pending_autofocus: Vec::new(),
            pending_reveal: None,
            scroll_dirty: Vec::new(),
        };
        e.create_roots();
        e
    }

    fn create_roots(&mut self) {
        for (id, kind) in [
            (ROOT_ID, pk_protocol::ops::NodeKind::View),
            (OVERLAY_ID, pk_protocol::ops::NodeKind::View),
        ] {
            self.tree.nodes.insert(id, Node::new(id, kind));
            self.create_taffy_node(id);
        }
        if let Some(r) = self.tree.get_mut(ROOT_ID) {
            r.children.push(OVERLAY_ID);
        }
        if let Some(o) = self.tree.get_mut(OVERLAY_ID) {
            o.parent = Some(ROOT_ID);
        }
        self.layout.struct_dirty.push(ROOT_ID);
        self.layout.needs = true;
        for id in [ROOT_ID, OVERLAY_ID] {
            self.restyle(id, false);
        }
    }

    /// Drop the whole app tree (bundle reload) and repaint from scratch. Fonts,
    /// decoded images and the glyph cache survive; the style table does not.
    pub fn reset(&mut self) {
        for root in [ROOT_ID, OVERLAY_ID] {
            let kids: Vec<NodeId> = self
                .tree
                .get(root)
                .map(|n| n.children.clone())
                .unwrap_or_default();
            for k in kids {
                if k == OVERLAY_ID {
                    continue;
                }
                self.detach(k);
                self.destroy_subtree(k);
            }
            if let Some(n) = self.tree.get_mut(root) {
                n.props = pk_protocol::Props::default();
                n.state = tree::NodeState::default();
                n.anim = anim::NodeAnim::default();
                n.classes = None;
            }
            self.restyle(root, false);
        }
        self.table = StyleTable::default();
        self.class_cache.clear();
        self.focus = focus::FocusState::default();
        self.input = input::InputState::default();
        self.animating.clear();
        self.events.clear();
        self.sounds.clear();
        self.pending_measures.clear();
        self.pending_scroll_to.clear();
        self.pending_autofocus.clear();
        self.pending_reveal = None;
        self.scroll_dirty.clear();
        self.images.clear_pending();
        self.overlay.reset_transient();
        self.list = display::DisplayList::default();
        self.dirty = TileSet::full();
        self.layout.needs = true;
        self.scene_dirty = true;
    }

    /// Advance one frame: input, animations, layout, focus, scene damage.
    pub fn tick(&mut self, pad: &PadSnapshot, now_ms: f64) -> FrameOutput {
        let dt = self
            .last_tick
            .map_or(0.0, |l| (now_ms - l).clamp(0.0, 100.0));
        self.last_tick = Some(now_ms);
        self.now_ms = now_ms;
        if self.overlay.expire(now_ms) {
            self.scene_dirty = true;
        }
        self.update_layout();
        self.run_pending_scrolls();
        self.focus_fix();
        self.process_input(pad, now_ms, dt);
        let mut ended = Vec::new();
        self.tick_animations(now_ms, &mut ended);
        self.events.extend(ended);
        self.update_layout();
        self.focus_fix();
        self.flush_scroll_events();
        self.prepare_scene();
        let measures = std::mem::take(&mut self.pending_measures)
            .into_iter()
            .map(|(cb, id)| (cb, self.tree.get(id).map(|n| n.abs).unwrap_or_default()))
            .collect();
        FrameOutput {
            events: std::mem::take(&mut self.events),
            measures,
            sounds: std::mem::take(&mut self.sounds),
            needs_render: !self.dirty.is_empty(),
        }
    }

    /// Rasterise the dirty tiles into `frame` (1920×1080, bytes R,G,B,A per pixel,
    /// premultiplied) and return which tiles were written. Empty when idle.
    pub fn render(&mut self, frame: &mut [u32]) -> TileSet {
        self.update_layout();
        self.prepare_scene();
        let dirty = std::mem::take(&mut self.dirty);
        if dirty.is_empty() {
            return dirty;
        }
        self.rasterizer.render(&self.list, &dirty, frame);
        dirty
    }

    fn run_pending_scrolls(&mut self) {
        let pending = std::mem::take(&mut self.pending_scroll_to);
        for (id, x, y, animated) in pending {
            self.scroll_to(id, x, y, animated);
        }
    }

    /// Rebuild the display list if the scene changed and add the damage to `dirty`.
    fn prepare_scene(&mut self) {
        if !self.scene_dirty {
            return;
        }
        self.scene_dirty = false;
        let mut builder = display::Builder::new(&mut self.tree, &mut self.text, &mut self.images);
        builder.build_tree();
        self.overlay.emit(&mut builder);
        let new = builder.list;
        let old = std::mem::replace(&mut self.list, new);
        display::diff(&old.cmds, &self.list.cmds, &mut self.dirty);
    }
}
