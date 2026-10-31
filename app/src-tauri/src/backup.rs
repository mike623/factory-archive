//! Keeping the blueprint folder in step with a WebDAV account.
//!
//! The player gives a mount point (e.g. `https://abc123.teracloud.jp/dav/`) and a token.
//! Everything the app writes lives under one reserved folder, `<mount>/.factory-archive/`:
//!
//! ```text
//! .factory-archive/
//! ├── factory-archive.json            marker: this folder belongs to Factory Archive
//! └── blueprints/<session>/<name>.sbp (+ .sbpcfg)
//! ```
//!
//! It is a mirror, not just an upload, so a blueprint deleted in the game also leaves the
//! server. That is the one destructive thing the app does, and it is fenced in:
//! - `DELETE` is only ever sent for a `.sbp` / `.sbpcfg` inside our own `blueprints/` folder,
//!   after the marker proved the folder is ours. `MOVE` and `COPY` are never sent.
//! - Nothing is removed while the local folder is empty: an unmounted drive or a moved game
//!   folder must never look like "the player deleted everything".
//! - Nothing is removed when any upload in the same run failed, so a half-synced state is
//!   never turned into a half-deleted one.
//! - An automatic run may remove at most [`AUTO_REMOVALS`] files; more than that is left for
//!   a run the player started and can see.
//! - Session folders are never deleted, not even when they end up empty, so a recursive
//!   collection delete can't take other files with it.
//! - A file only counts as uploaded after it is downloaded again and its SHA-256 matches.
//! - The reserved folder is only written to when it is empty, ours already, or the player
//!   explicitly adopted it; a folder full of other documents is refused.
//! - Session and file names come from the game's own folder and go through
//!   [`blueprints::valid_component`], so a name can never escape the reserved folder.

use reqwest::blocking::{Client, Response};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::cell::Cell;
use std::collections::{BTreeMap, BTreeSet};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;
use url::Url;

use crate::blueprints;

/// The one folder, under the player's mount point, that backups are written to.
pub const RESERVED: &str = ".factory-archive";
const MARKER: &str = "factory-archive.json";
const MARKER_BODY: &str = "{\"app\":\"factory-archive\",\"format\":1}\n";
const SETTINGS_FILE: &str = "backup.json";
const JOURNAL_FILE: &str = "backup-index.json";
/// the same state, written on the server, so a second PC or a reinstall can tell what changed
const STATE_FILE: &str = "sync-state.json";
const STATE_FORMAT: u32 = 1;
/// a single .sbp is far smaller than this; a bigger file is not a blueprint we understand
const MAX_FILE: u64 = 64 << 20;
/// one run uploads at most this much, so a mistake can't fill an account in one click
const MAX_RUN: u64 = 2 << 30;
/// the shortest gap between two automatic runs
const AUTO_EVERY: u64 = 300;
/// a file touched this recently may still be being written by the game
const QUIET: u64 = 10;
/// how many files one automatic run may remove
const AUTO_REMOVALS: usize = 50;
const PROPFIND_BODY: &str = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\
<d:propfind xmlns:d=\"DAV:\"><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>";

/* ---------- settings ---------- */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Auth {
    /// basic when a username was given, otherwise bearer; falls back to the other on a 401
    Auto,
    Basic,
    Bearer,
}

impl Default for Auth {
    fn default() -> Self { Auth::Auto }
}

/// What is stored on disk. The token leaves this file only as an `Authorization` header, or when
/// the player clicks "show" in the dialog on this machine; the [`View`] never carries it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// normalized mount point, always ending in `/`
    pub url: String,
    #[serde(default)]
    pub user: String,
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub auth: Auth,
    /// off unless the player asked for it (self-hosted boxes with their own certificate)
    #[serde(default)]
    pub allow_self_signed: bool,
    /// back up on app start / window focus, at most every [`AUTO_EVERY`] seconds
    #[serde(default)]
    pub auto: bool,
    /// mirror deletions too: a file gone from the folder is removed from the server
    #[serde(default = "yes")]
    pub remove_missing: bool,
}

fn yes() -> bool { true }

/// What the UI gets back: everything except the token itself.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub url: String,
    pub user: String,
    pub auth: Auth,
    pub allow_self_signed: bool,
    pub has_token: bool,
    /// `<host><path>/.factory-archive` for display
    pub folder: String,
    pub auto: bool,
    pub remove_missing: bool,
    /// unix seconds of the last run that finished, 0 when there has never been one
    pub last_run: u64,
}

impl View {
    pub fn empty() -> Self {
        View { url: String::new(), user: String::new(), auth: Auth::Auto, allow_self_signed: false, has_token: false, folder: String::new(), auto: false, remove_missing: true, last_run: 0 }
    }
}

/// The three fields the modal sends. An empty token means "keep the one already saved".
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Input {
    pub url: String,
    #[serde(default)]
    pub user: String,
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub auth: Auth,
    #[serde(default)]
    pub allow_self_signed: bool,
    /// mirror deletions too; defaults to on, the dialog shows it
    #[serde(default = "yes")]
    pub remove_missing: bool,
}

pub fn load(dir: &Path) -> Option<Settings> {
    let text = std::fs::read_to_string(dir.join(SETTINGS_FILE)).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn view(dir: &Path) -> View {
    match load(dir) {
        None => View::empty(),
        Some(s) => View {
            folder: folder_label(&s.url),
            url: s.url,
            user: s.user,
            auth: s.auth,
            allow_self_signed: s.allow_self_signed,
            has_token: !s.token.is_empty(),
            auto: s.auto,
            remove_missing: s.remove_missing,
            last_run: load_journal(dir).last_run,
        },
    }
}

/// Save what the modal sent, keeping the saved token when the field was left blank.
pub fn save(dir: &Path, input: Input) -> Result<View, String> {
    let old = load(dir);
    let token = if input.token.trim().is_empty() {
        old.as_ref().map(|s| s.token.clone()).unwrap_or_default()
    } else {
        input.token.trim().to_string()
    };
    if token.is_empty() {
        return Err("Enter the token (or app password) your WebDAV provider gave you.".into());
    }
    let settings = Settings {
        url: normalize_url(&input.url)?,
        user: input.user.trim().to_string(),
        token,
        auth: input.auth,
        allow_self_signed: input.allow_self_signed,
        auto: old.as_ref().map(|s| s.auto).unwrap_or(false),
        remove_missing: input.remove_missing,
    };
    if settings.auth == Auth::Basic && settings.user.is_empty() {
        return Err("Basic auth needs a username too. Leave the username empty to send the token as a bearer token.".into());
    }
    write_private(&dir.join(SETTINGS_FILE), serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?.as_bytes())?;
    Ok(view(dir))
}

/// The saved token, for the "show" button in the dialog. Only called when the player asks to see
/// it on this machine: the view never carries it, so nothing shows it by accident.
pub fn reveal(dir: &Path) -> Result<String, String> {
    match load(dir) {
        Some(s) if !s.token.is_empty() => Ok(s.token),
        _ => Err("No token is saved on this PC yet.".into()),
    }
}

pub fn forget(dir: &Path) -> Result<(), String> {
    match std::fs::remove_file(dir.join(SETTINGS_FILE)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Couldn't forget the connection: {e}")),
    }
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Couldn't save the connection: {e}"))?;
    }
    #[cfg(unix)]
    {
        // create at 0600 straight away, so the token is never briefly world-readable
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600)
            .open(path).map_err(|e| format!("Couldn't save the connection: {e}"))?;
        f.write_all(bytes).map_err(|e| format!("Couldn't save the connection: {e}"))?;
    }
    #[cfg(not(unix))]
    {
        std::fs::write(path, bytes).map_err(|e| format!("Couldn't save the connection: {e}"))?;
    }
    Ok(())
}

/// `https://host/dav/` → `host/dav/.factory-archive`
pub fn folder_label(url: &str) -> String {
    match Url::parse(url) {
        Ok(u) => format!("{}{}{}", u.host_str().unwrap_or(""), u.path(), RESERVED),
        Err(_) => String::new(),
    }
}

/// Trim, drop the query, and make sure the mount point ends in one `/`.
pub fn normalize_url(raw: &str) -> Result<String, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err("Enter the WebDAV address your provider gave you.".into());
    }
    let u = Url::parse(raw).map_err(|_| "That doesn't look like a web address. It should start with https://".to_string())?;
    if !u.username().is_empty() || u.password().is_some() {
        return Err("Put the token in the token field, not in the address.".into());
    }
    match u.scheme() {
        "https" => {}
        "http" if is_local(&u) => {}
        "http" => return Err("Use https:// so the token isn't sent in the clear. Plain http only works for a server on your own network.".into()),
        _ => return Err("Only http and https addresses work.".into()),
    }
    let mut s = u.to_string();
    if let Some(i) = s.find(['?', '#']) { s.truncate(i); }
    while s.ends_with('/') { s.pop(); }
    Ok(format!("{s}/"))
}

fn is_local(u: &Url) -> bool {
    match u.host_str() {
        None => false,
        Some(h) if h.eq_ignore_ascii_case("localhost") || h.ends_with(".local") => true,
        Some(h) => h.trim_matches(['[', ']']).parse::<std::net::IpAddr>().is_ok_and(|ip| match ip {
            std::net::IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local(),
            std::net::IpAddr::V6(v6) => v6.is_loopback() || (v6.segments()[0] & 0xfe00) == 0xfc00,
        }),
    }
}

/* ---------- what a run reports ---------- */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub session: String,
    pub name: String,
    pub ext: String,
    /// "uploaded" | "replaced" | "skipped" | "failed"
    pub status: &'static str,
    pub error: Option<String>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub total: usize,
    pub uploaded: usize,
    /// of `uploaded`, those that overwrote a different copy already on the server
    pub replaced: usize,
    pub skipped: usize,
    pub failed: usize,
    pub bytes: u64,
    /// files that were on the server and are no longer in the folder
    pub removed: usize,
    /// removal was due but held back (empty folder, failure, or too many for an automatic run)
    pub pending_removals: usize,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub files: usize,
    pub bytes: u64,
    pub uploads: usize,
    pub sessions: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestReport {
    /// "basic" or "bearer" — which one the server accepted
    pub auth: &'static str,
    pub folder_exists: bool,
    pub owned: bool,
    /// entries already in the reserved folder that aren't ours
    pub others: usize,
    pub label: String,
}

/* ---------- the journal of what we already uploaded ---------- */

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct Journal {
    /// `session/name.ext` → the SHA-256 that was verified after upload
    #[serde(default)]
    entries: BTreeMap<String, Entry>,
    /// unix seconds of the last run that finished, whatever it did
    #[serde(default)]
    last_run: u64,
    /// unix seconds of the last automatic attempt, so a failing server isn't hammered
    #[serde(default)]
    last_try: u64,
    /// the blueprint folder this state belongs to, so a different one can be spotted
    #[serde(default)]
    root: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Entry {
    sha256: String,
    size: u64,
    /// unix seconds the file was last written when it was synced; 0 when unknown
    #[serde(default)]
    mtime: u64,
    /// unix seconds
    at: u64,
}

/// The state file: what both sides agreed on last time. The same shape is kept in the app's
/// data folder and uploaded to `<mount>/.factory-archive/sync-state.json`.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StateFile {
    #[serde(default)]
    app: String,
    #[serde(default)]
    format: u32,
    #[serde(default)]
    updated_at: u64,
    #[serde(default)]
    files: BTreeMap<String, StateEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StateEntry {
    #[serde(default)]
    sha256: String,
    #[serde(default)]
    size: u64,
}

impl StateFile {
    fn from_journal(j: &Journal) -> Self {
        StateFile {
            app: "factory-archive".into(),
            format: STATE_FORMAT,
            updated_at: now(),
            files: j.entries.iter()
                .map(|(k, e)| (k.clone(), StateEntry { sha256: e.sha256.clone(), size: e.size }))
                .collect(),
        }
    }
}

fn load_journal(dir: &Path) -> Journal {
    std::fs::read_to_string(dir.join(JOURNAL_FILE)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save_journal(dir: &Path, j: &Journal) -> Result<(), String> {
    let text = serde_json::to_string_pretty(j).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!("{JOURNAL_FILE}.tmp"));
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, text).map_err(|e| format!("Couldn't write the backup index: {e}"))?;
    std::fs::rename(&tmp, dir.join(JOURNAL_FILE)).map_err(|e| format!("Couldn't write the backup index: {e}"))
}

/* ---------- the files to back up ---------- */

struct Local {
    session: String,
    name: String,
    ext: &'static str,
    path: PathBuf,
    size: u64,
}

/// A file name we treat as a blueprint. Only these are ever uploaded or removed.
fn is_blueprint(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".sbp") || lower.ends_with(".sbpcfg")
}

/// Every `.sbp` / `.sbpcfg` in the folder, with names that are safe to put in a URL.
fn local_files(root: &Path) -> Vec<Local> {
    let mut out = Vec::new();
    for session in blueprints::list_sessions(root) {
        if !blueprints::valid_component(&session.name) { continue; }
        for file in session.blueprints {
            if !blueprints::valid_component(&file.name) { continue; }
            for (ext, present) in [("sbp", file.has_sbp), ("sbpcfg", file.has_cfg)] {
                if !present { continue; }
                let path = root.join(&session.name).join(format!("{}.{ext}", file.name));
                let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(file.size);
                out.push(Local { session: session.name.clone(), name: file.name.clone(), ext, path, size });
            }
        }
    }
    out
}

pub fn plan(dir: &Path, root: &Path) -> Plan {
    let journal = load_journal(dir);
    let files = local_files(root);
    let sessions = files.iter().map(|f| f.session.as_str()).collect::<std::collections::BTreeSet<_>>().len();
    let uploads = files.iter().filter(|f| {
        let key = format!("{}/{}.{}", f.session, f.name, f.ext);
        journal.entries.get(&key).map_or(true, |e| e.size != f.size)
    }).count();
    Plan { files: files.len(), bytes: files.iter().map(|f| f.size).sum(), uploads, sessions }
}

/* ---------- talking to the server ---------- */

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode { Basic, Bearer }

impl Mode {
    fn id(self) -> &'static str { match self { Mode::Basic => "basic", Mode::Bearer => "bearer" } }
}

struct Remote {
    client: Client,
    base: Url,
    user: String,
    token: String,
    /// the modes to try, in order
    modes: Vec<Mode>,
    /// the one that worked last, tried first
    mode: Cell<Mode>,
}

impl Remote {
    fn new(s: &Settings) -> Result<Self, String> {
        let base = Url::parse(&s.url).map_err(|_| "That doesn't look like a web address.".to_string())?;
        let client = Client::builder()
            .user_agent(concat!("FactoryArchive/", env!("CARGO_PKG_VERSION"), " (Satisfactory blueprint manager)"))
            .timeout(Duration::from_secs(30))
            .danger_accept_invalid_certs(s.allow_self_signed)
            .build()
            .map_err(|e| format!("Couldn't start the connection: {e}"))?;
        let modes = match s.auth {
            Auth::Basic if s.user.is_empty() => {
                return Err("Basic auth needs a username too. Leave the username empty to send the token as a bearer token.".into());
            }
            Auth::Basic => vec![Mode::Basic],
            Auth::Bearer => vec![Mode::Bearer],
            Auth::Auto if s.user.is_empty() => vec![Mode::Bearer],
            Auth::Auto => vec![Mode::Basic, Mode::Bearer],
        };
        Ok(Remote { client, base, user: s.user.clone(), token: s.token.clone(), mode: Cell::new(modes[0]), modes })
    }

    /// `<base>/<segment>/<segment>` (trailing slash for collections).
    fn child(&self, segs: &[&str], collection: bool) -> Result<Url, String> {
        let mut url = self.base.clone();
        {
            let mut path = url.path_segments_mut().map_err(|_| "That address can't take a folder path.".to_string())?;
            path.pop_if_empty();
            for s in segs { path.push(s); }
            if collection { path.push(""); }
        }
        Ok(url)
    }

    fn send(&self, method: Method, url: &Url, body: Option<&[u8]>, depth: Option<&str>) -> Result<Response, String> {
        let first = self.mode.get();
        let mut order = vec![first];
        order.extend(self.modes.iter().copied().filter(|m| *m != first));
        for mode in order {
            let mut req = self.client.request(method.clone(), url.clone());
            req = match mode {
                Mode::Basic => req.basic_auth(&self.user, Some(&self.token)),
                Mode::Bearer => req.bearer_auth(&self.token),
            };
            if let Some(b) = body { req = req.body(b.to_vec()); }
            if let Some(d) = depth { req = req.header("Depth", d); }
            if method == Method::from_bytes(b"PROPFIND").unwrap_or(Method::GET) {
                req = req.header("Content-Type", "application/xml; charset=utf-8");
            }
            let resp = req.send().map_err(net_error)?;
            if resp.status() == reqwest::StatusCode::UNAUTHORIZED { continue; }
            self.mode.set(mode);
            return Ok(resp);
        }
        Err("The server didn't accept the token (401). Check the token, and fill in the username if your provider's WebDAV needs one.".into())
    }

    fn propfind(&self, segs: &[&str], depth: &str) -> Result<(u16, String), String> {
        let url = self.child(segs, true)?;
        let mut resp = self.send(propfind_method(), &url, Some(PROPFIND_BODY.as_bytes()), Some(depth))?;
        let status = resp.status().as_u16();
        let mut text = String::new();
        resp.read_to_string(&mut text).map_err(io_error)?;
        Ok((status, text))
    }

    /// Size of a file on the server, or `None` when it isn't there.
    fn size_of(&self, segs: &[&str]) -> Result<Option<u64>, String> {
        let url = self.child(segs, false)?;
        let mut resp = self.send(propfind_method(), &url, Some(PROPFIND_BODY.as_bytes()), Some("0"))?;
        let status = resp.status().as_u16();
        let mut text = String::new();
        resp.read_to_string(&mut text).map_err(io_error)?;
        match status {
            200 | 207 => Ok(content_length(&text)),
            404 | 410 => Ok(None),
            401 | 403 => Err("The server won't let the token read that folder (403).".into()),
            s => Err(format!("The server answered with HTTP {s}.")),
        }
    }

    fn mkcol(&self, segs: &[&str]) -> Result<(), String> {
        let url = self.child(segs, true)?;
        let resp = self.send(mkcol_method(), &url, None, None)?;
        match resp.status().as_u16() {
            // 405: already there, which is what we wanted
            200 | 201 | 204 | 405 => Ok(()),
            401 | 403 => Err("The server won't let the token create that folder (403).".into()),
            409 => Err("A folder above the backup folder is missing on the server.".into()),
            507 => Err(quota_message()),
            s => Err(format!("The server couldn't create the backup folder (HTTP {s}).")),
        }
    }

    fn put(&self, segs: &[&str], bytes: &[u8]) -> Result<(), String> {
        let url = self.child(segs, false)?;
        let resp = self.send(Method::PUT, &url, Some(bytes), None)?;
        match resp.status().as_u16() {
            200 | 201 | 204 => Ok(()),
            401 | 403 => Err("The server refused the upload (403). The token may be read-only.".into()),
            507 => Err(quota_message()),
            s => Err(format!("The upload failed (HTTP {s}).")),
        }
    }

    fn get(&self, segs: &[&str]) -> Result<Vec<u8>, String> {
        let url = self.child(segs, false)?;
        let mut resp = self.send(Method::GET, &url, None, None)?;
        match resp.status().as_u16() {
            200 => {}
            401 | 403 => return Err("The server wouldn't let the backup be read back (403).".into()),
            s => return Err(format!("The upload couldn't be read back (HTTP {s}).")),
        }
        let mut bytes = Vec::new();
        resp.by_ref().take(MAX_FILE + 1).read_to_end(&mut bytes).map_err(io_error)?;
        if bytes.len() as u64 > MAX_FILE { return Err("The server sent back an unexpectedly large file.".into()); }
        Ok(bytes)
    }

    /// Remove one file. `404` means it's already gone, which is the result we wanted.
    fn delete(&self, segs: &[&str]) -> Result<(), String> {
        let url = self.child(segs, false)?;
        let resp = self.send(Method::DELETE, &url, None, None)?;
        match resp.status().as_u16() {
            200 | 202 | 204 | 404 | 410 => Ok(()),
            401 | 403 => Err("The server won't let the token remove a file (403).".into()),
            s => Err(format!("The file couldn't be removed (HTTP {s}).")),
        }
    }

    /// Names and sizes directly inside one collection. Fake and real servers differ on whether
    /// the collection itself is listed, so the caller filters.
    fn list_dir_sized(&self, segs: &[&str]) -> Result<Vec<(String, Option<u64>)>, String> {
        let (status, text) = self.propfind(segs, "1")?;
        match status {
            200 | 207 => Ok(entries(&text)),
            404 | 410 => Ok(Vec::new()),
            401 | 403 => Err("The server won't let the token list the backup folder (403).".into()),
            s => Err(format!("The server answered with HTTP {s} when listing the backup folder.")),
        }
    }

    /// Every `.sbp` / `.sbpcfg` we put on the server, with its size.
    fn remote_blueprints(&self) -> Result<Vec<RemoteFile>, String> {
        let own = |name: &str| name == "blueprints" || name == RESERVED;
        let mut out = Vec::new();
        for (session, _) in self.list_dir_sized(&[RESERVED, "blueprints"])? {
            if session.is_empty() || own(&session) { continue; }
            for (file, size) in self.list_dir_sized(&[RESERVED, "blueprints", &session])? {
                if file.is_empty() || file == session || own(&file) || !is_blueprint(&file) { continue; }
                out.push(RemoteFile { session: session.clone(), name: file, size });
            }
        }
        Ok(out)
    }

    /// The state file on the server, when the folder has one.
    fn state(&self) -> Result<Option<StateFile>, String> {
        let url = self.child(&[RESERVED, STATE_FILE], false)?;
        let mut resp = self.send(Method::GET, &url, None, None)?;
        match resp.status().as_u16() {
            404 | 410 => return Ok(None),
            401 | 403 => return Err("The server won't let the token read the sync state (403).".into()),
            200 => {}
            s => return Err(format!("The server answered with HTTP {s} when asked for the sync state.")),
        }
        let mut body = Vec::new();
        resp.by_ref().take(1 << 20).read_to_end(&mut body).map_err(io_error)?;
        // A file we can't read is not the same as no file: copying back without a state to
        // check against could write something the player never picked.
        match serde_json::from_slice(&body) {
            Ok(state) => Ok(Some(state)),
            Err(_) => Err("The sync state on the server can't be read.".into()),
        }
    }

    /// Publish what both sides agreed on, so the next machine can tell what moved.
    fn put_state(&self, state: &StateFile) -> Result<(), String> {
        let body = serde_json::to_vec_pretty(state).map_err(|e| e.to_string())?;
        self.put(&[RESERVED, STATE_FILE], &body)
    }

    /// What is already inside the reserved folder, and whether it's ours.
    fn inspect(&self) -> Result<Inspect, String> {
        let url = self.child(&[RESERVED], true)?;
        let mut resp = self.send(propfind_method(), &url, Some(PROPFIND_BODY.as_bytes()), Some("1"))?;
        let status = resp.status().as_u16();
        let mut text = String::new();
        resp.read_to_string(&mut text).map_err(io_error)?;
        if matches!(status, 404 | 410) {
            return Ok(Inspect::default());
        }
        if matches!(status, 401 | 403) {
            return Err("The server won't let the token into that folder (403).".into());
        }
        if status != 207 && status != 200 {
            return Err(format!("The server answered with HTTP {status} when asked about the backup folder."));
        }
        let names = hrefs(&text);
        let owned = names.iter().any(|n| n == MARKER);
        // the folder lists itself; that isn't "other files"
        let others = names.iter().filter(|n| {
            !n.is_empty() && *n != MARKER && *n != STATE_FILE && *n != "blueprints" && *n != RESERVED
        }).count();
        Ok(Inspect { exists: true, owned, others })
    }
}

#[derive(Debug, Default)]
struct Inspect {
    exists: bool,
    owned: bool,
    others: usize,
}

fn propfind_method() -> Method { Method::from_bytes(b"PROPFIND").unwrap_or(Method::GET) }
fn mkcol_method() -> Method { Method::from_bytes(b"MKCOL").unwrap_or(Method::PUT) }

fn quota_message() -> String {
    "The WebDAV account is out of space (507). Free some space or use a bigger plan.".into()
}

fn io_error(e: std::io::Error) -> String {
    format!("The connection dropped while reading the answer: {e}")
}

fn net_error(e: reqwest::Error) -> String {
    if e.is_timeout() {
        "The server didn't answer in time. Check the address and your connection.".into()
    } else if e.is_connect() {
        "Couldn't reach that address. Check the URL, and that you're online.".into()
    } else {
        format!("Couldn't talk to the server: {e}")
    }
}

/// One blueprint on the server.
#[derive(Debug, Clone)]
struct RemoteFile {
    session: String,
    /// `name.ext`
    name: String,
    size: Option<u64>,
}

/// Split a PROPFIND body into one slice per `<…:response>` element, whatever prefix the server
/// uses (or none at all).
fn response_blocks(xml: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut start: Option<usize> = None;
    let mut i = 0;
    while let Some(lt) = xml[i..].find('<') {
        let at = i + lt;
        let Some(gt) = xml[at..].find('>') else { break };
        let end = at + gt;
        let tag = &xml[at + 1..end];
        let closing = tag.starts_with('/');
        let name = tag.trim_start_matches('/').split(|c: char| c.is_whitespace() || c == '/').next().unwrap_or("");
        let local = name.rsplit(':').next().unwrap_or(name).to_ascii_lowercase();
        if local == "response" {
            if closing {
                if let Some(s) = start.take() { out.push(&xml[s..=end]); }
            } else {
                start = Some(at);
            }
        }
        i = end + 1;
    }
    out
}

/// `(last path segment, size)` for every entry in a PROPFIND body.
fn entries(xml: &str) -> Vec<(String, Option<u64>)> {
    response_blocks(xml)
        .into_iter()
        .filter_map(|block| {
            let name = hrefs(block).into_iter().next()?;
            Some((name, content_length(block)))
        })
        .collect()
}

/// The last path segment of every `<D:href>…</D:href>`, percent-decoded.
fn hrefs(xml: &str) -> Vec<String> {
    let lower = xml.to_ascii_lowercase();
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(i) = lower[from..].find("href") {
        let at = from + i;
        from = at + 4;
        // walk back to just past the `<` of the tag, and skip a closing `</d:href>`
        let mut tag = at;
        while tag > 0 && lower.as_bytes()[tag - 1] != b'<' { tag -= 1; }
        if tag == 0 || lower.as_bytes()[tag] == b'/' { continue; }
        let Some(gt) = lower[from..].find('>') else { break };
        let start = from + gt + 1;
        let Some(lt) = lower[start..].find('<') else { break };
        let value = xml[start..start + lt].trim();
        from = start + lt;
        if let Some(last) = percent_decode(value).trim_end_matches('/').rsplit('/').next() {
            out.push(last.to_string());
        }
    }
    out
}

fn content_length(xml: &str) -> Option<u64> {
    let lower = xml.to_ascii_lowercase();
    let at = lower.find("getcontentlength")?;
    let gt = lower[at..].find('>')? + at + 1;
    let lt = lower[gt..].find('<')? + gt;
    xml[gt..lt].trim().parse().ok()
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn sha256(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/* ---------- the two entry points ---------- */

/// Check the connection without writing anything.
pub fn check(dir: &Path, input: Input) -> Result<TestReport, String> {
    let settings = resolve(dir, input)?;
    let remote = Remote::new(&settings)?;
    // the mount point itself must answer as WebDAV
    let (status, body) = remote.propfind(&[], "0")?;
    if !matches!(status, 200 | 207) {
        return Err(match status {
            404 => "That address answered, but it isn't a WebDAV folder (404). Copy the WebDAV URL, not the page you log in on.".into(),
            405 | 501 => "That address doesn't speak WebDAV. Check the URL your provider lists for WebDAV.".into(),
            s => format!("The server answered with HTTP {s} instead of a folder listing."),
        });
    }
    if body.is_empty() {
        return Err("That address answered, but not with a folder listing. Check the WebDAV URL.".into());
    }
    let inspect = remote.inspect()?;
    Ok(TestReport {
        auth: remote.mode.get().id(),
        folder_exists: inspect.exists,
        owned: inspect.owned,
        others: inspect.others,
        label: folder_label(&settings.url),
    })
}

/// What one file needed, decided before it is touched.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Step {
    /// the same content is already on the server
    Skipped,
    /// nothing was there
    Uploaded,
    /// a different copy was there and was overwritten
    Replaced,
}

/// How one run behaves.
#[derive(Debug, Clone, Copy)]
pub struct Options {
    /// upload everything again, even files the index says are current
    pub force: bool,
    /// write into a reserved folder that already holds other files
    pub adopt: bool,
    /// the most files one run may remove; an automatic run passes a small number
    pub max_removals: usize,
    /// the player confirmed this folder is the one they mean, after a "different folder" warning
    pub accept_new_root: bool,
}

impl Options {
    /// A run the player started: everything, with no removal cap.
    pub fn manual() -> Self { Options { force: false, adopt: false, max_removals: usize::MAX, accept_new_root: false } }
}

/// Bring the folder and the server into step: upload what changed, then remove what is gone.
pub fn run(dir: &Path, root: &Path, opts: Options, mut progress: impl FnMut(Outcome)) -> Result<Summary, String> {
    let force = opts.force;
    let adopt = opts.adopt;
    let settings = load(dir).ok_or("Connect a WebDAV account first.")?;
    let remote = Remote::new(&settings)?;
    let label = folder_label(&settings.url);

    let inspect = remote.inspect()?;
    if inspect.exists && !inspect.owned && inspect.others > 0 && !adopt {
        return Err(format!("{label} already has other files in it. Tick \"Use it anyway\" if you still want Factory Archive to write there."));
    }
    if !inspect.exists || !inspect.owned {
        remote.mkcol(&[RESERVED])?;
        remote.put(&[RESERVED, MARKER], MARKER_BODY.as_bytes())?;
    }
    remote.mkcol(&[RESERVED, "blueprints"])?;

    let files = local_files(root);
    let total_bytes: u64 = files.iter().map(|f| f.size).sum();
    if total_bytes > MAX_RUN {
        return Err("That's more than 2 GB of blueprints — too much for one backup. Back up a single world session by moving the others out of the folder for now.".into());
    }

    let mut journal = load_journal(dir);
    // A folder other than the one that was last synced might be another install or a half
    // mounted drive. Uploads are harmless there; removals are not.
    let root_changed = !journal.root.is_empty() && Path::new(&journal.root) != root;
    let local_keys: BTreeSet<String> = files.iter().map(|f| format!("{}/{}.{}", f.session, f.name, f.ext)).collect();
    let mut summary = Summary { total: files.len(), ..Default::default() };

    for file in files {
        let key = format!("{}/{}.{}", file.session, file.name, file.ext);
        let mut outcome = Outcome { session: file.session.clone(), name: file.name.clone(), ext: file.ext.to_string(), status: "uploaded", error: None };

        let result = (|| -> Result<Step, String> {
            if file.size > MAX_FILE {
                return Err(format!("It is {} — too big to be a blueprint.", human(file.size)));
            }
            let remote_name = format!("{}.{}", file.name, file.ext);
            let segs = [RESERVED, "blueprints", file.session.as_str(), remote_name.as_str()];
            let meta = std::fs::metadata(&file.path).map_err(|e| format!("Couldn't read the file: {e}"))?;
            let mtime = meta.modified().ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs()).unwrap_or(0);

            // Unchanged since the last sync (same size, same writing time) and still on the
            // server: don't even read it.
            let known = journal.entries.get(&key).is_some_and(|e| e.size == meta.len() && e.mtime == mtime && mtime != 0);
            let mut on_server: Option<u64> = None;
            if !force {
                let there = remote.size_of(&segs)?;
                if known && there == Some(meta.len()) {
                    return Ok(Step::Skipped);
                }
                on_server = there;
            }

            let bytes = std::fs::read(&file.path).map_err(|e| format!("Couldn't read the file: {e}"))?;
            let sha = sha256(&bytes);
            let size = bytes.len() as u64;

            // Merging with a folder we don't have an index for: a same-size file may well be the
            // same blueprint from another PC, so compare the content instead of blindly uploading
            // it again.
            let mut replaced = false;
            if let Some(there) = on_server {
                if there == size && remote.get(&segs).is_ok_and(|back| sha256(&back) == sha) {
                    journal.entries.insert(key.clone(), Entry { sha256: sha.clone(), size, mtime, at: now() });
                    save_journal(dir, &journal)?;
                    return Ok(Step::Skipped);
                }
                // there is a different copy; local is the truth, so it replaces it
                replaced = true;
            }

            remote.mkcol(&[RESERVED, "blueprints", &file.session])?;
            remote.put(&segs, &bytes)?;
            // the upload only counts once the server hands the same bytes back
            let back = remote.get(&segs)?;
            if sha256(&back) != sha {
                return Err("The upload didn't come back the same. It will be tried again next time.".into());
            }
            journal.entries.insert(key, Entry { sha256: sha, size, mtime, at: now() });
            save_journal(dir, &journal)?;
            Ok(if replaced { Step::Replaced } else { Step::Uploaded })
        })();

        match result {
            Ok(Step::Skipped) => { outcome.status = "skipped"; summary.skipped += 1; }
            Ok(Step::Replaced) => {
                outcome.status = "replaced";
                summary.uploaded += 1;
                summary.replaced += 1;
                summary.bytes += file.size;
            }
            Ok(Step::Uploaded) => { summary.uploaded += 1; summary.bytes += file.size; }
            Err(e) => { outcome.status = "failed"; outcome.error = Some(e); summary.failed += 1; }
        }
        progress(outcome);
    }

    /* ---- the other half of a sync: files that are no longer in the folder ---- */

    // The local folder being empty is the dangerous case: an unplugged drive, a moved game
    // folder or a fresh install must never be read as "the player deleted everything".
    let may_remove = settings.remove_missing && !local_keys.is_empty() && summary.failed == 0
        && (!root_changed || opts.accept_new_root);
    if may_remove {
        // A failed listing just leaves the server as it is; the next run tries again.
        if let Ok(remote_files) = remote.remote_blueprints() {
            let stale: Vec<RemoteFile> = remote_files
                .into_iter()
                .filter(|f| !local_keys.contains(&format!("{}/{}", f.session, f.name)))
                .collect();
            if stale.len() > opts.max_removals {
                // Too much for an unattended run: say so instead of emptying the account.
                summary.pending_removals = stale.len();
            } else {
                for file in stale {
                    let outcome = remove_one(&remote, &mut journal, &file.session, &file.name);
                    match outcome.error {
                        None => summary.removed += 1,
                        Some(_) => summary.pending_removals += 1,
                    }
                    progress(outcome);
                }
            }
        }
    }

    journal.last_run = now();
    if !root_changed || opts.accept_new_root {
        journal.root = root.display().to_string();
    }
    save_journal(dir, &journal)?;
    // publish what both sides now agree on, so a second machine can tell what moved
    // a state we can't read is replaced rather than allowed to block the upload that just worked
    if summary.uploaded > 0 || summary.removed > 0 || remote.state().ok().flatten().is_none() {
        let _ = remote.put_state(&StateFile::from_journal(&journal));
    }
    Ok(summary)
}

/// Remove one file that is gone from the folder, and forget it in the index.
fn remove_one(remote: &Remote, journal: &mut Journal, session: &str, file: &str) -> Outcome {
    let (name, ext) = file.rsplit_once('.').unwrap_or((file, ""));
    let mut outcome = Outcome {
        session: session.to_string(), name: name.to_string(), ext: ext.to_string(),
        status: "removed", error: None,
    };
    match remote.delete(&[RESERVED, "blueprints", session, file]) {
        Ok(()) => { journal.entries.remove(&format!("{session}/{file}")); }
        Err(e) => { outcome.status = "pending"; outcome.error = Some(e); }
    }
    outcome
}

/// Has the folder been untouched long enough that the game probably isn't writing right now?
fn quiet(root: &Path) -> bool {
    let newest = local_files(root).iter()
        .filter_map(|f| std::fs::metadata(&f.path).ok()?.modified().ok())
        .filter_map(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .max();
    newest.is_none_or(|t| now().saturating_sub(t) >= QUIET)
}

/// Turn the automatic run on or off, keeping the rest of the connection as it is.
pub fn set_auto(dir: &Path, on: bool) -> Result<View, String> {
    let mut settings = load(dir).ok_or("Connect a WebDAV account first.")?;
    settings.auto = on;
    let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    write_private(&dir.join(SETTINGS_FILE), text.as_bytes())?;
    Ok(view(dir))
}

/// The app-start / window-focus run. Silent by design:
/// - it only happens after a first run the player started themselves,
/// - at most once every [`AUTO_EVERY`] seconds,
/// - never while the game may still be writing,
/// - and it may remove only [`AUTO_REMOVALS`] files before asking for a real run.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoOutcome {
    /// what the comparison said; the window warns when it needs the player's decision
    pub verdict: &'static str,
    /// `None` when nothing was run
    pub summary: Option<Summary>,
}

pub fn auto(dir: &Path, root: &Path) -> Result<Option<AutoOutcome>, String> {
    let Some(settings) = load(dir) else { return Ok(None) };
    if !settings.auto { return Ok(None); }
    let journal = load_journal(dir);
    // never the first, silent one: a typo in the address shouldn't push files anywhere
    if journal.last_run == 0 { return Ok(None); }
    if now().saturating_sub(journal.last_run.max(journal.last_try)) < AUTO_EVERY { return Ok(None); }
    if !quiet(root) { return Ok(None); }

    // remember the attempt before touching the network, so a broken server isn't hit on every focus
    let mut after = load_journal(dir);
    after.last_try = now();
    let _ = save_journal(dir, &after);

    // The cloud moved, or both sides did? That is a decision for the player, not for a timer.
    let st = status(dir, root)?;
    match st.verdict {
        "in-sync" | "local-ahead" => {}
        other => return Ok(Some(AutoOutcome { verdict: other, summary: None })),
    }

    let summary = run(dir, root, Options { max_removals: AUTO_REMOVALS, ..Options::manual() }, |_| {})?;
    Ok(Some(AutoOutcome { verdict: "in-sync", summary: Some(summary) }))
}

/* ---------- which side changed? ---------- */

/// One blueprint, as far as the comparison is concerned.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub session: String,
    pub name: String,
    pub ext: String,
    /// "local-only" | "cloud-only" | "differs" | "same"
    pub kind: &'static str,
    pub local_size: u64,
    pub cloud_size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// "no-connection" | "different-folder" | "in-sync" | "local-ahead" | "cloud-ahead" | "both-changed"
    pub verdict: &'static str,
    pub local_files: usize,
    pub cloud_files: usize,
    pub changes: Vec<Change>,
    /// the folder this PC synced last time, when it isn't the one being looked at
    pub previous_root: Option<String>,
    pub last_run: u64,
    /// when the state on the server was last written
    pub cloud_state_at: u64,
}

/// Compare what is here with what is on the server, using the state file both sides keep.
/// Never downloads a blueprint: sizes and the state file are enough to say who moved.
pub fn status(dir: &Path, root: &Path) -> Result<Status, String> {
    let journal = load_journal(dir);
    let previous_root = if journal.root.is_empty() || Path::new(&journal.root) == root {
        None
    } else {
        Some(journal.root.clone())
    };
    let Some(settings) = load(dir) else {
        return Ok(Status {
            verdict: if previous_root.is_some() { "different-folder" } else { "no-connection" },
            local_files: local_files(root).len(), cloud_files: 0, changes: Vec::new(),
            previous_root, last_run: 0, cloud_state_at: 0,
        });
    };
    let remote = Remote::new(&settings)?;
    // a state we can't read only costs precision; the index here still says what this PC saw
    let state = remote.state().ok().flatten().unwrap_or_default();
    let cloud = remote.remote_blueprints()?;
    let local = local_files(root);

    let local_map: BTreeMap<String, u64> = local.iter()
        .map(|f| (format!("{}/{}.{}", f.session, f.name, f.ext), f.size)).collect();
    let cloud_map: BTreeMap<String, u64> = cloud.iter()
        .map(|f| (format!("{}/{}", f.session, f.name), f.size.unwrap_or(0))).collect();

    let mut changes = Vec::new();
    for (key, lsize) in &local_map {
        changes.push(match cloud_map.get(key) {
            None => change_of(key, "local-only", *lsize, 0),
            Some(csize) if csize == lsize => change_of(key, "same", *lsize, *csize),
            Some(csize) => change_of(key, "differs", *lsize, *csize),
        });
    }
    for (key, csize) in &cloud_map {
        if !local_map.contains_key(key) {
            changes.push(change_of(key, "cloud-only", 0, *csize));
        }
    }

    // Who moved since the last agreement? Sizes are enough in practice (a blueprint save
    // changes the size); the hashes are only used when a file is actually copied.
    let base = |key: &str| journal.entries.get(key).map(|e| e.size).or_else(|| state.files.get(key).map(|e| e.size));
    let has_base = !journal.entries.is_empty() || !state.files.is_empty();
    let mut local_changed = 0;
    let mut cloud_changed = 0;
    if has_base {
        let keys: BTreeSet<&String> = local_map.keys().chain(cloud_map.keys())
            .chain(journal.entries.keys()).chain(state.files.keys()).collect();
        for key in keys {
            let b = base(key);
            let l = local_map.get(key).copied();
            let c = cloud_map.get(key).copied();
            if moved(b, l) { local_changed += 1; }
            if moved(b, c) { cloud_changed += 1; }
        }
    } else {
        // a fresh install with no state: same-size files count as "the same"
        local_changed = local_map.keys().filter(|k| !cloud_map.contains_key(*k)).count();
        cloud_changed = cloud_map.keys().filter(|k| !local_map.contains_key(*k)).count();
    }

    let verdict = if previous_root.is_some() {
        "different-folder"
    } else if local_changed == 0 && cloud_changed == 0 {
        "in-sync"
    } else if local_changed > 0 && cloud_changed > 0 {
        "both-changed"
    } else if local_changed > 0 {
        "local-ahead"
    } else {
        "cloud-ahead"
    };

    Ok(Status {
        verdict,
        local_files: local.len(),
        cloud_files: cloud.len(),
        changes,
        previous_root,
        last_run: journal.last_run,
        cloud_state_at: state.updated_at,
    })
}

fn moved(base: Option<u64>, now: Option<u64>) -> bool {
    match (base, now) {
        (None, None) => false,
        (None, Some(_)) | (Some(_), None) => true,
        (Some(b), Some(n)) => b != n,
    }
}

fn change_of(key: &str, kind: &'static str, local_size: u64, cloud_size: u64) -> Change {
    let (session, file) = key.split_once('/').unwrap_or(("", key));
    let (name, ext) = file.rsplit_once('.').unwrap_or((file, ""));
    Change { session: session.to_string(), name: name.to_string(), ext: ext.to_string(), kind, local_size, cloud_size }
}

/* ---------- taking the cloud copy ---------- */

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullSummary {
    pub total: usize,
    pub written: usize,
    pub same: usize,
    pub failed: usize,
    pub bytes: u64,
}

/// "Use the cloud copy": bring the server's blueprints into the folder.
/// A local file that gets replaced is kept as `<name>.bak` first, never silently discarded.
/// Files that only exist here are left alone; this never deletes anything locally.
pub fn pull(dir: &Path, root: &Path, accept_new_root: bool, mut progress: impl FnMut(Outcome)) -> Result<PullSummary, String> {
    let settings = load(dir).ok_or("Connect a WebDAV account first.")?;
    let remote = Remote::new(&settings)?;
    let mut journal = load_journal(dir);
    if !accept_new_root && !journal.root.is_empty() && Path::new(&journal.root) != root {
        return Err(format!("This is a different folder than the last sync ({}). Confirm that you mean this one first.",
            journal.root));
    }
    let state = remote.state()?.unwrap_or_default();
    let cloud = remote.remote_blueprints()?;
    if cloud.is_empty() {
        return Err("There is nothing on the server to copy back yet.".into());
    }

    let mut summary = PullSummary { total: cloud.len(), ..Default::default() };
    for f in cloud {
        let (name, ext) = f.name.rsplit_once('.').unwrap_or((f.name.as_str(), ""));
        if !blueprints::valid_component(&f.session) || !blueprints::valid_component(name) {
            continue;
        }
        let key = format!("{}/{}", f.session, f.name);
        let mut outcome = Outcome {
            session: f.session.clone(), name: name.to_string(), ext: ext.to_string(),
            status: "written", error: None,
        };
        let result = (|| -> Result<bool, String> {
            let bytes = remote.get(&[RESERVED, "blueprints", &f.session, &f.name])?;
            let sha = sha256(&bytes);
            // the state file records what was uploaded; anything else is not what the player picked
            if let Some(known) = state.files.get(&key) {
                if !known.sha256.is_empty() && known.sha256 != sha {
                    return Err("The copy on the server doesn't match the sync state. Nothing was written.".into());
                }
            }
            let folder = root.join(&f.session);
            let path = folder.join(&f.name);
            if path.exists() {
                if !path.is_file() {
                    return Err("Something that isn't a file is in the way. Nothing was written.".into());
                }
                if std::fs::read(&path).is_ok_and(|old| sha256(&old) == sha) {
                    return Ok(false);
                }
                // keep the local copy next to it, then write the cloud one
                let keep = folder.join(format!("{}.bak", f.name));
                let _ = std::fs::remove_file(&keep);
                std::fs::rename(&path, &keep).map_err(|e| format!("Couldn't keep the local copy: {e}"))?;
            }
            std::fs::create_dir_all(&folder).map_err(|e| format!("Couldn't create the folder: {e}"))?;
            let mut out = std::fs::OpenOptions::new().write(true).create_new(true).open(&path)
                .map_err(|e| format!("Couldn't write the file: {e}"))?;
            std::io::Write::write_all(&mut out, &bytes).map_err(|e| format!("Couldn't write the file: {e}"))?;
            drop(out);
            // and check that what landed on disk is the cloud copy
            let back = std::fs::read(&path).map_err(|e| format!("The file didn't read back: {e}"))?;
            if sha256(&back) != sha {
                return Err("The file didn't read back the same. It will be tried again next time.".into());
            }
            let mtime = std::fs::metadata(&path).ok().and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
            journal.entries.insert(key, Entry { sha256: sha, size: bytes.len() as u64, mtime, at: now() });
            Ok(true)
        })();
        match result {
            Ok(true) => { summary.written += 1; summary.bytes += f.size.unwrap_or(0); }
            Ok(false) => summary.same += 1,
            Err(e) => { outcome.status = "failed"; outcome.error = Some(e); summary.failed += 1; }
        }
        progress(outcome);
    }

    journal.root = root.display().to_string();
    journal.last_run = now();
    save_journal(dir, &journal)?;
    let _ = remote.put_state(&StateFile::from_journal(&journal));
    Ok(summary)
}

/// The form as sent, with the saved token filled in when the field was left blank.
fn resolve(dir: &Path, input: Input) -> Result<Settings, String> {
    let saved = load(dir);
    let token = if input.token.trim().is_empty() {
        saved.as_ref().map(|s| s.token.clone()).unwrap_or_default()
    } else {
        input.token.trim().to_string()
    };
    if token.is_empty() {
        return Err("Enter the token (or app password) your WebDAV provider gave you.".into());
    }
    Ok(Settings {
        url: normalize_url(&input.url)?,
        user: input.user.trim().to_string(),
        token,
        auth: input.auth,
        allow_self_signed: input.allow_self_signed,
        auto: saved.as_ref().map(|s| s.auto).unwrap_or(false),
        remove_missing: input.remove_missing,
    })
}

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn human(bytes: u64) -> String {
    if bytes >= 1 << 30 { format!("{:.1} GB", bytes as f64 / (1u64 << 30) as f64) }
    else if bytes >= 1 << 20 { format!("{:.1} MB", bytes as f64 / (1u64 << 20) as f64) }
    else { format!("{} KB", bytes.div_ceil(1024)) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use tiny_http::{Header, Response, Server, StatusCode};

    /* ---------- a small in-process WebDAV server ---------- */

    #[derive(Clone)]
    struct Fake {
        files: Arc<Mutex<HashMap<String, Vec<u8>>>>,
        dirs: Arc<Mutex<Vec<String>>>,
        /// expected `Authorization` header, if the server checks one
        auth: Option<String>,
        puts: Arc<AtomicUsize>,
        deletes: Arc<AtomicUsize>,
        /// flips one byte on the way out, as a proxy or a broken server would
        tamper: Arc<AtomicBool>,
        /// number of bytes left, when the account is nearly full
        quota: Arc<AtomicUsize>,
    }

    impl Default for Fake {
        fn default() -> Self {
            Fake { files: Default::default(), dirs: Default::default(), auth: None, puts: Default::default(), deletes: Default::default(), tamper: Default::default(), quota: Arc::new(AtomicUsize::new(usize::MAX)) }
        }
    }

    impl Fake {
        fn with_auth(auth: &str) -> Self {
            Fake { auth: Some(auth.to_string()), ..Default::default() }
        }
        fn path(&self, url: &str) -> String {
            url.split('?').next().unwrap_or("/").to_string()
        }
        fn respond(&self, req: tiny_http::Request, code: u16, body: Vec<u8>, headers: Vec<(&str, &str)>) {
            let mut res = Response::from_data(body).with_status_code(StatusCode(code));
            for (k, v) in headers { res = res.with_header(Header::from_bytes(k.as_bytes(), v.as_bytes()).unwrap()); }
            let _ = req.respond(res);
        }
        fn handle(&self, mut req: tiny_http::Request) {
            let method = req.method().as_str().to_string();
            let path = self.path(req.url());
            if let Some(expected) = &self.auth {
                let got = req.headers().iter().find(|h| h.field.equiv("Authorization")).map(|h| h.value.as_str().to_string());
                if got.as_deref() != Some(expected.as_str()) {
                    self.respond(req, 401, Vec::new(), vec![("WWW-Authenticate", "Basic realm=\"test\"")]);
                    return;
                }
            }
            match method.as_str() {
                "MKCOL" => {
                    let full = if path.ends_with('/') { path.clone() } else { format!("{path}/") };
                    let mut dirs = self.dirs.lock().unwrap();
                    if !dirs.contains(&full) { dirs.push(full); }
                    self.respond(req, 201, Vec::new(), vec![]);
                }
                "PUT" => {
                    let mut body = Vec::new();
                    let _ = req.as_reader().read_to_end(&mut body);
                    let left = self.quota.load(Ordering::SeqCst);
                    if left != usize::MAX && body.len() > left {
                        self.respond(req, 507, Vec::new(), vec![]);
                        return;
                    }
                    if left != usize::MAX { self.quota.fetch_sub(body.len(), Ordering::SeqCst); }
                    self.puts.fetch_add(1, Ordering::SeqCst);
                    self.files.lock().unwrap().insert(path, body);
                    self.respond(req, 201, Vec::new(), vec![]);
                }
                "DELETE" => {
                    let gone = self.files.lock().unwrap().remove(&path).is_some();
                    if gone {
                        self.deletes.fetch_add(1, Ordering::SeqCst);
                        self.respond(req, 204, Vec::new(), vec![]);
                    } else {
                        self.respond(req, 404, Vec::new(), vec![]);
                    }
                }
                "GET" => {
                    let mut body = self.files.lock().unwrap().get(&path).cloned();
                    if let Some(b) = body.as_mut() {
                        if self.tamper.load(Ordering::SeqCst) && !b.is_empty() { b[0] ^= 0xff; }
                        self.respond(req, 200, b.clone(), vec![]);
                    } else {
                        self.respond(req, 404, Vec::new(), vec![]);
                    }
                }
                "PROPFIND" => {
                    let depth = req.headers().iter().find(|h| h.field.equiv("Depth")).map(|h| h.value.as_str().to_string());
                    let base = if path.ends_with('/') { path.clone() } else { format!("{path}/") };
                    let (is_file, is_dir) = {
                        let dirs = self.dirs.lock().unwrap();
                        let files = self.files.lock().unwrap();
                        let is_file = files.contains_key(&path);
                        // a collection exists once anything was created below it (or it is the mount point)
                        let is_dir = dirs.iter().any(|d| d == &path || d == &base || d.starts_with(&base))
                            || files.keys().any(|f| f.starts_with(&base))
                            || path == "/dav" || path == "/dav/";
                        (is_file, is_dir)
                    };
                    if !is_file && !is_dir {
                        self.respond(req, 404, Vec::new(), vec![]);
                        return;
                    }
                    let mut xml = String::from("<?xml version=\"1.0\"?><d:multistatus xmlns:d=\"DAV:\">");
                    if is_file {
                        let len = self.files.lock().unwrap().get(&path).map(|b| b.len()).unwrap_or(0);
                        xml += &format!("<d:response><d:href>{path}</d:href><d:propstat><d:prop>\
<d:resourcetype/><d:getcontentlength>{len}</d:getcontentlength></d:prop></d:propstat></d:response>");
                    } else {
                        xml += &format!("<d:response><d:href>{path}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>");
                        if depth.as_deref() == Some("1") {
                            let base = if path.ends_with('/') { path.clone() } else { format!("{path}/") };
                            let mut names: Vec<String> = self.dirs.lock().unwrap().iter()
                                .chain(self.files.lock().unwrap().keys())
                                .filter(|p| p.starts_with(&base) && *p != &path && *p != &base)
                                .filter(|p| !p[base.len()..].trim_end_matches('/').contains('/'))
                                .cloned().collect();
                            names.sort();
                            names.dedup();
                            for n in names {
                                let len = self.files.lock().unwrap().get(&n).map(|b| b.len()).unwrap_or(0);
                                xml += &format!("<d:response><d:href>{n}</d:href><d:propstat><d:prop>\
<d:resourcetype/><d:getcontentlength>{len}</d:getcontentlength></d:prop></d:propstat></d:response>");
                            }
                        }
                    }
                    xml += "</d:multistatus>";
                    self.respond(req, 207, xml.into_bytes(), vec![("Content-Type", "application/xml; charset=utf-8")]);
                }
                _ => self.respond(req, 405, Vec::new(), vec![]),
            }
        }
    }

    /// Start a fake server; returns its mount point (`http://127.0.0.1:PORT/dav/`).
    fn serve(fake: Fake) -> String {
        let server = Server::http("127.0.0.1:0").unwrap();
        let addr = server.server_addr().to_ip().unwrap();
        std::thread::spawn(move || {
            for req in server.incoming_requests() { fake.handle(req); }
        });
        format!("http://{addr}/dav/")
    }

    fn tmp(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("fa-backup-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    /// A blueprints folder with one world and a couple of files.
    fn library(tag: &str) -> PathBuf {
        let root = tmp(&format!("root-{tag}"));
        std::fs::create_dir_all(root.join("My World")).unwrap();
        std::fs::write(root.join("My World").join("Steel.sbp"), b"sbp-one").unwrap();
        std::fs::write(root.join("My World").join("Steel.sbpcfg"), b"cfg-one").unwrap();
        std::fs::write(root.join("My World").join("notes.txt"), b"not a blueprint").unwrap();
        root
    }

    /// Pretend every file was last written `secs` seconds ago (the game isn't writing).
    fn age(root: &Path, secs: u64) {
        let when = std::time::SystemTime::now() - std::time::Duration::from_secs(secs);
        for session in std::fs::read_dir(root).unwrap().flatten() {
            for file in std::fs::read_dir(session.path()).unwrap().flatten() {
                std::fs::File::options().write(true).open(file.path()).unwrap().set_modified(when).unwrap();
            }
        }
    }

    /// Move the recorded last run back, as if the app had been used `secs` ago.
    fn rewind(dir: &Path, secs: u64) {
        let mut j = load_journal(dir);
        j.last_run = now() - secs;
        j.last_try = 0;
        save_journal(dir, &j).unwrap();
    }

    fn settings(dir: &Path, url: &str, user: &str, token: &str) {
        save(dir, Input { url: url.to_string(), user: user.to_string(), token: token.to_string(), auth: Auth::Auto, allow_self_signed: false, remove_missing: true }).unwrap();
    }

    fn basic(user: &str, token: &str) -> String {
        use base64::Engine;
        format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(format!("{user}:{token}")))
    }

    #[test]
    fn basic_auth_uploads_then_skips() {
        let fake = Fake::with_auth(&basic("me", "sekrit"));
        let url = serve(fake.clone());
        let (dir, root) = (tmp("basic-dir"), library("basic"));
        settings(&dir, &url, "me", "sekrit");

        let mut seen = Vec::new();
        let first = run(&dir, &root, Options::manual(), |o| seen.push(o)).unwrap();
        assert_eq!((first.total, first.uploaded, first.skipped, first.failed), (2, 2, 0, 0), "{seen:?}");
        // only .sbp / .sbpcfg, never the notes
        assert_eq!(fake.puts.load(Ordering::SeqCst), 4); // two files + the marker + the state
        assert_eq!(seen[0].status, "uploaded");

        let second = run(&dir, &root, Options::manual(), |_| {}).unwrap();
        assert_eq!((second.uploaded, second.skipped, second.failed), (0, 2, 0));
        assert_eq!(fake.puts.load(Ordering::SeqCst), 4, "nothing was uploaded again");
        let keys: Vec<String> = fake.files.lock().unwrap().keys().cloned().collect();
        // everything must land inside the reserved folder, never directly on the mount point
        assert!(keys.iter().any(|k| k == "/dav/.factory-archive/blueprints/My%20World/Steel.sbp"), "{keys:?}");
        assert!(keys.iter().all(|k| k.starts_with("/dav/.factory-archive/")), "{keys:?}");
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn bearer_auth_works_and_is_reported() {
        let fake = Fake::with_auth("Bearer tok");
        let url = serve(fake.clone());
        let (dir, root) = (tmp("bearer-dir"), library("bearer"));
        settings(&dir, &url, "", "tok");
        let report = check(&dir, Input { url, user: String::new(), token: String::new(), auth: Auth::Auto, allow_self_signed: false, remove_missing: true }).unwrap();
        assert_eq!(report.auth, "bearer");
        assert!(!report.folder_exists);
        let sum = run(&dir, &root, Options::manual(), |_| {}).unwrap();
        assert_eq!(sum.uploaded, 2);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_changed_file_is_uploaded_again() {
        let fake = Fake::default();
        let url = serve(fake.clone());
        let (dir, root) = (tmp("change-dir"), library("change"));
        settings(&dir, &url, "", "tok");
        run(&dir, &root, Options::manual(), |_| {}).unwrap();
        std::fs::write(root.join("My World").join("Steel.sbp"), b"sbp-two-different").unwrap();
        let sum = run(&dir, &root, Options::manual(), |_| {}).unwrap();
        assert_eq!((sum.uploaded, sum.skipped), (1, 1));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn merging_recognises_identical_files_already_on_the_server() {
        // a reinstall or a second PC: our index is empty, but the folder is already a backup
        let fake = Fake::default();
        {
            let mut files = fake.files.lock().unwrap();
            files.insert("/dav/.factory-archive/factory-archive.json".into(), MARKER_BODY.as_bytes().to_vec());
            files.insert("/dav/.factory-archive/blueprints/My%20World/Steel.sbp".into(), b"sbp-one".to_vec());
            files.insert("/dav/.factory-archive/blueprints/My%20World/Steel.sbpcfg".into(), b"cfg-one".to_vec());
        }
        fake.dirs.lock().unwrap().push("/dav/.factory-archive/blueprints/My%20World/".into());
        let url = serve(fake.clone());
        let (dir, root) = (tmp("merge-same-dir"), library("merge-same"));
        settings(&dir, &url, "", "tok");

        let mut seen = Vec::new();
        let sum = run(&dir, &root, Options::manual(), |o| seen.push(o)).unwrap();
        assert_eq!((sum.total, sum.uploaded, sum.skipped, sum.replaced, sum.failed), (2, 0, 2, 0, 0), "{seen:?}");
        assert_eq!(fake.puts.load(Ordering::SeqCst), 1, "only the state file, no blueprint");
        // the comparison result is recorded, so the next run skips them without downloading
        assert_eq!(load_journal(&dir).entries.len(), 2);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn merging_replaces_a_different_copy_on_the_server() {
        let fake = Fake::default();
        {
            let mut files = fake.files.lock().unwrap();
            files.insert("/dav/.factory-archive/factory-archive.json".into(), MARKER_BODY.as_bytes().to_vec());
            // same size, different bytes: only a hash comparison can tell these apart
            files.insert("/dav/.factory-archive/blueprints/My%20World/Steel.sbp".into(), b"sbp-tww".to_vec());
        }
        fake.dirs.lock().unwrap().push("/dav/.factory-archive/blueprints/My%20World/".into());
        let url = serve(fake.clone());
        let (dir, root) = (tmp("merge-diff-dir"), library("merge-diff"));
        settings(&dir, &url, "", "tok");

        let mut seen = Vec::new();
        let sum = run(&dir, &root, Options::manual(), |o| seen.push(o)).unwrap();
        assert_eq!((sum.uploaded, sum.replaced, sum.skipped, sum.failed), (2, 1, 0, 0));
        assert_eq!(seen.iter().filter(|o| o.status == "replaced").count(), 1, "{seen:?}");
        // the newer local copy won
        let files = fake.files.lock().unwrap();
        let server = files.iter().find(|(k, _)| k.ends_with("/blueprints/My%20World/Steel.sbp")).map(|(_, v)| v.clone());
        assert_eq!(server.as_deref(), Some(&b"sbp-one"[..]));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_file_deleted_here_is_removed_from_the_server() {
        let fake = Fake::default();
        let url = serve(fake.clone());
        let (dir, root) = (tmp("mirror-dir"), library("mirror"));
        settings(&dir, &url, "", "tok");
        run(&dir, &root, Options::manual(), |_| {}).unwrap();
        assert!(fake.files.lock().unwrap().keys().any(|k| k.ends_with("Steel.sbpcfg")));

        // the player deletes the config half of the pair
        std::fs::remove_file(root.join("My World").join("Steel.sbpcfg")).unwrap();
        let mut seen = Vec::new();
        let sum = run(&dir, &root, Options::manual(), |o| seen.push(o)).unwrap();

        assert_eq!((sum.removed, sum.pending_removals, sum.failed), (1, 0, 0));
        assert!(seen.iter().any(|o| o.status == "removed" && o.name == "Steel" && o.ext == "sbpcfg"), "{seen:?}");
        assert_eq!(fake.deletes.load(Ordering::SeqCst), 1);
        let keys: Vec<String> = fake.files.lock().unwrap().keys().cloned().collect();
        assert!(!keys.iter().any(|k| k.ends_with("Steel.sbpcfg")), "{keys:?}");
        // the other half of the pair stays, and so does the index entry for it
        assert!(keys.iter().any(|k| k.ends_with("Steel.sbp")));
        assert!(load_journal(&dir).entries.contains_key("My World/Steel.sbp"));
        assert!(!load_journal(&dir).entries.contains_key("My World/Steel.sbpcfg"));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn an_empty_folder_never_empties_the_server() {
        // an unplugged drive, a moved game folder or a fresh install must not look like a delete
        let fake = Fake::default();
        let url = serve(fake.clone());
        let (dir, root) = (tmp("empty-dir"), library("empty"));
        settings(&dir, &url, "", "tok");
        run(&dir, &root, Options::manual(), |_| {}).unwrap();

        for f in ["Steel.sbp", "Steel.sbpcfg"] {
            std::fs::remove_file(root.join("My World").join(f)).unwrap();
        }
        let sum = run(&dir, &root, Options::manual(), |_| {}).unwrap();
        assert_eq!((sum.total, sum.removed), (0, 0));
        assert_eq!(fake.deletes.load(Ordering::SeqCst), 0, "nothing was removed");
        assert_eq!(fake.files.lock().unwrap().len(), 4, "marker, state and the two files are still there");
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn nothing_is_removed_when_an_upload_failed() {
        let fake = Fake::default();
        let url = serve(fake.clone());
        let (dir, root) = (tmp("half-dir"), library("half"));
        settings(&dir, &url, "", "tok");
        run(&dir, &root, Options::manual(), |_| {}).unwrap();

        // one file is gone here, another changed and will fail its read-back check
        std::fs::remove_file(root.join("My World").join("Steel.sbpcfg")).unwrap();
        std::fs::write(root.join("My World").join("Steel.sbp"), b"sbp-changed").unwrap();
        fake.tamper.store(true, Ordering::SeqCst);

        let sum = run(&dir, &root, Options::manual(), |_| {}).unwrap();
        assert_eq!((sum.failed, sum.removed), (1, 0), "a half-synced run leaves the server alone");
        assert_eq!(fake.deletes.load(Ordering::SeqCst), 0);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn an_automatic_run_removes_only_a_few_files() {
        let fake = Fake::default();
        let url = serve(fake.clone());
        let (dir, root) = (tmp("cap-dir"), library("cap"));
        settings(&dir, &url, "", "tok");
        run(&dir, &root, Options::manual(), |_| {}).unwrap();

        // 51 blueprints on the server that are no longer in the folder
        {
            let mut files = fake.files.lock().unwrap();
            for n in 0..51 {
                files.insert(format!("/dav/.factory-archive/blueprints/My%20World/Old {n}.sbp"), b"x".to_vec());
            }
        }
        let sum = run(&dir, &root, Options { max_removals: AUTO_REMOVALS, ..Options::manual() }, |_| {}).unwrap();
        assert_eq!((sum.removed, sum.pending_removals), (0, 51));
        assert_eq!(fake.deletes.load(Ordering::SeqCst), 0, "left for a run the player can see");
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn automatic_runs_wait_for_a_first_run_a_gap_and_a_quiet_folder() {
        let fake = Fake::default();
        let url = serve(fake.clone());
        let (dir, root) = (tmp("auto-dir"), library("auto"));
        settings(&dir, &url, "", "tok");

        // off until the player asks for it
        assert!(auto(&dir, &root).unwrap().is_none());
        set_auto(&dir, true).unwrap();

        // never silently before a run the player started
        assert!(auto(&dir, &root).unwrap().is_none());

        run(&dir, &root, Options::manual(), |_| {}).unwrap();
        assert!(auto(&dir, &root).unwrap().is_none(), "too soon after the last run");

        // due, but the files were just written: the game may still be saving
        rewind(&dir, AUTO_EVERY + 10);
        assert!(auto(&dir, &root).unwrap().is_none(), "the folder is not quiet yet");

        age(&root, 60);
        let out = auto(&dir, &root).unwrap().expect("a run was due");
        assert_eq!(out.verdict, "in-sync");
        let sum = out.summary.expect("it ran");
        assert_eq!((sum.uploaded, sum.failed), (0, 0));
        assert!(auto(&dir, &root).unwrap().is_none(), "and it doesn't run twice");
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn the_state_file_is_kept_on_both_sides() {
        let fake = Fake::default();
        let url = serve(fake.clone());
        let (dir, root) = (tmp("state-dir"), library("state"));
        settings(&dir, &url, "", "tok");
        run(&dir, &root, Options::manual(), |_| {}).unwrap();

        let local: Journal = serde_json::from_str(&std::fs::read_to_string(dir.join(JOURNAL_FILE)).unwrap()).unwrap();
        assert_eq!(local.root, root.display().to_string());
        assert!(local.entries["My World/Steel.sbp"].mtime > 0);

        let raw = fake.files.lock().unwrap().get("/dav/.factory-archive/sync-state.json").cloned()
            .expect("the state is published on the server");
        let remote_state: StateFile = serde_json::from_slice(&raw).unwrap();
        assert_eq!(remote_state.format, STATE_FORMAT);
        assert!(remote_state.files.contains_key("My World/Steel.sbp"));
        assert_eq!(remote_state.files["My World/Steel.sbp"].size, local.entries["My World/Steel.sbp"].size);
        // and the state file isn't mistaken for a stranger's document
        assert!(!fake.files.lock().unwrap().is_empty());
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn status_tells_which_side_moved() {
        let fake = Fake::default();
        let url = serve(fake.clone());
        let (dir, root) = (tmp("status-dir"), library("status"));
        settings(&dir, &url, "", "tok");
        run(&dir, &root, Options::manual(), |_| {}).unwrap();

        let fresh = status(&dir, &root).unwrap();
        assert_eq!(fresh.verdict, "in-sync", "{:?}", fresh.changes);
        assert_eq!((fresh.local_files, fresh.cloud_files), (2, 2));

        // a local edit
        std::fs::write(root.join("My World").join("Steel.sbp"), b"sbp edited here").unwrap();
        let st = status(&dir, &root).unwrap();
        assert_eq!(st.verdict, "local-ahead");
        assert!(st.changes.iter().any(|c| c.kind == "differs" && c.name == "Steel"));

        // the other machine pushed a newer copy of a different file
        fake.files.lock().unwrap().insert(
            "/dav/.factory-archive/blueprints/My%20World/Steel.sbp".into(), b"cloud version!".to_vec());
        let st = status(&dir, &root).unwrap();
        assert_eq!(st.verdict, "both-changed");
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_cloud_only_file_is_reported_when_the_cloud_moved() {
        let fake = Fake::default();
        let url = serve(fake.clone());
        let (dir, root) = (tmp("cloud-dir"), library("cloud"));
        settings(&dir, &url, "", "tok");
        run(&dir, &root, Options::manual(), |_| {}).unwrap();

        fake.files.lock().unwrap().insert(
            "/dav/.factory-archive/blueprints/My%20World/New.sbp".into(), b"from another pc".to_vec());
        let st = status(&dir, &root).unwrap();
        assert_eq!(st.verdict, "cloud-ahead");
        assert!(st.changes.iter().any(|c| c.kind == "cloud-only" && c.name == "New"));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn using_the_cloud_copy_keeps_the_local_file_as_bak() {
        let fake = Fake::default();
        let url = serve(fake.clone());
        let (dir, root) = (tmp("pull-dir"), library("pull"));
        settings(&dir, &url, "", "tok");
        run(&dir, &root, Options::manual(), |_| {}).unwrap();

        // the local copy drifts away from the backup
        let path = root.join("My World").join("Steel.sbp");
        std::fs::write(&path, b"local mess").unwrap();
        let mut seen = Vec::new();
        let sum = pull(&dir, &root, false, |o| seen.push(o)).unwrap();

        assert_eq!((sum.total, sum.written, sum.failed), (2, 1, 0), "{seen:?}");
        assert_eq!(std::fs::read(&path).unwrap(), b"sbp-one");
        assert_eq!(std::fs::read(root.join("My World").join("Steel.sbp.bak")).unwrap(), b"local mess");
        // the untouched pair member is not copied again
        assert_eq!(std::fs::read(root.join("My World").join("Steel.sbpcfg")).unwrap(), b"cfg-one");
        assert_eq!(status(&dir, &root).unwrap().verdict, "in-sync");
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_restored_file_that_does_not_match_the_state_is_refused() {
        let fake = Fake::default();
        let url = serve(fake.clone());
        let (dir, root) = (tmp("pull-bad-dir"), library("pull-bad"));
        settings(&dir, &url, "", "tok");
        run(&dir, &root, Options::manual(), |_| {}).unwrap();

        // something on the server replaced the file behind the state's back
        fake.files.lock().unwrap().insert(
            "/dav/.factory-archive/blueprints/My%20World/Steel.sbp".into(), b"not the state's bytes".to_vec());
        std::fs::remove_file(root.join("My World").join("Steel.sbp")).unwrap();
        let sum = pull(&dir, &root, false, |_| {}).unwrap();
        assert_eq!(sum.failed, 1);
        assert!(!root.join("My World").join("Steel.sbp").exists(), "nothing was written");
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_different_folder_uploads_but_never_removes_until_confirmed() {
        let fake = Fake::default();
        let url = serve(fake.clone());
        let (dir, first) = (tmp("repoint-dir"), library("repoint-a"));
        let second = tmp("repoint-root-b");
        std::fs::create_dir_all(second.join("Other World")).unwrap();
        std::fs::write(second.join("Other World").join("Slab.sbp"), b"other").unwrap();
        settings(&dir, &url, "", "tok");
        run(&dir, &first, Options::manual(), |_| {}).unwrap();

        // the game now points somewhere else: upload, but leave the other world's backup alone
        let sum = run(&dir, &second, Options::manual(), |_| {}).unwrap();
        assert_eq!((sum.uploaded, sum.removed), (1, 0));
        assert_eq!(fake.deletes.load(Ordering::SeqCst), 0);
        assert_eq!(status(&dir, &second).unwrap().verdict, "different-folder");

        // once the player confirms this really is the folder, a sync may mirror it
        let sum = run(&dir, &second, Options { accept_new_root: true, ..Options::manual() }, |_| {}).unwrap();
        assert_eq!(sum.removed, 2);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&first).ok();
        std::fs::remove_dir_all(&second).ok();
    }

    #[test]
    fn an_automatic_run_stops_when_the_cloud_moved() {
        let fake = Fake::default();
        let url = serve(fake.clone());
        let (dir, root) = (tmp("auto-cloud-dir"), library("auto-cloud"));
        settings(&dir, &url, "", "tok");
        run(&dir, &root, Options::manual(), |_| {}).unwrap();
        set_auto(&dir, true).unwrap();
        rewind(&dir, AUTO_EVERY + 10);
        age(&root, 60);

        fake.files.lock().unwrap().insert(
            "/dav/.factory-archive/blueprints/My%20World/Steel.sbp".into(), b"a newer cloud copy".to_vec());
        let out = auto(&dir, &root).unwrap().expect("it looked");
        assert_eq!(out.verdict, "cloud-ahead");
        assert!(out.summary.is_none(), "nothing was run");
        // the cloud copy is untouched, and so is the local one
        assert_eq!(std::fs::read(root.join("My World").join("Steel.sbp")).unwrap(), b"sbp-one");
        assert_eq!(fake.deletes.load(Ordering::SeqCst), 0);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_readback_that_differs_is_a_failure() {
        let fake = Fake::default();
        fake.tamper.store(true, Ordering::SeqCst);
        let url = serve(fake.clone());
        let (dir, root) = (tmp("tamper-dir"), library("tamper"));
        settings(&dir, &url, "", "tok");
        let mut seen = Vec::new();
        let sum = run(&dir, &root, Options::manual(), |o| seen.push(o)).unwrap();
        assert_eq!(sum.failed, 2);
        assert!(seen.iter().all(|o| o.status == "failed" && o.error.as_deref().unwrap_or("").contains("come back")), "{seen:?}");
        // nothing was recorded, so the next run tries again
        assert!(load_journal(&dir).entries.is_empty());
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_bad_token_is_one_clear_error() {
        let fake = Fake::with_auth(&basic("me", "right"));
        let url = serve(fake);
        let (dir, root) = (tmp("auth-dir"), library("auth"));
        settings(&dir, &url, "me", "wrong");
        let err = run(&dir, &root, Options::manual(), |_| {}).unwrap_err();
        assert!(err.contains("401"), "{err}");
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_full_account_says_so() {
        let fake = Fake::default();
        fake.quota.store(1, Ordering::SeqCst);
        let url = serve(fake);
        let (dir, root) = (tmp("quota-dir"), library("quota"));
        settings(&dir, &url, "", "tok");
        // the very first write (the folder marker) already hits the limit
        let err = run(&dir, &root, Options::manual(), |_| {}).unwrap_err();
        assert!(err.contains("out of space"), "{err}");
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_foreign_folder_is_refused_until_adopted() {
        let fake = Fake::default();
        fake.files.lock().unwrap().insert("/dav/.factory-archive/taxes.pdf".into(), b"private".to_vec());
        let url = serve(fake.clone());
        let (dir, root) = (tmp("adopt-dir"), library("adopt"));
        settings(&dir, &url, "", "tok");
        let err = run(&dir, &root, Options::manual(), |_| {}).unwrap_err();
        assert!(err.contains("other files"), "{err}");
        let sum = run(&dir, &root, Options { adopt: true, ..Options::manual() }, |_| {}).unwrap();
        assert_eq!(sum.uploaded, 2);
        // the player's document is still there, untouched
        assert!(fake.files.lock().unwrap().contains_key("/dav/.factory-archive/taxes.pdf"));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn names_are_percent_encoded_per_segment() {
        let root = tmp("names-root");
        std::fs::create_dir_all(root.join("My World")).unwrap();
        std::fs::write(root.join("My World").join("Big #1 & co.sbp"), b"x").unwrap();
        let dir = tmp("names-dir");
        let settings = Settings { url: "http://127.0.0.1:1/dav/".into(), user: String::new(), token: "t".into(), auth: Auth::Auto, allow_self_signed: false, auto: false, remove_missing: true };
        let remote = Remote::new(&settings).unwrap();
        let url = remote.child(&["blueprints", "My World", "Big #1 & co.sbp"], false).unwrap();
        assert_eq!(url.path(), "/dav/blueprints/My%20World/Big%20%231%20&%20co.sbp");
        assert!(url.as_str().contains("%23") && url.as_str().contains("%20"));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn urls_are_normalized_and_credentials_rejected() {
        assert_eq!(normalize_url(" https://abc.teracloud.jp/dav ").unwrap(), "https://abc.teracloud.jp/dav/");
        assert_eq!(normalize_url("https://abc.teracloud.jp/dav/?x=1#y").unwrap(), "https://abc.teracloud.jp/dav/");
        assert!(normalize_url("https://user:pw@abc.teracloud.jp/dav/").unwrap_err().contains("token field"));
        assert!(normalize_url("http://example.com/dav/").unwrap_err().contains("https"));
        assert!(normalize_url("http://127.0.0.1:8080/dav/").is_ok());
        assert!(normalize_url("").is_err());
        assert!(normalize_url("nonsense").is_err());
    }

    #[test]
    fn the_token_is_only_handed_over_when_asked() {
        let dir = tmp("reveal-dir");
        assert!(reveal(&dir).is_err(), "nothing saved yet");
        save(&dir, Input { url: "https://h/dav".into(), user: "me".into(), token: "sekrit".into(), auth: Auth::Auto, allow_self_signed: false, remove_missing: true }).unwrap();
        // the everyday path never carries it ...
        assert!(!serde_json::to_string(&view(&dir)).unwrap().contains("sekrit"));
        // ... the explicit one does
        assert_eq!(reveal(&dir).unwrap(), "sekrit");
        forget(&dir).unwrap();
        assert!(reveal(&dir).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_saved_token_is_never_handed_back() {
        let dir = tmp("settings-dir");
        let view = save(&dir, Input { url: "https://h/dav".into(), user: "me".into(), token: "sekrit".into(), auth: Auth::Basic, allow_self_signed: false, remove_missing: true }).unwrap();
        assert!(view.has_token);
        assert_eq!(view.folder, "h/dav/.factory-archive");
        let json = serde_json::to_string(&view).unwrap();
        assert!(!json.contains("sekrit"));
        // saving again without a token keeps the old one
        let input = Input { url: "https://h/dav".into(), user: "me".into(), token: String::new(), auth: Auth::Auto, allow_self_signed: false, remove_missing: true };
        assert_eq!(resolve(&dir, input).unwrap().token, "sekrit");
        forget(&dir).unwrap();
        assert!(view_of(&dir).is_none());
        std::fs::remove_dir_all(&dir).ok();
    }

    fn view_of(dir: &Path) -> Option<View> {
        load(dir).map(|_| view(dir))
    }

    #[test]
    fn hrefs_and_lengths_are_read_from_a_listing() {
        let xml = "<?xml version=\"1.0\"?><d:multistatus xmlns:d=\"DAV:\">\
<d:response><d:href>/dav/.factory-archive/</d:href></d:response>\
<d:response><d:href>/dav/.factory-archive/factory-archive.json</d:href><d:getcontentlength>41</d:getcontentlength></d:response>\
<d:response><d:href>/dav/.factory-archive/blueprints/</d:href></d:response>\
<d:response><d:href>/dav/.factory-archive/My%20World/</d:href></d:response></d:multistatus>";
        assert_eq!(hrefs(xml), vec![".factory-archive", "factory-archive.json", "blueprints", "My World"]);
        assert_eq!(content_length(xml), Some(41));
    }

    #[test]
    fn plan_counts_files_without_network() {
        let (dir, root) = (tmp("plan-dir"), library("plan"));
        let p = plan(&dir, &root);
        assert_eq!((p.files, p.uploads, p.sessions), (2, 2, 1));
        assert!(p.bytes > 0);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&root).ok();
    }
}
