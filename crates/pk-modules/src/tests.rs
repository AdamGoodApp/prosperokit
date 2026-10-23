use std::any::Any;

use pk_js::testing::test_services;
use pk_js::{CallKind, MainHost, is_deferred};
use pk_platform::{FrameHost, Fs, PadControl, PlatformError};
use pk_protocol::TileSet;

use super::*;

#[derive(Default)]
struct FakePad {
    calls: Vec<(u8, u8)>,
    light: Option<(u8, u8, u8)>,
}

impl PadControl for FakePad {
    fn set_light_bar(&mut self, r: u8, g: u8, b: u8) {
        self.light = Some((r, g, b));
    }
    fn vibrate(&mut self, large: u8, small: u8) {
        self.calls.push((large, small));
    }
}

#[derive(Default)]
struct FakeIme {
    open: bool,
    result: Option<Option<String>>,
    last: Option<ImeRequest>,
}

impl Ime for FakeIme {
    fn open(&mut self, req: ImeRequest) -> Result<(), PlatformError> {
        if self.open {
            return Err(PlatformError::Busy);
        }
        self.open = true;
        self.last = Some(req);
        Ok(())
    }
    fn poll(&mut self) -> ImePoll {
        if !self.open {
            return ImePoll::Closed;
        }
        match self.result.take() {
            Some(r) => {
                self.open = false;
                ImePoll::Done(r)
            }
            None => ImePoll::Open,
        }
    }
}

#[derive(Default)]
struct FakeAudio;
impl pk_platform::AudioOut for FakeAudio {
    fn start(&mut self, _: Box<dyn FnMut(&mut [i16]) + Send>) -> Result<(), PlatformError> {
        Ok(())
    }
    fn is_running(&self) -> bool {
        false
    }
}

#[derive(Default)]
struct FakeFrame {
    pad: FakePad,
    ime: FakeIme,
    audio: FakeAudio,
    now: f64,
}

impl FrameHost for FakeFrame {
    fn pad(&mut self) -> PadSnapshot {
        PadSnapshot::default()
    }
    fn present(&mut self, _: &[u32], _: &TileSet) {}
    fn now_ms(&self) -> f64 {
        self.now
    }
    fn pad_control(&mut self) -> &mut dyn PadControl {
        &mut self.pad
    }
    fn ime(&mut self) -> &mut dyn Ime {
        &mut self.ime
    }
    fn audio(&mut self) -> &mut dyn pk_platform::AudioOut {
        &mut self.audio
    }
    fn request_exit(&mut self) {}
}

struct FakeHost {
    frame: FakeFrame,
    services: Services,
    call_id: u64,
    unit: (),
}

impl MainHost for FakeHost {
    fn engine_any(&mut self) -> &mut dyn Any {
        &mut self.unit
    }
    fn frame_host(&mut self) -> &mut dyn FrameHost {
        &mut self.frame
    }
    fn services(&self) -> &Services {
        &self.services
    }
    fn audio_any(&mut self) -> &mut dyn Any {
        &mut self.unit
    }
    fn call_id(&self) -> u64 {
        self.call_id
    }
}

fn setup(
    kind: RuntimeKind,
) -> (
    ModuleRegistry,
    pk_js::testing::TestServices,
    SharedPad,
    ImeState,
    Arc<Mutex<Mixer>>,
) {
    let ts = test_services();
    let mut reg = ModuleRegistry::new();
    let (pad, ime, mixer) = (
        SharedPad::new(),
        ImeState::new(),
        Arc::new(Mutex::new(Mixer::new())),
    );
    register_builtin(
        &mut reg,
        kind,
        &ts.services,
        mixer.clone(),
        pad.clone(),
        ime.clone(),
    );
    (reg, ts, pad, ime, mixer)
}

fn host(ts: &pk_js::testing::TestServices, call_id: u64) -> FakeHost {
    FakeHost {
        frame: FakeFrame::default(),
        services: ts.services.clone(),
        call_id,
        unit: (),
    }
}

#[test]
fn registration_matches_the_table() {
    use CallKind::*;
    let (ui, ..) = setup(RuntimeKind::Ui);
    let (server, ..) = setup(RuntimeKind::Server);
    let both: &[(&str, &str, CallKind)] = &[
        ("app", "info", Sync),
        ("app", "exit", Main),
        ("notify", "show", Main),
        ("audio", "load", Main),
        ("audio", "play", Main),
        ("audio", "stop", Main),
        ("audio", "setVolume", Main),
        ("audio", "playBuiltin", Main),
        ("system", "info", Sync),
        ("http", "request", Async),
        ("log", "write", Sync),
    ];
    for (m, f, k) in both {
        assert_eq!(ui.has(m, f), Some(*k), "ui {m}.{f}");
        assert_eq!(server.has(m, f), Some(*k), "server {m}.{f}");
    }
    let ui_only: &[(&str, &str, CallKind)] = &[
        ("ime", "open", Main),
        ("pad", "setLightBar", Main),
        ("pad", "vibrate", Main),
        ("pad", "state", Sync),
    ];
    for (m, f, k) in ui_only {
        assert_eq!(ui.has(m, f), Some(*k), "ui {m}.{f}");
        assert_eq!(server.has(m, f), None, "server {m}.{f}");
    }
    for f in [
        "readFile",
        "writeFile",
        "readDir",
        "stat",
        "mkdir",
        "remove",
        "rename",
        "exists",
    ] {
        assert_eq!(server.has("fs", f), Some(Async), "server fs.{f}");
        assert_eq!(ui.has("fs", f), None, "ui fs.{f}");
    }
}

#[test]
fn info_shapes() {
    let (reg, ..) = setup(RuntimeKind::Ui);
    let app = reg.call_sync("app", "info", Value::Null).unwrap();
    assert_eq!(app.get_str("platform"), Some("host"));
    assert_eq!(app.get_str("titleId"), Some("PPSA00000"));
    assert_eq!(app.get_str("version"), Some("1.0.0"));
    assert_eq!(app.get_f64("uptimeMs"), Some(42.0));
    let sys = reg.call_sync("system", "info", Value::Null).unwrap();
    assert_eq!(sys.get_str("appName"), Some("Test"));
    assert_eq!(sys.get_str("appVersion"), Some("1.0.0"));
}

#[test]
fn fs_round_trip() {
    let (reg, ts, ..) = setup(RuntimeKind::Server);
    let call = |f: &str, args: Value| reg.call_async_blocking("fs", f, args);
    let p = |path: &str| Value::obj([("path", Value::from(path))]);
    call(
        "writeFile",
        Value::obj([
            ("path", Value::from("data://a/x.txt")),
            ("data", Value::from("héllo")),
        ]),
    )
    .unwrap();
    call(
        "writeFile",
        Value::obj([
            ("path", Value::from("data://a/y.bin")),
            ("data", Value::Bytes(vec![1, 2, 3])),
        ]),
    )
    .unwrap();
    assert_eq!(ts.fs.read("data://a/x.txt").unwrap(), "héllo".as_bytes());
    assert_eq!(
        call("readFile", p("data://a/y.bin")).unwrap(),
        Value::Bytes(vec![1, 2, 3])
    );
    let text = call(
        "readFile",
        Value::obj([
            ("path", Value::from("data://a/x.txt")),
            ("encoding", Value::from("utf8")),
        ]),
    )
    .unwrap();
    assert_eq!(text, Value::from("héllo"));
    assert_eq!(
        call("exists", p("data://a/x.txt")).unwrap(),
        Value::Bool(true)
    );
    let st = call("stat", p("data://a/y.bin")).unwrap();
    assert_eq!(st.get_f64("size"), Some(3.0));
    assert_eq!(st.get_bool("isDir"), Some(false));
    let dir = call("readDir", p("data://a")).unwrap();
    assert_eq!(dir.as_arr().unwrap().len(), 2);
    assert_eq!(dir.at(0).unwrap().get_str("name"), Some("x.txt"));
    call(
        "rename",
        Value::obj([
            ("from", Value::from("data://a/x.txt")),
            ("to", Value::from("data://a/z.txt")),
        ]),
    )
    .unwrap();
    assert_eq!(
        call("exists", p("data://a/x.txt")).unwrap(),
        Value::Bool(false)
    );
    call("remove", p("data://a/z.txt")).unwrap();
    call("mkdir", p("data://b")).unwrap();
    assert_eq!(
        call("readFile", p("data://a/z.txt")).unwrap_err().code,
        "ENOENT"
    );
    assert_eq!(
        call("readFile", Value::Obj(vec![])).unwrap_err().code,
        "EINVAL"
    );
}

#[test]
fn http_header_shapes_and_bodies() {
    let h = parse_headers(Some(&Value::obj([("a", Value::from("1"))]))).unwrap();
    assert_eq!(h, vec![("a".to_string(), "1".to_string())]);
    let pairs = Value::arr([
        Value::arr([Value::from("b"), Value::from("2")]),
        Value::obj([("name", Value::from("c")), ("value", Value::from("3"))]),
    ]);
    let h = parse_headers(Some(&pairs)).unwrap();
    assert_eq!(
        h,
        vec![
            ("b".to_string(), "2".to_string()),
            ("c".to_string(), "3".to_string())
        ]
    );
    assert!(parse_headers(None).unwrap().is_empty());
    assert_eq!(
        parse_headers(Some(&Value::from("x"))).unwrap_err().code,
        "EINVAL"
    );
    assert_eq!(
        parse_headers(Some(&Value::arr([Value::from("x")])))
            .unwrap_err()
            .code,
        "EINVAL"
    );

    let (reg, ..) = setup(RuntimeKind::Ui);
    let call = |body: Value, headers: Value| {
        reg.call_async_blocking(
            "http",
            "request",
            Value::obj([
                ("url", Value::from("http://x/y")),
                ("method", Value::from("post")),
                ("headers", headers),
                ("body", body),
            ]),
        )
    };
    // EchoHttp echoes the body and reports the url in x-url.
    let r = call(Value::from("text"), Value::Obj(vec![])).unwrap();
    assert_eq!(r.get_f64("status"), Some(200.0));
    assert_eq!(r.get("body"), Some(&Value::Bytes(b"text".to_vec())));
    assert_eq!(
        r.get("headers").unwrap().get_str("x-url"),
        Some("http://x/y")
    );
    let r = call(Value::Bytes(vec![9, 8]), pairs).unwrap();
    assert_eq!(r.get("body"), Some(&Value::Bytes(vec![9, 8])));
    assert_eq!(
        call(Value::Num(1.0), Value::Null).unwrap_err().code,
        "EINVAL"
    );
}

#[test]
fn log_and_notify() {
    let (reg, ts, ..) = setup(RuntimeKind::Ui);
    reg.call_sync(
        "log",
        "write",
        Value::obj([("level", Value::from("warn")), ("msg", Value::from("hey"))]),
    )
    .unwrap();
    assert_eq!(
        ts.log.lines.lock().last().unwrap(),
        &(LogLevel::Warn, "hey".to_string())
    );
    let mut h = host(&ts, 1);
    reg.call_main(
        &mut h,
        "notify",
        "show",
        Value::obj([("message", Value::from("hi"))]),
    )
    .unwrap();
    assert_eq!(ts.notify.messages.lock().as_slice(), ["hi".to_string()]);
}

#[test]
fn ime_is_deferred_busy_and_resolved_by_poll() {
    let (reg, ts, _, ime, _) = setup(RuntimeKind::Ui);
    let mut h = host(&ts, 77);
    let args = Value::obj([
        ("title", Value::from("Name")),
        ("initial", Value::from("ab")),
        ("maxLength", Value::from(8)),
        ("kind", Value::from("password")),
    ]);
    let r = reg.call_main(&mut h, "ime", "open", args.clone()).unwrap();
    assert!(is_deferred(&r));
    assert_eq!(ime.pending(), Some(77));
    let req = h.frame.ime.last.clone().unwrap();
    assert_eq!(
        (
            req.title.as_str(),
            req.initial.as_str(),
            req.max_len,
            req.kind
        ),
        ("Name", "ab", 8, ImeKind::Password)
    );

    h.call_id = 78;
    assert_eq!(
        reg.call_main(&mut h, "ime", "open", args.clone())
            .unwrap_err()
            .code,
        "EBUSY"
    );
    assert_eq!(ime.pending(), Some(77));

    assert_eq!(poll_ime(&ime, &mut h.frame.ime), None);
    h.frame.ime.result = Some(Some("hello".into()));
    assert_eq!(
        poll_ime(&ime, &mut h.frame.ime),
        Some((77, Some("hello".to_string())))
    );
    assert_eq!(ime.pending(), None);
    assert_eq!(poll_ime(&ime, &mut h.frame.ime), None);

    // a platform-level Busy maps to EBUSY too, and leaves no pending call
    h.frame.ime.open = true;
    assert_eq!(
        reg.call_main(&mut h, "ime", "open", args).unwrap_err().code,
        "EBUSY"
    );
    assert_eq!(ime.pending(), None);

    // cancel resolves with None
    h.frame.ime.open = false;
    h.call_id = 79;
    reg.call_main(&mut h, "ime", "open", Value::Null).unwrap();
    h.frame.ime.result = Some(None);
    assert_eq!(poll_ime(&ime, &mut h.frame.ime), Some((79, None)));
}

#[test]
fn pad_rumble_times_out() {
    let (reg, ts, pad, ..) = setup(RuntimeKind::Ui);
    let mut h = host(&ts, 1);
    h.frame.now = 1000.0;
    reg.call_main(
        &mut h,
        "pad",
        "vibrate",
        Value::obj([
            ("large", Value::from(200)),
            ("small", Value::from(300)),
            ("durationMs", Value::from(250)),
        ]),
    )
    .unwrap();
    assert_eq!(h.frame.pad.calls, vec![(200, 255)]);
    pad.tick_rumble(&mut h.frame.pad, 1249.0);
    assert_eq!(h.frame.pad.calls.len(), 1);
    pad.tick_rumble(&mut h.frame.pad, 1250.0);
    assert_eq!(h.frame.pad.calls, vec![(200, 255), (0, 0)]);
    pad.tick_rumble(&mut h.frame.pad, 9999.0);
    assert_eq!(h.frame.pad.calls.len(), 2);

    reg.call_main(
        &mut h,
        "pad",
        "setLightBar",
        Value::obj([
            ("r", Value::from(1)),
            ("g", Value::from(2)),
            ("b", Value::from(3)),
        ]),
    )
    .unwrap();
    assert_eq!(h.frame.pad.light, Some((1, 2, 3)));
}

#[test]
fn pad_state_reflects_shared_pad() {
    let (reg, _, pad, ..) = setup(RuntimeKind::Ui);
    pad.update(PadSnapshot {
        buttons: 0x4000,
        lx: -5,
        ly: 7,
        touch: Some((0.5, 0.25)),
        connected: true,
        ..Default::default()
    });
    let s = reg.call_sync("pad", "state", Value::Null).unwrap();
    assert_eq!(s.get_f64("buttons"), Some(16384.0));
    assert_eq!(s.get_f64("lx"), Some(-5.0));
    assert_eq!(
        s.get("touch"),
        Some(&Value::arr([Value::from(0.5), Value::from(0.25)]))
    );
    assert_eq!(s.get_bool("connected"), Some(true));
    assert_eq!(s.get_bool("intercepted"), Some(false));
    pad.update(PadSnapshot::default());
    assert_eq!(
        reg.call_sync("pad", "state", Value::Null)
            .unwrap()
            .get("touch"),
        Some(&Value::Null)
    );
}

#[test]
fn audio_module_uses_the_shared_mixer() {
    let (reg, ts, _, _, mixer) = setup(RuntimeKind::Server);
    let mut samples = Vec::new();
    for _ in 0..4800 {
        samples.extend_from_slice(&5000i16.to_le_bytes());
    }
    let mut wav = Vec::new();
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + samples.len() as u32).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    for v in [
        16u32.to_le_bytes().as_slice(),
        &1u16.to_le_bytes(),
        &1u16.to_le_bytes(),
        &48_000u32.to_le_bytes(),
        &96_000u32.to_le_bytes(),
        &2u16.to_le_bytes(),
        &16u16.to_le_bytes(),
    ] {
        wav.extend_from_slice(v);
    }
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&(samples.len() as u32).to_le_bytes());
    wav.extend_from_slice(&samples);
    ts.fs.put("app0://beep.wav", &wav);

    let mut h = host(&ts, 1);
    let loaded = reg
        .call_main(
            &mut h,
            "audio",
            "load",
            Value::obj([("uri", Value::from("app0://beep.wav"))]),
        )
        .unwrap();
    assert_eq!(loaded.get_f64("id"), Some(1.0));
    assert_eq!(loaded.get_f64("durationMs"), Some(100.0));
    let played = reg
        .call_main(
            &mut h,
            "audio",
            "play",
            Value::obj([
                ("id", Value::from(1)),
                ("volume", Value::from(0.5)),
                ("loop", Value::Bool(true)),
            ]),
        )
        .unwrap();
    let voice = played.get_f64("voice").unwrap();
    let mut out = vec![0i16; 64];
    mixer.lock().render(&mut out);
    assert!(out.iter().any(|s| *s != 0));
    reg.call_main(
        &mut h,
        "audio",
        "setVolume",
        Value::obj([("voice", Value::from(voice)), ("volume", Value::from(0.0))]),
    )
    .unwrap();
    reg.call_main(
        &mut h,
        "audio",
        "stop",
        Value::obj([("voice", Value::from(voice))]),
    )
    .unwrap();
    assert_eq!(mixer.lock().active_voices(), 0);
    reg.call_main(
        &mut h,
        "audio",
        "playBuiltin",
        Value::obj([("name", Value::from("back"))]),
    )
    .unwrap();
    assert_eq!(mixer.lock().active_voices(), 1);
    assert_eq!(
        reg.call_main(
            &mut h,
            "audio",
            "playBuiltin",
            Value::obj([("name", Value::from("zzz"))])
        )
        .unwrap_err()
        .code,
        "EINVAL"
    );
    ts.fs.put("app0://bad.wav", b"junk");
    assert_eq!(
        reg.call_main(
            &mut h,
            "audio",
            "load",
            Value::obj([("uri", Value::from("app0://bad.wav"))])
        )
        .unwrap_err()
        .code,
        "EFORMAT"
    );
    assert_eq!(
        reg.call_main(
            &mut h,
            "audio",
            "load",
            Value::obj([("uri", Value::from("app0://missing.wav"))])
        )
        .unwrap_err()
        .code,
        "ENOENT"
    );
}
