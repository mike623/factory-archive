use std::path::PathBuf;
use tauri::Manager;

/// Satisfactory keeps blueprints under
/// `%LOCALAPPDATA%\FactoryGame\Saved\SaveGames\blueprints\<session name>\`.
/// Returns that root; per-session folders are picked inside it.
#[tauri::command]
fn blueprint_dir(app: tauri::AppHandle) -> Result<String, String> {
    let base: PathBuf = app.path().local_data_dir().map_err(|e| e.to_string())?;
    let dir = base
        .join("FactoryGame")
        .join("Saved")
        .join("SaveGames")
        .join("blueprints");
    Ok(dir.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![blueprint_dir])
        .run(tauri::generate_context!())
        .expect("error while running Factory Archive");
}
