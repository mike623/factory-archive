//! "Share with players": a small web server on the host's local network.
//!
//! Friends open `http://<host LAN IP>:<port>` in a browser to browse the host's
//! blueprints per world session, download them, and submit links that are
//! written straight into a session folder. There is no PIN (by design), so the
//! server only runs while the host has sharing switched on, only serves files
//! from the blueprints folder, and refuses cross-site requests.

use crate::blueprints::{self, BpError, CurrentSession};
use crate::resolve;
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::net::{IpAddr, SocketAddr, UdpSocket};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

const PAGE: &str = include_str!("share.html");
const FIRST_PORT: u16 = 7777;
const PORT_TRIES: u16 = 10;
const MAX_BODY: u64 = 8 * 1024;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShareInfo {
    pub port: u16,
    /// Addresses friends can open, LAN address first
    pub urls: Vec<String>,
    pub root: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportedEvent {
    pub name: String,
    pub session: String,
}

struct Running {
    server: Arc<Server>,
    thread: Option<JoinHandle<()>>,
    info: ShareInfo,
}

#[derive(Default)]
pub struct ShareState {
    running: Mutex<Option<Running>>,
    /// Session the host picked by hand; `None` means auto-detect
    pinned: Arc<Mutex<Option<String>>>,
}

/// Where friends' imports go right now: the host's pick, or the detected current world.
pub fn target_session(root: &std::path::Path, pinned: &Mutex<Option<String>>) -> Option<CurrentSession> {
    if let Some(name) = pinned.lock().ok().and_then(|p| p.clone()) {
        return Some(CurrentSession { name, source: "host" });
    }
    blueprints::detect_current(root)
}

impl ShareState {
    /// `on_import` runs on the server thread after a friend's blueprint is written.
    pub fn start(&self, root: PathBuf, on_import: impl Fn(ImportedEvent) + Send + 'static) -> Result<ShareInfo, String> {
        let mut guard = self.running.lock().map_err(|e| e.to_string())?;
        if let Some(r) = guard.as_ref() {
            if r.info.root == root.to_string_lossy() { return Ok(r.info.clone()); }
        }
        if let Some(r) = guard.take() { stop_running(r); }

        let (server, port) = bind()?;
        let server = Arc::new(server);
        let info = ShareInfo { port, urls: urls_for(port), root: root.to_string_lossy().into_owned() };
        let srv = server.clone();
        let pinned = self.pinned.clone();
        let thread = std::thread::Builder::new()
            .name("share-server".into())
            .spawn(move || {
                for req in srv.incoming_requests() {
                    handle(req, &root, &pinned, &on_import);
                }
            })
            .map_err(|e| e.to_string())?;
        *guard = Some(Running { server, thread: Some(thread), info: info.clone() });
        Ok(info)
    }

    pub fn stop(&self) {
        if let Some(r) = self.running.lock().ok().and_then(|mut g| g.take()) { stop_running(r); }
    }

    /// Pin friends' imports to one session, or `None` to follow the detected current world.
    pub fn set_session(&self, name: Option<String>) -> Result<(), String> {
        if let Some(n) = &name {
            if !blueprints::valid_component(n) { return Err("invalid session name".into()); }
        }
        *self.pinned.lock().map_err(|e| e.to_string())? = name;
        Ok(())
    }

    pub fn pinned(&self) -> Option<String> {
        self.pinned.lock().ok().and_then(|p| p.clone())
    }

    pub fn status(&self) -> Option<ShareInfo> {
        self.running.lock().ok().and_then(|g| g.as_ref().map(|r| r.info.clone()))
    }
}

fn stop_running(mut r: Running) {
    r.server.unblock();
    if let Some(t) = r.thread.take() { let _ = t.join(); }
}

fn bind() -> Result<(Server, u16), String> {
    let mut last = String::new();
    for port in FIRST_PORT..FIRST_PORT + PORT_TRIES {
        match Server::http(SocketAddr::from(([0, 0, 0, 0], port))) {
            Ok(s) => return Ok((s, port)),
            Err(e) => last = e.to_string(),
        }
    }
    Err(format!("couldn't open a port between {FIRST_PORT} and {}: {last}", FIRST_PORT + PORT_TRIES - 1))
}

/// The address other machines on the network reach us at. Connecting a UDP socket
/// only picks a route; no packet is sent.
fn lan_ip() -> Option<IpAddr> {
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("192.168.0.1:9").or_else(|_| sock.connect("10.0.0.1:9")).ok()?;
    let ip = sock.local_addr().ok()?.ip();
    (!ip.is_loopback() && !ip.is_unspecified()).then_some(ip)
}

fn urls_for(port: u16) -> Vec<String> {
    let mut urls = Vec::new();
    if let Some(ip) = lan_ip() { urls.push(format!("http://{ip}:{port}")); }
    urls.push(format!("http://localhost:{port}"));
    urls
}

/* ---------------- request handling ---------------- */

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("static header")
}

fn send(req: Request, status: u16, content_type: &str, body: Vec<u8>, extra: Option<Header>) {
    let mut res = Response::from_data(body)
        .with_status_code(StatusCode(status))
        .with_header(header("Content-Type", content_type))
        .with_header(header("Cache-Control", "no-store"))
        .with_header(header("X-Content-Type-Options", "nosniff"))
        .with_header(header("Referrer-Policy", "no-referrer"));
    if let Some(h) = extra { res = res.with_header(h); }
    let _ = req.respond(res);
}

fn json<T: Serialize>(req: Request, status: u16, v: &T) {
    send(req, status, "application/json", serde_json::to_vec(v).unwrap_or_default(), None);
}

fn error(req: Request, status: u16, msg: &str) {
    json(req, status, &serde_json::json!({ "error": msg }));
}

/// Only answer requests addressed to an IP, localhost or a .local name. This blocks
/// DNS-rebinding pages on the open web from talking to the server through a friend's browser.
fn host_allowed(req: &Request) -> bool {
    let Some(h) = req.headers().iter().find(|h| h.field.equiv("Host")) else { return false };
    let host = h.value.as_str();
    let name = if host.starts_with('[') {
        host.split(']').next().unwrap_or("").trim_start_matches('[')
    } else {
        host.rsplit_once(':').map(|(n, _)| n).unwrap_or(host)
    };
    name == "localhost" || name.ends_with(".local") || name.parse::<IpAddr>().is_ok()
}

fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

#[derive(Deserialize)]
struct ImportBody {
    url: String,
}

fn handle(mut req: Request, root: &PathBuf, pinned: &Mutex<Option<String>>, on_import: &dyn Fn(ImportedEvent)) {
    if !host_allowed(&req) { return error(req, 403, "forbidden host"); }
    let path = req.url().split('?').next().unwrap_or("").to_string();
    let method = req.method().clone();

    match (method, path.as_str()) {
        (Method::Get, "/") => send(req, 200, "text/html; charset=utf-8", PAGE.as_bytes().to_vec(),
            Some(header("Content-Security-Policy", "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"))),

        (Method::Get, "/api/sessions") => json(req, 200, &serde_json::json!({
            "target": target_session(root, pinned),
            "sessions": blueprints::list_sessions(root),
        })),

        (Method::Get, p) if p.starts_with("/api/file/") => {
            // /api/file/<session>/<name>.<ext>
            let mut parts = p["/api/file/".len()..].splitn(2, '/');
            let (Some(session), Some(file)) = (parts.next().and_then(percent_decode), parts.next().and_then(percent_decode))
                else { return error(req, 400, "bad path") };
            let Some((name, ext)) = file.rsplit_once('.') else { return error(req, 400, "bad file name") };
            match blueprints::read_file(root, &session, name, ext) {
                Ok(bytes) => {
                    let disposition = format!("attachment; filename=\"{}\"", file.replace('"', ""));
                    send(req, 200, "application/octet-stream", bytes, Some(header("Content-Disposition", &disposition)))
                }
                Err(BpError::NotFound) => error(req, 404, "file not found"),
                Err(e) => error(req, 400, &e.to_string()),
            }
        }

        (Method::Post, "/api/import") => {
            // JSON content type forces a CORS preflight, which we never answer, so other sites can't post here
            let is_json = req.headers().iter().any(|h| h.field.equiv("Content-Type") && h.value.as_str().starts_with("application/json"));
            if !is_json { return error(req, 415, "expected application/json"); }
            let mut body = String::new();
            if req.as_reader().take(MAX_BODY).read_to_string(&mut body).is_err() { return error(req, 400, "unreadable body"); }
            let Ok(input) = serde_json::from_str::<ImportBody>(&body) else { return error(req, 400, "expected {url, session}") };
            let Some(target) = target_session(root, pinned) else {
                return error(req, 409, "The host hasn't picked a world session yet.");
            };

            match resolve::resolve(&input.url) {
                Err(msg) => error(req, 501, &msg),
                Ok(bp) => match blueprints::write_blueprint(root, &target.name, &bp.name, &bp.sbp, bp.cfg.as_deref(), true) {
                    Ok(()) => {
                        on_import(ImportedEvent { name: bp.name.clone(), session: target.name.clone() });
                        json(req, 200, &serde_json::json!({ "ok": true, "name": bp.name, "session": target.name }))
                    }
                    Err(BpError::Exists) => error(req, 409, &BpError::Exists.to_string()),
                                        Err(e) => error(req, 500, &e.to_string()),
                },
            }
        }

        _ => error(req, 404, "not found"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::io::Write;
    use std::net::TcpStream;

    fn http(port: u16, raw: &str) -> (u16, String) {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.write_all(raw.as_bytes()).unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        let status = out.split(' ').nth(1).unwrap().parse().unwrap();
        let body = out.split_once("\r\n\r\n").map(|(_, b)| b.to_string()).unwrap_or_default();
        (status, body)
    }
    fn get(port: u16, path: &str, host: &str) -> (u16, String) {
        http(port, &format!("GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n"))
    }
    fn post(port: u16, path: &str, ctype: &str, body: &str) -> (u16, String) {
        http(port, &format!("POST {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()))
    }

    #[test]
    fn serves_page_sessions_and_files() {
        let root = std::env::temp_dir().join(format!("fa-share-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("My World")).unwrap();
        std::fs::write(root.join("My World/Steel 360.sbp"), b"SBPDATA").unwrap();
        std::fs::write(root.join("secret.txt"), b"nope").unwrap();

        let state = ShareState::default();
        let info = state.start(root.clone(), |_| {}).unwrap();
        let port = info.port;
        let host = format!("127.0.0.1:{port}");
        assert!(info.urls.iter().any(|u| u.ends_with(&format!(":{port}"))));

        let (st, page) = get(port, "/", &host);
        assert_eq!(st, 200);
        assert!(page.contains("Shared blueprints"));

        let (st, body) = get(port, "/api/sessions", &host);
        assert_eq!(st, 200);
        assert!(body.contains("\"name\":\"My World\"") && body.contains("Steel 360"), "{body}");
        assert!(body.contains("\"target\":{\"name\":\"My World\",\"source\":\"blueprints\"}"), "{body}");
        state.set_session(Some("Pinned".into())).unwrap();
        assert!(get(port, "/api/sessions", &host).1.contains("\"target\":{\"name\":\"Pinned\",\"source\":\"host\"}"));
        assert!(state.set_session(Some("../x".into())).is_err());
        state.set_session(None).unwrap();

        let (st, body) = get(port, "/api/file/My%20World/Steel%20360.sbp", &host);
        assert_eq!((st, body.as_str()), (200, "SBPDATA"));

        // traversal, wrong extension and foreign Host headers are refused
        assert_eq!(get(port, "/api/file/..%2F/secret.txt", &host).0, 400);
        assert_eq!(get(port, "/api/file/My%20World/..%2F..%2Fsecret.txt", &host).0, 400);
        assert_eq!(get(port, "/api/file/My%20World/Nope.sbp", &host).0, 404);
        assert_eq!(get(port, "/", "evil.example.com").0, 403);

        // imports: must be JSON, and unresolvable links are reported, never written
        assert_eq!(post(port, "/api/import", "text/plain", "{}").0, 415);
        let (st, body) = post(port, "/api/import", "application/json",
            r#"{"url":"https://satisfactory-calculator.com/en/blueprints/index/details/id/5868/name/x"}"#);
        assert_eq!(st, 501, "{body}");
        assert!(body.contains("isn't available yet"));
        assert_eq!(std::fs::read_dir(root.join("My World")).unwrap().count(), 1);

        state.stop();
        assert!(state.status().is_none());
        // tiny_http closes its listener asynchronously after stop
        let closed = (0..50).any(|_| {
            std::thread::sleep(std::time::Duration::from_millis(20));
            TcpStream::connect(("127.0.0.1", port)).is_err()
        });
        assert!(closed, "server still listening after stop");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn decodes_percent_paths() {
        assert_eq!(percent_decode("My%20World").as_deref(), Some("My World"));
        assert_eq!(percent_decode("a%2Fb").as_deref(), Some("a/b")); // then rejected by valid_component
        assert_eq!(percent_decode("bad%zz"), None);
        assert_eq!(percent_decode("cut%2"), None);
    }
}
