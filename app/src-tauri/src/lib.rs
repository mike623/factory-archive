mod blueprints;
mod meta;
mod modinstall;
mod sav;
mod savedit;
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
    /// "native" (Windows)
    kind: &'static str,
    /// Human label, e.g. "Windows"
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

/// Candidate blueprint folders on this machine, best match first.
#[tauri::command]
fn game_folders(app: tauri::AppHandle) -> Result<Vec<GameFolder>, String> {
    let local = app.path().local_data_dir().map_err(|e| e.to_string())?;
    Ok(vec![GameFolder {
        kind: "native",
        label: "Windows".into(),
        path: blueprints_under(&local).to_string_lossy().into_owned(),
        found: has_game_data(&local),
    }])
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
    let app2 = app.clone();
    state.start(PathBuf::from(root), move |ev, bp| {
        let _ = app.state::<MetaStore>().save_resolved(bp);
        let _ = app.emit("share-imported", ev);
    }, move |url, dir| app2.state::<MetaStore>().imported_from(url, dir))
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
fn library(store: tauri::State<'_, MetaStore>, cats: tauri::State<'_, sav::CategoryCache>, root: String) -> Vec<LibSession> {
    let root = PathBuf::from(root);
    blueprints::list_sessions(&root).into_iter().map(|s| {
        // the game keeps categories in the world's save; a save we can't read leaves them empty
        let (categories, categories_error) = match cats.for_session(&root, &s.name) {
            Ok(c) => (c, None),
            Err(e) => (Default::default(), Some(e)),
        };
        LibSession {
            blueprints: s.blueprints.into_iter().map(|f| {
                let key = f.has_sbp.then(|| store.key_for_file(&root.join(&s.name).join(format!("{}.sbp", f.name)))).flatten();
                let meta = key.as_deref().and_then(|k| store.load(k));
                let (category, subcategory) = categories.get(&f.name).cloned().unzip();
                LibFile { file: f, key, meta, category, subcategory }
            }).collect(),
            name: s.name,
            categories_error,
        }
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
    /// the game's category / sub-category, from the world's save
    category: Option<String>,
    subcategory: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LibSession {
    name: String,
    blueprints: Vec<LibFile>,
    /// why the world's save couldn't be read for categories
    categories_error: Option<String>,
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

/// The game's categories in the world's newest save, in the game's order, with pending `edits`
/// applied in memory (nothing is written), for the category editor.
#[tauri::command]
fn category_tree(root: String, session: String, edits: Vec<savedit::Edit>) -> Result<Vec<savedit::CategoryView>, String> {
    check_category_edits(&session, &edits)?;
    savedit::session_view(&PathBuf::from(root), &session, &edits)
}

fn check_category_edits(session: &str, edits: &[savedit::Edit]) -> Result<(), String> {
    if !blueprints::valid_component(session) { return Err("invalid world name".into()); }
    if edits.len() > 500 { return Err("too many changes at once".into()); }
    for e in edits {
        if let savedit::Edit::Move { blueprint, .. } = e {
            if !blueprints::valid_component(blueprint) { return Err("invalid blueprint name".into()); }
        }
    }
    Ok(())
}

/// Apply category changes by writing a new save next to the world's newest one (never overwriting).
/// Returns the new save's file name, for the player to load.
#[tauri::command]
fn edit_categories(root: String, session: String, edits: Vec<savedit::Edit>) -> Result<String, String> {
    check_category_edits(&session, &edits)?;
    if edits.is_empty() { return Err("nothing to change".into()); }
    // the library picks the new save up by itself: it's now the world's newest
    let path = savedit::write_edited(&PathBuf::from(root), &session, &edits)?;
    Ok(path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default())
}

/// The account save folders on this PC (Steam / Epic IDs), and which one holds the world's newest save.
#[tauri::command]
fn save_accounts(root: String, session: String) -> Result<Vec<savedit::Account>, String> {
    if !blueprints::valid_component(&session) { return Err("invalid world name".into()); }
    // ponytail: Steam's default folder only; read the registry's SteamPath if people install it elsewhere
    let vdf = std::env::var_os("ProgramFiles(x86)").map(|p| PathBuf::from(p).join("Steam").join("config").join("loginusers.vdf"))
        .filter(|p| std::fs::metadata(p).is_ok_and(|m| m.is_file() && m.len() <= 1 << 20))
        .and_then(|p| std::fs::read_to_string(p).ok()).unwrap_or_default();
    Ok(savedit::accounts(&PathBuf::from(root), &session, &savedit::steam_names(&vdf)))
}

/// Copy the world's newest save into another account's save folder (never overwriting).
/// Returns the copied file's name.
#[tauri::command]
fn copy_save_to_account(root: String, session: String, account: String) -> Result<String, String> {
    if !blueprints::valid_component(&session) { return Err("invalid world name".into()); }
    let path = savedit::copy_to_account(&PathBuf::from(root), &session, &account)?;
    Ok(path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default())
}

/// Move a blueprint's .sbp and .sbpcfg to the system Trash / Recycle Bin, so it can be restored.
#[tauri::command]
fn delete_blueprint(root: String, session: String, name: String) -> Result<(), String> {
    let files = blueprints::files_of(&PathBuf::from(root), &session, &name).map_err(|e| e.to_string())?;
    trash::delete_all(&files).map_err(|e| format!("couldn't move it to the Trash: {e}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkImport {
    name: String,
    session: String,
    has_cfg: bool,
    size_kb: u64,
}

/// Name of the blueprint in `session` already downloaded from `url`, so the UI can block a repeat.
#[tauri::command]
fn link_imported(store: tauri::State<'_, MetaStore>, root: String, session: String, url: String) -> Option<String> {
    blueprints::valid_component(&session).then_some(())?;
    store.imported_from(&url, &PathBuf::from(root).join(session))
}

/// Download a blueprint from a SCIM / Satisfactory Blueprints / direct link and add it to a world.
#[tauri::command]
async fn import_link(app: tauri::AppHandle, root: String, session: String, url: String) -> Result<LinkImport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(n) = blueprints::valid_component(&session).then(|| app.state::<MetaStore>().imported_from(&url, &PathBuf::from(&root).join(&session))).flatten() {
            return Err(blueprints::BpError::Duplicate(n).to_string());
        }
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

#[derive(Serialize)]
struct RefetchResult {
    updated: usize,
    failed: usize,
}

/// Re-read the page details and picture of every blueprint imported from a link.
/// Only the app's data folder changes; the game's files are never touched.
#[tauri::command]
async fn refetch_details(app: tauri::AppHandle) -> Result<RefetchResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<MetaStore>();
        let (mut updated, mut failed) = (0, 0);
        // ponytail: one page at a time; parallelise if libraries get large
        for (key, meta) in store.linked() {
            let ok = meta.source_url.as_deref().ok_or_else(String::new)
                .and_then(resolve::page_details)
                .and_then(|(page, img)| store.refresh(&key, &page, img.as_ref().map(|(b, e)| (b.as_slice(), *e))));
            match ok { Ok(()) => updated += 1, Err(e) => { failed += 1; eprintln!("couldn't refetch {key}: {e}"); } }
        }
        RefetchResult { updated, failed }
    })
    .await
    .map_err(|e| e.to_string())
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

/// Whether the Factory Archive Live mod is running against this folder (see `blueprints::mod_status`).
#[tauri::command]
fn mod_status(root: String) -> Option<blueprints::ModStatus> {
    blueprints::mod_status(&PathBuf::from(root))
}

/// Satisfactory installs (Steam, Epic) found on this PC, for installing the Live mod.
#[tauri::command]
fn game_installs() -> Vec<String> {
    let env = |k: &str| std::env::var_os(k).map(PathBuf::from);
    let (Some(pf), Some(pd)) = (env("ProgramFiles(x86)"), env("ProgramData")) else { return Vec::new() };
    modinstall::find_games(&pf, &pd).into_iter().map(|p| p.to_string_lossy().into_owned()).collect()
}

/// The Live mod zip bundled with the app (release builds only), if there is one.
fn bundled_mod(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().resolve("resources/FactoryArchiveLive.zip", tauri::path::BaseDirectory::Resource).ok().filter(|p| p.is_file())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveModState {
    /// version of the mod bundled with the app
    bundled: Option<String>,
    /// the first Satisfactory install found on this PC, and the mod version in it
    game: Option<String>,
    installed: Option<String>,
}

/// What a one-click install or update of the Live mod would do.
#[tauri::command]
fn live_mod_state(app: tauri::AppHandle) -> LiveModState {
    let bundled = bundled_mod(&app).and_then(|p| std::fs::read(p).ok()).and_then(|z| modinstall::version_of(&z).ok());
    let game = game_installs().into_iter().next();
    let installed = game.as_deref().and_then(|g| modinstall::installed_version(Path::new(g)));
    LiveModState { bundled, game, installed }
}

/// Install or update the Live mod into the game at `game`, from the release zip at `zip`
/// or, without one, from the zip bundled with the app.
#[tauri::command]
fn install_live_mod(app: tauri::AppHandle, zip: Option<String>, game: String) -> Result<modinstall::Installed, String> {
    let zip = match zip {
        Some(z) => PathBuf::from(z),
        None => bundled_mod(&app).ok_or("This copy of Factory Archive doesn't include the mod. Pick its zip instead.")?,
    };
    if !zip.extension().is_some_and(|e| e.eq_ignore_ascii_case("zip")) { return Err("Pick the mod's .zip file.".into()); }
    let meta = std::fs::metadata(&zip).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > 512 << 20 { return Err("Pick the mod's .zip file.".into()); }
    modinstall::install(&std::fs::read(&zip).map_err(|e| e.to_string())?, &PathBuf::from(game))
}

/// Remove the Live mod from the game at `game`.
#[tauri::command]
fn uninstall_live_mod(game: String) -> Result<(), String> {
    modinstall::uninstall(&PathBuf::from(game))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(ShareState::default())
        .manage(sav::CategoryCache::default())
        .setup(|app| {
            let dir = app.path().app_data_dir()?.join("blueprint-meta");
            app.manage(MetaStore::new(dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![game_folders, open_folder, library, blueprint_image, blueprint_info, import_link, link_imported, refetch_details, import_files, import_bytes, copy_blueprints, rename_blueprint, delete_blueprint, category_tree, edit_categories, save_accounts, copy_save_to_account, sessions, share_start, share_stop, share_status, share_set_session, mod_status, game_installs, live_mod_state, install_live_mod, uninstall_live_mod])
        .run(tauri::generate_context!())
        .expect("error while running Factory Archive");
}
