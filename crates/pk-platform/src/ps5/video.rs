//! PS5 video: two 16 MiB tiled scanout buffers in write-combined direct
//! memory, registered with VideoOut. `present` copies the dirty 128×128 tiles
//! of the engine's linear frame into the back buffer (4×8-pixel groups, see
//! `layout::copy_tile`), flushes the written cache lines and flips.
//!
//! Two buffers alternate, so the back buffer is one frame older than the one on
//! screen: the tiles to copy are the union of this frame's and the previous
//! frame's dirty tiles. A buffer that was never written gets a full copy.

use std::arch::x86_64::{_mm_clflush, _mm_mfence};
use std::ffi::c_void;
use std::ptr;

use pk_protocol::{SCREEN_HEIGHT, SCREEN_WIDTH, TileSet};

use super::layout::copy_tile;
use super::sys;
use crate::PlatformError;

const FRAME_BYTES: usize = 0x100_0000;
const MEMORY_BYTES: usize = FRAME_BYTES * 2;
const MEMORY_ALIGNMENT: usize = 0x20_0000;
const PIXELS: usize = (SCREEN_WIDTH * SCREEN_HEIGHT) as usize;

pub struct Ps5Video {
    handle: i32,
    buffers: [*mut u8; 2],
    /// Index of the buffer on screen (`1` before the first flip, so the first
    /// frame goes to buffer 0).
    shown: usize,
    /// The buffer holds an image consistent with the frame sequence.
    valid: [bool; 2],
    prev_dirty: TileSet,
    flip_argument: i64,
}

fn failed(what: &str, code: i32) -> PlatformError {
    PlatformError::Failed {
        what: what.to_string(),
        code: i64::from(code),
    }
}

impl Ps5Video {
    /// The 128-pixel tile edge of the scanout tiling.
    pub const fn tile_size() -> u32 {
        pk_protocol::TILE
    }

    pub fn new() -> Result<Ps5Video, PlatformError> {
        // SAFETY: plain FFI calls with valid out-pointers.
        unsafe {
            sys::sceSystemServiceHideSplashScreen();
            let handle = sys::sceVideoOutOpen(0xff, 0, 0, ptr::null());
            if handle < 0 {
                return Err(failed("sceVideoOutOpen", handle));
            }
            let pool = sys::sceKernelGetDirectMemorySize();
            if pool < MEMORY_BYTES {
                return Err(failed("not enough direct memory", 0));
            }
            let mut physical: i64 = 0;
            let r = sys::sceKernelAllocateDirectMemory(
                0,
                pool as i64,
                MEMORY_BYTES,
                MEMORY_ALIGNMENT,
                sys::MEMORY_TYPE_WC_GARLIC,
                &mut physical,
            );
            if r < 0 {
                return Err(failed("sceKernelAllocateDirectMemory", r));
            }
            let mut mapped: *mut c_void = ptr::null_mut();
            let r = sys::sceKernelMapDirectMemory(
                &mut mapped,
                MEMORY_BYTES,
                sys::MAP_PROT_CPU_RW_GPU_RW,
                0,
                physical,
                MEMORY_ALIGNMENT,
            );
            if r < 0 {
                return Err(failed("sceKernelMapDirectMemory", r));
            }
            let base = mapped.cast::<u8>();
            let buffers = [base, base.add(FRAME_BYTES)];
            let registered = buffers.map(|data| sys::VideoBuffer {
                data: data.cast::<c_void>(),
                metadata: ptr::null_mut(),
                reserved0: ptr::null_mut(),
                reserved1: ptr::null_mut(),
            });
            let mut attribute = sys::VideoAttribute { reserved: [0; 80] };
            sys::sceVideoOutSetFlipRate(handle, 0);
            sys::sceVideoOutSetBufferAttribute2(
                &mut attribute,
                sys::PIXEL_FORMAT_RGBA8_SRGB,
                0,
                SCREEN_WIDTH,
                SCREEN_HEIGHT,
                0,
                0,
                0,
            );
            let r = sys::sceVideoOutRegisterBuffers2(
                handle,
                0,
                0,
                registered.as_ptr(),
                2,
                &attribute,
                0,
                ptr::null_mut(),
            );
            if r < 0 {
                return Err(failed("sceVideoOutRegisterBuffers2", r));
            }
            Ok(Ps5Video {
                handle,
                buffers,
                shown: 1,
                valid: [false; 2],
                prev_dirty: TileSet::empty(),
                flip_argument: 1,
            })
        }
    }

    /// Blocks until the next vertical blank (60 Hz pacing).
    pub fn wait_vblank(&self) {
        // SAFETY: plain FFI call on an open handle.
        unsafe { sys::sceVideoOutWaitVblank(self.handle) };
    }

    /// Copies `dirty` (plus last frame's dirty tiles) of `frame` to the back
    /// buffer and flips. An empty set does nothing.
    pub fn present(&mut self, frame: &[u32], dirty: &TileSet) {
        if dirty.is_empty() || frame.len() < PIXELS {
            return;
        }
        let back = self.shown ^ 1;
        let mut tiles = if self.valid[back] {
            self.prev_dirty
        } else {
            TileSet::full()
        };
        tiles.union_with(dirty);
        let scanout = self.buffers[back];
        for (tx, ty) in tiles.iter() {
            // SAFETY: `scanout` is a mapped buffer of FRAME_BYTES >= the 15×9
            // tiles of 64 KiB; the flush covers exactly the cache lines written.
            unsafe { copy_tile(frame, scanout, tx, ty, |line| _mm_clflush(line)) };
        }
        // SAFETY: a fence has no memory-safety preconditions.
        unsafe { _mm_mfence() };
        self.valid[back] = true;
        // SAFETY: plain FFI call; `back` is a registered buffer index.
        let flipped =
            unsafe { sys::sceVideoOutSubmitFlip(self.handle, back as i32, 1, self.flip_argument) };
        self.flip_argument += 1;
        if flipped >= 0 {
            self.shown = back;
            self.prev_dirty = *dirty;
        } else {
            // The buffer was written but is not on screen: its content no longer
            // follows the frame sequence.
            self.valid[back] = false;
        }
    }
}
