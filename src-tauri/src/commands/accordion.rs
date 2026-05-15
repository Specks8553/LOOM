//! Accordion Tauri commands (Doc 16 §Backend API, Doc 07 §accordion).
//!
//! Thin handlers — call into `services/accordion.rs`, emit
//! `accordion_state_changed` after every mutation. Mutations that touch a
//! segment overlapping the story's cached prefix also mark the story cache
//! stale (Doc 22 §Accordion) and emit `cache_state_changed`. The
//! `set_segment_collapsed` toggle is UI-only and never marks cache stale.

use serde::Serialize;
use tauri::{Emitter, Manager, State};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use crate::db::accordion::{AccordionState, Checkpoint};
use crate::db::cache_state as db_cache;
use crate::error::LoomError;
use crate::services::accordion as accordion_service;
use crate::services::cache as cache_service;
use crate::services::gemini::{self, GenerationParams};
use crate::services::settings::resolve;
use crate::services::settings_keys::AppSettingKey;
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

/// Mark the story cache stale when the named segment overlaps the cached
/// prefix, and emit `cache_state_changed`. No-op when there's no active cache
/// or the segment doesn't overlap. Errors from the emit are logged but not
/// propagated — the underlying mutation has already succeeded.
fn maybe_mark_cache_stale_for_segment(
    app: &tauri::AppHandle,
    state: &AppState,
    story_id: &str,
    segment_id: &str,
) -> Result<(), LoomError> {
    let did_mark = access::with_active_conn(state, |conn| {
        if cache_service::segment_overlaps_cached_prefix(conn, story_id, segment_id)? {
            cache_service::mark_story_stale(conn, story_id)?;
            Ok(true)
        } else {
            Ok(false)
        }
    })?;
    if did_mark {
        emit_cache_state_changed(app, state, story_id);
    }
    Ok(())
}

/// Cache-stale trigger for create/delete checkpoint: the affected segment(s)
/// are recomputed by the service call, so the simplest correct policy is to
/// stale the story cache whenever there is any active cache for it (a finer-
/// grained check would require pre/post segment diffs that aren't worth the
/// complexity). Doc 22 §Accordion ("split / merge → stale if any side overlaps
/// cached prefix") still holds because the only way split/merge can avoid
/// overlap is when the affected checkpoint sits after the cache high-water —
/// rare enough that the wider invalidation is acceptable.
fn maybe_mark_cache_stale_for_story(
    app: &tauri::AppHandle,
    state: &AppState,
    story_id: &str,
) -> Result<(), LoomError> {
    let did_mark = access::with_active_conn(state, |conn| {
        let status = db_cache::get(conn, story_id)?;
        if status.is_active() {
            cache_service::mark_story_stale(conn, story_id)?;
            Ok(true)
        } else {
            Ok(false)
        }
    })?;
    if did_mark {
        emit_cache_state_changed(app, state, story_id);
    }
    Ok(())
}

fn emit_cache_state_changed(app: &tauri::AppHandle, state: &AppState, story_id: &str) {
    let status = access::with_active_conn(state, |conn| db_cache::get(conn, story_id));
    let Ok(status) = status else {
        return;
    };
    let _ = app.emit(
        "cache_state_changed",
        serde_json::json!({ "story_id": story_id, "status": status }),
    );
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
    maybe_mark_cache_stale_for_story(&app, &state, &story_id)?;
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
    // Rename is display-only — never a cache-stale trigger (Doc 16 §rename_checkpoint).
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
    maybe_mark_cache_stale_for_story(&app, &state, &story_id)?;
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
    maybe_mark_cache_stale_for_segment(&app, &state, &story_id, &segment_id)?;
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
    // UI-only toggle — never a cache-stale trigger (Doc 16 §Toggle "Collapse").
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
    maybe_mark_cache_stale_for_segment(&app, &state, &story_id, &segment_id)?;
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
    maybe_mark_cache_stale_for_segment(&app, &state, &story_id, &segment_id)?;
    emit_accordion_state_changed(&app, &story_id, Some(&segment_id), None)?;
    Ok(())
}

/// Summarise a segment via a non-streaming Gemini call (Doc 16 §Generating a
/// summary). Resolves the `gen_summarise_*` + `prompt_accordion_summarise`
/// cascade, builds the request, installs a fresh cancellation token, and
/// blocks on `generate_content`. On success: writes the summary, clears
/// `is_stale`, stamps `summarised_at`, marks the story cache stale if the
/// segment overlaps the cached prefix, and emits `accordion_state_changed`.
///
/// User cancellation (silent — Doc 16 §Cancellation) returns the previous
/// summary value (`None` if first generation) and leaves segment state
/// unchanged. Rate limiting is not enforced server-side here — the rate
/// limiter module lands later; the frontend's `isGenerating` gate prevents
/// concurrent generations.
#[tauri::command]
pub async fn summarise_segment(
    app: tauri::AppHandle,
    segment_id: String,
) -> Result<Option<String>, LoomError> {
    let state = app.state::<AppState>();
    let api_key = access::with_api_key(&state, |k| Ok(k.to_owned()))?;
    let story_id = segment_story_id(&state, &segment_id)?;

    // Resolve cascade + build request under the lock; release before the await.
    let (model_name, request, params) = access::with_two_conns(&state, |app_db, world_db| {
        let model_name: String = resolve(world_db, app_db, AppSettingKey::TextModelName)?;
        let si: String = resolve(world_db, app_db, AppSettingKey::PromptAccordionSummarise)?;
        let params = GenerationParams {
            temperature: resolve::<f64>(world_db, app_db, AppSettingKey::GenSummariseTemperature)?,
            top_p: resolve::<f64>(world_db, app_db, AppSettingKey::GenSummariseTopP)?,
            top_k: resolve::<u32>(world_db, app_db, AppSettingKey::GenSummariseTopK)?,
            max_output_tokens: resolve::<u32>(
                world_db,
                app_db,
                AppSettingKey::GenSummariseMaxOutputTokens,
            )?,
        };
        let req = accordion_service::build_summarise_request(world_db, &segment_id, &si)?;
        Ok((model_name, req, params))
    })?;

    let cancel_token: CancellationToken = access::install_cancel_token(&state)?;
    let outcome =
        gemini::generate_content(&api_key, &model_name, &request, &params, cancel_token).await?;

    if outcome.cancelled {
        info!(segment_id = %segment_id, "summarise_segment cancelled");
        return Ok(None);
    }
    if outcome.full_text.trim().is_empty() {
        warn!(segment_id = %segment_id, "summarise_segment returned empty text");
    }

    access::with_active_conn(&state, |conn| {
        accordion_service::store_summarise_result(conn, &segment_id, &outcome.full_text)
    })?;
    maybe_mark_cache_stale_for_segment(&app, &state, &story_id, &segment_id)?;
    emit_accordion_state_changed(&app, &story_id, Some(&segment_id), None)?;
    info!(
        segment_id = %segment_id,
        finish_reason = ?outcome.finish_reason,
        tokens = ?outcome.token_count,
        "summarise_segment complete"
    );
    Ok(Some(outcome.full_text))
}
