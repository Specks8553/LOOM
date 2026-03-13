use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::config::{self, WorldEntry};
use crate::db;
use crate::error::LoomError;

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
fn write_world_meta_atomic(world_dir: &PathBuf, meta: &WorldMeta) -> Result<(), LoomError> {
    let meta_path = world_dir.join("world_meta.json");
    let tmp_path = world_dir.join("world_meta.json.tmp");
    let content = serde_json::to_string_pretty(meta)?;
    fs::write(&tmp_path, &content)?;
    fs::rename(&tmp_path, &meta_path)?;
    Ok(())
}
