//! The ProsperoKit application runtime (plan Phase 4 §7): wires the platform,
//! the engine, the JS runtimes (`ui-js`, `server-js`), the native modules, the
//! worker pool, the audio mixer and, in dev builds, the dev agent.
//!
//! Threads: the platform's main thread runs [`Runtime::frame`] once per
//! display frame; each JS runtime owns its own thread; blocking native work
//! (files, HTTP, image decoding) runs on the worker pool; the audio thread is
//! owned by the platform's `AudioOut` and pulls samples from the mixer.

use std::any::Any;
use std::sync::Arc;

use crossbeam_channel::{Receiver, Sender, unbounded};
use parking_lot::Mutex;
use pk_engine::{DecodedImage, Engine, EngineConfig, FrameStats, ImeOverlay, SoundCue};
use pk_js::{
    DevConfig, Inbound, JsHandle, MainHost, ModuleRegistry, NativeError, Outbound, RuntimeConfig,
    RuntimeKind, WorkerPool, is_deferred, spawn_runtime,
};
use pk_modules::audio::Mixer;
use pk_modules::{ImeState, SharedPad, poll_ime, register_builtin};
use pk_platform::{FrameHost, HostEvent, ImeKind, LogLevel, Notify, Platform, Services};
use pk_protocol::events::BUTTON_NAMES;
use pk_protocol::{SCREEN_HEIGHT, SCREEN_WIDTH, StyleTable, TileSet, Value};

/// Root of the app's own files (read-only on the PS5).
const APP: &str = "app0://";
/// Where the dev agent caches reloaded bundles.
#[cfg(feature = "dev")]
const DEV_CACHE: &str = "data://.pk-dev";
const UI_MEMORY: usize = 256 << 20;
const SERVER_MEMORY: usize = 128 << 20;
const WORKERS: usize = 4;
/// How long a reload waits for the old UI runtime to report its route.
#[cfg(feature = "dev")]
const RELOAD_HREF_TIMEOUT_MS: f64 = 500.0;
const SOUND_VOLUME: f32 = 0.6;
const TOAST_MS: f32 = 3000.0;

fn button(name: &str) -> u32 {
    BUTTON_NAMES
        .iter()
        .find(|(n, _)| *n == name)
        .map(|(_, b)| *b)
        .unwrap_or(0)
}

/// `prosperokit.runtime.json` next to `sce_sys/` (written by the CLI).
struct Settings {
    ui_sounds: bool,
}

impl Settings {
    fn load(services: &Services) -> Settings {
        let parsed = services
            .fs
            .read(&format!("{APP}prosperokit.runtime.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok());
        Settings {
            ui_sounds: parsed
                .as_ref()
                .and_then(|j| j["uiSounds"].as_bool())
                .unwrap_or(true),
        }
    }
}

/// One JS runtime and the channel it reports on.
struct JsSide {
    handle: JsHandle,
    out: Receiver<Outbound>,
    registry: Arc<ModuleRegistry>,
}

impl JsSide {
    fn send(&self, msg: Inbound) {
        let _ = self.handle.inbound.send(msg);
    }
}

struct SpawnArgs<'a> {
    kind: RuntimeKind,
    bundle_dir: &'a str,
    entry: String,
    initial_href: Option<String>,
    registry: Arc<ModuleRegistry>,
    services: &'a Services,
    workers: &'a Arc<WorkerPool>,
    dev: Option<DevConfig>,
    app_info: Value,
}

fn spawn_js(args: SpawnArgs<'_>) -> JsSide {
    let (tx, rx) = unbounded();
    let memory_limit = if args.kind == RuntimeKind::Ui {
        UI_MEMORY
    } else {
        SERVER_MEMORY
    };
    let handle = spawn_runtime(
        RuntimeConfig {
            kind: args.kind,
            bundle_dir: args.bundle_dir.to_string(),
            memory_limit,
            dev: args.dev,
            app_info: args.app_info,
        },
        args.registry.clone(),
        args.services.clone(),
        args.workers.clone(),
        tx,
    );
    let _ = handle.inbound.send(Inbound::LoadBundle {
        entry: args.entry,
        initial_href: args.initial_href,
    });
    JsSide {
        handle,
        out: rx,
        registry: args.registry,
    }
}

/// The `MainHost` handed to main-thread native functions.
struct MainCtx<'a> {
    engine: &'a mut Engine,
    host: &'a mut dyn FrameHost,
    services: &'a Services,
    mixer: &'a mut Arc<Mutex<Mixer>>,
    call_id: u64,
}

impl MainHost for MainCtx<'_> {
    fn engine_any(&mut self) -> &mut dyn Any {
        self.engine
    }
    fn frame_host(&mut self) -> &mut dyn FrameHost {
        self.host
    }
    fn services(&self) -> &Services {
        self.services
    }
    fn audio_any(&mut self) -> &mut dyn Any {
        self.mixer
    }
    fn call_id(&self) -> u64 {
        self.call_id
    }
}

/// Desktop only: system notifications also appear as an in-window toast.
struct ToastNotify {
    inner: Arc<dyn Notify>,
    queue: Arc<Mutex<Vec<String>>>,
}

impl Notify for ToastNotify {
    fn notify(&self, message: &str) {
        self.inner.notify(message);
        self.queue.lock().push(message.to_string());
    }
}

/// FNV-1a 64-bit of the loaded `app.js`, lowercase hex: the dev server
/// compares it with its own build to decide whether to send a reload.
#[cfg(feature = "dev")]
fn bundle_hash(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{h:016x}")
}

/// Reads and decodes an image for the engine (worker thread).
fn load_image(services: &Services, bundle_dir: &str, uri: &str) -> Result<DecodedImage, String> {
    let bytes = if uri.starts_with("http://") || uri.starts_with("https://") {
        let res = services
            .http
            .request(pk_platform::HttpRequest {
                url: uri.to_string(),
                ..Default::default()
            })
            .map_err(|e| e.to_string())?;
        if !(200..300).contains(&res.status) {
            return Err(format!("HTTP {} for {uri}", res.status));
        }
        res.body
    } else if uri.starts_with("app0://") || uri.starts_with("data://") {
        services.fs.read(uri).map_err(|e| format!("{uri}: {e}"))?
    } else if let Some(rel) = uri.strip_prefix('/') {
        services
            .fs
            .read(&format!("{bundle_dir}/{rel}"))
            .map_err(|e| format!("{uri}: {e}"))?
    } else {
        services
            .fs
            .read(&format!("{bundle_dir}/{uri}"))
            .map_err(|e| format!("{uri}: {e}"))?
    };
    let img = image::load_from_memory(&bytes)
        .map_err(|e| format!("{uri}: {e}"))?
        .to_rgba8();
    Ok(DecodedImage {
        width: img.width(),
        height: img.height(),
        rgba: img.into_raw(),
    })
}

/// Extra font families from `app0://fonts/*.ttf|otf` (family = file stem).
fn extra_fonts(services: &Services) -> Vec<(String, Vec<u8>)> {
    let Ok(entries) = services.fs.read_dir(&format!("{APP}fonts")) else {
        return Vec::new();
    };
    let mut fonts = Vec::new();
    for e in entries {
        let lower = e.name.to_ascii_lowercase();
        if e.is_dir || !(lower.ends_with(".ttf") || lower.ends_with(".otf")) {
            continue;
        }
        match services.fs.read(&format!("{APP}fonts/{}", e.name)) {
            Ok(bytes) => {
                let family = e
                    .name
                    .rsplit_once('.')
                    .map(|(s, _)| s)
                    .unwrap_or(&e.name)
                    .to_string();
                fonts.push((family, bytes));
            }
            Err(err) => services.warn(format!("font {}: {err}", e.name)),
        }
    }
    fonts
}

fn load_style_table(services: &Services, path: &str) -> Option<StyleTable> {
    let bytes = services.fs.read(path).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    match StyleTable::parse_json(&text) {
        Ok(t) => Some(t),
        Err(e) => {
            services.error(format!("{path}: {e}"));
            None
        }
    }
}

#[cfg(feature = "dev")]
fn png_encode(frame: &[u32]) -> Vec<u8> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, SCREEN_WIDTH, SCREEN_HEIGHT);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        if let Ok(mut w) = enc.write_header() {
            let mut bytes = Vec::with_capacity(frame.len() * 4);
            for px in frame {
                bytes.extend_from_slice(&px.to_le_bytes());
            }
            let _ = w.write_image_data(&bytes);
        }
    }
    out
}

#[derive(Default)]
struct Stats {
    enabled: bool,
    combo_was_down: bool,
    js_commit_ms: f32,
    raster_ms: f32,
    dirty_tiles: u32,
    last_frame_at: f64,
}

#[cfg(feature = "dev")]
struct Dev {
    agent: pk_js::dev::DevAgentHandle,
    events: Receiver<pk_js::dev::DevEvent>,
}

#[cfg(feature = "dev")]
enum Reload {
    Idle,
    /// Waiting for the old UI runtime's route before swapping bundles.
    AwaitingHref {
        deadline_ms: f64,
        styles: Vec<u8>,
    },
}

struct Runtime {
    services: Services,
    engine: Engine,
    frame: Vec<u32>,
    mixer: Arc<Mutex<Mixer>>,
    pad: SharedPad,
    ime: ImeState,
    workers: Arc<WorkerPool>,
    ui: JsSide,
    server: Option<JsSide>,
    #[cfg(feature = "dev")]
    ui_registry: Arc<ModuleRegistry>,
    server_registry: Arc<ModuleRegistry>,
    bundle_dir: String,
    #[cfg(feature = "dev")]
    app_info: Value,
    dev_config: Option<DevConfig>,
    #[cfg(feature = "dev")]
    dev: Option<Dev>,
    #[cfg(feature = "dev")]
    reload: Reload,
    images_tx: Sender<(String, Result<DecodedImage, String>)>,
    images_rx: Receiver<(String, Result<DecodedImage, String>)>,
    toasts: Arc<Mutex<Vec<String>>>,
    audio_started: bool,
    stats: Stats,
    ui_sounds: bool,
}

/// Entry point used by `pk_runtime::run`.
pub fn run(platform: Box<dyn Platform>) -> ! {
    let base = platform.services();
    let info = base.app.info();
    let toasts = Arc::new(Mutex::new(Vec::new()));
    // On the desktop, notifications also show as a toast in the window; the
    // PS5 draws its own system notification.
    let services = if info.platform == "host" {
        Services {
            notify: Arc::new(ToastNotify {
                inner: base.notify.clone(),
                queue: toasts.clone(),
            }),
            ..base.clone()
        }
    } else {
        base.clone()
    };
    let settings = Settings::load(&services);
    let dev_config = dev_config(&services);
    let app_info = Value::obj([
        ("platform", Value::from(info.platform)),
        ("titleId", Value::from(info.title_id.as_str())),
        ("version", Value::from(info.app_version.as_str())),
        ("uptimeMs", Value::from(info.uptime_ms)),
    ]);

    let mut engine = Engine::new(EngineConfig {
        extra_fonts: extra_fonts(&services),
        ui_sounds: settings.ui_sounds,
        dev: dev_config.is_some(),
    });
    let bundle_dir = format!("{APP}www");
    if let Some(table) = load_style_table(&services, &format!("{bundle_dir}/app.styles.json")) {
        engine.set_style_table(table);
    }

    let mixer = Arc::new(Mutex::new(Mixer::new()));
    let pad = SharedPad::new();
    let ime = ImeState::new();
    let workers = Arc::new(WorkerPool::new(WORKERS));

    let registry_for = |kind: RuntimeKind| -> Arc<ModuleRegistry> {
        let mut reg = ModuleRegistry::new();
        register_builtin(
            &mut reg,
            kind,
            &services,
            mixer.clone(),
            pad.clone(),
            ime.clone(),
        );
        #[cfg(feature = "user-modules")]
        pk_user_modules::register_all(&mut reg);
        Arc::new(reg)
    };
    let ui_registry = registry_for(RuntimeKind::Ui);
    let server_registry = registry_for(RuntimeKind::Server);

    let ui = spawn_js(SpawnArgs {
        kind: RuntimeKind::Ui,
        bundle_dir: &bundle_dir,
        entry: format!("{bundle_dir}/app.js"),
        initial_href: None,
        registry: ui_registry.clone(),
        services: &services,
        workers: &workers,
        dev: dev_config.clone(),
        app_info: app_info.clone(),
    });
    // Server functions run in-process in production/preview. In dev they run
    // on the PC (the UI runtime fetches them from the dev server directly).
    let server_entry = format!("{bundle_dir}/server.js");
    let server = (dev_config.is_none() && services.fs.exists(&server_entry)).then(|| {
        spawn_js(SpawnArgs {
            kind: RuntimeKind::Server,
            bundle_dir: &bundle_dir,
            entry: server_entry.clone(),
            initial_href: None,
            registry: server_registry.clone(),
            services: &services,
            workers: &workers,
            dev: None,
            app_info: app_info.clone(),
        })
    });

    #[cfg(feature = "dev")]
    let dev = dev_config.as_ref().map(|cfg| {
        let token = dev_token(&services).unwrap_or_default();
        let hash = services
            .fs
            .read(&format!("{bundle_dir}/app.js"))
            .map(|b| bundle_hash(&b))
            .unwrap_or_default();
        let (tx, rx) = unbounded();
        let agent = pk_js::dev::DevAgent::spawn(
            pk_js::dev::DevAgentConfig {
                host: cfg.host.clone(),
                port: cfg.port,
                token,
                platform: info.platform.to_string(),
                title_id: info.title_id.clone(),
                bundle_cache_dir: DEV_CACHE.to_string(),
                bundle_hash: hash,
            },
            services.clone(),
            tx,
        );
        Dev { agent, events: rx }
    });
    let (images_tx, images_rx) = unbounded();
    let mut rt = Runtime {
        services,
        engine,
        frame: vec![0u32; (SCREEN_WIDTH * SCREEN_HEIGHT) as usize],
        mixer,
        pad,
        ime,
        workers,
        ui,
        server,
        #[cfg(feature = "dev")]
        ui_registry,
        server_registry,
        bundle_dir,
        #[cfg(feature = "dev")]
        app_info,
        dev_config,
        #[cfg(feature = "dev")]
        dev,
        #[cfg(feature = "dev")]
        reload: Reload::Idle,
        images_tx,
        images_rx,
        toasts,
        audio_started: false,
        stats: Stats::default(),
        ui_sounds: settings.ui_sounds,
    };
    platform.run(Box::new(move |host| rt.frame(host)))
}

/// Dev server address: `PK_DEV_SERVER` (`host:port`, set by pk-host from
/// `--dev-server`) or `app0://prosperokit.dev.json` (`{host, port, token}`).
/// Only dev builds connect.
fn dev_config(services: &Services) -> Option<DevConfig> {
    if !cfg!(feature = "dev") {
        return None;
    }
    if let Ok(addr) = std::env::var("PK_DEV_SERVER")
        && let Some((host, port)) = addr.rsplit_once(':')
        && let Ok(port) = port.parse()
    {
        return Some(DevConfig {
            host: host.to_string(),
            port,
        });
    }
    let bytes = services
        .fs
        .read(&format!("{APP}prosperokit.dev.json"))
        .ok()?;
    let json: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    Some(DevConfig {
        host: json["host"].as_str()?.to_string(),
        port: u16::try_from(json["port"].as_u64()?).ok()?,
    })
}

#[cfg(feature = "dev")]
fn dev_token(services: &Services) -> Option<String> {
    if let Ok(t) = std::env::var("PK_DEV_TOKEN") {
        return Some(t);
    }
    let bytes = services
        .fs
        .read(&format!("{APP}prosperokit.dev.json"))
        .ok()?;
    let json: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    json["token"].as_str().map(str::to_string)
}

impl Runtime {
    fn frame(&mut self, host: &mut dyn FrameHost) {
        let now = host.now_ms();

        if !self.audio_started {
            self.audio_started = true;
            let mixer = self.mixer.clone();
            if let Err(e) = host
                .audio()
                .start(Box::new(move |buf| mixer.lock().render(buf)))
            {
                self.services.warn(format!("audio output unavailable: {e}"));
            }
        }

        for ev in host.host_events() {
            match ev {
                HostEvent::CloseRequested => self.shutdown(host),
            }
        }

        let snap = host.pad();
        self.pad.update(snap);
        self.pad.tick_rumble(host.pad_control(), now);
        self.toggle_stats(&snap);

        self.drain_js(host);
        // Still working (rendering, a server function in flight): not settled.
        if self.ui.handle.is_busy() || self.server.as_ref().is_some_and(|s| s.handle.is_busy()) {
            host.js_waiting();
        }
        #[cfg(feature = "dev")]
        self.drain_dev(host, now);
        #[cfg(feature = "dev")]
        self.finish_reload_if_due(now);

        // Keyboard dialogs opened through the `ime.open` module.
        if let Some((id, text)) = poll_ime(&self.ime, host.ime()) {
            self.ui.send(Inbound::NativeReply {
                id,
                result: Ok(text.map(Value::from).unwrap_or(Value::Null)),
            });
        }
        self.update_ime_overlay(host);

        for msg in self.toasts.lock().drain(..) {
            self.engine.toast(&msg, TOAST_MS);
        }
        while let Ok((uri, result)) = self.images_rx.try_recv() {
            self.engine.image_loaded(&uri, result);
        }

        let out = self.engine.tick(&snap, now);
        for e in out.events {
            self.ui.send(Inbound::UiEvent(e));
        }
        for (cb, rect) in out.measures {
            self.ui.send(Inbound::NativeReply {
                id: u64::from(cb),
                result: Ok(rect.to_value()),
            });
        }
        if self.ui_sounds {
            let mut mixer = self.mixer.lock();
            for cue in out.sounds {
                let name = match cue {
                    SoundCue::Navigate => "navigate",
                    SoundCue::Select => "select",
                    SoundCue::Back => "back",
                    SoundCue::Error => "error",
                };
                mixer.play_builtin(name, SOUND_VOLUME);
            }
        }
        for uri in self.engine.take_image_requests() {
            let services = self.services.clone();
            let bundle_dir = self.bundle_dir.clone();
            let tx = self.images_tx.clone();
            self.workers.submit(Box::new(move || {
                let result = load_image(&services, &bundle_dir, &uri);
                let _ = tx.send((uri, result));
            }));
        }

        if self.stats.enabled {
            let frame_ms = (now - self.stats.last_frame_at) as f32;
            self.engine.set_stats_overlay(Some(FrameStats {
                frame_ms,
                raster_ms: self.stats.raster_ms,
                dirty_tiles: self.stats.dirty_tiles,
                js_commit_ms: self.stats.js_commit_ms,
            }));
        }
        self.stats.last_frame_at = now;

        let raster_start = self.services.clock.now_ms();
        let dirty: TileSet = self.engine.render(&mut self.frame);
        self.stats.raster_ms = (self.services.clock.now_ms() - raster_start) as f32;
        self.stats.dirty_tiles = dirty.count();
        host.present(&self.frame, &dirty);
    }

    /// L3 + R3 together toggle the frame stats overlay.
    fn toggle_stats(&mut self, snap: &pk_platform::PadSnapshot) {
        let combo = button("l3") | button("r3");
        let down = !snap.intercepted && snap.buttons & combo == combo;
        if down && !self.stats.combo_was_down {
            self.stats.enabled = !self.stats.enabled;
            if !self.stats.enabled {
                self.engine.set_stats_overlay(None);
            }
        }
        self.stats.combo_was_down = down;
    }

    fn update_ime_overlay(&mut self, host: &mut dyn FrameHost) {
        let live = host.ime().live_text();
        let overlay = match (live, self.ime.pending_request()) {
            (Some(text), Some(req)) => Some(ImeOverlay {
                title: req.title,
                text,
                placeholder: req.placeholder,
                secure: req.kind == ImeKind::Password,
            }),
            (Some(text), None) => Some(ImeOverlay {
                title: String::new(),
                text,
                placeholder: String::new(),
                secure: false,
            }),
            _ => None,
        };
        self.engine.set_ime_overlay(overlay);
    }

    fn drain_js(&mut self, host: &mut dyn FrameHost) {
        while let Ok(msg) = self.ui.out.try_recv() {
            self.on_ui_message(host, msg);
        }
        let server_msgs: Vec<Outbound> = match &self.server {
            Some(s) => s.out.try_iter().collect(),
            None => Vec::new(),
        };
        for msg in server_msgs {
            self.on_server_message(host, msg);
        }
    }

    fn on_ui_message(&mut self, host: &mut dyn FrameHost, msg: Outbound) {
        if !matches!(msg, Outbound::Log { .. }) {
            host.js_activity();
        }
        match msg {
            Outbound::Commit {
                ops,
                warnings,
                commit_ms,
            } => {
                self.stats.js_commit_ms = commit_ms;
                let mut all = warnings;
                all.extend(self.engine.apply_commit(&ops));
                if self.dev_config.is_some() {
                    for w in all {
                        self.services.warn(format!("[commit] {w}"));
                    }
                }
            }
            Outbound::MainCall {
                id,
                module,
                func,
                args,
            } => {
                let registry = self.ui.registry.clone();
                if let Some(result) = self.call_main(host, &registry, id, &module, &func, args) {
                    self.ui.send(Inbound::NativeReply { id, result });
                }
            }
            Outbound::ServerRequest {
                id,
                url,
                method,
                headers,
                body,
            } => match &self.server {
                Some(server) => server.send(Inbound::ServerRequest {
                    id,
                    url,
                    method,
                    headers,
                    body,
                }),
                None => {
                    let body = br#"{"error":"no server bundle in this build"}"#.to_vec();
                    self.ui.send(Inbound::ServerResponse {
                        id,
                        status: 503,
                        headers: vec![("content-type".into(), "application/json".into())],
                        body,
                    });
                }
            },
            Outbound::ServerResponse { .. } => {}
            Outbound::Log { level, msg } => self.forward_log(level, &msg),
            Outbound::Error { message, stack } => {
                if self.dev_config.is_some() {
                    let text = match &stack {
                        Some(s) if !s.is_empty() => format!("{message}\n{s}"),
                        _ => message.clone(),
                    };
                    self.engine.set_error_overlay(Some(text));
                }
                self.forward_error(&message, stack.as_deref());
            }
            #[cfg(feature = "dev")]
            Outbound::PrepareReloadResult { href } => {
                if let Reload::AwaitingHref { styles, .. } =
                    std::mem::replace(&mut self.reload, Reload::Idle)
                {
                    self.swap_bundle(Some(href), styles);
                }
            }
            #[cfg(not(feature = "dev"))]
            Outbound::PrepareReloadResult { .. } => {}
            Outbound::Exit { code } => {
                self.services.info(format!("app requested exit ({code})"));
                self.shutdown(host);
            }
            Outbound::Loaded { ok, error } => {
                if ok {
                    if self.dev_config.is_some() {
                        self.engine.set_error_overlay(None);
                    }
                } else {
                    // A bundle that cannot start is shown in every build:
                    // otherwise the user only sees an empty screen.
                    let text = format!("The app failed to start:\n{}", error.unwrap_or_default());
                    self.services.error(&text);
                    self.engine.set_error_overlay(Some(text));
                }
            }
        }
    }

    fn on_server_message(&mut self, host: &mut dyn FrameHost, msg: Outbound) {
        match msg {
            Outbound::ServerResponse {
                id,
                status,
                headers,
                body,
            } => {
                self.ui.send(Inbound::ServerResponse {
                    id,
                    status,
                    headers,
                    body,
                });
            }
            Outbound::MainCall {
                id,
                module,
                func,
                args,
            } => {
                let registry = self.server_registry.clone();
                let result = self.call_main(host, &registry, id, &module, &func, args);
                if let (Some(result), Some(server)) = (result, &self.server) {
                    server.send(Inbound::NativeReply { id, result });
                }
            }
            Outbound::Log { level, msg } => self.forward_log(level, &format!("[server] {msg}")),
            Outbound::Error { message, stack } => {
                self.forward_error(&format!("[server] {message}"), stack.as_deref())
            }
            Outbound::Loaded { ok: false, error } => {
                self.services.error(format!(
                    "server bundle failed to load: {}",
                    error.unwrap_or_default()
                ));
            }
            Outbound::Exit { .. }
            | Outbound::Loaded { .. }
            | Outbound::Commit { .. }
            | Outbound::ServerRequest { .. }
            | Outbound::PrepareReloadResult { .. } => {}
        }
    }

    /// Runs a main-thread native function. `None` = the function deferred its
    /// reply (it answers later, e.g. the keyboard dialog).
    fn call_main(
        &mut self,
        host: &mut dyn FrameHost,
        registry: &ModuleRegistry,
        id: u64,
        module: &str,
        func: &str,
        args: Value,
    ) -> Option<Result<Value, NativeError>> {
        let mut ctx = MainCtx {
            engine: &mut self.engine,
            host,
            services: &self.services,
            mixer: &mut self.mixer,
            call_id: id,
        };
        let result = registry.call_main(&mut ctx, module, func, args);
        match &result {
            Ok(v) if is_deferred(v) => None,
            _ => Some(result),
        }
    }

    #[cfg_attr(not(feature = "dev"), allow(unused_variables))]
    fn forward_log(&self, level: LogLevel, msg: &str) {
        #[cfg(feature = "dev")]
        if let Some(dev) = &self.dev {
            dev.agent.send_log(level, msg);
        }
    }

    #[cfg_attr(not(feature = "dev"), allow(unused_variables))]
    fn forward_error(&self, message: &str, stack: Option<&str>) {
        #[cfg(feature = "dev")]
        if let Some(dev) = &self.dev {
            dev.agent.send_error(message, stack);
        }
    }

    #[cfg(feature = "dev")]
    fn drain_dev(&mut self, host: &mut dyn FrameHost, now: f64) {
        use pk_js::dev::DevEvent;
        let events: Vec<DevEvent> = match &self.dev {
            Some(dev) => dev.events.try_iter().collect(),
            None => return,
        };
        for ev in events {
            match ev {
                DevEvent::Reload {
                    styles_json, hash, ..
                } => {
                    self.services.info(format!("[dev] reloading bundle {hash}"));
                    self.ui.send(Inbound::PrepareReload);
                    self.reload = Reload::AwaitingHref {
                        deadline_ms: now + RELOAD_HREF_TIMEOUT_MS,
                        styles: styles_json,
                    };
                }
                DevEvent::NativeCall {
                    id,
                    module,
                    func,
                    args,
                } => self.dev_native_call(host, id, module, func, args),
                DevEvent::Screenshot { id } => {
                    if let Some(dev) = &self.dev {
                        dev.agent.send_screenshot(id, png_encode(&self.frame));
                    }
                }
                DevEvent::Connected => self.services.info("[dev] connected to the dev server"),
                DevEvent::Disconnected => self.services.warn("[dev] lost the dev server; retrying"),
            }
        }
    }

    /// A native call from server functions running on the PC.
    #[cfg(feature = "dev")]
    fn dev_native_call(
        &mut self,
        host: &mut dyn FrameHost,
        id: u64,
        module: String,
        func: String,
        args: Value,
    ) {
        use pk_js::CallKind;
        let registry = self.server_registry.clone();
        let reply = |rt: &Runtime, result: Result<Value, NativeError>| {
            if let Some(dev) = &rt.dev {
                dev.agent.reply_native(id, result);
            }
        };
        match registry.has(&module, &func) {
            None => reply(self, Err(NativeError::enosys(&module, &func))),
            Some(CallKind::Sync) => {
                let r = registry.call_sync(&module, &func, args);
                reply(self, r);
            }
            Some(CallKind::Async) => {
                let Some(agent) = self.dev.as_ref().map(|d| d.agent.clone()) else {
                    return;
                };
                self.workers.submit(Box::new(move || {
                    let r = registry.call_async_blocking(&module, &func, args);
                    agent.reply_native(id, r);
                }));
            }
            Some(CallKind::Main) => {
                if let Some(r) = self.call_main(host, &registry, id, &module, &func, args) {
                    reply(self, r);
                }
            }
        }
    }

    #[cfg(feature = "dev")]
    fn finish_reload_if_due(&mut self, now: f64) {
        let due =
            matches!(&self.reload, Reload::AwaitingHref { deadline_ms, .. } if now >= *deadline_ms);
        if due
            && let Reload::AwaitingHref { styles, .. } =
                std::mem::replace(&mut self.reload, Reload::Idle)
        {
            self.services
                .warn("[dev] the old bundle did not report its route; reloading at /");
            self.swap_bundle(None, styles);
        }
    }

    /// Replaces the UI runtime with one running the dev cache's bundle.
    #[cfg(feature = "dev")]
    fn swap_bundle(&mut self, href: Option<String>, styles: Vec<u8>) {
        self.bundle_dir = DEV_CACHE.to_string();
        let new_ui = spawn_js(SpawnArgs {
            kind: RuntimeKind::Ui,
            bundle_dir: &self.bundle_dir,
            entry: format!("{DEV_CACHE}/app.js"),
            initial_href: href,
            registry: self.ui_registry.clone(),
            services: &self.services,
            workers: &self.workers,
            dev: self.dev_config.clone(),
            app_info: self.app_info.clone(),
        });
        let old = std::mem::replace(&mut self.ui, new_ui);
        old.send(Inbound::Shutdown);
        // The old thread exits on its own; never block the frame on it.
        drop(old);
        self.engine.reset();
        self.engine.set_error_overlay(None);
        match StyleTable::parse_json(&String::from_utf8_lossy(&styles)) {
            Ok(table) => self.engine.set_style_table(table),
            Err(e) => self.services.error(format!("[dev] app.styles.json: {e}")),
        }
    }

    fn shutdown(&mut self, host: &mut dyn FrameHost) {
        self.ui.send(Inbound::Shutdown);
        if let Some(server) = &self.server {
            server.send(Inbound::Shutdown);
        }
        host.request_exit();
    }
}

#[cfg(all(test, feature = "dev"))]
mod tests {
    use super::*;

    #[test]
    fn bundle_hash_is_fnv1a64_hex() {
        assert_eq!(bundle_hash(b""), "cbf29ce484222325");
        assert_eq!(bundle_hash(b"a"), "af63dc4c8601ec8c");
    }
}
