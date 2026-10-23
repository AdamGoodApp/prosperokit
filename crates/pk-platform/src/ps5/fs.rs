//! PS5 file system: `sceKernel{Open,Read,Write,Close,Lseek,Stat,Fstat,Mkdir,
//! Unlink,Rmdir,Rename,Getdents}` only, with the FreeBSD 11 `stat`/`dirent`
//! layouts of `layout.rs` (`std::fs` metadata and `read_dir` use the FreeBSD 12
//! layouts and must never run on the console).
//!
//! Roots: `app0://` → `/app0/`, `data://` → `/download0/` (needs
//! `downloadDataSize > 0` in `param.json`); any other path is passed through.

use std::ffi::{CString, c_int, c_void};

use super::layout::{Stat, parse_dirents, resolve_path, sce_result};
use super::sys;
use crate::{DirEntry, FileStat, Fs, FsError};

const READ_CHUNK: usize = 64 * 1024;
const GETDENTS_BUFFER: usize = 64 * 1024;
const FILE_MODE: u32 = 0o666;
const DIR_MODE: u32 = 0o777;

fn errno() -> i32 {
    std::io::Error::last_os_error().raw_os_error().unwrap_or(0)
}

/// Maps a kernel return value to `Ok(value)` or the matching [`FsError`].
fn check(ret: i64) -> Result<i64, FsError> {
    sce_result(ret, errno).map_err(FsError::from_errno)
}

fn c_path(path: &str) -> Result<CString, FsError> {
    CString::new(path).map_err(|_| FsError::Other(22)) // EINVAL: embedded NUL
}

/// An open kernel file descriptor, closed on drop.
pub(super) struct File(c_int);

impl File {
    pub(super) fn open(path: &str, flags: c_int, mode: u32) -> Result<File, FsError> {
        let path = c_path(path)?;
        // SAFETY: `path` is a valid NUL-terminated string.
        let fd = check(i64::from(unsafe {
            sys::sceKernelOpen(path.as_ptr(), flags, mode)
        }))?;
        Ok(File(fd as c_int))
    }

    fn read(&self, buf: &mut [u8]) -> Result<usize, FsError> {
        // SAFETY: `buf` is valid for `buf.len()` writable bytes.
        let n = check(unsafe {
            sys::sceKernelRead(self.0, buf.as_mut_ptr().cast::<c_void>(), buf.len())
        } as i64)?;
        Ok(n as usize)
    }

    pub(super) fn write_all(&self, mut data: &[u8]) -> Result<(), FsError> {
        while !data.is_empty() {
            // SAFETY: `data` is valid for `data.len()` readable bytes.
            let n = check(unsafe {
                sys::sceKernelWrite(self.0, data.as_ptr().cast::<c_void>(), data.len())
            } as i64)?;
            if n == 0 {
                return Err(FsError::Other(5));
            }
            data = &data[n as usize..];
        }
        Ok(())
    }

    /// Current size via `fstat`.
    pub(super) fn size(&self) -> Result<u64, FsError> {
        let mut st = Stat::default();
        // SAFETY: `st` is a valid `struct stat` (FreeBSD 11 layout).
        check(i64::from(unsafe { sys::sceKernelFstat(self.0, &mut st) }))?;
        Ok(st.size())
    }
}

impl Drop for File {
    fn drop(&mut self) {
        // SAFETY: the descriptor was opened by `File::open` and is closed once.
        unsafe { sys::sceKernelClose(self.0) };
    }
}

fn stat_raw(real: &str) -> Result<Stat, FsError> {
    let path = c_path(real)?;
    let mut st = Stat::default();
    // SAFETY: valid path and out-pointer.
    check(i64::from(unsafe {
        sys::sceKernelStat(path.as_ptr(), &mut st)
    }))?;
    Ok(st)
}

/// Reads a whole file by its real path.
pub(super) fn read_real(real: &str) -> Result<Vec<u8>, FsError> {
    let file = File::open(real, sys::O_RDONLY, 0)?;
    let hint = file.size().unwrap_or(0).min(256 * 1024 * 1024) as usize;
    let mut out = Vec::with_capacity(hint + 1);
    let mut chunk = vec![0u8; READ_CHUNK];
    loop {
        let n = file.read(&mut chunk)?;
        if n == 0 {
            return Ok(out);
        }
        out.extend_from_slice(&chunk[..n]);
    }
}

fn mkdir_real(real: &str) -> Result<(), FsError> {
    let path = c_path(real)?;
    // SAFETY: valid path.
    check(i64::from(unsafe {
        sys::sceKernelMkdir(path.as_ptr(), DIR_MODE)
    }))
    .map(|_| ())
}

fn unlink_real(real: &str) -> Result<(), FsError> {
    let path = c_path(real)?;
    // SAFETY: valid path.
    check(i64::from(unsafe { sys::sceKernelUnlink(path.as_ptr()) })).map(|_| ())
}

fn rename_real(from: &str, to: &str) -> Result<(), FsError> {
    let (from, to) = (c_path(from)?, c_path(to)?);
    // SAFETY: valid paths.
    check(i64::from(unsafe {
        sys::sceKernelRename(from.as_ptr(), to.as_ptr())
    }))
    .map(|_| ())
}

pub struct Ps5Fs;

impl Ps5Fs {
    pub fn new() -> Ps5Fs {
        Ps5Fs
    }
}

impl Default for Ps5Fs {
    fn default() -> Self {
        Ps5Fs::new()
    }
}

impl Fs for Ps5Fs {
    fn read(&self, path: &str) -> Result<Vec<u8>, FsError> {
        read_real(&resolve_path(path))
    }

    fn write(&self, path: &str, data: &[u8]) -> Result<(), FsError> {
        let target = resolve_path(path);
        let tmp = format!("{target}.tmp");
        let result = (|| {
            let file = File::open(&tmp, sys::O_WRONLY | sys::O_CREAT | sys::O_TRUNC, FILE_MODE)?;
            file.write_all(data)?;
            drop(file);
            rename_real(&tmp, &target)
        })();
        if result.is_err() {
            let _ = unlink_real(&tmp);
        }
        result
    }

    fn read_dir(&self, path: &str) -> Result<Vec<DirEntry>, FsError> {
        let real = resolve_path(path);
        let dir = File::open(&real, sys::O_RDONLY, 0)?;
        let mut buffer = vec![0u8; GETDENTS_BUFFER];
        let mut names: Vec<String> = Vec::new();
        loop {
            // SAFETY: `buffer` is valid for GETDENTS_BUFFER writable bytes.
            let n = check(i64::from(unsafe {
                sys::sceKernelGetdents(dir.0, buffer.as_mut_ptr().cast(), GETDENTS_BUFFER as c_int)
            }))?;
            if n == 0 {
                break;
            }
            names.extend(
                parse_dirents(&buffer[..n as usize])
                    .into_iter()
                    .map(|e| e.name),
            );
        }
        let base = real.trim_end_matches('/');
        let mut entries = Vec::with_capacity(names.len());
        for name in names {
            // An entry that vanished meanwhile is skipped, as readdir would.
            let Ok(st) = stat_raw(&format!("{base}/{name}")) else {
                continue;
            };
            let is_dir = st.is_dir();
            entries.push(DirEntry {
                name,
                is_dir,
                size: if is_dir { 0 } else { st.size() },
                mtime_ms: st.mtime_ms(),
            });
        }
        entries.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(entries)
    }

    fn stat(&self, path: &str) -> Result<FileStat, FsError> {
        let st = stat_raw(&resolve_path(path))?;
        Ok(FileStat {
            is_dir: st.is_dir(),
            size: st.size(),
            mtime_ms: st.mtime_ms(),
        })
    }

    fn mkdir_all(&self, path: &str) -> Result<(), FsError> {
        let real = resolve_path(path);
        let mut prefix = String::new();
        for part in real.split('/').filter(|p| !p.is_empty()) {
            prefix.push('/');
            prefix.push_str(part);
            match stat_raw(&prefix) {
                Ok(st) if st.is_dir() => continue,
                Ok(_) => return Err(FsError::NotADirectory),
                Err(FsError::NotFound) => mkdir_real(&prefix)?,
                Err(e) => return Err(e),
            }
        }
        Ok(())
    }

    fn remove(&self, path: &str) -> Result<(), FsError> {
        let real = resolve_path(path);
        let st = stat_raw(&real)?;
        let c = c_path(&real)?;
        if st.is_dir() {
            // SAFETY: valid path.
            check(i64::from(unsafe { sys::sceKernelRmdir(c.as_ptr()) })).map(|_| ())
        } else {
            unlink_real(&real)
        }
    }

    fn rename(&self, from: &str, to: &str) -> Result<(), FsError> {
        rename_real(&resolve_path(from), &resolve_path(to))
    }

    fn exists(&self, path: &str) -> bool {
        stat_raw(&resolve_path(path)).is_ok()
    }

    fn resolve(&self, path: &str) -> String {
        resolve_path(path)
    }
}
