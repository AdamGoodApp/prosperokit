//! Display list (Phase 3 §5): after layout the tree is walked in paint order
//! (z-index-sorted siblings; `overflow: hidden|scroll` pushes a rounded clip;
//! transforms compose about each node's centre; `opacity < 1` on a node with
//! children becomes an offscreen layer) producing `DrawCmd`s with screen-space
//! bounding boxes and content signatures. Damage is found by diffing the new
//! list against the previous one (`diff`), so every cause of a visual change —
//! style, layout, scroll, animation, focus ring, overlays — is covered by one
//! mechanism.

use std::sync::Arc;

use pk_protocol::ops::NodeKind;
use pk_protocol::props::{OVERLAY_ID, ROOT_ID};
use pk_protocol::style::{Gradient, ResizeMode};
use pk_protocol::{Color, NodeId, Rect, SCREEN_HEIGHT, SCREEN_WIDTH, TileSet};
use tiny_skia::{Pixmap, Transform};

use crate::anim::Xform;
use crate::hash::{Fx, FxMap};
use crate::images::ImageStore;
use crate::layout::{ROOT_BACKGROUND, input_display};
use crate::text::{GlyphBitmap, GlyphKey, TextRun, TextSystem, size_to_64, split_subpixel};
use crate::tree::{IconGeom, Tree};

pub type ClipId = u32;
pub const NO_CLIP: ClipId = u32::MAX;

/// Per-corner elliptical radii: top-left, top-right, bottom-right, bottom-left.
pub type Radii = [(f32, f32); 4];
pub const NO_RADII: Radii = [(0.0, 0.0); 4];

pub fn circ(r: [f32; 4]) -> Radii {
    [(r[0], r[0]), (r[1], r[1]), (r[2], r[2]), (r[3], r[3])]
}

pub fn radii_is_zero(r: &Radii) -> bool {
    r.iter().all(|(a, b)| *a <= 0.0 && *b <= 0.0)
}

/// Integer screen rectangle `[x0, x1) × [y0, y1)`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct IRect {
    pub x0: i32,
    pub y0: i32,
    pub x1: i32,
    pub y1: i32,
}

impl IRect {
    pub const EMPTY: IRect = IRect {
        x0: 0,
        y0: 0,
        x1: 0,
        y1: 0,
    };
    pub const SCREEN: IRect = IRect {
        x0: 0,
        y0: 0,
        x1: SCREEN_WIDTH as i32,
        y1: SCREEN_HEIGHT as i32,
    };

    pub fn is_empty(&self) -> bool {
        self.x1 <= self.x0 || self.y1 <= self.y0
    }

    pub fn intersect(&self, o: &IRect) -> IRect {
        IRect {
            x0: self.x0.max(o.x0),
            y0: self.y0.max(o.y0),
            x1: self.x1.min(o.x1),
            y1: self.y1.min(o.y1),
        }
    }

    pub fn union(&self, o: &IRect) -> IRect {
        if self.is_empty() {
            return *o;
        }
        if o.is_empty() {
            return *self;
        }
        IRect {
            x0: self.x0.min(o.x0),
            y0: self.y0.min(o.y0),
            x1: self.x1.max(o.x1),
            y1: self.y1.max(o.y1),
        }
    }

    pub fn to_rect(&self) -> Rect {
        Rect::new(
            self.x0 as f32,
            self.y0 as f32,
            (self.x1 - self.x0) as f32,
            (self.y1 - self.y0) as f32,
        )
    }
}

/// Axis-aligned bounds of `r` mapped through `xf`, rounded outwards (`pad` extra px for AA).
pub fn aabb(r: Rect, xf: &Transform, pad: f32) -> IRect {
    let pts = [
        (r.x, r.y),
        (r.right(), r.y),
        (r.right(), r.bottom()),
        (r.x, r.bottom()),
    ];
    let (mut x0, mut y0, mut x1, mut y1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
    for (px, py) in pts {
        let x = xf.sx * px + xf.kx * py + xf.tx;
        let y = xf.ky * px + xf.sy * py + xf.ty;
        x0 = x0.min(x);
        y0 = y0.min(y);
        x1 = x1.max(x);
        y1 = y1.max(y);
    }
    IRect {
        x0: (x0 - pad).floor() as i32,
        y0: (y0 - pad).floor() as i32,
        x1: (x1 + pad).ceil() as i32,
        y1: (y1 + pad).ceil() as i32,
    }
}

pub fn translation_only(xf: &Transform) -> Option<(f32, f32)> {
    (xf.sx == 1.0 && xf.sy == 1.0 && xf.kx == 0.0 && xf.ky == 0.0).then_some((xf.tx, xf.ty))
}

/// Uniform scale + translation (no rotation/skew).
pub fn uniform_scale(xf: &Transform) -> Option<(f32, f32, f32)> {
    (xf.kx == 0.0 && xf.ky == 0.0 && xf.sx > 0.0 && (xf.sx - xf.sy).abs() < 1e-4)
        .then_some((xf.sx, xf.tx, xf.ty))
}

#[derive(Clone, Debug)]
pub enum Fill {
    Color(Color),
    Gradient(Arc<Gradient>),
}

#[derive(Clone, Debug)]
pub struct GlyphItem {
    pub bitmap: Arc<GlyphBitmap>,
    pub x: i32,
    pub y: i32,
    /// The glyph's span colour (nested `Text`); `None` uses the run colour.
    pub color: Option<Color>,
}

#[derive(Clone, Debug)]
pub enum CmdKind {
    Fill {
        rect: Rect,
        radii: Radii,
        fill: Fill,
    },
    Shadow {
        rect: Rect,
        radii: Radii,
        color: Color,
        blur: f32,
        offset: (f32, f32),
    },
    /// Area between two rounded rects (uniform borders and focus rings).
    Ring {
        outer: Rect,
        outer_r: Radii,
        inner: Rect,
        inner_r: Radii,
        color: Color,
    },
    /// Per-side border colours.
    Border {
        rect: Rect,
        radii: Radii,
        widths: [f32; 4],
        colors: [Color; 4],
    },
    Image {
        pixmap: Arc<Pixmap>,
        dst: Rect,
        src: Rect,
        radii: Radii,
        tint: Option<Color>,
    },
    /// Translation-only text: glyph bitmaps blitted at integer offsets.
    Glyphs {
        run: Arc<TextRun>,
        ox: i32,
        oy: i32,
        color: Color,
    },
    /// Pre-resolved glyph bitmaps in screen space (uniformly scaled text).
    GlyphItems {
        items: Vec<GlyphItem>,
        color: Color,
    },
    /// Text under a rotation/skew: bitmaps drawn through the command's transform.
    GlyphsXf {
        run: Arc<TextRun>,
        ox: f32,
        oy: f32,
        color: Color,
    },
    Icon {
        geoms: Arc<Vec<IconGeom>>,
        origin: (f32, f32),
        scale: f32,
        color: Color,
    },
    PushLayer {
        opacity: f32,
    },
    PopLayer {
        opacity: f32,
    },
}

#[derive(Clone, Debug)]
pub struct DrawCmd {
    pub kind: CmdKind,
    pub bbox: IRect,
    pub xf: Transform,
    pub clip: ClipId,
    pub opacity: f32,
    pub sig: u64,
}

#[derive(Clone, Debug)]
pub struct Clip {
    pub rect: Rect,
    pub radii: Radii,
    pub xf: Transform,
    pub parent: ClipId,
    /// Screen-space bounds (already intersected with the parent's).
    pub bounds: IRect,
    /// Pixel-aligned axis-aligned rectangle: applied by zeroing rows instead of rasterising a path.
    pub simple: Option<IRect>,
    pub sig: u64,
}

#[derive(Default)]
pub struct DisplayList {
    pub cmds: Vec<DrawCmd>,
    pub clips: Vec<Clip>,
}

fn hash_color(h: &mut Fx, c: &Color) {
    h.u32(c.to_rgba_u32());
}

fn hash_rect(h: &mut Fx, r: &Rect) {
    h.f32(r.x).f32(r.y).f32(r.w).f32(r.h);
}

fn hash_radii(h: &mut Fx, r: &Radii) {
    for (a, b) in r {
        h.f32(*a).f32(*b);
    }
}

fn hash_xf(h: &mut Fx, t: &Transform) {
    h.f32(t.sx)
        .f32(t.kx)
        .f32(t.ky)
        .f32(t.sy)
        .f32(t.tx)
        .f32(t.ty);
}

fn kind_sig(kind: &CmdKind) -> u64 {
    let mut h = Fx::new();
    match kind {
        CmdKind::Fill { rect, radii, fill } => {
            h.u32(1);
            hash_rect(&mut h, rect);
            hash_radii(&mut h, radii);
            match fill {
                Fill::Color(c) => hash_color(&mut h, c),
                Fill::Gradient(g) => {
                    h.f32(g.angle_deg);
                    for (o, c) in &g.stops {
                        h.f32(*o);
                        hash_color(&mut h, c);
                    }
                }
            }
        }
        CmdKind::Shadow {
            rect,
            radii,
            color,
            blur,
            offset,
        } => {
            h.u32(2);
            hash_rect(&mut h, rect);
            hash_radii(&mut h, radii);
            hash_color(&mut h, color);
            h.f32(*blur).f32(offset.0).f32(offset.1);
        }
        CmdKind::Ring {
            outer,
            outer_r,
            inner,
            inner_r,
            color,
        } => {
            h.u32(3);
            hash_rect(&mut h, outer);
            hash_radii(&mut h, outer_r);
            hash_rect(&mut h, inner);
            hash_radii(&mut h, inner_r);
            hash_color(&mut h, color);
        }
        CmdKind::Border {
            rect,
            radii,
            widths,
            colors,
        } => {
            h.u32(4);
            hash_rect(&mut h, rect);
            hash_radii(&mut h, radii);
            for w in widths {
                h.f32(*w);
            }
            for c in colors {
                hash_color(&mut h, c);
            }
        }
        CmdKind::Image {
            pixmap,
            dst,
            src,
            radii,
            tint,
        } => {
            h.u32(5).u64(Arc::as_ptr(pixmap) as usize as u64);
            hash_rect(&mut h, dst);
            hash_rect(&mut h, src);
            hash_radii(&mut h, radii);
            if let Some(t) = tint {
                hash_color(&mut h, t);
            }
        }
        CmdKind::Glyphs { run, ox, oy, color } => {
            h.u32(6)
                .u64(Arc::as_ptr(run) as usize as u64)
                .u32(*ox as u32)
                .u32(*oy as u32);
            hash_color(&mut h, color);
        }
        CmdKind::GlyphItems { items, color } => {
            h.u32(7);
            for i in items {
                h.u64(Arc::as_ptr(&i.bitmap) as usize as u64)
                    .u32(i.x as u32)
                    .u32(i.y as u32);
                if let Some(c) = &i.color {
                    hash_color(&mut h, c);
                }
            }
            hash_color(&mut h, color);
        }
        CmdKind::GlyphsXf { run, ox, oy, color } => {
            h.u32(8)
                .u64(Arc::as_ptr(run) as usize as u64)
                .f32(*ox)
                .f32(*oy);
            hash_color(&mut h, color);
        }
        CmdKind::Icon {
            geoms,
            origin,
            scale,
            color,
        } => {
            h.u32(9)
                .u64(Arc::as_ptr(geoms) as usize as u64)
                .f32(origin.0)
                .f32(origin.1)
                .f32(*scale);
            hash_color(&mut h, color);
        }
        CmdKind::PushLayer { opacity } => {
            h.u32(10).f32(*opacity);
        }
        CmdKind::PopLayer { .. } => {
            h.u32(11);
        }
    }
    h.done()
}

#[derive(Clone, Copy)]
struct Ctx {
    xf: Transform,
    clip: ClipId,
}

pub fn node_local_xf(abs: Rect, x: &Xform) -> Transform {
    let (cx, cy) = abs.center();
    Transform::from_translate(cx + x.tx, cy + x.ty)
        .pre_rotate(x.rot)
        .pre_scale(x.sx, x.sy)
        .pre_translate(-cx, -cy)
}

fn clamp_radii(r: [f32; 4], w: f32, h: f32) -> [f32; 4] {
    let [tl, tr, br, bl] = r.map(|v| v.max(0.0));
    let mut f = 1.0f32;
    for (sum, len) in [(tl + tr, w), (bl + br, w), (tl + bl, h), (tr + br, h)] {
        if sum > len && sum > 0.0 {
            f = f.min(len / sum);
        }
    }
    [tl * f, tr * f, br * f, bl * f]
}

pub struct Builder<'a> {
    pub tree: &'a mut Tree,
    pub text: &'a mut TextSystem,
    pub images: &'a mut ImageStore,
    pub list: DisplayList,
}

impl<'a> Builder<'a> {
    pub fn new(
        tree: &'a mut Tree,
        text: &'a mut TextSystem,
        images: &'a mut ImageStore,
    ) -> Builder<'a> {
        Builder {
            tree,
            text,
            images,
            list: DisplayList::default(),
        }
    }

    fn clip_sig(&self, c: ClipId) -> u64 {
        if c == NO_CLIP {
            0
        } else {
            self.list.clips[c as usize].sig
        }
    }

    pub fn clip_bounds(&self, c: ClipId) -> IRect {
        if c == NO_CLIP {
            IRect::SCREEN
        } else {
            self.list.clips[c as usize].bounds
        }
    }

    pub fn push_clip(&mut self, rect: Rect, radii: Radii, xf: Transform, parent: ClipId) -> ClipId {
        let pad = if xf.is_identity() { 0.0 } else { 1.0 };
        let bounds = aabb(rect, &xf, pad).intersect(&self.clip_bounds(parent));
        let simple = if radii_is_zero(&radii) {
            translation_only(&xf).and_then(|(tx, ty)| {
                let (x, y, r, b) = (
                    rect.x + tx,
                    rect.y + ty,
                    rect.right() + tx,
                    rect.bottom() + ty,
                );
                let ok = [x, y, r, b].iter().all(|v| v.fract() == 0.0);
                ok.then_some(IRect {
                    x0: x as i32,
                    y0: y as i32,
                    x1: r as i32,
                    y1: b as i32,
                })
            })
        } else {
            None
        };
        let mut h = Fx::new();
        hash_rect(&mut h, &rect);
        hash_radii(&mut h, &radii);
        hash_xf(&mut h, &xf);
        h.u64(self.clip_sig(parent));
        let sig = h.done();
        self.list.clips.push(Clip {
            rect,
            radii,
            xf,
            parent,
            bounds,
            simple,
            sig,
        });
        (self.list.clips.len() - 1) as ClipId
    }

    /// Append a command; `local` is the untransformed bounds used for culling.
    pub fn emit(&mut self, kind: CmdKind, local: Rect, xf: Transform, clip: ClipId, opacity: f32) {
        let pad = if xf.is_identity() { 0.0 } else { 1.0 };
        let bbox = aabb(local, &xf, pad)
            .intersect(&self.clip_bounds(clip))
            .intersect(&IRect::SCREEN);
        if bbox.is_empty() {
            return;
        }
        self.emit_with_bbox(kind, bbox, xf, clip, opacity);
    }

    fn emit_with_bbox(
        &mut self,
        kind: CmdKind,
        bbox: IRect,
        xf: Transform,
        clip: ClipId,
        opacity: f32,
    ) {
        let mut h = Fx::new();
        h.u64(kind_sig(&kind));
        hash_xf(&mut h, &xf);
        h.u64(self.clip_sig(clip)).f32(opacity);
        let sig = h.done();
        self.list.cmds.push(DrawCmd {
            kind,
            bbox,
            xf,
            clip,
            opacity,
            sig,
        });
    }

    pub fn fill_rect(
        &mut self,
        rect: Rect,
        radii: Radii,
        color: Color,
        xf: Transform,
        clip: ClipId,
        opacity: f32,
    ) {
        if color.a <= 0.0 || rect.is_empty() {
            return;
        }
        self.emit(
            CmdKind::Fill {
                rect,
                radii,
                fill: Fill::Color(color),
            },
            rect,
            xf,
            clip,
            opacity,
        );
    }

    /// Plain text block at `origin` (used by overlays and widgets); `xf` is translation-only.
    pub fn text_run(
        &mut self,
        run: &Arc<TextRun>,
        origin: (f32, f32),
        color: Color,
        xf: Transform,
        clip: ClipId,
        opacity: f32,
    ) {
        if run.glyphs.iter().all(|g| g.bitmap.is_none()) {
            return;
        }
        let b = run.bounds;
        if let Some((tx, ty)) = translation_only(&xf) {
            let ox = (origin.0 + tx).round() as i32;
            let oy = (origin.1 + ty).round() as i32;
            let local = Rect::new(ox as f32 + b.x, oy as f32 + b.y, b.w, b.h);
            self.emit(
                CmdKind::Glyphs {
                    run: run.clone(),
                    ox,
                    oy,
                    color,
                },
                local,
                Transform::identity(),
                clip,
                opacity,
            );
        } else if let Some((s, tx, ty)) = uniform_scale(&xf) {
            // Re-rasterise at the scaled size so scaled text stays crisp.
            let mut items = Vec::with_capacity(run.glyphs.len());
            let mut bounds = IRect::EMPTY;
            for g in &run.glyphs {
                if g.bitmap.is_none() {
                    continue;
                }
                let size = g.size * s;
                let gx = (origin.0 + g.x) * s + tx;
                let gy = ((origin.1 + g.y) * s + ty).round();
                let (xi, bin) = split_subpixel(gx);
                let key = GlyphKey {
                    font_id: g.font_id,
                    glyph_id: g.glyph_id,
                    size_64: size_to_64(size),
                    weight: g.weight,
                    bin,
                    italic: g.italic,
                };
                if let Some(bm) = self.text.glyph(key) {
                    let x = xi + bm.left;
                    let y = gy as i32 - bm.top;
                    bounds = bounds.union(&IRect {
                        x0: x,
                        y0: y,
                        x1: x + bm.w as i32,
                        y1: y + bm.h as i32,
                    });
                    items.push(GlyphItem {
                        bitmap: bm,
                        x,
                        y,
                        color: g.color,
                    });
                }
            }
            if items.is_empty() {
                return;
            }
            let bbox = bounds
                .intersect(&self.clip_bounds(clip))
                .intersect(&IRect::SCREEN);
            if !bbox.is_empty() {
                self.emit_with_bbox(
                    CmdKind::GlyphItems { items, color },
                    bbox,
                    Transform::identity(),
                    clip,
                    opacity,
                );
            }
        } else {
            let local = Rect::new(origin.0 + b.x, origin.1 + b.y, b.w, b.h);
            self.emit(
                CmdKind::GlyphsXf {
                    run: run.clone(),
                    ox: origin.0,
                    oy: origin.1,
                    color,
                },
                local,
                xf,
                clip,
                opacity,
            );
        }
    }

    /// Paint the whole tree: root, then the overlay layer last.
    pub fn build_tree(&mut self) {
        // The root is always opaque: its background is the screen's base colour.
        self.paint_node(
            ROOT_ID,
            Ctx {
                xf: Transform::identity(),
                clip: NO_CLIP,
            },
        );
    }

    fn paint_node(&mut self, id: NodeId, ctx: Ctx) {
        let Some(node) = self.tree.get(id) else {
            return;
        };
        if node.display_none() || node.kind == NodeKind::RawText {
            return;
        }
        let o = node.cur.opacity.unwrap_or(1.0).clamp(0.0, 1.0);
        if o <= 0.0 {
            return;
        }
        let abs = node.abs;
        let xf = if node.xform.is_identity() {
            ctx.xf
        } else {
            ctx.xf.pre_concat(node_local_xf(abs, &node.xform))
        };
        let leaf_like = matches!(
            node.kind,
            NodeKind::Text | NodeKind::Input | NodeKind::Image | NodeKind::Icon
        );
        let has_children = !leaf_like && !node.children.is_empty();
        let layer = o < 1.0 && has_children;
        let layer_start = self.list.cmds.len();
        if layer {
            // bbox is patched once the children are emitted.
            self.list.cmds.push(DrawCmd {
                kind: CmdKind::PushLayer { opacity: o },
                bbox: IRect::EMPTY,
                xf: Transform::identity(),
                clip: NO_CLIP,
                opacity: 1.0,
                sig: 0,
            });
        }
        let own_opacity = if layer { 1.0 } else { o };

        self.paint_self(id, xf, ctx.clip, own_opacity);

        // Children.
        let Some(node) = self.tree.get(id) else {
            return;
        };
        if !leaf_like && !node.children.is_empty() {
            let child_clip = if node.clips() {
                let radii = circ(clamp_radii(node.cur.border_radius.resolved(), abs.w, abs.h));
                self.push_clip(abs, radii, xf, ctx.clip)
            } else {
                ctx.clip
            };
            if self.clip_bounds(child_clip).is_empty() {
                // Entirely clipped away.
            } else {
                let child_ctx = Ctx {
                    xf,
                    clip: child_clip,
                };
                let node = &self.tree.nodes[&id];
                let n = node.children.len();
                let sorted = node.children.iter().any(|c| {
                    self.tree
                        .get(*c)
                        .is_some_and(|c| c.cur.z_index.unwrap_or(0) != 0)
                });
                let order: Vec<NodeId> = if sorted {
                    let mut v: Vec<NodeId> = node.children.clone();
                    v.sort_by_key(|c| self.tree.get(*c).map_or(0, |c| c.cur.z_index.unwrap_or(0)));
                    v
                } else {
                    Vec::new()
                };
                let mut overlay = false;
                for i in 0..n {
                    let cid = if sorted {
                        order[i]
                    } else {
                        self.tree.nodes[&id].children[i]
                    };
                    if id == ROOT_ID && cid == OVERLAY_ID {
                        overlay = true;
                        continue;
                    }
                    self.paint_node(cid, child_ctx);
                }
                if overlay {
                    self.paint_node(OVERLAY_ID, child_ctx);
                }
            }
        }

        self.paint_outline(id, xf, ctx.clip, own_opacity);

        if layer {
            let mut bbox = IRect::EMPTY;
            for c in &self.list.cmds[layer_start + 1..] {
                bbox = bbox.union(&c.bbox);
            }
            if bbox.is_empty() {
                self.list.cmds.truncate(layer_start);
            } else {
                self.list.cmds[layer_start].bbox = bbox;
                let mut h = Fx::new();
                h.u32(10)
                    .f32(o)
                    .u64(self.list.cmds.len() as u64 - layer_start as u64);
                self.list.cmds[layer_start].sig = h.done();
                let sig = Fx::new().u32(11).done();
                self.list.cmds.push(DrawCmd {
                    kind: CmdKind::PopLayer { opacity: o },
                    bbox,
                    xf: Transform::identity(),
                    clip: NO_CLIP,
                    opacity: 1.0,
                    sig,
                });
            }
        }
    }

    fn paint_self(&mut self, id: NodeId, xf: Transform, clip: ClipId, opacity: f32) {
        let Some(node) = self.tree.get(id) else {
            return;
        };
        let abs = node.abs;
        if abs.is_empty() {
            return;
        }
        let radii_c = clamp_radii(node.cur.border_radius.resolved(), abs.w, abs.h);
        let radii = circ(radii_c);

        // Shadow.
        let sh = &node.cur.shadow;
        if sh.color.is_some() || sh.radius.is_some() || sh.opacity.is_some() {
            let base = sh.color.unwrap_or(Color::BLACK);
            let color = base.with_alpha(base.a * sh.opacity.unwrap_or(1.0));
            let blur = sh.radius.unwrap_or(0.0).max(0.0);
            let off = sh.offset.unwrap_or((0.0, 0.0));
            if color.a > 0.0 && (blur > 0.0 || off != (0.0, 0.0)) {
                let pad = (blur * 1.5).ceil();
                let local = Rect::new(
                    abs.x + off.0 - pad,
                    abs.y + off.1 - pad,
                    abs.w + 2.0 * pad,
                    abs.h + 2.0 * pad,
                );
                self.emit(
                    CmdKind::Shadow {
                        rect: abs,
                        radii,
                        color,
                        blur,
                        offset: off,
                    },
                    local,
                    xf,
                    clip,
                    opacity,
                );
            }
        }

        // Background (the root is the opaque base).
        let node = &self.tree.nodes[&id];
        if id == ROOT_ID {
            let c = node
                .cur
                .background_color
                .map_or(ROOT_BACKGROUND, |c| c.with_alpha(1.0));
            self.fill_rect(abs, NO_RADII, c, xf, clip, 1.0);
        } else if let Some(g) = &node.cur.background_gradient {
            let g = Arc::new(g.clone());
            self.emit(
                CmdKind::Fill {
                    rect: abs,
                    radii,
                    fill: Fill::Gradient(g),
                },
                abs,
                xf,
                clip,
                opacity,
            );
        } else if let Some(c) = node.cur.background_color {
            self.fill_rect(abs, radii, c, xf, clip, opacity);
        }

        // Border.
        let node = &self.tree.nodes[&id];
        let w = [
            node.cur.border_width.left,
            node.cur.border_width.top,
            node.cur.border_width.right,
            node.cur.border_width.bottom,
        ]
        .map(|v| v.unwrap_or(0.0));
        if w.iter().any(|v| *v > 0.0) {
            let bc = &node.cur.border_color;
            let colors = [bc.left, bc.top, bc.right, bc.bottom].map(|c| c.unwrap_or(Color::BLACK));
            let inner = Rect::new(
                abs.x + w[0],
                abs.y + w[1],
                (abs.w - w[0] - w[2]).max(0.0),
                (abs.h - w[1] - w[3]).max(0.0),
            );
            // Elliptical inner radii: corner radius minus the adjacent side widths.
            let ir: Radii = [
                ((radii_c[0] - w[0]).max(0.0), (radii_c[0] - w[1]).max(0.0)),
                ((radii_c[1] - w[2]).max(0.0), (radii_c[1] - w[1]).max(0.0)),
                ((radii_c[2] - w[2]).max(0.0), (radii_c[2] - w[3]).max(0.0)),
                ((radii_c[3] - w[0]).max(0.0), (radii_c[3] - w[3]).max(0.0)),
            ];
            if colors.iter().all(|c| *c == colors[0]) {
                if colors[0].a > 0.0 {
                    self.emit(
                        CmdKind::Ring {
                            outer: abs,
                            outer_r: radii,
                            inner,
                            inner_r: ir,
                            color: colors[0],
                        },
                        abs,
                        xf,
                        clip,
                        opacity,
                    );
                }
            } else {
                self.emit(
                    CmdKind::Border {
                        rect: abs,
                        radii,
                        widths: w,
                        colors,
                    },
                    abs,
                    xf,
                    clip,
                    opacity,
                );
            }
        }

        self.paint_content(id, xf, clip, opacity);
    }

    fn paint_content(&mut self, id: NodeId, xf: Transform, clip: ClipId, opacity: f32) {
        let Some(node) = self.tree.get(id) else {
            return;
        };
        let abs = node.abs;
        let inset = node.inset;
        let content = Rect::new(
            abs.x + inset[0],
            abs.y + inset[1],
            (abs.w - inset[0] - inset[2]).max(0.0),
            (abs.h - inset[1] - inset[3]).max(0.0),
        );
        match node.kind {
            NodeKind::Text => {
                let color = node.cur.color.unwrap_or(Color::WHITE);
                let Some(run) = self.text_run_for(id, content.w, false) else {
                    return;
                };
                self.text_run(&run, (content.x, content.y), color, xf, clip, opacity);
            }
            NodeKind::Input => {
                let node = &self.tree.nodes[&id];
                let (_, placeholder) = input_display(node);
                let mut color = node.cur.color.unwrap_or(Color::WHITE);
                if placeholder {
                    color = color.with_alpha(color.a * 0.5);
                }
                let Some(run) = self.text_run_for(id, content.w, true) else {
                    return;
                };
                // Single line, vertically centred, clipped to the content box.
                let top = content.y + ((content.h - run.height) / 2.0).max(0.0).floor();
                let radii = NO_RADII;
                let c = self.push_clip(content, radii, xf, clip);
                self.text_run(&run, (content.x, top), color, xf, c, opacity);
            }
            NodeKind::Image => self.paint_image(id, content, xf, clip, opacity),
            NodeKind::Icon => {
                let Some(geoms) = node.icon.clone() else {
                    return;
                };
                if geoms.is_empty() {
                    return;
                }
                let color = node.text_color();
                let (vw, vh) = node.props.view_box;
                let size = node.props.size;
                let scale = if vw > 0.0 && vh > 0.0 {
                    size / vw.max(vh)
                } else {
                    1.0
                };
                let ox = abs.x + (abs.w - vw * scale) / 2.0;
                let oy = abs.y + (abs.h - vh * scale) / 2.0;
                let local = Rect::new(ox, oy, vw * scale, vh * scale).inflate(2.0);
                self.emit(
                    CmdKind::Icon {
                        geoms,
                        origin: (ox, oy),
                        scale,
                        color,
                    },
                    local,
                    xf,
                    clip,
                    opacity,
                );
            }
            _ => {}
        }
    }

    /// Cached shaped text for a `Text`/`Input` node at `width`.
    fn text_run_for(&mut self, id: NodeId, width: f32, single_line: bool) -> Option<Arc<TextRun>> {
        let node = self.tree.get(id)?;
        let key = if single_line {
            0
        } else {
            width.to_bits() as u64 + 1
        };
        if let Some((k, run)) = &node.text_run {
            if *k == key {
                return Some(run.clone());
            }
        }
        let data = node.text_data.clone()?;
        let run = Arc::new(self.text.layout(
            &data.content,
            &data.style,
            if single_line {
                None
            } else {
                Some(width.max(0.0))
            },
        ));
        if let Some(n) = self.tree.get_mut(id) {
            n.text_run = Some((key, run.clone()));
        }
        Some(run)
    }

    fn paint_image(
        &mut self,
        id: NodeId,
        content: Rect,
        xf: Transform,
        clip: ClipId,
        opacity: f32,
    ) {
        let Some(node) = self.tree.get(id) else {
            return;
        };
        let Some(uri) = node.props.src.clone() else {
            return;
        };
        let mode = node.cur.resize_mode.unwrap_or(node.props.resize_mode);
        let tint = node.cur.tint_color;
        let radii = circ(clamp_radii(
            node.cur.border_radius.resolved(),
            content.w,
            content.h,
        ));
        let Some(pm) = self.images.get_or_request(&uri) else {
            return;
        };
        let (iw, ih) = (pm.width() as f32, pm.height() as f32);
        if iw <= 0.0 || ih <= 0.0 || content.is_empty() {
            return;
        }
        let (dst, src) = match mode {
            ResizeMode::Stretch => (content, Rect::new(0.0, 0.0, iw, ih)),
            ResizeMode::Cover => {
                let s = (content.w / iw).max(content.h / ih);
                let (sw, sh) = (content.w / s, content.h / s);
                (content, Rect::new((iw - sw) / 2.0, (ih - sh) / 2.0, sw, sh))
            }
            ResizeMode::Contain => {
                let s = (content.w / iw).min(content.h / ih);
                let (dw, dh) = (iw * s, ih * s);
                (
                    Rect::new(
                        content.x + (content.w - dw) / 2.0,
                        content.y + (content.h - dh) / 2.0,
                        dw,
                        dh,
                    ),
                    Rect::new(0.0, 0.0, iw, ih),
                )
            }
            ResizeMode::Center => {
                let full = Rect::new(
                    content.x + (content.w - iw) / 2.0,
                    content.y + (content.h - ih) / 2.0,
                    iw,
                    ih,
                );
                let vis = full.intersection(&content);
                if vis.is_empty() {
                    return;
                }
                (vis, Rect::new(vis.x - full.x, vis.y - full.y, vis.w, vis.h))
            }
        };
        let radii = if mode == ResizeMode::Contain {
            NO_RADII
        } else {
            radii
        };
        self.emit(
            CmdKind::Image {
                pixmap: pm,
                dst,
                src,
                radii,
                tint,
            },
            dst,
            xf,
            clip,
            opacity,
        );
    }

    fn paint_outline(&mut self, id: NodeId, xf: Transform, clip: ClipId, opacity: f32) {
        let Some(node) = self.tree.get(id) else {
            return;
        };
        let w = node.cur.outline_width.unwrap_or(0.0);
        let Some(color) = node.cur.outline_color else {
            return;
        };
        if w <= 0.0 || color.a <= 0.0 || node.abs.is_empty() {
            return;
        }
        let abs = node.abs;
        let off = node.cur.outline_offset.unwrap_or(0.0);
        let r = clamp_radii(node.cur.border_radius.resolved(), abs.w, abs.h);
        let grow = |d: f32| r.map(|v| if v > 0.0 { (v + d).max(0.0) } else { 0.0 });
        let inner = abs.inflate(off);
        let outer = abs.inflate(off + w);
        if inner.is_empty() {
            return;
        }
        self.emit(
            CmdKind::Ring {
                outer,
                outer_r: circ(grow(off + w)),
                inner,
                inner_r: circ(grow(off)),
                color,
            },
            outer,
            xf,
            clip,
            opacity,
        );
    }
}

/// Damage between two display lists: the tiles touched by commands that were
/// added, removed, changed or reordered. Returns nothing for identical lists.
pub fn diff(old: &[DrawCmd], new: &[DrawCmd], dirty: &mut TileSet) {
    let mut pre = 0;
    while pre < old.len() && pre < new.len() && old[pre].sig == new[pre].sig {
        pre += 1;
    }
    let mut suf = 0;
    while suf < old.len() - pre
        && suf < new.len() - pre
        && old[old.len() - 1 - suf].sig == new[new.len() - 1 - suf].sig
    {
        suf += 1;
    }
    let old_mid = &old[pre..old.len() - suf];
    let new_mid = &new[pre..new.len() - suf];
    if old_mid.is_empty() && new_mid.is_empty() {
        return;
    }
    let mut queues: FxMap<u64, std::collections::VecDeque<usize>> = FxMap::default();
    for (i, c) in old_mid.iter().enumerate() {
        queues.entry(c.sig).or_default().push_back(i);
    }
    let mut matched_old = vec![false; old_mid.len()];
    let mut last_old: i64 = -1;
    for c in new_mid {
        match queues.get_mut(&c.sig).and_then(|q| q.pop_front()) {
            Some(oi) => {
                matched_old[oi] = true;
                if (oi as i64) < last_old {
                    dirty.insert_rect(&c.bbox.to_rect());
                    dirty.insert_rect(&old_mid[oi].bbox.to_rect());
                } else {
                    last_old = oi as i64;
                }
            }
            None => dirty.insert_rect(&c.bbox.to_rect()),
        }
    }
    for (i, c) in old_mid.iter().enumerate() {
        if !matched_old[i] {
            dirty.insert_rect(&c.bbox.to_rect());
        }
    }
}
