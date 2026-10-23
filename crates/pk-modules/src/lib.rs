//! ProsperoKit built-in native modules (plan Phase 4 §5): `app`, `notify`,
//! `ime`, `pad`, `audio`, `fs`, `system`, `http`, `log`.

pub mod audio;

use std::sync::Arc;

use parking_lot::Mutex;
use pk_js::{AsyncFn, MainFn, ModuleRegistry, NativeError, RuntimeKind, SyncFn, deferred};
use pk_platform::{
    HttpRequest, Ime, ImeKind, ImePoll, ImeRequest, LogLevel, PadControl, PadSnapshot, Services,
};
use pk_protocol::Value;

use audio::Mixer;

/// The controller state shared between the main loop (writer) and the
/// `pad.*` functions, plus the pending rumble deadline.
#[derive(Clone, Default)]
pub struct SharedPad(Arc<Mutex<PadInner>>);

#[derive(Default)]
struct PadInner {
    snap: PadSnapshot,
    /// Monotonic ms at which the motors must be zeroed.
    rumble_deadline: Option<f64>,
}

impl SharedPad {
    pub fn new() -> SharedPad {
        SharedPad::default()
    }

    /// Called by the main loop every frame with the latest snapshot.
    pub fn update(&self, snap: PadSnapshot) {
        self.0.lock().snap = snap;
    }

    pub fn snapshot(&self) -> PadSnapshot {
        self.0.lock().snap
    }

    /// Zeroes the motors once a `pad.vibrate` duration has elapsed. Call
    /// once per frame.
    pub fn tick_rumble(&self, pad: &mut dyn PadControl, now_ms: f64) {
        let mut inner = self.0.lock();
        if inner.rumble_deadline.is_some_and(|d| now_ms >= d) {
            inner.rumble_deadline = None;
            pad.vibrate(0, 0);
        }
    }
}

/// The call id of the in-flight `ime.open`, if any.
#[derive(Clone, Default)]
pub struct ImeState(Arc<Mutex<Option<(u64, ImeRequest)>>>);

impl ImeState {
    pub fn new() -> ImeState {
        ImeState::default()
    }

    pub fn pending(&self) -> Option<u64> {
        self.0.lock().as_ref().map(|(id, _)| *id)
    }

    /// The request of the in-flight dialog (for drawing a host overlay).
    pub fn pending_request(&self) -> Option<ImeRequest> {
        self.0.lock().as_ref().map(|(_, r)| r.clone())
    }
}

/// Polls the system dialog; when it has closed, returns the pending call id
/// and its result (`None` = cancelled) so the caller can send the
/// `NativeReply` (`Some(text)` → string, `None` → null).
pub fn poll_ime(state: &ImeState, ime: &mut dyn Ime) -> Option<(u64, Option<String>)> {
    let mut pending = state.0.lock();
    let id = pending.as_ref().map(|(id, _)| *id)?;
    match ime.poll() {
        ImePoll::Done(text) => {
            *pending = None;
            Some((id, text))
        }
        ImePoll::Open => None,
        // The dialog vanished without a result: treat as cancelled.
        ImePoll::Closed => {
            *pending = None;
            Some((id, None))
        }
    }
}

fn str_arg<'a>(args: &'a Value, key: &str) -> Result<&'a str, NativeError> {
    args.get_str(key)
        .ok_or_else(|| NativeError::invalid(format!("`{key}` must be a string")))
}

fn num_arg(args: &Value, key: &str) -> Result<f64, NativeError> {
    args.get_f64(key)
        .ok_or_else(|| NativeError::invalid(format!("`{key}` must be a number")))
}

fn u8_arg(args: &Value, key: &str) -> Result<u8, NativeError> {
    Ok(num_arg(args, key)?.clamp(0.0, 255.0) as u8)
}

/// Accepts `{ name: value }` or `[[name, value], …]` (also `[{name, value}]`).
pub fn parse_headers(v: Option<&Value>) -> Result<Vec<(String, String)>, NativeError> {
    let bad =
        || NativeError::invalid("`headers` must be an object or an array of [name, value] pairs");
    let text = |v: &Value| match v {
        Value::Str(s) => Some(s.clone()),
        Value::Num(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    };
    match v {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Obj(entries)) => entries
            .iter()
            .map(|(k, v)| Ok((k.clone(), text(v).ok_or_else(bad)?)))
            .collect(),
        Some(Value::Arr(items)) => items
            .iter()
            .map(|item| match item {
                Value::Arr(pair) if pair.len() == 2 => Ok((
                    text(&pair[0]).ok_or_else(bad)?,
                    text(&pair[1]).ok_or_else(bad)?,
                )),
                Value::Obj(_) => {
                    let name = item.get("name").and_then(text).ok_or_else(bad)?;
                    let value = item.get("value").and_then(text).ok_or_else(bad)?;
                    Ok((name, value))
                }
                _ => Err(bad()),
            })
            .collect(),
        Some(_) => Err(bad()),
    }
}

fn sync(f: impl Fn(Value) -> Result<Value, NativeError> + Send + Sync + 'static) -> SyncFn {
    Arc::new(f)
}

fn asyn(f: impl Fn(Value) -> Result<Value, NativeError> + Send + Sync + 'static) -> AsyncFn {
    Arc::new(f)
}

fn main_fn(
    f: impl Fn(&mut dyn pk_js::MainHost, Value) -> Result<Value, NativeError> + Send + Sync + 'static,
) -> MainFn {
    Arc::new(f)
}

/// Registers every built-in module for `kind` (the table in plan Phase 4 §5).
pub fn register_builtin(
    reg: &mut ModuleRegistry,
    kind: RuntimeKind,
    services: &Services,
    audio: Arc<Mutex<Mixer>>,
    pad: SharedPad,
    ime: ImeState,
) {
    let ui = kind == RuntimeKind::Ui;

    // --- app / system / log / notify: both runtimes -----------------------
    let s = services.clone();
    reg.add_sync(
        "app",
        "info",
        sync(move |_| {
            let i = s.app.info();
            Ok(Value::obj([
                ("platform", Value::from(i.platform)),
                ("titleId", Value::from(i.title_id)),
                ("version", Value::from(i.app_version)),
                ("uptimeMs", Value::from(i.uptime_ms)),
            ]))
        }),
    );
    let s = services.clone();
    reg.add_sync(
        "system",
        "info",
        sync(move |_| {
            let i = s.app.info();
            Ok(Value::obj([
                ("platform", Value::from(i.platform)),
                ("titleId", Value::from(i.title_id)),
                ("appName", Value::from(i.app_name)),
                ("appVersion", Value::from(i.app_version)),
                ("uptimeMs", Value::from(i.uptime_ms)),
            ]))
        }),
    );
    let s = services.clone();
    reg.add_sync(
        "log",
        "write",
        sync(move |args| {
            let level = LogLevel::parse(args.get_str("level").unwrap_or("info"));
            s.log.log(level, str_arg(&args, "msg")?);
            Ok(Value::Null)
        }),
    );
    reg.add_main(
        "app",
        "exit",
        main_fn(|host, _| {
            let app = host.services().app.clone();
            app.exit()
        }),
    );
    reg.add_main(
        "notify",
        "show",
        main_fn(|host, args| {
            host.services().notify.notify(str_arg(&args, "message")?);
            Ok(Value::Null)
        }),
    );

    // --- http: both runtimes ----------------------------------------------
    let s = services.clone();
    reg.add_async(
        "http",
        "request",
        asyn(move |args| {
            let body = match args.get("body") {
                None | Some(Value::Null) => None,
                Some(Value::Str(t)) => Some(t.clone().into_bytes()),
                Some(Value::Bytes(b)) => Some(b.clone()),
                Some(_) => {
                    return Err(NativeError::invalid(
                        "`body` must be a string or Uint8Array",
                    ));
                }
            };
            let req = HttpRequest {
                url: str_arg(&args, "url")?.to_string(),
                method: args.get_str("method").unwrap_or("GET").to_ascii_uppercase(),
                headers: parse_headers(args.get("headers"))?,
                body,
                timeout_ms: args
                    .get_f64("timeoutMs")
                    .map_or(30_000, |t| t.clamp(1.0, u32::MAX as f64) as u32),
                follow_redirects: true,
            };
            let res = s.http.request(req)?;
            // Repeated headers are folded with ", " like fetch() does.
            let mut headers: Vec<(String, Value)> = Vec::new();
            for (k, v) in res.headers {
                match headers
                    .iter_mut()
                    .find(|(hk, _)| hk.eq_ignore_ascii_case(&k))
                {
                    Some((_, Value::Str(existing))) => {
                        existing.push_str(", ");
                        existing.push_str(&v);
                    }
                    _ => headers.push((k, Value::Str(v))),
                }
            }
            Ok(Value::obj([
                ("status", Value::from(res.status as u32)),
                ("headers", Value::Obj(headers)),
                ("body", Value::Bytes(res.body)),
            ]))
        }),
    );

    // --- audio: both runtimes, main thread ---------------------------------
    let (mixer, s) = (audio.clone(), services.clone());
    reg.add_main(
        "audio",
        "load",
        main_fn(move |_, args| {
            let uri = str_arg(&args, "uri")?;
            let bytes = s.fs.read(uri)?;
            let (id, duration_ms) = mixer.lock().load_wav(&bytes)?;
            Ok(Value::obj([
                ("id", Value::from(id)),
                ("durationMs", Value::from(duration_ms)),
            ]))
        }),
    );
    let mixer = audio.clone();
    reg.add_main(
        "audio",
        "play",
        main_fn(move |_, args| {
            let id = num_arg(&args, "id")? as u32;
            let volume = args.get_f64("volume").unwrap_or(1.0) as f32;
            let looping = args.get_bool("loop").unwrap_or(false);
            let voice = mixer.lock().play(id, volume, looping)?;
            Ok(Value::obj([("voice", Value::from(voice))]))
        }),
    );
    let mixer = audio.clone();
    reg.add_main(
        "audio",
        "stop",
        main_fn(move |_, args| {
            mixer.lock().stop(num_arg(&args, "voice")? as u32);
            Ok(Value::Null)
        }),
    );
    let mixer = audio.clone();
    reg.add_main(
        "audio",
        "setVolume",
        main_fn(move |_, args| {
            mixer.lock().set_volume(
                num_arg(&args, "voice")? as u32,
                num_arg(&args, "volume")? as f32,
            );
            Ok(Value::Null)
        }),
    );
    let mixer = audio;
    reg.add_main(
        "audio",
        "playBuiltin",
        main_fn(move |_, args| {
            let name = str_arg(&args, "name")?;
            let volume = args.get_f64("volume").unwrap_or(1.0) as f32;
            mixer
                .lock()
                .play_builtin(name, volume)
                .ok_or_else(|| NativeError::invalid(format!("unknown built-in sound `{name}`")))?;
            Ok(Value::Null)
        }),
    );

    if ui {
        // --- ime ------------------------------------------------------------
        reg.add_main(
            "ime",
            "open",
            main_fn(move |host, args| {
                if ime.pending().is_some() {
                    return Err(NativeError::new("EBUSY", "an IME dialog is already open"));
                }
                let kind = match args.get_str("kind").unwrap_or("text") {
                    "number" => ImeKind::Number,
                    "url" => ImeKind::Url,
                    "email" => ImeKind::Email,
                    "password" => ImeKind::Password,
                    _ => ImeKind::Text,
                };
                let req = ImeRequest {
                    title: args.get_str("title").unwrap_or("").to_string(),
                    placeholder: args.get_str("placeholder").unwrap_or("").to_string(),
                    initial: args.get_str("initial").unwrap_or("").to_string(),
                    max_len: args
                        .get_f64("maxLength")
                        .map_or(256, |n| n.clamp(1.0, 512.0) as u32),
                    kind,
                };
                let call_id = host.call_id();
                host.frame_host().ime().open(req.clone())?;
                *ime.0.lock() = Some((call_id, req));
                Ok(deferred())
            }),
        );

        // --- pad ------------------------------------------------------------
        reg.add_main(
            "pad",
            "setLightBar",
            main_fn(|host, args| {
                let (r, g, b) = (
                    u8_arg(&args, "r")?,
                    u8_arg(&args, "g")?,
                    u8_arg(&args, "b")?,
                );
                host.frame_host().pad_control().set_light_bar(r, g, b);
                Ok(Value::Null)
            }),
        );
        let p = pad.clone();
        reg.add_main(
            "pad",
            "vibrate",
            main_fn(move |host, args| {
                let (large, small) = (u8_arg(&args, "large")?, u8_arg(&args, "small")?);
                let duration = num_arg(&args, "durationMs")?.max(0.0);
                let fh = host.frame_host();
                fh.pad_control().vibrate(large, small);
                let now = fh.now_ms();
                p.0.lock().rumble_deadline = Some(now + duration);
                Ok(Value::Null)
            }),
        );
        reg.add_sync(
            "pad",
            "state",
            sync(move |_| {
                let s = pad.snapshot();
                Ok(Value::obj([
                    ("buttons", Value::from(s.buttons)),
                    ("lx", Value::from(s.lx as i32)),
                    ("ly", Value::from(s.ly as i32)),
                    ("rx", Value::from(s.rx as i32)),
                    ("ry", Value::from(s.ry as i32)),
                    (
                        "touch",
                        s.touch.map_or(Value::Null, |(x, y)| {
                            Value::arr([Value::from(x), Value::from(y)])
                        }),
                    ),
                    ("intercepted", Value::Bool(s.intercepted)),
                    ("connected", Value::Bool(s.connected)),
                ]))
            }),
        );
    } else {
        register_fs(reg, services);
    }
}

fn register_fs(reg: &mut ModuleRegistry, services: &Services) {
    let s = services.clone();
    reg.add_async(
        "fs",
        "readFile",
        asyn(move |args| {
            let bytes = s.fs.read(str_arg(&args, "path")?)?;
            match args.get_str("encoding") {
                None => Ok(Value::Bytes(bytes)),
                Some("utf8" | "utf-8") => {
                    Ok(Value::Str(String::from_utf8_lossy(&bytes).into_owned()))
                }
                Some(other) => Err(NativeError::invalid(format!(
                    "unsupported encoding `{other}`"
                ))),
            }
        }),
    );
    let s = services.clone();
    reg.add_async(
        "fs",
        "writeFile",
        asyn(move |args| {
            let path = str_arg(&args, "path")?;
            match args.get("data") {
                Some(Value::Bytes(b)) => s.fs.write(path, b)?,
                Some(Value::Str(t)) => s.fs.write(path, t.as_bytes())?,
                _ => {
                    return Err(NativeError::invalid(
                        "`data` must be a string or Uint8Array",
                    ));
                }
            }
            Ok(Value::Null)
        }),
    );
    let s = services.clone();
    reg.add_async(
        "fs",
        "readDir",
        asyn(move |args| {
            let entries = s.fs.read_dir(str_arg(&args, "path")?)?;
            Ok(Value::arr(entries.into_iter().map(|e| {
                Value::obj([
                    ("name", Value::from(e.name)),
                    ("isDir", Value::Bool(e.is_dir)),
                    ("size", Value::from(e.size)),
                    ("mtimeMs", Value::from(e.mtime_ms)),
                ])
            })))
        }),
    );
    let s = services.clone();
    reg.add_async(
        "fs",
        "stat",
        asyn(move |args| {
            let st = s.fs.stat(str_arg(&args, "path")?)?;
            Ok(Value::obj([
                ("isDir", Value::Bool(st.is_dir)),
                ("size", Value::from(st.size)),
                ("mtimeMs", Value::from(st.mtime_ms)),
            ]))
        }),
    );
    let s = services.clone();
    reg.add_async(
        "fs",
        "mkdir",
        asyn(move |args| {
            s.fs.mkdir_all(str_arg(&args, "path")?)?;
            Ok(Value::Null)
        }),
    );
    let s = services.clone();
    reg.add_async(
        "fs",
        "remove",
        asyn(move |args| {
            s.fs.remove(str_arg(&args, "path")?)?;
            Ok(Value::Null)
        }),
    );
    let s = services.clone();
    reg.add_async(
        "fs",
        "rename",
        asyn(move |args| {
            s.fs.rename(str_arg(&args, "from")?, str_arg(&args, "to")?)?;
            Ok(Value::Null)
        }),
    );
    let s = services.clone();
    reg.add_async(
        "fs",
        "exists",
        asyn(move |args| Ok(Value::Bool(s.fs.exists(str_arg(&args, "path")?)))),
    );
}

#[cfg(test)]
mod tests;
