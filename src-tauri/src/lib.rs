mod config;
mod crypto;
mod db;
mod error;
mod state;
mod world;

use error::LoomError;
use state::AppState;
use world::WorldMeta;

// ─── Tauri Commands ───────────────────────────────────────────────────────────

/// Check if app_config.json exists and is valid.
#[tauri::command]
async fn check_app_config() -> Result<bool, LoomError> {
    config::check_app_config()
}

/// Create a new app_config.json from a master password.
#[tauri::command]
async fn create_app_config(password: String) -> Result<(), LoomError> {
    if password.len() < 8 {
        return Err(LoomError::Validation(
            "Password must be at least 8 characters.".into(),
        ));
    }
    config::create_app_config(&password)
}

/// Create a new world.
#[tauri::command]
async fn create_world(
    name: String,
    tags: Option<Vec<String>>,
    state: tauri::State<'_, AppState>,
) -> Result<WorldMeta, LoomError> {
    if name.len() < 2 {
        return Err(LoomError::Validation(
            "World name must be at least 2 characters.".into(),
        ));
    }
    if name.len() > 80 {
        return Err(LoomError::Validation(
            "World name must be at most 80 characters.".into(),
        ));
    }

    let key_guard = state.master_key.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock master key: {}", e))
    })?;
    let key = key_guard.as_ref().ok_or(LoomError::VaultLocked)?;

    world::create_world(&name, tags, key)
}

/// List all (non-deleted) worlds.
#[tauri::command]
async fn list_worlds() -> Result<Vec<WorldMeta>, LoomError> {
    world::list_worlds()
}

/// Unlock the vault with a password.
#[tauri::command]
async fn unlock_vault(
    password: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), LoomError> {
    let app_config = config::read_app_config()?;

    // Derive key from password
    let salt = hex::decode(&app_config.pbkdf2_salt_hex)?;
    let key = crypto::derive_key(&password, &salt, app_config.pbkdf2_iterations);

    // Verify against sentinel
    if !crypto::verify_sentinel(&key, &app_config.key_check) {
        return Err(LoomError::IncorrectPassword);
    }

    // Store master key
    {
        let mut key_guard = state.master_key.lock().map_err(|e| {
            LoomError::Internal(format!("Failed to lock master key: {}", e))
        })?;
        *key_guard = Some(key);
    }

    // If there's an active world, open its database
    if let Some(ref world_id) = app_config.active_world_id {
        let world_dir = world::world_dir_path(world_id)?;
        let db_path = world_dir.join("loom.db");

        let key_guard = state.master_key.lock().map_err(|e| {
            LoomError::Internal(format!("Failed to lock master key: {}", e))
        })?;
        let master_key = key_guard.as_ref().ok_or(LoomError::VaultLocked)?;

        let conn = db::open_world_db(&db_path, master_key)?;

        // Load API key from settings
        let api_key: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'api_key'",
                [],
                |row| row.get(0),
            )
            .ok();

        {
            let mut conn_guard = state.active_conn.lock().map_err(|e| {
                LoomError::Internal(format!("Failed to lock connection: {}", e))
            })?;
            *conn_guard = Some(conn);
        }

        {
            let mut wid_guard = state.active_world_id.lock().map_err(|e| {
                LoomError::Internal(format!("Failed to lock world id: {}", e))
            })?;
            *wid_guard = Some(world_id.clone());
        }

        if let Some(key_val) = api_key {
            if !key_val.is_empty() {
                let mut api_guard = state.api_key.lock().map_err(|e| {
                    LoomError::Internal(format!("Failed to lock api key: {}", e))
                })?;
                *api_guard = Some(key_val);
            }
        }
    }

    log::info!("Vault unlocked successfully");
    Ok(())
}

/// Lock the vault: close DB, zero keys.
#[tauri::command]
async fn lock_vault(state: tauri::State<'_, AppState>) -> Result<(), LoomError> {
    state.clear_sensitive();
    log::info!("Vault locked");
    Ok(())
}

// ─── App Setup ────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            check_app_config,
            create_app_config,
            create_world,
            list_worlds,
            unlock_vault,
            lock_vault,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LOOM");
}
