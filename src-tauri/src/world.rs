use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::config::{self, WorldEntry};
use crate::db;
use crate::error::LoomError;
use crate::state::AppState;

/// World metadata per Doc 08 §7.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldMeta {
    pub id: String,
    pub name: String,
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_image: Option<String>,
    pub accent_color: String,
    pub created_at: String,
    pub modified_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted_at: Option<String>,
}

/// Create a new world: directory, loom.db (encrypted), world_meta.json, and register in app_config.
pub fn create_world(
    name: &str,
    tags: Option<Vec<String>>,
    master_key: &[u8; 32],
) -> Result<WorldMeta, LoomError> {
    let world_id = uuid::Uuid::new_v4().to_string();
    let data_dir = config::app_data_dir()?;
    let worlds_dir = data_dir.join("worlds");
    let world_dir = worlds_dir.join(&world_id);

    // Create directory structure
    fs::create_dir_all(&world_dir)?;
    fs::create_dir_all(world_dir.join("images"))?;

    // Create and initialize the encrypted database
    let db_path = world_dir.join("loom.db");
    let conn = db::open_world_db(&db_path, master_key)?;
    db::init_schema(&conn)?;
    db::seed_default_settings(&conn)?;
    db::seed_telemetry(&conn)?;
    db::seed_builtin_templates(&conn)?;
    db::close_db(conn);

    // Create world_meta.json
    let now = chrono::Utc::now().to_rfc3339();
    let meta = WorldMeta {
        id: world_id.clone(),
        name: name.to_string(),
        tags: tags.unwrap_or_default(),
        cover_image: None,
        accent_color: "#7c3aed".to_string(),
        created_at: now.clone(),
        modified_at: now,
        deleted_at: None,
    };

    write_world_meta_atomic(&world_dir, &meta)?;

    // Register in app_config.json
    let entry = WorldEntry {
        id: world_id,
        dir: format!("worlds/{}", meta.id),
        deleted_at: None,
    };
    config::add_world_to_config(entry)?;

    log::info!("World created: id={}", meta.id);
    Ok(meta)
}

/// List all worlds by reading their world_meta.json files.
pub fn list_worlds() -> Result<Vec<WorldMeta>, LoomError> {
    let app_config = config::read_app_config()?;
    let data_dir = config::app_data_dir()?;
    let mut worlds = Vec::new();

    for entry in &app_config.worlds {
        if entry.deleted_at.is_some() {
            continue;
        }
        let world_dir = data_dir.join(&entry.dir);
        let meta_path = world_dir.join("world_meta.json");

        if meta_path.exists() {
            match fs::read_to_string(&meta_path) {
                Ok(content) => match serde_json::from_str::<WorldMeta>(&content) {
                    Ok(meta) => worlds.push(meta),
                    Err(e) => {
                        log::warn!("Failed to parse world_meta.json for {}: {}", entry.id, e);
                    }
                },
                Err(e) => {
                    log::warn!("Failed to read world_meta.json for {}: {}", entry.id, e);
                }
            }
        }
    }

    Ok(worlds)
}

/// Get the path to a world's directory.
pub fn world_dir_path(world_id: &str) -> Result<PathBuf, LoomError> {
    let data_dir = config::app_data_dir()?;
    let world_dir = data_dir.join("worlds").join(world_id);
    if !world_dir.exists() {
        return Err(LoomError::WorldNotFound(world_id.to_string()));
    }
    Ok(world_dir)
}

/// Write world_meta.json atomically.
pub fn write_world_meta_atomic(world_dir: &PathBuf, meta: &WorldMeta) -> Result<(), LoomError> {
    let meta_path = world_dir.join("world_meta.json");
    let tmp_path = world_dir.join("world_meta.json.tmp");
    let content = serde_json::to_string_pretty(meta)?;
    fs::write(&tmp_path, &content)?;
    fs::rename(&tmp_path, &meta_path)?;
    Ok(())
}

/// Read world_meta.json for a given world_id.
pub fn read_world_meta(world_id: &str) -> Result<WorldMeta, LoomError> {
    let world_dir = world_dir_path(world_id)?;
    let meta_path = world_dir.join("world_meta.json");
    let content = fs::read_to_string(&meta_path)?;
    let meta: WorldMeta = serde_json::from_str(&content)
        .map_err(|e| LoomError::ConfigCorrupted(format!("world_meta.json: {}", e)))?;
    Ok(meta)
}

/// Switch to a different world: close current DB, open new, update active_world_id.
pub fn switch_world(state: &AppState, world_id: &str) -> Result<WorldMeta, LoomError> {
    let meta = read_world_meta(world_id)?;
    let world_dir = world_dir_path(world_id)?;
    let db_path = world_dir.join("loom.db");

    let master_key = {
        let guard = state.master_key.lock().map_err(|e| {
            LoomError::Internal(format!("Failed to lock master key: {}", e))
        })?;
        guard.ok_or(LoomError::VaultLocked)?
    };

    // Close current connection
    {
        let mut conn_guard = state.active_conn.lock().map_err(|e| {
            LoomError::Internal(format!("Failed to lock connection: {}", e))
        })?;
        *conn_guard = None;
    }

    // Open new DB
    let conn = db::open_world_db(&db_path, &master_key)?;

    // Load API key from new world
    let api_key: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'api_key'",
            [],
            |row| row.get(0),
        )
        .ok();

    // Store connection
    {
        let mut conn_guard = state.active_conn.lock().map_err(|e| {
            LoomError::Internal(format!("Failed to lock connection: {}", e))
        })?;
        *conn_guard = Some(conn);
    }

    // Update active world ID
    {
        let mut wid_guard = state.active_world_id.lock().map_err(|e| {
            LoomError::Internal(format!("Failed to lock world id: {}", e))
        })?;
        *wid_guard = Some(world_id.to_string());
    }

    // Update API key
    if let Some(key_val) = api_key {
        if !key_val.is_empty() {
            let mut api_guard = state.api_key.lock().map_err(|e| {
                LoomError::Internal(format!("Failed to lock api key: {}", e))
            })?;
            *api_guard = Some(key_val);
        }
    }

    // Persist to config
    config::set_active_world_id(Some(world_id.to_string()))?;

    log::info!("Switched to world: id={}", world_id);
    Ok(meta)
}

/// Rename a world.
pub fn rename_world(world_id: &str, name: &str) -> Result<(), LoomError> {
    let world_dir = world_dir_path(world_id)?;
    let mut meta = read_world_meta(world_id)?;
    meta.name = name.to_string();
    meta.modified_at = chrono::Utc::now().to_rfc3339();
    write_world_meta_atomic(&world_dir, &meta)?;
    log::info!("World renamed: id={}", world_id);
    Ok(())
}

/// Soft-delete a world (set deleted_at in config and world_meta).
pub fn delete_world(world_id: &str) -> Result<(), LoomError> {
    let now = chrono::Utc::now().to_rfc3339();
    config::set_world_deleted(world_id, Some(now.clone()))?;

    // Also update world_meta.json
    let world_dir = world_dir_path(world_id)?;
    let mut meta = read_world_meta(world_id)?;
    meta.deleted_at = Some(now);
    write_world_meta_atomic(&world_dir, &meta)?;

    log::info!("World soft-deleted: id={}", world_id);
    Ok(())
}

/// Restore a soft-deleted world.
pub fn restore_world(world_id: &str) -> Result<(), LoomError> {
    config::set_world_deleted(world_id, None)?;

    let world_dir = world_dir_path(world_id)?;
    let mut meta = read_world_meta(world_id)?;
    meta.deleted_at = None;
    write_world_meta_atomic(&world_dir, &meta)?;

    log::info!("World restored: id={}", world_id);
    Ok(())
}

/// Permanently delete a world (remove directory + remove from config).
pub fn purge_world(world_id: &str) -> Result<(), LoomError> {
    let world_dir = world_dir_path(world_id)?;
    fs::remove_dir_all(&world_dir)?;
    config::remove_world_from_config(world_id)?;
    log::info!("World purged: id={}", world_id);
    Ok(())
}

/// List all soft-deleted worlds.
pub fn list_deleted_worlds() -> Result<Vec<WorldMeta>, LoomError> {
    let app_config = config::read_app_config()?;
    let data_dir = config::app_data_dir()?;
    let mut worlds = Vec::new();

    for entry in &app_config.worlds {
        if entry.deleted_at.is_none() {
            continue;
        }
        let world_dir = data_dir.join(&entry.dir);
        let meta_path = world_dir.join("world_meta.json");

        if meta_path.exists() {
            if let Ok(content) = fs::read_to_string(&meta_path) {
                if let Ok(meta) = serde_json::from_str::<WorldMeta>(&content) {
                    worlds.push(meta);
                }
            }
        }
    }

    Ok(worlds)
}
