mod blueprints;
mod meta;
mod sbp;
mod resolve;
mod share;

use serde::Serialize;
use meta::{BlueprintMeta, MetaStore};
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
    state.start(PathBuf::from(root), move |ev, bp| {
        let _ = app.state::<MetaStore>().save_resolved(bp);
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

/// Every blueprint on disk, grouped by world session (newest session first).
#[tauri::command]
fn library(store: tauri::State<'_, MetaStore>, root: String) -> Vec<LibSession> {
    let root = PathBuf::from(root);
    blueprints::list_sessions(&root).into_iter().map(|s| LibSession {
        blueprints: s.blueprints.into_iter().map(|f| {
            let key = f.has_sbp.then(|| store.key_for_file(&root.join(&s.name).join(format!("{}.sbp", f.name)))).flatten();
            let meta = key.as_deref().and_then(|k| store.load(k));
            LibFile { file: f, key, meta }
        }).collect(),
        name: s.name,
    }).collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LibFile {
    #[serde(flatten)]
    file: blueprints::BlueprintFile,
    /// content fingerprint, used to look up details and the picture
    key: Option<String>,
    meta: Option<BlueprintMeta>,
}

#[derive(Serialize)]
struct LibSession {
    name: String,
    blueprints: Vec<LibFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BlueprintInfo {
    breakdown: Option<sbp::Breakdown>,
    /// why the .sbp couldn't be read, if it couldn't
    error: Option<String>,
    /// description, icon and color from the .sbpcfg, if present and readable
    config: Option<sbp::BlueprintConfig>,
}

/// What a blueprint contains (size, material cost, buildings), read from its own files.
#[tauri::command]
fn blueprint_info(root: String, session: String, name: String) -> BlueprintInfo {
    let root = PathBuf::from(root);
    let (breakdown, error) = match blueprints::read_file(&root, &session, &name, "sbp") {
        Ok(b) => match sbp::parse_sbp(&b) { Ok(x) => (Some(x), None), Err(e) => (None, Some(e)) },
        Err(e) => (None, Some(e.to_string())),
    };
    let config = blueprints::read_file(&root, &session, &name, "sbpcfg").ok().and_then(|b| sbp::parse_cfg(&b).ok());
    BlueprintInfo { breakdown, error, config }
}

/// A blueprint's saved picture as a data: URL.
#[tauri::command]
fn blueprint_image(store: tauri::State<'_, MetaStore>, key: String) -> Option<String> {
    store.image_data_url(&key)
}

/// Remember that successfully added files came from this machine (keeps richer details if present).
fn note_local(store: &MetaStore, root: &Path, session: &str, out: &[blueprints::Outcome]) {
    for o in out.iter().filter(|o| o.ok) {
        if let Ok(b) = blueprints::read_file(root, session, &o.name, "sbp") { store.note_local(&b); }
    }
}

/// Add .sbp/.sbpcfg files picked from anywhere on disk to a world session.
#[tauri::command]
fn import_files(store: tauri::State<'_, MetaStore>, root: String, session: String, paths: Vec<String>) -> Vec<blueprints::Outcome> {
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    let root = PathBuf::from(root);
    let out = blueprints::import_paths(&root, &session, &paths);
    note_local(&store, &root, &session, &out);
    out
}

/// Add .sbp/.sbpcfg files dropped onto the window (sent as bytes) to a world session.
#[tauri::command]
fn import_bytes(store: tauri::State<'_, MetaStore>, root: String, session: String, files: Vec<(String, Vec<u8>)>) -> Vec<blueprints::Outcome> {
    let root = PathBuf::from(root);
    let out = blueprints::import_named(&root, &session, files);
    note_local(&store, &root, &session, &out);
    out
}

/// Copy blueprints (`(session, name)` pairs) into another world session.
#[tauri::command]
fn copy_blueprints(root: String, items: Vec<(String, String)>, target: String) -> Vec<blueprints::Outcome> {
    let root = PathBuf::from(root);
    items.iter().map(|(from, name)| blueprints::copy_outcome(&root, from, name, &target)).collect()
}

/// Rename a blueprint's files in its world session.
#[tauri::command]
fn rename_blueprint(root: String, session: String, from: String, to: String) -> Result<(), String> {
    blueprints::rename(&PathBuf::from(root), &session, &from, &to).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkImport {
    name: String,
    session: String,
    has_cfg: bool,
    size_kb: u64,
}

/// Download a blueprint from a SCIM / Satisfactory Blueprints / direct link and add it to a world.
#[tauri::command]
async fn import_link(app: tauri::AppHandle, root: String, session: String, url: String) -> Result<LinkImport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bp = resolve::resolve(&url)?;
        blueprints::write_blueprint(&PathBuf::from(&root), &session, &bp.name, &bp.sbp, bp.cfg.as_deref(), true)
            .map_err(|e| e.to_string())?;
        // details + picture are a bonus: a failure here doesn't undo the import
        if let Err(e) = app.state::<MetaStore>().save_resolved(&bp) { eprintln!("couldn't save blueprint details: {e}"); }
        Ok(LinkImport { size_kb: (bp.sbp.len() as u64).div_ceil(1024), has_cfg: bp.cfg.is_some(), name: bp.name, session })
    })
    .await
    .map_err(|e| e.to_string())?
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
        .setup(|app| {
            let dir = app.path().app_data_dir()?.join("blueprint-meta");
            app.manage(MetaStore::new(dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![game_folders, open_folder, library, blueprint_image, blueprint_info, import_link, import_files, import_bytes, copy_blueprints, rename_blueprint, sessions, share_start, share_stop, share_status, share_set_session])
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
