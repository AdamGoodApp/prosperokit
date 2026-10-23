//! The dev agent (plan Phase 4 §9): a WebSocket client to the dev server that
//! reports logs/errors, executes native calls, answers screenshot requests
//! and downloads reloaded bundles. Compiled with the `dev` feature only.

use std::io::{self, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

use crossbeam_channel::{Receiver, RecvTimeoutError, Sender, unbounded};
use pk_platform::{LogLevel, Services};
use pk_protocol::Value;
use pk_protocol::value::base64_encode;
use tungstenite::client::IntoClientRequest;
use tungstenite::{Message, WebSocket};

use crate::{NativeError, spawn_thread};

#[derive(Clone, Debug)]
pub struct DevAgentConfig {
    pub host: String,
    pub port: u16,
    pub token: String,
    /// `"ps5"` or `"host"`.
    pub platform: String,
    pub title_id: String,
    /// Where downloaded bundles are written (through `Services::fs`), e.g. `data://.pk-dev`.
    pub bundle_cache_dir: String,
    /// Lowercase-hex FNV-1a 64 of the `app.js` the runtime loaded; sent in `hello`.
    pub bundle_hash: String,
}

/// Reconnect delays: start at `initial`, double after each failed attempt up
/// to `max`; reset after a successful connection.
#[derive(Clone, Copy, Debug)]
pub struct Backoff {
    pub initial: Duration,
    pub max: Duration,
}

impl Default for Backoff {
    fn default() -> Self {
        Backoff {
            initial: Duration::from_secs(1),
            max: Duration::from_secs(10),
        }
    }
}

/// Agent → device runtime.
#[derive(Debug)]
pub enum DevEvent {
    Reload {
        app_js: Vec<u8>,
        styles_json: Vec<u8>,
        assets: Vec<(String, Vec<u8>)>,
        hash: String,
    },
    NativeCall {
        id: u64,
        module: String,
        func: String,
        args: Value,
    },
    Screenshot {
        id: u64,
    },
    Connected,
    Disconnected,
}

enum Cmd {
    Send(String),
}

/// Cheap to clone; the agent thread exits once every handle is dropped.
#[derive(Clone)]
pub struct DevAgentHandle {
    tx: Sender<Cmd>,
}

impl DevAgentHandle {
    fn send_json(&self, v: serde_json::Value) {
        let _ = self.tx.send(Cmd::Send(v.to_string()));
    }

    pub fn send_log(&self, level: LogLevel, msg: &str) {
        self.send_json(serde_json::json!({ "type": "log", "level": level.as_str(), "msg": msg }));
    }

    pub fn send_error(&self, message: &str, stack: Option<&str>) {
        self.send_json(serde_json::json!({ "type": "error", "message": message, "stack": stack }));
    }

    pub fn reply_native(&self, id: u64, result: Result<Value, NativeError>) {
        let msg = match result {
            Ok(v) => {
                serde_json::json!({ "type": "native-reply", "id": id, "ok": true, "value": v.to_json() })
            }
            Err(e) => serde_json::json!({
                "type": "native-reply", "id": id, "ok": false,
                "error": { "code": e.code, "message": e.message },
            }),
        };
        self.send_json(msg);
    }

    pub fn send_screenshot(&self, id: u64, png: Vec<u8>) {
        self.send_json(
            serde_json::json!({ "type": "screenshot", "id": id, "png": base64_encode(&png) }),
        );
    }
}

pub struct DevAgent;

impl DevAgent {
    pub fn spawn(cfg: DevAgentConfig, services: Services, tx: Sender<DevEvent>) -> DevAgentHandle {
        DevAgent::spawn_with_backoff(cfg, services, tx, Backoff::default())
    }

    /// Like [`DevAgent::spawn`] with an explicit reconnect backoff (tests).
    pub fn spawn_with_backoff(
        cfg: DevAgentConfig,
        services: Services,
        tx: Sender<DevEvent>,
        backoff: Backoff,
    ) -> DevAgentHandle {
        let (cmd_tx, cmd_rx) = unbounded();
        let log = services.clone();
        let spawned = spawn_thread("pk-dev-agent", 512 * 1024, move || {
            Agent {
                cfg,
                services,
                events: tx,
                cmds: cmd_rx,
                backoff,
            }
            .run();
        });
        if let Err(e) = spawned {
            log.error(format!("dev agent thread failed to start: {e}"));
        }
        DevAgentHandle { tx: cmd_tx }
    }
}

const IO_TIMEOUT: Duration = Duration::from_secs(10);
const POLL: Duration = Duration::from_millis(25);

struct Agent {
    cfg: DevAgentConfig,
    services: Services,
    events: Sender<DevEvent>,
    cmds: Receiver<Cmd>,
    backoff: Backoff,
}

enum Exit {
    /// Connection lost: reconnect.
    Lost,
    /// Every handle or the event receiver is gone: stop the thread.
    Stop,
}

impl Agent {
    fn run(self) {
        let mut delay = self.backoff.initial;
        let mut hash = self.cfg.bundle_hash.clone();
        loop {
            match self.connect() {
                Ok(mut ws) => {
                    delay = self.backoff.initial;
                    if self.events.send(DevEvent::Connected).is_err() {
                        return;
                    }
                    let exit = self.session(&mut ws, &mut hash);
                    let _ = ws.close(None);
                    if self.events.send(DevEvent::Disconnected).is_err() {
                        return;
                    }
                    if matches!(exit, Exit::Stop) {
                        return;
                    }
                }
                Err(e) => self
                    .services
                    .debug(format!("dev agent: connect failed: {e}")),
            }
            // Wait out the backoff; commands queued while offline are dropped.
            let deadline = Instant::now() + delay;
            loop {
                let left = deadline.saturating_duration_since(Instant::now());
                if left.is_zero() {
                    break;
                }
                match self.cmds.recv_timeout(left) {
                    Ok(_) => {}
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
            delay = (delay * 2).min(self.backoff.max);
        }
    }

    fn cache_path(&self, rel: &str) -> String {
        format!(
            "{}/{}",
            self.cfg.bundle_cache_dir.trim_end_matches('/'),
            rel
        )
    }

    fn connect(&self) -> Result<WebSocket<TcpStream>, String> {
        let stream = tcp_connect(&self.cfg.host, self.cfg.port).map_err(|e| e.to_string())?;
        stream
            .set_read_timeout(Some(POLL))
            .map_err(|e| e.to_string())?;
        let url = format!(
            "ws://{}:{}/__pk/device?token={}",
            self.cfg.host,
            self.cfg.port,
            percent_encode(&self.cfg.token)
        );
        let req = url.into_client_request().map_err(|e| e.to_string())?;
        // The handshake runs under the read timeout, so retry while it is
        // merely waiting for the server's answer.
        let deadline = Instant::now() + IO_TIMEOUT;
        let mut attempt = tungstenite::client(req, stream);
        loop {
            match attempt {
                Ok((ws, _)) => return Ok(ws),
                Err(tungstenite::HandshakeError::Interrupted(mid)) => {
                    if Instant::now() > deadline {
                        return Err("websocket handshake timed out".into());
                    }
                    attempt = mid.handshake();
                }
                Err(tungstenite::HandshakeError::Failure(e)) => return Err(e.to_string()),
            }
        }
    }

    fn session(&self, ws: &mut WebSocket<TcpStream>, hash: &mut String) -> Exit {
        let hello = serde_json::json!({
            "type": "hello",
            "platform": self.cfg.platform,
            "titleId": self.cfg.title_id,
            "bundleHash": hash,
        });
        if ws.send(Message::text(hello.to_string())).is_err() {
            return Exit::Lost;
        }
        loop {
            // Outgoing first.
            loop {
                match self.cmds.try_recv() {
                    Ok(Cmd::Send(text)) => {
                        if ws.send(Message::text(text)).is_err() {
                            return Exit::Lost;
                        }
                    }
                    Err(crossbeam_channel::TryRecvError::Empty) => break,
                    Err(crossbeam_channel::TryRecvError::Disconnected) => return Exit::Stop,
                }
            }
            match ws.read() {
                Ok(Message::Text(t)) => {
                    if !self.handle_message(ws, t.as_str(), hash) {
                        return Exit::Stop;
                    }
                }
                Ok(Message::Close(_)) => return Exit::Lost,
                Ok(_) => {}
                Err(tungstenite::Error::Io(e))
                    if matches!(
                        e.kind(),
                        io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                    ) => {}
                Err(_) => return Exit::Lost,
            }
        }
    }

    /// Returns `false` when the event receiver is gone.
    fn handle_message(&self, ws: &mut WebSocket<TcpStream>, text: &str, hash: &mut String) -> bool {
        let Ok(msg) = serde_json::from_str::<serde_json::Value>(text) else {
            self.services.warn("dev agent: ignoring malformed message");
            return true;
        };
        match msg["type"].as_str() {
            Some("reload") => match self.fetch_reload(&msg) {
                Ok(ev) => {
                    if let DevEvent::Reload { app_js, .. } = &ev {
                        *hash = fnv1a_hex(app_js);
                    }
                    return self.events.send(ev).is_ok();
                }
                Err(e) => {
                    let message = format!("dev reload failed: {e}");
                    self.services.error(&message);
                    let err = serde_json::json!({ "type": "error", "message": message });
                    let _ = ws.send(Message::text(err.to_string()));
                }
            },
            Some("native-call") => {
                let (Some(id), Some(module), Some(func)) = (
                    msg["id"].as_u64(),
                    msg["module"].as_str(),
                    msg["fn"].as_str(),
                ) else {
                    return true;
                };
                let args = Value::from_json(&msg["args"]);
                return self
                    .events
                    .send(DevEvent::NativeCall {
                        id,
                        module: module.into(),
                        func: func.into(),
                        args,
                    })
                    .is_ok();
            }
            Some("screenshot") => {
                if let Some(id) = msg["id"].as_u64() {
                    return self.events.send(DevEvent::Screenshot { id }).is_ok();
                }
            }
            _ => {}
        }
        true
    }

    fn fetch_reload(&self, msg: &serde_json::Value) -> Result<DevEvent, String> {
        let bundle = msg["bundle"].as_str().ok_or("reload has no `bundle`")?;
        let styles = msg["styles"].as_str().ok_or("reload has no `styles`")?;
        let hash = msg["hash"].as_str().unwrap_or("").to_string();
        // `assets` is `{ url: hash }` (the CLI) or `[{ url, hash }]`.
        let asset_urls: Vec<String> = match &msg["assets"] {
            serde_json::Value::Object(o) => o.keys().cloned().collect(),
            serde_json::Value::Array(a) => a
                .iter()
                .filter_map(|e| e["url"].as_str().map(String::from))
                .collect(),
            _ => Vec::new(),
        };
        let get = |path: &str| http_get(&self.cfg.host, self.cfg.port, path);
        let app_js = get(bundle)?;
        let styles_json = get(styles)?;
        let mut assets = Vec::new();
        for url in asset_urls {
            let name = url
                .strip_prefix("/__pk/assets/")
                .unwrap_or(url.trim_start_matches('/'))
                .to_string();
            if name.is_empty() || name.split('/').any(|p| p == ".." || p.is_empty()) {
                return Err(format!("unsafe asset path `{url}`"));
            }
            assets.push((name, get(&url)?));
        }

        let fs = &self.services.fs;
        let w = |rel: &str, data: &[u8]| -> Result<(), String> {
            let path = self.cache_path(rel);
            if let Some((dir, _)) = path.rsplit_once('/') {
                fs.mkdir_all(dir).map_err(|e| format!("mkdir {dir}: {e}"))?;
            }
            fs.write(&path, data)
                .map_err(|e| format!("write {path}: {e}"))
        };
        w("app.js", &app_js)?;
        w("app.styles.json", &styles_json)?;
        for (name, data) in &assets {
            w(&format!("assets/{name}"), data)?;
        }
        Ok(DevEvent::Reload {
            app_js,
            styles_json,
            assets,
            hash,
        })
    }
}

/// Lowercase-hex FNV-1a 64 (the hash the runtime reports for `app.js`).
pub fn fnv1a_hex(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

fn tcp_connect(host: &str, port: u16) -> io::Result<TcpStream> {
    let mut last = io::Error::new(io::ErrorKind::NotFound, "no address");
    for addr in (host, port).to_socket_addrs()? {
        match TcpStream::connect_timeout(&addr, IO_TIMEOUT) {
            Ok(s) => {
                let _ = s.set_nodelay(true);
                return Ok(s);
            }
            Err(e) => last = e,
        }
    }
    Err(last)
}

fn percent_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// Minimal HTTP/1.1 GET (`Connection: close`; Content-Length or chunked).
fn http_get(host: &str, port: u16, path: &str) -> Result<Vec<u8>, String> {
    let mut s = tcp_connect(host, port).map_err(|e| format!("GET {path}: {e}"))?;
    s.set_read_timeout(Some(IO_TIMEOUT))
        .map_err(|e| e.to_string())?;
    s.set_write_timeout(Some(IO_TIMEOUT))
        .map_err(|e| e.to_string())?;
    let req = format!(
        "GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\nAccept: */*\r\n\r\n"
    );
    s.write_all(req.as_bytes())
        .map_err(|e| format!("GET {path}: {e}"))?;
    let mut raw = Vec::new();
    s.read_to_end(&mut raw)
        .map_err(|e| format!("GET {path}: {e}"))?;
    parse_response(&raw).map_err(|e| format!("GET {path}: {e}"))
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

fn parse_response(raw: &[u8]) -> Result<Vec<u8>, String> {
    let split = find(raw, b"\r\n\r\n").ok_or("truncated response")?;
    let head = String::from_utf8_lossy(&raw[..split]).into_owned();
    let body = &raw[split + 4..];
    let mut lines = head.split("\r\n");
    let status_line = lines.next().unwrap_or("");
    let status: u16 = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .ok_or("bad status line")?;
    if status != 200 {
        return Err(format!("HTTP {status}"));
    }
    let (mut chunked, mut length) = (false, None);
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            let (k, v) = (k.trim().to_ascii_lowercase(), v.trim());
            if k == "transfer-encoding" && v.to_ascii_lowercase().contains("chunked") {
                chunked = true;
            } else if k == "content-length" {
                length = v.parse::<usize>().ok();
            }
        }
    }
    if chunked {
        return dechunk(body);
    }
    match length {
        Some(n) if body.len() < n => Err("truncated body".into()),
        Some(n) => Ok(body[..n].to_vec()),
        None => Ok(body.to_vec()),
    }
}

fn dechunk(mut body: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    loop {
        let eol = find(body, b"\r\n").ok_or("truncated chunk header")?;
        let size_text = String::from_utf8_lossy(&body[..eol]);
        let size = usize::from_str_radix(size_text.split(';').next().unwrap_or("").trim(), 16)
            .map_err(|_| "bad chunk size")?;
        body = &body[eol + 2..];
        if size == 0 {
            return Ok(out);
        }
        if body.len() < size + 2 {
            return Err("truncated chunk".into());
        }
        out.extend_from_slice(&body[..size]);
        body = &body[size + 2..];
    }
}

#[cfg(test)]
mod tests {
    use std::net::TcpListener;
    use std::sync::Arc;
    use std::thread;

    use crossbeam_channel::unbounded;

    use super::*;
    use crate::testing::test_services;

    #[test]
    fn http_parsing() {
        assert_eq!(
            parse_response(b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nabcdef").unwrap(),
            b"abc"
        );
        assert_eq!(
            parse_response(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n2;x=1\r\nde\r\n0\r\n\r\n").unwrap(),
            b"abcde"
        );
        assert!(parse_response(b"HTTP/1.1 404 Not Found\r\n\r\n").is_err());
        assert!(parse_response(b"HTTP/1.1 200 OK\r\nContent-Length: 9\r\n\r\nabc").is_err());
        assert_eq!(percent_encode("a b/c"), "a%20b%2Fc");
        assert_eq!(fnv1a_hex(b""), "cbf29ce484222325");
        assert_eq!(fnv1a_hex(b"a"), "af63dc4c8601ec8c");
    }

    type Script = Arc<dyn Fn(usize, WebSocket<TcpStream>) + Send + Sync>;

    /// One listener serving both the device WebSocket and the HTTP bundle
    /// routes, like the real dev server (same host:port).
    fn serve(script: Script) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        thread::spawn(move || {
            let mut ws_conns = 0;
            for stream in listener.incoming().flatten() {
                let mut buf = [0u8; 256];
                let n = loop {
                    let n = stream.peek(&mut buf).unwrap_or(0);
                    if n == 0 || find(&buf[..n], b"\r\n").is_some() {
                        break n;
                    }
                };
                let line = String::from_utf8_lossy(&buf[..n]).into_owned();
                if line.starts_with("GET /__pk/device?token=sekrit") {
                    let idx = ws_conns;
                    ws_conns += 1;
                    let script = script.clone();
                    thread::spawn(move || {
                        if let Ok(ws) = tungstenite::accept(stream) {
                            script(idx, ws);
                        }
                    });
                } else {
                    thread::spawn(move || serve_http(stream, &line));
                }
            }
        });
        port
    }

    fn serve_http(mut stream: TcpStream, line: &str) {
        // Drain the request head.
        let mut head = Vec::new();
        let mut b = [0u8; 1];
        while find(&head, b"\r\n\r\n").is_none() && stream.read(&mut b).unwrap_or(0) == 1 {
            head.push(b[0]);
        }
        let path = line.split_whitespace().nth(1).unwrap_or("");
        let (status, body): (&str, &[u8]) = match path {
            "/__pk/bundle/app.js" => ("200 OK", b"export default 1".as_slice()),
            "/__pk/assets/img/a.png" => ("200 OK", &[0x89, b'P', b'N', b'G']),
            "/__pk/bundle/app.styles.json" => ("200 OK", b"{\"tokens\":[]}".as_slice()),
            _ => ("404 Not Found", b"".as_slice()),
        };
        let resp = if path.ends_with("styles.json") {
            // chunked, split in two
            let (a, c) = body.split_at(4);
            let mut r = format!(
                "HTTP/1.1 {status}\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
            )
            .into_bytes();
            for part in [a, c] {
                r.extend_from_slice(format!("{:x}\r\n", part.len()).as_bytes());
                r.extend_from_slice(part);
                r.extend_from_slice(b"\r\n");
            }
            r.extend_from_slice(b"0\r\n\r\n");
            r
        } else {
            let mut r = format!(
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            )
            .into_bytes();
            r.extend_from_slice(body);
            r
        };
        let _ = stream.write_all(&resp);
    }

    fn cfg(port: u16) -> DevAgentConfig {
        DevAgentConfig {
            host: "127.0.0.1".into(),
            port,
            token: "sekrit".into(),
            platform: "host".into(),
            title_id: "PPSA99999".into(),
            bundle_cache_dir: "data://.pk-dev".into(),
            bundle_hash: "abc".into(),
        }
    }

    fn json(ws: &mut WebSocket<TcpStream>) -> serde_json::Value {
        loop {
            if let Message::Text(t) = ws.read().unwrap() {
                return serde_json::from_str(t.as_str()).unwrap();
            }
        }
    }

    // Real sockets and threads: the waits below are upper bounds, not delays.
    const WAIT: Duration = Duration::from_secs(10);

    #[test]
    fn hello_reload_native_call_and_reconnect() {
        let (seen_tx, seen_rx) = unbounded::<(usize, serde_json::Value)>();
        let script: Script = Arc::new(move |idx, mut ws| {
            let hello = json(&mut ws);
            seen_tx.send((idx, hello)).unwrap();
            if idx == 0 {
                let reload = serde_json::json!({
                    "type": "reload", "bundle": "/__pk/bundle/app.js", "styles": "/__pk/bundle/app.styles.json",
                    "hash": "h1", "assets": { "/__pk/assets/img/a.png": "x" },
                });
                ws.send(Message::text(reload.to_string())).unwrap();
                let call = serde_json::json!({
                    "type": "native-call", "id": 7, "module": "fs", "fn": "readFile", "args": { "path": "p" },
                });
                ws.send(Message::text(call.to_string())).unwrap();
                ws.send(Message::text(r#"{"type":"screenshot","id":9}"#))
                    .unwrap();
                for _ in 0..3 {
                    let m = json(&mut ws);
                    seen_tx.send((idx, m)).unwrap();
                }
                // drop → the agent must reconnect
            } else {
                // keep the second connection open until the agent goes away
                while ws.read().is_ok() {}
            }
        });
        let port = serve(script);
        let ts = test_services();
        let (tx, rx) = unbounded();
        let backoff = Backoff {
            initial: Duration::from_millis(10),
            max: Duration::from_millis(40),
        };
        let handle = DevAgent::spawn_with_backoff(cfg(port), ts.services.clone(), tx, backoff);

        let (_, hello) = seen_rx.recv_timeout(WAIT).unwrap();
        assert_eq!(hello["type"], "hello");
        assert_eq!(hello["platform"], "host");
        assert_eq!(hello["titleId"], "PPSA99999");
        assert_eq!(hello["bundleHash"], "abc");

        assert!(matches!(
            rx.recv_timeout(WAIT).unwrap(),
            DevEvent::Connected
        ));
        match rx.recv_timeout(WAIT).unwrap() {
            DevEvent::Reload {
                app_js,
                styles_json,
                assets,
                hash,
            } => {
                assert_eq!(app_js, b"export default 1");
                assert_eq!(styles_json, b"{\"tokens\":[]}");
                assert_eq!(
                    assets,
                    vec![("img/a.png".to_string(), vec![0x89, b'P', b'N', b'G'])]
                );
                assert_eq!(hash, "h1");
            }
            other => panic!("expected Reload, got {other:?}"),
        }
        assert_eq!(
            ts.fs.files.lock().get("data://.pk-dev/app.js").unwrap(),
            b"export default 1"
        );
        assert!(
            ts.fs
                .files
                .lock()
                .contains_key("data://.pk-dev/assets/img/a.png")
        );

        match rx.recv_timeout(WAIT).unwrap() {
            DevEvent::NativeCall {
                id,
                module,
                func,
                args,
            } => {
                assert_eq!((id, module.as_str(), func.as_str()), (7, "fs", "readFile"));
                assert_eq!(args.get_str("path"), Some("p"));
                handle.reply_native(7, Ok(Value::Bytes(vec![1, 2, 3])));
            }
            other => panic!("expected NativeCall, got {other:?}"),
        }
        match rx.recv_timeout(WAIT).unwrap() {
            DevEvent::Screenshot { id } => {
                assert_eq!(id, 9);
                handle.send_screenshot(9, vec![1, 2, 3]);
            }
            other => panic!("expected Screenshot, got {other:?}"),
        }
        handle.send_log(LogLevel::Warn, "hi");

        let (_, reply) = seen_rx.recv_timeout(WAIT).unwrap();
        assert_eq!(reply["type"], "native-reply");
        assert_eq!(reply["id"], 7);
        assert_eq!(reply["ok"], true);
        assert_eq!(reply["value"]["$bytes"], "AQID");
        let (_, shot) = seen_rx.recv_timeout(WAIT).unwrap();
        assert_eq!(
            (
                shot["type"].as_str(),
                shot["id"].as_u64(),
                shot["png"].as_str()
            ),
            (Some("screenshot"), Some(9), Some("AQID"))
        );
        let (_, log) = seen_rx.recv_timeout(WAIT).unwrap();
        assert_eq!(
            (
                log["type"].as_str(),
                log["level"].as_str(),
                log["msg"].as_str()
            ),
            (Some("log"), Some("warn"), Some("hi"))
        );

        assert!(matches!(
            rx.recv_timeout(WAIT).unwrap(),
            DevEvent::Disconnected
        ));
        let (idx, hello2) = seen_rx.recv_timeout(WAIT).unwrap();
        assert_eq!(idx, 1);
        assert_eq!(hello2["type"], "hello");
        assert_eq!(hello2["bundleHash"], fnv1a_hex(b"export default 1"));
        assert!(matches!(
            rx.recv_timeout(WAIT).unwrap(),
            DevEvent::Connected
        ));
    }

    #[test]
    fn failed_reload_reports_an_error_and_stays_connected() {
        let (seen_tx, seen_rx) = unbounded::<serde_json::Value>();
        let script: Script = Arc::new(move |_, mut ws| {
            let _hello = json(&mut ws);
            ws.send(Message::text(
                r#"{"type":"reload","bundle":"/nope.js","styles":"/nope.json","hash":"x"}"#,
            ))
            .unwrap();
            seen_tx.send(json(&mut ws)).unwrap();
            while ws.read().is_ok() {}
        });
        let port = serve(script);
        let ts = test_services();
        let (tx, rx) = unbounded();
        let _h = DevAgent::spawn(cfg(port), ts.services.clone(), tx);
        let err = seen_rx.recv_timeout(WAIT).unwrap();
        assert_eq!(err["type"], "error");
        assert!(err["message"].as_str().unwrap().contains("HTTP 404"));
        assert!(matches!(
            rx.recv_timeout(WAIT).unwrap(),
            DevEvent::Connected
        ));
        assert!(rx.try_recv().is_err());
    }
}
