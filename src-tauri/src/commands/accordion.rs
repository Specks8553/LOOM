//! Accordion Tauri commands (Doc 16 §Backend API, Doc 07 §accordion).
//!
//! Thin handlers — call into `services/accordion.rs`, emit
//! `accordion_state_changed` after every mutation. The summarisation flow
//! (`summarise_segment`) lives in Phase 7C; cache-stale wiring for the
//! mutation commands also lands in 7C (the service layer is unchanged then —
//! only this file gains `cache::mark_story_stale` calls gated by the
//! overlap-with-cached-prefix check).

use serde::Serialize;
use tauri::{Emitter, State};
use tracing::info;

use crate::db::accordion::{AccordionState, Checkpoint};
use crate::error::LoomError;
use crate::services::accordion as accordion_service;
use crate::state::access;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
struct AccordionStateChangedPayload<'a> {
    story_id: &'a str,
    segment_id: Option<&'a str>,
    checkpoint_id: Option<&'a str>,
}

fn emit_accordion_state_changed(
    app: &tauri::AppHandle,
    story_id: &str,
    segment_id: Option<&str>,
    checkpoint_id: Option<&str>,
) -> Result<(), LoomError> {
    app.emit(
        "accordion_state_changed",
        AccordionStateChangedPayload {
            story_id,
            segment_id,
            checkpoint_id,
        },
    )
    .map_err(|e| LoomError::Internal(format!("emit accordion_state_changed failed: {e}")))
}

/// Resolve a segment's `story_id`. Used by commands that take a `segment_id`
/// directly and need a `story_id` for the emit payload.
fn segment_story_id(state: &AppState, segment_id: &str) -> Result<String, LoomError> {
    access::with_active_conn(state, |conn| {
        let seg = crate::db::accordion::get_segment(conn, segment_id)?
            .ok_or_else(|| LoomError::NotFound(format!("segment {segment_id} not found")))?;
        Ok(seg.story_id)
    })
}

/// Resolve a checkpoint's `story_id`. Used by `rename_checkpoint` /
/// `delete_checkpoint` for the emit payload.
fn checkpoint_story_id(state: &AppState, checkpoint_id: &str) -> Result<String, LoomError> {
    access::with_active_conn(state, |conn| {
        let cp = crate::db::accordion::get_checkpoint(conn, checkpoint_id)?
            .ok_or_else(|| LoomError::NotFound(format!("checkpoint {checkpoint_id} not found")))?;
        Ok(cp.story_id)
    })
}

#[tauri::command]
pub fn get_accordion_state(
    state: State<'_, AppState>,
    story_id: String,
) -> Result<AccordionState, LoomError> {
    access::with_active_conn(&state, |conn| {
        accordion_service::get_accordion_state(conn, &story_id)
    })
}

#[tauri::command]
pub fn create_checkpoint(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    story_id: String,
    after_message_id: String,
    name: String,
) -> Result<Checkpoint, LoomError> {
    let cp = access::with_active_conn(&state, |conn| {
        accordion_service::create_checkpoint(conn, &story_id, &after_message_id, &name)
    })?;
    emit_accordion_state_changed(&app, &story_id, None, Some(&cp.id))?;
    info!(story_id = %story_id, checkpoint_id = %cp.id, "create_checkpoint");
    Ok(cp)
}

#[tauri::command]
pub fn rename_checkpoint(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    checkpoint_id: String,
    name: String,
) -> Result<(), LoomError> {
    let story_id = checkpoint_story_id(&state, &checkpoint_id)?;
    access::with_active_conn(&state, |conn| {
        accordion_service::rename_checkpoint(conn, &checkpoint_id, &name)
    })?;
    emit_accordion_state_changed(&app, &story_id, None, Some(&checkpoint_id))?;
    Ok(())
}

#[tauri::command]
pub fn delete_checkpoint(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    checkpoint_id: String,
) -> Result<(), LoomError> {
    let story_id = checkpoint_story_id(&state, &checkpoint_id)?;
    access::with_active_conn(&state, |conn| {
        accordion_service::delete_checkpoint(conn, &checkpoint_id).map(|_| ())
    })?;
    emit_accordion_state_changed(&app, &story_id, None, Some(&checkpoint_id))?;
    info!(story_id = %story_id, checkpoint_id = %checkpoint_id, "delete_checkpoint");
    Ok(())
}

#[tauri::command]
pub fn update_segment_summary(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    segment_id: String,
    summary: String,
) -> Result<(), LoomError> {
    let story_id = segment_story_id(&state, &segment_id)?;
    access::with_active_conn(&state, |conn| {
        accordion_service::update_segment_summary(conn, &segment_id, &summary)
    })?;
    emit_accordion_state_changed(&app, &story_id, Some(&segment_id), None)?;
    Ok(())
}

#[tauri::command]
pub fn set_segment_collapsed(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    segment_id: String,
    collapsed: bool,
) -> Result<(), LoomError> {
    let story_id = segment_story_id(&state, &segment_id)?;
    access::with_active_conn(&state, |conn| {
        accordion_service::set_segment_collapsed(conn, &segment_id, collapsed)
    })?;
    emit_accordion_state_changed(&app, &story_id, Some(&segment_id), None)?;
    Ok(())
}

#[tauri::command]
pub fn set_segment_use_summary(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    segment_id: String,
    use_summary: bool,
) -> Result<(), LoomError> {
    let story_id = segment_story_id(&state, &segment_id)?;
    access::with_active_conn(&state, |conn| {
        accordion_service::set_segment_use_summary(conn, &segment_id, use_summary)
    })?;
    emit_accordion_state_changed(&app, &story_id, Some(&segment_id), None)?;
    Ok(())
}

#[tauri::command]
pub fn clear_segment_summary(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    segment_id: String,
) -> Result<(), LoomError> {
    let story_id = segment_story_id(&state, &segment_id)?;
    access::with_active_conn(&state, |conn| {
        accordion_service::clear_segment_summary(conn, &segment_id)
    })?;
    emit_accordion_state_changed(&app, &story_id, Some(&segment_id), None)?;
    Ok(())
}
