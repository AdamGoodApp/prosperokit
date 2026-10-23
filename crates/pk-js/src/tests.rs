use std::sync::Arc;
use std::time::{Duration, Instant};

use crossbeam_channel::{Receiver, unbounded};
use parking_lot::Mutex;
use pk_platform::LogLevel;
use pk_protocol::{Op, Value};

use super::*;
use crate::bridge::Timers;
use crate::testing::{TestServices, test_services};

struct Harness {
    handle: JsHandle,
    rx: Receiver<Outbound>,
    ts: TestServices,
}

impl Harness {
    fn new(kind: RuntimeKind, registry: ModuleRegistry, bundle: &str) -> Harness {
        Harness::with_timeout(kind, registry, bundle, runtime::SERVER_TIMEOUT_MS)
    }

    fn with_timeout(
        kind: RuntimeKind,
        registry: ModuleRegistry,
        bundle: &str,
        timeout_ms: u64,
    ) -> Harness {
        let ts = test_services();
        ts.fs.put("/b/app.js", bundle.as_bytes());
        let (tx, rx) = unbounded();
        let cfg = RuntimeConfig {
            kind,
            bundle_dir: "/b".into(),
            memory_limit: 64 << 20,
            dev: None,
            app_info: Value::obj([("platform", Value::from("host"))]),
        };
        let handle = runtime::spawn(
            cfg,
            Arc::new(registry),
            ts.services.clone(),
            Arc::new(WorkerPool::new(2)),
            tx,
            timeout_ms,
        );
        handle
            .inbound
            .send(Inbound::LoadBundle {
                entry: "/b/app.js".into(),
                initial_href: Some("/start".into()),
            })
            .unwrap();
        Harness { handle, rx, ts }
    }

    /// Waits for the first outbound message matching `pick`.
    fn wait<T>(&self, mut pick: impl FnMut(&Outbound) -> Option<T>) -> T {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            let msg = self
                .rx
                .recv_timeout(left)
                .expect("timed out waiting for an outbound message");
            if let Some(t) = pick(&msg) {
                return t;
            }
        }
    }

    fn loaded(&self) -> Result<(), String> {
        self.wait(|m| match m {
            Outbound::Loaded { ok: true, .. } => Some(Ok(())),
            Outbound::Loaded { ok: false, error } => Some(Err(error.clone().unwrap_or_default())),
            _ => None,
        })
    }

    fn wait_log(&self, text: &str) -> String {
        self.wait(|m| match m {
            Outbound::Log { msg, .. } if msg.contains(text) => Some(msg.clone()),
            _ => None,
        })
    }

    fn logs(&self, n: usize) -> Vec<String> {
        let mut out = Vec::new();
        while out.len() < n {
            out.push(self.wait(|m| match m {
                Outbound::Log { msg, .. } => Some(msg.clone()),
                _ => None,
            }));
        }
        out
    }

    fn shutdown(self) {
        self.handle.inbound.send(Inbound::Shutdown).unwrap();
        self.handle.join.join().unwrap();
    }
}

#[test]
fn commit_ops_parse_through_the_bridge() {
    let h = Harness::new(
        RuntimeKind::Ui,
        ModuleRegistry::new(),
        "__pk.commit([[1,2,'view',{bogus: 1}],[3,0,2]]);",
    );
    let (ops, warnings) = h.wait(|m| match m {
        Outbound::Commit { ops, warnings, .. } => Some((ops.clone(), warnings.clone())),
        _ => None,
    });
    assert_eq!(ops.len(), 2);
    assert!(matches!(
        ops[1],
        Op::Append {
            parent: 0,
            child: 2
        }
    ));
    assert_eq!(warnings.len(), 1, "{warnings:?}");
    assert!(h.loaded().is_ok());
    h.shutdown();
}

#[test]
fn bad_commit_throws_and_fails_the_load() {
    let h = Harness::new(
        RuntimeKind::Ui,
        ModuleRegistry::new(),
        "__pk.commit([[99]]);",
    );
    let err = h.loaded().unwrap_err();
    assert!(err.contains("invalid commit"), "{err}");
    h.shutdown();
}

#[test]
fn timers_fire_in_deadline_order_and_can_be_cleared() {
    let src = "globalThis.__pk_fireTimer = (id) => __pk.log('info', 'fired ' + id);
        __pk.timer(1, 80); __pk.timer(2, 30); __pk.timer(3, 50); __pk.timer(4, 5); __pk.clearTimer(3);";
    let h = Harness::new(RuntimeKind::Ui, ModuleRegistry::new(), src);
    assert_eq!(h.logs(3), ["fired 4", "fired 2", "fired 1"]);
    h.shutdown();
}

#[test]
fn timer_heap_orders_by_deadline_then_insertion() {
    let mut t = Timers::default();
    let now = Instant::now();
    t.set(1, now + Duration::from_millis(10));
    t.set(2, now + Duration::from_millis(5));
    t.set(3, now + Duration::from_millis(10));
    t.set(4, now + Duration::from_millis(1));
    t.clear(4);
    t.set(1, now + Duration::from_millis(10)); // re-arm: goes behind 3
    let late = now + Duration::from_millis(20);
    assert_eq!(t.pop_due(now), None);
    let order: Vec<u32> = std::iter::from_fn(|| t.pop_due(late)).collect();
    assert_eq!(order, [2, 3, 1]);
    assert_eq!(t.next_deadline(), None);
}

#[test]
fn values_round_trip_including_bytes() {
    let seen: Arc<Mutex<Option<Value>>> = Arc::default();
    let mut reg = ModuleRegistry::new();
    let s = seen.clone();
    reg.add_sync(
        "t",
        "capture",
        Arc::new(move |v| {
            *s.lock() = Some(v.clone());
            Ok(v)
        }),
    );
    let src = "
        const sent = { z: 1, a: [1.5, 'x', new Uint8Array([1, 2, 3]), null, undefined, () => 1], u: undefined, n: { k: true } };
        const back = __pk.callSync('t', 'capture', sent);
        __pk.log('info', 'bytes ' + (back.a[2] instanceof Uint8Array) + ' ' + Array.from(back.a[2]).join(',') + ' ' + Object.keys(back).join(','));
        const sub = new Uint8Array([9, 8, 7, 6]).subarray(1, 3);
        __pk.log('info', 'sub ' + Array.from(__pk.callSync('t', 'capture', sub)).join(','));
        try { __pk.callSync('t', 'nope', {}); } catch (e) { __pk.log('info', 'err ' + e.code); }
        __pk.log('info', 'utf8 ' + __pk.decodeUtf8(__pk.encodeUtf8('héllo ✓')));
        const r = new Uint8Array(16); __pk.random(r); __pk.log('info', 'rand ' + r.some((b) => b !== 0));
    ";
    let h = Harness::new(RuntimeKind::Ui, reg, src);
    let logs = h.logs(5);
    assert_eq!(logs[0], "bytes true 1,2,3 z,a,n");
    assert_eq!(logs[1], "sub 8,7");
    assert_eq!(logs[2], "err ENOSYS");
    assert_eq!(logs[3], "utf8 héllo ✓");
    assert_eq!(logs[4], "rand true");
    let captured = seen.lock().clone().unwrap();
    // `undefined` and functions inside arrays become null; undefined props are dropped.
    let expect = Value::obj([
        ("z", Value::Num(1.0)),
        (
            "a",
            Value::arr([
                Value::Num(1.5),
                Value::from("x"),
                Value::Bytes(vec![1, 2, 3]),
                Value::Null,
                Value::Null,
                Value::Null,
            ]),
        ),
        ("n", Value::obj([("k", Value::Bool(true))])),
    ]);
    assert_eq!(captured, Value::Bytes(vec![8, 7])); // the last capture was the subarray
    let _ = expect;
    h.shutdown();
}

#[test]
fn value_shape_is_preserved_on_the_rust_side() {
    let seen: Arc<Mutex<Option<Value>>> = Arc::default();
    let mut reg = ModuleRegistry::new();
    let s = seen.clone();
    reg.add_sync(
        "t",
        "capture",
        Arc::new(move |v| {
            *s.lock() = Some(v);
            Ok(Value::Null)
        }),
    );
    let src = "__pk.callSync('t', 'capture', { z: 1, a: [1.5, 'x', new Uint8Array([1, 2, 3]), null, undefined, () => 1], u: undefined, n: { k: true } });";
    let h = Harness::new(RuntimeKind::Ui, reg, src);
    h.loaded().unwrap();
    let expect = Value::obj([
        ("z", Value::Num(1.0)),
        (
            "a",
            Value::arr([
                Value::Num(1.5),
                Value::from("x"),
                Value::Bytes(vec![1, 2, 3]),
                Value::Null,
                Value::Null,
                Value::Null,
            ]),
        ),
        ("n", Value::obj([("k", Value::Bool(true))])),
    ]);
    assert_eq!(seen.lock().clone().unwrap(), expect);
    h.shutdown();
}

#[test]
fn async_native_call_round_trips_through_the_worker_pool() {
    let mut reg = ModuleRegistry::new();
    reg.add_async(
        "t",
        "add",
        Arc::new(|v| {
            std::thread::sleep(Duration::from_millis(20));
            Ok(Value::obj([(
                "sum",
                Value::Num(v.get_f64("a").unwrap_or(0.0) + v.get_f64("b").unwrap_or(0.0)),
            )]))
        }),
    );
    reg.add_async(
        "t",
        "fail",
        Arc::new(|_| Err(NativeError::new("EBOOM", "it broke"))),
    );
    let src = "globalThis.__pk_reply = (cb, ok, v) => __pk.log('info', 'reply ' + cb + ' ' + ok + ' ' + (ok ? v.sum : v.code + ':' + v.message));
        __pk.call('t', 'add', { a: 1, b: 2 }, 7);
        __pk.call('t', 'fail', {}, 8);
        __pk.call('t', 'missing', {}, 9);";
    let h = Harness::new(RuntimeKind::Ui, reg, src);
    let mut logs = h.logs(3);
    logs.sort();
    assert_eq!(
        logs,
        [
            "reply 7 true 3",
            "reply 8 false EBOOM:it broke",
            "reply 9 false ENOSYS:no native function t.missing"
        ]
    );
    h.shutdown();
}

#[test]
fn main_calls_and_server_fetch_are_forwarded_and_answered() {
    let mut reg = ModuleRegistry::new();
    reg.add_main("m", "go", Arc::new(|_, _| Ok(Value::Null)));
    let src = "globalThis.__pk_reply = (cb, ok, v) => __pk.log('info', 'reply ' + cb + ' ' + ok + ' ' + JSON.stringify(v.status === undefined ? v : [v.status, v.headers, Array.from(v.body)]));
        __pk.call('m', 'go', { x: 1 }, 11);
        __pk.call('server', 'fetch', { url: '/a', method: 'POST', headers: { h: 'v' }, body: 'hi' }, 12);";
    let h = Harness::new(RuntimeKind::Ui, reg, src);
    let (id, module, args) = h.wait(|m| match m {
        Outbound::MainCall {
            id,
            module,
            func,
            args,
        } if func == "go" => Some((*id, module.clone(), args.clone())),
        _ => None,
    });
    assert_eq!((id, module.as_str()), (11, "m"));
    assert_eq!(args.get_f64("x"), Some(1.0));
    let (sid, url, method, headers, body) = h.wait(|m| match m {
        Outbound::ServerRequest {
            id,
            url,
            method,
            headers,
            body,
        } => Some((
            *id,
            url.clone(),
            method.clone(),
            headers.clone(),
            body.clone(),
        )),
        _ => None,
    });
    assert_eq!((sid, url.as_str(), method.as_str()), (12, "/a", "POST"));
    assert_eq!(headers, [("h".to_string(), "v".to_string())]);
    assert_eq!(body, b"hi");
    h.handle
        .inbound
        .send(Inbound::NativeReply {
            id: 11,
            result: Ok(Value::from("done")),
        })
        .unwrap();
    h.wait_log("reply 11 true \"done\"");
    h.handle
        .inbound
        .send(Inbound::ServerResponse {
            id: 12,
            status: 201,
            headers: vec![("a".into(), "b".into())],
            body: vec![1, 2],
        })
        .unwrap();
    h.wait_log("reply 12 true [201,[[\"a\",\"b\"]],[1,2]]");
    h.shutdown();
}

#[test]
fn the_runtime_stays_busy_while_a_native_call_awaits_its_reply() {
    let mut reg = ModuleRegistry::new();
    reg.add_main("m", "go", Arc::new(|_, _| Ok(Value::Null)));
    let src = "globalThis.__pk_reply = (cb) => __pk.log('info', 'reply ' + cb);
        __pk.call('m', 'go', {}, 21);";
    let h = Harness::new(RuntimeKind::Ui, reg, src);
    h.wait(|m| matches!(m, Outbound::MainCall { id: 21, .. }).then_some(()));
    // Parked, but the reply is outstanding: an HTTP call or a file read would
    // look exactly like this, and a headless press must not land yet.
    assert!(h.handle.is_busy());
    h.handle
        .inbound
        .send(Inbound::NativeReply {
            id: 21,
            result: Ok(Value::Null),
        })
        .unwrap();
    h.wait_log("reply 21");
    let deadline = Instant::now() + Duration::from_secs(10);
    while h.handle.is_busy() {
        assert!(Instant::now() < deadline, "still busy after the reply");
        std::thread::yield_now();
    }
    h.shutdown();
}

#[test]
fn ui_events_and_prepare_reload() {
    let src = "globalThis.__PK_SEEN = __PK_INITIAL_HREF + '|' + __PK_APP_INFO.platform;
        globalThis.__pk_dispatch = (id, type, p) => __pk.log('info', 'ev ' + id + ' ' + type + ' ' + JSON.stringify(p));
        globalThis.__pk_prepareReload = () => ({ href: '/after' });
        __pk.log('info', __PK_SEEN);";
    let h = Harness::new(RuntimeKind::Ui, ModuleRegistry::new(), src);
    h.wait_log("/start|host");
    h.handle
        .inbound
        .send(Inbound::UiEvent(pk_protocol::UiEvent::with_payload(
            5,
            pk_protocol::EventKind::Press,
            Value::obj([("x", Value::Num(1.0))]),
        )))
        .unwrap();
    h.wait_log("ev 5 press {\"x\":1}");
    h.handle.inbound.send(Inbound::PrepareReload).unwrap();
    let href = h.wait(|m| match m {
        Outbound::PrepareReloadResult { href } => Some(href.clone()),
        _ => None,
    });
    assert_eq!(href, "/after");
    h.shutdown();
}

#[test]
fn load_failures_are_reported() {
    let h = Harness::new(
        RuntimeKind::Ui,
        ModuleRegistry::new(),
        "import x from 'react'; x();",
    );
    let err = h.loaded().unwrap_err();
    assert!(err.contains("Cannot resolve \"react\""), "{err}");
    assert!(err.contains("survived bundling"), "{err}");
    h.shutdown();

    let h = Harness::new(
        RuntimeKind::Ui,
        ModuleRegistry::new(),
        "throw new Error('kaput');",
    );
    assert!(h.loaded().unwrap_err().contains("kaput"));
    h.shutdown();

    let h = Harness::new(RuntimeKind::Ui, ModuleRegistry::new(), "let = = ;");
    assert!(h.loaded().is_err());
    h.shutdown();
}

#[test]
fn app_specifiers_resolve_under_the_bundle_dir_and_tla_is_awaited() {
    let ts_src = "import { v } from 'app:/chunk.js'; await new Promise((r) => { globalThis.__pk_fireTimer = r; __pk.timer(1, 20); }); __pk.log('info', 'chunk ' + v);";
    let h = Harness::new(RuntimeKind::Ui, ModuleRegistry::new(), ts_src);
    h.ts.fs.put("/b/chunk.js", b"export const v = 41 + 1;");
    h.handle
        .inbound
        .send(Inbound::LoadBundle {
            entry: "/b/app.js".into(),
            initial_href: None,
        })
        .unwrap();
    h.wait_log("chunk 42");
    assert!(h.loaded().is_ok());
    h.shutdown();
}

#[test]
fn unhandled_rejections_are_reported() {
    let h = Harness::new(
        RuntimeKind::Ui,
        ModuleRegistry::new(),
        "Promise.reject(new Error('nobody catches me'));\nconst p = Promise.reject(new Error('handled later')); p.catch(() => {});",
    );
    // `Loaded` and the rejection `Error` can arrive in either order; collect both.
    let (mut error, mut loaded) = (None::<String>, None::<bool>);
    while error.is_none() || loaded.is_none() {
        h.wait(|m| match m {
            Outbound::Error { message, .. } => {
                error.get_or_insert_with(|| message.clone());
                Some(())
            }
            Outbound::Loaded { ok, .. } => {
                loaded = Some(*ok);
                Some(())
            }
            _ => None,
        });
    }
    let msg = error.unwrap_or_default();
    assert!(msg.contains("nobody catches me"), "{msg}");
    assert_eq!(loaded, Some(true));
    // The late-handled rejection is not reported.
    let log = h.ts.log.clone();
    h.shutdown();
    assert!(
        !log.lines
            .lock()
            .iter()
            .any(|(l, m)| *l == LogLevel::Error && m.contains("handled later"))
    );
}

const SERVER_HELPERS: &str = "
globalThis.__pk_makeRequest = (url, method, headers, body) => ({ url, method, headers, body });
globalThis.__pk_readResponse = async (r) => r;
";

fn request(id: u64, url: &str) -> Inbound {
    Inbound::ServerRequest {
        id,
        url: url.into(),
        method: "GET".into(),
        headers: vec![],
        body: vec![],
    }
}

fn response(h: &Harness) -> (u64, u16, Vec<(String, String)>, Vec<u8>) {
    h.wait(|m| match m {
        Outbound::ServerResponse {
            id,
            status,
            headers,
            body,
        } => Some((*id, *status, headers.clone(), body.clone())),
        _ => None,
    })
}

#[test]
fn server_runtime_answers_requests_in_order() {
    let src = format!(
        "{SERVER_HELPERS}
        export default {{
          async fetch(req) {{
            if (req.url === '/slow') await new Promise((r) => {{ globalThis.__pk_fireTimer = r; __pk.timer(1, 60); }});
            if (req.url === '/boom') throw new Error('handler exploded');
            return {{ status: 200, headers: [['x-a', '1']], body: __pk.encodeUtf8('hi ' + req.url) }};
          }},
        }};"
    );
    let h = Harness::new(RuntimeKind::Server, ModuleRegistry::new(), &src);
    h.loaded().unwrap();
    // Sent before the previous finishes: still answered FIFO, one at a time.
    h.handle.inbound.send(request(1, "/slow")).unwrap();
    h.handle.inbound.send(request(2, "/fast")).unwrap();
    h.handle.inbound.send(request(3, "/boom")).unwrap();
    let (id, status, headers, body) = response(&h);
    assert_eq!(
        (id, status, body.as_slice()),
        (1, 200, b"hi /slow".as_slice())
    );
    assert_eq!(headers, [("x-a".to_string(), "1".to_string())]);
    let (id, status, _, body) = response(&h);
    assert_eq!(
        (id, status, body.as_slice()),
        (2, 200, b"hi /fast".as_slice())
    );
    let (id, status, _, body) = response(&h);
    assert_eq!((id, status), (3, 500));
    assert!(String::from_utf8_lossy(&body).contains("handler exploded"));
    h.shutdown();
}

#[test]
fn server_requests_time_out_with_504() {
    let src = format!(
        "{SERVER_HELPERS}
        export default {{ fetch(req) {{ return req.url === '/hang' ? new Promise(() => {{}}) : {{ status: 200, headers: [], body: new Uint8Array(0) }}; }} }};"
    );
    let h = Harness::with_timeout(RuntimeKind::Server, ModuleRegistry::new(), &src, 150);
    h.loaded().unwrap();
    h.handle.inbound.send(request(1, "/hang")).unwrap();
    h.handle.inbound.send(request(2, "/ok")).unwrap();
    let (id, status, _, body) = response(&h);
    assert_eq!((id, status), (1, 504));
    assert_eq!(
        String::from_utf8_lossy(&body),
        "{\"error\":\"server function timeout\"}"
    );
    let (id, status, _, _) = response(&h);
    assert_eq!((id, status), (2, 200));
    h.shutdown();
}

#[test]
fn server_without_fetch_fails_the_load_and_requests() {
    let h = Harness::new(
        RuntimeKind::Server,
        ModuleRegistry::new(),
        "export default {};",
    );
    assert!(h.loaded().unwrap_err().contains("export default"));
    h.handle.inbound.send(request(1, "/")).unwrap();
    let (_, status, _, _) = response(&h);
    assert_eq!(status, 500);
    h.shutdown();
}

#[test]
fn node_async_hooks_is_server_only() {
    let h = Harness::new(
        RuntimeKind::Ui,
        ModuleRegistry::new(),
        "import 'node:async_hooks';",
    );
    assert!(
        h.loaded()
            .unwrap_err()
            .contains("Cannot resolve \"node:async_hooks\"")
    );
    h.shutdown();
}
