//! ProsperoKit shared contracts between the JS side (`@prosperokit/react`,
//! the prelude) and the Rust side (`pk-js`, `pk-engine`): bridge values,
//! mutation ops, node props, the style model, events and the compiled
//! Tailwind style table. `protocol.json` holds the constants both sides use.

pub mod color;
pub mod events;
pub mod ops;
pub mod props;
pub mod style;
pub mod style_table;
pub mod value;

pub use color::Color;
pub use events::{EventKind, UiEvent};
pub use ops::{AnimProp, AnimValue, NodeKind, Op, OpError, parse_commit};
pub use props::{
    Direction, FocusScope, NodeId, OVERLAY_ID, Prop, PropKey, PropUpdate, Props, ROOT_ID,
};
pub use style::{Easing, Length, Style, Transition};
pub use style_table::{ResolvedClasses, StyleTable, TokenStyle};
pub use value::Value;

/// The constants shared with TypeScript (`packages/react` imports the same file).
pub const PROTOCOL_JSON: &str = include_str!("../protocol.json");

/// Logical screen size (1080p, no DPI scaling in v1).
pub const SCREEN_WIDTH: u32 = 1920;
pub const SCREEN_HEIGHT: u32 = 1080;
/// Dirty-tile and scanout tile size in pixels.
pub const TILE: u32 = 128;
pub const TILES_X: u32 = SCREEN_WIDTH.div_ceil(TILE);
pub const TILES_Y: u32 = SCREEN_HEIGHT.div_ceil(TILE);

/// Axis-aligned rectangle in screen pixels.
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

impl Rect {
    pub const fn new(x: f32, y: f32, w: f32, h: f32) -> Rect {
        Rect { x, y, w, h }
    }
    pub fn right(&self) -> f32 {
        self.x + self.w
    }
    pub fn bottom(&self) -> f32 {
        self.y + self.h
    }
    pub fn center(&self) -> (f32, f32) {
        (self.x + self.w / 2.0, self.y + self.h / 2.0)
    }
    pub fn is_empty(&self) -> bool {
        self.w <= 0.0 || self.h <= 0.0
    }
    pub fn intersects(&self, o: &Rect) -> bool {
        self.x < o.right() && o.x < self.right() && self.y < o.bottom() && o.y < self.bottom()
    }
    pub fn intersection(&self, o: &Rect) -> Rect {
        let x = self.x.max(o.x);
        let y = self.y.max(o.y);
        let r = self.right().min(o.right());
        let b = self.bottom().min(o.bottom());
        Rect {
            x,
            y,
            w: (r - x).max(0.0),
            h: (b - y).max(0.0),
        }
    }
    pub fn union(&self, o: &Rect) -> Rect {
        if self.is_empty() {
            return *o;
        }
        if o.is_empty() {
            return *self;
        }
        let x = self.x.min(o.x);
        let y = self.y.min(o.y);
        Rect {
            x,
            y,
            w: self.right().max(o.right()) - x,
            h: self.bottom().max(o.bottom()) - y,
        }
    }
    pub fn contains_point(&self, px: f32, py: f32) -> bool {
        px >= self.x && px < self.right() && py >= self.y && py < self.bottom()
    }
    pub fn contains(&self, o: &Rect) -> bool {
        o.x >= self.x && o.y >= self.y && o.right() <= self.right() && o.bottom() <= self.bottom()
    }
    pub fn translate(&self, dx: f32, dy: f32) -> Rect {
        Rect {
            x: self.x + dx,
            y: self.y + dy,
            ..*self
        }
    }
    pub fn inflate(&self, d: f32) -> Rect {
        Rect {
            x: self.x - d,
            y: self.y - d,
            w: self.w + 2.0 * d,
            h: self.h + 2.0 * d,
        }
    }
    pub fn to_value(&self) -> Value {
        Value::obj([
            ("x", Value::from(self.x)),
            ("y", Value::from(self.y)),
            ("width", Value::from(self.w)),
            ("height", Value::from(self.h)),
        ])
    }
}

/// The set of dirty 128×128 tiles on the 1920×1080 screen.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct TileSet {
    bits: [u64; 3],
}

impl Default for TileSet {
    fn default() -> Self {
        TileSet::empty()
    }
}

impl std::fmt::Debug for TileSet {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "TileSet({} tiles)", self.count())
    }
}

impl TileSet {
    pub const COUNT: u32 = TILES_X * TILES_Y;

    pub const fn empty() -> TileSet {
        TileSet { bits: [0; 3] }
    }

    pub fn full() -> TileSet {
        let mut t = TileSet::empty();
        for i in 0..Self::COUNT {
            t.set_index(i);
        }
        t
    }

    fn set_index(&mut self, i: u32) {
        self.bits[(i / 64) as usize] |= 1u64 << (i % 64);
    }

    pub fn contains(&self, tx: u32, ty: u32) -> bool {
        if tx >= TILES_X || ty >= TILES_Y {
            return false;
        }
        let i = ty * TILES_X + tx;
        self.bits[(i / 64) as usize] & (1u64 << (i % 64)) != 0
    }

    pub fn insert(&mut self, tx: u32, ty: u32) {
        if tx < TILES_X && ty < TILES_Y {
            self.set_index(ty * TILES_X + tx);
        }
    }

    /// Mark every tile a rectangle touches (clipped to the screen).
    pub fn insert_rect(&mut self, r: &Rect) {
        if r.is_empty() {
            return;
        }
        let x0 = r.x.floor().max(0.0);
        let y0 = r.y.floor().max(0.0);
        let x1 = r.right().ceil().min(SCREEN_WIDTH as f32);
        let y1 = r.bottom().ceil().min(SCREEN_HEIGHT as f32);
        if x1 <= x0 || y1 <= y0 {
            return;
        }
        let tx0 = x0 as u32 / TILE;
        let ty0 = y0 as u32 / TILE;
        let tx1 = ((x1 as u32).saturating_sub(1)) / TILE;
        let ty1 = ((y1 as u32).saturating_sub(1)) / TILE;
        for ty in ty0..=ty1 {
            for tx in tx0..=tx1 {
                self.insert(tx, ty);
            }
        }
    }

    pub fn union_with(&mut self, other: &TileSet) {
        for i in 0..3 {
            self.bits[i] |= other.bits[i];
        }
    }

    pub fn is_empty(&self) -> bool {
        self.bits.iter().all(|b| *b == 0)
    }

    pub fn count(&self) -> u32 {
        self.bits.iter().map(|b| b.count_ones()).sum()
    }

    pub fn clear(&mut self) {
        self.bits = [0; 3];
    }

    /// Iterate `(tx, ty)` of every dirty tile in row-major order.
    pub fn iter(&self) -> impl Iterator<Item = (u32, u32)> + '_ {
        (0..Self::COUNT)
            .filter(move |i| self.bits[(i / 64) as usize] & (1u64 << (i % 64)) != 0)
            .map(|i| (i % TILES_X, i / TILES_X))
    }

    pub fn tile_rect(tx: u32, ty: u32) -> Rect {
        Rect {
            x: (tx * TILE) as f32,
            y: (ty * TILE) as f32,
            w: TILE.min(SCREEN_WIDTH - tx * TILE) as f32,
            h: TILE.min(SCREEN_HEIGHT - ty * TILE) as f32,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tile_set_marks_exactly_the_touched_tiles() {
        let mut t = TileSet::empty();
        t.insert_rect(&Rect::new(100.0, 100.0, 100.0, 100.0)); // spans tiles (0..1, 0..1)
        let tiles: Vec<_> = t.iter().collect();
        assert_eq!(tiles, vec![(0, 0), (1, 0), (0, 1), (1, 1)]);
        let mut moved = TileSet::empty();
        moved.insert_rect(&Rect::new(110.0, 100.0, 100.0, 100.0));
        t.union_with(&moved);
        assert_eq!(t.count(), 4);
        assert_eq!(TileSet::full().count(), 15 * 9);
        assert_eq!(TILES_X, 15);
        assert_eq!(TILES_Y, 9);
        let last = TileSet::tile_rect(14, 8);
        assert_eq!((last.w, last.h), (128.0, 56.0));
        let mut off = TileSet::empty();
        off.insert_rect(&Rect::new(-50.0, -50.0, 40.0, 40.0));
        assert!(off.is_empty());
    }
}
