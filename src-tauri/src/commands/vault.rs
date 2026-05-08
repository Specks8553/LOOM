//! Vault & worlds Tauri commands (Doc 14, Doc 03 §`worlds`, Doc 07 §vault).
//!
//! Phase 2A — worlds half:
//!   - `list_worlds`        — return all `WorldMeta`
//!   - `create_world`       — provision dir + DB + meta + register
//!   - `open_world`         — switch the active world
//!   - `delete_world`       — type-to-confirm permanent removal
//!   - `update_world_meta`  — patch display fields, write through
//!
//! Item commands (`list_items`, `create_item`, …) land in Phase 2C.
//! World backup (`export_world`) lands in Phase 2D.
//!
//! All commands run with the vault unlocked. The master key is read from
//! `AppState` via `with_master_key`; it never crosses the IPC boundary.

use tauri::State;
use tracing::info;

use crate::error::LoomError;
use crate::services::world::{self, WorldMeta, WorldMetaPatch};
use crate::state::access;
use crate::state::AppState;

/// Return every world registered in `app_config.json` with its full meta.
#[tauri::command]
pub fn list_worlds(app: tauri::AppHandle) -> Result<Vec<WorldMeta>, LoomError> {
    world::list_worlds(&app)
}

/// Create a new world. The world is **not** opened automatically — the
/// frontend calls `open_world` next if the user wants to switch into it.
#[tauri::command]
pub fn create_world(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    name: String,
) -> Result<WorldMeta, LoomError> {
    let meta = access::with_master_key(&state, |key| {
        world::create_world(&app, key, &name).map(|(_, meta)| meta)
    })?;
    info!(world_id = %meta.id, "create_world: complete");
    Ok(meta)
}

/// Open an existing world: load its encrypted DB, replace `active_conn`,
/// remember the id in `AppState` and `app_config.json`.
#[tauri::command]
pub fn open_world(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    world_id: String,
) -> Result<(), LoomError> {
    let conn = access::with_master_key(&state, |key| world::open_world(&app, key, &world_id))?;

    access::replace_active_conn(&state, Some(conn))?;
    access::replace_active_world_id(&state, Some(world_id.clone()))?;
    world::set_active_world_id(&app, Some(&world_id))?;

    info!(world_id = %world_id, "open_world: active");
    Ok(())
}

/// Delete a world permanently. Requires `name_confirmation` to match the
/// world's display name (Doc 14 §Delete world). If the deleted world is
/// currently active, `active_conn` and `active_world_id` are cleared.
#[tauri::command]
pub fn delete_world(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    world_id: String,
    name_confirmation: String,
) -> Result<(), LoomError> {
    // Detect "deleting the active world" before mutating; if so, drop the
    // active connection first so the file handle is closed before the dir
    // is removed.
    let active_id = access::with_active_world_id(&state, |id| Ok(id.to_owned())).ok();
    let deleting_active = active_id.as_deref() == Some(world_id.as_str());

    if deleting_active {
        access::replace_active_conn(&state, None)?;
        access::replace_active_world_id(&state, None)?;
    }

    world::delete_world(&app, &world_id, &name_confirmation)?;

    info!(world_id = %world_id, deleting_active, "delete_world: complete");
    Ok(())
}

/// Patch a world's display metadata (`name`, `tags`, `accent_color`,
/// `cover_image_path`). Returns the new full meta. Doc 14 §write-through:
/// `name` change propagates to `app_config.json` in the same call.
#[tauri::command]
pub fn update_world_meta(
    app: tauri::AppHandle,
    world_id: String,
    patch: WorldMetaPatch,
) -> Result<WorldMeta, LoomError> {
    world::update_world_meta(&app, &world_id, patch)
}
