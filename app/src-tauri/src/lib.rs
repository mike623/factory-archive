use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// A place Satisfactory keeps blueprints. The game stores them under
/// `<LocalAppData>\FactoryGame\Saved\SaveGames\blueprints\<session name>\`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GameFolder {
    /// "native" (Windows) or "crossover" (macOS bottle)
    kind: &'static str,
    /// Human label, e.g. "Windows" or "CrossOver · Steam"
    label: String,
    /// The `blueprints` root
    path: String,
    /// Whether the game's `FactoryGame` data folder exists there
    found: bool,
}

fn blueprints_under(local_app_data: &Path) -> PathBuf {
    local_app_data
        .join("FactoryGame")
        .join("Saved")
        .join("SaveGames")
        .join("blueprints")
}

fn has_game_data(local_app_data: &Path) -> bool {
    local_app_data.join("FactoryGame").is_dir()
}

/// Every CrossOver bottle that has Satisfactory data in any of its Windows user profiles.
/// Bottles live in `~/Library/Application Support/CrossOver/Bottles/<bottle>/drive_c/users/<user>/`.
fn crossover_folders(home: &Path) -> Vec<GameFolder> {
    let bottles = home.join("Library/Application Support/CrossOver/Bottles");
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(&bottles) else { return out };
    for bottle in entries.flatten() {
        let users = bottle.path().join("drive_c").join("users");
        let Ok(profiles) = std::fs::read_dir(&users) else { continue };
        for profile in profiles.flatten() {
            let local = profile.path().join("AppData").join("Local");
            if has_game_data(&local) {
                out.push(GameFolder {
                    kind: "crossover",
                    label: format!("CrossOver · {}", bottle.file_name().to_string_lossy()),
                    path: blueprints_under(&local).to_string_lossy().into_owned(),
                    found: true,
                });
            }
        }
    }
    out.sort_by(|a, b| a.label.cmp(&b.label));
    out
}

/// Candidate blueprint folders on this machine, best match first.
#[tauri::command]
fn game_folders(app: tauri::AppHandle) -> Result<Vec<GameFolder>, String> {
    let mut out = Vec::new();
    if cfg!(target_os = "macos") {
        let home = app.path().home_dir().map_err(|e| e.to_string())?;
        out.extend(crossover_folders(&home));
    } else {
        let local = app.path().local_data_dir().map_err(|e| e.to_string())?;
        out.push(GameFolder {
            kind: "native",
            label: "Windows".into(),
            path: blueprints_under(&local).to_string_lossy().into_owned(),
            found: has_game_data(&local),
        });
    }
    Ok(out)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![game_folders])
        .run(tauri::generate_context!())
        .expect("error while running Factory Archive");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_game_in_crossover_bottles() {
        let home = std::env::temp_dir().join(format!("fa-test-{}", std::process::id()));
        let bottles = home.join("Library/Application Support/CrossOver/Bottles");
        // bottle with the game installed
        std::fs::create_dir_all(bottles.join("Steam/drive_c/users/crossover/AppData/Local/FactoryGame/Saved")).unwrap();
        // bottle without it
        std::fs::create_dir_all(bottles.join("Office/drive_c/users/crossover/AppData/Local")).unwrap();

        let found = crossover_folders(&home);
        std::fs::remove_dir_all(&home).ok();

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].label, "CrossOver · Steam");
        assert!(found[0].path.ends_with("FactoryGame/Saved/SaveGames/blueprints"));
    }

    #[test]
    fn no_crossover_install_is_empty() {
        assert!(crossover_folders(Path::new("/nonexistent-home")).is_empty());
    }
}
