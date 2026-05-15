//! Ghostwriter Tauri commands (Doc 17 §Backend API, Doc 07 §ghostwriter).
//!
//! Four commands: build + dispatch a surgical-stitching call; cancel the
//! in-flight request; persist an accepted edit (content + history append in a
//! single transaction); revert the most-recent accepted edit.
//!
//! Cache + accordion staling matches the precedent set by `commands/conversation.rs`
//! `update_message_content`: story-kind ghostwriter edits mark the story cache
//! stale and silently mark the containing accordion segment stale. Session-kind
//! ghostwriter edits target session messages which never live in a story or
//! consulting-snapshot cache, so the same helpers are safe no-ops on them.

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};
use ts_rs::TS;

use crate::db::cache_state as db_cache;
use crate::db::messages::get_message;
use crate::error::LoomError;
use crate::services::cache as cache_service;
use crate::services::gemini::{self, GenerationParams};
use crate::services::ghostwriter::{self as gw, GhostwriterAssembleInputs, GhostwriterEdit};
use crate::services::settings::resolve;
use crate::services::settings_keys::AppSettingKey;
use crate::state::access;
use crate::state::AppState;

// --- IPC payload types -------------------------------------------------------

/// Returned by `send_ghostwriter_request`. The frontend stitches per Doc 17
/// §Response: `new = before + revised_passage.trim() + after`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/lib/types.ts")]
pub struct GhostwriterResponse {
    pub revised_passage: String,
    pub token_count: Option<i64>,
    /// `true` iff the user cancelled mid-flight. When true, `revised_passage`
    /// is empty and the frontend returns the panel to `selecting` silently.
    pub cancelled: bool,
}

/// Returned by `revert_ghostwriter_edit` so the frontend can re-render the
/// bubble and decide whether to keep showing the `[Revert]` action.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/lib/types.ts")]
pub struct RevertResult {
    pub restored_content: String,
    pub remaining_history_len: usize,
}

// --- Stale-event helpers (local to this command file, matching the
// conversation.rs precedent — duplicating ~30 lines beats a cross-command
// `pub(crate)` dependency that obscures ownership). -------------------------

fn emit_cache_state_changed(app: &tauri::AppHandle, state: &AppState, story_id: &str) {
    let status = access::with_active_conn(state, |conn| db_cache::get(conn, story_id));
    let Ok(status) = status else {
        return;
    };
    let _ = app
        .emit(
            "cache_state_changed",
            serde_json::json!({ "story_id": story_id, "status": status }),
        )
        .map_err(|e| warn!("emit cache_state_changed: {e}"));
}

fn emit_accordion_state_changed(app: &tauri::AppHandle, story_id: &str, segment_id: Option<&str>) {
    let _ = app
        .emit(
            "accordion_state_changed",
            serde_json::json!({
                "story_id": story_id,
                "segment_id": segment_id,
                "checkpoint_id": Option::<String>::None,
            }),
        )
        .map_err(|e| warn!("emit accordion_state_changed: {e}"));
}

/// If `message_id` resolves to a story-kind message that sits at-or-before the
/// story cache's high-water mark, mark it stale and emit `cache_state_changed`.
fn mark_story_cache_stale_for_message(
    app: &tauri::AppHandle,
    state: &AppState,
    message_id: &str,
) -> Result<(), LoomError> {
    let story_id = access::with_active_conn(state, |conn| {
        let Some(msg) = get_message(conn, message_id)? else {
            return Ok(None);
        };
        if msg.kind != "story" {
            return Ok(None);
        }
        if !cache_service::is_cached_story_message(conn, &msg.story_id, message_id)? {
            return Ok(None);
        }
        cache_service::mark_story_stale(conn, &msg.story_id)?;
        Ok(Some(msg.story_id))
    })?;
    if let Some(story_id) = story_id {
        emit_cache_state_changed(app, state, &story_id);
    }
    Ok(())
}

/// If `message_id` sits inside a closed accordion segment, mark that segment
/// stale and emit `accordion_state_changed`. No-op for session-kind messages
/// (segments only span story-kind messages, Doc 16).
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
        emit_accordion_state_changed(app, &story_id, Some(&segment_id));
    }
    Ok(())
}

// --- Commands ----------------------------------------------------------------

/// Build the surgical-stitching request, run a non-streaming Gemini call,
/// and return the revised passage. The frontend stitches into the original
/// at the selection offsets and shows the word-level diff.
///
/// Cancellation: shares the global cancel token with story / session sends —
/// `cancel_ghostwriter_generation` signals the same token. On cancel the
/// returned `GhostwriterResponse.cancelled` is `true` and the panel returns
/// to `selecting`.
#[tauri::command]
pub async fn send_ghostwriter_request(
    app: tauri::AppHandle,
    message_id: String,
    selection_start: usize,
    selection_end: usize,
    instruction: String,
) -> Result<GhostwriterResponse, LoomError> {
    let state = app.state::<AppState>();
    let api_key = access::with_api_key(&state, |k| Ok(k.to_owned()))?;

    // Synchronous prep: settings cascade + history assembly + request build.
    // Drop locks before the await.
    let (model_name, request, params) = access::with_two_conns(&state, |app_db, world_db| {
        let model_name: String = resolve(world_db, app_db, AppSettingKey::TextModelName)?;
        let si: String = resolve(world_db, app_db, AppSettingKey::PromptGhostwriter)?;
        let fake_user: String = resolve(world_db, app_db, AppSettingKey::PromptAccordionFakeUser)?;
        let params = GenerationParams {
            temperature: resolve::<f64>(world_db, app_db, AppSettingKey::GenTemperature)?,
            top_p: resolve::<f64>(world_db, app_db, AppSettingKey::GenTopP)?,
            top_k: resolve::<u32>(world_db, app_db, AppSettingKey::GenTopK)?,
            max_output_tokens: resolve::<u32>(world_db, app_db, AppSettingKey::GenMaxOutputTokens)?,
        };
        let out = gw::build_ghostwriter_request(
            world_db,
            GhostwriterAssembleInputs {
                message_id: &message_id,
                selection_start,
                selection_end,
                instruction: &instruction,
                system_instruction: &si,
                fake_user_prompt: &fake_user,
            },
        )?;
        Ok((model_name, out.request, params))
    })?;

    let cancel_token: CancellationToken = access::install_cancel_token(&state)?;
    let outcome =
        gemini::generate_content(&api_key, &model_name, &request, &params, cancel_token).await?;

    if outcome.cancelled {
        info!(message_id = %message_id, "send_ghostwriter_request cancelled");
        return Ok(GhostwriterResponse {
            revised_passage: String::new(),
            token_count: outcome.token_count,
            cancelled: true,
        });
    }

    // Defensive strip: if the model echoed the tag wrappers, peel them off
    // (Doc 17 §Response).
    let mut revised = outcome.full_text.trim().to_owned();
    revised = strip_tag_wrappers(&revised);

    info!(
        message_id = %message_id,
        finish_reason = ?outcome.finish_reason,
        tokens = ?outcome.token_count,
        "send_ghostwriter_request complete"
    );

    Ok(GhostwriterResponse {
        revised_passage: revised,
        token_count: outcome.token_count,
        cancelled: false,
    })
}

/// Strip one wrapping `<selected_passage>…</selected_passage>` envelope if the
/// model echoed it. Tolerant of leading/trailing whitespace inside the tags.
fn strip_tag_wrappers(s: &str) -> String {
    let s = s.trim();
    let open = "<selected_passage>";
    let close = "</selected_passage>";
    if let Some(rest) = s.strip_prefix(open) {
        if let Some(inner) = rest.strip_suffix(close) {
            return inner.trim().to_owned();
        }
    }
    s.to_owned()
}

/// Cancel the in-flight Ghostwriter generation. Idempotent. Shares the global
/// cancellation token, so any story / session / summarise call in flight is
/// equally cancelled — the architecture-wall #6 invariant (one model call in
/// flight at a time) makes the cross-feature reach moot in practice.
#[tauri::command]
pub fn cancel_ghostwriter_generation(state: State<'_, AppState>) -> Result<(), LoomError> {
    access::cancel_current(&state)
}

/// Persist an accepted Ghostwriter edit. Single transaction:
///   1. Read current `ghostwriter_history`.
///   2. Append the entry.
///   3. UPDATE `messages.content`.
///   4. UPDATE `messages.ghostwriter_history`.
/// After commit: mark accordion segment stale (silently) and story cache
/// stale if the message is at-or-before the high-water mark.
#[tauri::command]
pub fn save_ghostwriter_edit(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    message_id: String,
    new_content: String,
    history_entry: GhostwriterEdit,
) -> Result<(), LoomError> {
    access::with_active_conn_mut(&state, |conn| {
        let tx = conn.transaction()?;
        let current: String = tx.query_row(
            "SELECT ghostwriter_history FROM messages WHERE id = ?1",
            rusqlite::params![&message_id],
            |row| row.get(0),
        )?;
        let updated_json = gw::append_history_entry(&current, &history_entry)?;
        let role: String = tx.query_row(
            "SELECT role FROM messages WHERE id = ?1",
            rusqlite::params![&message_id],
            |row| row.get(0),
        )?;
        if role != "model" {
            return Err(LoomError::validation(
                "Ghostwriter only operates on model messages.",
            ));
        }
        tx.execute(
            "UPDATE messages SET content = ?1, ghostwriter_history = ?2 WHERE id = ?3",
            rusqlite::params![&new_content, &updated_json, &message_id],
        )?;
        tx.commit()?;
        Ok(())
    })?;

    mark_segment_stale_for_message(&app, &state, &message_id)?;
    mark_story_cache_stale_for_message(&app, &state, &message_id)?;
    info!(message_id = %message_id, "save_ghostwriter_edit complete");
    Ok(())
}

/// Pop the most-recent Ghostwriter edit. Single transaction:
///   1. Read current `ghostwriter_history`.
///   2. Pop the last entry.
///   3. UPDATE `messages.content` = popped.original_content.
///   4. UPDATE `messages.ghostwriter_history` = truncated.
/// Returns the restored content and the new history length.
#[tauri::command]
pub fn revert_ghostwriter_edit(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    message_id: String,
) -> Result<RevertResult, LoomError> {
    let (restored_content, remaining_history_len) = access::with_active_conn_mut(&state, |conn| {
        let tx = conn.transaction()?;
        let (role, current_json): (String, String) = tx.query_row(
            "SELECT role, ghostwriter_history FROM messages WHERE id = ?1",
            rusqlite::params![&message_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        if role != "model" {
            return Err(LoomError::validation(
                "Ghostwriter only operates on model messages.",
            ));
        }
        let (popped, truncated_json, remaining) = gw::pop_history_entry(&current_json)?;
        tx.execute(
            "UPDATE messages SET content = ?1, ghostwriter_history = ?2 WHERE id = ?3",
            rusqlite::params![&popped.original_content, &truncated_json, &message_id],
        )?;
        tx.commit()?;
        Ok((popped.original_content, remaining))
    })?;

    mark_segment_stale_for_message(&app, &state, &message_id)?;
    mark_story_cache_stale_for_message(&app, &state, &message_id)?;
    info!(
        message_id = %message_id,
        remaining = %remaining_history_len,
        "revert_ghostwriter_edit complete"
    );
    Ok(RevertResult {
        restored_content,
        remaining_history_len,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_tag_wrappers_with_wrappers() {
        let s = "<selected_passage>hello there</selected_passage>";
        assert_eq!(strip_tag_wrappers(s), "hello there");
    }

    #[test]
    fn strip_tag_wrappers_without_wrappers() {
        let s = "no tags here";
        assert_eq!(strip_tag_wrappers(s), "no tags here");
    }

    #[test]
    fn strip_tag_wrappers_handles_whitespace_inside() {
        let s = "<selected_passage>\n  trimmed  \n</selected_passage>";
        assert_eq!(strip_tag_wrappers(s), "trimmed");
    }

    #[test]
    fn strip_tag_wrappers_only_open_tag_passes_through() {
        let s = "<selected_passage>orphan";
        assert_eq!(strip_tag_wrappers(s), "<selected_passage>orphan");
    }
}
