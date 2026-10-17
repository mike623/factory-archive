//! Client mode: this app works on another PC's library through that PC's share server
//! (`share.rs`), like the web page does. The webview can't call the host itself (the server
//! never answers CORS preflights, by design), so the HTTP requests are made here.
//!
//! Hosts are found by scanning the local /24 networks for the share server's ports and asking
//! each open port `GET /api/hello`.

use crate::blueprints;
use crate::share::{lan_ips, FIRST_PORT, PORT_TRIES};
use serde::Serialize;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
use std::sync::Mutex;
use std::time::Duration;

const CONNECT_TIMEOUT: Duration = Duration::from_millis(300);
const SCAN_WORKERS: usize = 128;
/// a blueprint file is a few MB at most; the share server allows 64 MB per request
const MAX_DOWNLOAD: u64 = 64 << 20;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FoundHost {
    /// e.g. `http://192.168.1.20:7777`
    pub url: String,
    /// the host PC's name
    pub name: String,
    pub version: String,
    /// an older Factory Archive (before client mode) is sharing there: it needs updating before it can be joined
    pub outdated: bool,
}

fn agent(timeout: Duration) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder().timeout(timeout).redirect(reqwest::redirect::Policy::none())
        .build().map_err(|e| e.to_string())
}

/// `http://<host>[:port]` from what the user typed or a found host; nothing else (no path, no other scheme).
pub fn base_url(input: &str) -> Result<String, String> {
    let input = input.trim().trim_end_matches('/');
    let with_scheme = if input.contains("://") { input.to_string() } else { format!("http://{input}") };
    let u = url::Url::parse(&with_scheme).map_err(|_| "That isn't an address. Type it like 192.168.1.20:7777.".to_string())?;
    let ok = u.scheme() == "http" && u.host_str().is_some() && u.path() == "/" && u.query().is_none() && u.username().is_empty();
    if !ok { return Err("That isn't an address. Type it like 192.168.1.20:7777.".into()); }
    Ok(format!("http://{}:{}", u.host_str().unwrap_or_default(), u.port().unwrap_or(FIRST_PORT)))
}

/// Ask `base` whether it's a Factory Archive host (an outdated one counts, marked as such).
pub fn hello(base: &str) -> Result<FoundHost, String> {
    let base = base_url(base)?;
    let http = agent(Duration::from_secs(2))?;
    let get = |path: &str| http.get(format!("{base}{path}")).send().and_then(|r| r.error_for_status()).and_then(|r| r.json::<serde_json::Value>()).ok();
    let shown = base.trim_start_matches("http://").to_string();
    if let Some(v) = get("/api/hello") {
        if v["app"] != "factory-archive" { return Err(format!("{shown} isn't a Factory Archive host.")); }
        let s = |k: &str| v[k].as_str().unwrap_or_default().chars().take(64).collect::<String>();
        return Ok(FoundHost { url: base, name: s("name"), version: s("version"), outdated: false });
    }
    // Factory Archive 0.1.22 and older served only the simple share page, whose API lists sessions
    if get("/api/sessions").is_some_and(|v| v["sessions"].is_array()) {
        return Ok(FoundHost { url: base, name: String::new(), version: String::new(), outdated: true });
    }
    Err(format!("No Factory Archive host answers at {shown}."))
}

/// Addresses that accept a TCP connection, in the order given.
fn open(cands: &[SocketAddr]) -> Vec<SocketAddr> {
    let next = Mutex::new(0usize);
    let found = Mutex::new(Vec::new());
    std::thread::scope(|s| for _ in 0..SCAN_WORKERS.min(cands.len()) {
        s.spawn(|| loop {
            let i = { let mut n = next.lock().unwrap(); *n += 1; *n - 1 };
            let Some(a) = cands.get(i) else { break };
            if TcpStream::connect_timeout(a, CONNECT_TIMEOUT).is_ok() { found.lock().unwrap().push(i); }
        });
    });
    let mut idx = found.into_inner().unwrap();
    idx.sort();
    idx.into_iter().map(|i| cands[i]).collect()
}

/// Of `cands`, the Factory Archive hosts, in the order given.
fn probe(cands: &[SocketAddr]) -> Vec<FoundHost> {
    open(cands).into_iter().filter_map(|a| hello(&format!("http://{a}")).ok()).collect()
}

/// Every address in the /24 of each home-network address of this PC (best network first), on `port`.
fn neighbours(own: &[Ipv4Addr], port: u16) -> Vec<SocketAddr> {
    own.iter().filter(|ip| { let [a, b, ..] = ip.octets(); a == 192 && b == 168 || a == 10 || a == 172 && (16..32).contains(&b) })
        .take(3) // ponytail: the best three networks; VPNs and virtual adapters rank last anyway
        .flat_map(|ip| { let [a, b, c, _] = ip.octets(); (1..255).map(move |d| SocketAddr::new(IpAddr::V4(Ipv4Addr::new(a, b, c, d)), port)) })
        .collect()
}

/// Factory Archive hosts on this network, best guess first. Tries the usual port first, then the others.
pub fn discover() -> Vec<FoundHost> {
    let own = lan_ips();
    let first = probe(&neighbours(&own, FIRST_PORT));
    if !first.is_empty() { return first; }
    let rest: Vec<SocketAddr> = (FIRST_PORT + 1..FIRST_PORT + PORT_TRIES).flat_map(|p| neighbours(&own, p)).collect();
    probe(&rest)
}

/// Run a command on the host (see `lib.rs::web_call` for what it allows).
pub fn call(base: &str, cmd: &str, args: &serde_json::Value) -> Result<serde_json::Value, String> {
    if cmd.is_empty() || !cmd.bytes().all(|b| b.is_ascii_lowercase() || b == b'_') { return Err("invalid command".into()); }
    let base = base_url(base)?;
    let res = agent(Duration::from_secs(300))?.post(format!("{base}/api/call/{cmd}")).json(args).send()
        .map_err(|_| "Lost the connection to the host. Check that it's on and still sharing.".to_string())?;
    let ok = res.status().is_success();
    let body: serde_json::Value = res.json().map_err(|_| "The host sent an answer this app can't read. Update both apps to the same version.".to_string())?;
    if ok { Ok(body) } else { Err(body["error"].as_str().unwrap_or("The host refused that.").to_string()) }
}

/// One of a blueprint's files from the host.
pub fn fetch_file(base: &str, session: &str, name: &str, ext: &str) -> Result<Vec<u8>, String> {
    if !blueprints::valid_component(session) || !blueprints::valid_component(name) || !matches!(ext, "sbp" | "sbpcfg") {
        return Err(blueprints::BpError::BadName.to_string());
    }
    let enc = |s: &str| url::form_urlencoded::byte_serialize(s.as_bytes()).collect::<String>().replace('+', "%20");
    let res = agent(Duration::from_secs(120))?.get(format!("{}/api/file/{}/{}", base_url(base)?, enc(session), enc(&format!("{name}.{ext}"))))
        .send().and_then(|r| r.error_for_status()).map_err(|e| format!("Couldn't download {name}.{ext}: {e}"))?;
    let mut bytes = Vec::new();
    std::io::Read::read_to_end(&mut std::io::Read::take(res, MAX_DOWNLOAD + 1), &mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_DOWNLOAD { return Err(format!("{name}.{ext} is too big")); }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::share::ShareState;

    #[test]
    fn addresses_are_plain_http() {
        assert_eq!(base_url("192.168.1.20").unwrap(), "http://192.168.1.20:7777");
        assert_eq!(base_url(" http://192.168.1.20:7780/ ").unwrap(), "http://192.168.1.20:7780");
        for bad in ["ftp://x:1", "http://x:1/path", "http://u:p@x:1", "", "http://x:1?q=1"] {
            assert!(base_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn finds_and_talks_to_a_host() {
        let root = std::env::temp_dir().join(format!("fa-client-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("My World")).unwrap();
        std::fs::write(root.join("My World/Steel.sbp"), b"SBPDATA").unwrap();
        let state = ShareState::default();
        let port = state.start(root.clone(), crate::share::tests::host()).unwrap().port;
        // the listener is dropped at the end of the statement, so nothing listens there
        let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();

        let at = |p: u16| SocketAddr::from(([127, 0, 0, 1], p));
        let found = probe(&[at(closed), at(port)]);
        assert_eq!(found, vec![FoundHost { url: format!("http://127.0.0.1:{port}"), name: "Test PC".into(), version: "9.9.9".into(), outdated: false }]);

        let base = &found[0].url;
        let v = call(base, "echo", &serde_json::json!({ "n": 1 })).unwrap();
        assert_eq!(v["args"]["n"], 1);
        assert!(call(base, "copy_save_to_account", &serde_json::json!({})).unwrap_err().contains("isn't available"));
        assert!(call(base, "../x", &serde_json::json!({})).is_err());
        assert_eq!(fetch_file(base, "My World", "Steel", "sbp").unwrap(), b"SBPDATA");
        assert!(fetch_file(base, "My World", "../Steel", "sbp").is_err());
        assert!(fetch_file(base, "My World", "Nope", "sbp").is_err());

        state.stop();
        std::fs::remove_dir_all(&root).ok();
    }
}
