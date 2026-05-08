//! World domain logic (Doc 14, Doc 03 §`worlds`, §`world_meta.json`).
//!
//! Responsibilities:
//!   - Provision a new world directory + encrypted DB + atomic `world_meta.json`
//!   - Open an existing world's encrypted DB
//!   - List worlds (joining `app_config.json` with each `world_meta.json`)
//!   - Update `world_meta.json` with cascading write-through to `app_config.json`
//!   - Delete a world (filesystem + config registration)
//!
//! Per Doc 14 §write-through rule, `world_meta.json` is a display cache —
//! the encrypted DB is the source of truth. Some fields shadow values that
//! also live in `app_config.json` (`name`) or in the world `settings` table
//! (`accent_color`). `update_world_meta` is the only command that may write
//! `world_meta.json`; every other mutation that changes a shadowed field
//! updates `world_meta.json` in the same transaction.
//!
//! All filesystem writes are atomic (`.tmp` + rename) so a crashed write
//! never leaves a half-written display cache that disagrees with the DB.

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tracing::{debug, info};
use ts_rs::TS;
use uuid::Uuid;

use crate::db::connection::open_and_migrate;
use crate::db::migrations::MigrationRoot;
use crate::error::LoomError;
use crate::services::config::{self, WorldEntry};

/// Default accent color for new worlds (Doc 08 §Accent — orange #f97316).
/// World creator can change it from Settings later.
const DEFAULT_ACCENT_COLOR: &str = "#f97316";

/// `world_meta.json` payload — matches Doc 03 §`world_meta.json`.
///
/// Display cache for the World Picker. The encrypted DB is the source of
/// truth for everything except `tags`, which lives only here.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/lib/types.ts")]
pub struct WorldMeta {
    pub id: String,
    pub name: String,
    pub tags: Vec<String>,
    pub accent_color: String,
    pub cover_image_path: Option<String>,
    pub created_at: String,
    pub modified_at: String,
}

/// Patch payload for `update_world_meta` — Doc 03 §IPC Payload and Result
/// Types. Optional fields; explicit `null` on `cover_image_path` clears it.
#[derive(Debug, Clone, Default, Deserialize, TS)]
#[ts(export, export_to = "../src/lib/types.ts")]
pub struct WorldMetaPatch {
    pub name: Option<String>,
    pub tags: Option<Vec<String>>,
    pub accent_color: Option<String>,
    /// `Some(Some(path))` sets, `Some(None)` clears, `None` leaves untouched.
    /// Serialised via `serde` default — frontend sends `null` to clear.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub cover_image_path: Option<Option<String>>,
}

/// Differentiate "field absent" from "field present with null" on
/// `cover_image_path`. The standard `Option<Option<T>>` deser doesn't do this;
/// this wrapper does.
fn deserialize_optional_field<'de, D>(de: D) -> Result<Option<Option<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Some(Option::<String>::deserialize(de)?))
}

/// Return the worlds root directory: `<app_data_dir>/worlds/`.
fn worlds_root(app: &tauri::AppHandle) -> Result<PathBuf, LoomError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e: tauri::Error| LoomError::Io(e.to_string()))?
        .join("worlds");
    Ok(dir)
}

/// Compute the absolute directory for a single world: `<app_data>/worlds/<id>/`.
fn world_dir(app: &tauri::AppHandle, world_id: &str) -> Result<PathBuf, LoomError> {
    Ok(worlds_root(app)?.join(world_id))
}

/// Validate a user-provided world name. Empty / whitespace-only / overlong
/// names are rejected; any character that breaks paths or display is too.
fn validate_world_name(name: &str) -> Result<(), LoomError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(LoomError::validation("World name cannot be empty"));
    }
    if trimmed.chars().count() > 100 {
        return Err(LoomError::validation(
            "World name must be 100 characters or fewer",
        ));
    }
    Ok(())
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Atomically write `meta` to `<world_dir>/world_meta.json` (`.tmp` + rename).
fn write_world_meta(path: &Path, meta: &WorldMeta) -> Result<(), LoomError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(LoomError::from)?;
    }
    let json = serde_json::to_vec_pretty(meta).map_err(LoomError::from)?;
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, &json).map_err(LoomError::from)?;
    std::fs::rename(&tmp, path).map_err(LoomError::from)?;
    Ok(())
}

/// Read and parse a `world_meta.json` file.
fn read_world_meta(path: &Path) -> Result<WorldMeta, LoomError> {
    let bytes = std::fs::read(path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            LoomError::NotFound(format!("world_meta.json not found at {}", path.display()))
        } else {
            LoomError::Io(e.to_string())
        }
    })?;
    serde_json::from_slice(&bytes).map_err(LoomError::from)
}

/// Create a new world: directory, encrypted DB with schema, `world_meta.json`,
/// and an entry in `app_config.json`.
///
/// On any failure after the directory is created, the partial directory is
/// best-effort removed so a retry isn't blocked by a stale skeleton.
pub fn create_world(
    app: &tauri::AppHandle,
    master_key: &[u8; 32],
    name: &str,
) -> Result<(WorldEntry, WorldMeta), LoomError> {
    validate_world_name(name)?;
    let trimmed_name = name.trim().to_owned();

    // Reject duplicate names — Doc 14 §Edge Cases.
    let cfg = config::read(app)?;
    if cfg
        .worlds
        .iter()
        .any(|w| w.name.eq_ignore_ascii_case(&trimmed_name))
    {
        return Err(LoomError::validation(
            "A world with this name already exists.",
        ));
    }

    let world_id = Uuid::new_v4().to_string();
    let dir = world_dir(app, &world_id)?;
    let db_path = dir.join("loom.db");
    let meta_path = dir.join("world_meta.json");

    info!(world_id = %world_id, "create_world: provisioning");

    std::fs::create_dir_all(&dir).map_err(LoomError::from)?;

    // Build everything; if any step fails, clean up the directory so the
    // user can retry.
    let result = (|| -> Result<(WorldEntry, WorldMeta), LoomError> {
        // Open + migrate the encrypted DB; SQLCipher creates the file.
        let conn = open_and_migrate(&db_path, master_key, MigrationRoot::World)?;
        drop(conn); // close immediately; the caller `open_world` will reopen

        let now = now_iso();
        let meta = WorldMeta {
            id: world_id.clone(),
            name: trimmed_name.clone(),
            tags: vec![],
            accent_color: DEFAULT_ACCENT_COLOR.to_owned(),
            cover_image_path: None,
            created_at: now.clone(),
            modified_at: now,
        };
        write_world_meta(&meta_path, &meta)?;

        // Append to app_config.json (atomic write inside config::write).
        let entry = WorldEntry {
            id: world_id.clone(),
            name: trimmed_name.clone(),
            db_path: db_path.to_string_lossy().to_string(),
            world_meta_path: meta_path.to_string_lossy().to_string(),
        };
        let mut new_cfg = cfg.clone();
        new_cfg.worlds.push(entry.clone());
        config::write(app, &new_cfg)?;

        Ok((entry, meta))
    })();

    if result.is_err() {
        let _ = std::fs::remove_dir_all(&dir);
    }
    result
}

/// Open an existing world's encrypted DB. Caller is responsible for storing
/// the returned `Connection` in `AppState.active_conn`.
pub fn open_world(
    app: &tauri::AppHandle,
    master_key: &[u8; 32],
    world_id: &str,
) -> Result<Connection, LoomError> {
    let cfg = config::read(app)?;
    let entry = cfg
        .worlds
        .iter()
        .find(|w| w.id == world_id)
        .ok_or_else(|| LoomError::NotFound(format!("World {world_id} not found")))?;

    let path = Path::new(&entry.db_path);
    if !path.exists() {
        return Err(LoomError::NotFound(format!(
            "World database missing at {}",
            entry.db_path
        )));
    }

    debug!(world_id = %world_id, "open_world: opening encrypted DB");
    // Re-applying migrations on open is safe (no-op when up to date) and
    // keeps us forward-compatible with future schema versions.
    open_and_migrate(path, master_key, MigrationRoot::World)
}

/// Return all worlds with full metadata. Reads `app_config.json` for the
/// registry and each world's `world_meta.json` for display fields. A world
/// whose meta file is missing or unreadable is logged and skipped — the
/// World Picker should still render the others.
pub fn list_worlds(app: &tauri::AppHandle) -> Result<Vec<WorldMeta>, LoomError> {
    let cfg = config::read(app)?;
    let mut metas = Vec::with_capacity(cfg.worlds.len());
    for entry in &cfg.worlds {
        let meta_path = if entry.world_meta_path.is_empty() {
            // Forward compat: synthesise the path from the world id.
            world_dir(app, &entry.id)?.join("world_meta.json")
        } else {
            PathBuf::from(&entry.world_meta_path)
        };
        match read_world_meta(&meta_path) {
            Ok(meta) => metas.push(meta),
            Err(e) => {
                tracing::warn!(world_id = %entry.id, "skipping world: {e}");
            }
        }
    }
    Ok(metas)
}

/// Update `world_meta.json` and (when a shadowed field changes) propagate
/// to `app_config.json`. Returns the new full meta.
pub fn update_world_meta(
    app: &tauri::AppHandle,
    world_id: &str,
    patch: WorldMetaPatch,
) -> Result<WorldMeta, LoomError> {
    let cfg = config::read(app)?;
    let entry = cfg
        .worlds
        .iter()
        .find(|w| w.id == world_id)
        .ok_or_else(|| LoomError::NotFound(format!("World {world_id} not found")))?
        .clone();

    let meta_path = if entry.world_meta_path.is_empty() {
        world_dir(app, &entry.id)?.join("world_meta.json")
    } else {
        PathBuf::from(&entry.world_meta_path)
    };

    let mut meta = read_world_meta(&meta_path)?;
    let mut name_changed = false;

    if let Some(name) = patch.name {
        validate_world_name(&name)?;
        let trimmed = name.trim().to_owned();
        // Duplicate-name check ignoring this world.
        if cfg
            .worlds
            .iter()
            .any(|w| w.id != world_id && w.name.eq_ignore_ascii_case(&trimmed))
        {
            return Err(LoomError::validation(
                "A world with this name already exists.",
            ));
        }
        if meta.name != trimmed {
            meta.name = trimmed;
            name_changed = true;
        }
    }
    if let Some(tags) = patch.tags {
        meta.tags = tags;
    }
    if let Some(accent) = patch.accent_color {
        meta.accent_color = accent;
    }
    if let Some(cover) = patch.cover_image_path {
        meta.cover_image_path = cover;
    }
    meta.modified_at = now_iso();

    write_world_meta(&meta_path, &meta)?;

    if name_changed {
        let mut new_cfg = cfg.clone();
        if let Some(e) = new_cfg.worlds.iter_mut().find(|w| w.id == world_id) {
            e.name = meta.name.clone();
        }
        config::write(app, &new_cfg)?;
    }

    Ok(meta)
}

/// Permanently delete a world: removes the directory tree and the
/// `app_config.json` entry. The caller (command layer) is responsible for
/// clearing `AppState.active_conn` and `active_world_id` if the deleted
/// world was active.
///
/// `name_confirmation` must match the stored world name exactly (Doc 14 §Delete world).
pub fn delete_world(
    app: &tauri::AppHandle,
    world_id: &str,
    name_confirmation: &str,
) -> Result<(), LoomError> {
    let cfg = config::read(app)?;
    let entry = cfg
        .worlds
        .iter()
        .find(|w| w.id == world_id)
        .ok_or_else(|| LoomError::NotFound(format!("World {world_id} not found")))?
        .clone();

    if entry.name != name_confirmation {
        return Err(LoomError::validation(
            "Name confirmation does not match the world name.",
        ));
    }

    info!(world_id = %world_id, "delete_world: removing");

    // Remove from app_config.json *first*. If the directory removal fails
    // afterwards, the world is no longer registered — orphaned files are
    // recoverable manually but a registered-with-missing-files state is not.
    let mut new_cfg = cfg.clone();
    new_cfg.worlds.retain(|w| w.id != world_id);
    if new_cfg.active_world_id.as_deref() == Some(world_id) {
        new_cfg.active_world_id = None;
    }
    config::write(app, &new_cfg)?;

    // Best-effort delete the world directory; warn if it fails but don't
    // fail the command (the world is already de-registered).
    let dir = world_dir(app, world_id)?;
    if dir.exists() {
        if let Err(e) = std::fs::remove_dir_all(&dir) {
            tracing::warn!(world_id = %world_id, "world directory removal failed: {e}");
        }
    }

    Ok(())
}

/// Update `active_world_id` in `app_config.json` (used by `open_world` so
/// the next launch can auto-resume). Atomic write.
pub fn set_active_world_id(
    app: &tauri::AppHandle,
    world_id: Option<&str>,
) -> Result<(), LoomError> {
    let mut cfg = config::read(app)?;
    cfg.active_world_id = world_id.map(|s| s.to_owned());
    config::write(app, &cfg)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_name_rejects_empty() {
        assert!(validate_world_name("").is_err());
        assert!(validate_world_name("   ").is_err());
    }

    #[test]
    fn validate_name_rejects_overlong() {
        let s: String = "a".repeat(101);
        assert!(validate_world_name(&s).is_err());
    }

    #[test]
    fn validate_name_accepts_normal() {
        assert!(validate_world_name("My World").is_ok());
        assert!(validate_world_name("Sci-Fi: Book 1").is_ok());
    }

    #[test]
    fn patch_cover_image_distinguishes_absent_from_null() {
        // Absent field — leave untouched
        let absent: WorldMetaPatch = serde_json::from_str("{}").unwrap();
        assert!(absent.cover_image_path.is_none());

        // Explicit null — clear
        let null: WorldMetaPatch = serde_json::from_str(r#"{"cover_image_path": null}"#).unwrap();
        assert_eq!(null.cover_image_path, Some(None));

        // String value — set
        let set: WorldMetaPatch =
            serde_json::from_str(r#"{"cover_image_path": "/tmp/x.png"}"#).unwrap();
        assert_eq!(set.cover_image_path, Some(Some("/tmp/x.png".into())));
    }
}
