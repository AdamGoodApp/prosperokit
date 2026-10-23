//! Plain data types shared by both backends.

use std::fmt;

/// Controller state for one frame. `buttons` is the PS5 bitmask
/// (`pk_protocol::events::BUTTON_NAMES`); sticks are -127..=127 with 0 at
/// rest (Y grows downward, like the pad hardware); `touch` is the first
/// finger on the touchpad in 0..1; `intercepted` means the system owns the
/// controller right now (PS menu, keyboard) and the engine must suspend input.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PadSnapshot {
    pub buttons: u32,
    pub lx: i8,
    pub ly: i8,
    pub rx: i8,
    pub ry: i8,
    pub touch: Option<(f32, f32)>,
    pub intercepted: bool,
    pub connected: bool,
}

impl PadSnapshot {
    pub fn pressed(&self, bit: u32) -> bool {
        self.buttons & bit != 0
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum ImeKind {
    #[default]
    Text,
    Number,
    Url,
    Email,
    Password,
}

impl ImeKind {
    pub fn from_protocol(kind: pk_protocol::props::InputKind) -> ImeKind {
        use pk_protocol::props::InputKind as K;
        match kind {
            K::Text => ImeKind::Text,
            K::Number => ImeKind::Number,
            K::Url => ImeKind::Url,
            K::Email => ImeKind::Email,
            K::Password => ImeKind::Password,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ImeRequest {
    pub title: String,
    pub placeholder: String,
    pub initial: String,
    /// Clamped to 1..=512 by the backend.
    pub max_len: u32,
    pub kind: ImeKind,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ImePoll {
    /// No dialog is open.
    Closed,
    Open,
    /// The dialog closed: `Some(text)` on OK, `None` on cancel.
    Done(Option<String>),
}

#[derive(Clone, Debug, PartialEq)]
pub enum HostEvent {
    /// The window was asked to close (desktop only).
    CloseRequested,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub mtime_ms: u64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FileStat {
    pub is_dir: bool,
    pub size: u64,
    pub mtime_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FsError {
    NotFound,
    PermissionDenied,
    AlreadyExists,
    NotADirectory,
    IsADirectory,
    Other(i32),
}

impl FsError {
    pub fn code(&self) -> &'static str {
        match self {
            FsError::NotFound => "ENOENT",
            FsError::PermissionDenied => "EACCES",
            FsError::AlreadyExists => "EEXIST",
            FsError::NotADirectory => "ENOTDIR",
            FsError::IsADirectory => "EISDIR",
            FsError::Other(_) => "EIO",
        }
    }

    pub fn from_errno(errno: i32) -> FsError {
        match errno {
            2 => FsError::NotFound,              // ENOENT
            13 | 1 => FsError::PermissionDenied, // EACCES, EPERM
            17 => FsError::AlreadyExists,        // EEXIST
            20 => FsError::NotADirectory,        // ENOTDIR
            21 => FsError::IsADirectory,         // EISDIR
            other => FsError::Other(other),
        }
    }
}

impl fmt::Display for FsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FsError::NotFound => write!(f, "not found"),
            FsError::PermissionDenied => write!(f, "permission denied"),
            FsError::AlreadyExists => write!(f, "already exists"),
            FsError::NotADirectory => write!(f, "not a directory"),
            FsError::IsADirectory => write!(f, "is a directory"),
            FsError::Other(e) => write!(f, "I/O error (errno {e})"),
        }
    }
}

impl std::error::Error for FsError {}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HttpRequest {
    pub url: String,
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<Vec<u8>>,
    pub timeout_ms: u32,
    pub follow_redirects: bool,
}

impl Default for HttpRequest {
    fn default() -> Self {
        HttpRequest {
            url: String::new(),
            method: "GET".into(),
            headers: Vec::new(),
            body: None,
            timeout_ms: 30_000,
            follow_redirects: true,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HttpError {
    InvalidUrl(String),
    Dns(String),
    Connect(String),
    Timeout,
    TlsUnsupported { url: String },
    Io(String),
    Other(String),
}

impl HttpError {
    pub fn code(&self) -> &'static str {
        match self {
            HttpError::InvalidUrl(_) => "EINVAL",
            HttpError::Dns(_) => "ENOTFOUND",
            HttpError::Connect(_) => "ECONNREFUSED",
            HttpError::Timeout => "ETIMEDOUT",
            HttpError::TlsUnsupported { .. } => "ETLS",
            HttpError::Io(_) => "EIO",
            HttpError::Other(_) => "EHTTP",
        }
    }
}

impl fmt::Display for HttpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            HttpError::InvalidUrl(u) => write!(f, "invalid URL: {u}"),
            HttpError::Dns(h) => write!(f, "could not resolve {h}"),
            HttpError::Connect(e) => write!(f, "connection failed: {e}"),
            HttpError::Timeout => write!(f, "request timed out"),
            HttpError::TlsUnsupported { url } => {
                write!(f, "https is not supported on this platform build: {url}")
            }
            HttpError::Io(e) => write!(f, "I/O error: {e}"),
            HttpError::Other(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for HttpError {}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

impl LogLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            LogLevel::Debug => "debug",
            LogLevel::Info => "info",
            LogLevel::Warn => "warn",
            LogLevel::Error => "error",
        }
    }
    pub fn parse(s: &str) -> LogLevel {
        match s {
            "debug" | "log" | "trace" => LogLevel::Debug,
            "warn" | "warning" => LogLevel::Warn,
            "error" => LogLevel::Error,
            _ => LogLevel::Info,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SystemInfo {
    /// `"ps5"` or `"host"`.
    pub platform: &'static str,
    pub title_id: String,
    pub app_name: String,
    pub app_version: String,
    pub uptime_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PlatformError {
    Busy,
    Unsupported(String),
    Failed { what: String, code: i64 },
}

impl fmt::Display for PlatformError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PlatformError::Busy => write!(f, "busy"),
            PlatformError::Unsupported(w) => write!(f, "unsupported: {w}"),
            PlatformError::Failed { what, code } => write!(f, "{what} failed with code {code:#x}"),
        }
    }
}

impl std::error::Error for PlatformError {}

/// Reads `titleId`, `contentVersion` and the default `titleName` from a
/// `param.json` document. Missing fields become empty strings.
pub fn parse_param_json(text: &str) -> (String, String, String) {
    let Ok(json) = serde_json::from_str::<serde_json::Value>(text) else {
        return (String::new(), String::new(), String::new());
    };
    let title_id = json["titleId"].as_str().unwrap_or("").to_string();
    let version = json["contentVersion"].as_str().unwrap_or("").to_string();
    let lang = json["localizedParameters"]["defaultLanguage"]
        .as_str()
        .unwrap_or("en-US");
    let name = json["localizedParameters"][lang]["titleName"]
        .as_str()
        .unwrap_or("")
        .to_string();
    (title_id, version, name)
}

/// The scanout tiling used by the PS5 (128×128 tiles of 64 KiB; the offset
/// formula from the starter's renderer). Shared so it can be unit-tested on
/// the host.
pub fn ps5_tiled_offset(x: u32, y: u32) -> usize {
    const BLOCKS_X: u32 = 15;
    let offset = ((y << 4) & 0x70)
        ^ ((y << 5) & 0xf00)
        ^ ((y << 9) & 0x1000)
        ^ ((y << 8) & 0x4000)
        ^ ((x << 2) & 0xc)
        ^ ((x << 5) & 0x380)
        ^ ((x << 4) & 0x400)
        ^ ((x << 6) & 0x800)
        ^ ((x << 9) & 0xa000);
    let block_index = (y >> 7) * BLOCKS_X + (x >> 7);
    ((block_index as usize) << 16) + offset as usize
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tiled_offset_matches_the_reference_formula() {
        // Values computed from the starter's constexpr tiled_offset().
        assert_eq!(ps5_tiled_offset(0, 0), 0);
        assert_eq!(ps5_tiled_offset(1, 0), 4);
        assert_eq!(ps5_tiled_offset(0, 1), 0x10);
        assert_eq!(ps5_tiled_offset(128, 0), 1 << 16);
        assert_eq!(ps5_tiled_offset(0, 128), 15 << 16);
        assert_eq!(
            ps5_tiled_offset(127, 127),
            (((127u32 << 4) & 0x70)
                ^ ((127u32 << 5) & 0xf00)
                ^ ((127u32 << 9) & 0x1000)
                ^ ((127u32 << 8) & 0x4000)
                ^ ((127u32 << 2) & 0xc)
                ^ ((127u32 << 5) & 0x380)
                ^ ((127u32 << 4) & 0x400)
                ^ ((127u32 << 6) & 0x800)
                ^ ((127u32 << 9) & 0xa000)) as usize
        );
        // every pixel of a tile maps inside its 64 KiB block, uniquely
        let mut seen = vec![false; 65536];
        for y in 0..128u32 {
            for x in 0..128u32 {
                let o = ps5_tiled_offset(x, y);
                assert!(o < 65536 && o % 4 == 0);
                assert!(!seen[o], "collision at {x},{y}");
                seen[o] = true;
            }
        }
    }

    #[test]
    fn param_json_fields() {
        let (id, ver, name) = parse_param_json(
            r#"{"titleId":"PPSA90000","contentVersion":"01.000.000","localizedParameters":{"defaultLanguage":"en-US","en-US":{"titleName":"Demo"}}}"#,
        );
        assert_eq!(
            (id.as_str(), ver.as_str(), name.as_str()),
            ("PPSA90000", "01.000.000", "Demo")
        );
    }
}
