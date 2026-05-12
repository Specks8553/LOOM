//! Auth & onboarding Tauri commands (Doc 13, Doc 02, Doc 05 §AppState).
//!
//! All commands are thin handlers: validate inputs, delegate to `security/` and
//! `db/` modules, update `AppState`, return typed results.
//!
//! Master key and API key never appear in return values or log output.

use serde::Serialize;
use tauri::{Manager, State};
use tracing::{debug, info};
use ts_rs::TS;
use zeroize::Zeroize;

use crate::db::connection::{open_and_migrate, open_encrypted};
use crate::db::migrations::MigrationRoot;
use crate::db::settings::{get_app_setting, set_app_setting};
use crate::error::LoomError;
use crate::security::{crypto, sentinel};
use crate::services::config::{self, AppConfig};
use crate::services::settings_keys::AppSettingKey;
use crate::state::access;
use crate::state::AppState;

/// Result returned by `unlock_vault`.
#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "../src/lib/types.ts")]
pub struct UnlockResult {
    pub has_api_key: bool,
    pub auto_lock_secs: u64,
}

/// Returns `true` if onboarding is complete (`app_config.json` exists).
///
/// Called on startup to determine initial `appPhase`.
#[tauri::command]
pub fn check_onboarding(app: tauri::AppHandle) -> Result<bool, LoomError> {
    Ok(config::exists(&app))
}

/// First-launch setup: derive master key, write sentinel, create `app_settings.db`.
///
/// Only valid when `app_config.json` does not exist. Calling when already configured
/// returns `LoomError::Validation`.
#[tauri::command]
pub fn setup_vault(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    password: String,
    api_key: Option<String>,
) -> Result<(), LoomError> {
    if config::exists(&app) {
        return Err(LoomError::validation("Vault is already configured"));
    }
    if password.len() < 8 {
        return Err(LoomError::validation(
            "Password must be at least 8 characters",
        ));
    }

    info!("setup_vault: deriving master key");

    // 1. Derive master key.
    let salt = crypto::generate_salt();
    let mut key = crypto::derive_key(&password, &salt);

    // 2. Create sentinel.
    let key_check = sentinel::create(&key)?;

    // 3. Write app_config.json atomically.
    let cfg = AppConfig {
        worlds: vec![],
        active_world_id: None,
        salt_hex: hex::encode(salt),
        key_check,
    };
    config::write(&app, &cfg)?;

    // 4. Open (create) app_settings.db, apply schema.
    let settings_path = app
        .path()
        .app_data_dir()
        .map_err(|e: tauri::Error| LoomError::Io(e.to_string()))?
        .join("app_settings.db");

    std::fs::create_dir_all(settings_path.parent().unwrap()).map_err(LoomError::from)?;
    let settings_conn = open_and_migrate(&settings_path, &key, MigrationRoot::App)?;

    // 5. Write API key if provided.
    if let Some(ref api_key_str) = api_key {
        if !api_key_str.is_empty() {
            set_app_setting(&settings_conn, AppSettingKey::ApiKey, api_key_str)?;
        }
    }

    // 6. Store key + conn in AppState (helpers zero any prior values).
    access::replace_master_key(&state, Some(key))?;
    access::replace_api_key(&state, api_key.filter(|s| !s.is_empty()))?;
    access::replace_settings_conn(&state, Some(settings_conn))?;

    // 7. Zero the local stack copy — key is now exclusively in AppState.
    key.zeroize();

    info!("setup_vault: complete");
    Ok(())
}

/// Unlock the vault: verify sentinel, open `app_settings.db`, load API key.
///
/// Returns `UnlockResult` with the `has_api_key` flag and configured auto-lock duration.
/// On wrong password, returns `LoomError::Crypto`.
#[tauri::command]
pub fn unlock_vault(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    password: String,
) -> Result<UnlockResult, LoomError> {
    debug!("unlock_vault: reading config");
    let cfg = config::read(&app)?;

    // 1. Derive key from password + stored salt.
    let salt_bytes = hex::decode(&cfg.salt_hex)
        .map_err(|_| LoomError::Crypto("Stored salt is not valid hex".into()))?;
    let mut key = crypto::derive_key(&password, &salt_bytes);

    // 2. Verify sentinel — wrong password → Crypto error (field clears on frontend).
    sentinel::verify(&key, &cfg.key_check)?;

    info!("unlock_vault: sentinel verified");

    // 3. Open app_settings.db.
    let settings_path = app
        .path()
        .app_data_dir()
        .map_err(|e: tauri::Error| LoomError::Io(e.to_string()))?
        .join("app_settings.db");

    let settings_conn = if settings_path.exists() {
        open_encrypted(&settings_path, &key)?
    } else {
        // DB missing (e.g. first unlock after reinstall without config wipe).
        open_and_migrate(&settings_path, &key, MigrationRoot::App)?
    };

    // 4. Load API key into AppState (bytes never cross IPC boundary).
    let api_key: String = get_app_setting(&settings_conn, AppSettingKey::ApiKey)?;
    let has_api_key = !api_key.is_empty();

    // 5. Load auto-lock duration.
    let auto_lock_secs: u64 = get_app_setting(&settings_conn, AppSettingKey::AutoLockSecs)?;

    // 6. Store in AppState (helpers zero any prior values).
    access::replace_master_key(&state, Some(key))?;
    access::replace_api_key(&state, if has_api_key { Some(api_key) } else { None })?;
    access::replace_settings_conn(&state, Some(settings_conn))?;

    // 7. Zero local stack copy.
    key.zeroize();

    info!("unlock_vault: complete, has_api_key={has_api_key}");
    Ok(UnlockResult {
        has_api_key,
        auto_lock_secs,
    })
}

/// Lock the vault: zero master key + API key, close all DB connections.
///
/// Frontend is responsible for clearing store state after this returns.
#[tauri::command]
pub fn lock_vault(state: State<'_, AppState>) -> Result<(), LoomError> {
    info!("lock_vault: zeroing secrets");

    // Signal any in-flight generation so its task observes cancellation
    // before its DB writes start failing on a closed connection.
    // The partial AI text written before the cancel arrives is preserved
    // (Doc 15 §Cancellation Taxonomy: "Vault locked mid-stream → Both
    // preserved (partial AI)"). Subsequent writes after the connection is
    // dropped silently fail and are swallowed by the streaming task.
    let _ = access::cancel_current(&state);

    access::replace_master_key(&state, None)?;
    access::replace_api_key(&state, None)?;
    access::replace_settings_conn(&state, None)?;
    access::replace_active_conn(&state, None)?;
    access::replace_active_world_id(&state, None)?;

    info!("lock_vault: complete");
    Ok(())
}

/// Change the master password: verify current, re-derive key, rewrite sentinel and rekey DBs.
///
/// If any rekey fails, the operation is aborted and the old key remains active.
#[tauri::command]
pub fn change_password(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    current_password: String,
    new_password: String,
) -> Result<(), LoomError> {
    if new_password.len() < 8 {
        return Err(LoomError::validation(
            "New password must be at least 8 characters",
        ));
    }

    // 1. Verify current password against the sentinel.
    let cfg = config::read(&app)?;
    let salt_bytes = hex::decode(&cfg.salt_hex)
        .map_err(|_| LoomError::Crypto("Stored salt is not valid hex".into()))?;
    let mut old_key = crypto::derive_key(&current_password, &salt_bytes);
    sentinel::verify(&old_key, &cfg.key_check)?;

    info!("change_password: current password verified, deriving new key");

    // 2. Derive new key.
    let new_salt = crypto::generate_salt();
    let mut new_key = crypto::derive_key(&new_password, &new_salt);

    // 3. Create new sentinel.
    let new_key_check = sentinel::create(&new_key)?;

    // 4. Rekey all world DBs first, tracking successes for rollback.
    //    Worlds are most likely to fail (file IO / corruption) so we do them
    //    before touching app_settings.db. If any world fails, every preceding
    //    success is rekeyed back to `old_key`.
    let mut rekeyed_worlds: Vec<&str> = Vec::new();
    for world in &cfg.worlds {
        let db_path = std::path::Path::new(&world.db_path);
        if !db_path.exists() {
            continue;
        }
        match rekey_db_file(db_path, &old_key, &new_key) {
            Ok(()) => rekeyed_worlds.push(&world.id),
            Err(e) => {
                rollback_worlds(&cfg.worlds, &rekeyed_worlds, &new_key, &old_key);
                old_key.zeroize();
                new_key.zeroize();
                return Err(LoomError::Database(format!(
                    "world DB rekey failed for {}: {e}",
                    world.id
                )));
            }
        }
    }

    // 5. Rekey app_settings.db via the existing live connection.
    if let Err(e) = rekey_settings_conn(&state, &new_key) {
        rollback_worlds(&cfg.worlds, &rekeyed_worlds, &new_key, &old_key);
        old_key.zeroize();
        new_key.zeroize();
        return Err(e);
    }

    // 6. Atomically rewrite app_config.json with new salt + sentinel.
    let new_cfg = AppConfig {
        worlds: cfg.worlds.clone(),
        active_world_id: cfg.active_world_id.clone(),
        salt_hex: hex::encode(new_salt),
        key_check: new_key_check,
    };
    if let Err(e) = config::write(&app, &new_cfg) {
        // Best-effort rollback: settings + worlds back to old key.
        let _ = rekey_settings_conn(&state, &old_key);
        rollback_worlds(&cfg.worlds, &rekeyed_worlds, &new_key, &old_key);
        old_key.zeroize();
        new_key.zeroize();
        return Err(e);
    }

    // 7. Update AppState with new key (helper zeroes the prior value).
    access::replace_master_key(&state, Some(new_key))?;

    // 8. Zero local copies.
    old_key.zeroize();
    new_key.zeroize();

    info!("change_password: complete");
    Ok(())
}

/// Open `path` with `from` as the SQLCipher key, then rekey to `to`.
fn rekey_db_file(path: &std::path::Path, from: &[u8; 32], to: &[u8; 32]) -> Result<(), LoomError> {
    let conn = open_encrypted(path, from)?;
    let to_hex = hex::encode(to);
    conn.execute_batch(&format!("PRAGMA rekey = \"x'{to_hex}'\";"))
        .map_err(|e| LoomError::Database(format!("rekey failed: {e}")))?;
    Ok(())
}

/// Rekey the live `app_settings.db` connection.
fn rekey_settings_conn(state: &AppState, to: &[u8; 32]) -> Result<(), LoomError> {
    access::with_settings_conn(state, |conn| {
        let to_hex = hex::encode(to);
        conn.execute_batch(&format!("PRAGMA rekey = \"x'{to_hex}'\";"))
            .map_err(|e| LoomError::Database(format!("settings rekey failed: {e}")))?;
        Ok(())
    })
}

/// Best-effort: rekey `worlds_to_revert` (by id) from `current` back to `target`.
/// If a revert itself fails we log loudly; the system is left inconsistent and
/// the user must restore from backup. This is the irreducible cost of a
/// multi-file rekey crashing mid-flight.
fn rollback_worlds(
    all_worlds: &[crate::services::config::WorldEntry],
    worlds_to_revert: &[&str],
    current: &[u8; 32],
    target: &[u8; 32],
) {
    for id in worlds_to_revert {
        if let Some(world) = all_worlds.iter().find(|w| w.id == *id) {
            let path = std::path::Path::new(&world.db_path);
            if let Err(e) = rekey_db_file(path, current, target) {
                tracing::error!(world_id = %id, "rollback rekey failed: {e}");
            }
        }
    }
}

/// Write a new API key to `app_settings.db` and update `AppState`.
///
/// Requires unlocked vault. The key bytes never appear in return values or logs.
#[tauri::command]
pub fn set_api_key(state: State<'_, AppState>, key: String) -> Result<(), LoomError> {
    access::with_settings_conn(&state, |conn| {
        set_app_setting(conn, AppSettingKey::ApiKey, &key)
    })?;

    access::replace_api_key(&state, if key.is_empty() { None } else { Some(key) })?;

    debug!("set_api_key: saved");
    Ok(())
}

/// Returns `true` if a non-empty API key is configured. Does not return the key.
#[tauri::command]
pub fn has_api_key(state: State<'_, AppState>) -> Result<bool, LoomError> {
    // `with_api_key` errors when no key is set; we want the boolean form.
    access::with_api_key(&state, |k| Ok(!k.is_empty())).or_else(|e| match e {
        LoomError::Validation { .. } => Ok(false),
        other => Err(other),
    })
}
