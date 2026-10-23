use crate::icon::cover;
use intel_tex_2::{RgbaSurface, bc7};
use std::path::Path;

pub const WIDTH: u32 = 3840;
pub const HEIGHT: u32 = 2160;
pub const HEADER_LEN: usize = 148;
pub const FILE_LEN: usize = HEADER_LEN + (960 * 540 * 16);

fn put(buf: &mut Vec<u8>, v: u32) {
    buf.extend_from_slice(&v.to_le_bytes());
}

pub fn header() -> Vec<u8> {
    let mut h = Vec::with_capacity(HEADER_LEN);
    h.extend_from_slice(b"DDS ");
    put(&mut h, 124);
    put(&mut h, 0x1007);
    put(&mut h, HEIGHT);
    put(&mut h, WIDTH);
    put(&mut h, WIDTH * HEIGHT);
    put(&mut h, 0); // depth
    put(&mut h, 1); // mipMapCount
    h.extend_from_slice(&[0; 44]); // reserved1[11]
    put(&mut h, 32);
    put(&mut h, 0x4);
    h.extend_from_slice(b"DX10");
    h.extend_from_slice(&[0; 20]); // bit count + masks
    put(&mut h, 0x1000);
    h.extend_from_slice(&[0; 16]); // caps2..reserved2
    put(&mut h, 98);
    put(&mut h, 3);
    put(&mut h, 0);
    put(&mut h, 1);
    put(&mut h, 0);
    h
}

pub fn make_background(input: &Path, output: &Path) -> Result<(), String> {
    let img = image::open(input).map_err(|e| format!("cannot read {}: {e}", input.display()))?;
    let rgba = cover(&img, WIDTH, HEIGHT);
    let surface = RgbaSurface {
        width: WIDTH,
        height: HEIGHT,
        stride: WIDTH * 4,
        data: rgba.as_raw(),
    };
    let blocks = bc7::compress_blocks(&bc7::alpha_ultra_fast_settings(), &surface);
    let mut out = header();
    out.extend_from_slice(&blocks);
    std::fs::write(output, out).map_err(|e| format!("cannot write {}: {e}", output.display()))
}

/// Check a DDS file's bytes against the PS5 background profile.
pub fn check_dds(data: &[u8]) -> Result<(), String> {
    let rule =
        "must be a single 3840x2160 BC7_UNORM DX10 2D DDS without mipmaps (148 + 960*540*16 bytes)";
    if data.len() < HEADER_LEN || &data[..4] != b"DDS " {
        return Err("is not a DDS file".into());
    }
    let u = |o: usize| u32::from_le_bytes([data[o], data[o + 1], data[o + 2], data[o + 3]]);
    let ok = u(4) == 124
        && u(12) == HEIGHT
        && u(16) == WIDTH
        && u(28) == 1
        && &data[84..88] == b"DX10"
        && u(128) == 98
        && u(132) == 3
        && u(140) == 1
        && data.len() == FILE_LEN;
    if ok { Ok(()) } else { Err(rule.into()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn header_matches_profile() {
        let h = header();
        assert_eq!(h.len(), HEADER_LEN);
        assert_eq!(&h[..4], b"DDS ");
        assert_eq!(&h[84..88], b"DX10");
        let mut full = h.clone();
        full.resize(FILE_LEN, 0);
        assert!(check_dds(&full).is_ok());
        assert!(check_dds(&h).is_err());
    }

    #[test]
    fn background_file_size() {
        let dir = crate::icon::tests::tempdir("bg");
        let src = dir.join("in.png");
        image::RgbaImage::from_pixel(640, 480, image::Rgba([200, 50, 90, 255]))
            .save(&src)
            .unwrap();
        let out = dir.join("out.dds");
        make_background(&src, &out).unwrap();
        let data = std::fs::read(&out).unwrap();
        assert_eq!(data.len(), FILE_LEN);
        assert_eq!(&data[..HEADER_LEN], &header()[..]);
        assert!(check_dds(&data).is_ok());
    }
}
