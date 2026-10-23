//! The `__pk` host bridge installed into every runtime before the prelude.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::hash::{BuildHasher, Hasher, RandomState};
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crossbeam_channel::Sender;
use pk_platform::{LogLevel, Services};
use pk_protocol::{Op, Value};
use rquickjs::convert::Coerced;
use rquickjs::function::Opt;
use rquickjs::{Ctx, Exception, Function, Object, Result, TypedArray, Value as JsValue};

use crate::convert::{body_from_value, bytes_of, from_js, headers_from_value, to_js};
use crate::{CallKind, Inbound, ModuleRegistry, NativeError, Outbound, RuntimeKind, WorkerPool};

/// Native timer heap: `(deadline, sequence)` ordered, one entry per id.
#[derive(Default)]
pub struct Timers {
    heap: BTreeMap<(Instant, u64), u32>,
    by_id: HashMap<u32, (Instant, u64)>,
    seq: u64,
}

impl Timers {
    pub fn set(&mut self, id: u32, deadline: Instant) {
        self.clear(id);
        self.seq += 1;
        let key = (deadline, self.seq);
        self.heap.insert(key, id);
        self.by_id.insert(id, key);
    }

    pub fn clear(&mut self, id: u32) {
        if let Some(key) = self.by_id.remove(&id) {
            self.heap.remove(&key);
        }
    }

    pub fn next_deadline(&self) -> Option<Instant> {
        self.heap.keys().next().map(|k| k.0)
    }

    /// Pops the earliest timer due at or before `now`.
    pub fn pop_due(&mut self, now: Instant) -> Option<u32> {
        let (&key, &id) = self.heap.iter().next()?;
        if key.0 > now {
            return None;
        }
        self.heap.remove(&key);
        self.by_id.remove(&id);
        Some(id)
    }
}

pub struct ServerReq {
    pub id: u64,
    pub url: String,
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

/// State shared between the bridge closures and the event loop (one thread).
pub struct Shared {
    pub kind: RuntimeKind,
    pub registry: Arc<ModuleRegistry>,
    pub services: Services,
    pub workers: Arc<WorkerPool>,
    pub outbound: Sender<Outbound>,
    pub inbound: Sender<Inbound>,
    pub timers: RefCell<Timers>,
    pub server_queue: RefCell<VecDeque<ServerReq>>,
    /// The server request being served and its deadline.
    pub inflight: Cell<Option<(u64, Instant)>>,
    /// Callback ids of native calls (and server-function requests) whose
    /// reply has not arrived yet: the runtime is still waiting on them.
    pub awaiting: RefCell<std::collections::HashSet<u64>>,
}

impl Shared {
    pub fn send(&self, msg: Outbound) {
        let _ = self.outbound.send(msg);
    }

    pub fn log(&self, level: LogLevel, msg: String) {
        self.services.log.log(level, &msg);
        self.send(Outbound::Log { level, msg });
    }

    pub fn report_error(&self, message: String, stack: Option<String>) {
        let text = match &stack {
            Some(s) if !s.is_empty() => format!("{message}\n{s}"),
            _ => message.clone(),
        };
        self.log(LogLevel::Error, text);
        self.send(Outbound::Error { message, stack });
    }

    pub fn server_response(
        &self,
        id: u64,
        status: u16,
        headers: Vec<(String, String)>,
        body: Vec<u8>,
    ) {
        self.send(Outbound::ServerResponse {
            id,
            status,
            headers,
            body,
        });
    }

    pub fn server_error(&self, id: u64, status: u16, message: &str) {
        let body = serde_json::json!({ "error": message })
            .to_string()
            .into_bytes();
        self.server_response(
            id,
            status,
            vec![("content-type".into(), "application/json".into())],
            body,
        );
    }

    fn reply_later(&self, id: u64, result: std::result::Result<Value, NativeError>) {
        let _ = self.inbound.send(Inbound::NativeReply { id, result });
    }

    fn native_call(&self, module: String, func: String, args: Value, cb: u64) {
        self.awaiting.borrow_mut().insert(cb);
        if self.kind == RuntimeKind::Ui && module == "server" && func == "fetch" {
            self.send(Outbound::ServerRequest {
                id: cb,
                url: args.get_str("url").unwrap_or("/").to_string(),
                method: args.get_str("method").unwrap_or("GET").to_string(),
                headers: args
                    .get("headers")
                    .map(headers_from_value)
                    .unwrap_or_default(),
                body: body_from_value(args.get("body")),
            });
            return;
        }
        match self.registry.has(&module, &func) {
            None => self.reply_later(cb, Err(NativeError::enosys(&module, &func))),
            Some(CallKind::Sync) => {
                let r = self.registry.call_sync(&module, &func, args);
                self.reply_later(cb, r);
            }
            Some(CallKind::Async) => {
                let registry = self.registry.clone();
                let tx = self.inbound.clone();
                self.workers.submit(Box::new(move || {
                    let result = registry.call_async_blocking(&module, &func, args);
                    let _ = tx.send(Inbound::NativeReply { id: cb, result });
                }));
            }
            Some(CallKind::Main) => self.send(Outbound::MainCall {
                id: cb,
                module,
                func,
                args,
            }),
        }
    }
}

fn throw_native<'js>(ctx: &Ctx<'js>, e: &NativeError) -> rquickjs::Error {
    match Exception::from_message(ctx.clone(), &e.message) {
        Ok(exc) => {
            let _ = exc.as_object().set("code", e.code.as_str());
            ctx.throw(exc.into_object().into_value())
        }
        Err(err) => err,
    }
}

fn random_fill(buf: &mut [u8]) {
    let state = RandomState::new();
    for (counter, chunk) in (0u64..).zip(buf.chunks_mut(8)) {
        let mut h = state.build_hasher();
        h.write_u64(counter);
        let bytes = h.finish().to_le_bytes();
        chunk.copy_from_slice(&bytes[..chunk.len()]);
    }
}

fn f64_to_u64(n: f64) -> u64 {
    if n.is_finite() && n >= 0.0 {
        n as u64
    } else {
        0
    }
}

/// Installs `__pk`, `__PK_APP_INFO` and (in dev) `__PK_DEV`.
pub fn install<'js>(
    ctx: &Ctx<'js>,
    sh: &Rc<Shared>,
    app_info: &Value,
    dev: Option<&crate::DevConfig>,
) -> Result<()> {
    let globals = ctx.globals();
    let pk = Object::new(ctx.clone())?;

    let s = sh.clone();
    pk.set(
        "commit",
        Function::new(
            ctx.clone(),
            move |ctx: Ctx<'js>, ops: JsValue<'js>| -> Result<()> {
                let t0 = Instant::now();
                let value = from_js(&ops);
                let parsed = pk_protocol::parse_commit(&value)
                    .map_err(|e| Exception::throw_type(&ctx, &format!("invalid commit: {e}")))?;
                let mut warnings = Vec::new();
                for op in &parsed {
                    match op {
                        Op::Create { id, props, .. } | Op::Update { id, props } => {
                            for key in &props.unknown {
                                warnings.push(format!("node {id}: unknown prop \"{key}\""));
                            }
                        }
                        _ => {}
                    }
                }
                let commit_ms = t0.elapsed().as_secs_f32() * 1000.0;
                s.send(Outbound::Commit {
                    ops: parsed,
                    warnings,
                    commit_ms,
                });
                Ok(())
            },
        )?,
    )?;

    let s = sh.clone();
    pk.set(
        "call",
        Function::new(
            ctx.clone(),
            move |module: Coerced<String>, func: Coerced<String>, args: JsValue<'js>, cb: f64| {
                s.native_call(module.0, func.0, from_js(&args), f64_to_u64(cb));
            },
        )?,
    )?;

    let s = sh.clone();
    pk.set(
        "callSync",
        Function::new(
            ctx.clone(),
            move |ctx: Ctx<'js>,
                  module: Coerced<String>,
                  func: Coerced<String>,
                  args: JsValue<'js>|
                  -> Result<JsValue<'js>> {
                if s.registry.has(&module.0, &func.0) != Some(CallKind::Sync) {
                    let e = NativeError::new(
                        "ENOSYS",
                        format!(
                            "{}.{} is not a synchronous native function",
                            module.0, func.0
                        ),
                    );
                    return Err(throw_native(&ctx, &e));
                }
                match s.registry.call_sync(&module.0, &func.0, from_js(&args)) {
                    Ok(v) => to_js(&ctx, &v),
                    Err(e) => Err(throw_native(&ctx, &e)),
                }
            },
        )?,
    )?;

    let s = sh.clone();
    pk.set(
        "timer",
        Function::new(ctx.clone(), move |id: f64, delay_ms: f64| {
            let delay = if delay_ms.is_finite() && delay_ms > 0.0 {
                delay_ms
            } else {
                0.0
            };
            let deadline =
                Instant::now() + Duration::from_secs_f64(delay.min(2_147_483_647.0) / 1000.0);
            s.timers.borrow_mut().set(id as u32, deadline);
        })?,
    )?;

    let s = sh.clone();
    pk.set(
        "clearTimer",
        Function::new(ctx.clone(), move |id: f64| {
            s.timers.borrow_mut().clear(id as u32);
        })?,
    )?;

    let s = sh.clone();
    pk.set(
        "log",
        Function::new(
            ctx.clone(),
            move |level: Coerced<String>, msg: Coerced<String>| {
                s.log(LogLevel::parse(&level.0), msg.0);
            },
        )?,
    )?;

    let s = sh.clone();
    pk.set(
        "now",
        Function::new(ctx.clone(), move || s.services.clock.now_ms())?,
    )?;

    pk.set(
        "random",
        Function::new(
            ctx.clone(),
            |ctx: Ctx<'js>, arr: JsValue<'js>| -> Result<()> {
                let ta = arr
                    .as_object()
                    .and_then(|o| o.as_typed_array::<u8>())
                    .ok_or_else(|| Exception::throw_type(&ctx, "random() expects a Uint8Array"))?;
                if let Some(raw) = ta.as_raw() {
                    // SAFETY: no JS runs while we fill the buffer.
                    let slice = unsafe { &mut *raw.as_ptr() };
                    random_fill(slice);
                }
                Ok(())
            },
        )?,
    )?;

    pk.set(
        "encodeUtf8",
        Function::new(ctx.clone(), |ctx: Ctx<'js>, s: Coerced<String>| {
            TypedArray::<u8>::new(ctx, s.0.into_bytes())
        })?,
    )?;

    pk.set(
        "decodeUtf8",
        Function::new(
            ctx.clone(),
            |ctx: Ctx<'js>, data: JsValue<'js>| -> Result<String> {
                let bytes = data.as_object().and_then(bytes_of).ok_or_else(|| {
                    Exception::throw_type(&ctx, "decodeUtf8() expects a Uint8Array or ArrayBuffer")
                })?;
                Ok(String::from_utf8_lossy(&bytes).into_owned())
            },
        )?,
    )?;

    let s = sh.clone();
    pk.set(
        "exit",
        Function::new(ctx.clone(), move |code: Opt<f64>| {
            s.send(Outbound::Exit {
                code: code.0.unwrap_or(0.0) as i32,
            });
        })?,
    )?;

    // Server runtime: completion of the request started by `__pk_serve`.
    let s = sh.clone();
    pk.set(
        "serverDone",
        Function::new(
            ctx.clone(),
            move |id: f64, ok: bool, result: JsValue<'js>| {
                let id = f64_to_u64(id);
                if s.inflight.get().map(|(i, _)| i) != Some(id) {
                    return; // already timed out
                }
                s.inflight.set(None);
                let v = from_js(&result);
                if !ok {
                    let msg = v.as_str().unwrap_or("server function failed").to_string();
                    s.server_error(id, 500, &msg);
                    return;
                }
                let status = v.get_f64("status").map(|n| n as u16).unwrap_or(200);
                let headers = v.get("headers").map(headers_from_value).unwrap_or_default();
                let body = body_from_value(v.get("body"));
                s.server_response(id, status, headers, body);
            },
        )?,
    )?;

    globals.set("__pk", pk)?;
    globals.set("__PK_APP_INFO", to_js(ctx, app_info)?)?;
    if let Some(dev) = dev {
        let obj = Object::new(ctx.clone())?;
        obj.set("host", dev.host.as_str())?;
        obj.set("port", dev.port as i32)?;
        globals.set("__PK_DEV", obj)?;
    }
    Ok(())
}
