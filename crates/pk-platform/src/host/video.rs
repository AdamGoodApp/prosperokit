//! Desktop video: a 1920×1080 shadow of the screen in softbuffer's pixel
//! format, filled from the engine's frame one dirty tile at a time and scaled
//! (nearest-neighbour, letterboxed) into the window surface on demand.

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
    /// Horizontal source column for each destination column of the last blit
    /// (cached per target size).
    x_map: Vec<u32>,
    x_map_key: (usize, usize),
}

impl HostVideo {
    pub(crate) fn new() -> HostVideo {
        HostVideo {
            shadow: vec![0; W * H],
            dirty: true,
            x_map: Vec::new(),
            x_map_key: (0, 0),
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

    /// Scales the shadow into `dst` (`dw`×`dh`, row by row): fit inside,
    /// keep the aspect ratio, black bars, nearest-neighbour.
    pub(crate) fn blit(&mut self, dst: &mut [u32], dw: usize, dh: usize) {
        if dw == 0 || dh == 0 || dst.len() < dw * dh {
            return;
        }
        if dw == W && dh == H {
            dst[..W * H].copy_from_slice(&self.shadow);
            return;
        }
        let (ow, oh) = fit(dw, dh);
        let (ox, oy) = ((dw - ow) / 2, (dh - oh) / 2);
        dst[..dw * dh].fill(0);
        if self.x_map_key != (ow, oh) {
            self.x_map = (0..ow).map(|x| (x * W / ow) as u32).collect();
            self.x_map_key = (ow, oh);
        }
        for y in 0..oh {
            let sy = y * H / oh;
            let src = &self.shadow[sy * W..(sy + 1) * W];
            let row = &mut dst[(oy + y) * dw + ox..(oy + y) * dw + ox + ow];
            for (d, sx) in row.iter_mut().zip(&self.x_map) {
                *d = src[*sx as usize];
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

    #[test]
    fn blit_letterboxes_and_scales() {
        let mut video = HostVideo::new();
        video.present(&vec![0xffff_ffffu32; W * H], &TileSet::full());
        let (dw, dh) = (960, 800);
        let mut dst = vec![1u32; dw * dh];
        video.blit(&mut dst, dw, dh);
        let (ow, oh) = fit(dw, dh);
        assert_eq!((ow, oh), (960, 540));
        let oy = (dh - oh) / 2;
        assert_eq!(dst[0], 0); // bar
        assert_eq!(dst[(oy + 10) * dw + 5], 0x00ff_ffff);
        assert_eq!(dst[(dh - 1) * dw], 0); // bar
    }

    #[test]
    fn rgba_has_opaque_alpha() {
        let mut video = HostVideo::new();
        video.present(&vec![0xff33_2211u32; W * H], &TileSet::full());
        assert_eq!(&video.rgba()[..4], &[0x11, 0x22, 0x33, 255]);
    }
}
