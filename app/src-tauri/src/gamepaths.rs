//! Read-only discovery of native Windows data and CrossOver bottles on macOS.
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameFolder {
    pub kind: &'static str,
    pub label: String,
    pub path: String,
    pub found: bool,
}

pub fn native(local: &Path) -> GameFolder {
    folder(local, "native", "Windows".into())
}

fn folder(local: &Path, kind: &'static str, label: String) -> GameFolder {
    GameFolder {
        kind, label,
        path: local.join("FactoryGame/Saved/SaveGames/blueprints").to_string_lossy().into_owned(),
        found: local.join("FactoryGame").is_dir(),
    }
}

fn directories(root: &Path) -> Vec<PathBuf> {
    let mut paths: Vec<_> = std::fs::read_dir(root).into_iter().flatten().flatten()
        .map(|e| e.path()).filter(|p| p.is_dir()).collect();
    paths.sort();
    paths
}

// shortcut: only the default Bottles directory; add relocated-bottle discovery when needed.
pub fn bottles(home: &Path) -> Vec<PathBuf> {
    directories(&home.join("Library/Application Support/CrossOver/Bottles"))
        .into_iter().filter(|p| p.join("drive_c").is_dir()).collect()
}

pub fn crossover_folders(home: &Path) -> Vec<GameFolder> {
    let mut out = Vec::new();
    for bottle in bottles(home) {
        for user in directories(&bottle.join("drive_c/users")) {
            let f = folder(&user.join("AppData/Local"), "crossover",
                format!("CrossOver · {} · {}", bottle.file_name().unwrap().to_string_lossy(), user.file_name().unwrap().to_string_lossy()));
            if f.found && !out.iter().any(|x: &GameFolder| x.path == f.path) { out.push(f); }
        }
    }
    out
}

/// Translate a bottle's Windows paths, including mapped external Steam libraries.
pub fn bottle_path(bottle: &Path, windows: &str) -> PathBuf {
    let path = windows.replace('\\', "/");
    let bytes = path.as_bytes();
    if bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && &bytes[1..3] == b":/" {
        let drive = (bytes[0] as char).to_ascii_lowercase();
        let root = if drive == 'c' { bottle.join("drive_c") }
            else { bottle.join("dosdevices").join(format!("{drive}:")) };
        return root.join(&path[3..]);
    }
    PathBuf::from(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_only_real_game_data_across_bottles_and_profiles() {
        let home = std::env::temp_dir().join(format!("fa-crossover-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        assert!(crossover_folders(&home).is_empty());
        let base = home.join("Library/Application Support/CrossOver/Bottles");
        for (bottle, user) in [("Steam", "crossover"), ("Epic", "player")] {
            std::fs::create_dir_all(base.join(bottle).join("drive_c/users").join(user).join("AppData/Local/FactoryGame/Saved/SaveGames")).unwrap();
        }
        std::fs::create_dir_all(base.join("Other/drive_c/users/crossover/AppData/Local")).unwrap();
        let found = crossover_folders(&home);
        assert_eq!(found.len(), 2);
        assert!(found.iter().all(|f| f.kind == "crossover" && f.found && Path::new(&f.path).ends_with("FactoryGame/Saved/SaveGames/blueprints")));
        assert!(found[0].label.contains("Epic"));
        assert!(!Path::new(&found[0].path).exists(), "discovery never creates game folders");
        std::fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn translates_windows_drive_paths() {
        let bottle = Path::new("/bottles/Steam");
        assert_eq!(bottle_path(bottle, r"C:\Program Files (x86)\Steam"), bottle.join("drive_c/Program Files (x86)/Steam"));
        assert_eq!(bottle_path(bottle, r"D:\SteamLibrary"), bottle.join("dosdevices/d:/SteamLibrary"));
    }

    /// Optional read-only probe: FA_PROBE_CROSSOVER=1 cargo test probe_local_crossover -- --nocapture
    #[test]
    fn probe_local_crossover() {
        if std::env::var_os("FA_PROBE_CROSSOVER").is_none() { return; }
        let home = PathBuf::from(std::env::var_os("HOME").unwrap());
        let folders = crossover_folders(&home);
        assert!(!folders.is_empty(), "no Satisfactory data found");
        for f in folders { println!("{}: {}", f.label, f.path); }
        let games: Vec<_> = bottles(&home).iter().flat_map(|b| crate::modinstall::find_bottle_games(b)).collect();
        assert!(!games.is_empty(), "no Satisfactory installation found");
        for game in games { println!("Game: {}", game.display()); }
    }
}
