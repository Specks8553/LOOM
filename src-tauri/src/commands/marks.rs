//! Marks Tauri commands (Doc 30 §10, Doc 07 §marks).
//!
//! Thin handlers over `db/marks.rs` + `services/marks.rs`. Every mutation emits
//! `marks_changed` and — when the marked message sits inside a closed accordion
//! segment — marks that segment stale (Doc 16 §Stale Triggers, Doc 30 §9).
//!
//! Marks never enter a story/session send and are never part of a cached prefix
//! (Doc 30 §6/§9), so there is **no** cache-stale wiring here.

use serde::Serialize;
use tauri::{Emitter, State};
use tracing::info;
use uuid::Uuid;

use crate::db::marks::{self as db_marks, ImportantMark};
use crate::db::messages::get_message;
use crate::error::LoomError;
use crate::services::marks as marks_service;
use crate::state::access;
use crate::state::AppState;

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[derive(Debug, Clone, Serialize)]
struct MarksChangedPayload<'a> {
    story_id: &'a str,
    message_id: Option<&'a str>,
}

fn emit_marks_changed(app: &tauri::AppHandle, story_id: &str, message_id: Option<&str>) {
    let _ = app.emit(
        "marks_changed",
        MarksChangedPayload {
            story_id,
            message_id,
        },
    );
}

/// Mark the closed accordion segment containing `message_id` stale and emit
/// `accordion_state_changed`. No-op for messages in the open segment. Mirrors
/// the precedent in `commands/conversation.rs` (duplicated rather than shared
/// to keep per-command ownership clear).
fn mark_segment_stale_for_message(
    app: &tauri::AppHandle,
    state: &AppState,
    message_id: &str,
) -> Result<(), LoomError> {
    let result = access::with_active_conn(state, |conn| {
        let Some(msg) = get_message(conn, message_id)? else {
            return Ok(None);
        };
        if msg.kind != "story" {
            return Ok(None);
        }
        let Some(seg_id) = crate::services::accordion::mark_segment_stale_for_message(
            conn,
            &msg.story_id,
            message_id,
        )?
        else {
            return Ok(None);
        };
        Ok(Some((msg.story_id, seg_id)))
    })?;
    if let Some((story_id, segment_id)) = result {
        let _ = app.emit(
            "accordion_state_changed",
            serde_json::json!({
                "story_id": story_id,
                "segment_id": segment_id,
                "checkpoint_id": Option::<String>::None,
            }),
        );
    }
    Ok(())
}

#[tauri::command]
pub fn list_marks(
    state: State<'_, AppState>,
    story_id: String,
) -> Result<Vec<ImportantMark>, LoomError> {
    access::with_active_conn(&state, |conn| db_marks::list_for_story(conn, &story_id))
}

#[tauri::command]
pub fn add_mark(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    message_id: String,
    quoted_text: String,
    char_start: Option<i64>,
    char_end: Option<i64>,
    note: Option<String>,
) -> Result<ImportantMark, LoomError> {
    if quoted_text.trim().is_empty() {
        return Err(LoomError::validation("A mark needs a non-empty passage."));
    }
    let note = note
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    let mark = access::with_active_conn(&state, |conn| {
        let msg = get_message(conn, &message_id)?
            .ok_or_else(|| LoomError::NotFound(format!("message {message_id} not found")))?;
        if msg.kind != "story" {
            return Err(LoomError::validation(
                "Marks only apply to story-kind messages.",
            ));
        }
        let now = now_iso();
        let mark = ImportantMark {
            id: Uuid::new_v4().to_string(),
            story_id: msg.story_id,
            message_id: message_id.clone(),
            quoted_text: quoted_text.clone(),
            note: note.clone(),
            char_start,
            char_end,
            is_orphaned: false,
            created_at: now.clone(),
            modified_at: now,
        };
        db_marks::insert_mark(conn, &mark)?;
        Ok(mark)
    })?;
    mark_segment_stale_for_message(&app, &state, &message_id)?;
    emit_marks_changed(&app, &mark.story_id, Some(&message_id));
    info!(message_id = %message_id, mark_id = %mark.id, "add_mark");
    Ok(mark)
}

#[tauri::command]
pub fn remove_mark(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    mark_id: String,
) -> Result<(), LoomError> {
    let (story_id, message_id) = access::with_active_conn(&state, |conn| {
        let m = db_marks::get_mark(conn, &mark_id)?
            .ok_or_else(|| LoomError::NotFound(format!("mark {mark_id} not found")))?;
        db_marks::delete_mark(conn, &mark_id)?;
        Ok((m.story_id, m.message_id))
    })?;
    mark_segment_stale_for_message(&app, &state, &message_id)?;
    emit_marks_changed(&app, &story_id, Some(&message_id));
    info!(mark_id = %mark_id, "remove_mark");
    Ok(())
}

#[tauri::command]
pub fn update_mark_note(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    mark_id: String,
    note: Option<String>,
) -> Result<(), LoomError> {
    let note_clean = note
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    let (story_id, message_id) = access::with_active_conn(&state, |conn| {
        let m = db_marks::get_mark(conn, &mark_id)?
            .ok_or_else(|| LoomError::NotFound(format!("mark {mark_id} not found")))?;
        db_marks::update_note(conn, &mark_id, note_clean.as_deref(), &now_iso())?;
        Ok((m.story_id, m.message_id))
    })?;
    // A note change alters the manifest fed to a re-summary, so it stales the
    // containing closed segment too (Doc 30 §9).
    mark_segment_stale_for_message(&app, &state, &message_id)?;
    emit_marks_changed(&app, &story_id, Some(&message_id));
    Ok(())
}

/// Re-evaluate a message's marks after an in-place content mutation and emit
/// `marks_changed` if anything changed (Doc 30 §8). Called by the conversation
/// and ghostwriter edit paths — `pub(crate)` so sibling command modules reach it.
pub(crate) fn reeval_marks_for_message(
    app: &tauri::AppHandle,
    state: &AppState,
    message_id: &str,
) -> Result<(), LoomError> {
    let story_id = access::with_active_conn(state, |conn| {
        if !marks_service::reevaluate_for_message(conn, message_id)? {
            return Ok(None);
        }
        Ok(get_message(conn, message_id)?.map(|m| m.story_id))
    })?;
    if let Some(story_id) = story_id {
        emit_marks_changed(app, &story_id, Some(message_id));
    }
    Ok(())
}
