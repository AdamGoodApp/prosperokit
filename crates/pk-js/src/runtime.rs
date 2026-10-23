//! `JsRuntime` (QuickJS runtime + context + module loader) and its event loop
//! thread.

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use crossbeam_channel::{Receiver, RecvTimeoutError, unbounded};
use pk_platform::{Fs, LogLevel, Services};
use pk_protocol::Value;
use rquickjs::loader::{ImportAttributes, Loader, Resolver};
use rquickjs::module::Declared;
use rquickjs::promise::PromiseState;
use rquickjs::{
    Context, Ctx, Error, Exception, Module, Object, Persistent, Promise, Runtime, Value as JsValue,
};

use crate::bridge::{self, ServerReq, Shared};
use crate::convert::{from_js, headers_to_value, to_js};
use crate::{
    Inbound, JsHandle, ModuleRegistry, NativeError, Outbound, PRELUDE_SERVER, PRELUDE_UI,
    RuntimeConfig, RuntimeKind, WorkerPool, spawn_thread,
};

pub const SERVER_TIMEOUT_MS: u64 = 30_000;

const SERVE_SHIM: &str = r#"
globalThis.__pk_serve = function (id, url, method, headers, body) {
  Promise.resolve()
    .then(function () {
      var req = globalThis.__pk_makeRequest(url, method, headers, body);
      return globalThis.__pk_server.fetch(req);
    })
    .then(function (res) { return globalThis.__pk_readResponse(res); })
    .then(
      function (r) { __pk.serverDone(id, true, r); },
      function (e) { __pk.serverDone(id, false, String((e && e.message) || e)); }
    );
};
"#;

// ---------------------------------------------------------------- loader --

const ASYNC_HOOKS: &str = "node:async_hooks";

struct AppResolver {
    kind: RuntimeKind,
}

impl Resolver for AppResolver {
    fn resolve<'js>(
        &mut self,
        _ctx: &Ctx<'js>,
        base: &str,
        name: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<String> {
        if name.starts_with("app:/") || (name == ASYNC_HOOKS && self.kind == RuntimeKind::Server) {
            return Ok(name.to_string());
        }
        Err(Error::new_resolving_message(
            base,
            name,
            format!(
                "Cannot resolve \"{name}\" (ProsperoKit bundles are single-file; this import survived bundling)"
            ),
        ))
    }
}

struct AppLoader {
    fs: Arc<dyn Fs>,
    bundle_dir: String,
}

fn is_identifier(s: &str) -> bool {
    let mut chars = s.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_' || c == '$')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
        && !matches!(
            s,
            "default"
                | "class"
                | "function"
                | "var"
                | "let"
                | "const"
                | "new"
                | "delete"
                | "return"
        )
}

impl Loader for AppLoader {
    fn load<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        name: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<Module<'js, Declared>> {
        if name == ASYNC_HOOKS {
            let hooks: Object<'js> = ctx.globals().get("__pk_async_hooks")?;
            let mut src =
                String::from("const m = globalThis.__pk_async_hooks;\nexport default m;\n");
            for key in hooks.keys::<String>().flatten() {
                if is_identifier(&key) {
                    src.push_str(&format!("export const {key} = m.{key};\n"));
                }
            }
            return Module::declare(ctx.clone(), name, src);
        }
        let Some(rel) = name.strip_prefix("app:/") else {
            return Err(Error::new_loading_message(
                name,
                "unsupported module specifier",
            ));
        };
        let rel = rel.trim_start_matches('/');
        if rel.split('/').any(|c| c == "..") {
            return Err(Error::new_loading_message(
                name,
                "module path escapes the bundle directory",
            ));
        }
        let path = format!("{}/{}", self.bundle_dir.trim_end_matches('/'), rel);
        let bytes = self
            .fs
            .read(&path)
            .map_err(|e| Error::new_loading_message(name, format!("{path}: {e}")))?;
        Module::declare(ctx.clone(), name, bytes)
    }
}

// ------------------------------------------------------------ exceptions --

/// (message, stack) of a thrown value.
fn describe<'js>(v: &JsValue<'js>) -> (String, Option<String>) {
    if let Some(obj) = v.as_object() {
        if let Some(exc) = Exception::from_object(obj.clone()) {
            let message = exc.message().unwrap_or_default();
            let message = if message.is_empty() {
                "Error".to_string()
            } else {
                message
            };
            return (message, exc.stack().filter(|s| !s.is_empty()));
        }
        if let Ok(m) = obj.get::<_, String>("message") {
            return (m, None);
        }
    }
    if let Some(s) = v.as_string().and_then(|s| s.to_string().ok()) {
        return (s, None);
    }
    (from_js(v).to_string(), None)
}

fn describe_error<'js>(ctx: &Ctx<'js>, e: &Error) -> (String, Option<String>) {
    match e {
        Error::Exception => describe(&ctx.catch()),
        other => (other.to_string(), None),
    }
}

// ----------------------------------------------------------------- state --

struct LoadState {
    promise: Persistent<Promise<'static>>,
    ns: Persistent<Object<'static>>,
}

enum ServerState {
    Loading,
    Ready,
    Failed(String),
}

type Unhandled = Rc<RefCell<Vec<(Persistent<JsValue<'static>>, String, Option<String>)>>>;

struct JsRuntime {
    rt: Runtime,
    ctx: Context,
    sh: Rc<Shared>,
    cfg: RuntimeConfig,
    unhandled: Unhandled,
    load: Option<LoadState>,
    server: ServerState,
    prelude_error: Option<String>,
    server_timeout: Duration,
}

impl JsRuntime {
    fn new(
        cfg: RuntimeConfig,
        registry: Arc<ModuleRegistry>,
        services: Services,
        workers: Arc<WorkerPool>,
        outbound: crossbeam_channel::Sender<Outbound>,
        inbound: crossbeam_channel::Sender<Inbound>,
        server_timeout_ms: u64,
    ) -> Result<JsRuntime, String> {
        let rt = Runtime::new().map_err(|e| format!("failed to create the JS runtime: {e}"))?;
        rt.set_memory_limit(cfg.memory_limit);
        rt.set_max_stack_size(1 << 20);
        rt.set_gc_threshold(16 << 20);
        rt.set_loader(
            AppResolver { kind: cfg.kind },
            AppLoader {
                fs: services.fs.clone(),
                bundle_dir: cfg.bundle_dir.clone(),
            },
        );
        let unhandled: Unhandled = Rc::new(RefCell::new(Vec::new()));
        {
            let list = unhandled.clone();
            rt.set_host_promise_rejection_tracker(Some(Box::new(
                move |ctx, promise, reason, is_handled| {
                    if is_handled {
                        list.borrow_mut().retain(|(p, _, _)| {
                            p.clone()
                                .restore(&ctx)
                                .map(|v| v != promise)
                                .unwrap_or(true)
                        });
                    } else {
                        let (msg, stack) = describe(&reason);
                        list.borrow_mut()
                            .push((Persistent::save(&ctx, promise), msg, stack));
                    }
                },
            )));
        }
        let context =
            Context::full(&rt).map_err(|e| format!("failed to create the JS context: {e}"))?;
        let sh = Rc::new(Shared {
            kind: cfg.kind,
            registry,
            services,
            workers,
            outbound,
            inbound,
            timers: RefCell::new(bridge::Timers::default()),
            server_queue: RefCell::new(Default::default()),
            inflight: std::cell::Cell::new(None),
            awaiting: RefCell::new(Default::default()),
        });
        let mut js = JsRuntime {
            rt,
            ctx: context,
            sh,
            cfg,
            unhandled,
            load: None,
            server: ServerState::Loading,
            prelude_error: None,
            server_timeout: Duration::from_millis(server_timeout_ms),
        };
        js.boot();
        Ok(js)
    }

    /// Installs `__pk` and evaluates the prelude.
    fn boot(&mut self) {
        let prelude = match self.cfg.kind {
            RuntimeKind::Ui => PRELUDE_UI,
            RuntimeKind::Server => PRELUDE_SERVER,
        };
        let sh = self.sh.clone();
        let cfg = self.cfg.clone();
        let err = self.ctx.with(|ctx| -> Option<(String, Option<String>)> {
            let run = || -> rquickjs::Result<()> {
                bridge::install(&ctx, &sh, &cfg.app_info, cfg.dev.as_ref())?;
                ctx.eval::<(), _>(prelude)?;
                if cfg.kind == RuntimeKind::Server {
                    ctx.eval::<(), _>(SERVE_SHIM)?;
                }
                Ok(())
            };
            run().err().map(|e| describe_error(&ctx, &e))
        });
        if let Some((msg, stack)) = err {
            let msg = format!("prelude failed: {msg}");
            self.sh.report_error(msg.clone(), stack);
            self.prelude_error = Some(msg);
        }
        self.settle();
    }

    /// Runs pending promise jobs until none remain.
    fn drain_jobs(&self) {
        loop {
            match self.rt.execute_pending_job() {
                Ok(true) => {}
                Ok(false) => break,
                Err(e) => {
                    let (msg, stack) = e.0.with(|ctx| describe(&ctx.catch()));
                    self.sh.report_error(msg, stack);
                }
            }
        }
    }

    /// After any JS entry: drain jobs, observe the load promise, report
    /// unhandled rejections, pump the server queue.
    fn settle(&mut self) {
        self.drain_jobs();
        self.check_load();
        self.report_unhandled();
        self.pump_server();
    }

    fn report_unhandled(&mut self) {
        let pending: Vec<_> = self.unhandled.borrow_mut().drain(..).collect();
        if pending.is_empty() {
            return;
        }
        let load_promise = self.load.as_ref().map(|l| l.promise.clone());
        for (p, msg, stack) in pending {
            let is_load = self
                .ctx
                .with(|ctx| match (&load_promise, p.clone().restore(&ctx)) {
                    (Some(lp), Ok(pv)) => lp
                        .clone()
                        .restore(&ctx)
                        .map(|l| l.as_value() == &pv)
                        .unwrap_or(false),
                    _ => false,
                });
            if !is_load {
                self.sh
                    .report_error(format!("Unhandled promise rejection: {msg}"), stack);
            }
        }
    }

    fn check_load(&mut self) {
        let Some(load) = &self.load else { return };
        let promise = load.promise.clone();
        let ns = load.ns.clone();
        let kind = self.cfg.kind;
        // Some(Ok) resolved, Some(Err) rejected, None pending.
        let outcome = self
            .ctx
            .with(|ctx| -> Option<Result<(), (String, Option<String>)>> {
                let promise = promise.restore(&ctx).ok()?;
                match promise.state() {
                    PromiseState::Pending => None,
                    PromiseState::Resolved => {
                        if kind == RuntimeKind::Server {
                            let r = (|| -> rquickjs::Result<()> {
                                let ns = ns.restore(&ctx)?;
                                let default: JsValue = ns.get("default")?;
                                let ok = default
                                    .as_object()
                                    .and_then(|o| o.get::<_, JsValue>("fetch").ok())
                                    .is_some_and(|f| f.is_function());
                                if !ok {
                                    return Err(Exception::throw_type(
                                        &ctx,
                                        "server.js must `export default { fetch(request) { … } }`",
                                    ));
                                }
                                ctx.globals().set("__pk_server", default)
                            })();
                            return Some(r.map_err(|e| describe_error(&ctx, &e)));
                        }
                        Some(Ok(()))
                    }
                    PromiseState::Rejected => {
                        let reason = match promise.result::<JsValue>() {
                            Some(Err(Error::Exception)) => ctx.catch(),
                            Some(Err(e)) => return Some(Err((e.to_string(), None))),
                            _ => JsValue::new_undefined(ctx.clone()),
                        };
                        Some(Err(describe(&reason)))
                    }
                }
            });
        let Some(outcome) = outcome else { return };
        self.clear_load();
        match outcome {
            Ok(()) => {
                if kind == RuntimeKind::Server {
                    self.server = ServerState::Ready;
                }
                self.sh.send(Outbound::Loaded {
                    ok: true,
                    error: None,
                });
            }
            Err((msg, stack)) => {
                if kind == RuntimeKind::Server {
                    self.server = ServerState::Failed(msg.clone());
                }
                self.sh.report_error(msg.clone(), stack);
                self.sh.send(Outbound::Loaded {
                    ok: false,
                    error: Some(msg),
                });
            }
        }
    }

    fn clear_load(&mut self) {
        // Persistents must not outlive the runtime; dropping them here is
        // fine because the runtime is alive.
        self.load = None;
    }

    fn load_failed(&mut self, msg: String, stack: Option<String>) {
        if self.cfg.kind == RuntimeKind::Server {
            self.server = ServerState::Failed(msg.clone());
        }
        self.sh.report_error(msg.clone(), stack);
        self.sh.send(Outbound::Loaded {
            ok: false,
            error: Some(msg),
        });
    }

    fn load_bundle(&mut self, entry: String, initial_href: Option<String>) {
        if let Some(e) = self.prelude_error.clone() {
            self.load_failed(e, None);
            return;
        }
        let bytes = match self.sh.services.fs.read(&entry) {
            Ok(b) => b,
            Err(e) => {
                self.load_failed(format!("cannot read {entry}: {e}"), None);
                return;
            }
        };
        let dir = self.cfg.bundle_dir.trim_end_matches('/').to_string();
        let name = match entry.strip_prefix(&format!("{dir}/")) {
            Some(rel) => format!("app:/{rel}"),
            None => format!("app:/{}", entry.rsplit('/').next().unwrap_or("app.js")),
        };
        let res = self
            .ctx
            .with(|ctx| -> Result<LoadState, (String, Option<String>)> {
                let run = || -> rquickjs::Result<LoadState> {
                    let globals = ctx.globals();
                    match &initial_href {
                        Some(h) => globals.set("__PK_INITIAL_HREF", h.as_str())?,
                        None => globals.remove("__PK_INITIAL_HREF")?,
                    }
                    let module = Module::declare(ctx.clone(), name.as_str(), bytes)?;
                    let (module, promise) = module.eval()?;
                    let ns = module.namespace()?;
                    Ok(LoadState {
                        promise: Persistent::save(&ctx, promise),
                        ns: Persistent::save(&ctx, ns),
                    })
                };
                run().map_err(|e| describe_error(&ctx, &e))
            });
        match res {
            Ok(state) => self.load = Some(state),
            Err((msg, stack)) => self.load_failed(msg, stack),
        }
    }

    /// Calls a global function; errors are reported.
    fn call_global<F>(&mut self, name: &str, args: F) -> Option<Value>
    where
        F: for<'js> FnOnce(&Ctx<'js>) -> rquickjs::Result<Vec<JsValue<'js>>>,
    {
        let sh = self.sh.clone();
        let res = self
            .ctx
            .with(|ctx| -> Result<Value, (String, Option<String>)> {
                let run = || -> rquickjs::Result<Value> {
                    let f: JsValue = ctx.globals().get(name)?;
                    let Some(f) = f.as_function() else {
                        return Err(Exception::throw_type(
                            &ctx,
                            &format!("global {name} is not defined"),
                        ));
                    };
                    let a = args(&ctx)?;
                    let mut call_args = rquickjs::function::Args::new(ctx.clone(), a.len());
                    call_args.push_args(a)?;
                    let out: JsValue = call_args.apply(f)?;
                    Ok(from_js(&out))
                };
                run().map_err(|e| describe_error(&ctx, &e))
            });
        let out = match res {
            Ok(v) => Some(v),
            Err((msg, stack)) => {
                sh.report_error(msg, stack);
                None
            }
        };
        self.settle();
        out
    }

    fn handle(&mut self, msg: Inbound) -> bool {
        match msg {
            Inbound::Shutdown => return false,
            Inbound::UiEvent(ev) => {
                self.call_global("__pk_dispatch", |ctx| {
                    Ok(vec![
                        JsValue::new_int(ctx.clone(), ev.target as i32),
                        rquickjs::String::from_str(ctx.clone(), ev.kind.as_str())?.into_value(),
                        to_js(ctx, &ev.payload)?,
                    ])
                });
            }
            Inbound::NativeReply { id, result } => self.reply(id, result),
            Inbound::ServerResponse {
                id,
                status,
                headers,
                body,
            } => {
                let v = Value::obj([
                    ("status", Value::from(status as u32)),
                    ("headers", headers_to_value(&headers)),
                    ("body", Value::Bytes(body)),
                ]);
                self.reply(id, Ok(v));
            }
            Inbound::ServerRequest {
                id,
                url,
                method,
                headers,
                body,
            } => {
                self.sh.server_queue.borrow_mut().push_back(ServerReq {
                    id,
                    url,
                    method,
                    headers,
                    body,
                });
                self.pump_server();
            }
            Inbound::LoadBundle {
                entry,
                initial_href,
            } => {
                self.load_bundle(entry, initial_href);
                self.settle();
            }
            Inbound::PrepareReload => {
                let v = self.call_global("__pk_prepareReload", |_| Ok(Vec::new()));
                let href = v
                    .as_ref()
                    .and_then(|v| v.get_str("href"))
                    .unwrap_or("/")
                    .to_string();
                self.sh.send(Outbound::PrepareReloadResult { href });
            }
        }
        true
    }

    fn reply(&mut self, id: u64, result: Result<Value, NativeError>) {
        self.sh.awaiting.borrow_mut().remove(&id);
        self.call_global("__pk_reply", |ctx| {
            let (ok, v) = match &result {
                Ok(v) => (true, v.clone()),
                Err(e) => (
                    false,
                    Value::obj([
                        ("code", Value::from(e.code.as_str())),
                        ("message", Value::from(e.message.as_str())),
                    ]),
                ),
            };
            Ok(vec![
                JsValue::new_float(ctx.clone(), id as f64),
                JsValue::new_bool(ctx.clone(), ok),
                to_js(ctx, &v)?,
            ])
        });
    }

    fn fire_timers(&mut self) {
        let now = Instant::now();
        loop {
            let id = self.sh.timers.borrow_mut().pop_due(now);
            let Some(id) = id else { break };
            self.call_global("__pk_fireTimer", |ctx| {
                Ok(vec![JsValue::new_int(ctx.clone(), id as i32)])
            });
        }
    }

    fn pump_server(&mut self) {
        if self.cfg.kind != RuntimeKind::Server {
            return;
        }
        if let Some((id, deadline)) = self.sh.inflight.get()
            && Instant::now() >= deadline
        {
            self.sh.inflight.set(None);
            self.sh.server_error(id, 504, "server function timeout");
        }
        match &self.server {
            ServerState::Loading => {}
            ServerState::Failed(msg) => {
                let msg = format!("server bundle failed to load: {msg}");
                let queued: Vec<_> = self.sh.server_queue.borrow_mut().drain(..).collect();
                for r in queued {
                    self.sh.server_error(r.id, 500, &msg);
                }
            }
            ServerState::Ready => {
                if self.sh.inflight.get().is_some() {
                    return;
                }
                let next = self.sh.server_queue.borrow_mut().pop_front();
                let Some(req) = next else { return };
                self.sh
                    .inflight
                    .set(Some((req.id, Instant::now() + self.server_timeout)));
                let id = req.id;
                let ServerReq {
                    url,
                    method,
                    headers,
                    body,
                    ..
                } = req;
                let r = self.call_global("__pk_serve", move |ctx| {
                    Ok(vec![
                        JsValue::new_float(ctx.clone(), id as f64),
                        to_js(ctx, &Value::Str(url))?,
                        to_js(ctx, &Value::Str(method))?,
                        to_js(ctx, &headers_to_value(&headers))?,
                        to_js(ctx, &Value::Bytes(body))?,
                    ])
                });
                if r.is_none() && self.sh.inflight.get().map(|(i, _)| i) == Some(id) {
                    self.sh.inflight.set(None);
                    self.sh
                        .server_error(id, 500, "server request failed to start");
                }
            }
        }
    }

    fn next_wake(&self) -> Option<Instant> {
        let t = self.sh.timers.borrow().next_deadline();
        let s = self.sh.inflight.get().map(|(_, d)| d);
        match (t, s) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        }
    }

    fn run_loop(&mut self, rx: Receiver<Inbound>, busy: &AtomicBool) {
        'outer: loop {
            // Parked, but still waiting on native replies counts as busy.
            busy.store(!self.sh.awaiting.borrow().is_empty(), Ordering::Release);
            let first = match self.next_wake() {
                Some(at) => {
                    let wait = at.saturating_duration_since(Instant::now());
                    match rx.recv_timeout(wait) {
                        Ok(m) => Some(m),
                        Err(RecvTimeoutError::Timeout) => None,
                        Err(RecvTimeoutError::Disconnected) => break,
                    }
                }
                None => match rx.recv() {
                    Ok(m) => Some(m),
                    Err(_) => break,
                },
            };
            busy.store(true, Ordering::Release);
            if let Some(m) = first
                && !self.handle(m)
            {
                break;
            }
            while let Ok(m) = rx.try_recv() {
                if !self.handle(m) {
                    break 'outer;
                }
            }
            self.fire_timers();
            self.settle();
        }
    }

    /// Drops every Persistent so the runtime can be freed.
    fn teardown(mut self) {
        self.load = None;
        self.unhandled.borrow_mut().clear();
        self.rt.set_host_promise_rejection_tracker(None);
        self.ctx.with(|ctx| ctx.run_gc());
        drop(self.ctx);
        drop(self.rt);
    }
}

pub fn spawn(
    cfg: RuntimeConfig,
    registry: Arc<ModuleRegistry>,
    services: Services,
    workers: Arc<WorkerPool>,
    outbound: crossbeam_channel::Sender<Outbound>,
    server_timeout_ms: u64,
) -> JsHandle {
    let (tx, rx) = unbounded::<Inbound>();
    let self_tx = tx.clone();
    let name = match cfg.kind {
        RuntimeKind::Ui => "pk-ui-js",
        RuntimeKind::Server => "pk-server-js",
    };
    let log_services = services.clone();
    let busy = Arc::new(AtomicBool::new(true));
    let thread_busy = busy.clone();
    let join = spawn_thread(name, 8 << 20, move || {
        match JsRuntime::new(
            cfg,
            registry,
            services,
            workers,
            outbound.clone(),
            self_tx,
            server_timeout_ms,
        ) {
            Ok(mut js) => {
                js.run_loop(rx, &thread_busy);
                thread_busy.store(false, Ordering::Release);
                js.teardown();
            }
            Err(e) => {
                log_services.log.log(LogLevel::Error, &e);
                thread_busy.store(false, Ordering::Release);
                let _ = outbound.send(Outbound::Error {
                    message: e.clone(),
                    stack: None,
                });
                // Answer loads with a failure so the host does not wait forever.
                while let Ok(m) = rx.recv() {
                    match m {
                        Inbound::LoadBundle { .. } => {
                            let _ = outbound.send(Outbound::Loaded {
                                ok: false,
                                error: Some(e.clone()),
                            });
                        }
                        Inbound::Shutdown => break,
                        _ => {}
                    }
                }
            }
        }
    })
    .expect("failed to spawn the JS runtime thread");
    JsHandle {
        inbound: tx,
        join,
        busy,
    }
}
