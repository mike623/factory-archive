//! Turning a SCIM / Satisfactory Blueprints / direct URL into blueprint files.
//!
//! No site-specific scraping: we never had access to these sites' markup, so the
//! resolver relies only on what HTTP tells us.
//! - A direct link that returns a `.sbp` / `.sbpcfg` (by file name or
//!   Content-Disposition) is downloaded, and its sibling file is tried too.
//! - A web page is scanned for links that look like downloads; each is fetched and
//!   kept only if it really comes back as a blueprint file (not HTML).
//! If nothing qualifies, we say so and write nothing — never placeholder files.

use reqwest::blocking::{Client, Response};
use std::io::Read;
use std::net::IpAddr;
use std::time::Duration;
use url::Url;

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Source {
    Scim,
    Sbp,
    Direct,
}

impl Source {
    pub fn label(self) -> &'static str {
        match self {
            Source::Scim => "SCIM",
            Source::Sbp => "Satisfactory Blueprints",
            Source::Direct => "Direct URL",
        }
    }
}

/// Mirrors `detectSource` in `src/modals.tsx`.
pub fn detect_source(url: &str) -> Option<Source> {
    let u = url.trim().to_ascii_lowercase();
    if !(u.starts_with("https://") || u.starts_with("http://")) { return None; }
    if u.contains("satisfactory-calculator.com") { return Some(Source::Scim); }
    if u.contains("satisfactoryblueprints.com") { return Some(Source::Sbp); }
    Some(Source::Direct)
}

#[derive(Debug)]
pub struct Resolved {
    pub name: String,
    pub sbp: Vec<u8>,
    pub cfg: Option<Vec<u8>>,
}

const MAX_BYTES: u64 = 25 * 1024 * 1024;
const MAX_CANDIDATES: usize = 12;

struct Fetched {
    file_name: Option<String>,
    bytes: Vec<u8>,
    is_html: bool,
}

fn client() -> Result<Client, String> {
    Client::builder()
        .user_agent(concat!("FactoryArchive/", env!("CARGO_PKG_VERSION"), " (Satisfactory blueprint manager)"))
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(6))
        .build()
        .map_err(|e| e.to_string())
}

/// Blocks requests to this machine or the local network (a LAN friend could otherwise
/// make the host fetch internal addresses). Tests opt out to use a local server.
fn host_allowed(u: &Url, allow_private: bool) -> bool {
    if allow_private { return true; }
    match u.host_str() {
        None => false,
        Some("localhost") => false,
        Some(h) => match h.trim_matches(|c| c == '[' || c == ']').parse::<IpAddr>() {
            Ok(IpAddr::V4(ip)) => !(ip.is_loopback() || ip.is_private() || ip.is_link_local() || ip.is_unspecified()),
            Ok(IpAddr::V6(ip)) => !(ip.is_loopback() || ip.is_unspecified() || (ip.segments()[0] & 0xfe00) == 0xfc00),
            Err(_) => !h.ends_with(".local"),
        },
    }
}

/// `attachment; filename="A b.sbp"` or `filename*=UTF-8''A%20b.sbp`
pub fn disposition_filename(v: &str) -> Option<String> {
    for part in v.split(';').map(str::trim) {
        if let Some(rest) = part.strip_prefix("filename*=") {
            let enc = rest.splitn(3, '\'').nth(2).unwrap_or(rest);
            return Some(percent_decode(enc.trim_matches('"')));
        }
    }
    for part in v.split(';').map(str::trim) {
        if let Some(rest) = part.strip_prefix("filename=") {
            // some sites put a URL-encoded name in plain `filename=` (e.g. SFS%20Foundry%20x3.sbp)
            return Some(decode_if_escaped(rest.trim_matches('"')));
        }
    }
    None
}

/// Decode `%XX` escapes only when the text actually contains some.
fn decode_if_escaped(s: &str) -> String {
    let b = s.as_bytes();
    let escaped = b.windows(3).any(|w| w[0] == b'%' && w[1].is_ascii_hexdigit() && w[2].is_ascii_hexdigit());
    if escaped { percent_decode(s) } else { s.to_string() }
}

fn percent_decode(s: &str) -> String {
    url::form_urlencoded::parse(format!("x={}", s.replace('+', "%2B")).as_bytes())
        .next().map(|(_, v)| v.into_owned()).unwrap_or_else(|| s.to_string())
}

fn ext_of(name: &str) -> Option<&'static str> {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".sbpcfg") { Some("sbpcfg") } else if lower.ends_with(".sbp") { Some("sbp") } else { None }
}

fn read_limited(resp: Response) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    resp.take(MAX_BYTES + 1).read_to_end(&mut buf).map_err(|e| e.to_string())?;
    if buf.len() as u64 > MAX_BYTES { return Err("file is larger than 25 MB".into()); }
    Ok(buf)
}

fn fetch(c: &Client, u: &Url, allow_private: bool) -> Result<Fetched, String> {
    if !host_allowed(u, allow_private) { return Err("links to this computer or the local network aren't allowed".into()); }
    let resp = c.get(u.clone()).send().map_err(|e| format!("couldn't reach {}: {e}", u.host_str().unwrap_or("the site")))?;
    let status = resp.status();
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Err(format!("{} asked for a login (HTTP {status})", u.host_str().unwrap_or("the site")));
    }
    if !status.is_success() { return Err(format!("HTTP {status} from {}", u.host_str().unwrap_or("the site"))); }
    let final_url = resp.url().clone();
    if !host_allowed(&final_url, allow_private) { return Err("the link redirected to a local address".into()); }
    let ctype = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_ascii_lowercase();
    let from_header = resp.headers().get("content-disposition").and_then(|v| v.to_str().ok()).and_then(disposition_filename);
    let from_path = final_url.path_segments().and_then(|s| s.last().map(percent_decode)).filter(|s| !s.is_empty());
    let bytes = read_limited(resp)?;
    let looks_html = bytes.iter().find(|b| !b.is_ascii_whitespace()) == Some(&b'<');
    Ok(Fetched {
        file_name: from_header.or(from_path),
        is_html: ctype.contains("text/html") || looks_html,
        bytes,
    })
}

/// Links on a page, resolved against the page URL. Plain `href` scan: no site-specific selectors.
pub fn extract_links(html: &str, base: &Url) -> Vec<Url> {
    let mut out: Vec<Url> = Vec::new();
    let lower = html.to_ascii_lowercase();
    let mut i = 0;
    while let Some(pos) = lower[i..].find("href") {
        let start = i + pos + 4;
        i = start;
        let rest = &html[start..];
        let rest_trim = rest.trim_start();
        let Some(after_eq) = rest_trim.strip_prefix('=') else { continue };
        let after_eq = after_eq.trim_start();
        let (quote, body) = match after_eq.chars().next() {
            Some(q @ ('"' | '\'')) => (Some(q), &after_eq[1..]),
            _ => (None, after_eq),
        };
        let end = match quote {
            Some(q) => body.find(q),
            None => body.find(|c: char| c.is_whitespace() || c == '>'),
        };
        let Some(end) = end else { continue };
        let raw = body[..end].replace("&amp;", "&");
        if raw.starts_with('#') || raw.starts_with("javascript:") || raw.starts_with("mailto:") { continue; }
        if let Ok(u) = base.join(&raw) {
            if matches!(u.scheme(), "http" | "https") && !out.contains(&u) { out.push(u); }
        }
    }
    out
}

/// Which links on a page are worth trying, most promising first.
fn candidates(links: Vec<Url>, page: &Url) -> Vec<Url> {
    const SKIP: [&str; 10] = [".css", ".js", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".woff"];
    let score = |u: &Url| -> u8 {
        let s = percent_decode(u.as_str()).to_ascii_lowercase();
        if s.ends_with(".sbp") || s.ends_with(".sbpcfg") { 3 }
        else if s.contains("sbp") && s.contains("download") { 2 }
        else if s.contains("download") || s.contains(".sbp") { 1 }
        else { 0 }
    };
    let mut c: Vec<(u8, Url)> = links.into_iter()
        .filter(|u| u != page)
        .filter(|u| { let p = u.path().to_ascii_lowercase(); !SKIP.iter().any(|x| p.ends_with(x)) })
        .map(|u| (score(&u), u))
        .filter(|(s, _)| *s > 0)
        .collect();
    c.sort_by(|a, b| b.0.cmp(&a.0));
    c.into_iter().map(|(_, u)| u).take(MAX_CANDIDATES).collect()
}

/// A file/folder-safe blueprint name.
fn clean_name(s: &str) -> String {
    let mut n: String = s.chars()
        .map(|c| if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '_' } else { c })
        .collect();
    n = n.trim().trim_end_matches('.').trim().to_string();
    n.chars().take(100).collect()
}

fn stem(file: &str) -> &str {
    file.rsplit_once('.').map(|(s, _)| s).unwrap_or(file)
}

fn sibling(u: &Url, from: &str, to: &str) -> Option<Url> {
    let path = u.path();
    let lower = path.to_ascii_lowercase();
    if !lower.ends_with(from) { return None; }
    let mut v = u.clone();
    v.set_path(&format!("{}{}", &path[..path.len() - from.len()], to));
    Some(v)
}

pub fn resolve(url: &str) -> Result<Resolved, String> {
    resolve_with(url, false)
}

pub fn resolve_with(url: &str, allow_private: bool) -> Result<Resolved, String> {
    let Some(src) = detect_source(url) else {
        return Err("That doesn't look like a blueprint link. Paste a SCIM, Satisfactory Blueprints or direct .sbp URL.".into());
    };
    let page = Url::parse(url.trim()).map_err(|_| "That link isn't a valid URL.".to_string())?;
    let c = client()?;
    let first = fetch(&c, &page, allow_private)?;

    let mut sbp: Option<(String, Vec<u8>)> = None;
    let mut cfg: Option<Vec<u8>> = None;

    if !first.is_html {
        // a direct file link
        let name = first.file_name.clone().unwrap_or_default();
        match ext_of(&name) {
            Some("sbp") => {
                sbp = Some((name, first.bytes));
                if let Some(u) = sibling(&page, ".sbp", ".sbpcfg") {
                    if let Ok(f) = fetch(&c, &u, allow_private) { if !f.is_html { cfg = Some(f.bytes); } }
                }
            }
            Some("sbpcfg") => {
                cfg = Some(first.bytes);
                if let Some(u) = sibling(&page, ".sbpcfg", ".sbp") {
                    if let Ok(f) = fetch(&c, &u, allow_private) {
                        if !f.is_html { sbp = Some((f.file_name.unwrap_or_else(|| format!("{}.sbp", stem(&name))), f.bytes)); }
                    }
                }
            }
            _ => return Err("That link downloads a file, but not a .sbp or .sbpcfg blueprint.".into()),
        }
    } else {
        // a web page: try the links that look like downloads
        let html = String::from_utf8_lossy(&first.bytes).into_owned();
        let mut last_err: Option<String> = None;
        for u in candidates(extract_links(&html, &page), &page) {
            match fetch(&c, &u, allow_private) {
                Ok(f) if !f.is_html => match f.file_name.as_deref().and_then(ext_of) {
                    Some("sbp") if sbp.is_none() => sbp = Some((f.file_name.clone().unwrap(), f.bytes)),
                    Some("sbpcfg") if cfg.is_none() => cfg = Some(f.bytes),
                    _ => {}
                },
                Ok(_) => {}
                Err(e) => last_err = Some(e),
            }
            if sbp.is_some() && cfg.is_some() { break; }
        }
        if sbp.is_none() {
            let why = last_err.map(|e| format!(" ({e})")).unwrap_or_default();
            return Err(format!(
                "Couldn't find the .sbp download on that {} page{why}. The site may need you to be logged in, or it may load its download links with JavaScript. Download the .sbp/.sbpcfg in your browser and drop them on the app instead.",
                src.label()
            ));
        }
    }

    let Some((file, sbp_bytes)) = sbp else {
        return Err("Found a .sbpcfg but not its .sbp. The .sbp is the actual blueprint.".into());
    };
    if sbp_bytes.is_empty() { return Err("The downloaded .sbp file is empty.".into()); }
    let mut name = clean_name(stem(&file));
    if name.is_empty() { name = "Imported blueprint".into(); }
    Ok(Resolved { name, sbp: sbp_bytes, cfg })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tiny_http::{Header, Response as HttpResponse, Server};

    #[test]
    fn detects_sources() {
        assert_eq!(detect_source("https://satisfactory-calculator.com/en/blueprints/index/details/id/10327/name/SFS+Foundry+x3"), Some(Source::Scim));
        assert_eq!(detect_source("https://satisfactoryblueprints.com/blueprint/c4ae7a98-699a-4aab-af31-61f99cfd71f0"), Some(Source::Sbp));
        assert_eq!(detect_source("https://files.example.com/x.sbp"), Some(Source::Direct));
        assert_eq!(detect_source("file:///etc/passwd"), None);
        assert_eq!(detect_source("hello"), None);
    }

    #[test]
    fn parses_filenames_and_links() {
        assert_eq!(disposition_filename(r#"attachment; filename="SFS Foundry x3.sbp""#).as_deref(), Some("SFS Foundry x3.sbp"));
        assert_eq!(disposition_filename("attachment; filename*=UTF-8''SFS%20Foundry%20x3.sbpcfg").as_deref(), Some("SFS Foundry x3.sbpcfg"));
        // URL-encoded name inside plain filename= (what SCIM sent for SFS Foundry x3)
        assert_eq!(disposition_filename(r#"attachment; filename="SFS%20Foundry%20x3.sbp""#).as_deref(), Some("SFS Foundry x3.sbp"));
        assert_eq!(disposition_filename("attachment; filename=Steel+360%25.sbp").as_deref(), Some("Steel+360%.sbp"));
        assert_eq!(disposition_filename(r#"attachment; filename="100% Iron.sbp""#).as_deref(), Some("100% Iron.sbp"));
        let base = Url::parse("https://example.com/bp/details/id/1").unwrap();
        let links = extract_links(r#"<a href="/dl?id=1&amp;f=sbp">x</a> <a href='files/a.sbp'>y</a> <a href=#top>z</a> <link href="/s.css">"#, &base);
        let s: Vec<String> = links.iter().map(|u| u.to_string()).collect();
        assert_eq!(s, ["https://example.com/dl?id=1&f=sbp", "https://example.com/bp/details/id/files/a.sbp", "https://example.com/s.css"]);
        let c = candidates(links, &base);
        assert_eq!(c[0].as_str(), "https://example.com/bp/details/id/files/a.sbp"); // explicit .sbp ranks first
        assert!(c.iter().all(|u| !u.path().ends_with(".css")));
        assert_eq!(clean_name("A/B: c?"), "A_B_ c_");
    }

    #[test]
    fn blocks_local_addresses_for_real_use() {
        assert!(resolve("http://127.0.0.1:1/x.sbp").unwrap_err().contains("local"));
        assert!(resolve("http://192.168.1.10/x.sbp").unwrap_err().contains("local"));
        assert!(resolve("http://localhost/x.sbp").unwrap_err().contains("local"));
    }

    /// A tiny stand-in "blueprint site": one details page whose download links return files
    /// via Content-Disposition, plus a direct .sbp with a sibling .sbpcfg. The markup is our own,
    /// not any real site's.
    fn site() -> (Arc<Server>, String) {
        let server = Arc::new(Server::http("127.0.0.1:0").unwrap());
        let base = format!("http://{}", server.server_addr().to_ip().unwrap());
        let s = server.clone();
        std::thread::spawn(move || {
            for req in s.incoming_requests() {
                let html = |b: &str| HttpResponse::from_string(b).with_header(Header::from_bytes("Content-Type", "text/html").unwrap());
                let file = |b: &[u8], name: &str| HttpResponse::from_data(b.to_vec())
                    .with_header(Header::from_bytes("Content-Type", "application/octet-stream").unwrap())
                    .with_header(Header::from_bytes("Content-Disposition", format!("attachment; filename=\"{name}\"")).unwrap());
                let resp = match req.url() {
                    "/details/1" => html(r#"<html><a href="/login">Log in</a> <link href="/a.css">
                        <a href="/download/1/sbp">Download SBP</a> <a href="/download/1/cfg">Download SBP config</a></html>"#),
                    "/download/1/sbp" => file(b"SBP-BYTES", "SFS%20Foundry%20x3.sbp"),
                    "/download/1/cfg" => file(b"CFG-BYTES", "SFS Foundry x3.sbpcfg"),
                    "/details/2" => html("<html>Please log in to download.</html>"),
                    "/files/Bus.sbp" => file(b"BUS", "Bus.sbp"),
                    "/files/Bus.sbpcfg" => file(b"BUSCFG", "Bus.sbpcfg"),
                    "/files/page.sbp" => html("<html>not a file</html>"),
                    _ => HttpResponse::from_string("nope").with_status_code(404),
                };
                let _ = req.respond(resp);
            }
        });
        (server, base)
    }

    #[test]
    fn resolves_pages_and_direct_links_end_to_end() {
        let (_srv, base) = site();
        let r = resolve_with(&format!("{base}/details/1"), true).unwrap();
        assert_eq!(r.name, "SFS Foundry x3");
        assert_eq!(r.sbp, b"SBP-BYTES");
        assert_eq!(r.cfg.as_deref(), Some(&b"CFG-BYTES"[..]));

        let r = resolve_with(&format!("{base}/files/Bus.sbp"), true).unwrap();
        assert_eq!((r.name.as_str(), r.cfg.as_deref()), ("Bus", Some(&b"BUSCFG"[..])));

        let e = resolve_with(&format!("{base}/details/2"), true).unwrap_err();
        assert!(e.contains("Couldn't find the .sbp download"), "{e}");
        let e = resolve_with(&format!("{base}/files/page.sbp"), true).unwrap_err();
        assert!(e.contains("Couldn't find"), "{e}"); // HTML posing as .sbp is never accepted
        let e = resolve_with(&format!("{base}/missing"), true).unwrap_err();
        assert!(e.contains("404"), "{e}");
    }
}
