//! Installs the Factory Archive Live mod from its release zip into `<game>/FactoryGame/Mods/FactoryArchiveLive/`.
//! The zip is checked first (our `.uplugin` at its root, a Windows DLL, safe paths, size caps), unpacked
//! into a staging folder, and only then swapped in, so a bad zip or a locked file leaves the old install as it was.
use serde::Serialize;
use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};

const MOD: &str = "FactoryArchiveLive";
/// Unpacked size cap; the real zip is ~100 MB, mostly debug symbols.
const MAX_TOTAL: u64 = 512 << 20;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub version: String,
    pub path: String,
    /// whether SML (which the mod needs) is installed in that game
    pub sml: bool,
}

/// A Satisfactory install (game or dedicated server) has `FactoryGame/Binaries`.
pub fn is_game_dir(p: &Path) -> bool {
    p.join("FactoryGame").join("Binaries").is_dir()
}

/// Steam and Epic installs found under the given `Program Files (x86)` and `ProgramData` folders.
pub fn find_games(program_files_x86: &Path, program_data: &Path) -> Vec<PathBuf> {
    let mut libs = vec![program_files_x86.join("Steam")];
    // ponytail: only the default Steam location's library list; other setups use the folder picker
    if let Ok(vdf) = fs::read_to_string(program_files_x86.join("Steam/steamapps/libraryfolders.vdf")) {
        for line in vdf.lines() {
            let parts: Vec<&str> = line.split('"').collect();
            if parts.len() >= 4 && parts[1] == "path" { libs.push(PathBuf::from(parts[3].replace("\\\\", "\\"))); }
        }
    }
    let mut out: Vec<PathBuf> = libs.iter().map(|l| l.join("steamapps").join("common").join("Satisfactory")).collect();
    if let Ok(items) = fs::read_dir(program_data.join("Epic/EpicGamesLauncher/Data/Manifests")) {
        for item in items.flatten() {
            let Ok(text) = fs::read_to_string(item.path()) else { continue };
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
            if v["DisplayName"].as_str().is_some_and(|n| n.starts_with("Satisfactory")) {
                if let Some(p) = v["InstallLocation"].as_str() { out.push(PathBuf::from(p)); }
            }
        }
    }
    out.retain(|p| is_game_dir(p));
    out.dedup();
    out
}

type Zip<'a> = zip::ZipArchive<Cursor<&'a [u8]>>;

fn open(bytes: &[u8]) -> Result<Zip<'_>, String> {
    zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "That file isn't a zip.".to_string())
}

/// Read one entry, refusing more than `cap` bytes whatever its header claims.
fn read_capped(z: &mut Zip, i: usize, cap: u64) -> Result<Vec<u8>, String> {
    let f = z.by_index(i).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    f.take(cap + 1).read_to_end(&mut buf).map_err(|e| e.to_string())?;
    if buf.len() as u64 > cap { return Err("The zip is larger than expected.".into()); }
    Ok(buf)
}

/// The mod's version, if this is the Factory Archive Live zip.
fn check(z: &mut Zip) -> Result<String, String> {
    let wrong = || format!("That zip isn't the Factory Archive Live mod (no {MOD}.uplugin at its top level).");
    let i = z.index_for_name(&format!("{MOD}.uplugin")).ok_or_else(wrong)?;
    let plugin: serde_json::Value = serde_json::from_slice(&read_capped(z, i, 64 << 10)?).map_err(|_| wrong())?;
    let version = plugin["SemVersion"].as_str().filter(|v| !v.is_empty()).ok_or_else(wrong)?.to_string();
    if !z.file_names().any(|n| n.starts_with("Binaries/Win64/") && n.ends_with(".dll")) {
        return Err("That zip has no Windows build of the mod in it.".into());
    }
    Ok(version)
}

fn unpack(z: &mut Zip, to: &Path) -> Result<(), String> {
    let mut left = MAX_TOTAL;
    for i in 0..z.len() {
        let (rel, dir) = {
            let f = z.by_index(i).map_err(|e| e.to_string())?;
            (f.enclosed_name().ok_or("The zip contains an unsafe file path.")?, f.is_dir())
        };
        let dest = to.join(rel);
        if dir { fs::create_dir_all(&dest).map_err(|e| e.to_string())?; continue; }
        let data = read_capped(z, i, left)?;
        left -= data.len() as u64;
        if let Some(parent) = dest.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
        fs::File::create_new(&dest).and_then(|mut f| f.write_all(&data)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Install (or update) the mod from `zip` into the game at `game`.
pub fn install(zip: &[u8], game: &Path) -> Result<Installed, String> {
    if !is_game_dir(game) { return Err("That folder isn't a Satisfactory install (there's no FactoryGame\\Binaries inside).".into()); }
    let mut z = open(zip)?;
    // a zip downloaded from a GitHub Actions run wraps the real one
    let inner;
    if z.len() == 1 && z.name_for_index(0).is_some_and(|n| n.ends_with(".zip")) {
        inner = read_capped(&mut z, 0, MAX_TOTAL)?;
        z = open(&inner)?;
    }
    let version = check(&mut z)?;

    // staging lives outside Mods so the game never sees a half-written or second copy
    let staging = game.join("FactoryGame").join(format!(".{MOD}.staging"));
    let (new, old) = (staging.join("new"), staging.join("old"));
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&new).map_err(|e| e.to_string())?;
    if let Err(e) = unpack(&mut z, &new) { let _ = fs::remove_dir_all(&staging); return Err(e); }

    let mods = game.join("FactoryGame").join("Mods");
    let dest = mods.join(MOD);
    let swap = || -> Result<(), String> {
        fs::create_dir_all(&mods).map_err(|e| e.to_string())?;
        if dest.exists() {
            fs::rename(&dest, &old).map_err(|_| "Couldn't replace the installed mod. Close the game first, then try again.")?;
        }
        if let Err(e) = fs::rename(&new, &dest) {
            if old.exists() { let _ = fs::rename(&old, &dest); }
            return Err(e.to_string());
        }
        Ok(())
    };
    let done = swap();
    let _ = fs::remove_dir_all(&staging);
    done?;
    Ok(Installed {
        version,
        path: dest.to_string_lossy().into_owned(),
        sml: mods.join("SML").join("SML.uplugin").is_file(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::write::SimpleFileOptions;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("fa-mod-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("FactoryGame/Binaries")).unwrap();
        d
    }

    fn zip_of(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (n, b) in files { w.start_file(*n, SimpleFileOptions::default()).unwrap(); w.write_all(b).unwrap(); }
        w.finish().unwrap().into_inner()
    }

    fn good(version: &str) -> Vec<u8> {
        let plugin = format!(r#"{{"SemVersion":"{version}"}}"#);
        zip_of(&[("FactoryArchiveLive.uplugin", plugin.as_bytes()), ("Binaries/Win64/FactoryGameSteam-FactoryArchiveLive-Win64-Shipping.dll", b"MZ")])
    }

    #[test]
    fn installs_then_updates() {
        let g = tmp("ok");
        let r = install(&good("0.1.0"), &g).unwrap();
        assert_eq!(r.version, "0.1.0");
        assert!(!r.sml);
        fs::write(g.join("FactoryGame/Mods/FactoryArchiveLive/stale.txt"), "x").unwrap();
        install(&good("0.1.1"), &g).unwrap();
        let m = g.join("FactoryGame/Mods/FactoryArchiveLive");
        assert!(fs::read_to_string(m.join("FactoryArchiveLive.uplugin")).unwrap().contains("0.1.1"));
        assert!(!m.join("stale.txt").exists(), "old files are replaced, not merged");
        assert!(!g.join("FactoryGame/.FactoryArchiveLive.staging").exists());
        fs::remove_dir_all(&g).ok();
    }

    #[test]
    fn unwraps_an_actions_artifact_zip() {
        let g = tmp("nested");
        assert_eq!(install(&zip_of(&[("FactoryArchiveLive.zip", &good("0.2.0"))]), &g).unwrap().version, "0.2.0");
        fs::remove_dir_all(&g).ok();
    }

    #[test]
    fn refuses_bad_input_and_leaves_install_alone() {
        let g = tmp("bad");
        install(&good("0.1.0"), &g).unwrap();
        let other = zip_of(&[("SomeOtherMod.uplugin", br#"{"SemVersion":"1.0.0"}"#)]);
        let no_dll = zip_of(&[("FactoryArchiveLive.uplugin", br#"{"SemVersion":"1.0.0"}"#)]);
        let escape = zip_of(&[("FactoryArchiveLive.uplugin", br#"{"SemVersion":"1.0.0"}"#), ("Binaries/Win64/x.dll", b"MZ"), ("../evil.txt", b"x")]);
        for z in [b"not a zip".to_vec(), other, no_dll, escape] { assert!(install(&z, &g).is_err()); }
        assert!(!g.join("FactoryGame/evil.txt").exists());
        assert!(fs::read_to_string(g.join("FactoryGame/Mods/FactoryArchiveLive/FactoryArchiveLive.uplugin")).unwrap().contains("0.1.0"));
        assert!(install(&good("0.1.0"), &g.join("FactoryGame")).is_err(), "not a game folder");
        fs::remove_dir_all(&g).ok();
    }

    /// Check against a real release zip: `FA_SAMPLE_MOD_ZIP=path/to/FactoryArchiveLive.zip cargo test`
    #[test]
    fn installs_a_real_zip() {
        let Ok(p) = std::env::var("FA_SAMPLE_MOD_ZIP") else { return };
        let g = tmp("real");
        let r = install(&fs::read(p).unwrap(), &g).unwrap();
        assert!(!r.version.is_empty());
        assert!(g.join("FactoryGame/Mods/FactoryArchiveLive/Binaries/Win64").is_dir());
        fs::remove_dir_all(&g).ok();
    }

    #[test]
    fn finds_steam_libraries_and_epic() {
        let root = std::env::temp_dir().join(format!("fa-mod-find-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let (pf, pd, lib) = (root.join("pf86"), root.join("pd"), root.join("D/SteamLibrary"));
        fs::create_dir_all(pf.join("Steam/steamapps")).unwrap();
        fs::write(pf.join("Steam/steamapps/libraryfolders.vdf"),
            format!("\"libraryfolders\"\n{{\n\t\"1\"\n\t{{\n\t\t\"path\"\t\t\"{}\"\n\t}}\n}}\n", lib.display())).unwrap();
        fs::create_dir_all(lib.join("steamapps/common/Satisfactory/FactoryGame/Binaries")).unwrap();
        let epic = root.join("Epic/Satisfactory");
        fs::create_dir_all(epic.join("FactoryGame/Binaries")).unwrap();
        fs::create_dir_all(pd.join("Epic/EpicGamesLauncher/Data/Manifests")).unwrap();
        fs::write(pd.join("Epic/EpicGamesLauncher/Data/Manifests/a.item"),
            serde_json::json!({"DisplayName": "Satisfactory", "InstallLocation": epic}).to_string()).unwrap();
        let found = find_games(&pf, &pd);
        fs::remove_dir_all(&root).ok();
        assert_eq!(found, vec![lib.join("steamapps/common/Satisfactory"), epic]);
    }
}
