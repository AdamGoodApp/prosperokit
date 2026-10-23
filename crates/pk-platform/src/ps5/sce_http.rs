//! PS5 `Http` over libSceHttp (the console's own HTTP/TLS stack, which also
//! resolves host names). The libSceNet/Ssl/Http signatures are the PS4 ones and
//! are unverified on hardware; if they cannot be made to work, flip
//! [`USE_SCE_HTTP`] to `false`: requests then go through the `std::net` HTTP/1.1
//! client of `tcp_http.rs` (`http://` to IPv4 literals only; `https://` returns
//! `HttpError::TlsUnsupported`).
//!
//! Once per process: `sceNetInit`, a net memory pool, `sceSslInit`,
//! `sceHttpInit` and one template. Per request: connection → request →
//! `sceHttpSendRequest` → status, headers, body → delete.

use std::ffi::{CStr, CString, c_char, c_void};
use std::ptr;
use std::sync::LazyLock;

use super::sys;
use super::tcp_http;
use crate::{Http, HttpError, HttpRequest, HttpResponse};

/// `false` selects the plain-TCP fallback.
pub const USE_SCE_HTTP: bool = true;

const NET_POOL_BYTES: i32 = 64 * 1024;
const SSL_POOL_BYTES: usize = 256 * 1024;
const HTTP_POOL_BYTES: usize = 256 * 1024;
const READ_CHUNK: usize = 64 * 1024;
const HTTP_1_1: i32 = 2;

/// The template id; the process-wide contexts are created on first use.
static TEMPLATE: LazyLock<Result<i32, String>> = LazyLock::new(init_contexts);

pub struct Ps5Http;

impl Ps5Http {
    pub fn new() -> Ps5Http {
        Ps5Http
    }

    fn template(&self) -> Result<i32, HttpError> {
        TEMPLATE.clone().map_err(HttpError::Other)
    }
}

impl Default for Ps5Http {
    fn default() -> Self {
        Ps5Http::new()
    }
}

fn init_contexts() -> Result<i32, String> {
    // SAFETY: plain FFI calls with NUL-terminated strings.
    unsafe {
        // May report "already initialised" when the system did it first: harmless.
        sys::sceNetInit();
        let net = sys::sceNetPoolCreate(c"pk".as_ptr(), NET_POOL_BYTES, 0);
        if net < 0 {
            return Err(format!("sceNetPoolCreate failed: {net:#010x}"));
        }
        let ssl = sys::sceSslInit(SSL_POOL_BYTES);
        if ssl < 0 {
            return Err(format!("sceSslInit failed: {ssl:#010x}"));
        }
        let http = sys::sceHttpInit(net, ssl, HTTP_POOL_BYTES);
        if http < 0 {
            return Err(format!("sceHttpInit failed: {http:#010x}"));
        }
        let template = sys::sceHttpCreateTemplate(http, c"ProsperoKit/1.0".as_ptr(), HTTP_1_1, 1);
        if template < 0 {
            return Err(format!("sceHttpCreateTemplate failed: {template:#010x}"));
        }
        Ok(template)
    }
}

fn method_id(method: &str) -> Option<i32> {
    Some(match method.to_ascii_uppercase().as_str() {
        "GET" => 0,
        "POST" => 1,
        "HEAD" => 2,
        "OPTIONS" => 3,
        "PUT" => 4,
        "DELETE" => 5,
        "TRACE" => 6,
        "CONNECT" => 7,
        _ => return None,
    })
}

fn sce_error(what: &str, code: i32) -> HttpError {
    HttpError::Other(format!("{what} failed: {code:#010x}"))
}

fn cstring(text: &str, what: &str) -> Result<CString, HttpError> {
    CString::new(text).map_err(|_| HttpError::InvalidUrl(format!("{what} contains a NUL byte")))
}

/// Deletes the connection and request ids on every exit path.
struct Handles {
    connection: i32,
    request: i32,
}

impl Drop for Handles {
    fn drop(&mut self) {
        // SAFETY: ids created by this request (or -1, which is skipped).
        unsafe {
            if self.request >= 0 {
                sys::sceHttpDeleteRequest(self.request);
            }
            if self.connection >= 0 {
                sys::sceHttpDeleteConnection(self.connection);
            }
        }
    }
}

/// Parses `Name: value\r\n` lines (the status line has no `:`-separated name
/// and is skipped).
pub(super) fn parse_headers(raw: &str) -> Vec<(String, String)> {
    raw.split("\r\n")
        .filter(|line| !line.starts_with("HTTP/"))
        .filter_map(|line| {
            let (name, value) = line.split_once(':')?;
            let name = name.trim();
            (!name.is_empty()).then(|| (name.to_string(), value.trim().to_string()))
        })
        .collect()
}

impl Http for Ps5Http {
    fn request(&self, req: HttpRequest) -> Result<HttpResponse, HttpError> {
        if !USE_SCE_HTTP {
            return tcp_http::request(&req);
        }
        let template = self.template()?;
        let method = method_id(&req.method)
            .ok_or_else(|| HttpError::Other(format!("unsupported method {}", req.method)))?;
        let url = cstring(&req.url, "url")?;
        let body = req.body.as_deref().unwrap_or(&[]);
        let mut handles = Handles {
            connection: -1,
            request: -1,
        };
        // SAFETY: every pointer passed is valid for the call; strings are NUL-terminated.
        unsafe {
            handles.connection = sys::sceHttpCreateConnectionWithURL(template, url.as_ptr(), 1);
            if handles.connection < 0 {
                return Err(sce_error(
                    "sceHttpCreateConnectionWithURL",
                    handles.connection,
                ));
            }
            handles.request = sys::sceHttpCreateRequestWithURL(
                handles.connection,
                method,
                url.as_ptr(),
                body.len() as u64,
            );
            if handles.request < 0 {
                return Err(sce_error("sceHttpCreateRequestWithURL", handles.request));
            }
            let id = handles.request;
            if req.timeout_ms > 0 {
                let us = req.timeout_ms.saturating_mul(1000);
                sys::sceHttpSetResolveTimeOut(id, us);
                sys::sceHttpSetConnectTimeOut(id, us);
                sys::sceHttpSetSendTimeOut(id, us);
                sys::sceHttpSetRecvTimeOut(id, us);
            }
            sys::sceHttpSetAutoRedirect(id, i32::from(req.follow_redirects));
            for (name, value) in &req.headers {
                let (name, value) = (
                    cstring(name, "header name")?,
                    cstring(value, "header value")?,
                );
                let r = sys::sceHttpAddRequestHeader(id, name.as_ptr(), value.as_ptr(), 0);
                if r < 0 {
                    return Err(sce_error("sceHttpAddRequestHeader", r));
                }
            }
            let (data, len) = if body.is_empty() {
                (ptr::null(), 0)
            } else {
                (body.as_ptr().cast::<c_void>(), body.len())
            };
            let r = sys::sceHttpSendRequest(id, data, len);
            if r < 0 {
                return Err(sce_error("sceHttpSendRequest", r));
            }
            let mut status: i32 = 0;
            let r = sys::sceHttpGetStatusCode(id, &mut status);
            if r < 0 {
                return Err(sce_error("sceHttpGetStatusCode", r));
            }
            let mut raw: *mut c_char = ptr::null_mut();
            let mut raw_len: usize = 0;
            let mut headers = Vec::new();
            if sys::sceHttpGetAllResponseHeaders(id, &mut raw, &mut raw_len) >= 0 && !raw.is_null()
            {
                // Owned by libSceHttp until the request is deleted.
                let bytes = if raw_len > 0 {
                    std::slice::from_raw_parts(raw.cast::<u8>(), raw_len).to_vec()
                } else {
                    CStr::from_ptr(raw).to_bytes().to_vec()
                };
                headers = parse_headers(&String::from_utf8_lossy(&bytes));
            }
            let mut out = Vec::new();
            let mut chunk = vec![0u8; READ_CHUNK];
            loop {
                let n = sys::sceHttpReadData(id, chunk.as_mut_ptr().cast::<c_void>(), chunk.len());
                if n < 0 {
                    return Err(sce_error("sceHttpReadData", n));
                }
                if n == 0 {
                    break;
                }
                out.extend_from_slice(&chunk[..n as usize]);
            }
            Ok(HttpResponse {
                status: u16::try_from(status).unwrap_or(0),
                headers,
                body: out,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn response_headers_are_parsed_without_the_status_line() {
        let raw = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nX-A:  b c \r\n\r\n";
        assert_eq!(
            parse_headers(raw),
            vec![
                ("Content-Type".to_string(), "text/plain".to_string()),
                ("X-A".to_string(), "b c".to_string())
            ]
        );
    }

    #[test]
    fn methods_map_to_the_sce_ids() {
        assert_eq!(method_id("get"), Some(0));
        assert_eq!(method_id("DELETE"), Some(5));
        assert_eq!(method_id("PATCH"), None);
    }
}
