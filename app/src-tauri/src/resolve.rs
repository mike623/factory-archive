//! Turning a SCIM / Satisfactory Blueprints / direct URL into blueprint files.
//!
//! No site-specific scraping: we never had access to these sites' markup, so the
//! resolver relies only on what HTTP tells us.
//! - A direct link that returns a `.sbp` / `.sbpcfg` (by file name or
//!   Content-Disposition) is downloaded, and its sibling file is tried too.
//! - A web page is scanned for links that look like downloads; each is fetched and
//!   kept only if it really comes back as a blueprint file (not HTML).
//! If nothing qualifies, we say so and write nothing — never placeholder files.
//!
//! One verified exception: SCIM's `og:image` is only the site icon, so for SCIM pages the
//! picture is the first image of the blueprint's screenshot carousel (`id="carouselBlueprint"`,
//! checked against live pages in Oct 2026).

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

/// Details read from the blueprint's web page (standard link-preview tags only).
#[derive(Debug, Default, Clone, PartialEq)]
pub struct PageMeta {
    pub title: Option<String>,
    pub description: Option<String>,
    pub image_url: Option<String>,
    pub site_name: Option<String>,
    pub author: Option<String>,
    pub category: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Debug)]
pub struct Resolved {
    pub name: String,
    pub sbp: Vec<u8>,
    pub cfg: Option<Vec<u8>>,
    pub source: Source,
    pub url: String,
    pub meta: PageMeta,
    /// preview image from the page: bytes + file extension
    pub image: Option<(Vec<u8>, &'static str)>,
}

impl Source {
    pub fn id(self) -> &'static str {
        match self { Source::Scim => "scim", Source::Sbp => "sbp", Source::Direct => "url" }
    }
}

fn decode_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        let tail = &rest[i..];
        let Some(end) = tail.find(';').filter(|&e| e <= 10) else { out.push('&'); rest = &tail[1..]; continue };
        let ent = &tail[1..end];
        let ch = match ent {
            "amp" => Some('&'), "lt" => Some('<'), "gt" => Some('>'), "quot" => Some('"'), "apos" | "#39" => Some('\''),
            "nbsp" => Some(' '),
            e if e.starts_with("#x") || e.starts_with("#X") => u32::from_str_radix(&e[2..], 16).ok().and_then(char::from_u32),
            e if e.starts_with('#') => e[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        };
        match ch { Some(c) => { out.push(c); rest = &tail[end + 1..]; } None => { out.push('&'); rest = &tail[1..]; } }
    }
    out.push_str(rest);
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// attribute value from a single tag's source, e.g. `content` in `<meta property="og:title" content="X">`
fn attr(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let mut from = 0;
    while let Some(p) = lower[from..].find(name) {
        let at = from + p;
        from = at + name.len();
        let before_ok = at == 0 || lower.as_bytes()[at - 1].is_ascii_whitespace();
        let after = lower[from..].trim_start();
        if !before_ok || !after.starts_with('=') { continue; }
        let v = tag[tag.len() - after.len() + 1..].trim_start();
        let (q, body) = match v.chars().next() { Some(c @ ('"' | '\'')) => (Some(c), &v[1..]), _ => (None, v) };
        let end = match q { Some(c) => body.find(c), None => body.find(|c: char| c.is_whitespace() || c == '>' || c == '/') }.unwrap_or(body.len());
        return Some(decode_entities(&body[..end]));
    }
    None
}

fn tags_named<'a>(html: &'a str, tag: &str) -> Vec<&'a str> {
    let lower = html.to_ascii_lowercase();
    let open = format!("<{tag}");
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(p) = lower[i..].find(&open) {
        let s = i + p;
        let Some(e) = lower[s..].find('>') else { break };
        out.push(&html[s..s + e + 1]);
        i = s + e + 1;
    }
    out
}

/// Read title / picture / description / author / category / tags from standard
/// Open Graph, Twitter-card and `<meta name=…>` tags. No site-specific selectors.
pub fn page_meta(html: &str, base: &Url) -> PageMeta {
    let mut m = PageMeta::default();
    let mut keywords: Option<String> = None;
    let nonempty = |v: Option<String>| v.filter(|s| !s.trim().is_empty());
    for t in tags_named(html, "meta") {
        let key = attr(t, "property").or_else(|| attr(t, "name")).or_else(|| attr(t, "itemprop")).map(|k| k.to_ascii_lowercase());
        let Some(key) = key else { continue };
        let Some(val) = nonempty(attr(t, "content")) else { continue };
        match key.as_str() {
            "og:title" => { m.title.get_or_insert(val); }
            "twitter:title" if m.title.is_none() => m.title = Some(val),
            "og:description" => { m.description.get_or_insert(val); }
            "twitter:description" | "description" if m.description.is_none() => m.description = Some(val),
            "og:image" | "og:image:secure_url" | "og:image:url" => { m.image_url.get_or_insert(val); }
            "twitter:image" | "twitter:image:src" | "image" if m.image_url.is_none() => m.image_url = Some(val),
            "og:site_name" => { m.site_name.get_or_insert(val); }
            "author" | "article:author" => { m.author.get_or_insert(val); }
            "article:section" => { m.category.get_or_insert(val); }
            "article:tag" => if !m.tags.contains(&val) { m.tags.push(val) },
            "keywords" => { keywords.get_or_insert(val); }
            _ => {}
        }
    }
    if m.tags.is_empty() {
        if let Some(k) = keywords {
            for t in k.split(',').map(str::trim).filter(|t| !t.is_empty()).take(12) {
                if !m.tags.iter().any(|x| x.eq_ignore_ascii_case(t)) { m.tags.push(t.to_string()); }
            }
        }
    }
    if m.title.is_none() {
        let lower = html.to_ascii_lowercase();
        if let (Some(a), Some(b)) = (lower.find("<title"), lower.find("</title>")) {
            if let Some(gt) = lower[a..].find('>') { if a + gt + 1 <= b { m.title = nonempty(Some(decode_entities(&html[a + gt + 1..b]))); } }
        }
    }
    if m.image_url.is_none() {
        m.image_url = tags_named(html, "link").into_iter()
            .find(|t| attr(t, "rel").map(|r| r.eq_ignore_ascii_case("image_src")).unwrap_or(false))
            .and_then(|t| attr(t, "href"));
    }
    m.image_url = m.image_url.and_then(|u| base.join(&u).ok()).filter(|u| matches!(u.scheme(), "http" | "https")).map(|u| u.to_string());
    m
}

/// First screenshot in a SCIM blueprint page's carousel (`#carouselBlueprint .carousel-item img`).
pub fn scim_carousel_image(html: &str, base: &Url) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let start = lower.find("id=\"carouselblueprint\"")?;
    let item = start + lower[start..].find("carousel-item")?;
    let img = tags_named(&html[item..], "img").into_iter().next()?;
    let u = base.join(&attr(img, "src")?).ok()?;
    matches!(u.scheme(), "http" | "https").then(|| u.to_string())
}

/// Page details for a source: standard tags, plus SCIM's carousel picture.
fn details_from_html(html: &str, page: &Url, src: Source) -> PageMeta {
    let mut m = page_meta(html, page);
    if src == Source::Scim {
        if let Some(u) = scim_carousel_image(html, page) { m.image_url = Some(u); }
    }
    m
}

/// The page's preview picture, if it is really an image (optional: failures give `None`).
fn fetch_image(c: &Client, meta: &PageMeta, allow_private: bool) -> Option<(Vec<u8>, &'static str)> {
    meta.image_url.as_deref()
        .and_then(|u| Url::parse(u).ok())
        .and_then(|u| fetch(c, &u, allow_private).ok())
        .filter(|f| f.bytes.len() <= 10 * 1024 * 1024)
        .and_then(|f| image_ext(&f.bytes).map(|ext| (f.bytes, ext)))
}

/// Re-read a blueprint page's details and picture, without downloading the blueprint again.
pub fn page_details(url: &str) -> Result<(PageMeta, Option<(Vec<u8>, &'static str)>), String> {
    page_details_with(url, false)
}

pub fn page_details_with(url: &str, allow_private: bool) -> Result<(PageMeta, Option<(Vec<u8>, &'static str)>), String> {
    let src = detect_source(url).ok_or("not a web link")?;
    let page = Url::parse(url.trim()).map_err(|_| "not a valid URL".to_string())?;
    let c = client()?;
    let f = fetch(&c, &page, allow_private)?;
    if !f.is_html { return Err("the link is a file, not a page".into()); }
    let meta = details_from_html(&String::from_utf8_lossy(&f.bytes), &page, src);
    let image = fetch_image(&c, &meta, allow_private);
    Ok((meta, image))
}

/// Image type from its first bytes; anything else (HTML error pages, SVG scripts…) is rejected.
fn image_ext(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(b"\x89PNG\r\n\x1a\n") { Some("png") }
    else if b.starts_with(&[0xFF, 0xD8, 0xFF]) { Some("jpg") }
    else if b.len() > 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WEBP" { Some("webp") }
    else if b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a") { Some("gif") }
    else { None }
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
    let mut meta = PageMeta::default();

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
        meta = details_from_html(&html, &page, src);
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

    let image = fetch_image(&c, &meta, allow_private);

    Ok(Resolved { name, sbp: sbp_bytes, cfg, source: src, url: page.to_string(), meta, image })
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
    fn reads_link_preview_tags() {
        let base = Url::parse("https://example.com/bp/1").unwrap();
        let m = page_meta(r#"<html><head><title>Fallback</title>
            <meta property="og:title" content="SFS Foundry x3 &amp; more">
            <meta name="description" content="Three   foundries">
            <meta property='og:image' content='/img/1.jpg'>
            <meta name="author" content="Ficsit Fan"><meta property="article:section" content="Production">
            <meta name="keywords" content="Steel, Foundry,steel, Modular"></head></html>"#, &base);
        assert_eq!(m.title.as_deref(), Some("SFS Foundry x3 & more"));
        assert_eq!(m.description.as_deref(), Some("Three foundries"));
        assert_eq!(m.image_url.as_deref(), Some("https://example.com/img/1.jpg"));
        assert_eq!(m.author.as_deref(), Some("Ficsit Fan"));
        assert_eq!(m.category.as_deref(), Some("Production"));
        assert_eq!(m.tags, ["Steel", "Foundry", "Modular"]);
        assert_eq!(page_meta("<title>Only &#8211; title</title>", &base).title.as_deref(), Some("Only – title"));
        assert_eq!(image_ext(b"<html>"), None);
        assert_eq!(image_ext(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("jpg"));
    }

    #[test]
    fn reads_scim_carousel_picture() {
        // shape of a SCIM details page (structure only, not copied content)
        let html = r#"<meta name="og:image" content="https://x.test/favicon.png"><img src="/logo.png">
            <div id="carouselBlueprint" class="carousel slide"><ol class="carousel-indicators"><li></li></ol>
            <div class="carousel-inner"><div class="carousel-item active">
            <img src="https://static.x.test/bp/abc-1.jpg?v=1" class="d-block w-100" alt="A &amp; B"></div>
            <div class="carousel-item"><img src="/bp/abc-2.jpg"></div></div></div>"#;
        let base = Url::parse("https://satisfactory-calculator.com/en/blueprints/index/details/id/1").unwrap();
        assert_eq!(scim_carousel_image(html, &base).as_deref(), Some("https://static.x.test/bp/abc-1.jpg?v=1"));
        assert_eq!(details_from_html(html, &base, Source::Scim).image_url.as_deref(), Some("https://static.x.test/bp/abc-1.jpg?v=1"));
        assert_eq!(details_from_html(html, &base, Source::Direct).image_url.as_deref(), Some("https://x.test/favicon.png"));
        assert_eq!(scim_carousel_image("<img src='/a.png'>", &base), None);
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
                    "/details/1" => html(r#"<html><meta property="og:title" content="SFS Foundry x3"><meta property="og:image" content="/img/1.png">
                        <meta name="keywords" content="Foundry, Steel"><a href="/login">Log in</a> <link href="/a.css">
                        <a href="/download/1/sbp">Download SBP</a> <a href="/download/1/cfg">Download SBP config</a></html>"#),
                    "/download/1/sbp" => file(b"SBP-BYTES", "SFS%20Foundry%20x3.sbp"),
                    "/download/1/cfg" => file(b"CFG-BYTES", "SFS Foundry x3.sbpcfg"),
                    "/details/2" => html("<html>Please log in to download.</html>"),
                    "/img/1.png" => HttpResponse::from_data(b"\x89PNG\r\n\x1a\nfake".to_vec()),
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
        assert_eq!(r.source, Source::Direct);
        assert_eq!(r.meta.title.as_deref(), Some("SFS Foundry x3"));
        assert_eq!(r.meta.tags, ["Foundry", "Steel"]);
        assert_eq!(r.image.as_ref().map(|(b, e)| (b.len(), *e)), Some((12, "png")));

        let r = resolve_with(&format!("{base}/files/Bus.sbp"), true).unwrap();
        assert_eq!((r.name.as_str(), r.cfg.as_deref()), ("Bus", Some(&b"BUSCFG"[..])));

        let (m, img) = page_details_with(&format!("{base}/details/1"), true).unwrap();
        assert_eq!(m.title.as_deref(), Some("SFS Foundry x3"));
        assert!(img.is_some());
        assert!(page_details_with(&format!("{base}/files/Bus.sbp"), true).is_err());

        let e = resolve_with(&format!("{base}/details/2"), true).unwrap_err();
        assert!(e.contains("Couldn't find the .sbp download"), "{e}");
        let e = resolve_with(&format!("{base}/files/page.sbp"), true).unwrap_err();
        assert!(e.contains("Couldn't find"), "{e}"); // HTML posing as .sbp is never accepted
        let e = resolve_with(&format!("{base}/missing"), true).unwrap_err();
        assert!(e.contains("404"), "{e}");
    }
}
