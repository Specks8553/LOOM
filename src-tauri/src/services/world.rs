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

/// Default accent color for new worlds (Doc 08 §Accent — Sage #6b9f78).
/// World creator can change it from Settings later.
const DEFAULT_ACCENT_COLOR: &str = "#6b9f78";

/// `world_meta.json` payload — matches Doc 03 §`world_meta.json`.
///
/// Display cache for the World Picker. The encrypted DB is the source of
/// truth for everything except `tags`, which lives only here.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/lib/types.generated.ts")]
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
#[ts(export, export_to = "../../src/lib/types.generated.ts")]
pub struct WorldMetaPatch {
    pub name: Option<String>,
    pub tags: Option<Vec<String>>,
    pub accent_color: Option<String>,
    /// `Some(Some(path))` sets, `Some(None)` clears, `None` leaves untouched.
    /// Serialised via `serde` default — frontend sends `null` to clear.
    /// `#[ts(type)]` collapses the `Option<Option<_>>` double-null ts-rs would
    /// otherwise emit (`string | null | null`) to the single `string | null`.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    #[ts(type = "string | null")]
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
        // Seed the built-in source-document templates (Doc 20 §Templates).
        crate::db::templates::ensure_builtins(&conn, &now_iso())?;
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
    let conn = open_and_migrate(path, master_key, MigrationRoot::World)?;
    // Idempotent — worlds created before the templates feature gain the
    // built-ins lazily on first open (Doc 20 §Templates).
    crate::db::templates::ensure_builtins(&conn, &now_iso())?;
    Ok(conn)
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

/// Export a world to a `.loom-backup` zip (Doc 14 §World Backup).
///
/// Steps:
/// 1. SQLite Online Backup `loom.db` → temporary file (so an in-use connection
///    can't block).
/// 2. Stream the encrypted DB file into the zip as `loom.db`.
/// 3. (Phase 10) Copy `assets/` into the zip — placeholder for now since
///    Phase 2 has no images. The directory is included only if it exists.
/// 4. Clean up the temp file.
///
/// `dest_path` is the absolute path the user picked in the save dialog.
/// Caller (command layer) is responsible for emitting any UX toasts.
pub fn export_world(
    app: &tauri::AppHandle,
    master_key: &[u8; 32],
    world_id: &str,
    dest_path: &Path,
) -> Result<(), LoomError> {
    let cfg = config::read(app)?;
    let entry = cfg
        .worlds
        .iter()
        .find(|w| w.id == world_id)
        .ok_or_else(|| LoomError::NotFound(format!("World {world_id} not found")))?
        .clone();

    let db_path = Path::new(&entry.db_path);
    if !db_path.exists() {
        return Err(LoomError::NotFound(format!(
            "World database missing at {}",
            entry.db_path
        )));
    }

    info!(world_id = %world_id, "export_world: snapshotting DB");

    // 1. Online Backup the DB into a temp file so the live connection (if any)
    //    isn't blocked. The temp file gets the same SQLCipher key — it is a
    //    bit-for-bit equivalent of `loom.db` post-backup.
    let temp_dir = std::env::temp_dir();
    std::fs::create_dir_all(&temp_dir).map_err(LoomError::from)?;
    let snapshot_path = temp_dir.join(format!("loom-backup-{world_id}.db"));
    let _ = std::fs::remove_file(&snapshot_path); // clear stale snapshot

    let snapshot_result = (|| -> Result<(), LoomError> {
        let src = crate::db::connection::open_encrypted(db_path, master_key)?;
        let mut dst = crate::db::connection::open_encrypted(&snapshot_path, master_key)?;
        let backup = rusqlite::backup::Backup::new(&src, &mut dst)
            .map_err(|e| LoomError::Database(format!("backup init failed: {e}")))?;
        backup
            .run_to_completion(100, std::time::Duration::from_millis(0), None)
            .map_err(|e| LoomError::Database(format!("backup run failed: {e}")))?;
        Ok(())
    })();
    if let Err(e) = snapshot_result {
        let _ = std::fs::remove_file(&snapshot_path);
        return Err(e);
    }

    // 2. Build the zip alongside `dest_path` then atomic-rename so a
    //    crashed export never produces a half-written `.loom-backup`.
    let staging_path = dest_path.with_extension("loom-backup.tmp");
    let zip_result = build_zip(&staging_path, &snapshot_path, &world_dir(app, world_id)?);

    // 3. Cleanup snapshot regardless of zip success.
    let _ = std::fs::remove_file(&snapshot_path);

    zip_result?;
    std::fs::rename(&staging_path, dest_path).map_err(|e| {
        let _ = std::fs::remove_file(&staging_path);
        LoomError::Io(format!("rename to dest failed: {e}"))
    })?;

    info!(world_id = %world_id, "export_world: complete");
    Ok(())
}

/// Import a world from a `.loom-backup` zip (Doc 14 §World Backup §Import).
///
/// Steps:
/// 1. Validate the archive contains `loom.db`. (`assets/` is optional.)
/// 2. Generate a fresh `world_id` UUID — re-using the source's id would
///    collide if the writer still has the original world.
/// 3. Extract `loom.db` and any `assets/<file>` into `<app_data>/worlds/<new_id>/`.
/// 4. Open the extracted DB with the current vault master key to confirm
///    the backup belongs to this vault (v2.0: one master password per vault).
///    If it fails, clean up and surface a clear error.
/// 5. Build `world_meta.json` with sensible defaults and a name derived from
///    the source filename, deduping against existing world names.
/// 6. Register in `app_config.json`. The new world is **not** auto-opened.
pub fn import_world(
    app: &tauri::AppHandle,
    master_key: &[u8; 32],
    src_path: &Path,
) -> Result<WorldMeta, LoomError> {
    if !src_path.exists() {
        return Err(LoomError::NotFound(format!(
            "Backup file not found at {}",
            src_path.display()
        )));
    }

    let new_world_id = Uuid::new_v4().to_string();
    let dir = world_dir(app, &new_world_id)?;
    let db_path = dir.join("loom.db");
    let meta_path = dir.join("world_meta.json");

    info!(world_id = %new_world_id, src = %src_path.display(), "import_world: extracting");

    std::fs::create_dir_all(&dir).map_err(LoomError::from)?;

    let result = (|| -> Result<WorldMeta, LoomError> {
        extract_zip(src_path, &dir)?;

        // Step 4: validate the extracted DB opens with the current master key.
        if !db_path.exists() {
            return Err(LoomError::validation(
                "This file isn't a valid LOOM backup.",
            ));
        }
        let conn = open_and_migrate(&db_path, master_key, MigrationRoot::World).map_err(|_| {
            LoomError::validation("Couldn't decrypt the backup. It may be from a different vault.")
        })?;
        drop(conn);

        // Step 5: derive a non-colliding display name from the source filename.
        let cfg = config::read(app)?;
        let base_name = src_path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("Imported world")
            .to_owned();
        let name = dedupe_world_name(&base_name, &cfg.worlds);

        let now = now_iso();
        let meta = WorldMeta {
            id: new_world_id.clone(),
            name: name.clone(),
            tags: vec![],
            accent_color: DEFAULT_ACCENT_COLOR.to_owned(),
            cover_image_path: None,
            created_at: now.clone(),
            modified_at: now,
        };
        write_world_meta(&meta_path, &meta)?;

        let entry = WorldEntry {
            id: new_world_id.clone(),
            name: name.clone(),
            db_path: db_path.to_string_lossy().to_string(),
            world_meta_path: meta_path.to_string_lossy().to_string(),
        };
        let mut new_cfg = cfg.clone();
        new_cfg.worlds.push(entry);
        config::write(app, &new_cfg)?;

        Ok(meta)
    })();

    if result.is_err() {
        let _ = std::fs::remove_dir_all(&dir);
    }
    result
}

/// Pick a world name that doesn't collide (case-insensitive) with the
/// existing registry. Appends " (copy)", " (copy 2)", … as needed.
fn dedupe_world_name(base: &str, existing: &[WorldEntry]) -> String {
    let taken = |candidate: &str| -> bool {
        existing
            .iter()
            .any(|w| w.name.eq_ignore_ascii_case(candidate))
    };
    if !taken(base) {
        return base.to_owned();
    }
    let first = format!("{base} (copy)");
    if !taken(&first) {
        return first;
    }
    for n in 2..1000 {
        let candidate = format!("{base} (copy {n})");
        if !taken(&candidate) {
            return candidate;
        }
    }
    format!("{base} ({})", Uuid::new_v4())
}

/// Extract a `.loom-backup` zip into `dest_dir`. Only `loom.db` and entries
/// under `assets/` are accepted; anything else is ignored. Path traversal
/// (`..`, absolute paths) is rejected.
fn extract_zip(src: &Path, dest_dir: &Path) -> Result<(), LoomError> {
    use std::io::{Read, Write};

    let file = std::fs::File::open(src).map_err(LoomError::from)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| LoomError::validation(format!("Not a valid zip archive: {e}")))?;

    let mut found_db = false;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| LoomError::Io(format!("zip entry {i}: {e}")))?;
        let raw_name = entry.name().to_owned();

        // Reject anything that escapes the destination.
        if raw_name.contains("..")
            || raw_name.starts_with('/')
            || raw_name.starts_with('\\')
            || raw_name.contains(':')
        {
            return Err(LoomError::validation(
                "This file isn't a valid LOOM backup.",
            ));
        }

        if entry.is_dir() {
            continue;
        }

        let out_path = if raw_name == "loom.db" {
            found_db = true;
            dest_dir.join("loom.db")
        } else if let Some(rest) = raw_name.strip_prefix("assets/") {
            if rest.is_empty() || rest.contains('/') || rest.contains('\\') {
                continue; // skip nested or empty asset paths
            }
            dest_dir.join("assets").join(rest)
        } else {
            continue; // ignore unknown entries
        };

        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).map_err(LoomError::from)?;
        }
        let mut out = std::fs::File::create(&out_path).map_err(LoomError::from)?;
        let mut buf = [0u8; 64 * 1024];
        loop {
            let n = entry.read(&mut buf).map_err(LoomError::from)?;
            if n == 0 {
                break;
            }
            out.write_all(&buf[..n]).map_err(LoomError::from)?;
        }
    }

    if !found_db {
        return Err(LoomError::validation(
            "This file isn't a valid LOOM backup.",
        ));
    }
    Ok(())
}

/// Build the `.loom-backup` zip: `loom.db` + (when present) `assets/` tree.
fn build_zip(out: &Path, db_snapshot: &Path, world_dir: &Path) -> Result<(), LoomError> {
    use std::io::{Read, Write};
    use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

    let file = std::fs::File::create(out).map_err(LoomError::from)?;
    let mut writer = ZipWriter::new(file);
    let opts = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);

    // loom.db
    writer
        .start_file("loom.db", opts)
        .map_err(|e| LoomError::Io(format!("zip start_file: {e}")))?;
    let mut db = std::fs::File::open(db_snapshot).map_err(LoomError::from)?;
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = db.read(&mut buf).map_err(LoomError::from)?;
        if n == 0 {
            break;
        }
        writer
            .write_all(&buf[..n])
            .map_err(|e| LoomError::Io(format!("zip write: {e}")))?;
    }

    // assets/ — Phase 10 will populate. Include it only if non-empty.
    let assets_dir = world_dir.join("assets");
    if assets_dir.is_dir() {
        for entry in std::fs::read_dir(&assets_dir).map_err(LoomError::from)? {
            let entry = entry.map_err(LoomError::from)?;
            if !entry.file_type().map_err(LoomError::from)?.is_file() {
                continue;
            }
            let name = format!("assets/{}", entry.file_name().to_string_lossy());
            writer
                .start_file(&name, opts)
                .map_err(|e| LoomError::Io(format!("zip start_file: {e}")))?;
            let mut f = std::fs::File::open(entry.path()).map_err(LoomError::from)?;
            loop {
                let n = f.read(&mut buf).map_err(LoomError::from)?;
                if n == 0 {
                    break;
                }
                writer
                    .write_all(&buf[..n])
                    .map_err(|e| LoomError::Io(format!("zip write: {e}")))?;
            }
        }
    }

    writer
        .finish()
        .map_err(|e| LoomError::Io(format!("zip finish: {e}")))?;
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
    fn dedupe_name_returns_base_when_unique() {
        assert_eq!(dedupe_world_name("My World", &[]), "My World");
    }

    #[test]
    fn dedupe_name_appends_copy_on_collision() {
        let existing = vec![WorldEntry {
            id: "x".into(),
            name: "My World".into(),
            db_path: String::new(),
            world_meta_path: String::new(),
        }];
        assert_eq!(dedupe_world_name("my world", &existing), "my world (copy)");
    }

    #[test]
    fn dedupe_name_increments_copy_count() {
        let existing = vec![
            WorldEntry {
                id: "a".into(),
                name: "World".into(),
                db_path: String::new(),
                world_meta_path: String::new(),
            },
            WorldEntry {
                id: "b".into(),
                name: "World (copy)".into(),
                db_path: String::new(),
                world_meta_path: String::new(),
            },
        ];
        assert_eq!(dedupe_world_name("World", &existing), "World (copy 2)");
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
