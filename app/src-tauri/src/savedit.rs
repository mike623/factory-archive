//! Changing the game's blueprint categories outside the game, by writing a **new** save file.
//!
//! The existing saves are never modified: the edited world is written next to them under a new name,
//! dated now so it's the newest, and the player loads it in the game. The saves it came from stay as
//! the backup.
//!
//! What changes in the file (layout in `sav.rs` and public save parsers; checked against real 1.1 saves):
//! - the value of `mBlueprintCategoryRecords` (rebuilt here; every property we don't edit is copied
//!   byte for byte, including `IconID`, `MenuPriority`, `lastEditedBy` and anything newer games add);
//! - the sizes that contain it: the property tag, the object's data size, the level's data-blob size
//!   (`i32 size, i32 0, i32 object count, objects…`), and the body's total size (`i64` at 0);
//! - the header's save name and date; then the body is compressed again into the same chunk format.
//!
//! The new file is checked before it's written: `sav::read_categories` (an independent reader) must
//! return exactly the categories asked for, and the data blob must still walk to its stated size.
//! Anything that doesn't add up is an error and nothing is written.

use crate::sav::{self, PROP};
use crate::sbp::{read_body, Reader, CHUNK_TAG};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

const MAX_SAVE_BODY: usize = 1 << 30;
/// .NET ticks (100 ns) at the Unix epoch; the save header stores its date as UTC ticks.
const EPOCH_TICKS: i64 = 621_355_968_000_000_000;

/// One change. Names are as the app shows them: `""` is the game's "Undefined" category or sub-category.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum Edit {
    AddCategory { name: String },
    RenameCategory { from: String, to: String },
    /// its blueprints go to Undefined
    DeleteCategory { name: String },
    AddSub { category: String, name: String },
    RenameSub { category: String, from: String, to: String },
    /// its blueprints go to Undefined
    DeleteSub { category: String, name: String },
    Move { blueprint: String, category: String, sub: String },
}

/// A category as the app sees it, in the game's order.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct CategoryView { pub name: String, pub subs: Vec<SubView> }
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SubView { pub name: String, pub blueprints: Vec<String> }

/* ---------- property model: unknown properties are kept as raw bytes ---------- */

#[derive(Clone)]
struct Prop {
    name: String,
    /// tag bytes from the name up to the value
    head: Vec<u8>,
    /// where the i32 value size sits in `head`
    size_at: usize,
    /// a BoolProperty's value: (byte in `head`, bit mask)
    bool_at: Option<(usize, u8)>,
    val: Val,
}

#[derive(Clone)]
enum Val {
    Raw(Vec<u8>),
    /// decoded text + the original bytes, reused when unchanged so untouched names round-trip exactly
    Str(String, Option<Vec<u8>>),
    Names(Vec<(String, Option<Vec<u8>>)>),
    Structs(StructArray),
}

#[derive(Clone)]
struct StructArray {
    /// old format: the inner StructProperty tag (head, size offset); none in 1.1+ saves
    inner: Option<(Vec<u8>, usize)>,
    elems: Vec<Vec<Prop>>,
}

fn fstr(s: &str) -> Vec<u8> {
    let mut v = Vec::new();
    if s.is_empty() { v.extend(0i32.to_le_bytes()); return v; }
    if s.is_ascii() {
        v.extend(((s.len() + 1) as i32).to_le_bytes());
        v.extend(s.as_bytes());
        v.push(0);
    } else {
        let u: Vec<u16> = s.encode_utf16().chain([0]).collect();
        v.extend((-(u.len() as i32)).to_le_bytes());
        for c in u { v.extend(c.to_le_bytes()); }
    }
    v
}

/// read an FString and keep its bytes
fn raw_str(r: &mut Reader) -> Result<(String, Vec<u8>), String> {
    let start = r.p;
    let s = r.fstring()?;
    Ok((s, r.b[start..r.p].to_vec()))
}

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

/// One property, or None at "None".
fn read_prop(r: &mut Reader, v2: bool) -> Result<Option<Prop>, String> {
    let start = r.p;
    let name = r.fstring()?;
    if name == "None" { return Ok(None); }
    let (ty, inner, size_at, bool_at, size);
    if v2 {
        let (t, i) = type_name(r, 0)?;
        size_at = r.p - start;
        size = usize::try_from(r.i32()?).map_err(|_| "bad property size")?;
        let flags_at = r.p - start;
        let flags = r.u8()?;
        if flags & 4 != 0 { return Err(format!("property {name} uses an unsupported tag extension")); }
        if flags & 1 != 0 { r.i32()?; }
        if flags & 2 != 0 { r.take(16)?; }
        bool_at = (t == "BoolProperty").then_some((flags_at, 0x10));
        (ty, inner) = (t, i);
    } else {
        ty = r.fstring()?;
        size_at = r.p - start;
        size = usize::try_from(r.i32()?).map_err(|_| "bad property size")?;
        r.i32()?;
        let mut i = String::new();
        let mut b = None;
        match ty.as_str() {
            "StructProperty" => { i = r.fstring()?; r.take(16)?; }
            "ArrayProperty" | "SetProperty" | "ByteProperty" | "EnumProperty" => i = r.fstring()?,
            "MapProperty" => { r.fstring()?; r.fstring()?; }
            "BoolProperty" => { b = Some((r.p - start, 1)); r.u8()?; }
            _ => {}
        }
        if r.u8()? != 0 { r.take(16)?; }
        inner = i;
        bool_at = b;
    }
    let head = r.b[start..r.p].to_vec();
    let vstart = r.p;
    let val = match (name.as_str(), ty.as_str(), inner.as_str()) {
        ("CategoryName" | "SubCategoryName", "StrProperty", _) => { let (s, raw) = raw_str(r)?; Val::Str(s, Some(raw)) }
        ("BlueprintNames", "ArrayProperty", "StrProperty") => {
            let n = r.count(1_000_000)?;
            let mut names = Vec::with_capacity(n);
            for _ in 0..n { let (s, raw) = raw_str(r)?; names.push((s, Some(raw))); }
            Val::Names(names)
        }
        (PROP | "SubCategoryRecords", "ArrayProperty", "StructProperty") => Val::Structs(read_structs(r, v2)?),
        _ => Val::Raw(r.take(size)?.to_vec()),
    };
    if r.p - vstart != size { return Err(format!("property {name} didn't match its stated size")); }
    Ok(Some(Prop { name, head, size_at, bool_at, val }))
}

fn read_structs(r: &mut Reader, v2: bool) -> Result<StructArray, String> {
    let n = r.count(100_000)?;
    let mut inner = None;
    let mut inner_end = None;
    if !v2 {
        let start = r.p;
        r.fstring()?;
        r.fstring()?;
        let size_at = r.p - start;
        let size = usize::try_from(r.i32()?).map_err(|_| "bad property size")?;
        r.i32()?;
        r.fstring()?;
        r.take(16)?;
        if r.u8()? != 0 { r.take(16)?; }
        inner = Some((r.b[start..r.p].to_vec(), size_at));
        inner_end = Some(r.p + size);
    }
    let mut elems = Vec::with_capacity(n);
    for _ in 0..n {
        let mut props = Vec::new();
        while let Some(p) = read_prop(r, v2)? { props.push(p); }
        elems.push(props);
    }
    if inner_end.is_some_and(|e| e != r.p) { return Err("category data didn't match its stated size".into()); }
    Ok(StructArray { inner, elems })
}

fn write_prop(p: &Prop, out: &mut Vec<u8>) {
    let mut val = Vec::new();
    match &p.val {
        Val::Raw(b) => val.extend(b),
        Val::Str(s, raw) => val.extend(raw.clone().unwrap_or_else(|| fstr(s))),
        Val::Names(ns) => {
            val.extend((ns.len() as i32).to_le_bytes());
            for (s, raw) in ns { val.extend(raw.clone().unwrap_or_else(|| fstr(s))); }
        }
        Val::Structs(a) => write_structs(a, &mut val),
    }
    let mut head = p.head.clone();
    head[p.size_at..p.size_at + 4].copy_from_slice(&(val.len() as i32).to_le_bytes());
    out.extend(head);
    out.extend(val);
}

fn write_structs(a: &StructArray, out: &mut Vec<u8>) {
    out.extend((a.elems.len() as i32).to_le_bytes());
    let mut body = Vec::new();
    for e in &a.elems {
        for p in e { write_prop(p, &mut body); }
        body.extend(fstr("None"));
    }
    if let Some((head, size_at)) = &a.inner {
        let mut head = head.clone();
        head[*size_at..*size_at + 4].copy_from_slice(&(body.len() as i32).to_le_bytes());
        out.extend(head);
    }
    out.extend(body);
}

/* ---------- category records ---------- */

fn get<'a>(e: &'a [Prop], name: &str) -> Option<&'a Prop> { e.iter().find(|p| p.name == name) }
fn get_mut<'a>(e: &'a mut [Prop], name: &str) -> Option<&'a mut Prop> { e.iter_mut().find(|p| p.name == name) }

fn text(e: &[Prop], name: &str) -> String {
    match get(e, name).map(|p| &p.val) { Some(Val::Str(s, _)) => s.clone(), _ => String::new() }
}
fn set_text(e: &mut [Prop], name: &str, s: &str) -> Result<(), String> {
    let p = get_mut(e, name).ok_or("unexpected category data")?;
    p.val = Val::Str(s.to_string(), None);
    Ok(())
}
/// The game marks its own "Undefined" buckets: a BoolProperty on categories, a ByteProperty on sub-categories.
fn undefined(e: &[Prop]) -> bool {
    match get(e, "IsUndefined") {
        Some(Prop { bool_at: Some((at, mask)), head, .. }) => head[*at] & mask != 0,
        Some(Prop { val: Val::Raw(b), .. }) => b.first().is_some_and(|&x| x != 0),
        _ => false,
    }
}
fn clear_undefined(e: &mut [Prop]) {
    match get_mut(e, "IsUndefined") {
        Some(Prop { bool_at: Some((at, mask)), head, .. }) => head[*at] &= !*mask,
        Some(Prop { val: Val::Raw(b), .. }) => b.iter_mut().for_each(|x| *x = 0),
        _ => {}
    }
}
fn set_priority(e: &mut [Prop], v: f32) {
    if let Some(Prop { val: Val::Raw(b), .. }) = get_mut(e, "MenuPriority") {
        if b.len() == 4 { b.copy_from_slice(&v.to_le_bytes()); }
    }
}
fn priority(e: &[Prop]) -> f32 {
    match get(e, "MenuPriority").map(|p| &p.val) {
        Some(Val::Raw(b)) if b.len() == 4 => f32::from_le_bytes(b[..].try_into().unwrap()),
        _ => 0.0,
    }
}
fn subs(e: &[Prop]) -> &[Vec<Prop>] {
    match get(e, "SubCategoryRecords").map(|p| &p.val) { Some(Val::Structs(a)) => &a.elems, _ => &[] }
}
fn subs_mut(e: &mut [Prop]) -> Result<&mut Vec<Vec<Prop>>, String> {
    match get_mut(e, "SubCategoryRecords").map(|p| &mut p.val) {
        Some(Val::Structs(a)) => Ok(&mut a.elems),
        _ => Err("unexpected category data".into()),
    }
}
fn names_mut(e: &mut [Prop]) -> Result<&mut Vec<(String, Option<Vec<u8>>)>, String> {
    match get_mut(e, "BlueprintNames").map(|p| &mut p.val) {
        Some(Val::Names(n)) => Ok(n),
        _ => Err("unexpected category data".into()),
    }
}

/// The records of one save, ready to edit.
pub struct Records { prop: Prop }

impl Records {
    fn cats(&self) -> &[Vec<Prop>] { match &self.prop.val { Val::Structs(a) => &a.elems, _ => &[] } }
    fn cats_mut(&mut self) -> &mut Vec<Vec<Prop>> {
        match &mut self.prop.val { Val::Structs(a) => &mut a.elems, _ => unreachable!("checked in parse") }
    }

    pub fn view(&self) -> Vec<CategoryView> {
        self.cats().iter().map(|c| CategoryView {
            name: if undefined(c) { String::new() } else { text(c, "CategoryName") },
            subs: subs(c).iter().map(|s| SubView {
                name: if undefined(s) { String::new() } else { text(s, "SubCategoryName") },
                blueprints: match get(s, "BlueprintNames").map(|p| &p.val) {
                    Some(Val::Names(n)) => n.iter().map(|(s, _)| s.clone()).collect(),
                    _ => Vec::new(),
                },
            }).collect(),
        }).collect()
    }

    fn cat_index(&self, name: &str) -> Result<usize, String> {
        self.cats().iter().position(|c| if name.is_empty() { undefined(c) } else { !undefined(c) && text(c, "CategoryName") == name })
            .ok_or_else(|| format!("There's no category \"{name}\""))
    }
    fn sub_index(&self, cat: usize, name: &str) -> Result<usize, String> {
        subs(&self.cats()[cat]).iter()
            .position(|s| if name.is_empty() { undefined(s) } else { !undefined(s) && text(s, "SubCategoryName") == name })
            .ok_or_else(|| format!("There's no sub-category \"{name}\" there"))
    }

    /// Take a blueprint out of every sub-category.
    fn remove_blueprint(&mut self, bp: &str) -> Result<(), String> {
        for c in self.cats_mut() { for s in subs_mut(c)? { names_mut(s)?.retain(|(n, _)| n != bp); } }
        Ok(())
    }
    fn add_blueprints(&mut self, cat: usize, sub: usize, bps: Vec<(String, Option<Vec<u8>>)>) -> Result<(), String> {
        names_mut(&mut subs_mut(&mut self.cats_mut()[cat])?[sub])?.extend(bps);
        Ok(())
    }
    /// Where blueprints of a deleted category or sub-category go, like the game: Undefined › Undefined.
    fn undefined_home(&self) -> Result<(usize, usize), String> {
        let c = self.cat_index("").map_err(|_| "This world has no Undefined category to move the blueprints to")?;
        let s = self.sub_index(c, "").map_err(|_| "This world has no Undefined sub-category to move the blueprints to")?;
        Ok((c, s))
    }

    pub fn apply(&mut self, edit: &Edit) -> Result<(), String> {
        let check_name = |n: &str| -> Result<(), String> {
            let n = n.trim();
            if n.is_empty() { return Err("Give it a name".into()); }
            if n.chars().count() > 100 || n.chars().any(char::is_control) { return Err("That name isn't allowed".into()); }
            Ok(())
        };
        match edit {
            Edit::AddCategory { name } => {
                check_name(name)?;
                if self.cat_index(name).is_ok() { return Err(format!("Category \"{name}\" already exists")); }
                // copy an existing record so every field the game expects is there
                let tpl = self.cats().iter().find(|c| !undefined(c)).or(self.cats().first()).ok_or("This world has no categories to copy from")?;
                let mut c = tpl.clone();
                clear_undefined(&mut c);
                set_text(&mut c, "CategoryName", name.trim())?;
                set_priority(&mut c, self.cats().iter().map(|c| priority(c)).fold(0.0, f32::max) + 1.0);
                let sub_tpl = subs(&c).iter().find(|s| !undefined(s)).or(subs(&c).first()).cloned()
                    .or_else(|| self.cats().iter().flat_map(|c| subs(c)).next().cloned())
                    .ok_or("This world has no sub-categories to copy from")?;
                let mut s = sub_tpl;
                clear_undefined(&mut s);
                // a new category gets one sub-category, like in the game
                set_text(&mut s, "SubCategoryName", "General")?;
                set_priority(&mut s, 0.0);
                names_mut(&mut s)?.clear();
                *subs_mut(&mut c)? = vec![s];
                self.cats_mut().push(c);
            }
            Edit::RenameCategory { from, to } => {
                check_name(to)?;
                let i = self.cat_index(from)?;
                if from.is_empty() { return Err("The Undefined category can't be renamed".into()); }
                if self.cat_index(to).is_ok_and(|j| j != i) { return Err(format!("Category \"{to}\" already exists")); }
                set_text(&mut self.cats_mut()[i], "CategoryName", to.trim())?;
            }
            Edit::DeleteCategory { name } => {
                if name.is_empty() { return Err("The Undefined category can't be deleted".into()); }
                let i = self.cat_index(name)?;
                let moved: Vec<_> = subs_mut(&mut self.cats_mut()[i])?.iter_mut()
                    .map(|s| names_mut(s).map(std::mem::take)).collect::<Result<Vec<_>, _>>()?.concat();
                self.cats_mut().remove(i);
                let (c, s) = self.undefined_home()?;
                self.add_blueprints(c, s, moved)?;
            }
            Edit::AddSub { category, name } => {
                check_name(name)?;
                let i = self.cat_index(category)?;
                if self.sub_index(i, name).is_ok() { return Err(format!("Sub-category \"{name}\" already exists there")); }
                let cat = &self.cats()[i];
                let tpl = subs(cat).iter().find(|s| !undefined(s)).or(subs(cat).first()).cloned()
                    .or_else(|| self.cats().iter().flat_map(|c| subs(c)).next().cloned())
                    .ok_or("This world has no sub-categories to copy from")?;
                let mut s = tpl;
                clear_undefined(&mut s);
                set_text(&mut s, "SubCategoryName", name.trim())?;
                set_priority(&mut s, subs(cat).iter().map(|s| priority(s)).fold(0.0, f32::max) + 1.0);
                names_mut(&mut s)?.clear();
                subs_mut(&mut self.cats_mut()[i])?.push(s);
            }
            Edit::RenameSub { category, from, to } => {
                check_name(to)?;
                let i = self.cat_index(category)?;
                let j = self.sub_index(i, from)?;
                if from.is_empty() { return Err("The Undefined sub-category can't be renamed".into()); }
                if self.sub_index(i, to).is_ok_and(|k| k != j) { return Err(format!("Sub-category \"{to}\" already exists there")); }
                set_text(&mut subs_mut(&mut self.cats_mut()[i])?[j], "SubCategoryName", to.trim())?;
            }
            Edit::DeleteSub { category, name } => {
                if name.is_empty() { return Err("The Undefined sub-category can't be deleted".into()); }
                let i = self.cat_index(category)?;
                let j = self.sub_index(i, name)?;
                if subs(&self.cats()[i]).len() == 1 { return Err("A category needs at least one sub-category. Delete the category instead.".into()); }
                let moved = std::mem::take(names_mut(&mut subs_mut(&mut self.cats_mut()[i])?[j])?);
                subs_mut(&mut self.cats_mut()[i])?.remove(j);
                let (c, s) = self.undefined_home()?;
                self.add_blueprints(c, s, moved)?;
            }
            Edit::Move { blueprint, category, sub } => {
                let i = self.cat_index(category)?;
                let j = self.sub_index(i, sub)?;
                self.remove_blueprint(blueprint)?;
                self.add_blueprints(i, j, vec![(blueprint.clone(), None)])?;
            }
        }
        Ok(())
    }

    fn bytes(&self) -> Vec<u8> { let mut v = Vec::new(); write_prop(&self.prop, &mut v); v }
}

/* ---------- locating the records in a save ---------- */

struct Located {
    /// the category property: start and end in the body
    at: usize,
    end: usize,
    /// i32 data size of the object that holds it
    object_size_at: usize,
    /// i32 size of the level data blob that holds the object
    blob_size_at: usize,
    v2: bool,
}

/// Walk a level data blob (i32 size, i32 0, i32 object count, objects) to its stated end.
/// Returns each object's (size field, data start, data end); None when it doesn't add up.
fn walk_blob(b: &[u8], y: usize) -> Option<Vec<(usize, usize, usize)>> {
    let mut r = Reader::new(b);
    r.p = y;
    let len = usize::try_from(r.i32().ok()?).ok()?;
    if r.i32().ok()? != 0 { return None; }
    let end = r.p.checked_add(len).filter(|&e| e <= b.len())?;
    let n = r.count(10_000_000).ok()?;
    let mut objs = Vec::new();
    for _ in 0..n {
        r.take(8).ok()?; // save version, "migrate references" flag
        let size_at = r.p;
        let size = usize::try_from(r.i32().ok()?).ok()?;
        let start = r.p;
        r.take(size).ok()?;
        objs.push((size_at, start, r.p));
        match r.i32().ok()? {
            0 => {}
            1 => { // per-object version data
                r.take(4 + 8 + 4 + 10).ok()?;
                r.fstring().ok()?;
                let n = r.count(10_000).ok()?;
                r.take(n * 20).ok()?;
            }
            _ => return None,
        }
        if r.p > end { return None; }
    }
    (r.p == end).then_some(objs)
}

fn locate(body: &[u8]) -> Result<Option<Located>, String> {
    let mut needle = ((PROP.len() + 1) as i32).to_le_bytes().to_vec();
    needle.extend(PROP.as_bytes());
    needle.push(0);
    let Some(at) = body.windows(needle.len()).position(|w| w == needle) else { return Ok(None) };
    let v2 = sav::is_v2(body, at)?;
    // the closest blob before the property that walks cleanly and has an object around it
    for y in (0..at.saturating_sub(12)).rev() {
        if body[y + 4..y + 8] != [0; 4] { continue; }
        let len = i32::from_le_bytes(body[y..y + 4].try_into().unwrap());
        if len <= 0 || y + 8 + (len as usize) < at { continue; }
        let Some(objs) = walk_blob(body, y) else { continue };
        if let Some(&(object_size_at, _, obj_end)) = objs.iter().find(|o| o.1 <= at && at < o.2) {
            let mut r = Reader::new(body);
            r.p = at;
            read_prop(&mut r, v2)?.ok_or("bad category data")?;
            if r.p > obj_end { return Err("category data runs past its object".into()); }
            return Ok(Some(Located { at, end: r.p, object_size_at, blob_size_at: y, v2 }));
        }
    }
    Err("Couldn't find where the categories are stored in this save. If the world is from an older game version, load it in the game and save once, then try again.".into())
}

fn parse_records(body: &[u8], loc: &Located) -> Result<Records, String> {
    let mut r = Reader::new(body);
    r.p = loc.at;
    let prop = read_prop(&mut r, loc.v2)?.ok_or("bad category data")?;
    if !matches!(prop.val, Val::Structs(_)) { return Err("unexpected category data".into()); }
    Ok(Records { prop })
}

/* ---------- reading and writing whole saves ---------- */

struct Save { header: Vec<u8>, chunk_max: u64, body: Vec<u8> }

fn split_save(sav: &[u8]) -> Result<Save, String> {
    let start = (12..sav.len().saturating_sub(8))
        .find(|&i| sav[i..i + 4] == CHUNK_TAG.to_le_bytes() && sav[i + 4..i + 8] == 0x2222_2222u32.to_le_bytes())
        .ok_or("not a save file")?;
    let chunk_max = u64::from_le_bytes(sav[start + 8..start + 16].try_into().unwrap());
    if chunk_max == 0 || chunk_max > 1 << 24 { return Err("unexpected chunk size".into()); }
    let body = read_body(&sav[start..], MAX_SAVE_BODY)?;
    if body.len() < 8 || i64::from_le_bytes(body[..8].try_into().unwrap()) != body.len() as i64 - 8 {
        return Err("this save's body size doesn't add up".into());
    }
    Ok(Save { header: sav[..start].to_vec(), chunk_max, body })
}

fn compress(body: &[u8], chunk_max: u64) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    for part in body.chunks(chunk_max as usize) {
        let mut z = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
        z.write_all(part).map_err(|e| e.to_string())?;
        let c = z.finish().map_err(|e| e.to_string())?;
        out.extend(CHUNK_TAG.to_le_bytes());
        out.extend(0x2222_2222u32.to_le_bytes());
        out.extend(chunk_max.to_le_bytes());
        out.push(3);
        for x in [c.len() as u64, part.len() as u64, c.len() as u64, part.len() as u64] { out.extend(x.to_le_bytes()); }
        out.extend(c);
    }
    Ok(out)
}

/// Header with a new save name and date. Layout: i32 ×3, FString save name, FString map,
/// FString options, FString session, i32 play time, i64 date (UTC ticks), …
fn new_header(header: &[u8], save_name: &str, ticks: i64) -> Result<Vec<u8>, String> {
    let mut r = Reader::new(header);
    if r.i32()? < 14 { return Err("This save is from an older game version. Load and save it in the game first.".into()); }
    r.take(8)?;
    let name_at = r.p;
    r.fstring()?;
    let name_end = r.p;
    for _ in 0..3 { r.fstring()?; }
    r.i32()?;
    let date_at = r.p;
    r.take(8)?;
    let mut h = header[..name_at].to_vec();
    h.extend(fstr(save_name));
    let shift = h.len() as isize - (name_end - name_at) as isize - name_at as isize;
    h.extend(&header[name_end..]);
    let d = (date_at as isize + shift) as usize;
    h[d..d + 8].copy_from_slice(&ticks.to_le_bytes());
    Ok(h)
}

fn add_i32(b: &mut [u8], at: usize, delta: i64) -> Result<(), String> {
    let v = i32::from_le_bytes(b[at..at + 4].try_into().unwrap()) as i64 + delta;
    let v = i32::try_from(v).map_err(|_| "size out of range")?;
    b[at..at + 4].copy_from_slice(&v.to_le_bytes());
    Ok(())
}

/// The categories stored in a save, in the game's order.
pub fn read_view(sav: &[u8]) -> Result<Vec<CategoryView>, String> {
    let s = split_save(sav)?;
    match locate(&s.body)? {
        Some(loc) => Ok(parse_records(&s.body, &loc)?.view()),
        None => Ok(Vec::new()),
    }
}

/// Apply `edits` to `sav` and return the new save's bytes, named `save_name` and dated `ticks`.
/// Checked against the independent reader before it's returned.
pub fn edit_save(sav: &[u8], edits: &[Edit], save_name: &str, ticks: i64) -> Result<(Vec<u8>, Vec<CategoryView>), String> {
    let s = split_save(sav)?;
    let loc = locate(&s.body)?.ok_or("This world has no categories yet. Create one in the game's Blueprint menu first.")?;
    let mut rec = parse_records(&s.body, &loc)?;
    for e in edits { rec.apply(e)?; }
    let view = rec.view();
    let new_prop = rec.bytes();

    let delta = new_prop.len() as i64 - (loc.end - loc.at) as i64;
    let mut body = Vec::with_capacity((s.body.len() as i64 + delta).max(0) as usize);
    body.extend(&s.body[..loc.at]);
    body.extend(&new_prop);
    body.extend(&s.body[loc.end..]);
    add_i32(&mut body, loc.object_size_at, delta)?;
    add_i32(&mut body, loc.blob_size_at, delta)?;
    let total = body.len() as i64 - 8;
    body[..8].copy_from_slice(&total.to_le_bytes());
    if walk_blob(&body, loc.blob_size_at).is_none() { return Err("the edited save didn't add up; nothing was written".into()); }

    let mut out = new_header(&s.header, save_name, ticks)?;
    out.extend(compress(&body, s.chunk_max)?);

    // independent check: the reader the app uses must see exactly what we meant to write
    let expect: sav::Categories = view.iter().flat_map(|c| c.subs.iter().flat_map(move |sub|
        sub.blueprints.iter().map(move |b| (b.clone(), (c.name.clone(), sub.name.clone()))))).fold(sav::Categories::new(), |mut m, (b, v)| { m.entry(b).or_insert(v); m });
    if sav::read_categories(&out)? != expect { return Err("the edited save didn't read back as expected; nothing was written".into()); }
    if read_view(&out)? != view { return Err("the edited save didn't read back as expected; nothing was written".into()); }
    Ok((out, view))
}

/// `<session>_<ddmmyy>-<hhmmss>`, the game's own pattern for manual saves (UTC here).
fn save_name(session: &str, unix_secs: i64) -> String {
    let (days, secs) = (unix_secs.div_euclid(86_400), unix_secs.rem_euclid(86_400));
    // civil-from-days (Howard Hinnant)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{session}_{d:02}{m:02}{:02}-{:02}{:02}{:02}", y % 100, secs / 3600, secs % 3600 / 60, secs % 60)
}

/// Write the session's newest save with `edits` applied as a new save file next to it.
/// Never overwrites: if the name is taken, nothing is written. Returns the new file.
pub fn write_edited(root: &Path, session: &str, edits: &[Edit]) -> Result<PathBuf, String> {
    let src = sav::latest_save(root, session).ok_or_else(|| format!("No save found for the world \"{session}\""))?;
    let bytes = fs::read(&src).map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?;
    let name = save_name(session, now.as_secs() as i64);
    let (out, _) = edit_save(&bytes, edits, &name, EPOCH_TICKS + now.as_millis() as i64 * 10_000)?;
    let dest = src.with_file_name(format!("{name}.sav"));
    let mut f = fs::OpenOptions::new().write(true).create_new(true).open(&dest)
        .map_err(|e| if e.kind() == std::io::ErrorKind::AlreadyExists { format!("{name}.sav already exists. Try again in a second.") } else { e.to_string() })?;
    if let Err(e) = f.write_all(&out).and_then(|_| f.sync_all()) {
        drop(f);
        let _ = fs::remove_file(&dest); // don't leave a half-written save behind
        return Err(e.to_string());
    }
    Ok(dest)
}

/// Categories of the session's newest save with `edits` applied in memory (nothing is written), for the editor.
pub fn session_view(root: &Path, session: &str, edits: &[Edit]) -> Result<Vec<CategoryView>, String> {
    let Some(src) = sav::latest_save(root, session) else { return Ok(Vec::new()) };
    let s = split_save(&fs::read(&src).map_err(|e| e.to_string())?)?;
    let Some(loc) = locate(&s.body)? else {
        return if edits.is_empty() { Ok(Vec::new()) } else { Err("This world has no categories yet. Create one in the game's Blueprint menu first.".into()) };
    };
    let mut rec = parse_records(&s.body, &loc)?;
    for e in edits { rec.apply(e)?; }
    Ok(rec.view())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn real() -> Option<Vec<u8>> { std::env::var("FA_SAMPLE_SAV").ok().map(|p| fs::read(p).unwrap()) }

    #[test]
    fn names_follow_the_games_pattern() {
        assert_eq!(save_name("h22", 1_791_455_400), "h22_081026-103000");
        assert_eq!(save_name("A", 0), "A_010170-000000");
    }

    #[test]
    fn strings_round_trip() {
        for s in ["", "Steel", "新子類別"] {
            let b = fstr(s);
            assert_eq!(Reader::new(&b).fstring().unwrap(), s);
        }
    }

    #[test]
    fn edits_synthetic_saves_in_both_formats() {
        for v2 in [false, true] {
            let sav = sav::tests::synthetic_save(v2);
            // unchanged: the same records come back and the body is byte-identical
            let s = split_save(&sav).unwrap();
            let loc = locate(&s.body).unwrap().unwrap();
            assert_eq!(parse_records(&s.body, &loc).unwrap().bytes(), s.body[loc.at..loc.end]);

            let edits = [
                Edit::AddCategory { name: "Trains".into() },
                Edit::AddSub { category: "Trains".into(), name: "Stations".into() },
                Edit::Move { blueprint: "Steel Pipes".into(), category: "Trains".into(), sub: "Stations".into() },
                Edit::RenameCategory { from: "Power".into(), to: "Energy".into() },
                Edit::RenameSub { category: "Energy".into(), from: "Coal".into(), to: "煤".into() },
                Edit::DeleteSub { category: "Production".into(), name: "Steel".into() },
                Edit::Move { blueprint: "New One".into(), category: "Energy".into(), sub: "煤".into() },
            ];
            let (out, view) = edit_save(&sav, &edits, "Steel Town_edited", EPOCH_TICKS).unwrap();
            let c = sav::read_categories(&out).unwrap();
            assert_eq!(c["Steel Pipes"], ("Trains".into(), "Stations".into()), "v2 = {v2}");
            assert_eq!(c["Steel Beams"], (String::new(), String::new())); // deleted sub → Undefined
            assert_eq!(c["Coal 8x"], ("Energy".into(), "煤".into()));
            assert_eq!(c["New One"], ("Energy".into(), "煤".into()));
            assert_eq!(view.iter().find(|c| c.name == "Trains").unwrap().subs.len(), 2);
            assert_eq!(sav::session_name(&out).as_deref(), Some("Steel Town"));
            let mut r = Reader::new(&out);
            r.take(12).unwrap();
            assert_eq!(r.fstring().unwrap(), "Steel Town_edited");
        }
    }

    #[test]
    fn refuses_bad_edits() {
        let sav = sav::tests::synthetic_save(true);
        for e in [
            Edit::AddCategory { name: "Power".into() },
            Edit::AddCategory { name: "  ".into() },
            Edit::RenameCategory { from: "".into(), to: "X".into() },
            Edit::DeleteCategory { name: "".into() },
            Edit::DeleteCategory { name: "Nope".into() },
            Edit::DeleteSub { category: "Power".into(), name: "Coal".into() }, // its only one
            Edit::Move { blueprint: "Coal 8x".into(), category: "Power".into(), sub: "Nope".into() },
        ] {
            assert!(edit_save(&sav, &[e.clone()], "x", 0).is_err(), "{e:?}");
        }
        assert!(edit_save(&sav::tests::synthetic_save_without_categories(), &[Edit::AddCategory { name: "X".into() }], "x", 0).is_err());
    }

    #[test]
    fn writes_a_new_file_and_never_overwrites() {
        let base = std::env::temp_dir().join(format!("fa-savedit-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let (root, acct) = (base.join("blueprints"), base.join("12345"));
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&acct).unwrap();
        let original = sav::tests::synthetic_save(true);
        fs::write(acct.join("Steel Town_autosave_0.sav"), &original).unwrap();
        let edits = [Edit::RenameCategory { from: "Power".into(), to: "Energy".into() }];
        let out = write_edited(&root, "Steel Town", &edits).unwrap();
        assert_ne!(out, acct.join("Steel Town_autosave_0.sav"));
        assert_eq!(fs::read(acct.join("Steel Town_autosave_0.sav")).unwrap(), original);
        assert_eq!(session_view(&root, "Steel Town", &[]).unwrap().iter().filter(|c| c.name == "Energy").count(), 1);
        let _ = fs::remove_dir_all(&base);
    }

    /// With FA_SAMPLE_SAV set: unchanged records rebuild byte for byte, and a round of edits reads back.
    #[test]
    fn real_save_if_provided() {
        let Some(sav) = real() else { return };
        let s = split_save(&sav).unwrap();
        let Some(loc) = locate(&s.body).unwrap() else { println!("no categories"); return };
        assert_eq!(parse_records(&s.body, &loc).unwrap().bytes(), s.body[loc.at..loc.end]);
        let (out, _) = edit_save(&sav, &[], "same", EPOCH_TICKS).unwrap();
        assert_eq!(split_save(&out).unwrap().body, s.body);
        let edits = [
            Edit::AddCategory { name: "Factory Archive test".into() },
            Edit::AddSub { category: "Factory Archive test".into(), name: "子".into() },
        ];
        let out_path = std::env::var("FA_SAMPLE_OUT").ok();
        let name = out_path.as_deref().and_then(|p| Path::new(p).file_stem()?.to_str()).unwrap_or("edited");
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap();
        let (out, view) = edit_save(&sav, &edits, name, EPOCH_TICKS + now.as_millis() as i64 * 10_000).unwrap();
        assert!(view.iter().any(|c| c.name == "Factory Archive test" && c.subs.len() == 2));
        println!("{} → {} bytes", sav.len(), out.len());
        // FA_SAMPLE_OUT: keep the edited save, to try loading it in the game
        if let Some(p) = out_path { fs::write(p, &out).unwrap(); }
    }
}
