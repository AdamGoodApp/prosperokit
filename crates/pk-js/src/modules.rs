//! Native module registry: `module.fn` → Rust implementation, in three kinds
//! (worker pool, JS thread, main thread).

use std::any::Any;
use std::collections::HashMap;
use std::fmt;
use std::sync::Arc;

use pk_platform::{FrameHost, FsError, HttpError, PlatformError, Services};
use pk_protocol::Value;

/// An error from a native call; becomes `{ code, message }` in JS.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativeError {
    pub code: String,
    pub message: String,
}

impl NativeError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> NativeError {
        NativeError {
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn enosys(module: &str, func: &str) -> NativeError {
        NativeError::new("ENOSYS", format!("no native function {module}.{func}"))
    }

    pub fn invalid(message: impl Into<String>) -> NativeError {
        NativeError::new("EINVAL", message)
    }
}

impl fmt::Display for NativeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for NativeError {}

impl From<FsError> for NativeError {
    fn from(e: FsError) -> Self {
        NativeError::new(e.code(), e.to_string())
    }
}

impl From<HttpError> for NativeError {
    fn from(e: HttpError) -> Self {
        NativeError::new(e.code(), e.to_string())
    }
}

impl From<PlatformError> for NativeError {
    fn from(e: PlatformError) -> Self {
        let code = match &e {
            PlatformError::Busy => "EBUSY",
            PlatformError::Unsupported(_) => "ENOTSUP",
            PlatformError::Failed { .. } => "EPLATFORM",
        };
        NativeError::new(code, e.to_string())
    }
}

pub type AsyncFn = Arc<dyn Fn(Value) -> Result<Value, NativeError> + Send + Sync>;
/// Runs inline on the JS thread.
pub type SyncFn = AsyncFn;
pub type MainFn = Arc<dyn Fn(&mut dyn MainHost, Value) -> Result<Value, NativeError> + Send + Sync>;

/// What a main-thread native function may touch.
pub trait MainHost {
    fn engine_any(&mut self) -> &mut dyn Any;
    fn frame_host(&mut self) -> &mut dyn FrameHost;
    fn services(&self) -> &Services;
    fn audio_any(&mut self) -> &mut dyn Any;
    /// The callback id of the call being executed (the id the JS side will
    /// be answered with). Needed by functions that reply later.
    fn call_id(&self) -> u64;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CallKind {
    Async,
    Sync,
    Main,
}

#[derive(Clone)]
enum Entry {
    Async(AsyncFn),
    Sync(SyncFn),
    Main(MainFn),
}

/// The marker a [`MainFn`] returns when it will answer the call itself later
/// (the executor must not send a `NativeReply` now). Used by `ime.open`.
pub fn deferred() -> Value {
    Value::obj([("$deferred", Value::Bool(true))])
}

pub fn is_deferred(v: &Value) -> bool {
    matches!(v.get("$deferred"), Some(Value::Bool(true)))
}

#[derive(Default)]
pub struct ModuleRegistry {
    entries: HashMap<(String, String), Entry>,
}

impl ModuleRegistry {
    pub fn new() -> ModuleRegistry {
        ModuleRegistry::default()
    }

    pub fn add_async(&mut self, module: &str, func: &str, f: AsyncFn) {
        self.entries
            .insert((module.into(), func.into()), Entry::Async(f));
    }

    pub fn add_sync(&mut self, module: &str, func: &str, f: SyncFn) {
        self.entries
            .insert((module.into(), func.into()), Entry::Sync(f));
    }

    pub fn add_main(&mut self, module: &str, func: &str, f: MainFn) {
        self.entries
            .insert((module.into(), func.into()), Entry::Main(f));
    }

    pub fn has(&self, module: &str, func: &str) -> Option<CallKind> {
        self.entries
            .get(&(module.to_string(), func.to_string()))
            .map(|e| match e {
                Entry::Async(_) => CallKind::Async,
                Entry::Sync(_) => CallKind::Sync,
                Entry::Main(_) => CallKind::Main,
            })
    }

    fn get(&self, module: &str, func: &str) -> Result<&Entry, NativeError> {
        self.entries
            .get(&(module.to_string(), func.to_string()))
            .ok_or_else(|| NativeError::enosys(module, func))
    }

    /// Runs a `Sync` function.
    pub fn call_sync(&self, module: &str, func: &str, args: Value) -> Result<Value, NativeError> {
        match self.get(module, func)? {
            Entry::Sync(f) => f(args),
            _ => Err(NativeError::new(
                "ENOSYS",
                format!("{module}.{func} is not a synchronous function"),
            )),
        }
    }

    /// Runs an `Async` (or `Sync`) function on the calling thread; for workers.
    pub fn call_async_blocking(
        &self,
        module: &str,
        func: &str,
        args: Value,
    ) -> Result<Value, NativeError> {
        match self.get(module, func)? {
            Entry::Async(f) | Entry::Sync(f) => f(args),
            Entry::Main(_) => Err(NativeError::new(
                "ENOSYS",
                format!("{module}.{func} runs on the main thread"),
            )),
        }
    }

    /// Runs a `Main` function; call from the main thread.
    pub fn call_main(
        &self,
        host: &mut dyn MainHost,
        module: &str,
        func: &str,
        args: Value,
    ) -> Result<Value, NativeError> {
        match self.get(module, func)? {
            Entry::Main(f) => f(host, args),
            _ => Err(NativeError::new(
                "ENOSYS",
                format!("{module}.{func} does not run on the main thread"),
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_and_errors() {
        let mut r = ModuleRegistry::new();
        r.add_sync("a", "s", Arc::new(Ok));
        r.add_async("a", "w", Arc::new(|_| Err(NativeError::new("EX", "boom"))));
        assert_eq!(r.has("a", "s"), Some(CallKind::Sync));
        assert_eq!(r.has("a", "w"), Some(CallKind::Async));
        assert_eq!(r.has("a", "x"), None);
        assert_eq!(r.call_sync("a", "s", Value::Num(1.0)), Ok(Value::Num(1.0)));
        assert_eq!(
            r.call_sync("a", "w", Value::Null).unwrap_err().code,
            "ENOSYS"
        );
        assert_eq!(
            r.call_async_blocking("a", "w", Value::Null)
                .unwrap_err()
                .code,
            "EX"
        );
        assert_eq!(
            r.call_async_blocking("a", "s", Value::Null),
            Ok(Value::Null)
        );
        assert_eq!(
            r.call_async_blocking("zz", "s", Value::Null)
                .unwrap_err()
                .code,
            "ENOSYS"
        );
        assert!(is_deferred(&deferred()));
    }
}
