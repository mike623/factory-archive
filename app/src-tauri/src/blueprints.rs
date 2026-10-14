//! Reading and writing blueprint files inside a game's `blueprints` folder.
//!
//! Layout: `<root>/<session name>/<blueprint name>.sbp` (+ optional `.sbpcfg`).
//! Every name that arrives from outside (the share page) goes through
//! [`valid_component`] so it can never escape `<root>`.

use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BlueprintFile {
    pub name: String,
    pub has_sbp: bool,
    pub has_cfg: bool,
    /// size of the .sbp in bytes
    pub size: u64,
    /// newest modification time of the pair, unix seconds
    pub modified: u64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub name: String,
    pub blueprints: Vec<BlueprintFile>,
}

#[derive(Debug, PartialEq)]
pub enum BpError {
    BadName,
    NotFound,
    Exists,
    Io(String),
}

impl std::fmt::Display for BpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BpError::BadName => write!(f, "invalid session or blueprint name"),
            BpError::NotFound => write!(f, "not found"),
            BpError::Exists => write!(f, "a blueprint with that name already exists in this session"),
            BpError::Io(e) => write!(f, "{e}"),
        }
    }
}

fn io(e: std::io::Error) -> BpError {
    if e.kind() == ErrorKind::NotFound { BpError::NotFound } else { BpError::Io(e.to_string()) }
}

/// A single file or folder name that is safe on Windows and macOS and cannot traverse.
pub fn valid_component(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s != "."
        && s != ".."
        && !s.starts_with(' ')
        && !s.ends_with(' ')
        && !s.ends_with('.')
        && !s.chars().any(|c| c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
}

pub fn is_blueprint_ext(ext: &str) -> bool {
    ext == "sbp" || ext == "sbpcfg"
}

fn modified(p: &Path) -> SystemTime {
    fs::metadata(p).and_then(|m| m.modified()).unwrap_or(SystemTime::UNIX_EPOCH)
}

/// All session folders under `root`, most recently changed first, each with its blueprints.
pub fn list_sessions(root: &Path) -> Vec<Session> {
    let Ok(entries) = fs::read_dir(root) else { return Vec::new() };
    let mut dirs: Vec<(SystemTime, Session)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() { continue; }
        let name = entry.file_name().to_string_lossy().into_owned();
        let mut by_name: BTreeMap<String, BlueprintFile> = BTreeMap::new();
        let mut newest = modified(&path);
        if let Ok(files) = fs::read_dir(&path) {
            for f in files.flatten() {
                let fp = f.path();
                let (Some(stem), Some(ext)) = (fp.file_stem(), fp.extension()) else { continue };
                let ext = ext.to_string_lossy().to_ascii_lowercase();
                if !is_blueprint_ext(&ext) { continue; }
                newest = newest.max(modified(&fp));
                let stem = stem.to_string_lossy().into_owned();
                let e = by_name.entry(stem.clone()).or_insert(BlueprintFile {
                    name: stem, has_sbp: false, has_cfg: false, size: 0, modified: 0,
                });
                let secs = modified(&fp).duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
                e.modified = e.modified.max(secs);
                if ext == "sbp" {
                    e.has_sbp = true;
                    e.size = f.metadata().map(|m| m.len()).unwrap_or(0);
                } else {
                    e.has_cfg = true;
                }
            }
        }
        dirs.push((newest, Session { name, blueprints: by_name.into_values().collect() }));
    }
    dirs.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.name.cmp(&b.1.name)));
    dirs.into_iter().map(|(_, s)| s).collect()
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CurrentSession {
    pub name: String,
    /// "autosave" (from the newest `<session>_autosave_<n>.sav`) or "blueprints" (newest session folder)
    pub source: &'static str,
}

/// `<session>_autosave_<n>` → `<session>`
fn session_from_autosave(stem: &str) -> Option<&str> {
    let (session, n) = stem.rsplit_once("_autosave_")?;
    (!session.is_empty() && !n.is_empty() && n.chars().all(|c| c.is_ascii_digit())).then_some(session)
}

/// Best guess at the world the host is playing. `root` is the `blueprints` folder; saves live in
/// sibling per-account folders: `SaveGames/<account id>/*.sav`.
pub fn detect_current(root: &Path) -> Option<CurrentSession> {
    let mut newest: Option<(SystemTime, String)> = None;
    if let Some(save_games) = root.parent() {
        for account in fs::read_dir(save_games).into_iter().flatten().flatten() {
            let dir = account.path();
            if !dir.is_dir() || dir == root { continue; }
            for f in fs::read_dir(&dir).into_iter().flatten().flatten() {
                let fp = f.path();
                if fp.extension().map(|e| e.eq_ignore_ascii_case("sav")) != Some(true) { continue; }
                let Some(stem) = fp.file_stem().map(|s| s.to_string_lossy().into_owned()) else { continue };
                let Some(session) = session_from_autosave(&stem) else { continue };
                let t = modified(&fp);
                if newest.as_ref().map_or(true, |(nt, _)| t > *nt) { newest = Some((t, session.to_string())); }
            }
        }
    }
    if let Some((_, name)) = newest.filter(|(_, n)| valid_component(n)) {
        return Some(CurrentSession { name, source: "autosave" });
    }
    list_sessions(root).into_iter().next().map(|s| CurrentSession { name: s.name, source: "blueprints" })
}

fn file_path(root: &Path, session: &str, name: &str, ext: &str) -> Result<PathBuf, BpError> {
    if !valid_component(session) || !valid_component(name) || !is_blueprint_ext(ext) {
        return Err(BpError::BadName);
    }
    Ok(root.join(session).join(format!("{name}.{ext}")))
}

pub fn read_file(root: &Path, session: &str, name: &str, ext: &str) -> Result<Vec<u8>, BpError> {
    fs::read(file_path(root, session, name, ext)?).map_err(io)
}

/// Write a blueprint pair into an existing session folder. Never overwrites.
/// `create_session` makes the session folder if it's missing (the game only creates it once a
/// blueprint is saved in that world).
pub fn write_blueprint(root: &Path, session: &str, name: &str, sbp: &[u8], cfg: Option<&[u8]>, create_session: bool) -> Result<(), BpError> {
    let sbp_path = file_path(root, session, name, "sbp")?;
    let cfg_path = file_path(root, session, name, "sbpcfg")?;
    if !root.join(session).is_dir() {
        if !create_session { return Err(BpError::NotFound); }
        fs::create_dir_all(root.join(session)).map_err(io)?;
    }
    if sbp_path.exists() || cfg_path.exists() { return Err(BpError::Exists); }
    fs::write(&sbp_path, sbp).map_err(io)?;
    if let Some(cfg) = cfg {
        if let Err(e) = fs::write(&cfg_path, cfg) {
            let _ = fs::remove_file(&sbp_path);
            return Err(io(e));
        }
    }
    Ok(())
}

/// Result of adding one blueprint, for the UI to report.
#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub name: String,
    pub ok: bool,
    pub error: Option<String>,
}

impl Outcome {
    fn from(name: &str, r: Result<(), BpError>) -> Self {
        match r {
            Ok(()) => Outcome { name: name.into(), ok: true, error: None },
            Err(e) => Outcome { name: name.into(), ok: false, error: Some(e.to_string()) },
        }
    }
}

/// Add blueprint files given as `(file name, bytes)` to `session`, pairing `X.sbp` with `X.sbpcfg`.
/// Files with other extensions are ignored; a lone `.sbpcfg` is reported, since `.sbp` is required.
pub fn import_named(root: &Path, session: &str, files: Vec<(String, Vec<u8>)>) -> Vec<Outcome> {
    let mut pairs: BTreeMap<String, (Option<Vec<u8>>, Option<Vec<u8>>)> = BTreeMap::new();
    for (file, bytes) in files {
        let Some((stem, ext)) = file.rsplit_once('.') else { continue };
        let entry = pairs.entry(stem.to_string()).or_default();
        match ext.to_ascii_lowercase().as_str() {
            "sbp" => entry.0 = Some(bytes),
            "sbpcfg" => entry.1 = Some(bytes),
            _ => {}
        }
    }
    pairs
        .into_iter()
        .filter(|(_, (sbp, cfg))| sbp.is_some() || cfg.is_some())
        .map(|(name, (sbp, cfg))| match sbp {
            None => Outcome { name, ok: false, error: Some("missing the .sbp file (the .sbpcfg alone isn't a blueprint)".into()) },
            Some(sbp) => {
                let r = write_blueprint(root, session, &name, &sbp, cfg.as_deref(), true);
                Outcome::from(&name, r)
            }
        })
        .collect()
}

/// Read blueprint files from anywhere on disk (e.g. Downloads) and add them to `session`.
pub fn import_paths(root: &Path, session: &str, paths: &[PathBuf]) -> Vec<Outcome> {
    let mut files = Vec::new();
    let mut failed = Vec::new();
    for p in paths {
        let Some(file) = p.file_name().map(|f| f.to_string_lossy().into_owned()) else { continue };
        let ext_ok = p.extension().map(|e| is_blueprint_ext(&e.to_string_lossy().to_ascii_lowercase())) == Some(true);
        if !ext_ok { continue; }
        match fs::read(p) {
            Ok(b) => files.push((file, b)),
            Err(e) => failed.push(Outcome { name: file, ok: false, error: Some(e.to_string()) }),
        }
    }
    let mut out = import_named(root, session, files);
    out.extend(failed);
    out
}

/// Copy a blueprint (and its .sbpcfg if present) from one world session to another. Never overwrites.
pub fn copy_between(root: &Path, from: &str, name: &str, to: &str) -> Result<(), BpError> {
    if from == to { return Err(BpError::Exists); }
    let sbp = read_file(root, from, name, "sbp")?;
    let cfg = read_file(root, from, name, "sbpcfg").ok();
    write_blueprint(root, to, name, &sbp, cfg.as_deref(), true)
}

pub fn copy_outcome(root: &Path, from: &str, name: &str, to: &str) -> Outcome {
    Outcome::from(name, copy_between(root, from, name, to))
}

/// Rename a blueprint (its `.sbp` and `.sbpcfg` if present) inside its session. The game shows the
/// file name as the blueprint's name. Never overwrites another blueprint; a change of letter case
/// only is allowed on case-insensitive disks (Windows, macOS), where the "other" file is itself.
pub fn rename(root: &Path, session: &str, from: &str, to: &str) -> Result<(), BpError> {
    let (old_sbp, old_cfg) = (file_path(root, session, from, "sbp")?, file_path(root, session, from, "sbpcfg")?);
    let (new_sbp, new_cfg) = (file_path(root, session, to, "sbp")?, file_path(root, session, to, "sbpcfg")?);
    if from == to { return Ok(()); }
    if !old_sbp.is_file() { return Err(BpError::NotFound); }
    let case_only = from.to_lowercase() == to.to_lowercase();
    // exact names in the folder: on a case-insensitive disk `new_sbp.exists()` is true for the source itself
    let listed: Vec<String> = fs::read_dir(root.join(session)).map_err(io)?
        .flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    let taken = |p: &Path| {
        let file = p.file_name().unwrap().to_string_lossy();
        listed.iter().any(|f| *f == file) || (!case_only && p.exists())
    };
    if taken(&new_sbp) || taken(&new_cfg) { return Err(BpError::Exists); }
    fs::rename(&old_sbp, &new_sbp).map_err(io)?;
    if old_cfg.is_file() {
        if let Err(e) = fs::rename(&old_cfg, &new_cfg) {
            let _ = fs::rename(&new_sbp, &old_sbp);
            return Err(io(e));
        }
    }
    Ok(())
}

/// The files to remove for a blueprint: its .sbp and, if present, its .sbpcfg.
pub fn files_of(root: &Path, session: &str, name: &str) -> Result<Vec<PathBuf>, BpError> {
    let (sbp, cfg) = (file_path(root, session, name, "sbp")?, file_path(root, session, name, "sbpcfg")?);
    if !sbp.is_file() { return Err(BpError::NotFound); }
    Ok([sbp, cfg].into_iter().filter(|p| p.is_file()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("fa-bp-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn rejects_traversal_and_bad_names() {
        for bad in ["", ".", "..", "../x", "a/b", "a\\b", "C:", "x?", "trailing.", " lead", "nul\0"] {
            assert!(!valid_component(bad), "{bad:?} should be rejected");
        }
        for ok in ["My Session", "Steel 360-min (v2)", "Ünïcødé"] {
            assert!(valid_component(ok), "{ok:?} should be accepted");
        }
    }

    #[test]
    fn lists_sessions_and_pairs() {
        let root = tmp("list");
        fs::create_dir_all(root.join("Alpha")).unwrap();
        fs::write(root.join("Alpha/Smelter.sbp"), b"12345").unwrap();
        fs::write(root.join("Alpha/Smelter.sbpcfg"), b"c").unwrap();
        fs::write(root.join("Alpha/Loose.sbp"), b"1").unwrap();
        fs::write(root.join("Alpha/notes.txt"), b"x").unwrap();
        fs::create_dir_all(root.join("Empty")).unwrap();

        let s = list_sessions(&root);
        let alpha = s.iter().find(|s| s.name == "Alpha").unwrap();
        assert_eq!(alpha.blueprints.len(), 2);
        let smelter = alpha.blueprints.iter().find(|b| b.name == "Smelter").unwrap();
        assert!(smelter.has_sbp && smelter.has_cfg);
        assert_eq!(smelter.size, 5);
        assert!(smelter.modified > 0);
        let loose = alpha.blueprints.iter().find(|b| b.name == "Loose").unwrap();
        assert!(loose.has_sbp && !loose.has_cfg);
        assert!(s.iter().any(|s| s.name == "Empty"));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn detects_current_session() {
        let base = tmp("current");
        let root = base.join("blueprints");
        fs::create_dir_all(root.join("Old World")).unwrap();
        fs::write(root.join("Old World/a.sbp"), b"x").unwrap();
        // no saves yet → newest blueprint folder
        assert_eq!(detect_current(&root), Some(CurrentSession { name: "Old World".into(), source: "blueprints" }));

        let acct = base.join("76561198000000000");
        fs::create_dir_all(&acct).unwrap();
        fs::write(acct.join("My manual save.sav"), b"x").unwrap(); // ignored: not an autosave
        assert_eq!(detect_current(&root).unwrap().source, "blueprints");
        fs::write(acct.join("Old World_autosave_0.sav"), b"x").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(acct.join("Steel Town_autosave_2.sav"), b"x").unwrap();
        assert_eq!(detect_current(&root), Some(CurrentSession { name: "Steel Town".into(), source: "autosave" }));

        assert_eq!(session_from_autosave("A_autosave_12"), Some("A"));
        assert_eq!(session_from_autosave("A_autosave_"), None);
        assert_eq!(session_from_autosave("A_autosave_x"), None);
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn imports_pairs_and_copies_between_worlds() {
        let base = tmp("import");
        let root = base.join("blueprints");
        fs::create_dir_all(root.join("Old")).unwrap();

        let out = import_named(&root, "New World", vec![
            ("Steel.sbp".into(), b"S".to_vec()),
            ("Steel.sbpcfg".into(), b"C".to_vec()),
            ("Lonely.sbpcfg".into(), b"C".to_vec()),
            ("readme.txt".into(), b"x".to_vec()),
            ("../evil.sbp".into(), b"x".to_vec()),
        ]);
        let get = |n: &str| out.iter().find(|o| o.name == n).cloned().unwrap();
        assert!(get("Steel").ok);
        assert!(!get("Lonely").ok);
        assert!(!get("../evil").ok);
        assert_eq!(out.len(), 3);
        assert_eq!(fs::read(root.join("New World/Steel.sbpcfg")).unwrap(), b"C");

        // from paths on disk (e.g. Downloads)
        let dl = base.join("Downloads");
        fs::create_dir_all(&dl).unwrap();
        fs::write(dl.join("Bus.sbp"), b"B").unwrap();
        fs::write(dl.join("photo.png"), b"x").unwrap();
        let out = import_paths(&root, "Old", &[dl.join("Bus.sbp"), dl.join("photo.png")]);
        assert_eq!(out, vec![Outcome { name: "Bus".into(), ok: true, error: None }]);

        // copy between worlds, with and without .sbpcfg, never overwriting
        assert!(copy_outcome(&root, "New World", "Steel", "Old").ok);
        assert_eq!(fs::read(root.join("Old/Steel.sbpcfg")).unwrap(), b"C");
        assert!(copy_outcome(&root, "Old", "Bus", "Fresh").ok);
        assert!(!root.join("Fresh/Bus.sbpcfg").exists());
        assert!(!copy_outcome(&root, "Old", "Steel", "New World").ok);
        assert!(!copy_outcome(&root, "Old", "Steel", "Old").ok);
        assert!(!copy_outcome(&root, "Old", "Missing", "New World").ok);
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn writes_without_overwriting() {
        let root = tmp("write");
        fs::create_dir_all(root.join("World")).unwrap();
        write_blueprint(&root, "World", "Steel", b"sbp", Some(b"cfg"), false).unwrap();
        assert_eq!(read_file(&root, "World", "Steel", "sbp").unwrap(), b"sbp");
        assert_eq!(read_file(&root, "World", "Steel", "sbpcfg").unwrap(), b"cfg");
        assert_eq!(write_blueprint(&root, "World", "Steel", b"new", None, false), Err(BpError::Exists));
        assert_eq!(write_blueprint(&root, "Missing", "X", b"x", None, false), Err(BpError::NotFound));
        assert_eq!(write_blueprint(&root, "..", "X", b"x", None, true), Err(BpError::BadName));
        write_blueprint(&root, "New World", "First", b"x", None, true).unwrap();
        assert!(root.join("New World/First.sbp").is_file());
        assert_eq!(read_file(&root, "World", "../../etc", "sbp"), Err(BpError::BadName));
        assert_eq!(read_file(&root, "World", "Steel", "exe"), Err(BpError::BadName));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn lists_files_to_delete() {
        let root = tmp("delete");
        fs::create_dir_all(root.join("World")).unwrap();
        write_blueprint(&root, "World", "Pair", b"S", Some(b"C"), false).unwrap();
        write_blueprint(&root, "World", "Solo", b"S", None, false).unwrap();
        assert_eq!(files_of(&root, "World", "Pair").unwrap().len(), 2);
        assert_eq!(files_of(&root, "World", "Solo").unwrap(), [root.join("World").join("Solo.sbp")]);
        assert!(matches!(files_of(&root, "World", "Missing"), Err(BpError::NotFound)));
        assert!(matches!(files_of(&root, "World", "../x"), Err(BpError::BadName)));
        assert!(matches!(files_of(&root, "..", "Pair"), Err(BpError::BadName)));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn renames_pairs_without_overwriting() {
        let root = tmp("rename");
        fs::create_dir_all(root.join("World")).unwrap();
        write_blueprint(&root, "World", "Steel", b"S", Some(b"C"), false).unwrap();
        write_blueprint(&root, "World", "Bus", b"B", None, false).unwrap();

        rename(&root, "World", "Steel", "Steel v2").unwrap();
        assert_eq!(read_file(&root, "World", "Steel v2", "sbp").unwrap(), b"S");
        assert_eq!(read_file(&root, "World", "Steel v2", "sbpcfg").unwrap(), b"C");
        assert!(!root.join("World/Steel.sbp").exists() && !root.join("World/Steel.sbpcfg").exists());

        rename(&root, "World", "Bus", "Main Bus").unwrap();
        assert!(root.join("World/Main Bus.sbp").is_file());
        assert!(!root.join("World/Main Bus.sbpcfg").exists());

        assert_eq!(rename(&root, "World", "Main Bus", "Steel v2"), Err(BpError::Exists));
        assert_eq!(read_file(&root, "World", "Main Bus", "sbp").unwrap(), b"B");
        // case-only change works on case-insensitive and case-sensitive disks alike
        rename(&root, "World", "Main Bus", "main bus").unwrap();
        assert!(fs::read_dir(root.join("World")).unwrap().flatten().any(|e| e.file_name() == "main bus.sbp"));
        assert_eq!(rename(&root, "World", "Missing", "X"), Err(BpError::NotFound));
        assert_eq!(rename(&root, "World", "main bus", "../escape"), Err(BpError::BadName));
        assert_eq!(rename(&root, "World", "main bus", ""), Err(BpError::BadName));
        fs::remove_dir_all(&root).ok();
    }
}
