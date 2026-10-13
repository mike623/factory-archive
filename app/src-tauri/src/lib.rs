mod blueprints;
mod resolve;
mod share;

use serde::Serialize;
use share::{ShareInfo, ShareState};
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};

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

/// Open the blueprints folder (or one session inside it) in Explorer / Finder.
/// Only existing directories are opened, never files.
#[tauri::command]
fn open_folder(app: tauri::AppHandle, root: String, session: Option<String>) -> Result<String, String> {
    use tauri_plugin_opener::OpenerExt;
    let root = PathBuf::from(root);
    let target = session
        .filter(|s| blueprints::valid_component(s))
        .map(|s| root.join(s))
        .filter(|p| p.is_dir())
        .unwrap_or_else(|| root.clone());
    if !target.is_dir() {
        return Err("This folder doesn't exist yet. Satisfactory creates it when you save your first blueprint.".into());
    }
    let path = target.to_string_lossy().into_owned();
    app.opener().open_path(&path, None::<&str>).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Start sharing `root` (a game's `blueprints` folder) with players on the local network.
#[tauri::command]
fn share_start(app: tauri::AppHandle, state: tauri::State<'_, ShareState>, root: String) -> Result<ShareInfo, String> {
    state.start(PathBuf::from(root), move |ev| {
        let _ = app.emit("share-imported", ev);
    })
}

#[tauri::command]
fn share_stop(state: tauri::State<'_, ShareState>) {
    state.stop();
}

/// Sessions in the blueprints folder plus the detected current world, for the host's picker.
#[tauri::command]
fn sessions(state: tauri::State<'_, ShareState>, root: String) -> serde_json::Value {
    let root = PathBuf::from(root);
    serde_json::json!({
        "detected": blueprints::detect_current(&root),
        "pinned": state.pinned(),
        "sessions": blueprints::list_sessions(&root).into_iter().map(|s| s.name).collect::<Vec<_>>(),
    })
}

/// Pin friends' imports to a session (`None` = follow the detected current world).
#[tauri::command]
fn share_set_session(state: tauri::State<'_, ShareState>, name: Option<String>) -> Result<(), String> {
    state.set_session(name)
}

#[tauri::command]
fn share_status(state: tauri::State<'_, ShareState>) -> Option<ShareInfo> {
    state.status()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(ShareState::default())
        .invoke_handler(tauri::generate_handler![game_folders, open_folder, sessions, share_start, share_stop, share_status, share_set_session])
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
