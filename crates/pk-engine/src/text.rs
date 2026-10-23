//! Text (Phase 3 §4): cosmic-text shaping and line breaking, swash glyph
//! rasterisation into an LRU cache of 8-bit coverage bitmaps, and the measure
//! cache the layout pass uses. Glyph pixels are blended by `raster.rs` with a
//! tight loop (no tiny-skia path per glyph).

use std::borrow::Cow;
use std::hash::{Hash, Hasher};
use std::sync::Arc;

use cosmic_text::{
    Align, Attrs, Buffer, CacheKeyFlags, Ellipsize, EllipsizeHeightLimit, Family, FontSystem,
    LetterSpacing, Metrics, Shaping, Style as FontStyleAttr, Weight, Wrap,
};
use pk_protocol::Color;
use pk_protocol::style::{FontStyle, Style, TextAlign, TextTransform};
use swash::scale::{Render, ScaleContext, Source};
use swash::zeno::{Angle, Format, Transform as ZenoTransform, Vector};

use crate::hash::{Fx, FxMap};
use crate::lru::Lru;

pub const SANS_FAMILY: &str = "Inter";
pub const MONO_FAMILY: &str = "JetBrains Mono";
pub const DEFAULT_FONT_SIZE: f32 = 24.0;
/// Line height used when a style does not set `lineHeight`.
pub const DEFAULT_LINE_HEIGHT_RATIO: f32 = 1.25;

const GLYPH_CACHE_BYTES: usize = 16 * 1024 * 1024;
const MEASURE_CACHE_ENTRIES: usize = 4096;

static EMBEDDED_FONTS: [&[u8]; 6] = [
    include_bytes!("../fonts/Inter-Regular.ttf"),
    include_bytes!("../fonts/Inter-Medium.ttf"),
    include_bytes!("../fonts/Inter-SemiBold.ttf"),
    include_bytes!("../fonts/Inter-Bold.ttf"),
    include_bytes!("../fonts/JetBrainsMono-Medium.ttf"),
    include_bytes!("../fonts/JetBrainsMono-SemiBold.ttf"),
];

/// The text-relevant part of a style; the key of every text cache.
#[derive(Clone, Debug, PartialEq)]
pub struct TextStyle {
    pub family: String,
    pub size: f32,
    pub weight: u16,
    pub italic: bool,
    pub line_height: f32,
    pub letter_spacing: f32,
    pub align: TextAlign,
    pub transform: TextTransform,
    /// `numberOfLines`; 0 = unlimited.
    pub lines: u32,
}

impl TextStyle {
    pub fn from_style(style: &Style, lines: u32) -> TextStyle {
        let size = style.font_size.unwrap_or(DEFAULT_FONT_SIZE).max(1.0);
        TextStyle {
            family: style.font_family.clone().unwrap_or_default(),
            size,
            weight: style.font_weight.unwrap_or(400),
            italic: style.font_style == Some(FontStyle::Italic),
            line_height: style
                .line_height
                .filter(|l| *l > 0.0)
                .unwrap_or((size * DEFAULT_LINE_HEIGHT_RATIO).round()),
            letter_spacing: style.letter_spacing.unwrap_or(0.0),
            align: style.text_align.unwrap_or(TextAlign::Auto),
            transform: style.text_transform.unwrap_or(TextTransform::None),
            lines,
        }
    }

    pub fn plain(size: f32, weight: u16, mono: bool) -> TextStyle {
        TextStyle {
            family: if mono {
                MONO_FAMILY.into()
            } else {
                String::new()
            },
            size,
            weight,
            italic: false,
            line_height: (size * DEFAULT_LINE_HEIGHT_RATIO).round(),
            letter_spacing: 0.0,
            align: TextAlign::Auto,
            transform: TextTransform::None,
            lines: 0,
        }
    }

    pub fn hash64(&self) -> u64 {
        let mut h = Fx::new();
        h.str(&self.family)
            .f32(self.size)
            .u32(self.weight as u32)
            .bool(self.italic)
            .f32(self.line_height)
            .f32(self.letter_spacing);
        h.u32(self.align as u32 + 1)
            .u32(self.transform as u32 + 1)
            .u32(self.lines);
        h.done()
    }
}

/// One run of text with optional per-span overrides (nested `Text` nodes).
#[derive(Clone, Debug, PartialEq)]
pub struct Span {
    pub text: String,
    pub color: Option<Color>,
    pub weight: Option<u16>,
    pub size: Option<f32>,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct TextContent {
    pub spans: Vec<Span>,
    pub hash: u64,
}

impl TextContent {
    pub fn new(spans: Vec<Span>) -> TextContent {
        let mut h = Fx::new();
        for s in &spans {
            h.str(&s.text);
            match s.color {
                Some(c) => h.u32(c.to_rgba_u32()).u32(1),
                None => h.u32(0),
            };
            h.u32(s.weight.map_or(0, |w| w as u32));
            h.f32(s.size.unwrap_or(0.0));
        }
        TextContent {
            spans,
            hash: h.done(),
        }
    }

    pub fn plain(text: &str) -> TextContent {
        TextContent::new(vec![Span {
            text: text.to_string(),
            color: None,
            weight: None,
            size: None,
        }])
    }

    pub fn is_empty(&self) -> bool {
        self.spans.iter().all(|s| s.text.is_empty())
    }
}

/// Identifies one rasterised glyph bitmap.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct GlyphKey {
    pub font_id: fontdb::ID,
    pub glyph_id: u16,
    /// Font size in 1/64 px.
    pub size_64: u32,
    pub weight: u16,
    /// Sub-pixel x offset in quarters of a pixel (0..4).
    pub bin: u8,
    pub italic: bool,
}

/// 8-bit coverage bitmap; `left`/`top` position it relative to the glyph origin
/// (`top` is the distance from the baseline up to the first row).
#[derive(Debug)]
pub struct GlyphBitmap {
    pub left: i32,
    pub top: i32,
    pub w: u32,
    pub h: u32,
    pub data: Vec<u8>,
}

#[derive(Clone, Debug)]
pub struct PlacedGlyph {
    pub font_id: fontdb::ID,
    pub glyph_id: u16,
    pub size: f32,
    pub weight: u16,
    pub italic: bool,
    /// Glyph origin relative to the text box origin (fractional pixels; y = baseline).
    pub x: f32,
    pub y: f32,
    pub color: Option<Color>,
    /// Bitmap at scale 1 (`None` for blank glyphs).
    pub bitmap: Option<Arc<GlyphBitmap>>,
    /// Integer pixel position of the bitmap origin at scale 1.
    pub xi: i32,
    pub yi: i32,
}

#[derive(Clone, Debug, Default)]
pub struct TextRun {
    pub glyphs: Vec<PlacedGlyph>,
    pub width: f32,
    pub height: f32,
    pub lines: usize,
    /// Union of the glyph bitmaps at scale 1, relative to the text origin.
    pub bounds: pk_protocol::Rect,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct MeasureKey {
    content: u64,
    style: u64,
    width: u32,
}

pub struct TextSystem {
    fs: FontSystem,
    scale: ScaleContext,
    glyphs: Lru<GlyphKey, Option<Arc<GlyphBitmap>>>,
    measures: Lru<MeasureKey, (f32, f32)>,
    scratch: Buffer,
    families: FxMap<String, String>,
    /// lower-case file-stem alias → real family name, for `/app0/fonts/*.ttf`.
    aliases: FxMap<String, String>,
    known: Vec<String>,
    pub measure_hits: u64,
    pub measure_misses: u64,
}

fn transform_text(s: &str, t: TextTransform) -> Cow<'_, str> {
    match t {
        TextTransform::None => Cow::Borrowed(s),
        TextTransform::Uppercase => Cow::Owned(s.to_uppercase()),
        TextTransform::Lowercase => Cow::Owned(s.to_lowercase()),
        TextTransform::Capitalize => {
            let mut out = String::with_capacity(s.len());
            let mut start = true;
            for c in s.chars() {
                if start && c.is_alphabetic() {
                    out.extend(c.to_uppercase());
                    start = false;
                } else {
                    out.push(c);
                    if c.is_whitespace() {
                        start = true;
                    } else if c.is_alphanumeric() {
                        start = false;
                    }
                }
            }
            Cow::Owned(out)
        }
    }
}

impl TextSystem {
    pub fn new(extra_fonts: &[(String, Vec<u8>)]) -> TextSystem {
        let mut db = fontdb::Database::new();
        for data in EMBEDDED_FONTS {
            db.load_font_source(fontdb::Source::Binary(Arc::new(data)));
        }
        let mut aliases = FxMap::default();
        for (name, data) in extra_fonts {
            let ids = db.load_font_source(fontdb::Source::Binary(Arc::new(data.clone())));
            if let Some(family) = ids
                .iter()
                .next()
                .and_then(|id| db.face(*id))
                .and_then(|f| f.families.first())
                .map(|(n, _)| n.clone())
            {
                let stem = name.rsplit('/').next().unwrap_or(name);
                let stem = stem.rsplit_once('.').map_or(stem, |(s, _)| s);
                aliases.insert(stem.to_ascii_lowercase(), family);
            }
        }
        db.set_sans_serif_family(SANS_FAMILY);
        db.set_monospace_family(MONO_FAMILY);
        let mut known: Vec<String> = db
            .faces()
            .flat_map(|f| f.families.iter().map(|(n, _)| n.clone()))
            .collect();
        known.sort();
        known.dedup();
        let mut fs = FontSystem::new_with_locale_and_db("en-US".to_string(), db);
        let scratch = Buffer::new(
            &mut fs,
            Metrics::new(
                DEFAULT_FONT_SIZE,
                DEFAULT_FONT_SIZE * DEFAULT_LINE_HEIGHT_RATIO,
            ),
        );
        TextSystem {
            fs,
            scale: ScaleContext::new(),
            glyphs: Lru::new(),
            measures: Lru::new(),
            scratch,
            families: FxMap::default(),
            aliases,
            known,
            measure_hits: 0,
            measure_misses: 0,
        }
    }

    /// Map a `fontFamily` style value to an installed family name.
    fn resolve_family(&mut self, requested: &str) -> String {
        if let Some(f) = self.families.get(requested) {
            return f.clone();
        }
        let lower = requested.trim().to_ascii_lowercase();
        let resolved = if lower.is_empty()
            || lower == "inter"
            || lower == "sans-serif"
            || lower == "system-ui"
        {
            SANS_FAMILY.to_string()
        } else if lower == "jetbrains mono"
            || lower == "monospace"
            || lower == "mono"
            || lower == "jetbrainsmono"
        {
            MONO_FAMILY.to_string()
        } else if let Some(alias) = self.aliases.get(&lower) {
            alias.clone()
        } else if let Some(k) = self.known.iter().find(|k| k.to_ascii_lowercase() == lower) {
            k.clone()
        } else {
            SANS_FAMILY.to_string()
        };
        self.families
            .insert(requested.to_string(), resolved.clone());
        resolved
    }

    fn prepare(
        &mut self,
        content: &TextContent,
        style: &TextStyle,
        max_width: Option<f32>,
        wrap: Wrap,
    ) {
        let family = self.resolve_family(&style.family);
        let mut flags = CacheKeyFlags::DISABLE_HINTING;
        if style.italic {
            flags |= CacheKeyFlags::FAKE_ITALIC;
        }
        let spacing = if style.letter_spacing != 0.0 {
            Some(LetterSpacing(style.letter_spacing / style.size))
        } else {
            None
        };
        let base = {
            let mut a = Attrs::new()
                .family(Family::Name(&family))
                .weight(Weight(style.weight))
                .style(if style.italic {
                    FontStyleAttr::Italic
                } else {
                    FontStyleAttr::Normal
                })
                .cache_key_flags(flags);
            a.letter_spacing_opt = spacing;
            a
        };
        self.scratch
            .set_metrics(Metrics::new(style.size, style.line_height));
        self.scratch.set_wrap(wrap);
        self.scratch.set_ellipsize(if style.lines > 0 {
            Ellipsize::End(EllipsizeHeightLimit::Lines(style.lines as usize))
        } else {
            Ellipsize::None
        });
        self.scratch.set_size(max_width, None);
        let texts: Vec<Cow<str>> = content
            .spans
            .iter()
            .map(|s| transform_text(&s.text, style.transform))
            .collect();
        let ratio = style.line_height / style.size;
        let spans = content
            .spans
            .iter()
            .zip(texts.iter())
            .enumerate()
            .map(|(i, (span, text))| {
                let mut a = base.clone().metadata(i);
                if let Some(w) = span.weight {
                    a = a.weight(Weight(w));
                }
                if let Some(sz) = span.size {
                    a = a.metrics(Metrics::new(sz, (sz * ratio).round()));
                }
                (text.as_ref(), a)
            });
        let align = match style.align {
            TextAlign::Left => Some(Align::Left),
            TextAlign::Center => Some(Align::Center),
            TextAlign::Right => Some(Align::Right),
            TextAlign::Justify => Some(Align::Justified),
            TextAlign::Auto => None,
        };
        self.scratch
            .set_rich_text(spans, &base, Shaping::Advanced, align);
        self.scratch.shape_until_scroll(&mut self.fs, false);
    }

    /// Width/height of `content` when wrapped at `max_width` (`None` = unbounded).
    /// Cached by `(content, style, width)`; width is rounded up so a node sized
    /// to the measurement never wraps when laid out again.
    pub fn measure(
        &mut self,
        content: &TextContent,
        style: &TextStyle,
        max_width: Option<f32>,
    ) -> (f32, f32) {
        if content.is_empty() {
            return (0.0, 0.0);
        }
        let key = MeasureKey {
            content: content.hash,
            style: style.hash64(),
            width: max_width.map_or(u32::MAX, |w| w.max(0.0).to_bits()),
        };
        if let Some(v) = self.measures.get(&key) {
            self.measure_hits += 1;
            return *v;
        }
        self.measure_misses += 1;
        self.prepare(content, style, max_width, Wrap::WordOrGlyph);
        let mut w = 0.0f32;
        let mut h = 0.0f32;
        for run in self.scratch.layout_runs() {
            w = w.max(run.line_w);
            h += run.line_height;
        }
        let out = (w.ceil(), h.ceil());
        self.measures.insert(key, out, 1);
        self.measures.trim(usize::MAX, MEASURE_CACHE_ENTRIES);
        out
    }
    /// Min-content size: the widest unbreakable word (CSS `min-content`).
    pub fn measure_min_content(&mut self, content: &TextContent, style: &TextStyle) -> (f32, f32) {
        if content.is_empty() {
            return (0.0, 0.0);
        }
        let key = MeasureKey {
            content: content.hash,
            style: style.hash64(),
            width: u32::MAX - 1,
        };
        if let Some(v) = self.measures.get(&key) {
            return *v;
        }
        self.prepare(content, style, Some(0.0), Wrap::Word);
        let mut w = 0.0f32;
        let mut h = 0.0f32;
        for run in self.scratch.layout_runs() {
            w = w.max(run.line_w);
            h += run.line_height;
        }
        let out = (w.ceil(), h.ceil());
        self.measures.insert(key, out, 1);
        out
    }

    /// Shape and position `content`, rasterising (or fetching from the cache)
    /// every glyph bitmap.
    pub fn layout(
        &mut self,
        content: &TextContent,
        style: &TextStyle,
        max_width: Option<f32>,
    ) -> TextRun {
        let mut run_out = TextRun::default();
        if content.is_empty() {
            return run_out;
        }
        self.prepare(content, style, max_width, Wrap::WordOrGlyph);
        struct Raw {
            font_id: fontdb::ID,
            glyph_id: u16,
            size: f32,
            weight: u16,
            italic: bool,
            x: f32,
            y: f32,
            color: Option<Color>,
        }
        let mut raw: Vec<Raw> = Vec::new();
        let limit = if style.lines > 0 {
            style.lines as usize
        } else {
            usize::MAX
        };
        for run in self.scratch.layout_runs() {
            if run_out.lines >= limit {
                break;
            }
            run_out.lines += 1;
            run_out.width = run_out.width.max(run.line_w);
            run_out.height += run.line_height;
            let baseline = run.line_y.round();
            for g in run.glyphs {
                let color = content.spans.get(g.metadata).and_then(|s| s.color);
                raw.push(Raw {
                    font_id: g.font_id,
                    glyph_id: g.glyph_id,
                    size: g.font_size,
                    weight: g.font_weight.0,
                    italic: g.cache_key_flags.contains(CacheKeyFlags::FAKE_ITALIC),
                    x: g.x + g.x_offset * g.font_size,
                    y: baseline - g.y_offset * g.font_size,
                    color,
                });
            }
        }
        run_out.glyphs.reserve(raw.len());
        for r in raw {
            let (xi, bin) = split_subpixel(r.x);
            let key = GlyphKey {
                font_id: r.font_id,
                glyph_id: r.glyph_id,
                size_64: size_to_64(r.size),
                weight: r.weight,
                bin,
                italic: r.italic,
            };
            let bitmap = self.glyph(key);
            run_out.glyphs.push(PlacedGlyph {
                font_id: r.font_id,
                glyph_id: r.glyph_id,
                size: r.size,
                weight: r.weight,
                italic: r.italic,
                x: r.x,
                y: r.y,
                color: r.color,
                bitmap,
                xi,
                yi: r.y.round() as i32,
            });
        }
        let mut b = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
        for g in &run_out.glyphs {
            if let Some(bm) = &g.bitmap {
                let x0 = (g.xi + bm.left) as f32;
                let y0 = (g.yi - bm.top) as f32;
                b = (
                    b.0.min(x0),
                    b.1.min(y0),
                    b.2.max(x0 + bm.w as f32),
                    b.3.max(y0 + bm.h as f32),
                );
            }
        }
        if b.0 <= b.2 {
            run_out.bounds = pk_protocol::Rect::new(b.0, b.1, b.2 - b.0, b.3 - b.1);
        }
        self.glyphs.trim(GLYPH_CACHE_BYTES, usize::MAX);
        run_out
    }

    /// Fetch or rasterise one glyph bitmap (`None` for blank glyphs and missing fonts).
    pub fn glyph(&mut self, key: GlyphKey) -> Option<Arc<GlyphBitmap>> {
        if let Some(v) = self.glyphs.get(&key) {
            return v.clone();
        }
        let bitmap = self.rasterize(&key);
        let cost = bitmap.as_ref().map_or(64, |b| b.data.len() + 64);
        self.glyphs.insert(key, bitmap.clone(), cost);
        bitmap
    }

    fn rasterize(&mut self, key: &GlyphKey) -> Option<Arc<GlyphBitmap>> {
        let font = self.fs.get_font(key.font_id, Weight(key.weight))?;
        let size = key.size_64 as f32 / 64.0;
        let mut scaler = self
            .scale
            .builder(font.as_swash())
            .size(size)
            .hint(false)
            .build();
        let mut render = Render::new(&[Source::Outline]);
        render
            .format(Format::Alpha)
            .offset(Vector::new(key.bin as f32 / 4.0, 0.0));
        if key.italic {
            render.transform(Some(ZenoTransform::skew(
                Angle::from_degrees(14.0),
                Angle::from_degrees(0.0),
            )));
        }
        let img = render.render(&mut scaler, key.glyph_id)?;
        if img.placement.width == 0 || img.placement.height == 0 {
            return None;
        }
        Some(Arc::new(GlyphBitmap {
            left: img.placement.left,
            top: img.placement.top,
            w: img.placement.width,
            h: img.placement.height,
            data: img.data,
        }))
    }

    pub fn glyph_cache_bytes(&self) -> usize {
        self.glyphs.total_cost()
    }

    pub fn glyph_cache_len(&self) -> usize {
        self.glyphs.len()
    }
}

#[inline]
pub fn size_to_64(size: f32) -> u32 {
    (size * 64.0).round().max(1.0) as u32
}

/// Split a fractional x into (integer pixel, quarter-pixel bin).
#[inline]
pub fn split_subpixel(x: f32) -> (i32, u8) {
    let fl = x.floor();
    let frac = x - fl;
    let mut bin = (frac * 4.0).floor() as i32;
    let mut xi = fl as i32;
    if bin >= 4 {
        bin = 0;
        xi += 1;
    }
    (xi, bin.max(0) as u8)
}

impl Hash for TextStyle {
    fn hash<H: Hasher>(&self, state: &mut H) {
        state.write_u64(self.hash64());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measures_hello_at_inter_24() {
        let mut t = TextSystem::new(&[]);
        let style = TextStyle::plain(24.0, 400, false);
        let (w, h) = t.measure(&TextContent::plain("Hello"), &style, None);
        // Recorded once on this machine with Inter Regular 24 px (ceil of the advance sum).
        assert!((w - RECORDED_HELLO_WIDTH).abs() <= 1.0, "width {w}");
        assert_eq!(h, 30.0);
        // Second call is a cache hit.
        let before = t.measure_hits;
        t.measure(&TextContent::plain("Hello"), &style, None);
        assert_eq!(t.measure_hits, before + 1);
    }

    #[test]
    fn wraps_and_ellipsizes() {
        let mut t = TextSystem::new(&[]);
        let style = TextStyle::plain(24.0, 400, false);
        let content = TextContent::plain("the quick brown fox jumps over the lazy dog");
        let (w1, h1) = t.measure(&content, &style, None);
        let (w2, h2) = t.measure(&content, &style, Some(w1 / 2.0));
        assert!(w2 <= w1 / 2.0 + 1.0 && h2 > h1, "{w1}x{h1} -> {w2}x{h2}");
        let mut one = style.clone();
        one.lines = 1;
        let (_, h3) = t.measure(&content, &one, Some(w1 / 2.0));
        assert_eq!(h3, h1);
        let run = t.layout(&content, &one, Some(w1 / 2.0));
        assert_eq!(run.lines, 1);
        assert!(run.width <= w1 / 2.0 + 1.0);
    }

    #[test]
    fn rasterises_glyphs_and_caches_them() {
        let mut t = TextSystem::new(&[]);
        let run = t.layout(
            &TextContent::plain("Hi"),
            &TextStyle::plain(24.0, 400, false),
            None,
        );
        assert_eq!(run.glyphs.len(), 2);
        assert!(run.glyphs.iter().all(|g| {
            g.bitmap
                .as_ref()
                .is_some_and(|b| b.data.iter().any(|v| *v > 0))
        }));
        let n = t.glyph_cache_len();
        t.layout(
            &TextContent::plain("Hi"),
            &TextStyle::plain(24.0, 400, false),
            None,
        );
        assert_eq!(t.glyph_cache_len(), n);
    }

    #[test]
    fn mono_family_is_selected() {
        let mut t = TextSystem::new(&[]);
        let a = t
            .measure(
                &TextContent::plain("iiii"),
                &TextStyle::plain(24.0, 500, true),
                None,
            )
            .0;
        let b = t
            .measure(
                &TextContent::plain("WWWW"),
                &TextStyle::plain(24.0, 500, true),
                None,
            )
            .0;
        assert_eq!(a, b, "monospace advance widths are equal");
    }

    /// Inter Regular 24 px "Hello": measured once on this machine (aarch64 macOS, cosmic-text 0.19).
    const RECORDED_HELLO_WIDTH: f32 = 58.0;
}
