//! "Share with players": a small web server on the host's local network.
//!
//! Friends open `http://<host LAN IP>:<port>` in a browser and get the app itself
//! (the same built UI), working on the host's blueprints folder: browse, download,
//! add, rename, delete, copy between worlds and edit categories. Its calls go to
//! `POST /api/call/<command>`, which runs only the commands `WebHost::call` allows,
//! always on the shared folder. There is no PIN (by design), so the server only runs
//! while the host has sharing switched on, and refuses cross-site requests.

use crate::blueprints::{self, BpError};
use serde::Serialize;
use std::io::Read;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

pub(crate) const FIRST_PORT: u16 = 7777;
pub(crate) const PORT_TRIES: u16 = 10;
/// dropped blueprint files travel as JSON number arrays, roughly 4 bytes per byte
const MAX_BODY: u64 = 64 << 20;
/// the built UI reads only its own files, the shared folder through the API, and pictures as data: URLs
const CSP: &str = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShareInfo {
    pub port: u16,
    /// Addresses friends can open, LAN address first
    pub urls: Vec<String>,
    pub root: String,
}

/// A blueprint a friend added through the web page (event for the host's window).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Imported {
    pub name: String,
    pub session: String,
}

/// What the server needs from the app.
pub struct WebHost {
    /// Answer to `GET /api/hello`, so clients scanning the network can tell this is a Factory Archive host.
    pub hello: serde_json::Value,
    /// A file of the built UI ("index.html", "assets/index-x.js"): bytes and content type.
    pub asset: Box<dyn Fn(&str) -> Option<(Vec<u8>, String)> + Send + Sync>,
    /// Run an app command for the web page on `root`. Unknown or host-only commands are an error.
    pub call: Box<dyn Fn(&str, serde_json::Value, &Path) -> Result<serde_json::Value, String> + Send + Sync>,
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

impl ShareState {
    pub fn start(&self, root: PathBuf, host: WebHost) -> Result<ShareInfo, String> {
        let mut guard = self.running.lock().map_err(|e| e.to_string())?;
        if let Some(r) = guard.as_ref() {
            if r.info.root == root.to_string_lossy() { return Ok(r.info.clone()); }
        }
        if let Some(r) = guard.take() { stop_running(r); }

        let (server, port) = bind()?;
        let server = Arc::new(server);
        let info = ShareInfo { port, urls: urls_for(port), root: root.to_string_lossy().into_owned() };
        let srv = server.clone();
        let ctx = Arc::new((root, host));
        let thread = std::thread::Builder::new()
            .name("share-server".into())
            .spawn(move || {
                for req in srv.incoming_requests() {
                    // a thread per request: refetching details or downloading a link can take a while
                    // ponytail: unbounded; it's a LAN page for a few friends
                    let ctx = ctx.clone();
                    let _ = std::thread::Builder::new().name("share-request".into()).spawn(move || handle(req, &ctx.0, &ctx.1));
                }
            })
            .map_err(|e| e.to_string())?;
        *guard = Some(Running { server, thread: Some(thread), info: info.clone() });
        Ok(info)
    }

    pub fn stop(&self) {
        if let Some(r) = self.running.lock().ok().and_then(|mut g| g.take()) { stop_running(r); }
    }

    /// Pin the world friends' pages open on, or `None` to follow the detected current world.
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

/// The interface the OS would route LAN traffic through. Connecting a UDP socket
/// only picks a route; no packet is sent.
fn routed_ip() -> Option<Ipv4Addr> {
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("192.168.0.1:9").or_else(|_| sock.connect("10.0.0.1:9")).ok()?;
    match sock.local_addr().ok()?.ip() { IpAddr::V4(ip) => Some(ip), _ => None }
}

/// Lower is a better guess for "the address friends on the same network use".
/// VPNs and virtual adapters (WSL, Hyper-V, VirtualBox, Docker) often win the route
/// guess, so every private address is listed and home-network ranges go first.
fn lan_rank(name: &str, ip: Ipv4Addr, routed: Option<Ipv4Addr>) -> Option<u8> {
    let [a, b, ..] = ip.octets();
    let range = if a == 192 && b == 168 { 1 }
        else if a == 10 { 2 }
        else if a == 172 && (16..32).contains(&b) { 3 }
        else if a == 100 && (64..128).contains(&b) { 4 } // CGNAT, used by Tailscale and similar
        else { return None };
    let n = name.to_ascii_lowercase();
    let virtual_nic = ["vethernet", "virtualbox", "vmware", "vbox", "docker", "wsl", "hyper-v", "veth", "br-", "utun", "tailscale", "zerotier", "hamachi"]
        .iter().any(|v| n.contains(v));
    // the route guess only breaks ties: a VPN on 10.x shouldn't beat Wi-Fi on 192.168.x
    Some(range * 2 + u8::from(Some(ip) != routed) + if virtual_nic { 20 } else { 0 })
}

pub(crate) fn lan_ips() -> Vec<Ipv4Addr> {
    let routed = routed_ip();
    let mut found: Vec<(u8, Ipv4Addr)> = if_addrs::get_if_addrs().unwrap_or_default().into_iter()
        .filter_map(|i| match i.ip() {
            IpAddr::V4(ip) => lan_rank(&i.name, ip, routed).map(|r| (r, ip)),
            _ => None,
        })
        .collect();
    if found.is_empty() {
        if let Some(ip) = routed.filter(|ip| !ip.is_loopback() && !ip.is_unspecified() && !ip.is_link_local()) {
            found.push((0, ip));
        }
    }
    found.sort();
    found.dedup_by_key(|f| f.1);
    found.into_iter().map(|f| f.1).collect()
}

fn urls_for(port: u16) -> Vec<String> {
    let mut urls: Vec<String> = lan_ips().into_iter().map(|ip| format!("http://{ip}:{port}")).collect();
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

/// A path of the built UI, as a relative file name. Only plain segments: no `..`, no hidden files.
fn asset_path(path: &str) -> Option<String> {
    let rel = path.trim_start_matches('/');
    let ok = !rel.is_empty() && rel.split('/').all(|seg| !seg.is_empty() && !seg.starts_with('.')
        && seg.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b)));
    ok.then(|| rel.to_string())
}

/// The UI's index.html, marked so the page knows it talks to the host over HTTP.
fn page(host: &WebHost) -> Option<Vec<u8>> {
    let (html, _) = (host.asset)("index.html")?;
    let html = String::from_utf8(html).ok()?;
    Some(html.replacen("<head>", "<head><meta name=\"fa-web\" content=\"1\">", 1).into_bytes())
}

fn handle(mut req: Request, root: &Path, host: &WebHost) {
    if !host_allowed(&req) { return error(req, 403, "forbidden host"); }
    let path = req.url().split_once('?').map_or(req.url(), |(p, _)| p).to_string();
    let method = req.method().clone();

    match (method, path.as_str()) {
        (Method::Get, "/" | "/index.html") => match page(host) {
            Some(html) => send(req, 200, "text/html; charset=utf-8", html, Some(header("Content-Security-Policy", CSP))),
            None => error(req, 503, "This build of Factory Archive has no web page."),
        },

        (Method::Get, "/api/hello") => json(req, 200, &host.hello),

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

        (Method::Post, p) if p.starts_with("/api/call/") => {
            // JSON content type forces a CORS preflight, which we never answer, so other sites can't post here
            let is_json = req.headers().iter().any(|h| h.field.equiv("Content-Type") && h.value.as_str().starts_with("application/json"));
            if !is_json { return error(req, 415, "expected application/json"); }
            let mut body = Vec::new();
            if req.as_reader().take(MAX_BODY + 1).read_to_end(&mut body).is_err() { return error(req, 400, "unreadable body"); }
            if body.len() as u64 > MAX_BODY { return error(req, 413, "That's too much at once. Add fewer files."); }
            let Ok(args @ serde_json::Value::Object(_)) = serde_json::from_slice(&body) else { return error(req, 400, "expected a JSON object") };
            match (host.call)(&p["/api/call/".len()..], args, root) {
                Ok(v) => json(req, 200, &v),
                Err(e) => error(req, 400, &e),
            }
        }

        (Method::Get, p) if !p.starts_with("/api/") => match asset_path(p).and_then(|f| (host.asset)(&f)) {
            Some((bytes, mime)) => send(req, 200, &mime, bytes, None),
            None => error(req, 404, "not found"),
        },

        _ => error(req, 404, "not found"),
    }
}

#[cfg(test)]
pub(crate) mod tests {
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

    pub(crate) fn host() -> WebHost {
        WebHost {
            hello: serde_json::json!({ "app": "factory-archive", "name": "Test PC", "version": "9.9.9" }),
            asset: Box::new(|f| match f {
                "index.html" => Some((b"<html><head></head><body>app</body></html>".to_vec(), "text/html".into())),
                "assets/app.js" => Some((b"js".to_vec(), "text/javascript".into())),
                _ => None,
            }),
            call: Box::new(|cmd, args, root| match cmd {
                "echo" => Ok(serde_json::json!({ "args": args, "root": root.to_string_lossy() })),
                _ => Err(format!("{cmd} isn't available on the web page")),
            }),
        }
    }

    #[test]
    fn serves_app_calls_and_files() {
        let root = std::env::temp_dir().join(format!("fa-share-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("My World")).unwrap();
        std::fs::write(root.join("My World/Steel 360.sbp"), b"SBPDATA").unwrap();
        std::fs::write(root.join("secret.txt"), b"nope").unwrap();

        let state = ShareState::default();
        let info = state.start(root.clone(), host()).unwrap();
        let port = info.port;
        let host = format!("127.0.0.1:{port}");
        assert!(info.urls.iter().any(|u| u.ends_with(&format!(":{port}"))));

        // the app's own page, marked as the web version, and its files
        let (st, page) = get(port, "/", &host);
        assert_eq!(st, 200);
        assert!(page.contains(r#"<head><meta name="fa-web" content="1">"#) && page.contains("app"), "{page}");
        assert_eq!(get(port, "/assets/app.js", &host), (200, "js".into()));
        assert_eq!(get(port, "/assets/../secret.txt", &host).0, 404);
        assert_eq!(get(port, "/.env", &host).0, 404);

        // calls run on the shared folder, whatever root the page sends
        let (st, body) = post(port, "/api/call/echo", "application/json", r#"{"root":"C:\\elsewhere","n":1}"#);
        assert_eq!(st, 200, "{body}");
        assert!(body.contains(&*root.to_string_lossy().replace('\\', "\\\\")) && body.contains(r#""n":1"#), "{body}");
        let (st, body) = post(port, "/api/call/copy_save_to_account", "application/json", "{}");
        assert!(st == 400 && body.contains("isn't available"), "{st} {body}");
        // JSON objects only (a JSON content type forces a CORS preflight, so other sites can't post)
        assert_eq!(post(port, "/api/call/echo", "text/plain", "{}").0, 415);
        assert_eq!(post(port, "/api/call/echo", "application/json", "[1]").0, 400);

        let (st, body) = get(port, "/api/file/My%20World/Steel%20360.sbp", &host);
        assert_eq!((st, body.as_str()), (200, "SBPDATA"));

        // traversal, wrong extension and foreign Host headers are refused
        assert_eq!(get(port, "/api/file/..%2F/secret.txt", &host).0, 400);
        assert_eq!(get(port, "/api/file/My%20World/..%2F..%2Fsecret.txt", &host).0, 400);
        assert_eq!(get(port, "/api/file/My%20World/Nope.sbp", &host).0, 404);
        assert_eq!(get(port, "/", "evil.example.com").0, 403);

        assert!(state.set_session(Some("../x".into())).is_err());
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
    fn asset_paths_are_plain() {
        assert_eq!(asset_path("/assets/index-Ab_1.js").as_deref(), Some("assets/index-Ab_1.js"));
        assert_eq!(asset_path("/favicon.svg").as_deref(), Some("favicon.svg"));
        for bad in ["/", "/../x", "/assets/../x", "/a//b", "/.git/config", "/a%2Fb", "/a\\b"] {
            assert_eq!(asset_path(bad), None, "{bad}");
        }
    }

    #[test]
    fn decodes_percent_paths() {
        assert_eq!(percent_decode("My%20World").as_deref(), Some("My World"));
        assert_eq!(percent_decode("a%2Fb").as_deref(), Some("a/b")); // then rejected by valid_component
        assert_eq!(percent_decode("bad%zz"), None);
        assert_eq!(percent_decode("cut%2"), None);
    }

    #[test]
    fn ranks_home_network_before_virtual_adapters() {
        let ip = |s: &str| s.parse::<Ipv4Addr>().unwrap();
        let routed = Some(ip("10.8.0.2")); // a VPN won the route guess
        let mut v: Vec<(u8, Ipv4Addr)> = [
            ("vEthernet (WSL)", "172.20.48.1"), ("Wi-Fi", "192.168.1.23"), ("OpenVPN", "10.8.0.2"),
            ("Tailscale", "100.101.1.2"), ("Ethernet", "8.8.8.8"), ("Ethernet", "169.254.3.4"),
        ].iter().filter_map(|(n, a)| lan_rank(n, ip(a), routed).map(|r| (r, ip(a)))).collect();
        v.sort();
        let order: Vec<String> = v.iter().map(|x| x.1.to_string()).collect();
        assert_eq!(order, ["192.168.1.23", "10.8.0.2", "172.20.48.1", "100.101.1.2"]);
        assert!(lan_rank("Ethernet", ip("10.0.0.5"), Some(ip("10.0.0.5"))) < lan_rank("Ethernet", ip("10.0.0.6"), Some(ip("10.0.0.5"))));
    }
}
