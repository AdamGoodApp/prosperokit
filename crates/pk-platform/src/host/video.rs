//! Desktop video: a 1920×1080 shadow of the screen in softbuffer's pixel
//! format, filled from the engine's frame one dirty tile at a time and copied
//! into the window surface on demand. A larger window shows the frame at a
//! whole-number scale (sharp; black bars around it); a smaller one gets an
//! area-averaged reduction. Stretching by a fractional factor is never done:
//! it duplicates some pixel rows and columns but not others, which makes text
//! look rough and soft.

use std::fs::File;
use std::io::BufWriter;
use std::path::Path;

use pk_protocol::{SCREEN_HEIGHT, SCREEN_WIDTH, TILE, TileSet};

const W: usize = SCREEN_WIDTH as usize;
const H: usize = SCREEN_HEIGHT as usize;

/// Engine pixel (bytes R,G,B,A in memory = `0xAABBGGRR`) → softbuffer's `0x00RRGGBB`.
#[inline]
pub(crate) fn to_xrgb(p: u32) -> u32 {
    (p & 0xff) << 16 | (p & 0xff00) | (p >> 16) & 0xff
}

pub(crate) struct HostVideo {
    /// `0x00RRGGBB`, 1920×1080, row by row.
    shadow: Vec<u32>,
    /// Something was presented since the last blit to a window.
    dirty: bool,
    /// Box-filter taps for the last reduced size (cached per target size).
    reduce: Option<Reduce>,
    /// Horizontally reduced rows (target width × 1080), reused across blits.
    scratch: Vec<u32>,
}

/// Separable box-filter taps for one reduced output size.
struct Reduce {
    size: (usize, usize),
    cols: Vec<Taps>,
    rows: Vec<Taps>,
}

/// Source pixels covered by one output pixel, with weights summing to 2^16.
struct Taps {
    first: usize,
    weights: Vec<u32>,
}

/// For each of `dst` output pixels, the `src` pixels it covers and how much.
fn box_taps(src: usize, dst: usize) -> Vec<Taps> {
    let ratio = src as f64 / dst as f64;
    (0..dst)
        .map(|i| {
            let (lo, hi) = (i as f64 * ratio, (i + 1) as f64 * ratio);
            let first = lo.floor() as usize;
            let last = (hi.ceil() as usize).min(src);
            let mut weights: Vec<u32> = (first..last)
                .map(|j| {
                    let overlap = hi.min(j as f64 + 1.0) - lo.max(j as f64);
                    (overlap / ratio * 65536.0).round() as u32
                })
                .collect();
            // Make the weights sum to exactly 2^16 so flat colours stay exact.
            let sum: u32 = weights.iter().sum();
            if let Some(w) = weights.iter_mut().max() {
                *w = (*w + 65536).saturating_sub(sum);
            }
            Taps { first, weights }
        })
        .collect()
}

/// Weighted sum of `0x00RRGGBB` pixels (weights sum to 2^16).
#[inline]
fn mix(pixels: impl Iterator<Item = (u32, u32)>) -> u32 {
    let (mut r, mut g, mut b) = (0u32, 0u32, 0u32);
    for (p, w) in pixels {
        r += (p >> 16 & 0xff) * w;
        g += (p >> 8 & 0xff) * w;
        b += (p & 0xff) * w;
    }
    let round = |c: u32| (c + 32768) >> 16;
    round(r) << 16 | round(g) << 8 | round(b)
}

impl HostVideo {
    pub(crate) fn new() -> HostVideo {
        HostVideo {
            shadow: vec![0; W * H],
            dirty: true,
            reduce: None,
            scratch: Vec::new(),
        }
    }

    /// Copies the dirty tiles of `frame` into the shadow, converting pixels.
    pub(crate) fn present(&mut self, frame: &[u32], dirty: &TileSet) {
        if dirty.is_empty() || frame.len() < W * H {
            return;
        }
        for (tx, ty) in dirty.iter() {
            let x0 = (tx * TILE) as usize;
            let y0 = (ty * TILE) as usize;
            let x1 = (x0 + TILE as usize).min(W);
            let y1 = (y0 + TILE as usize).min(H);
            for y in y0..y1 {
                let row = y * W;
                let src = &frame[row + x0..row + x1];
                let dst = &mut self.shadow[row + x0..row + x1];
                for (d, s) in dst.iter_mut().zip(src) {
                    *d = to_xrgb(*s);
                }
            }
        }
        self.dirty = true;
    }

    /// True once after each `present` with pixels (or after `invalidate`).
    pub(crate) fn take_dirty(&mut self) -> bool {
        std::mem::take(&mut self.dirty)
    }

    /// Forces the next window blit (resize, expose).
    pub(crate) fn invalidate(&mut self) {
        self.dirty = true;
    }

    /// Draws the shadow into `dst` (`dw`×`dh`, row by row), centred with black
    /// bars: at the largest whole-number scale that fits, or area-averaged
    /// down to the largest 16:9 rectangle when the target is smaller.
    pub(crate) fn blit(&mut self, dst: &mut [u32], dw: usize, dh: usize) {
        if dw == 0 || dh == 0 || dst.len() < dw * dh {
            return;
        }
        if dw == W && dh == H {
            dst[..W * H].copy_from_slice(&self.shadow);
            return;
        }
        let k = (dw / W).min(dh / H);
        if k >= 1 {
            self.blit_scaled(dst, dw, dh, k);
        } else {
            self.blit_reduced(dst, dw, dh);
        }
    }

    /// Whole-number upscale: every source pixel becomes a `k`×`k` block.
    fn blit_scaled(&self, dst: &mut [u32], dw: usize, dh: usize, k: usize) {
        let (ow, oh) = (W * k, H * k);
        let (ox, oy) = ((dw - ow) / 2, (dh - oh) / 2);
        dst[..dw * dh].fill(0);
        for sy in 0..H {
            let src = &self.shadow[sy * W..(sy + 1) * W];
            let top = (oy + sy * k) * dw + ox;
            let row = &mut dst[top..top + ow];
            for (block, p) in row.chunks_exact_mut(k).zip(src) {
                block.fill(*p);
            }
            for r in 1..k {
                dst.copy_within(top..top + ow, top + r * dw);
            }
        }
    }

    /// Area-averaged reduction to the largest 16:9 rectangle that fits.
    fn blit_reduced(&mut self, dst: &mut [u32], dw: usize, dh: usize) {
        let (ow, oh) = fit(dw, dh);
        let (ox, oy) = ((dw - ow) / 2, (dh - oh) / 2);
        if self.reduce.as_ref().is_none_or(|r| r.size != (ow, oh)) {
            self.reduce = Some(Reduce {
                size: (ow, oh),
                cols: box_taps(W, ow),
                rows: box_taps(H, oh),
            });
        }
        let Some(reduce) = &self.reduce else { return };
        dst[..dw * dh].fill(0);
        self.scratch.resize(ow * H, 0);
        for sy in 0..H {
            let src = &self.shadow[sy * W..(sy + 1) * W];
            for (x, t) in reduce.cols.iter().enumerate() {
                let px = src[t.first..]
                    .iter()
                    .copied()
                    .zip(t.weights.iter().copied());
                self.scratch[sy * ow + x] = mix(px);
            }
        }
        for (y, t) in reduce.rows.iter().enumerate() {
            let row = &mut dst[(oy + y) * dw + ox..(oy + y) * dw + ox + ow];
            for (x, d) in row.iter_mut().enumerate() {
                let px = t
                    .weights
                    .iter()
                    .enumerate()
                    .map(|(i, w)| (self.scratch[(t.first + i) * ow + x], *w));
                *d = mix(px);
            }
        }
    }

    /// The shadow as 8-bit RGBA bytes (alpha 255).
    pub(crate) fn rgba(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(W * H * 4);
        for p in &self.shadow {
            out.extend_from_slice(&[(p >> 16) as u8, (p >> 8) as u8, *p as u8, 255]);
        }
        out
    }

    pub(crate) fn write_png(&self, path: &Path) -> Result<(), String> {
        let file = File::create(path).map_err(|e| format!("{}: {e}", path.display()))?;
        let mut encoder = png::Encoder::new(BufWriter::new(file), SCREEN_WIDTH, SCREEN_HEIGHT);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
        writer
            .write_image_data(&self.rgba())
            .map_err(|e| e.to_string())?;
        writer.finish().map_err(|e| e.to_string())
    }

    #[cfg(test)]
    pub(crate) fn pixel(&self, x: usize, y: usize) -> u32 {
        self.shadow[y * W + x]
    }
}

/// The largest 16:9 rectangle that fits in `dw`×`dh`.
fn fit(dw: usize, dh: usize) -> (usize, usize) {
    if dw * H <= dh * W {
        (dw, (dw * H / W).max(1))
    } else {
        ((dh * W / H).max(1), dh)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pk_protocol::Rect;

    #[test]
    fn pixel_conversion_swaps_red_and_blue() {
        // bytes R=0x11 G=0x22 B=0x33 A=0xff → little-endian u32 0xff332211
        assert_eq!(to_xrgb(0xff33_2211), 0x0011_2233);
    }

    #[test]
    fn only_dirty_tiles_are_copied() {
        let mut video = HostVideo::new();
        let frame = vec![0xff33_2211u32; W * H];
        let mut dirty = TileSet::empty();
        dirty.insert_rect(&Rect::new(130.0, 10.0, 10.0, 10.0)); // tile (1, 0)
        video.present(&frame, &dirty);
        assert_eq!(video.pixel(128, 0), 0x0011_2233);
        assert_eq!(video.pixel(255, 127), 0x0011_2233);
        assert_eq!(video.pixel(127, 0), 0);
        assert_eq!(video.pixel(256, 0), 0);
        assert_eq!(video.pixel(128, 128), 0);
    }

    #[test]
    fn last_tile_row_is_clipped_to_the_screen() {
        let mut video = HostVideo::new();
        let frame = vec![0xff00_00ffu32; W * H];
        video.present(&frame, &TileSet::full());
        assert_eq!(video.pixel(W - 1, H - 1), 0x00ff_0000);
    }

    /// A frame with distinct pixels: alternating white/black columns.
    fn striped() -> HostVideo {
        let mut video = HostVideo::new();
        let frame: Vec<u32> = (0..W * H)
            .map(|i| if i % 2 == 0 { 0xffff_ffff } else { 0xff00_0000 })
            .collect();
        video.present(&frame, &TileSet::full());
        video
    }

    #[test]
    fn a_window_with_room_for_2x_gets_exact_2x2_blocks_centred() {
        let mut video = striped();
        let (dw, dh) = (W * 2 + 100, H * 2 + 40);
        let mut dst = vec![1u32; dw * dh];
        video.blit(&mut dst, dw, dh);
        let (ox, oy) = (50, 20);
        assert_eq!(dst[0], 0, "bar");
        for (x, expect) in [(0, 0x00ff_ffff), (1, 0x00ff_ffff), (2, 0), (3, 0)] {
            assert_eq!(dst[oy * dw + ox + x], expect, "column {x}");
            assert_eq!(dst[(oy + 1) * dw + ox + x], expect, "row 2, column {x}");
        }
    }

    #[test]
    fn a_window_between_1x_and_2x_shows_the_frame_pixel_for_pixel() {
        let mut video = striped();
        let (dw, dh) = (2700, 1580);
        let mut dst = vec![1u32; dw * dh];
        video.blit(&mut dst, dw, dh);
        let (ox, oy) = ((dw - W) / 2, (dh - H) / 2);
        let row = &dst[oy * dw + ox..oy * dw + ox + W];
        assert_eq!(row, &video.shadow[..W], "an unscaled copy, no stretching");
        assert_eq!(dst[oy * dw + ox - 1], 0, "bar left of the frame");
    }

    #[test]
    fn a_smaller_window_averages_instead_of_dropping_pixels() {
        let mut video = striped();
        let (dw, dh) = (960, 800);
        let mut dst = vec![1u32; dw * dh];
        video.blit(&mut dst, dw, dh);
        assert_eq!(fit(dw, dh), (960, 540));
        let oy = (dh - 540) / 2;
        assert_eq!(dst[0], 0, "bar");
        // Each output pixel covers one white and one black column: mid-grey,
        // where nearest-neighbour would show only one of them.
        assert_eq!(dst[(oy + 10) * dw + 5], 0x0080_8080);
        assert_eq!(dst[(dh - 1) * dw], 0, "bar");
    }

    #[test]
    fn flat_colours_survive_reduction_exactly() {
        let mut video = HostVideo::new();
        video.present(&vec![0xff33_2211u32; W * H], &TileSet::full());
        let (dw, dh) = (1351, 760);
        let mut dst = vec![0u32; dw * dh];
        video.blit(&mut dst, dw, dh);
        let (ow, oh) = fit(dw, dh);
        let (ox, oy) = ((dw - ow) / 2, (dh - oh) / 2);
        for (x, y) in [(0, 0), (ow - 1, oh - 1), (ow / 3, oh / 2)] {
            assert_eq!(dst[(oy + y) * dw + ox + x], 0x0011_2233, "at {x},{y}");
        }
    }

    #[test]
    fn rgba_has_opaque_alpha() {
        let mut video = HostVideo::new();
        video.present(&vec![0xff33_2211u32; W * H], &TileSet::full());
        assert_eq!(&video.rgba()[..4], &[0x11, 0x22, 0x33, 255]);
    }
}
