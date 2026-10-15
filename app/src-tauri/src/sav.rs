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
//!   An array of structs holds a count, one inner StructProperty tag, then the elements.
//! - Satisfactory 1.1+ (UE 5.4+) writes newer tags: FString name, then the type as a tree
//!   (FString name, i32 parameter count, each parameter a tree: `ArrayProperty(StructProperty(Rec(/Script/…)))`),
//!   i32 size, u8 flags (1 = i32 array index follows, 2 = 16-byte GUID follows, 4 = extensions,
//!   0x10 = bool true), then `size` bytes. Arrays of structs drop the inner tag: count, then the elements.
//!   Which one a save uses is decided from the category tag itself; checked against a real 1.1 save.
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
    let v2 = is_v2(body, at)?;
    let mut r = Reader::new(body);
    r.p = at;
    let t = tag(&mut r, v2)?.ok_or("bad category data")?;
    if t.ty != "ArrayProperty" || t.inner != "StructProperty" { return Err("unexpected category data".into()); }
    let mut out = Categories::new();
    sized(&mut r, t.size, |r| struct_array(r, v2, |r| {
        // the game's own "Undefined" buckets (named in the player's language) become ""
        let (mut cat, mut cat_undef, mut subs) = (String::new(), false, Vec::new());
        props(r, v2, |t, r| Ok(match t.name.as_str() {
            "CategoryName" if t.ty == "StrProperty" => { cat = r.fstring()?; true }
            "IsUndefined" if t.ty == "BoolProperty" => { cat_undef = t.on; false }
            "SubCategoryRecords" if t.ty == "ArrayProperty" && t.inner == "StructProperty" => {
                struct_array(r, v2, |r| {
                    let (mut sub, mut undef, mut names) = (String::new(), false, Vec::new());
                    props(r, v2, |t, r| Ok(match t.name.as_str() {
                        "SubCategoryName" if t.ty == "StrProperty" => { sub = r.fstring()?; true }
                        "IsUndefined" if t.ty == "ByteProperty" && t.size == 1 => { undef = r.u8()? != 0; true }
                        "BlueprintNames" if t.ty == "ArrayProperty" && t.inner == "StrProperty" => {
                            for _ in 0..r.count(1_000_000)? { names.push(r.fstring()?); }
                            true
                        }
                        _ => false,
                    }))?;
                    subs.push((if undef { String::new() } else { sub }, names));
                    Ok(())
                })?;
                true
            }
            _ => false,
        }))?;
        if cat_undef { cat.clear(); }
        for (sub, names) in subs {
            for n in names { out.entry(n).or_insert_with(|| (cat.clone(), sub.clone())); }
        }
        Ok(())
    }))?;
    Ok(out)
}

/// `on` is a BoolProperty's value (it lives in the tag, not the value bytes)
struct Tag { name: String, ty: String, size: usize, inner: String, on: bool }

/// Tag of a property list, in the old (`v2 = false`) or the UE 5.4+ format.
fn tag(r: &mut Reader, v2: bool) -> Result<Option<Tag>, String> {
    let name = r.fstring()?;
    if name == "None" { return Ok(None); }
    if v2 {
        let (ty, inner) = type_name(r, 0)?;
        let size = usize::try_from(r.i32()?).map_err(|_| "bad property size")?;
        let flags = r.u8()?;
        if flags & 4 != 0 { return Err(format!("property {name} uses an unsupported tag extension")); }
        if flags & 1 != 0 { r.i32()?; }
        if flags & 2 != 0 { r.take(16)?; }
        return Ok(Some(Tag { name, ty, size, inner, on: flags & 0x10 != 0 }));
    }
    let ty = r.fstring()?;
    let size = usize::try_from(r.i32()?).map_err(|_| "bad property size")?;
    let _index = r.i32()?;
    let (mut inner, mut on) = (String::new(), false);
    match ty.as_str() {
        "StructProperty" => { inner = r.fstring()?; r.take(16)?; }
        "ArrayProperty" | "SetProperty" | "ByteProperty" | "EnumProperty" => inner = r.fstring()?,
        "MapProperty" => { r.fstring()?; r.fstring()?; }
        "BoolProperty" => on = r.u8()? != 0,
        _ => {}
    }
    if r.u8()? != 0 { r.take(16)?; }
    Ok(Some(Tag { name, ty, size, inner, on }))
}

/// UE 5.4+ property type: name and parameter trees. Returns the name and its first parameter's name.
fn type_name(r: &mut Reader, depth: u32) -> Result<(String, String), String> {
    if depth > 8 { return Err("bad property type".into()); }
    let name = r.fstring()?;
    let mut first = String::new();
    for i in 0..r.count(16)? {
        let (p, _) = type_name(r, depth + 1)?;
        if i == 0 { first = p; }
    }
    Ok((name, first))
}

/// Does the tag at `p` (the category records) use the UE 5.4+ format? There the type name
/// `ArrayProperty` is followed by its parameter count (1) and `StructProperty`; in the old format
/// by the value size, an index of 0, and then `StructProperty`.
fn is_v2(body: &[u8], p: usize) -> Result<bool, String> {
    let mut r = Reader::new(body);
    r.p = p;
    r.fstring()?;
    if r.fstring()? != "ArrayProperty" { return Err("unexpected category data".into()); }
    Ok(r.i32()? == 1 && r.fstring().ok().as_deref() == Some("StructProperty"))
}

/// Run `f` on a value that must take exactly `size` bytes.
fn sized(r: &mut Reader, size: usize, f: impl FnOnce(&mut Reader) -> Result<(), String>) -> Result<(), String> {
    let start = r.p;
    f(r)?;
    if r.p - start != size { return Err("category data didn't match its stated size".into()); }
    Ok(())
}

/// A property list up to "None". `f` reads the values it knows and returns true; others are skipped.
fn props(r: &mut Reader, v2: bool, mut f: impl FnMut(&Tag, &mut Reader) -> Result<bool, String>) -> Result<(), String> {
    while let Some(t) = tag(r, v2)? {
        let start = r.p;
        if !f(&t, r)? { r.take(t.size)?; }
        if r.p - start != t.size { return Err(format!("property {} didn't match its stated size", t.name)); }
    }
    Ok(())
}

/// Value of an array of structs: count, one inner tag (old format only), then each element's property list.
fn struct_array(r: &mut Reader, v2: bool, mut each: impl FnMut(&mut Reader) -> Result<(), String>) -> Result<(), String> {
    let n = r.count(100_000)?;
    if v2 { for _ in 0..n { each(r)?; } return Ok(()); }
    let t = tag(r, v2)?.ok_or("bad category data")?;
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
    /// tag header + value. `ty` is the type and its parameter chain (`["ArrayProperty", "StructProperty"]`);
    /// the old format keeps only the first parameter. `on` is a BoolProperty's value.
    fn prop(v2: bool, name: &str, ty: &[&str], on: bool, value: &[u8]) -> Vec<u8> {
        let mut v = Vec::new();
        fstr(&mut v, name);
        if v2 {
            for (i, t) in ty.iter().enumerate() {
                fstr(&mut v, t);
                v.extend((if i + 1 < ty.len() { 1i32 } else { 0 }).to_le_bytes());
            }
            v.extend((value.len() as i32).to_le_bytes());
            v.push(if on { 0x10 } else { 0 });
        } else {
            fstr(&mut v, ty[0]);
            v.extend((value.len() as i32).to_le_bytes());
            v.extend(0i32.to_le_bytes());
            match ty[0] {
                "StructProperty" => { v.extend(s(ty[1])); v.extend([0u8; 16]); }
                "ArrayProperty" | "ByteProperty" => v.extend(s(ty[1])),
                "BoolProperty" => v.push(on as u8),
                _ => {}
            }
            v.push(0);
        }
        v.extend(value);
        v
    }
    fn s(x: &str) -> Vec<u8> { let mut v = Vec::new(); fstr(&mut v, x); v }
    fn str_prop(v2: bool, name: &str, val: &str) -> Vec<u8> { prop(v2, name, &["StrProperty"], false, &s(val)) }
    fn struct_array(v2: bool, name: &str, struct_name: &str, elems: &[Vec<u8>]) -> Vec<u8> {
        let body: Vec<u8> = elems.iter().flat_map(|e| { let mut e = e.clone(); e.extend(s("None")); e }).collect();
        let mut val = (elems.len() as i32).to_le_bytes().to_vec();
        if v2 { val.extend(body); } else { val.extend(prop(v2, name, &["StructProperty", struct_name], false, &body)); }
        prop(v2, name, &["ArrayProperty", "StructProperty", struct_name, "/Script/FactoryGame"], false, &val)
    }
    fn sub(v2: bool, name: &str, undefined: bool, bps: &[&str]) -> Vec<u8> {
        let mut v = str_prop(v2, "SubCategoryName", name);
        v.extend(prop(v2, "MenuPriority", &["FloatProperty"], false, &1f32.to_le_bytes()));
        v.extend(prop(v2, "IsUndefined", &["ByteProperty", "None"], false, &[undefined as u8]));
        let mut names = (bps.len() as i32).to_le_bytes().to_vec();
        for b in bps { names.extend(s(b)); }
        v.extend(prop(v2, "BlueprintNames", &["ArrayProperty", "StrProperty"], false, &names));
        v
    }
    fn cat(v2: bool, name: &str, undefined: bool, subs: &[Vec<u8>]) -> Vec<u8> {
        let mut v = str_prop(v2, "CategoryName", name);
        v.extend(prop(v2, "IconID", &["IntProperty"], false, &(-1i32).to_le_bytes()));
        v.extend(prop(v2, "IsUndefined", &["BoolProperty"], undefined, &[]));
        v.extend(struct_array(v2, "SubCategoryRecords", "BlueprintSubCategoryRecord", subs));
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
    /// `v2`: Satisfactory 1.1+ (UE 5.4) property tags
    fn game_state(v2: bool) -> Vec<u8> {
        let mut body = b"...other objects...".to_vec();
        body.extend(prop(v2, "mUnrelated", &["IntProperty"], false, &5i32.to_le_bytes()));
        body.extend(struct_array(v2, PROP, "BlueprintCategoryRecord", &[
            cat(v2, "Undefined", true, &[sub(v2, "Undefined", true, &["Loose"])]),
            cat(v2, "Production", false, &[sub(v2, "Steel", false, &["Steel Beams", "Steel Pipes"]), sub(v2, "未定義", true, &["Half"])]),
            cat(v2, "Power", false, &[sub(v2, "Coal", false, &["Coal 8x"])]),
        ]));
        body.extend(s("None"));
        body
    }

    #[test]
    fn reads_categories_from_a_save() {
        for v2 in [false, true] {
            let sav = synthetic_sav("Steel Town", &game_state(v2));
            assert_eq!(session_name(&sav).as_deref(), Some("Steel Town"));
            let c = read_categories(&sav).unwrap();
            assert_eq!(c.len(), 5, "v2 = {v2}");
            assert_eq!(c["Steel Pipes"], ("Production".into(), "Steel".into()));
            // the game's "Undefined" buckets, whatever their name, come back empty
            assert_eq!(c["Half"], ("Production".into(), String::new()));
            assert_eq!(c["Loose"], (String::new(), String::new()));
            assert_eq!(c["Coal 8x"], ("Power".into(), "Coal".into()));
        }
    }

    #[test]
    fn no_records_and_damage() {
        assert!(read_categories(&synthetic_sav("A", b"nothing here")).unwrap().is_empty());
        assert!(read_categories(b"not a save at all, no chunks").is_err());
        // a size that doesn't add up is an error, not a guess
        for v2 in [false, true] {
            let mut bad = game_state(v2);
            let at = bad.windows(9).position(|w| w == b"Steel Bea").unwrap();
            bad[at - 4] = 40;
            assert!(read_categories(&synthetic_sav("A", &bad)).is_err(), "v2 = {v2}");
        }
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
        fs::write(acct.join("manual name.sav"), synthetic_sav("Steel Town", &game_state(true))).unwrap();
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
