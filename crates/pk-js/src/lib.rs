//! pk-js: the QuickJS-NG runtimes (`ui-js`, `server-js`), the `__pk` host
//! bridge, the native module registry, the worker pool and the dev agent.

mod bridge;
mod convert;
#[cfg(feature = "dev")]
pub mod dev;
mod modules;
mod runtime;
mod workers;

#[cfg(any(test, feature = "testing"))]
pub mod testing;

use std::sync::Arc;

use pk_platform::{LogLevel, Services};
use pk_protocol::{Op, UiEvent, Value};

pub use modules::{
    AsyncFn, CallKind, MainFn, MainHost, ModuleRegistry, NativeError, SyncFn, deferred, is_deferred,
};
pub use workers::{WorkerPool, spawn_thread};

/// The UI prelude (`packages/runtime-prelude`).
pub const PRELUDE_UI: &str = include_str!("../../../packages/runtime-prelude/dist/prelude.ui.js");
/// The server prelude.
pub const PRELUDE_SERVER: &str =
    include_str!("../../../packages/runtime-prelude/dist/prelude.server.js");

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeKind {
    Ui,
    Server,
}

/// JS → host.
#[derive(Debug)]
pub enum Outbound {
    Commit {
        ops: Vec<Op>,
        warnings: Vec<String>,
        commit_ms: f32,
    },
    /// A native call that must run on the main thread; answer with
    /// `Inbound::NativeReply { id, .. }` (unless the function deferred).
    MainCall {
        id: u64,
        module: String,
        func: String,
        args: Value,
    },
    /// From the UI runtime's `server.fetch`; the answer is an
    /// `Inbound::ServerResponse` with the same id.
    ServerRequest {
        id: u64,
        url: String,
        method: String,
        headers: Vec<(String, String)>,
        body: Vec<u8>,
    },
    /// From the server runtime.
    ServerResponse {
        id: u64,
        status: u16,
        headers: Vec<(String, String)>,
        body: Vec<u8>,
    },
    /// Mirror of a `console.*`/`__pk.log` line (already written to `Services::log`).
    Log {
        level: LogLevel,
        msg: String,
    },
    /// An uncaught error or unhandled rejection (already logged).
    Error {
        message: String,
        stack: Option<String>,
    },
    PrepareReloadResult {
        href: String,
    },
    Exit {
        code: i32,
    },
    /// `LoadBundle` finished (module evaluated, including top-level await).
    Loaded {
        ok: bool,
        error: Option<String>,
    },
}

/// Host → JS.
#[derive(Debug)]
pub enum Inbound {
    UiEvent(UiEvent),
    NativeReply {
        id: u64,
        result: Result<Value, NativeError>,
    },
    ServerRequest {
        id: u64,
        url: String,
        method: String,
        headers: Vec<(String, String)>,
        body: Vec<u8>,
    },
    ServerResponse {
        id: u64,
        status: u16,
        headers: Vec<(String, String)>,
        body: Vec<u8>,
    },
    LoadBundle {
        entry: String,
        initial_href: Option<String>,
    },
    PrepareReload,
    Shutdown,
}

#[derive(Clone, Debug)]
pub struct DevConfig {
    pub host: String,
    pub port: u16,
}

#[derive(Clone, Debug)]
pub struct RuntimeConfig {
    pub kind: RuntimeKind,
    /// Directory `app:/<path>` specifiers resolve under.
    pub bundle_dir: String,
    pub memory_limit: usize,
    pub dev: Option<DevConfig>,
    /// Exposed as `__PK_APP_INFO`.
    pub app_info: Value,
}

pub struct JsHandle {
    pub inbound: crossbeam_channel::Sender<Inbound>,
    pub join: std::thread::JoinHandle<()>,
    /// Set by the runtime thread while it runs JS, and while it parks with
    /// native calls (or server-function requests) still awaiting a reply.
    pub(crate) busy: Arc<std::sync::atomic::AtomicBool>,
}

impl JsHandle {
    /// The runtime is running JS, waiting on native replies, or has messages
    /// queued (headless input waits for this to clear; a long React render
    /// sends nothing until it commits, and an HTTP call replies much later).
    pub fn is_busy(&self) -> bool {
        self.busy.load(std::sync::atomic::Ordering::Acquire) || !self.inbound.is_empty()
    }
}

/// Spawns the runtime thread. The prelude is evaluated immediately; the
/// bundle is loaded on `Inbound::LoadBundle`.
pub fn spawn_runtime(
    cfg: RuntimeConfig,
    registry: Arc<ModuleRegistry>,
    services: Services,
    workers: Arc<WorkerPool>,
    outbound: crossbeam_channel::Sender<Outbound>,
) -> JsHandle {
    runtime::spawn(
        cfg,
        registry,
        services,
        workers,
        outbound,
        runtime::SERVER_TIMEOUT_MS,
    )
}

#[cfg(test)]
mod tests;
