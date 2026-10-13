//! Reading what a blueprint contains, from the `.sbp` / `.sbpcfg` files themselves.
//!
//! Layout (verified against a real Satisfactory 1.0 blueprint, save version 52):
//! - `.sbp` header: i32 header version, i32 save version, i32 build, i32×3 size,
//!   cost list `[i32 n; (FString level, FString item path, i32 amount) × n]`,
//!   recipe list `[i32 n; (FString level, FString recipe path) × n]`.
//! - then zlib chunks: u32 tag 0x9E2A83C1, u32 0x22222222, u64 max size, u8 algorithm (3 = zlib),
//!   u64 compressed, u64 uncompressed, u64 compressed, u64 uncompressed, data.
//! - decompressed body: i32 total size, i32 header-section size, i32 object count, then per object
//!   i32 type (1 actor, 0 component), FString class, FString level, FString path, i32 flags,
//!   actor: i32 needTransform + 10×f32 transform + i32 wasPlaced; component: FString parent.
//! - `.sbpcfg`: i32 version, FString description, i32 icon id, f32×4 color.
//!
//! Every read is bounds-checked; anything unexpected returns an error instead of guessing.

use serde::Serialize;
use std::collections::BTreeMap;
use std::io::Read;

const CHUNK_TAG: u32 = 0x9E2A_83C1;
const MAX_BODY: usize = 64 * 1024 * 1024;

struct Reader<'a> { b: &'a [u8], p: usize }

impl<'a> Reader<'a> {
    fn new(b: &'a [u8]) -> Self { Self { b, p: 0 } }
    fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        let end = self.p.checked_add(n).filter(|&e| e <= self.b.len()).ok_or("unexpected end of file")?;
        let s = &self.b[self.p..end];
        self.p = end;
        Ok(s)
    }
    fn i32(&mut self) -> Result<i32, String> { Ok(i32::from_le_bytes(self.take(4)?.try_into().unwrap())) }
    fn u32(&mut self) -> Result<u32, String> { Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap())) }
    fn u64(&mut self) -> Result<u64, String> { Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap())) }
    fn f32(&mut self) -> Result<f32, String> { Ok(f32::from_le_bytes(self.take(4)?.try_into().unwrap())) }
    fn u8(&mut self) -> Result<u8, String> { Ok(self.take(1)?[0]) }
    /// Unreal FString: i32 length incl. NUL; negative = UTF-16.
    fn fstring(&mut self) -> Result<String, String> {
        let n = self.i32()?;
        if n == 0 { return Ok(String::new()); }
        if n > 0 {
            let raw = self.take(n as usize)?;
            Ok(String::from_utf8_lossy(raw).trim_end_matches('\0').to_string())
        } else {
            let units = n.checked_neg().ok_or("bad string length")? as usize;
            let raw = self.take(units.checked_mul(2).ok_or("bad string length")?)?;
            let u16s: Vec<u16> = raw.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
            Ok(String::from_utf16_lossy(&u16s).trim_end_matches('\0').to_string())
        }
    }
    fn count(&mut self, max: i32) -> Result<usize, String> {
        let n = self.i32()?;
        if n < 0 || n > max { return Err(format!("implausible count {n}")); }
        Ok(n as usize)
    }
}

/// `/Game/…/Desc_Cement.Desc_Cement_C` → `Desc_Cement_C`
fn short_class(path: &str) -> String {
    path.rsplit('.').next().unwrap_or(path).to_string()
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Line {
    /// game class, e.g. `Desc_Cement_C`
    pub class: String,
    /// display name, e.g. `Concrete`
    pub name: String,
    pub amount: u32,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Breakdown {
    pub save_version: i32,
    pub build: i32,
    /// blueprint size as stored in the file (x, y, z)
    pub size: [i32; 3],
    pub cost: Vec<Line>,
    /// buildings in the blueprint and how many of each (from the compressed body)
    pub buildings: Vec<Line>,
    pub total_buildings: u32,
    /// set when the body couldn't be read; cost and size are still valid
    pub buildings_error: Option<String>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BlueprintConfig {
    pub description: String,
    pub icon_id: i32,
    /// RGBA, 0..1
    pub color: [f32; 4],
}

pub fn parse_sbp(bytes: &[u8]) -> Result<Breakdown, String> {
    let mut r = Reader::new(bytes);
    let header_version = r.i32()?;
    if !(1..=10).contains(&header_version) { return Err(format!("not a blueprint file (header version {header_version})")); }
    let save_version = r.i32()?;
    let build = r.i32()?;
    let size = [r.i32()?, r.i32()?, r.i32()?];

    let mut cost = Vec::new();
    for _ in 0..r.count(10_000)? {
        let _level = r.fstring()?;
        let class = short_class(&r.fstring()?);
        let amount = r.i32()?.max(0) as u32;
        cost.push(Line { name: display_name(&class), class, amount });
    }
    for _ in 0..r.count(10_000)? {
        let _level = r.fstring()?;
        let _recipe = r.fstring()?;
    }

    let (buildings, buildings_error) = match read_body(&bytes[r.p..]).and_then(|body| count_buildings(&body)) {
        Ok(b) => (b, None),
        Err(e) => (Vec::new(), Some(e)),
    };
    let total_buildings = buildings.iter().map(|l| l.amount).sum();
    Ok(Breakdown { save_version, build, size, cost, buildings, total_buildings, buildings_error })
}

fn read_body(mut rest: &[u8]) -> Result<Vec<u8>, String> {
    let mut body = Vec::new();
    while !rest.is_empty() {
        let mut r = Reader::new(rest);
        if r.u32()? != CHUNK_TAG { return Err("unexpected data after the header".into()); }
        let _archive = r.u32()?;
        let _max = r.u64()?;
        let algo = r.u8()?;
        let compressed = r.u64()? as usize;
        let uncompressed = r.u64()? as usize;
        let _c2 = r.u64()?;
        let _u2 = r.u64()?;
        if algo != 3 { return Err(format!("unsupported compression ({algo})")); }
        if body.len() + uncompressed > MAX_BODY { return Err("blueprint body is too large".into()); }
        let data = r.take(compressed)?;
        let mut out = Vec::with_capacity(uncompressed);
        flate2::read::ZlibDecoder::new(data).take(uncompressed as u64 + 1).read_to_end(&mut out).map_err(|e| e.to_string())?;
        if out.len() != uncompressed { return Err("compressed chunk has the wrong size".into()); }
        body.extend_from_slice(&out);
        rest = &rest[r.p..];
    }
    Ok(body)
}

fn count_buildings(body: &[u8]) -> Result<Vec<Line>, String> {
    let mut r = Reader::new(body);
    let _total = r.i32()?;
    let header_bytes = r.i32()?;
    let start = r.p;
    let n = r.count(1_000_000)?;
    let mut counts: BTreeMap<String, u32> = BTreeMap::new();
    for _ in 0..n {
        let kind = r.i32()?;
        let class = short_class(&r.fstring()?);
        let _level = r.fstring()?;
        let _path = r.fstring()?;
        let _flags = r.i32()?;
        match kind {
            1 => { r.take(4 + 40 + 4)?; *counts.entry(class).or_default() += 1; }
            0 => { let _parent = r.fstring()?; }
            k => return Err(format!("unknown object type {k}")),
        }
    }
    // the file states how long this section is: a mismatch means we misread it
    if header_bytes >= 0 && r.p - start != header_bytes as usize {
        return Err("object list didn't match its stated size".into());
    }
    let mut lines: Vec<Line> = counts.into_iter().map(|(class, amount)| Line { name: display_name(&class), class, amount }).collect();
    lines.sort_by(|a, b| b.amount.cmp(&a.amount).then(a.name.cmp(&b.name)));
    Ok(lines)
}

pub fn parse_cfg(bytes: &[u8]) -> Result<BlueprintConfig, String> {
    let mut r = Reader::new(bytes);
    let _version = r.i32()?;
    let description = r.fstring()?.replace("\r\n", "\n");
    let icon_id = r.i32()?;
    let color = [r.f32()?, r.f32()?, r.f32()?, r.f32()?];
    Ok(BlueprintConfig { description, icon_id, color })
}

/// Game class → the name players see. Covers internal names that differ from the in-game name;
/// anything else is derived from the class name (`Desc_IronRod_C` → `Iron Rod`).
pub fn display_name(class: &str) -> String {
    let core = class.trim_end_matches("_C");
    let core = core.strip_prefix("Desc_").or_else(|| core.strip_prefix("Build_")).unwrap_or(core);
    let known = match core {
        // items whose internal name differs
        "Cement" => "Concrete",
        "SteelPlate" => "Steel Beam",
        "SteelPlateReinforced" => "Encased Industrial Beam",
        "IronPlateReinforced" => "Reinforced Iron Plate",
        "ModularFrameHeavy" => "Heavy Modular Frame",
        "ModularFrameFused" => "Fused Modular Frame",
        "ModularFrameLightweight" => "Radio Control Unit",
        "SpaceElevatorPart_1" => "Smart Plating",
        "SpaceElevatorPart_2" => "Versatile Framework",
        "SpaceElevatorPart_3" => "Automated Wiring",
        "SpaceElevatorPart_4" => "Modular Engine",
        "SpaceElevatorPart_5" => "Adaptive Control Unit",
        "CircuitBoard" => "Circuit Board",
        "HighSpeedConnector" => "High-Speed Connector",
        "AluminumPlate" => "Alclad Aluminum Sheet",
        "AluminumPlateReinforced" => "Heat Sink",
        "CopperSheet" => "Copper Sheet",
        "QuartzCrystal" => "Quartz Crystal",
        "Silica" => "Silica",
        "Rubber" => "Rubber",
        "Plastic" => "Plastic",
        "Fabric" => "Fabric",
        "CrystalOscillator" => "Crystal Oscillator",
        "SteelPipe" => "Steel Pipe",
        "IronScrew" => "Screw",
        // buildings
        "SmelterMk1" => "Smelter",
        "FoundryMk1" => "Foundry",
        "ConstructorMk1" => "Constructor",
        "AssemblerMk1" => "Assembler",
        "ManufacturerMk1" => "Manufacturer",
        "OilRefinery" => "Refinery",
        "Packager" => "Packager",
        "Blender" => "Blender",
        "HadronCollider" => "Particle Accelerator",
        "QuantumEncoder" => "Quantum Encoder",
        "Converter" => "Converter",
        "MinerMk1" => "Miner Mk.1",
        "MinerMk2" => "Miner Mk.2",
        "MinerMk3" => "Miner Mk.3",
        "WaterPump" => "Water Extractor",
        "OilPump" => "Oil Extractor",
        "GeneratorCoal" => "Coal Generator",
        "GeneratorFuel" => "Fuel Generator",
        "GeneratorNuclear" => "Nuclear Power Plant",
        "GeneratorBiomass_Automated" => "Biomass Burner",
        "ConveyorAttachmentMerger" => "Conveyor Merger",
        "ConveyorAttachmentSplitter" => "Conveyor Splitter",
        "ConveyorAttachmentSplitterSmart" => "Smart Splitter",
        "ConveyorAttachmentSplitterProgrammable" => "Programmable Splitter",
        "ConveyorPole" => "Conveyor Pole",
        "PipelineMK2" => "Pipeline Mk.2",
        "PipelineJunction_Cross" => "Pipeline Junction",
        "PowerLine" => "Power Line",
        "PowerPoleMk1" => "Power Pole Mk.1",
        "PowerPoleMk2" => "Power Pole Mk.2",
        "PowerPoleMk3" => "Power Pole Mk.3",
        "PowerPoleWall" => "Wall Outlet Mk.1",
        "PowerPoleWallDouble" => "Double Wall Outlet Mk.1",
        "PowerStorageMk1" => "Power Storage",
        "StorageContainerMk1" => "Storage Container",
        "StorageContainerMk2" => "Industrial Storage Container",
        "FoundationPassthrough_Lift" => "Conveyor Lift Floor Hole",
        _ => "",
    };
    if !known.is_empty() { return known.to_string(); }
    // ConveyorBeltMk4 → Conveyor Belt Mk.4 ; Flat_Frame_01 → Flat Frame 01
    let mut out = String::new();
    let chars: Vec<char> = core.chars().collect();
    for (i, &c) in chars.iter().enumerate() {
        if c == '_' { if !out.ends_with(' ') { out.push(' '); } continue; }
        let prev = if i > 0 { chars[i - 1] } else { ' ' };
        if i > 0 && prev != '_' && ((c.is_uppercase() && prev.is_lowercase()) || (c.is_ascii_digit() && prev.is_alphabetic() && !out.ends_with("Mk"))) {
            out.push(' ');
        }
        out.push(c);
    }
    out.replace("Mk", "Mk.").replace("Mk. ", "Mk.").trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn fstr(v: &mut Vec<u8>, s: &str) {
        if s.is_empty() { v.extend(0i32.to_le_bytes()); return; }
        v.extend(((s.len() + 1) as i32).to_le_bytes());
        v.extend(s.as_bytes());
        v.push(0);
    }

    /// Builds a file with the same layout as a real 1.0 blueprint (save version 52).
    fn synthetic_sbp(actors: &[(&str, usize)], components: usize) -> Vec<u8> {
        let mut v = Vec::new();
        for x in [2i32, 52, 424353, 5, 5, 5] { v.extend(x.to_le_bytes()); }
        v.extend(2i32.to_le_bytes());
        for (path, amt) in [("/Game/FactoryGame/Resource/Parts/Cement/Desc_Cement.Desc_Cement_C", 70), ("/Game/FactoryGame/Resource/Parts/Rotor/Desc_Rotor.Desc_Rotor_C", 30)] {
            fstr(&mut v, ""); fstr(&mut v, path); v.extend((amt as i32).to_le_bytes());
        }
        v.extend(1i32.to_le_bytes());
        fstr(&mut v, ""); fstr(&mut v, "/Game/FactoryGame/Recipes/Buildings/Recipe_SmelterMk1.Recipe_SmelterMk1_C");

        let mut objs = Vec::new();
        let n = actors.iter().map(|a| a.1).sum::<usize>() + components;
        objs.extend((n as i32).to_le_bytes());
        for (class, count) in actors {
            for i in 0..*count {
                objs.extend(1i32.to_le_bytes());
                fstr(&mut objs, &format!("/Game/FactoryGame/Buildable/{class}.{class}"));
                fstr(&mut objs, "Persistent_Level");
                fstr(&mut objs, &format!("Persistent_Level:PersistentLevel.{class}_{i}"));
                objs.extend(8i32.to_le_bytes());
                objs.extend(1i32.to_le_bytes());
                objs.extend([0u8; 40]);
                objs.extend(0i32.to_le_bytes());
            }
        }
        for i in 0..components {
            objs.extend(0i32.to_le_bytes());
            fstr(&mut objs, "/Script/FactoryGame.FGFactoryConnectionComponent");
            fstr(&mut objs, "Persistent_Level");
            fstr(&mut objs, &format!("Persistent_Level:PersistentLevel.X.Input{i}"));
            objs.extend(8i32.to_le_bytes());
            fstr(&mut objs, "Persistent_Level:PersistentLevel.X");
        }
        let mut body = Vec::new();
        body.extend(((objs.len() + 4 + 16) as i32).to_le_bytes());
        body.extend((objs.len() as i32).to_le_bytes());
        body.extend(&objs);
        body.extend([0u8; 16]); // object data section, unused here

        // split into two zlib chunks like the game does
        let mid = body.len() / 2;
        for part in [&body[..mid], &body[mid..]] {
            let mut z = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
            z.write_all(part).unwrap();
            let c = z.finish().unwrap();
            v.extend(CHUNK_TAG.to_le_bytes());
            v.extend(0x2222_2222u32.to_le_bytes());
            v.extend(131072u64.to_le_bytes());
            v.push(3);
            for x in [c.len() as u64, part.len() as u64, c.len() as u64, part.len() as u64] { v.extend(x.to_le_bytes()); }
            v.extend(&c);
        }
        v
    }

    #[test]
    fn reads_cost_size_and_buildings() {
        let f = synthetic_sbp(&[("Build_FoundryMk1_C", 3), ("Build_ConveyorBeltMk4_C", 16), ("Build_PowerLine_C", 9)], 7);
        let b = parse_sbp(&f).unwrap();
        assert_eq!(b.size, [5, 5, 5]);
        assert_eq!(b.save_version, 52);
        assert_eq!(b.cost, vec![
            Line { class: "Desc_Cement_C".into(), name: "Concrete".into(), amount: 70 },
            Line { class: "Desc_Rotor_C".into(), name: "Rotor".into(), amount: 30 },
        ]);
        assert_eq!(b.buildings_error, None);
        assert_eq!(b.total_buildings, 28);
        let names: Vec<(&str, u32)> = b.buildings.iter().map(|l| (l.name.as_str(), l.amount)).collect();
        assert_eq!(names, [("Conveyor Belt Mk.4", 16), ("Power Line", 9), ("Foundry", 3)]);
    }

    #[test]
    fn damaged_files_are_reported_not_guessed() {
        assert!(parse_sbp(b"").is_err());
        assert!(parse_sbp(b"<html>not a blueprint</html>").is_err());
        let mut f = synthetic_sbp(&[("Build_FoundryMk1_C", 1)], 0);
        let len = f.len();
        f.truncate(len - 20); // corrupt the body: cost still readable, buildings reported as unreadable
        let b = parse_sbp(&f).unwrap();
        assert_eq!(b.cost.len(), 2);
        assert!(b.buildings.is_empty() && b.buildings_error.is_some());
    }

    #[test]
    fn reads_config() {
        let mut v = Vec::new();
        v.extend(0i32.to_le_bytes());
        fstr(&mut v, "Stackable frame\r\n- Input is balanced");
        v.extend(78i32.to_le_bytes());
        for f in [0.107f32, 0.434, 0.558, 1.0] { v.extend(f.to_le_bytes()); }
        let c = parse_cfg(&v).unwrap();
        assert_eq!(c.description, "Stackable frame\n- Input is balanced");
        assert_eq!(c.icon_id, 78);
        assert!((c.color[3] - 1.0).abs() < 1e-6);
    }

    #[test]
    fn names() {
        assert_eq!(display_name("Desc_SteelPlateReinforced_C"), "Encased Industrial Beam");
        assert_eq!(display_name("Desc_IronRod_C"), "Iron Rod");
        assert_eq!(display_name("Build_ConveyorBeltMk4_C"), "Conveyor Belt Mk.4");
        assert_eq!(display_name("Build_ConveyorLiftMk4_C"), "Conveyor Lift Mk.4");
        assert_eq!(display_name("Build_Flat_Frame_01_C"), "Flat Frame 01");
        assert_eq!(display_name("Build_Beam_Connector_Double_C"), "Beam Connector Double");
    }

    /// Optional check against a real blueprint: FA_SAMPLE_SBP=/path/to/file.sbp cargo test -- --nocapture
    #[test]
    fn real_sample_if_provided() {
        let Ok(path) = std::env::var("FA_SAMPLE_SBP") else { return };
        let b = parse_sbp(&std::fs::read(&path).unwrap()).unwrap();
        println!("{b:#?}");
        assert!(b.buildings_error.is_none(), "{:?}", b.buildings_error);
        if let Ok(cfg) = std::fs::read(path.replace(".sbp", ".sbpcfg")) { println!("{:#?}", parse_cfg(&cfg).unwrap()); }
    }
}
