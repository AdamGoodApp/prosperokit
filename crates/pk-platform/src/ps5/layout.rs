//! Pure data layouts and helpers of the PS5 backend: FreeBSD 11 `struct stat`
//! and `dirent`, UTF-16 conversion for the IME, the tiled scanout copy and
//! the SCE error-code convention.
//!
//! This file has no FFI so the host test build includes it too
//! (`host/mod.rs`), which lets the layouts be unit-tested on the desktop.

use crate::ps5_tiled_offset;
use pk_protocol::{SCREEN_HEIGHT, SCREEN_WIDTH, TILE};

// ── struct stat (FreeBSD 11, 120 bytes; `$SDK/target/include/sys/stat.h`) ──

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct Timespec {
    pub tv_sec: i64,
    pub tv_nsec: i64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct Stat {
    pub st_dev: u32,
    pub st_ino: u32,
    pub st_mode: u16,
    pub st_nlink: u16,
    pub st_uid: u32,
    pub st_gid: u32,
    pub st_rdev: u32,
    pub st_atim: Timespec,
    pub st_mtim: Timespec,
    pub st_ctim: Timespec,
    pub st_size: i64,
    pub st_blocks: i64,
    pub st_blksize: u32,
    pub st_flags: u32,
    pub st_gen: u32,
    pub st_lspare: i32,
    pub st_birthtim: Timespec,
}

const _: () = assert!(size_of::<Stat>() == 120);
const _: () = assert!(std::mem::offset_of!(Stat, st_atim) == 24);
const _: () = assert!(std::mem::offset_of!(Stat, st_mtim) == 40);
const _: () = assert!(std::mem::offset_of!(Stat, st_size) == 72);
const _: () = assert!(std::mem::offset_of!(Stat, st_birthtim) == 104);

pub const S_IFMT: u16 = 0o170000;
pub const S_IFDIR: u16 = 0o040000;

impl Stat {
    pub fn is_dir(&self) -> bool {
        self.st_mode & S_IFMT == S_IFDIR
    }

    pub fn size(&self) -> u64 {
        self.st_size.max(0) as u64
    }

    pub fn mtime_ms(&self) -> u64 {
        (self.st_mtim.tv_sec.max(0) as u64) * 1000
            + (self.st_mtim.tv_nsec.max(0) as u64) / 1_000_000
    }
}

// ── dirent (FreeBSD 11: d_fileno u32, d_reclen u16, d_type u8, d_namlen u8, d_name[]) ──

/// `d_type` of a directory (the entry type is re-derived from `stat`; kept for the dirent contract and tests).
#[allow(dead_code)]
pub const DT_DIR: u8 = 4;
const DIRENT_HEADER: usize = 8;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RawDirent {
    pub name: String,
    pub d_type: u8,
}

/// Parses one `getdents` buffer. `.`/`..` and deleted entries (`d_fileno == 0`)
/// are skipped; parsing stops at the first malformed record.
pub fn parse_dirents(buf: &[u8]) -> Vec<RawDirent> {
    let mut out = Vec::new();
    let mut at = 0usize;
    while at + DIRENT_HEADER <= buf.len() {
        let fileno = u32::from_le_bytes([buf[at], buf[at + 1], buf[at + 2], buf[at + 3]]);
        let reclen = usize::from(u16::from_le_bytes([buf[at + 4], buf[at + 5]]));
        let d_type = buf[at + 6];
        let namlen = usize::from(buf[at + 7]);
        if reclen < DIRENT_HEADER || at + reclen > buf.len() || DIRENT_HEADER + namlen > reclen {
            break;
        }
        let name = &buf[at + DIRENT_HEADER..at + DIRENT_HEADER + namlen];
        if fileno != 0 && name != b"." && name != b".." {
            out.push(RawDirent {
                name: String::from_utf8_lossy(name).into_owned(),
                d_type,
            });
        }
        at += reclen;
    }
    out
}

// ── SCE error convention ──

/// Kernel/SCE calls return `>= 0` on success, `-1` (errno set) or
/// `0x8002_0000 | errno` on failure. Returns `Ok(value)` or `Err(errno)`;
/// `current_errno` is consulted only for the plain `-1` form.
pub fn sce_result(ret: i64, current_errno: impl FnOnce() -> i32) -> Result<i64, i32> {
    if ret >= 0 {
        return Ok(ret);
    }
    let code = ret as i32 as u32;
    if code & 0xffff_0000 == 0x8002_0000 {
        return Err((code & 0xffff) as i32);
    }
    if ret == -1 {
        let errno = current_errno();
        return Err(if errno > 0 { errno } else { 5 });
    }
    Err(5)
}

// ── UTF-16 (the IME dialog) ──

/// UTF-8 → UTF-16 with a terminating 0, at most `room` units including it.
pub fn to_utf16_z(text: &str, room: usize) -> Vec<u16> {
    let mut out: Vec<u16> = Vec::with_capacity(room.min(text.len() + 1));
    for ch in text.chars() {
        let mut units = [0u16; 2];
        let encoded = ch.encode_utf16(&mut units);
        if out.len() + encoded.len() + 1 > room {
            break;
        }
        out.extend_from_slice(encoded);
    }
    out.push(0);
    out
}

/// UTF-16 up to the first 0 (or the end) → UTF-8; unpaired surrogates become U+FFFD.
pub fn from_utf16_z(units: &[u16]) -> String {
    let end = units.iter().position(|u| *u == 0).unwrap_or(units.len());
    char::decode_utf16(units[..end].iter().copied())
        .map(|r| r.unwrap_or(char::REPLACEMENT_CHARACTER))
        .collect()
}

// ── Tiled scanout copy ──

/// Copies tile (`tx`, `ty`) of the linear 1920×1080 `frame` into the tiled
/// `scanout` buffer, in 4×8-pixel groups (128 contiguous bytes each, written in
/// address order). `flushed(group)` is called with each group's first byte,
/// after it was written, so the caller can `clflush` it.
///
/// # Safety
/// `scanout` must point to a writable buffer of at least
/// `15 * 9 * 64 KiB` bytes (the full tiled surface).
pub unsafe fn copy_tile(
    frame: &[u32],
    scanout: *mut u8,
    tx: u32,
    ty: u32,
    mut flushed: impl FnMut(*const u8),
) {
    let (w, h) = (SCREEN_WIDTH as usize, SCREEN_HEIGHT as usize);
    assert!(frame.len() >= w * h);
    let x_start = tx * TILE;
    let y_start = ty * TILE;
    let mut top = y_start;
    while top < (y_start + TILE).min(SCREEN_HEIGHT) {
        let mut left = x_start;
        while left < (x_start + TILE).min(SCREEN_WIDTH) {
            // SAFETY: the group lies inside the tile's 64 KiB block, which the
            // caller guarantees is inside `scanout`.
            unsafe {
                let group = scanout.add(ps5_tiled_offset(left, top));
                for yy in 0..8usize {
                    if top as usize + yy >= h {
                        break;
                    }
                    let src = frame.as_ptr().add((top as usize + yy) * w + left as usize);
                    std::ptr::copy_nonoverlapping(src.cast::<u8>(), group.add(yy * 16), 16);
                }
                flushed(group);
                flushed(group.add(64));
            }
            left += 4;
        }
        top += 8;
    }
}

// ── Path roots ──

pub const APP0_ROOT: &str = "/app0";
pub const DATA_ROOT: &str = "/download0";

/// `app0://x` → `/app0/x`, `data://x` → `/download0/x` (with `.`/`..` resolved
/// lexically so the result cannot leave its root); any other path is passed
/// through unchanged (outside the sandbox on the console).
pub fn resolve_path(path: &str) -> String {
    let (root, rest) = if let Some(rest) = path.strip_prefix("app0://") {
        (APP0_ROOT, rest)
    } else if let Some(rest) = path.strip_prefix("data://") {
        (DATA_ROOT, rest)
    } else {
        return path.to_string();
    };
    let mut parts: Vec<&str> = Vec::new();
    for part in rest.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    let mut out = String::from(root);
    for part in parts {
        out.push('/');
        out.push_str(part);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use pk_protocol::TileSet;

    #[test]
    fn stat_has_the_freebsd_11_size() {
        assert_eq!(size_of::<Stat>(), 120);
        let mut st = Stat {
            st_mode: 0o040755,
            st_size: 42,
            ..Default::default()
        };
        st.st_mtim = Timespec {
            tv_sec: 1_700_000_000,
            tv_nsec: 250_000_000,
        };
        assert!(st.is_dir());
        assert_eq!(st.size(), 42);
        assert_eq!(st.mtime_ms(), 1_700_000_000_250);
        assert!(
            !Stat {
                st_mode: 0o100644,
                ..Default::default()
            }
            .is_dir()
        );
    }

    fn record(fileno: u32, d_type: u8, name: &str, reclen: u16) -> Vec<u8> {
        let mut r = Vec::new();
        r.extend_from_slice(&fileno.to_le_bytes());
        r.extend_from_slice(&reclen.to_le_bytes());
        r.push(d_type);
        r.push(name.len() as u8);
        r.extend_from_slice(name.as_bytes());
        r.resize(usize::from(reclen), 0);
        r
    }

    #[test]
    fn dirents_are_parsed_from_a_freebsd_11_buffer() {
        let mut buf = Vec::new();
        buf.extend(record(2, DT_DIR, ".", 12));
        buf.extend(record(1, DT_DIR, "..", 12));
        buf.extend(record(17, 8, "readme.txt", 20));
        buf.extend(record(0, 8, "deleted", 16)); // unlinked entry
        buf.extend(record(18, DT_DIR, "fonts", 16));
        buf.extend(record(19, 8, "ünï.png", 20));
        let entries = parse_dirents(&buf);
        let names: Vec<_> = entries
            .iter()
            .map(|e| (e.name.as_str(), e.d_type))
            .collect();
        assert_eq!(
            names,
            vec![("readme.txt", 8), ("fonts", DT_DIR), ("ünï.png", 8)]
        );
    }

    #[test]
    fn truncated_dirent_buffers_stop_cleanly() {
        let mut buf = record(5, 8, "abc", 16);
        buf.extend_from_slice(&[9, 0, 0, 0, 200, 0, 8, 3]); // reclen beyond the buffer
        assert_eq!(parse_dirents(&buf).len(), 1);
        assert!(parse_dirents(&[1, 2, 3]).is_empty());
    }

    #[test]
    fn sce_errors_decode_both_conventions() {
        assert_eq!(sce_result(7, || 0), Ok(7));
        assert_eq!(sce_result(0x8002_0002u32 as i32 as i64, || 0), Err(2));
        assert_eq!(sce_result(-1, || 13), Err(13));
        assert_eq!(sce_result(-1, || 0), Err(5));
        assert_eq!(sce_result(-5, || 0), Err(5));
    }

    #[test]
    fn utf16_round_trips_with_surrogates_and_limits() {
        let s = "héllo 🎮";
        let units = to_utf16_z(s, 64);
        assert_eq!(*units.last().unwrap(), 0);
        assert_eq!(from_utf16_z(&units), s);
        // truncation never splits a surrogate pair: room 8 fits "héllo " + 0 only
        let cut = to_utf16_z(s, 8);
        assert_eq!(from_utf16_z(&cut), "héllo ");
        assert_eq!(from_utf16_z(&[0x41, 0xd800, 0x42]), "A\u{fffd}B");
    }

    #[test]
    fn tile_copy_matches_the_per_pixel_formula() {
        let (w, h) = (SCREEN_WIDTH as usize, SCREEN_HEIGHT as usize);
        let frame: Vec<u32> = (0..w * h)
            .map(|i| (i as u32).wrapping_mul(2654435761))
            .collect();
        let mut scanout = vec![0xEEu8; 15 * 9 * 65536];
        let mut flushed = 0usize;
        for (tx, ty) in TileSet::full().iter() {
            // SAFETY: the buffer is the full tiled surface.
            unsafe { copy_tile(&frame, scanout.as_mut_ptr(), tx, ty, |_| flushed += 1) };
        }
        assert!(flushed > 0);
        for &(x, y) in &[
            (0usize, 0usize),
            (1, 0),
            (0, 1),
            (127, 127),
            (128, 0),
            (1919, 1079),
            (1000, 1023),
            (1500, 1024),
            (3, 7),
        ] {
            let o = ps5_tiled_offset(x as u32, y as u32);
            let got = u32::from_le_bytes(scanout[o..o + 4].try_into().unwrap());
            assert_eq!(got, frame[y * w + x], "pixel {x},{y}");
        }
        // every visible pixel, exhaustively
        for y in (0..h).step_by(3) {
            for x in 0..w {
                let o = ps5_tiled_offset(x as u32, y as u32);
                let got = u32::from_le_bytes(scanout[o..o + 4].try_into().unwrap());
                assert_eq!(got, frame[y * w + x]);
            }
        }
    }

    #[test]
    fn roots_resolve_lexically() {
        assert_eq!(resolve_path("app0://assets/a.png"), "/app0/assets/a.png");
        assert_eq!(resolve_path("app0://"), "/app0");
        assert_eq!(resolve_path("data://save.json"), "/download0/save.json");
        assert_eq!(resolve_path("data:///a//b/./c"), "/download0/a/b/c");
        assert_eq!(resolve_path("/data/homebrew"), "/data/homebrew");
        assert_eq!(resolve_path("app0://../../etc/passwd"), "/app0/etc/passwd");
        assert_eq!(resolve_path("data://a/../../x"), "/download0/x");
    }
}
