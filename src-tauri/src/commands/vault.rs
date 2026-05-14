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

use tauri::{Emitter, State};
use tracing::info;

use crate::db::vault::VaultItemMeta;
use crate::error::LoomError;
use crate::services::vault as vault_service;
use crate::services::world::{self, WorldMeta, WorldMetaPatch};
use crate::state::access;
use crate::state::AppState;

/// Emit `vault_updated { world_id }` for the currently-active world.
/// No-op (Ok) when no world is active — most item commands will already
/// have errored before reaching this path, but this is the defensive bound.
fn emit_vault_updated(app: &tauri::AppHandle, state: &AppState) -> Result<(), LoomError> {
    let id_opt = access::with_active_world_id(state, |id| Ok(id.to_owned())).ok();
    if let Some(world_id) = id_opt {
        app.emit("vault_updated", serde_json::json!({ "world_id": world_id }))
            .map_err(|e| LoomError::Internal(format!("emit vault_updated failed: {e}")))?;
    }
    Ok(())
}

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

/// Import a world from a `.loom-backup` zip at `src_path` (Doc 14 §World
/// Backup §Import). The new world gets a fresh `world_id` UUID, is registered
/// in `app_config.json`, and is **not** auto-opened — the writer can review
/// and open it from the World Picker.
#[tauri::command]
pub fn import_world(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    src_path: String,
) -> Result<WorldMeta, LoomError> {
    let path = std::path::PathBuf::from(&src_path);
    let meta = access::with_master_key(&state, |key| world::import_world(&app, key, &path))?;
    info!(world_id = %meta.id, "import_world: complete");
    Ok(meta)
}

/// Export a world to a `.loom-backup` zip at `dest_path` (Doc 14 §World
/// Backup). Frontend is responsible for picking `dest_path` via the native
/// save dialog. The world stays open during export — the backup is a
/// snapshot at the time of the call.
#[tauri::command]
pub fn export_world(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    world_id: String,
    dest_path: String,
) -> Result<(), LoomError> {
    let path = std::path::PathBuf::from(&dest_path);
    access::with_master_key(&state, |key| {
        world::export_world(&app, key, &world_id, &path)
    })?;
    info!(world_id = %world_id, "export_world: complete");
    Ok(())
}

// --- Item commands (Phase 2C) -------------------------------------------------

/// List every item in the active world. With `include_deleted = true` the
/// soft-deleted rows are also returned (used by the Trash view).
#[tauri::command]
pub fn list_items(
    state: State<'_, AppState>,
    include_deleted: bool,
) -> Result<Vec<VaultItemMeta>, LoomError> {
    access::with_active_conn(&state, |conn| {
        crate::db::vault::list_items(conn, include_deleted)
    })
}

/// Create a new vault item. `template_slug` is recorded in `item_subtype`
/// for SourceDocuments (Phase 5 will use it to seed body text). Emits
/// `vault_updated`.
#[tauri::command]
pub fn create_item(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    parent_id: Option<String>,
    item_type: String,
    name: String,
    template_slug: Option<String>,
) -> Result<VaultItemMeta, LoomError> {
    let item = access::with_active_conn(&state, |conn| {
        vault_service::create_item(
            conn,
            parent_id.as_deref(),
            &item_type,
            &name,
            template_slug.as_deref(),
        )
    })?;
    emit_vault_updated(&app, &state)?;
    info!(item_id = %item.id, item_type = %item.item_type, "create_item");
    Ok(item)
}

/// Rename a vault item.
#[tauri::command]
pub fn rename_item(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    item_id: String,
    name: String,
) -> Result<(), LoomError> {
    access::with_active_conn(&state, |conn| {
        vault_service::rename_item(conn, &item_id, &name)
    })?;
    emit_vault_updated(&app, &state)?;
    Ok(())
}

/// Move an item to a new parent / sort_order. Pass `parent_id = None` to
/// move to the vault root.
#[tauri::command]
pub fn move_item(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    item_id: String,
    new_parent_id: Option<String>,
    new_sort_order: i64,
) -> Result<(), LoomError> {
    access::with_active_conn(&state, |conn| {
        vault_service::move_item(conn, &item_id, new_parent_id.as_deref(), new_sort_order)
    })?;
    emit_vault_updated(&app, &state)?;
    Ok(())
}

/// Soft-delete an item (sets `deleted_at`). Folders must be empty.
/// Idempotent — calling twice is not an error.
#[tauri::command]
pub fn delete_item(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    item_id: String,
) -> Result<(), LoomError> {
    access::with_active_conn(&state, |conn| {
        vault_service::soft_delete_item(conn, &item_id)
    })?;
    emit_vault_updated(&app, &state)?;
    Ok(())
}

/// Restore a soft-deleted item. If the parent folder is also trashed the
/// item is reparented to the vault root (Doc 14 §Edge Cases).
#[tauri::command]
pub fn restore_item(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    item_id: String,
) -> Result<(), LoomError> {
    access::with_active_conn(&state, |conn| vault_service::restore_item(conn, &item_id))?;
    emit_vault_updated(&app, &state)?;
    Ok(())
}

/// Hard-delete an item. Cascades via FK constraints (`messages`,
/// `accordion_segments`, `cache_state`, etc. all `ON DELETE CASCADE`).
#[tauri::command]
pub fn delete_item_permanent(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    item_id: String,
) -> Result<(), LoomError> {
    access::with_active_conn(&state, |conn| {
        crate::db::vault::delete_item_permanent(conn, &item_id)
    })?;
    emit_vault_updated(&app, &state)?;
    Ok(())
}

/// Hard-delete every soft-deleted item. Returns the count removed.
#[tauri::command]
pub fn empty_trash(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<u32, LoomError> {
    let count = access::with_active_conn(&state, crate::db::vault::empty_trash)?;
    emit_vault_updated(&app, &state)?;
    info!(count, "empty_trash");
    Ok(count)
}

// --- Source documents + attachments (Phase 5) -------------------------------

/// Read a Source Document or Image's `content`. Empty string is valid.
#[tauri::command]
pub fn get_item_content(state: State<'_, AppState>, item_id: String) -> Result<String, LoomError> {
    access::with_active_conn(&state, |conn| {
        vault_service::get_item_content(conn, &item_id)
    })
}

/// Save a Source Document or Image's `content`. Marks every attached story's
/// cache stale (Phase 6 fills the body). Emits `vault_updated`.
#[tauri::command]
pub fn update_item_content(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    item_id: String,
    content: String,
) -> Result<(), LoomError> {
    access::with_active_conn(&state, |conn| {
        vault_service::update_item_content(conn, &item_id, &content)
    })?;
    emit_vault_updated(&app, &state)?;
    Ok(())
}

/// Attach a Source Document / Image to a Story. Returns the new ordered
/// `context_doc_ids`. Emits `vault_updated`.
#[tauri::command]
pub fn attach_context_doc(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    story_id: String,
    doc_id: String,
) -> Result<Vec<String>, LoomError> {
    let ids = access::with_active_conn(&state, |conn| {
        vault_service::attach_context_doc(conn, &story_id, &doc_id)
    })?;
    emit_vault_updated(&app, &state)?;
    info!(story_id = %story_id, doc_id = %doc_id, "attach_context_doc");
    Ok(ids)
}

/// Detach a doc from a Story (user-initiated; `reason` is NULL in the audit
/// trail). Returns the new ordered `context_doc_ids`. Emits `vault_updated`.
#[tauri::command]
pub fn detach_context_doc(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    story_id: String,
    doc_id: String,
) -> Result<Vec<String>, LoomError> {
    let ids = access::with_active_conn(&state, |conn| {
        vault_service::detach_context_doc(conn, &story_id, &doc_id, None)
    })?;
    emit_vault_updated(&app, &state)?;
    info!(story_id = %story_id, doc_id = %doc_id, "detach_context_doc");
    Ok(ids)
}

/// List the live `VaultItemMeta` rows for every doc attached to `story_id`,
/// in insertion order.
#[tauri::command]
pub fn list_attached_docs(
    state: State<'_, AppState>,
    story_id: String,
) -> Result<Vec<VaultItemMeta>, LoomError> {
    access::with_active_conn(&state, |conn| {
        vault_service::list_attached_docs(conn, &story_id)
    })
}
