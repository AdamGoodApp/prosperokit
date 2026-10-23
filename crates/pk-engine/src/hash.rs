//! A small, fast, non-cryptographic hasher (FxHash-style) used for node-id
//! maps, text cache keys and display-list command signatures.

use std::hash::{BuildHasherDefault, Hasher};

#[derive(Default, Clone, Copy)]
pub struct Fx(u64);

const SEED: u64 = 0x51_7c_c1_b7_27_22_0a_95;

impl Fx {
    #[inline]
    pub fn new() -> Fx {
        Fx(0)
    }

    #[inline]
    pub fn u64(&mut self, v: u64) -> &mut Fx {
        self.0 = (self.0.rotate_left(5) ^ v).wrapping_mul(SEED);
        self
    }

    #[inline]
    pub fn u32(&mut self, v: u32) -> &mut Fx {
        self.u64(v as u64)
    }

    #[inline]
    pub fn f32(&mut self, v: f32) -> &mut Fx {
        // Canonicalise -0.0 so equal values hash equal.
        let v = if v == 0.0 { 0.0 } else { v };
        self.u64(v.to_bits() as u64)
    }

    #[inline]
    pub fn bool(&mut self, v: bool) -> &mut Fx {
        self.u64(v as u64)
    }

    pub fn str(&mut self, s: &str) -> &mut Fx {
        self.write(s.as_bytes());
        self.u64(s.len() as u64)
    }

    #[inline]
    pub fn done(&self) -> u64 {
        // One extra avalanche step so low bits are usable for bucketing.
        let mut h = self.0;
        h ^= h >> 32;
        h = h.wrapping_mul(0x9e37_79b9_7f4a_7c15);
        h ^ (h >> 29)
    }
}

impl Hasher for Fx {
    fn write(&mut self, bytes: &[u8]) {
        let mut chunks = bytes.chunks_exact(8);
        for c in &mut chunks {
            let mut b = [0u8; 8];
            b.copy_from_slice(c);
            self.u64(u64::from_le_bytes(b));
        }
        let rest = chunks.remainder();
        if !rest.is_empty() {
            let mut b = [0u8; 8];
            b[..rest.len()].copy_from_slice(rest);
            self.u64(u64::from_le_bytes(b));
        }
    }

    fn write_u32(&mut self, i: u32) {
        self.u64(i as u64);
    }

    fn write_u64(&mut self, i: u64) {
        self.u64(i);
    }

    fn finish(&self) -> u64 {
        self.done()
    }
}

pub type BuildFx = BuildHasherDefault<Fx>;
pub type FxMap<K, V> = std::collections::HashMap<K, V, BuildFx>;
pub type FxSet<K> = std::collections::HashSet<K, BuildFx>;
