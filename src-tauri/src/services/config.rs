//! `app_config.json` read/write (Doc 13 §Data Requirements, Doc 02 §Atomic File Writes).
//!
//! The config file is plaintext JSON at the platform config directory. It contains:
//!   - `worlds` — the world registry (added in Phase 2; empty array in Phase 1)
//!   - `active_world_id` — last active world (null in Phase 1)
//!   - `salt_hex` — 32-byte PBKDF2 salt, hex-encoded
//!   - `key_check` — AES-256-GCM sentinel `{ nonce_hex, ciphertext_hex }`
//!
//! All writes are atomic: write to `<path>.tmp`, then `fs::rename`.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::Manager;
use ts_rs::TS;

use crate::error::LoomError;
use crate::security::sentinel::Sentinel;

const CONFIG_FILE: &str = "app_config.json";

/// Represents one entry in the worlds registry (Phase 2 adds world creation; Phase 1
/// initialises with an empty list).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/lib/types.ts")]
pub struct WorldEntry {
    pub id: String,
    pub name: String,
    pub db_path: String,
}

/// Full `app_config.json` payload.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/lib/types.ts")]
pub struct AppConfig {
    pub worlds: Vec<WorldEntry>,
    pub active_world_id: Option<String>,
    pub salt_hex: String,
    pub key_check: Sentinel,
}

/// Return the absolute path to `app_config.json` in the platform config directory.
pub fn config_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .expect("platform config dir must be resolvable")
        .join(CONFIG_FILE)
}

/// Return `true` if `app_config.json` exists (first-launch detection).
pub fn exists(app: &tauri::AppHandle) -> bool {
    config_path(app).exists()
}

/// Read and deserialize `app_config.json`.
///
/// Returns `LoomError::NotFound` if the file does not exist.
pub fn read(app: &tauri::AppHandle) -> Result<AppConfig, LoomError> {
    let path = config_path(app);
    let bytes = std::fs::read(&path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            LoomError::NotFound("app_config.json not found".into())
        } else {
            LoomError::Io(e.to_string())
        }
    })?;
    serde_json::from_slice(&bytes).map_err(LoomError::from)
}

/// Atomically write `config` to `app_config.json` (Doc 02 §Atomic File Writes).
///
/// Writes to `<path>.tmp` then `fs::rename` — avoids partial-write corruption.
pub fn write(app: &tauri::AppHandle, config: &AppConfig) -> Result<(), LoomError> {
    let path = config_path(app);

    // Ensure the parent directory exists.
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(LoomError::from)?;
    }

    let json = serde_json::to_vec_pretty(config).map_err(LoomError::from)?;

    let tmp_path = path.with_extension("tmp");
    std::fs::write(&tmp_path, &json).map_err(LoomError::from)?;
    std::fs::rename(&tmp_path, &path).map_err(LoomError::from)?;

    Ok(())
}
