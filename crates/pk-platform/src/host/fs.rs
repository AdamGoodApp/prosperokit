//! Desktop file system. `app0://` → `<app_dir>/`, `data://` →
//! `<app_dir>/.data/` (created on demand), every other absolute path is passed
//! through unchanged.

use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::UNIX_EPOCH;

use crate::{DirEntry, FileStat, Fs, FsError};

pub struct HostFs {
    app_dir: PathBuf,
    data_dir: PathBuf,
    data_ready: AtomicBool,
}

impl HostFs {
    pub fn new(app_dir: impl Into<PathBuf>) -> HostFs {
        let app_dir = app_dir.into();
        let data_dir = app_dir.join(".data");
        HostFs {
            app_dir,
            data_dir,
            data_ready: AtomicBool::new(false),
        }
    }

    /// `rest` joined below `root`, with `.`/`..` resolved lexically so the
    /// result can never leave `root`.
    fn under(root: &Path, rest: &str) -> PathBuf {
        let mut out = root.to_path_buf();
        let depth = root.components().count();
        for comp in Path::new(rest).components() {
            match comp {
                Component::Normal(part) => out.push(part),
                Component::ParentDir if out.components().count() > depth => {
                    out.pop();
                }
                _ => {}
            }
        }
        out
    }

    fn real(&self, path: &str) -> PathBuf {
        if let Some(rest) = path.strip_prefix("app0://") {
            HostFs::under(&self.app_dir, rest)
        } else if let Some(rest) = path.strip_prefix("data://") {
            if !self.data_ready.load(Ordering::Relaxed) {
                // Best effort: a failure shows up on the actual operation.
                if fs::create_dir_all(&self.data_dir).is_ok() {
                    self.data_ready.store(true, Ordering::Relaxed);
                }
            }
            HostFs::under(&self.data_dir, rest)
        } else {
            PathBuf::from(path)
        }
    }
}

fn map_err(e: io::Error) -> FsError {
    use io::ErrorKind as K;
    match e.kind() {
        K::NotFound => FsError::NotFound,
        K::PermissionDenied => FsError::PermissionDenied,
        K::AlreadyExists => FsError::AlreadyExists,
        K::NotADirectory => FsError::NotADirectory,
        K::IsADirectory => FsError::IsADirectory,
        _ => FsError::Other(e.raw_os_error().unwrap_or(5)),
    }
}

fn mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl Fs for HostFs {
    fn read(&self, path: &str) -> Result<Vec<u8>, FsError> {
        fs::read(self.real(path)).map_err(map_err)
    }

    fn write(&self, path: &str, data: &[u8]) -> Result<(), FsError> {
        let target = self.real(path);
        let mut tmp = target.clone().into_os_string();
        tmp.push(".tmp");
        let tmp = PathBuf::from(tmp);
        let result = fs::write(&tmp, data).and_then(|()| fs::rename(&tmp, &target));
        if result.is_err() {
            let _ = fs::remove_file(&tmp);
        }
        result.map_err(map_err)
    }

    fn read_dir(&self, path: &str) -> Result<Vec<DirEntry>, FsError> {
        let mut entries = Vec::new();
        for entry in fs::read_dir(self.real(path)).map_err(map_err)? {
            let entry = entry.map_err(map_err)?;
            // An entry that vanished or cannot be inspected is skipped, as readdir would.
            let Ok(meta) = entry.metadata() else { continue };
            entries.push(DirEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                is_dir: meta.is_dir(),
                size: if meta.is_dir() { 0 } else { meta.len() },
                mtime_ms: mtime_ms(&meta),
            });
        }
        entries.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(entries)
    }

    fn stat(&self, path: &str) -> Result<FileStat, FsError> {
        let meta = fs::metadata(self.real(path)).map_err(map_err)?;
        Ok(FileStat {
            is_dir: meta.is_dir(),
            size: meta.len(),
            mtime_ms: mtime_ms(&meta),
        })
    }

    fn mkdir_all(&self, path: &str) -> Result<(), FsError> {
        fs::create_dir_all(self.real(path)).map_err(map_err)
    }

    fn remove(&self, path: &str) -> Result<(), FsError> {
        let real = self.real(path);
        let meta = fs::symlink_metadata(&real).map_err(map_err)?;
        if meta.is_dir() {
            fs::remove_dir(&real)
        } else {
            fs::remove_file(&real)
        }
        .map_err(map_err)
    }

    fn rename(&self, from: &str, to: &str) -> Result<(), FsError> {
        fs::rename(self.real(from), self.real(to)).map_err(map_err)
    }

    fn exists(&self, path: &str) -> bool {
        self.real(path).exists()
    }

    fn resolve(&self, path: &str) -> String {
        self.real(path).to_string_lossy().into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_app(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("pk-platform-fs-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn roots_resolve_below_the_app_dir() {
        let app = temp_app("roots");
        let fs = HostFs::new(&app);
        assert_eq!(
            fs.resolve("app0://assets/a.png"),
            app.join("assets/a.png").to_string_lossy()
        );
        assert_eq!(
            fs.resolve("data://save.json"),
            app.join(".data/save.json").to_string_lossy()
        );
        assert_eq!(fs.resolve("/tmp/elsewhere"), "/tmp/elsewhere");
        // `..` cannot climb out of a root
        assert_eq!(
            fs.resolve("app0://../../etc/passwd"),
            app.join("etc/passwd").to_string_lossy()
        );
        assert_eq!(
            fs.resolve("data://a/../../x"),
            app.join(".data/x").to_string_lossy()
        );
        let _ = fs::remove_dir_all(&app);
    }

    #[test]
    fn data_root_is_created_on_demand_and_writes_are_atomic() {
        let app = temp_app("write");
        let fs = HostFs::new(&app);
        assert!(!app.join(".data").exists());
        fs.write("data://spike.txt", b"hello spike").unwrap();
        assert!(app.join(".data").is_dir());
        assert_eq!(fs.read("data://spike.txt").unwrap(), b"hello spike");
        assert!(!app.join(".data/spike.txt.tmp").exists());
        fs.write("data://spike.txt", b"v2").unwrap();
        assert_eq!(fs.read("data://spike.txt").unwrap(), b"v2");
        // a failing write leaves no temp file behind
        assert_eq!(
            fs.write("data://missing/dir/x", b"x"),
            Err(FsError::NotFound)
        );
        let _ = fs::remove_dir_all(&app);
    }

    #[test]
    fn directory_operations() {
        let app = temp_app("dirs");
        let fs = HostFs::new(&app);
        fs.mkdir_all("data://a/b").unwrap();
        fs.write("data://a/b/f.txt", b"123").unwrap();
        fs.write("data://a/g.txt", b"1").unwrap();
        let entries = fs.read_dir("data://a").unwrap();
        let names: Vec<_> = entries
            .iter()
            .map(|e| (e.name.as_str(), e.is_dir, e.size))
            .collect();
        assert_eq!(names, vec![("b", true, 0), ("g.txt", false, 1)]);
        assert!(entries[1].mtime_ms > 0);
        let st = fs.stat("data://a/b/f.txt").unwrap();
        assert_eq!((st.is_dir, st.size), (false, 3));
        assert!(fs.exists("data://a/b"));
        fs.rename("data://a/g.txt", "data://a/h.txt").unwrap();
        assert!(!fs.exists("data://a/g.txt"));
        assert!(
            fs.remove("data://a").is_err(),
            "non-empty directories are not removed"
        );
        fs.remove("data://a/b/f.txt").unwrap();
        fs.remove("data://a/b").unwrap();
        assert!(!fs.exists("data://a/b"));
        let _ = fs::remove_dir_all(&app);
    }

    #[test]
    fn errors_map_to_fs_errors() {
        let app = temp_app("errors");
        let fs = HostFs::new(&app);
        assert_eq!(fs.read("app0://nope"), Err(FsError::NotFound));
        fs.mkdir_all("app0://d").unwrap();
        fs.write("app0://f", b"x").unwrap();
        assert_eq!(fs.read("app0://d"), Err(FsError::IsADirectory));
        assert_eq!(fs.read_dir("app0://f"), Err(FsError::NotADirectory));
        assert!(matches!(fs.stat("app0://nope"), Err(FsError::NotFound)));
        let _ = fs::remove_dir_all(&app);
    }
}
