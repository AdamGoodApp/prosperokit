//! A small blocking HTTP/1.1 client over `std::net::TcpStream`: the fallback
//! of the PS5 `Http` service when libSceHttp is switched off
//! (`USE_SCE_HTTP = false` in `ps5/sce_http.rs`). `http://` only: `https://`
//! returns [`HttpError::TlsUnsupported`]. Host names are not resolved (the
//! console has no `getaddrinfo`; the shim aborts): the host must be an IPv4
//! literal.
//!
//! No FFI, so the host test build includes this file too (`host/mod.rs`).

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::time::{Duration, Instant};

use crate::{HttpError, HttpRequest, HttpResponse};

const MAX_REDIRECTS: usize = 10;
const MAX_HEAD: usize = 64 * 1024;

#[derive(Debug, PartialEq, Eq)]
struct Url {
    host: String,
    port: u16,
    /// Path and query, always starting with `/`.
    target: String,
}

fn parse_url(url: &str) -> Result<Url, HttpError> {
    if url.len() >= 8 && url[..8].eq_ignore_ascii_case("https://") {
        return Err(HttpError::TlsUnsupported {
            url: url.to_string(),
        });
    }
    let rest = url
        .get(..7)
        .filter(|scheme| scheme.eq_ignore_ascii_case("http://"))
        .map(|_| &url[7..])
        .ok_or_else(|| HttpError::InvalidUrl(url.to_string()))?;
    let (authority, target) = match rest.find(['/', '?']) {
        Some(i) if rest.as_bytes()[i] == b'/' => (&rest[..i], rest[i..].to_string()),
        Some(i) => (&rest[..i], format!("/{}", &rest[i..])),
        None => (rest, "/".to_string()),
    };
    let target = target.split('#').next().unwrap_or("/").to_string();
    let (host, port) = match authority.rsplit_once(':') {
        Some((host, port)) => (
            host,
            port.parse::<u16>()
                .map_err(|_| HttpError::InvalidUrl(url.to_string()))?,
        ),
        None => (authority, 80),
    };
    if host.is_empty() {
        return Err(HttpError::InvalidUrl(url.to_string()));
    }
    Ok(Url {
        host: host.to_string(),
        port,
        target,
    })
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

struct Head {
    status: u16,
    headers: Vec<(String, String)>,
}

impl Head {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

fn parse_head(text: &str) -> Result<Head, HttpError> {
    let mut lines = text.split("\r\n");
    let status_line = lines.next().unwrap_or("");
    let mut parts = status_line.splitn(3, ' ');
    let version = parts.next().unwrap_or("");
    let status = parts.next().and_then(|s| s.parse::<u16>().ok());
    let (true, Some(status)) = (version.starts_with("HTTP/"), status) else {
        return Err(HttpError::Other(format!(
            "malformed status line: {status_line:?}"
        )));
    };
    let headers = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
        .collect();
    Ok(Head { status, headers })
}

/// Decodes a complete chunked body (trailers are ignored).
fn decode_chunked(mut data: &[u8]) -> Result<Vec<u8>, HttpError> {
    let bad = || HttpError::Other("malformed chunked body".into());
    let mut out = Vec::new();
    loop {
        let eol = find(data, b"\r\n").ok_or_else(bad)?;
        let size_text = std::str::from_utf8(&data[..eol]).map_err(|_| bad())?;
        let size = usize::from_str_radix(size_text.split(';').next().unwrap_or("").trim(), 16)
            .map_err(|_| bad())?;
        data = &data[eol + 2..];
        if size == 0 {
            return Ok(out);
        }
        if data.len() < size + 2 {
            return Err(bad());
        }
        out.extend_from_slice(&data[..size]);
        data = &data[size + 2..];
    }
}

fn io_error(e: std::io::Error) -> HttpError {
    use std::io::ErrorKind as K;
    match e.kind() {
        K::TimedOut | K::WouldBlock => HttpError::Timeout,
        K::ConnectionRefused | K::ConnectionReset | K::ConnectionAborted | K::NotConnected => {
            HttpError::Connect(e.to_string())
        }
        _ => HttpError::Io(e.to_string()),
    }
}

fn remaining(deadline: Option<Instant>) -> Result<Option<Duration>, HttpError> {
    match deadline {
        None => Ok(None),
        Some(d) => d
            .checked_duration_since(Instant::now())
            .filter(|r| !r.is_zero())
            .map(Some)
            .ok_or(HttpError::Timeout),
    }
}

fn read_some(
    stream: &mut TcpStream,
    buf: &mut [u8],
    deadline: Option<Instant>,
) -> Result<usize, HttpError> {
    stream
        .set_read_timeout(remaining(deadline)?)
        .map_err(io_error)?;
    loop {
        match stream.read(buf) {
            Ok(n) => return Ok(n),
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(e) => return Err(io_error(e)),
        }
    }
}

fn exchange(
    url: &Url,
    method: &str,
    req: &HttpRequest,
    body: Option<&[u8]>,
    deadline: Option<Instant>,
) -> Result<(Head, Vec<u8>), HttpError> {
    let ip: Ipv4Addr = url.host.parse().map_err(|_| {
        HttpError::Dns(format!(
            "{} (host names cannot be resolved here; use an IPv4 address)",
            url.host
        ))
    })?;
    let addr = SocketAddr::from((ip, url.port));
    let mut stream = match remaining(deadline)? {
        Some(t) => TcpStream::connect_timeout(&addr, t),
        None => TcpStream::connect(addr),
    }
    .map_err(io_error)?;
    let _ = stream.set_nodelay(true);

    let has = |name: &str| {
        req.headers
            .iter()
            .any(|(k, _)| k.eq_ignore_ascii_case(name))
    };
    let mut head = format!("{method} {} HTTP/1.1\r\n", url.target);
    if !has("host") {
        let default_port = url.port == 80;
        head.push_str(&format!(
            "Host: {}{}\r\n",
            url.host,
            if default_port {
                String::new()
            } else {
                format!(":{}", url.port)
            }
        ));
    }
    if !has("user-agent") {
        head.push_str("User-Agent: ProsperoKit/1.0\r\n");
    }
    head.push_str("Connection: close\r\n");
    if let Some(body) = body {
        head.push_str(&format!("Content-Length: {}\r\n", body.len()));
    } else if matches!(method, "POST" | "PUT" | "PATCH") {
        head.push_str("Content-Length: 0\r\n");
    }
    for (k, v) in &req.headers {
        if k.eq_ignore_ascii_case("connection") || k.eq_ignore_ascii_case("content-length") {
            continue;
        }
        head.push_str(&format!("{k}: {v}\r\n"));
    }
    head.push_str("\r\n");

    stream
        .set_write_timeout(remaining(deadline)?)
        .map_err(io_error)?;
    stream.write_all(head.as_bytes()).map_err(io_error)?;
    if let Some(body) = body {
        stream.write_all(body).map_err(io_error)?;
    }
    stream.flush().map_err(io_error)?;

    // Read until the whole response has arrived (the server closes: `Connection: close`).
    let mut data = Vec::new();
    let mut buf = [0u8; 16 * 1024];
    let head_end = loop {
        if let Some(i) = find(&data, b"\r\n\r\n") {
            break i;
        }
        if data.len() > MAX_HEAD {
            return Err(HttpError::Other("response headers too large".into()));
        }
        let n = read_some(&mut stream, &mut buf, deadline)?;
        if n == 0 {
            return Err(HttpError::Io(
                "connection closed before the response headers".into(),
            ));
        }
        data.extend_from_slice(&buf[..n]);
    };
    let parsed = parse_head(&String::from_utf8_lossy(&data[..head_end]))?;
    let mut body_bytes = data[head_end + 4..].to_vec();

    let no_body = method == "HEAD"
        || parsed.status == 204
        || parsed.status == 304
        || (100..200).contains(&parsed.status);
    if no_body {
        return Ok((parsed, Vec::new()));
    }
    let chunked = parsed
        .header("transfer-encoding")
        .is_some_and(|v| v.to_ascii_lowercase().contains("chunked"));
    let length = parsed
        .header("content-length")
        .and_then(|v| v.parse::<usize>().ok());
    loop {
        if chunked {
            if (body_bytes.windows(5).any(|w| w == b"0\r\n\r\n") || body_bytes == b"0\r\n")
                && let Ok(decoded) = decode_chunked(&body_bytes)
            {
                return Ok((parsed, decoded));
            }
        } else if let Some(len) = length
            && body_bytes.len() >= len
        {
            body_bytes.truncate(len);
            return Ok((parsed, body_bytes));
        }
        let n = read_some(&mut stream, &mut buf, deadline)?;
        if n == 0 {
            // EOF: the body ends here (no Content-Length), or the connection was cut short.
            return match (chunked, length) {
                (true, _) => decode_chunked(&body_bytes).map(|b| (parsed, b)),
                (false, Some(_)) => Err(HttpError::Io(
                    "connection closed before the full body arrived".into(),
                )),
                (false, None) => Ok((parsed, body_bytes)),
            };
        }
        body_bytes.extend_from_slice(&buf[..n]);
    }
}

fn resolve_location(base: &Url, location: &str) -> String {
    if location.starts_with("http://") || location.starts_with("https://") {
        location.to_string()
    } else if location.starts_with('/') {
        format!("http://{}:{}{location}", base.host, base.port)
    } else {
        let dir = base.target.split('?').next().unwrap_or("/");
        let dir = &dir[..=dir.rfind('/').unwrap_or(0)];
        format!("http://{}:{}{dir}{location}", base.host, base.port)
    }
}

pub fn request(req: &HttpRequest) -> Result<HttpResponse, HttpError> {
    let deadline = (req.timeout_ms > 0)
        .then(|| Instant::now() + Duration::from_millis(u64::from(req.timeout_ms)));
    let mut url_text = req.url.clone();
    let mut method = req.method.to_ascii_uppercase();
    let mut body = req.body.clone();
    for _ in 0..=MAX_REDIRECTS {
        let url = parse_url(&url_text)?;
        let (head, payload) = exchange(&url, &method, req, body.as_deref(), deadline)?;
        let redirect = matches!(head.status, 301 | 302 | 303 | 307 | 308);
        if redirect
            && req.follow_redirects
            && let Some(location) = head.header("location")
        {
            url_text = resolve_location(&url, location);
            if head.status == 303 || (matches!(head.status, 301 | 302) && method == "POST") {
                method = "GET".into();
                body = None;
            }
            continue;
        }
        return Ok(HttpResponse {
            status: head.status,
            headers: head.headers,
            body: payload,
        });
    }
    Err(HttpError::Other("too many redirects".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn urls_are_split() {
        assert_eq!(
            parse_url("http://192.168.1.2:8000/hello?x=1").unwrap(),
            Url {
                host: "192.168.1.2".into(),
                port: 8000,
                target: "/hello?x=1".into()
            }
        );
        assert_eq!(
            parse_url("http://10.0.0.1").unwrap(),
            Url {
                host: "10.0.0.1".into(),
                port: 80,
                target: "/".into()
            }
        );
        assert_eq!(parse_url("http://10.0.0.1?a=b").unwrap().target, "/?a=b");
        assert_eq!(parse_url("HTTP://10.0.0.1/a#frag").unwrap().target, "/a");
        assert!(matches!(
            parse_url("https://api.github.com"),
            Err(HttpError::TlsUnsupported { .. })
        ));
        assert!(matches!(
            parse_url("ftp://x"),
            Err(HttpError::InvalidUrl(_))
        ));
        assert!(matches!(
            parse_url("http://:80/"),
            Err(HttpError::InvalidUrl(_))
        ));
    }

    #[test]
    fn chunked_bodies_are_decoded() {
        assert_eq!(
            decode_chunked(b"5\r\nhello\r\n6;ext=1\r\n world\r\n0\r\n\r\n").unwrap(),
            b"hello world"
        );
        assert!(decode_chunked(b"5\r\nhel").is_err());
    }

    fn serve(connections: usize, handler: impl Fn(&str) -> Vec<u8> + Send + 'static) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        thread::spawn(move || {
            for _ in 0..connections {
                let Ok((mut stream, _)) = listener.accept() else {
                    return;
                };
                let mut data = Vec::new();
                let mut buf = [0u8; 1024];
                while find(&data, b"\r\n\r\n").is_none() {
                    let n = stream.read(&mut buf).unwrap_or(0);
                    if n == 0 {
                        break;
                    }
                    data.extend_from_slice(&buf[..n]);
                }
                let _ = stream.write_all(&handler(&String::from_utf8_lossy(&data)));
            }
        });
        port
    }

    fn get(port: u16, path: &str) -> Result<HttpResponse, HttpError> {
        request(&HttpRequest {
            url: format!("http://127.0.0.1:{port}{path}"),
            ..Default::default()
        })
    }

    #[test]
    fn content_length_chunked_and_eof_bodies() {
        let port = serve(3, |req| {
            if req.starts_with("GET /len") {
                b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nX-A: b\r\n\r\nhello".to_vec()
            } else if req.starts_with("GET /chunked") {
                b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n2\r\nde\r\n0\r\n\r\n".to_vec()
            } else {
                b"HTTP/1.0 200 OK\r\n\r\nuntil eof".to_vec()
            }
        });
        let len = get(port, "/len").unwrap();
        assert_eq!((len.status, len.body.as_slice()), (200, &b"hello"[..]));
        assert!(len.headers.contains(&("X-A".to_string(), "b".to_string())));
        assert_eq!(get(port, "/chunked").unwrap().body, b"abcde");
        assert_eq!(get(port, "/eof").unwrap().body, b"until eof");
    }

    #[test]
    fn request_line_headers_and_post_body() {
        let port = serve(1, |req| {
            assert!(req.starts_with("POST /p?q=1 HTTP/1.1\r\n"), "{req}");
            assert!(req.contains("Host: 127.0.0.1:"), "{req}");
            assert!(req.contains("Content-Length: 3\r\n"), "{req}");
            assert!(req.contains("X-Token: abc\r\n"), "{req}");
            b"HTTP/1.1 201 Created\r\nContent-Length: 0\r\n\r\n".to_vec()
        });
        let res = request(&HttpRequest {
            url: format!("http://127.0.0.1:{port}/p?q=1"),
            method: "post".into(),
            headers: vec![("X-Token".into(), "abc".into())],
            body: Some(b"xyz".to_vec()),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(res.status, 201);
    }

    #[test]
    fn redirects_follow_and_can_be_disabled() {
        let port = serve(3, |req| {
            if req.starts_with("GET /a ") {
                b"HTTP/1.1 301 Moved\r\nLocation: /b\r\nContent-Length: 0\r\n\r\n".to_vec()
            } else {
                b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok".to_vec()
            }
        });
        assert_eq!(get(port, "/a").unwrap().body, b"ok");
        let raw = request(&HttpRequest {
            url: format!("http://127.0.0.1:{port}/a"),
            follow_redirects: false,
            ..Default::default()
        })
        .unwrap();
        assert_eq!(raw.status, 301);
    }

    #[test]
    fn https_hostnames_and_timeouts() {
        assert!(matches!(
            request(&HttpRequest {
                url: "https://api.github.com".into(),
                ..Default::default()
            }),
            Err(HttpError::TlsUnsupported { .. })
        ));
        assert!(matches!(
            request(&HttpRequest {
                url: "http://example.com/".into(),
                ..Default::default()
            }),
            Err(HttpError::Dns(_))
        ));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        thread::spawn(move || {
            let _held = listener.accept();
            thread::sleep(Duration::from_secs(2));
        });
        let slow = request(&HttpRequest {
            url: format!("http://127.0.0.1:{port}/"),
            timeout_ms: 250,
            ..Default::default()
        });
        assert_eq!(slow, Err(HttpError::Timeout));
    }
}
