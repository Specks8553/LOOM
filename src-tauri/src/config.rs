use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::crypto::{self, SentinelData};
use crate::error::LoomError;

/// Default PBKDF2 iteration count (200,000 per Doc 11 §5.1 / Amendment A9).
pub const DEFAULT_PBKDF2_ITERATIONS: u32 = 200_000;

/// World entry in app_config.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldEntry {
    pub id: String,
    pub dir: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted_at: Option<String>,
}

/// Root app_config.json schema per Doc 11 §12.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub version: u32,
    pub pbkdf2_salt_hex: String,
    pub pbkdf2_iterations: u32,
    pub key_check: SentinelData,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_world_id: Option<String>,
    pub worlds: Vec<WorldEntry>,
}

/// Get the LOOM app data directory.
/// Windows: %APPDATA%\LOOM\
/// macOS: ~/Library/Application Support/LOOM/
/// Linux: ~/.local/share/LOOM/
pub fn app_data_dir() -> Result<PathBuf, LoomError> {
    let base = dirs::data_dir()
        .or_else(|| dirs::config_dir())
        .ok_or_else(|| LoomError::Io("Cannot determine app data directory".into()))?;
    Ok(base.join("LOOM"))
}

/// Full path to app_config.json.
fn config_path() -> Result<PathBuf, LoomError> {
    Ok(app_data_dir()?.join("app_config.json"))
}

/// Check if app_config.json exists and is parseable.
pub fn check_app_config() -> Result<bool, LoomError> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(false);
    }
    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str::<AppConfig>(&content) {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        },
        Err(_) => Ok(false),
    }
}

/// Read and parse app_config.json.
pub fn read_app_config() -> Result<AppConfig, LoomError> {
    let path = config_path()?;
    if !path.exists() {
        return Err(LoomError::ConfigNotFound);
    }
    let content = fs::read_to_string(&path)?;
    let config: AppConfig =
        serde_json::from_str(&content).map_err(|e| LoomError::ConfigCorrupted(e.to_string()))?;
    Ok(config)
}

/// Create a new app_config.json from a master password.
/// Generates fresh salt, derives key, creates sentinel.
/// Returns the derived key so the caller can store it in AppState.
pub fn create_app_config(password: &str) -> Result<[u8; 32], LoomError> {
    let data_dir = app_data_dir()?;
    fs::create_dir_all(&data_dir)?;

    let salt = crypto::generate_salt();
    let key = crypto::derive_key(password, &salt, DEFAULT_PBKDF2_ITERATIONS);
    let sentinel = crypto::create_sentinel(&key)?;

    let config = AppConfig {
        version: 1,
        pbkdf2_salt_hex: hex::encode(salt),
        pbkdf2_iterations: DEFAULT_PBKDF2_ITERATIONS,
        key_check: sentinel,
        active_world_id: None,
        worlds: vec![],
    };

    write_app_config_atomic(&config)?;

    Ok(key)
}

/// Write app_config.json atomically (write .tmp then rename).
pub fn write_app_config_atomic(config: &AppConfig) -> Result<(), LoomError> {
    let path = config_path()?;
    let tmp_path = path.with_extension("json.tmp");

    let content = serde_json::to_string_pretty(config)?;
    fs::write(&tmp_path, &content)?;
    fs::rename(&tmp_path, &path)?;

    Ok(())
}

/// Add a world entry to app_config.json.
pub fn add_world_to_config(entry: WorldEntry) -> Result<(), LoomError> {
    let mut config = read_app_config()?;

    // Set as active if it's the first world
    if config.worlds.is_empty() {
        config.active_world_id = Some(entry.id.clone());
    }

    config.worlds.push(entry);
    write_app_config_atomic(&config)?;
    Ok(())
}

/// Update the active_world_id in app_config.json.
pub fn set_active_world_id(id: Option<String>) -> Result<(), LoomError> {
    let mut config = read_app_config()?;
    config.active_world_id = id;
    write_app_config_atomic(&config)?;
    Ok(())
}

/// Set or clear the deleted_at field for a world entry in app_config.json.
pub fn set_world_deleted(world_id: &str, deleted_at: Option<String>) -> Result<(), LoomError> {
    let mut config = read_app_config()?;
    let entry = config
        .worlds
        .iter_mut()
        .find(|e| e.id == world_id)
        .ok_or_else(|| LoomError::WorldNotFound(world_id.to_string()))?;
    entry.deleted_at = deleted_at;
    write_app_config_atomic(&config)?;
    Ok(())
}

/// Remove a world entry from app_config.json entirely.
pub fn remove_world_from_config(world_id: &str) -> Result<(), LoomError> {
    let mut config = read_app_config()?;
    config.worlds.retain(|e| e.id != world_id);
    if config.active_world_id.as_deref() == Some(world_id) {
        config.active_world_id = config.worlds.first().map(|e| e.id.clone());
    }
    write_app_config_atomic(&config)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_data_dir() {
        let dir = app_data_dir().unwrap();
        assert!(dir.ends_with("LOOM"));
    }
}
