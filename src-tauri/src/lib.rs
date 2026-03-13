mod config;
mod crypto;
mod db;
mod error;
mod state;
mod vault;
mod world;

use error::LoomError;
use state::AppState;
use vault::VaultItemMeta;
use world::WorldMeta;

// ─── Tauri Commands ───────────────────────────────────────────────────────────

/// Check if app_config.json exists and is valid.
#[tauri::command]
async fn check_app_config() -> Result<bool, LoomError> {
    config::check_app_config()
}

/// Create a new app_config.json from a master password.
/// Stores the derived master key in AppState so create_world can use it.
#[tauri::command]
async fn create_app_config(
    password: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), LoomError> {
    if password.len() < 8 {
        return Err(LoomError::Validation(
            "Password must be at least 8 characters.".into(),
        ));
    }
    let key = config::create_app_config(&password)?;

    // Store master key in AppState for subsequent commands (create_world, etc.)
    let mut key_guard = state.master_key.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock master key: {}", e))
    })?;
    *key_guard = Some(key);

    Ok(())
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

/// Validate a Gemini API key and store it in AppState (memory only).
#[tauri::command]
async fn validate_and_store_api_key(
    key: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), LoomError> {
    if key.trim().is_empty() {
        return Err(LoomError::Validation("API key cannot be empty.".into()));
    }

    // Test the key against Gemini API
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models?key={}",
        key.trim()
    );
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| LoomError::ApiRequest(e.to_string()))?;

    if !resp.status().is_success() {
        return Err(LoomError::ApiRequest(
            "Key rejected by Gemini. Check and try again.".into(),
        ));
    }

    // Store in memory
    let mut api_guard = state.api_key.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock api key: {}", e))
    })?;
    *api_guard = Some(key.trim().to_string());

    log::info!("API key validated and stored in memory");
    Ok(())
}

/// Save the API key from AppState to the active world's settings table.
#[tauri::command]
async fn save_api_key_to_db(
    state: tauri::State<'_, AppState>,
) -> Result<(), LoomError> {
    let api_key = {
        let guard = state.api_key.lock().map_err(|e| {
            LoomError::Internal(format!("Failed to lock api key: {}", e))
        })?;
        guard.clone().ok_or(LoomError::ApiKeyMissing)?
    };

    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;

    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('api_key', ?1)",
        rusqlite::params![api_key],
    )?;

    log::info!("API key persisted to world database");
    Ok(())
}

/// Generate a recovery file JSON string.
#[tauri::command]
async fn generate_recovery_file() -> Result<String, LoomError> {
    let app_config = config::read_app_config()?;
    let recovery = serde_json::json!({
        "loom_recovery_version": 1,
        "created_at": chrono::Utc::now().to_rfc3339(),
        "pbkdf2_salt_hex": app_config.pbkdf2_salt_hex,
        "pbkdf2_iterations": app_config.pbkdf2_iterations,
        "pbkdf2_algorithm": "HMAC-SHA256",
        "warning": "This file does NOT contain your password or encryption key."
    });
    Ok(serde_json::to_string_pretty(&recovery)?)
}

/// Restore app_config.json from a recovery file.
/// User must provide a new password to re-derive the key.
#[tauri::command]
async fn restore_app_config(
    recovery_json: String,
    password: String,
) -> Result<(), LoomError> {
    if password.len() < 8 {
        return Err(LoomError::Validation(
            "Password must be at least 8 characters.".into(),
        ));
    }

    let recovery: serde_json::Value = serde_json::from_str(&recovery_json)
        .map_err(|e| LoomError::ConfigCorrupted(format!("Invalid recovery file: {}", e)))?;

    let salt_hex = recovery["pbkdf2_salt_hex"]
        .as_str()
        .ok_or_else(|| LoomError::ConfigCorrupted("Missing pbkdf2_salt_hex".into()))?;
    let iterations = recovery["pbkdf2_iterations"]
        .as_u64()
        .ok_or_else(|| LoomError::ConfigCorrupted("Missing pbkdf2_iterations".into()))?
        as u32;

    let salt = hex::decode(salt_hex)?;
    let key = crypto::derive_key(&password, &salt, iterations);
    let sentinel = crypto::create_sentinel(&key)?;

    // Scan for existing world directories
    let data_dir = config::app_data_dir()?;
    let worlds_dir = data_dir.join("worlds");
    let mut world_entries = Vec::new();

    if worlds_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&worlds_dir) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    let world_id = entry.file_name().to_string_lossy().to_string();
                    let meta_path = entry.path().join("world_meta.json");
                    if meta_path.exists() {
                        world_entries.push(config::WorldEntry {
                            id: world_id.clone(),
                            dir: format!("worlds/{}", world_id),
                            deleted_at: None,
                        });
                    }
                }
            }
        }
    }

    let active_id = world_entries.first().map(|e| e.id.clone());

    let new_config = config::AppConfig {
        version: 1,
        pbkdf2_salt_hex: salt_hex.to_string(),
        pbkdf2_iterations: iterations,
        key_check: sentinel,
        active_world_id: active_id,
        worlds: world_entries,
    };

    config::write_app_config_atomic(&new_config)?;
    log::info!("App config restored from recovery file");
    Ok(())
}

// ─── World Management Commands ────────────────────────────────────────────────

/// Switch to a different world.
#[tauri::command]
async fn switch_world(
    world_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<WorldMeta, LoomError> {
    world::switch_world(&state, &world_id)
}

/// Rename a world.
#[tauri::command]
async fn rename_world(world_id: String, name: String) -> Result<(), LoomError> {
    if name.len() < 2 {
        return Err(LoomError::Validation("World name must be at least 2 characters.".into()));
    }
    if name.len() > 80 {
        return Err(LoomError::Validation("World name must be at most 80 characters.".into()));
    }
    world::rename_world(&world_id, &name)
}

/// Soft-delete a world.
#[tauri::command]
async fn delete_world(world_id: String) -> Result<(), LoomError> {
    world::delete_world(&world_id)
}

/// Restore a soft-deleted world.
#[tauri::command]
async fn restore_world(world_id: String) -> Result<(), LoomError> {
    world::restore_world(&world_id)
}

/// Permanently delete a world.
#[tauri::command]
async fn purge_world(world_id: String) -> Result<(), LoomError> {
    world::purge_world(&world_id)
}

/// List all soft-deleted worlds.
#[tauri::command]
async fn list_deleted_worlds() -> Result<Vec<WorldMeta>, LoomError> {
    world::list_deleted_worlds()
}

// ─── Vault Item Commands ──────────────────────────────────────────────────────

/// List all non-deleted vault items in the active world.
#[tauri::command]
async fn vault_list_items(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<VaultItemMeta>, LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    vault::list_items(conn)
}

/// List all soft-deleted vault items (trash).
#[tauri::command]
async fn vault_list_trash(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<VaultItemMeta>, LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    vault::list_trash(conn)
}

/// Create a new vault item.
#[tauri::command]
async fn vault_create_item(
    item_type: String,
    name: String,
    parent_id: Option<String>,
    subtype: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<VaultItemMeta, LoomError> {
    if name.trim().is_empty() {
        return Err(LoomError::Validation("Item name cannot be empty.".into()));
    }
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    vault::create_item(conn, &item_type, name.trim(), parent_id.as_deref(), subtype.as_deref())
}

/// Rename a vault item.
#[tauri::command]
async fn vault_rename_item(
    id: String,
    name: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), LoomError> {
    if name.trim().is_empty() {
        return Err(LoomError::Validation("Item name cannot be empty.".into()));
    }
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    vault::rename_item(conn, &id, name.trim())
}

/// Move a vault item to a new parent with a new sort order.
#[tauri::command]
async fn vault_move_item(
    id: String,
    new_parent_id: Option<String>,
    new_sort_order: i64,
    state: tauri::State<'_, AppState>,
) -> Result<(), LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    vault::move_item(conn, &id, new_parent_id.as_deref(), new_sort_order)
}

/// Soft-delete a vault item.
#[tauri::command]
async fn vault_soft_delete(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    vault::soft_delete(conn, &id)
}

/// Restore a soft-deleted vault item.
#[tauri::command]
async fn vault_restore_item(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    vault::restore_item(conn, &id)
}

/// Permanently delete a vault item.
#[tauri::command]
async fn vault_purge_item(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    vault::purge_item(conn, &id)
}

/// Batch update sort order for vault items.
#[tauri::command]
async fn vault_update_sort_order(
    items: Vec<(String, i64)>,
    state: tauri::State<'_, AppState>,
) -> Result<(), LoomError> {
    let conn_guard = state.active_conn.lock().map_err(|e| {
        LoomError::Internal(format!("Failed to lock connection: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
    vault::update_sort_order(conn, &items)
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
            validate_and_store_api_key,
            save_api_key_to_db,
            generate_recovery_file,
            restore_app_config,
            // Phase 4A: World management
            switch_world,
            rename_world,
            delete_world,
            restore_world,
            purge_world,
            list_deleted_worlds,
            // Phase 4A: Vault item CRUD
            vault_list_items,
            vault_list_trash,
            vault_create_item,
            vault_rename_item,
            vault_move_item,
            vault_soft_delete,
            vault_restore_item,
            vault_purge_item,
            vault_update_sort_order,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LOOM");
}
