//! Desktop HTTP through ureq 3 (rustls).

use std::io::ErrorKind;
use std::time::Duration;

use ureq::http;

use crate::{Http, HttpError, HttpRequest, HttpResponse};

/// Largest response body read into memory.
const MAX_BODY: u64 = 512 * 1024 * 1024;

#[derive(Default)]
pub struct HostHttp;

impl HostHttp {
    pub fn new() -> HostHttp {
        HostHttp
    }
}

fn host_of(url: &str) -> String {
    url.split("://")
        .nth(1)
        .and_then(|rest| rest.split(['/', '?', '#']).next())
        .unwrap_or(url)
        .to_string()
}

fn map_error(e: ureq::Error, url: &str) -> HttpError {
    use ureq::Error as E;
    match e {
        E::Timeout(_) => HttpError::Timeout,
        E::HostNotFound => HttpError::Dns(host_of(url)),
        E::BadUri(u) => HttpError::InvalidUrl(u),
        E::ConnectionFailed => HttpError::Connect("connection failed".into()),
        E::Io(io) => match io.kind() {
            ErrorKind::TimedOut | ErrorKind::WouldBlock => HttpError::Timeout,
            ErrorKind::ConnectionRefused
            | ErrorKind::ConnectionReset
            | ErrorKind::ConnectionAborted
            | ErrorKind::NotConnected => HttpError::Connect(io.to_string()),
            _ => HttpError::Io(io.to_string()),
        },
        other => HttpError::Other(other.to_string()),
    }
}

impl Http for HostHttp {
    fn request(&self, req: HttpRequest) -> Result<HttpResponse, HttpError> {
        let config = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .max_redirects(if req.follow_redirects { 10 } else { 0 })
            .max_redirects_will_error(false)
            .timeout_global(
                (req.timeout_ms > 0).then(|| Duration::from_millis(u64::from(req.timeout_ms))),
            )
            .user_agent("ProsperoKit/1.0")
            .build();
        let agent = ureq::Agent::new_with_config(config);

        let method = http::Method::from_bytes(req.method.to_ascii_uppercase().as_bytes())
            .map_err(|_| HttpError::Other(format!("invalid method {:?}", req.method)))?;
        let mut builder = http::Request::builder()
            .method(method)
            .uri(req.url.as_str());
        for (name, value) in &req.headers {
            builder = builder.header(name.as_str(), value.as_str());
        }
        let sent = match req.body {
            Some(body) => agent.run(
                builder
                    .body(body)
                    .map_err(|e| HttpError::InvalidUrl(e.to_string()))?,
            ),
            None => agent.run(
                builder
                    .body(())
                    .map_err(|e| HttpError::InvalidUrl(e.to_string()))?,
            ),
        };
        let mut response = sent.map_err(|e| map_error(e, &req.url))?;

        let status = response.status().as_u16();
        let headers = response
            .headers()
            .iter()
            .map(|(name, value)| {
                (
                    name.as_str().to_string(),
                    String::from_utf8_lossy(value.as_bytes()).into_owned(),
                )
            })
            .collect();
        let body = response
            .body_mut()
            .with_config()
            .limit(MAX_BODY)
            .read_to_vec()
            .map_err(|e| map_error(e, &req.url))?;
        Ok(HttpResponse {
            status,
            headers,
            body,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::thread;

    /// Serves `handler(request_text) -> response_bytes` for `connections` connections.
    fn serve(connections: usize, handler: impl Fn(&str) -> Vec<u8> + Send + 'static) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        thread::spawn(move || {
            for _ in 0..connections {
                let Ok((mut stream, _)) = listener.accept() else {
                    return;
                };
                let request = read_request(&mut stream);
                let _ = stream.write_all(&handler(&request));
            }
        });
        format!("http://{addr}")
    }

    fn read_request(stream: &mut TcpStream) -> String {
        let mut data = Vec::new();
        let mut buf = [0u8; 1024];
        loop {
            let n = stream.read(&mut buf).unwrap_or(0);
            if n == 0 {
                break;
            }
            data.extend_from_slice(&buf[..n]);
            if let Some(end) = data.windows(4).position(|w| w == b"\r\n\r\n") {
                let head = String::from_utf8_lossy(&data[..end]).to_ascii_lowercase();
                let want = head
                    .lines()
                    .find_map(|l| {
                        l.strip_prefix("content-length:")
                            .and_then(|v| v.trim().parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                if data.len() >= end + 4 + want {
                    break;
                }
            }
        }
        String::from_utf8_lossy(&data).into_owned()
    }

    fn ok(body: &str) -> Vec<u8> {
        format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nX-Test: yes\r\nConnection: close\r\n\r\n{body}", body.len()).into_bytes()
    }

    #[test]
    fn get_returns_status_headers_and_body() {
        let base = serve(1, |req| {
            assert!(req.starts_with("GET /hello HTTP/1.1"), "{req}");
            assert!(req.to_ascii_lowercase().contains("x-custom: 7"), "{req}");
            ok("hello world")
        });
        let res = HostHttp::new()
            .request(HttpRequest {
                url: format!("{base}/hello"),
                headers: vec![("X-Custom".into(), "7".into())],
                ..Default::default()
            })
            .unwrap();
        assert_eq!(res.status, 200);
        assert_eq!(res.body, b"hello world");
        assert!(
            res.headers
                .iter()
                .any(|(k, v)| k.eq_ignore_ascii_case("x-test") && v == "yes")
        );
    }

    #[test]
    fn post_sends_the_body_and_non_2xx_is_not_an_error() {
        let base = serve(1, |req| {
            assert!(req.starts_with("POST /echo"), "{req}");
            assert!(req.ends_with("payload"), "{req}");
            b"HTTP/1.1 404 Not Found\r\nContent-Length: 4\r\nConnection: close\r\n\r\nnope".to_vec()
        });
        let res = HostHttp::new()
            .request(HttpRequest {
                url: format!("{base}/echo"),
                method: "POST".into(),
                body: Some(b"payload".to_vec()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!((res.status, res.body.as_slice()), (404, &b"nope"[..]));
    }

    #[test]
    fn redirects_are_followed_or_returned() {
        let base = serve(3, |req| {
            if req.starts_with("GET /start") {
                b"HTTP/1.1 302 Found\r\nLocation: /end\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec()
            } else {
                ok("arrived")
            }
        });
        let http = HostHttp::new();
        let followed = http
            .request(HttpRequest {
                url: format!("{base}/start"),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(
            (followed.status, followed.body.as_slice()),
            (200, &b"arrived"[..])
        );
        let raw = http
            .request(HttpRequest {
                url: format!("{base}/start"),
                follow_redirects: false,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(raw.status, 302);
        assert!(
            raw.headers
                .iter()
                .any(|(k, v)| k.eq_ignore_ascii_case("location") && v == "/end")
        );
    }

    #[test]
    fn timeouts_and_refused_connections_are_classified() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        thread::spawn(move || {
            // accept and never answer
            let _held = listener.accept();
            thread::sleep(Duration::from_secs(3));
        });
        let slow = HostHttp::new().request(HttpRequest {
            url: format!("http://{addr}/"),
            timeout_ms: 300,
            ..Default::default()
        });
        assert_eq!(slow, Err(HttpError::Timeout));

        let closed = TcpListener::bind("127.0.0.1:0").unwrap();
        let dead = closed.local_addr().unwrap();
        drop(closed);
        let refused = HostHttp::new().request(HttpRequest {
            url: format!("http://{dead}/"),
            ..Default::default()
        });
        assert!(matches!(refused, Err(HttpError::Connect(_))), "{refused:?}");

        let bad = HostHttp::new().request(HttpRequest {
            url: "not a url".into(),
            ..Default::default()
        });
        assert!(matches!(bad, Err(HttpError::InvalidUrl(_))), "{bad:?}");
    }
}
