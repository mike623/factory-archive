//! Details about blueprints that the game files don't carry: where a blueprint came from,
//! its page's title, description, author, category, tags and picture.
//!
//! Stored in the app's data folder (never the game folder), keyed by a hash of the .sbp
//! contents, so the details follow a blueprint when it's copied to another world or renamed.

use crate::resolve::Resolved;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct BlueprintMeta {
    /// "scim" | "sbp" | "url" | "local"
    pub source: String,
    pub source_url: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub author: Option<String>,
    pub category: Option<String>,
    pub tags: Vec<String>,
    pub site_name: Option<String>,
    /// file name of the saved picture inside the store, e.g. "<key>.jpg"
    pub image_file: Option<String>,
    /// unix seconds
    pub imported_at: u64,
}

/// Content fingerprint of a .sbp (first 128 bits of SHA-256, hex).
pub fn key(sbp: &[u8]) -> String {
    let d = Sha256::digest(sbp);
    d[..16].iter().map(|b| format!("{b:02x}")).collect()
}

fn valid_key(k: &str) -> bool {
    k.len() == 32 && k.bytes().all(|b| b.is_ascii_hexdigit())
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub struct MetaStore {
    dir: PathBuf,
    /// (path, size, mtime) → key, so rescans don't re-hash unchanged files
    keys: Mutex<HashMap<(PathBuf, u64, u64), String>>,
}

impl MetaStore {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir, keys: Mutex::new(HashMap::new()) }
    }

    pub fn load(&self, key: &str) -> Option<BlueprintMeta> {
        if !valid_key(key) { return None; }
        let raw = fs::read(self.dir.join(format!("{key}.json"))).ok()?;
        serde_json::from_slice(&raw).ok()
    }

    pub fn save(&self, key: &str, meta: &BlueprintMeta, image: Option<(&[u8], &str)>) -> Result<(), String> {
        if !valid_key(key) { return Err("bad key".into()); }
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let mut meta = meta.clone();
        if let Some((bytes, ext)) = image {
            let file = format!("{key}.{ext}");
            fs::write(self.dir.join(&file), bytes).map_err(|e| e.to_string())?;
            meta.image_file = Some(file);
        }
        let json = serde_json::to_vec_pretty(&meta).map_err(|e| e.to_string())?;
        fs::write(self.dir.join(format!("{key}.json")), json).map_err(|e| e.to_string())
    }

    /// Record a blueprint downloaded from a link, with its page details and picture.
    pub fn save_resolved(&self, r: &Resolved) -> Result<String, String> {
        let k = key(&r.sbp);
        let m = &r.meta;
        let meta = BlueprintMeta {
            source: r.source.id().into(),
            source_url: Some(r.url.clone()),
            title: m.title.clone(),
            description: m.description.clone(),
            author: m.author.clone(),
            category: m.category.clone(),
            tags: m.tags.clone(),
            site_name: m.site_name.clone(),
            image_file: None,
            imported_at: now(),
        };
        self.save(&k, &meta, r.image.as_ref().map(|(b, e)| (b.as_slice(), *e)))?;
        Ok(k)
    }

    /// Mark a locally added file, unless richer details are already stored for it.
    pub fn note_local(&self, sbp: &[u8]) {
        let k = key(sbp);
        if self.load(&k).is_none() {
            let _ = self.save(&k, &BlueprintMeta { source: "local".into(), imported_at: now(), ..Default::default() }, None);
        }
    }

    /// Key for a .sbp on disk, cached by size + modification time.
    pub fn key_for_file(&self, path: &Path) -> Option<String> {
        let md = fs::metadata(path).ok()?;
        let mtime = md.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_secs();
        let id = (path.to_path_buf(), md.len(), mtime);
        if let Some(k) = self.keys.lock().ok()?.get(&id) { return Some(k.clone()); }
        let k = key(&fs::read(path).ok()?);
        self.keys.lock().ok()?.insert(id, k.clone());
        Some(k)
    }

    /// The saved picture as a data: URL, for the UI.
    pub fn image_data_url(&self, key: &str) -> Option<String> {
        let file = self.load(key)?.image_file?;
        let ext = file.rsplit('.').next()?.to_string();
        if file != format!("{key}.{ext}") { return None; }
        let bytes = fs::read(self.dir.join(&file)).ok()?;
        let mime = match ext.as_str() { "png" => "image/png", "webp" => "image/webp", "gif" => "image/gif", _ => "image/jpeg" };
        Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_details_and_pictures_by_content() {
        let dir = std::env::temp_dir().join(format!("fa-meta-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let store = MetaStore::new(dir.clone());
        let k = key(b"SBP");
        assert_eq!(k.len(), 32);
        assert!(store.load(&k).is_none());

        let m = BlueprintMeta { source: "scim".into(), title: Some("SFS Foundry x3".into()), tags: vec!["Steel".into()], ..Default::default() };
        store.save(&k, &m, Some((b"\x89PNG..", "png"))).unwrap();
        let back = store.load(&k).unwrap();
        assert_eq!(back.title.as_deref(), Some("SFS Foundry x3"));
        assert_eq!(back.image_file.as_deref(), Some(format!("{k}.png").as_str()));
        assert!(store.image_data_url(&k).unwrap().starts_with("data:image/png;base64,"));

        // a later local add of the same content doesn't overwrite the richer details
        store.note_local(b"SBP");
        assert_eq!(store.load(&k).unwrap().source, "scim");
        store.note_local(b"OTHER");
        assert_eq!(store.load(&key(b"OTHER")).unwrap().source, "local");

        // keys from the UI are validated
        assert!(store.load("../../etc/passwd").is_none());
        assert!(store.image_data_url("zz").is_none());

        // file keys are cached and follow content
        let f = dir.join("a.sbp");
        fs::write(&f, b"SBP").unwrap();
        assert_eq!(store.key_for_file(&f).as_deref(), Some(k.as_str()));
        fs::remove_dir_all(&dir).ok();
    }
}
