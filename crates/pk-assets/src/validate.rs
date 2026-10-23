use crate::{at9::check_at9, dds::check_dds};
use std::path::Path;

fn read(p: &Path) -> Result<Vec<u8>, String> {
    std::fs::read(p).map_err(|e| format!("{}: cannot read: {e}", p.display()))
}

/// Validate an sce_sys directory; the error names the offending file and rule.
pub fn validate_dir(dir: &Path) -> Result<(), String> {
    if !dir.is_dir() {
        return Err(format!("{}: directory not found", dir.display()));
    }
    let icon = dir.join("icon0.png");
    if !icon.is_file() {
        return Err(format!(
            "{}: required launcher icon not found",
            icon.display()
        ));
    }
    let data = read(&icon)?;
    let ok = data.len() >= 24
        && data[..8] == *b"\x89PNG\r\n\x1a\n"
        && data[16..20] == 512u32.to_be_bytes()
        && data[20..24] == 512u32.to_be_bytes();
    if !ok {
        return Err(format!("{}: must be a 512x512 PNG", icon.display()));
    }
    let pics = [dir.join("pic0.dds"), dir.join("pic1.dds")];
    if pics[0].exists() != pics[1].exists() {
        return Err("supply both pic0.dds and pic1.dds, or neither".into());
    }
    if pics[0].exists() {
        for p in &pics {
            check_dds(&read(p)?).map_err(|e| format!("{}: {e}", p.display()))?;
        }
    }
    let snd = dir.join("snd0.at9");
    if snd.exists() {
        check_at9(&read(&snd)?).map_err(|e| format!("{}: {e}", snd.display()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::icon::tests::tempdir;

    #[test]
    fn validates_directory() {
        let dir = tempdir("validate");
        assert!(validate_dir(&dir).unwrap_err().contains("icon"));
        image::RgbaImage::new(512, 512)
            .save(dir.join("icon0.png"))
            .unwrap();
        assert!(validate_dir(&dir).is_ok());
        std::fs::write(dir.join("pic0.dds"), b"x").unwrap();
        assert!(validate_dir(&dir).unwrap_err().contains("both"));
        std::fs::write(dir.join("pic1.dds"), b"x").unwrap();
        assert!(validate_dir(&dir).unwrap_err().contains("DDS"));
        std::fs::remove_file(dir.join("pic0.dds")).unwrap();
        std::fs::remove_file(dir.join("pic1.dds")).unwrap();
        std::fs::write(dir.join("snd0.at9"), b"bad").unwrap();
        assert!(validate_dir(&dir).unwrap_err().contains("snd0.at9"));
    }
}
