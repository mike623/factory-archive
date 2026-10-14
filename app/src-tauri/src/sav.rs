//! The game's own blueprint categories, read (never written) from a world's `.sav`.
//!
//! The game keeps categories in the save, not in the blueprint files: the game state carries
//! an `ArrayProperty` named `mBlueprintCategoryRecords` of `BlueprintCategoryRecord` structs
//! (`CategoryName`, `SubCategoryRecords`, …); each `BlueprintSubCategoryRecord` has
//! `SubCategoryName` and `BlueprintNames` (array of blueprint names).
//!
//! Layout (Satisfactory 1.0+, header version ≥ 14), as documented by public save parsers:
//! - header: i32 header version, i32 save version, i32 build, FString save name, FString map,
//!   FString map options, FString session name, …; then the same zlib chunks as `.sbp`.
//! - body: Unreal tagged properties. Tag = FString name ("None" ends a list), FString type,
//!   i32 size, i32 index, type metadata (Struct: FString + 16-byte GUID; Array/Set: FString inner;
//!   Map: 2 FStrings; Byte/Enum: FString; Bool: u8), u8 has-GUID (+16 bytes), then `size` bytes.
//!
//! Every size is checked; anything that doesn't add up is an error, never a guess.

use crate::sbp::{read_body, Reader, CHUNK_TAG};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

const MAX_SAVE_BODY: usize = 1 << 30;
const PROP: &str = "mBlueprintCategoryRecords";

/// blueprint name → (category, sub-category)
pub type Categories = HashMap<String, (String, String)>;

/// Session name from a save's header; `None` for older saves or anything unexpected.
pub fn session_name(head: &[u8]) -> Option<String> {
    let mut r = Reader::new(head);
    if r.i32().ok()? < 14 { return None; }
    let (_save_version, _build) = (r.i32().ok()?, r.i32().ok()?);
    let (_save_name, _map, _options) = (r.fstring().ok()?, r.fstring().ok()?, r.fstring().ok()?);
    r.fstring().ok().filter(|s| !s.is_empty())
}

/// The newest `.sav` whose header names `session`. `root` is the `blueprints` folder; saves live
/// in sibling per-account folders.
pub fn latest_save(root: &Path, session: &str) -> Option<PathBuf> {
    let save_games = root.parent()?;
    let mut best: Option<(SystemTime, PathBuf)> = None;
    for account in fs::read_dir(save_games).ok()?.flatten() {
        let dir = account.path();
        if !dir.is_dir() || dir == root { continue; }
        for f in fs::read_dir(&dir).into_iter().flatten().flatten() {
            let p = f.path();
            if p.extension().map(|e| e.eq_ignore_ascii_case("sav")) != Some(true) { continue; }
            let t = f.metadata().and_then(|m| m.modified()).unwrap_or(SystemTime::UNIX_EPOCH);
            if best.as_ref().is_some_and(|(bt, _)| t <= *bt) { continue; }
            let mut head = Vec::new();
            if fs::File::open(&p).and_then(|fh| fh.take(64 * 1024).read_to_end(&mut head)).is_err() { continue; }
            if session_name(&head).as_deref() == Some(session) { best = Some((t, p)); }
        }
    }
    best.map(|(_, p)| p)
}

/// Read the category records from a whole `.sav` file.
pub fn read_categories(sav: &[u8]) -> Result<Categories, String> {
    let start = (12..sav.len().saturating_sub(8))
        .find(|&i| sav[i..i + 4] == CHUNK_TAG.to_le_bytes() && sav[i + 4..i + 8] == 0x2222_2222u32.to_le_bytes())
        .ok_or("not a save file")?;
    categories_in_body(&read_body(&sav[start..], MAX_SAVE_BODY)?)
}

fn categories_in_body(body: &[u8]) -> Result<Categories, String> {
    let mut needle = ((PROP.len() + 1) as i32).to_le_bytes().to_vec();
    needle.extend(PROP.as_bytes());
    needle.push(0);
    let Some(at) = body.windows(needle.len()).position(|w| w == needle) else {
        return Ok(Categories::new()); // the world has never had a category
    };
    let mut r = Reader::new(body);
    r.p = at;
    let t = tag(&mut r)?.ok_or("bad category data")?;
    if t.ty != "ArrayProperty" || t.inner != "StructProperty" { return Err("unexpected category data".into()); }
    let mut out = Categories::new();
    sized(&mut r, t.size, |r| struct_array(r, |r| {
        let (mut cat, mut subs) = (String::new(), Vec::new());
        props(r, |t, r| Ok(match t.name.as_str() {
            "CategoryName" if t.ty == "StrProperty" => { cat = r.fstring()?; true }
            "SubCategoryRecords" if t.ty == "ArrayProperty" && t.inner == "StructProperty" => {
                struct_array(r, |r| {
                    let (mut sub, mut names) = (String::new(), Vec::new());
                    props(r, |t, r| Ok(match t.name.as_str() {
                        "SubCategoryName" if t.ty == "StrProperty" => { sub = r.fstring()?; true }
                        "BlueprintNames" if t.ty == "ArrayProperty" && t.inner == "StrProperty" => {
                            for _ in 0..r.count(1_000_000)? { names.push(r.fstring()?); }
                            true
                        }
                        _ => false,
                    }))?;
                    subs.push((sub, names));
                    Ok(())
                })?;
                true
            }
            _ => false,
        }))?;
        for (sub, names) in subs {
            for n in names { out.entry(n).or_insert_with(|| (cat.clone(), sub.clone())); }
        }
        Ok(())
    }))?;
    Ok(out)
}

struct Tag { name: String, ty: String, size: usize, inner: String }

fn tag(r: &mut Reader) -> Result<Option<Tag>, String> {
    let name = r.fstring()?;
    if name == "None" { return Ok(None); }
    let ty = r.fstring()?;
    let size = usize::try_from(r.i32()?).map_err(|_| "bad property size")?;
    let _index = r.i32()?;
    let mut inner = String::new();
    match ty.as_str() {
        "StructProperty" => { inner = r.fstring()?; r.take(16)?; }
        "ArrayProperty" | "SetProperty" | "ByteProperty" | "EnumProperty" => inner = r.fstring()?,
        "MapProperty" => { r.fstring()?; r.fstring()?; }
        "BoolProperty" => { r.u8()?; }
        _ => {}
    }
    if r.u8()? != 0 { r.take(16)?; }
    Ok(Some(Tag { name, ty, size, inner }))
}

/// Run `f` on a value that must take exactly `size` bytes.
fn sized(r: &mut Reader, size: usize, f: impl FnOnce(&mut Reader) -> Result<(), String>) -> Result<(), String> {
    let start = r.p;
    f(r)?;
    if r.p - start != size { return Err("category data didn't match its stated size".into()); }
    Ok(())
}

/// A property list up to "None". `f` reads the values it knows and returns true; others are skipped.
fn props(r: &mut Reader, mut f: impl FnMut(&Tag, &mut Reader) -> Result<bool, String>) -> Result<(), String> {
    while let Some(t) = tag(r)? {
        let start = r.p;
        if !f(&t, r)? { r.take(t.size)?; }
        if r.p - start != t.size { return Err(format!("property {} didn't match its stated size", t.name)); }
    }
    Ok(())
}

/// Value of an array of structs: count, one inner tag, then each element's property list.
fn struct_array(r: &mut Reader, mut each: impl FnMut(&mut Reader) -> Result<(), String>) -> Result<(), String> {
    let n = r.count(100_000)?;
    let t = tag(r)?.ok_or("bad category data")?;
    sized(r, t.size, |r| { for _ in 0..n { each(r)?; } Ok(()) })
}

/// Categories per save file, re-read only when the file changes.
#[derive(Default)]
pub struct CategoryCache(Mutex<HashMap<PathBuf, (SystemTime, u64, Result<Categories, String>)>>);

impl CategoryCache {
    /// Categories of the session's newest save; empty when there's no save for it.
    // ponytail: inflates the whole save (can be hundreds of MB) once per change; stream it if that hurts.
    pub fn for_session(&self, root: &Path, session: &str) -> Result<Categories, String> {
        let Some(path) = latest_save(root, session) else { return Ok(Categories::new()) };
        let md = fs::metadata(&path).map_err(|e| e.to_string())?;
        let stamp = (md.modified().unwrap_or(SystemTime::UNIX_EPOCH), md.len());
        let mut cache = self.0.lock().unwrap();
        if let Some((t, len, c)) = cache.get(&path) {
            if (*t, *len) == stamp { return c.clone(); }
        }
        let c = fs::read(&path).map_err(|e| e.to_string()).and_then(|b| read_categories(&b));
        cache.insert(path, (stamp.0, stamp.1, c.clone()));
        c
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn fstr(v: &mut Vec<u8>, s: &str) {
        v.extend(((s.len() + 1) as i32).to_le_bytes());
        v.extend(s.as_bytes());
        v.push(0);
    }
    /// tag header + value
    fn prop(name: &str, ty: &str, meta: &[u8], value: &[u8]) -> Vec<u8> {
        let mut v = Vec::new();
        fstr(&mut v, name);
        fstr(&mut v, ty);
        v.extend((value.len() as i32).to_le_bytes());
        v.extend(0i32.to_le_bytes());
        v.extend(meta);
        v.push(0);
        v.extend(value);
        v
    }
    fn s(x: &str) -> Vec<u8> { let mut v = Vec::new(); fstr(&mut v, x); v }
    fn str_prop(name: &str, val: &str) -> Vec<u8> { prop(name, "StrProperty", &[], &s(val)) }
    fn struct_array(name: &str, struct_name: &str, elems: &[Vec<u8>]) -> Vec<u8> {
        let body: Vec<u8> = elems.iter().flat_map(|e| { let mut e = e.clone(); e.extend(s("None")); e }).collect();
        let mut val = (elems.len() as i32).to_le_bytes().to_vec();
        let mut meta = s(struct_name);
        meta.extend([0u8; 16]);
        val.extend(prop(name, "StructProperty", &meta, &body));
        prop(name, "ArrayProperty", &s("StructProperty"), &val)
    }
    fn sub(name: &str, bps: &[&str]) -> Vec<u8> {
        let mut v = str_prop("SubCategoryName", name);
        v.extend(prop("MenuPriority", "FloatProperty", &[], &1f32.to_le_bytes()));
        v.extend(prop("IsUndefined", "ByteProperty", &s("None"), &[0]));
        let mut names = (bps.len() as i32).to_le_bytes().to_vec();
        for b in bps { names.extend(s(b)); }
        v.extend(prop("BlueprintNames", "ArrayProperty", &s("StrProperty"), &names));
        v
    }
    fn cat(name: &str, subs: &[Vec<u8>]) -> Vec<u8> {
        let mut v = str_prop("CategoryName", name);
        v.extend(prop("IconID", "IntProperty", &[], &(-1i32).to_le_bytes()));
        v.extend(prop("IsUndefined", "BoolProperty", &[0], &[]));
        v.extend(struct_array("SubCategoryRecords", "BlueprintSubCategoryRecord", subs));
        v
    }
    fn synthetic_sav(session: &str, body: &[u8]) -> Vec<u8> {
        let mut v = Vec::new();
        for x in [14i32, 52, 463028] { v.extend(x.to_le_bytes()); }
        for x in ["My save", "Persistent_Level", "?startloc=Grass Fields", session] { fstr(&mut v, x); }
        v.extend([7u8; 40]); // rest of the header
        let mut z = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
        z.write_all(body).unwrap();
        let c = z.finish().unwrap();
        v.extend(CHUNK_TAG.to_le_bytes());
        v.extend(0x2222_2222u32.to_le_bytes());
        v.extend(131072u64.to_le_bytes());
        v.push(3);
        for x in [c.len() as u64, body.len() as u64, c.len() as u64, body.len() as u64] { v.extend(x.to_le_bytes()); }
        v.extend(&c);
        v
    }
    fn game_state() -> Vec<u8> {
        let mut body = b"...other objects...".to_vec();
        body.extend(prop("mUnrelated", "IntProperty", &[], &5i32.to_le_bytes()));
        body.extend(struct_array(PROP, "BlueprintCategoryRecord", &[
            cat("Production", &[sub("Steel", &["Steel Beams", "Steel Pipes"]), sub("Undefined", &["Loose"])]),
            cat("Power", &[sub("Coal", &["Coal 8x"])]),
        ]));
        body.extend(s("None"));
        body
    }

    #[test]
    fn reads_categories_from_a_save() {
        let sav = synthetic_sav("Steel Town", &game_state());
        assert_eq!(session_name(&sav).as_deref(), Some("Steel Town"));
        let c = read_categories(&sav).unwrap();
        assert_eq!(c.len(), 4);
        assert_eq!(c["Steel Pipes"], ("Production".into(), "Steel".into()));
        assert_eq!(c["Loose"], ("Production".into(), "Undefined".into()));
        assert_eq!(c["Coal 8x"], ("Power".into(), "Coal".into()));
    }

    #[test]
    fn no_records_and_damage() {
        assert!(read_categories(&synthetic_sav("A", b"nothing here")).unwrap().is_empty());
        assert!(read_categories(b"not a save at all, no chunks").is_err());
        // a size that doesn't add up is an error, not a guess
        let mut bad = game_state();
        let at = bad.windows(9).position(|w| w == b"Steel Bea").unwrap();
        bad[at - 4] = 40;
        assert!(read_categories(&synthetic_sav("A", &bad)).is_err());
        let mut old = synthetic_sav("A", b"");
        old[0] = 13;
        assert_eq!(session_name(&old), None);
    }

    #[test]
    fn finds_the_newest_save_of_a_session() {
        let base = std::env::temp_dir().join(format!("fa-sav-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let (root, acct) = (base.join("blueprints"), base.join("12345"));
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&acct).unwrap();
        fs::write(acct.join("other.sav"), synthetic_sav("Other", b"")).unwrap();
        fs::write(acct.join("manual name.sav"), synthetic_sav("Steel Town", &game_state())).unwrap();
        assert_eq!(latest_save(&root, "Steel Town"), Some(acct.join("manual name.sav")));
        assert_eq!(latest_save(&root, "Nope"), None);
        let cache = CategoryCache::default();
        assert_eq!(cache.for_session(&root, "Steel Town").unwrap()["Coal 8x"].1, "Coal");
        assert!(cache.for_session(&root, "Nope").unwrap().is_empty());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn real_save_if_provided() {
        let Ok(path) = std::env::var("FA_SAMPLE_SAV") else { return };
        let b = fs::read(&path).unwrap();
        println!("session {:?}", session_name(&b));
        println!("{:#?}", read_categories(&b).unwrap());
    }
}
