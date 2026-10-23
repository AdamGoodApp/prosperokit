//! Raster (Phase 3 §5): for each dirty 128×128 tile, clear to the root
//! background, then replay the display commands that touch the tile into a
//! tile-sized premultiplied RGBA pixmap and copy it into the frame
//! (`u32` per pixel whose bytes in memory are R, G, B, A). Glyphs are blended
//! by a tight coverage loop; everything else goes through tiny-skia.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use pk_protocol::style::Gradient;
use pk_protocol::{Color, SCREEN_HEIGHT, SCREEN_WIDTH, TILE, TILES_X, TileSet};
use tiny_skia::{
    BlendMode, FillRule, FilterQuality, GradientStop, LineCap, LineJoin, LinearGradient, Mask,
    Paint, Path, PathBuilder, Pattern, Pixmap, PixmapPaint, Point, Shader, SpreadMode, Stroke,
    Transform,
};

use crate::display::{
    Clip, ClipId, CmdKind, DisplayList, DrawCmd, Fill, GlyphItem, IRect, NO_CLIP, Radii,
    radii_is_zero, translation_only,
};
use crate::hash::{Fx, FxMap};
use crate::layout::ROOT_BACKGROUND;
use crate::lru::Lru;
use crate::text::GlyphBitmap;

const SHADOW_CACHE_ENTRIES: usize = 64;
const TILE_PX: u32 = TILE;

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct ShadowKey {
    w: u32,
    h: u32,
    radii: u64,
    blur: u32,
    color: u32,
}

/// Per-thread scratch state: a tile pixmap, offscreen layers and clip masks.
struct Worker {
    tile: Pixmap,
    layers: Vec<Pixmap>,
    pool: Vec<Pixmap>,
    masks: FxMap<ClipId, Mask>,
}

impl Worker {
    fn new() -> Worker {
        Worker {
            tile: Pixmap::new(TILE_PX, TILE_PX).expect("128x128 pixmap"),
            layers: Vec::new(),
            pool: Vec::new(),
            masks: FxMap::default(),
        }
    }

    /// Render tile `(tx, ty)` and copy it into `rows`, the 128 frame rows of tile row `ty`.
    fn render_tile(
        &mut self,
        tx: u32,
        ty: u32,
        list: &DisplayList,
        idx: &[u32],
        shadows: &Lru<ShadowKey, Arc<Pixmap>>,
        rows: &mut [u32],
    ) {
        let (ox, oy) = ((tx * TILE) as i32, (ty * TILE) as i32);
        self.tile.fill(tiny_skia::Color::from_rgba8(
            (ROOT_BACKGROUND.r * 255.0).round() as u8,
            (ROOT_BACKGROUND.g * 255.0).round() as u8,
            (ROOT_BACKGROUND.b * 255.0).round() as u8,
            255,
        ));
        self.masks.clear();
        debug_assert!(self.layers.is_empty());
        for &i in idx {
            let cmd = &list.cmds[i as usize];
            match &cmd.kind {
                CmdKind::PushLayer { .. } => {
                    let mut p = self
                        .pool
                        .pop()
                        .unwrap_or_else(|| Pixmap::new(TILE_PX, TILE_PX).expect("128x128 pixmap"));
                    p.fill(tiny_skia::Color::TRANSPARENT);
                    self.layers.push(p);
                }
                CmdKind::PopLayer { opacity } => {
                    if let Some(top) = self.layers.pop() {
                        let paint = PixmapPaint {
                            opacity: *opacity,
                            blend_mode: BlendMode::SourceOver,
                            quality: FilterQuality::Nearest,
                        };
                        let dst = self.layers.last_mut().unwrap_or(&mut self.tile);
                        dst.draw_pixmap(0, 0, top.as_ref(), &paint, Transform::identity(), None);
                        self.pool.push(top);
                    }
                }
                _ => {
                    let dst = self.layers.last_mut().unwrap_or(&mut self.tile);
                    draw_cmd(dst, &mut self.masks, shadows, list, cmd, ox, oy);
                }
            }
        }
        // Unbalanced layers (a Push without its Pop in this tile) are discarded.
        while let Some(p) = self.layers.pop() {
            self.pool.push(p);
        }
        let tw = TILE.min(SCREEN_WIDTH - tx * TILE) as usize;
        let th =
            (TILE.min(SCREEN_HEIGHT - ty * TILE) as usize).min(rows.len() / SCREEN_WIDTH as usize);
        let data = self.tile.data();
        for row in 0..th {
            let src = &data[row * TILE as usize * 4..][..tw * 4];
            let dst = &mut rows[row * SCREEN_WIDTH as usize + ox as usize..][..tw];
            for (d, s) in dst.iter_mut().zip(src.chunks_exact(4)) {
                *d = u32::from_ne_bytes([s[0], s[1], s[2], s[3]]);
            }
        }
    }
}

fn shadow_key(rect: &pk_protocol::Rect, radii: &Radii, blur: f32, color: Color) -> ShadowKey {
    let mut hr = Fx::new();
    for (a, b) in radii {
        hr.f32(*a).f32(*b);
    }
    ShadowKey {
        w: rect.w.round().max(1.0) as u32,
        h: rect.h.round().max(1.0) as u32,
        radii: hr.done(),
        blur: blur.to_bits(),
        color: color.to_rgba_u32(),
    }
}

/// Fixed worker count for the tile-row band split.
pub const RASTER_THREADS: usize = 4;
/// Below this many dirty tiles the frame is rasterised on the calling thread
/// (spawning threads costs more than it saves for small damage).
const PARALLEL_MIN_TILES: u32 = 24;

pub struct Rasterizer {
    workers: Vec<Worker>,
    shadows: Lru<ShadowKey, Arc<Pixmap>>,
    parallel: bool,
}

impl Default for Rasterizer {
    fn default() -> Self {
        Self::new()
    }
}

impl Rasterizer {
    pub fn new() -> Rasterizer {
        Rasterizer {
            workers: (0..RASTER_THREADS).map(|_| Worker::new()).collect(),
            shadows: Lru::new(),
            parallel: true,
        }
    }

    /// Enable or disable the multi-threaded tile split (tests compare both paths).
    pub fn set_parallel(&mut self, on: bool) {
        self.parallel = on;
    }

    pub fn shadow_cache_len(&self) -> usize {
        self.shadows.len()
    }

    /// Rasterise every tile of `dirty` into `frame` (1920×1080 `u32`s). Tile rows are
    /// handed out to up to `RASTER_THREADS` threads; tiles are independent and
    /// `DrawCmd` is `Sync`.
    pub fn render(&mut self, list: &DisplayList, dirty: &TileSet, frame: &mut [u32]) {
        if frame.len() < (SCREEN_WIDTH * SCREEN_HEIGHT) as usize || dirty.is_empty() {
            return;
        }
        // Bucket commands per dirty tile.
        let mut per_tile: FxMap<u32, Vec<u32>> = FxMap::default();
        for (i, c) in list.cmds.iter().enumerate() {
            let (tx0, tx1) = (
                (c.bbox.x0.max(0) as u32) / TILE,
                ((c.bbox.x1 - 1).max(0) as u32) / TILE,
            );
            let (ty0, ty1) = (
                (c.bbox.y0.max(0) as u32) / TILE,
                ((c.bbox.y1 - 1).max(0) as u32) / TILE,
            );
            for ty in ty0..=ty1 {
                for tx in tx0..=tx1 {
                    if dirty.contains(tx, ty) {
                        per_tile
                            .entry(ty * TILES_X + tx)
                            .or_default()
                            .push(i as u32);
                    }
                }
            }
        }
        // Build the shadow bitmaps the visible commands need (workers only read the cache).
        let mut seen = std::collections::HashSet::new();
        for idx in per_tile.values() {
            for &i in idx {
                if !seen.insert(i) {
                    continue;
                }
                if let CmdKind::Shadow {
                    rect,
                    radii,
                    color,
                    blur,
                    ..
                } = &list.cmds[i as usize].kind
                {
                    let key = shadow_key(rect, radii, *blur, *color);
                    if self.shadows.get(&key).is_none() {
                        if let Some(p) = build_shadow(key.w, key.h, radii, *blur, *color) {
                            let cost = p.data().len();
                            self.shadows.insert(key, Arc::new(p), cost);
                        }
                    }
                }
            }
        }

        let rows: Vec<Mutex<Option<&mut [u32]>>> = frame[..(SCREEN_WIDTH * SCREEN_HEIGHT) as usize]
            .chunks_mut((TILE * SCREEN_WIDTH) as usize)
            .map(|c| Mutex::new(Some(c)))
            .collect();
        let next = AtomicUsize::new(0);
        let shadows = &self.shadows;
        let per_tile = &per_tile;
        let work = |worker: &mut Worker| {
            loop {
                let ty = next.fetch_add(1, Ordering::Relaxed);
                if ty >= rows.len() {
                    break;
                }
                if !(0..TILES_X).any(|tx| dirty.contains(tx, ty as u32)) {
                    continue;
                }
                let Some(slice) = rows[ty].lock().ok().and_then(|mut g| g.take()) else {
                    continue;
                };
                for tx in 0..TILES_X {
                    if dirty.contains(tx, ty as u32) {
                        let idx = per_tile
                            .get(&(ty as u32 * TILES_X + tx))
                            .map_or(&[][..], Vec::as_slice);
                        worker.render_tile(tx, ty as u32, list, idx, shadows, slice);
                    }
                }
            }
        };
        if self.parallel && dirty.count() >= PARALLEL_MIN_TILES {
            std::thread::scope(|s| {
                let mut workers = self.workers.iter_mut();
                let first = workers.next();
                for w in workers {
                    s.spawn(|| work(w));
                }
                if let Some(w) = first {
                    work(w);
                }
            });
        } else {
            work(&mut self.workers[0]);
        }
        self.shadows.trim(usize::MAX, SHADOW_CACHE_ENTRIES);
    }
}

fn tsk_color(c: Color, opacity: f32) -> tiny_skia::Color {
    tiny_skia::Color::from_rgba(
        c.r.clamp(0.0, 1.0),
        c.g.clamp(0.0, 1.0),
        c.b.clamp(0.0, 1.0),
        (c.a * opacity).clamp(0.0, 1.0),
    )
    .unwrap_or(tiny_skia::Color::TRANSPARENT)
}

fn solid_paint(c: Color, opacity: f32) -> Paint<'static> {
    let mut p = Paint::default();
    p.set_color(tsk_color(c, opacity));
    p.anti_alias = true;
    p
}

/// Rounded rectangle path with elliptical corners.
pub fn rrect_path(r: pk_protocol::Rect, radii: &Radii) -> Option<Path> {
    if radii_is_zero(radii) {
        return PathBuilder::from_rect(tiny_skia::Rect::from_xywh(r.x, r.y, r.w, r.h)?).into();
    }
    const K: f32 = 0.552_284_8;
    let (x, y, rt, b) = (r.x, r.y, r.right(), r.bottom());
    let [tl, tr, br, bl] = *radii;
    let mut pb = PathBuilder::new();
    pb.move_to(x + tl.0, y);
    pb.line_to(rt - tr.0, y);
    pb.cubic_to(
        rt - tr.0 + K * tr.0,
        y,
        rt,
        y + tr.1 - K * tr.1,
        rt,
        y + tr.1,
    );
    pb.line_to(rt, b - br.1);
    pb.cubic_to(
        rt,
        b - br.1 + K * br.1,
        rt - br.0 + K * br.0,
        b,
        rt - br.0,
        b,
    );
    pb.line_to(x + bl.0, b);
    pb.cubic_to(x + bl.0 - K * bl.0, b, x, b - bl.1 + K * bl.1, x, b - bl.1);
    pb.line_to(x, y + tl.1);
    pb.cubic_to(x, y + tl.1 - K * tl.1, x + tl.0 - K * tl.0, y, x + tl.0, y);
    pb.close();
    pb.finish()
}

fn ring_path(
    outer: pk_protocol::Rect,
    outer_r: &Radii,
    inner: pk_protocol::Rect,
    inner_r: &Radii,
) -> Option<Path> {
    let o = rrect_path(outer, outer_r)?;
    if inner.is_empty() {
        return Some(o);
    }
    let i = rrect_path(inner, inner_r)?;
    let mut pb = PathBuilder::new();
    pb.push_path(&o);
    pb.push_path(&i);
    pb.finish()
}

fn mul255(x: u32) -> u32 {
    ((x + 128) * 257) >> 16
}

/// Build (and cache) the clip mask of `id` in tile coordinates.
fn ensure_mask(masks: &mut FxMap<ClipId, Mask>, clips: &[Clip], id: ClipId, ox: i32, oy: i32) {
    if id == NO_CLIP || masks.contains_key(&id) {
        return;
    }
    let clip = &clips[id as usize];
    ensure_mask(masks, clips, clip.parent, ox, oy);
    let Some(mut m) = Mask::new(TILE_PX, TILE_PX) else {
        return;
    };
    if let Some(r) = clip.simple {
        let x0 = (r.x0 - ox).clamp(0, TILE_PX as i32) as usize;
        let x1 = (r.x1 - ox).clamp(0, TILE_PX as i32) as usize;
        let y0 = (r.y0 - oy).clamp(0, TILE_PX as i32) as usize;
        let y1 = (r.y1 - oy).clamp(0, TILE_PX as i32) as usize;
        if x1 > x0 {
            for y in y0..y1 {
                m.data_mut()[y * TILE_PX as usize + x0..y * TILE_PX as usize + x1].fill(255);
            }
        }
    } else if let Some(path) = rrect_path(clip.rect, &clip.radii) {
        m.fill_path(
            &path,
            FillRule::Winding,
            true,
            clip.xf.post_translate(-(ox as f32), -(oy as f32)),
        );
    }
    if clip.parent != NO_CLIP {
        if let Some(p) = masks.get(&clip.parent) {
            for (a, b) in m.data_mut().iter_mut().zip(p.data()) {
                *a = mul255(*a as u32 * *b as u32) as u8;
            }
        }
    }
    masks.insert(id, m);
}

fn draw_cmd(
    dst: &mut Pixmap,
    masks: &mut FxMap<ClipId, Mask>,
    shadows: &Lru<ShadowKey, Arc<Pixmap>>,
    list: &DisplayList,
    cmd: &DrawCmd,
    ox: i32,
    oy: i32,
) {
    ensure_mask(masks, &list.clips, cmd.clip, ox, oy);
    let mask = if cmd.clip == NO_CLIP {
        None
    } else {
        masks.get(&cmd.clip)
    };
    let ts = cmd.xf.post_translate(-(ox as f32), -(oy as f32));
    let op = cmd.opacity;
    match &cmd.kind {
        CmdKind::Fill { rect, radii, fill } => {
            let mut paint = match fill {
                Fill::Color(c) => solid_paint(*c, op),
                Fill::Gradient(g) => {
                    let mut p = Paint::default();
                    p.anti_alias = true;
                    match gradient_shader(g, *rect, op) {
                        Some(s) => p.shader = s,
                        None => return,
                    }
                    p
                }
            };
            let aligned = radii_is_zero(radii)
                && translation_only(&ts).is_some_and(|(tx, ty)| {
                    [
                        rect.x + tx,
                        rect.y + ty,
                        rect.right() + tx,
                        rect.bottom() + ty,
                    ]
                    .iter()
                    .all(|v| v.fract() == 0.0)
                });
            if aligned {
                paint.anti_alias = false;
                if let Some(r) = tiny_skia::Rect::from_xywh(rect.x, rect.y, rect.w, rect.h) {
                    dst.fill_rect(r, &paint, ts, mask);
                }
            } else if let Some(path) = rrect_path(*rect, radii) {
                dst.fill_path(&path, &paint, FillRule::Winding, ts, mask);
            }
        }
        CmdKind::Shadow {
            rect,
            radii,
            color,
            blur,
            offset,
        } => {
            let pad = (blur * 1.5).ceil();
            let Some(pm) = shadows.peek(&shadow_key(rect, radii, *blur, *color)) else {
                return;
            };
            let x = (rect.x + offset.0 - pad).round() as i32;
            let y = (rect.y + offset.1 - pad).round() as i32;
            if let Some((tx, ty)) = translation_only(&ts) {
                blit_pixmap(
                    dst,
                    mask,
                    pm,
                    x + tx.round() as i32,
                    y + ty.round() as i32,
                    op,
                );
            } else {
                let paint = PixmapPaint {
                    opacity: op,
                    blend_mode: BlendMode::SourceOver,
                    quality: FilterQuality::Bilinear,
                };
                dst.draw_pixmap(x, y, Pixmap::as_ref(pm), &paint, ts, mask);
            }
        }
        CmdKind::Ring {
            outer,
            outer_r,
            inner,
            inner_r,
            color,
        } => {
            let Some(path) = ring_path(*outer, outer_r, *inner, inner_r) else {
                return;
            };
            dst.fill_path(&path, &solid_paint(*color, op), FillRule::EvenOdd, ts, mask);
        }
        CmdKind::Border {
            rect,
            radii,
            widths,
            colors,
        } => {
            let inner = pk_protocol::Rect::new(
                rect.x + widths[0],
                rect.y + widths[1],
                (rect.w - widths[0] - widths[2]).max(0.0),
                (rect.h - widths[1] - widths[3]).max(0.0),
            );
            let ir: Radii = [
                (
                    (radii[0].0 - widths[0]).max(0.0),
                    (radii[0].1 - widths[1]).max(0.0),
                ),
                (
                    (radii[1].0 - widths[2]).max(0.0),
                    (radii[1].1 - widths[1]).max(0.0),
                ),
                (
                    (radii[2].0 - widths[2]).max(0.0),
                    (radii[2].1 - widths[3]).max(0.0),
                ),
                (
                    (radii[3].0 - widths[0]).max(0.0),
                    (radii[3].1 - widths[3]).max(0.0),
                ),
            ];
            let Some(ring) = ring_path(*rect, radii, inner, &ir) else {
                return;
            };
            // Each side is the ring clipped to its wedge (corner-to-corner diagonals).
            let (x0, y0, x1, y1) = (rect.x, rect.y, rect.right(), rect.bottom());
            let (ix0, iy0, ix1, iy1) = (inner.x, inner.y, inner.right(), inner.bottom());
            let wedges: [[(f32, f32); 4]; 4] = [
                [(x0, y0), (ix0, iy0), (ix0, iy1), (x0, y1)], // left
                [(x0, y0), (x1, y0), (ix1, iy0), (ix0, iy0)], // top
                [(x1, y0), (x1, y1), (ix1, iy1), (ix1, iy0)], // right
                [(x0, y1), (ix0, iy1), (ix1, iy1), (x1, y1)], // bottom
            ];
            // colors: [left, top, right, bottom]
            for (side, poly) in wedges.iter().enumerate() {
                let c = colors[side];
                if c.a <= 0.0 {
                    continue;
                }
                let mut pb = PathBuilder::new();
                pb.move_to(poly[0].0, poly[0].1);
                for p in &poly[1..] {
                    pb.line_to(p.0, p.1);
                }
                pb.close();
                let Some(wedge) = pb.finish() else { continue };
                let Some(mut wm) = Mask::new(TILE_PX, TILE_PX) else {
                    continue;
                };
                wm.fill_path(&wedge, FillRule::Winding, true, ts);
                if let Some(cm) = mask {
                    for (a, b) in wm.data_mut().iter_mut().zip(cm.data()) {
                        *a = mul255(*a as u32 * *b as u32) as u8;
                    }
                }
                dst.fill_path(&ring, &solid_paint(c, op), FillRule::EvenOdd, ts, Some(&wm));
            }
        }
        CmdKind::Image {
            pixmap,
            dst: d,
            src,
            radii,
            tint,
        } => {
            let (sx, sy) = (d.w / src.w, d.h / src.h);
            let pat_ts = Transform::from_row(sx, 0.0, 0.0, sy, d.x - src.x * sx, d.y - src.y * sy);
            let tinted;
            let pm = match tint {
                Some(t) => {
                    tinted = tint_pixmap(pixmap, *t);
                    tinted.as_ref()
                }
                None => Pixmap::as_ref(pixmap),
            };
            let exact = sx == 1.0
                && sy == 1.0
                && translation_only(&ts)
                    .is_some_and(|(tx, ty)| tx.fract() == 0.0 && ty.fract() == 0.0)
                && pat_ts.tx.fract() == 0.0
                && pat_ts.ty.fract() == 0.0;
            let quality = if exact {
                FilterQuality::Nearest
            } else {
                FilterQuality::Bilinear
            };
            let mut paint = Paint::default();
            paint.anti_alias = true;
            paint.shader = Pattern::new(pm, SpreadMode::Pad, quality, op, pat_ts);
            if let Some(path) = rrect_path(*d, radii) {
                dst.fill_path(&path, &paint, FillRule::Winding, ts, mask);
            }
        }
        CmdKind::Glyphs {
            run,
            ox: gx,
            oy: gy,
            color,
        } => {
            let (rgb, alpha) = glyph_color(*color, op);
            for g in &run.glyphs {
                if let Some(bm) = &g.bitmap {
                    let (rgb, alpha) = match g.color {
                        Some(c) => glyph_color(c, op),
                        None => (rgb, alpha),
                    };
                    blit_glyph(
                        dst,
                        mask,
                        bm,
                        gx + g.xi + bm.left - ox,
                        gy + g.yi - bm.top - oy,
                        rgb,
                        alpha,
                    );
                }
            }
        }
        CmdKind::GlyphItems { items, color } => {
            let (rgb, alpha) = glyph_color(*color, op);
            for GlyphItem {
                bitmap,
                x,
                y,
                color,
            } in items
            {
                let (rgb, alpha) = match color {
                    Some(c) => glyph_color(*c, op),
                    None => (rgb, alpha),
                };
                blit_glyph(dst, mask, bitmap, x - ox, y - oy, rgb, alpha);
            }
        }
        CmdKind::GlyphsXf {
            run,
            ox: gx,
            oy: gy,
            color,
        } => {
            let (rgb, alpha) = glyph_color(*color, op);
            for g in &run.glyphs {
                let Some(bm) = &g.bitmap else { continue };
                let (rgb, alpha) = match g.color {
                    Some(c) => glyph_color(c, op),
                    None => (rgb, alpha),
                };
                let Some(mut pm) = Pixmap::new(bm.w, bm.h) else {
                    continue;
                };
                for (px, cov) in pm.data_mut().chunks_exact_mut(4).zip(bm.data.iter()) {
                    let a = mul255(*cov as u32 * alpha);
                    px[0] = mul255(rgb[0] as u32 * a) as u8;
                    px[1] = mul255(rgb[1] as u32 * a) as u8;
                    px[2] = mul255(rgb[2] as u32 * a) as u8;
                    px[3] = a as u8;
                }
                let lx = gx + (g.xi + bm.left) as f32;
                let ly = gy + (g.yi - bm.top) as f32;
                let paint = PixmapPaint {
                    opacity: 1.0,
                    blend_mode: BlendMode::SourceOver,
                    quality: FilterQuality::Bilinear,
                };
                dst.draw_pixmap(0, 0, pm.as_ref(), &paint, ts.pre_translate(lx, ly), mask);
            }
        }
        CmdKind::Icon {
            geoms,
            origin,
            scale,
            color,
        } => {
            let its = ts
                .pre_translate(origin.0, origin.1)
                .pre_scale(*scale, *scale);
            for g in geoms.iter() {
                let spec = &g.spec;
                let fill = if spec.fill_current {
                    Some(*color)
                } else {
                    spec.fill
                };
                if let Some(c) = fill {
                    dst.fill_path(&g.path, &solid_paint(c, op), FillRule::Winding, its, mask);
                }
                let stroke_c = if spec.stroke_current {
                    Some(*color)
                } else {
                    spec.stroke
                };
                if let Some(c) = stroke_c {
                    if spec.stroke_width > 0.0 {
                        let stroke = Stroke {
                            width: spec.stroke_width,
                            line_cap: match spec.line_cap {
                                pk_protocol::props::LineCap::Butt => LineCap::Butt,
                                pk_protocol::props::LineCap::Round => LineCap::Round,
                                pk_protocol::props::LineCap::Square => LineCap::Square,
                            },
                            line_join: match spec.line_join {
                                pk_protocol::props::LineJoin::Miter => LineJoin::Miter,
                                pk_protocol::props::LineJoin::Round => LineJoin::Round,
                                pk_protocol::props::LineJoin::Bevel => LineJoin::Bevel,
                            },
                            ..Stroke::default()
                        };
                        dst.stroke_path(&g.path, &solid_paint(c, op), &stroke, its, mask);
                    }
                }
            }
        }
        CmdKind::PushLayer { .. } | CmdKind::PopLayer { .. } => {}
    }
}

/// Source-over blit of a premultiplied pixmap at an integer offset (translation-only transforms).
fn blit_pixmap(dst: &mut Pixmap, mask: Option<&Mask>, src: &Pixmap, x: i32, y: i32, opacity: f32) {
    let op = (opacity.clamp(0.0, 1.0) * 255.0 + 0.5) as u32;
    if op == 0 {
        return;
    }
    let (w, h) = (dst.width() as i32, dst.height() as i32);
    let (x0, x1) = (x.max(0), (x + src.width() as i32).min(w));
    let (y0, y1) = (y.max(0), (y + src.height() as i32).min(h));
    if x0 >= x1 || y0 >= y1 {
        return;
    }
    let sw = src.width() as usize;
    let sdata = src.data();
    let mdata = mask.map(|m| m.data());
    let data = dst.data_mut();
    for yy in y0..y1 {
        let srow =
            &sdata[((yy - y) as usize * sw + (x0 - x) as usize) * 4..][..(x1 - x0) as usize * 4];
        let drow = &mut data[((yy * w + x0) as usize) * 4..][..(x1 - x0) as usize * 4];
        for (i, (s, d)) in srow
            .chunks_exact(4)
            .zip(drow.chunks_exact_mut(4))
            .enumerate()
        {
            if s[3] == 0 {
                continue;
            }
            let mut scale = op;
            if let Some(m) = mdata {
                scale = mul255(scale * m[(yy * w + x0) as usize + i] as u32);
            }
            if scale == 0 {
                continue;
            }
            let sa = mul255(s[3] as u32 * scale);
            let inv = 255 - sa;
            d[0] = (mul255(s[0] as u32 * scale) + mul255(d[0] as u32 * inv)) as u8;
            d[1] = (mul255(s[1] as u32 * scale) + mul255(d[1] as u32 * inv)) as u8;
            d[2] = (mul255(s[2] as u32 * scale) + mul255(d[2] as u32 * inv)) as u8;
            d[3] = (sa + mul255(d[3] as u32 * inv)) as u8;
        }
    }
}
fn glyph_color(c: Color, opacity: f32) -> ([u8; 3], u32) {
    let q = |v: f32| (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
    (
        [q(c.r), q(c.g), q(c.b)],
        (c.a * opacity).clamp(0.0, 1.0).mul_add(255.0, 0.5) as u32,
    )
}

/// Blend a coverage bitmap of colour `rgb`/`alpha` into the premultiplied pixmap at `(x, y)`.
fn blit_glyph(
    dst: &mut Pixmap,
    mask: Option<&Mask>,
    bm: &GlyphBitmap,
    x: i32,
    y: i32,
    rgb: [u8; 3],
    alpha: u32,
) {
    if alpha == 0 {
        return;
    }
    let (w, h) = (dst.width() as i32, dst.height() as i32);
    let (x0, x1) = (x.max(0), (x + bm.w as i32).min(w));
    let (y0, y1) = (y.max(0), (y + bm.h as i32).min(h));
    if x0 >= x1 || y0 >= y1 {
        return;
    }
    let data = dst.data_mut();
    let mdata = mask.map(|m| m.data());
    for yy in y0..y1 {
        let src = &bm.data[((yy - y) as usize * bm.w as usize + (x0 - x) as usize)..]
            [..(x1 - x0) as usize];
        let drow = &mut data[((yy * w + x0) as usize) * 4..][..(x1 - x0) as usize * 4];
        for (i, (cov, d)) in src.iter().zip(drow.chunks_exact_mut(4)).enumerate() {
            if *cov == 0 {
                continue;
            }
            let mut a = mul255(*cov as u32 * alpha);
            if let Some(m) = mdata {
                a = mul255(a * m[(yy * w + x0) as usize + i] as u32);
            }
            if a == 0 {
                continue;
            }
            let inv = 255 - a;
            d[0] = (mul255(rgb[0] as u32 * a) + mul255(d[0] as u32 * inv)) as u8;
            d[1] = (mul255(rgb[1] as u32 * a) + mul255(d[1] as u32 * inv)) as u8;
            d[2] = (mul255(rgb[2] as u32 * a) + mul255(d[2] as u32 * inv)) as u8;
            d[3] = (a + mul255(d[3] as u32 * inv)) as u8;
        }
    }
}

fn gradient_shader(g: &Gradient, r: pk_protocol::Rect, opacity: f32) -> Option<Shader<'static>> {
    let a = g.angle_deg.to_radians();
    let (dx, dy) = (a.sin(), -a.cos());
    let len = (r.w * dx).abs() + (r.h * dy).abs();
    let (cx, cy) = r.center();
    let start = Point::from_xy(cx - dx * len / 2.0, cy - dy * len / 2.0);
    let end = Point::from_xy(cx + dx * len / 2.0, cy + dy * len / 2.0);
    let mut sorted: Vec<(f32, Color)> = g
        .stops
        .iter()
        .map(|(o, c)| (o.clamp(0.0, 1.0), *c))
        .collect();
    sorted.sort_by(|a, b| a.0.total_cmp(&b.0));
    let stops: Vec<GradientStop> = sorted
        .into_iter()
        .map(|(o, c)| GradientStop::new(o, tsk_color(c, opacity)))
        .collect();
    LinearGradient::new(start, end, stops, SpreadMode::Pad, Transform::identity())
}

fn tint_pixmap(src: &Arc<Pixmap>, t: Color) -> Pixmap {
    let mut out = (**src).clone();
    let (tr, tg, tb, ta) = (
        (t.r * 255.0) as u32,
        (t.g * 255.0) as u32,
        (t.b * 255.0) as u32,
        (t.a * 255.0) as u32,
    );
    for px in out.data_mut().chunks_exact_mut(4) {
        let a = mul255(px[3] as u32 * ta);
        px[0] = mul255(tr * a) as u8;
        px[1] = mul255(tg * a) as u8;
        px[2] = mul255(tb * a) as u8;
        px[3] = a as u8;
    }
    out
}

/// A gaussian-ish blurred rounded rect tinted with `color` (premultiplied).
fn build_shadow(w: u32, h: u32, radii: &Radii, blur: f32, color: Color) -> Option<Pixmap> {
    let pad = (blur * 1.5).ceil() as u32;
    let (pw, ph) = (w + 2 * pad, h + 2 * pad);
    if pw as u64 * ph as u64 > 4096 * 4096 {
        return None;
    }
    let mut pm = Pixmap::new(pw, ph)?;
    let path = rrect_path(
        pk_protocol::Rect::new(pad as f32, pad as f32, w as f32, h as f32),
        radii,
    )?;
    let mut paint = Paint::default();
    paint.set_color_rgba8(0, 0, 0, 255);
    paint.anti_alias = true;
    pm.fill_path(
        &path,
        &paint,
        FillRule::Winding,
        Transform::identity(),
        None,
    );
    let mut alpha: Vec<f32> = pm
        .data()
        .chunks_exact(4)
        .map(|p| p[3] as f32 / 255.0)
        .collect();
    if blur > 0.0 {
        let sigma = blur / 2.0;
        // Three box blurs approximate a gaussian (Kovesi / W3C).
        let d = ((sigma * 3.0 * (2.0 * std::f32::consts::PI).sqrt() / 4.0) + 0.5)
            .floor()
            .max(1.0) as usize;
        let mut tmp = vec![0.0f32; alpha.len()];
        for _ in 0..3 {
            box_blur(&alpha, &mut tmp, pw as usize, ph as usize, d, true);
            box_blur(&tmp, &mut alpha, pw as usize, ph as usize, d, false);
        }
    }
    for (px, a) in pm.data_mut().chunks_exact_mut(4).zip(alpha) {
        let a = (a * color.a).clamp(0.0, 1.0);
        px[0] = (color.r * a * 255.0 + 0.5) as u8;
        px[1] = (color.g * a * 255.0 + 0.5) as u8;
        px[2] = (color.b * a * 255.0 + 0.5) as u8;
        px[3] = (a * 255.0 + 0.5) as u8;
    }
    Some(pm)
}

/// One horizontal or vertical box-blur pass of window `d` (centred; edges read zero).
fn box_blur(src: &[f32], dst: &mut [f32], w: usize, h: usize, d: usize, horizontal: bool) {
    let (len, lines) = if horizontal { (w, h) } else { (h, w) };
    let stride = if horizontal { 1 } else { w };
    let line_stride = if horizontal { w } else { 1 };
    let lo = d / 2;
    let hi = d - lo - 1;
    let inv = 1.0 / d as f32;
    for l in 0..lines {
        let base = l * line_stride;
        let mut sum = 0.0f32;
        // Window for position 0 covers [-lo, hi].
        for i in 0..=hi.min(len - 1) {
            sum += src[base + i * stride];
        }
        for i in 0..len {
            dst[base + i * stride] = sum * inv;
            let add = i + hi + 1;
            if add < len {
                sum += src[base + add * stride];
            }
            if i >= lo {
                sum -= src[base + (i - lo) * stride];
            }
        }
    }
}

pub fn irect_tiles(r: &IRect) -> TileSet {
    let mut t = TileSet::empty();
    t.insert_rect(&r.to_rect());
    t
}
