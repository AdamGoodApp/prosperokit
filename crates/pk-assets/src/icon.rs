use image::{DynamicImage, imageops::FilterType};
use std::path::Path;

pub const ICON_SIZE: u32 = 512;

/// Crop `img` to cover a `w`x`h` target aspect, then resize with Lanczos3.
pub fn cover(img: &DynamicImage, w: u32, h: u32) -> image::RgbaImage {
    img.resize_to_fill(w, h, FilterType::Lanczos3).to_rgba8()
}

pub fn make_icon(input: &Path, output: &Path) -> Result<(), String> {
    let img = image::open(input).map_err(|e| format!("cannot read {}: {e}", input.display()))?;
    cover(&img, ICON_SIZE, ICON_SIZE)
        .save_with_format(output, image::ImageFormat::Png)
        .map_err(|e| format!("cannot write {}: {e}", output.display()))
}

#[cfg(test)]
pub mod tests {
    use super::*;

    #[test]
    fn icon_is_512_rgba() {
        let dir = tempdir("icon");
        let src = dir.join("in.png");
        image::RgbaImage::from_pixel(1024, 768, image::Rgba([10, 20, 30, 255]))
            .save(&src)
            .unwrap();
        let out = dir.join("out.png");
        make_icon(&src, &out).unwrap();
        let img = image::open(&out).unwrap();
        assert_eq!((img.width(), img.height()), (512, 512));
        assert!(matches!(img, DynamicImage::ImageRgba8(_)));
    }

    pub fn tempdir(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("pk-assets-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }
}
