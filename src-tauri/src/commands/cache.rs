//! Context cache Tauri commands (Doc 22 §Backend API, Doc 07 §cache).
//!
//! Thin handlers — call into `services/cache.rs` and `db/cache_state.rs`,
//! emit `cache_state_changed` after every mutation. Phase 6A wires the
//! story-cache surface; the consulting-cache commands land in 6C.

use serde::Serialize;
use tauri::{Emitter, Manager, State};
use tracing::{info, warn};

use crate::db::cache_state as db_cache;
use crate::db::cache_state::{CacheStatus, SessionCacheStatus};
use crate::error::LoomError;
use crate::services::cache::{self as cache_service, AliveCacheRow};
use crate::services::settings::resolve;
use crate::services::settings_keys::AppSettingKey;
use crate::state::access;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
struct CacheStateChangedPayload<'a> {
    story_id: &'a str,
    status: &'a CacheStatus,
}

fn emit_cache_state_changed(
    app: &tauri::AppHandle,
    story_id: &str,
    status: &CacheStatus,
) -> Result<(), LoomError> {
    app.emit(
        "cache_state_changed",
        CacheStateChangedPayload { story_id, status },
    )
    .map_err(|e| LoomError::Internal(format!("emit cache_state_changed failed: {e}")))
}

/// Read the current story-cache state. Returns `CacheStatus::empty()` when
/// no row exists (so the frontend renders a placeholder, not an error).
#[tauri::command]
pub fn get_cache_state(
    state: State<'_, AppState>,
    story_id: String,
) -> Result<CacheStatus, LoomError> {
    access::with_active_conn(&state, |conn| db_cache::get(conn, &story_id))
}

/// Manual create / recreate. Best-effort `DELETE` of any existing cache,
/// then `POST cachedContents`, then upsert the row and emit.
#[tauri::command]
pub async fn create_story_cache(
    app: tauri::AppHandle,
    story_id: String,
) -> Result<CacheStatus, LoomError> {
    let state = app.state::<AppState>();
    let api_key = access::with_api_key(&state, |k| Ok(k.to_owned()))?;

    // 1. Resolve TTL + model under locks; build the prefix.
    let story_id_for_closure = story_id.clone();
    let (model, ttl_secs, prefix, existing_cache_name) =
        access::with_two_conns(&state, |app_db, world_db| {
            let model: String = resolve(world_db, app_db, AppSettingKey::TextModelName)?;
            let ttl_secs: u32 = resolve(world_db, app_db, AppSettingKey::CacheTtlSecs)?;
            let prefix = cache_service::build_cache_prefix(
                world_db,
                app_db,
                cache_service::CacheScope::Story(story_id_for_closure.clone()),
                None,
            )?;
            let existing = db_cache::get(world_db, &story_id_for_closure)?;
            Ok((model, ttl_secs as u64, prefix, existing.cache_name))
        })?;

    // 2. Best-effort delete of any existing cache (no lock held).
    if let Some(name) = existing_cache_name {
        if let Err(e) =
            cache_service::delete_cache(crate::services::gemini::GEMINI_BASE_URL, &api_key, &name)
                .await
        {
            warn!("create_story_cache: best-effort delete failed: {e}");
        }
    }

    // 3. Create the new cache.
    let record = cache_service::create_cache(
        crate::services::gemini::GEMINI_BASE_URL,
        &api_key,
        &model,
        &prefix,
        ttl_secs,
    )
    .await?;

    // 4. Persist + emit.
    let now = chrono::Utc::now().to_rfc3339();
    let story_id_after = story_id.clone();
    let prefix_for_persist = prefix.clone();
    let record_for_persist = record.clone();
    let now_for_persist = now.clone();
    let status = access::with_active_conn(&state, |conn| {
        db_cache::upsert_active(
            conn,
            &story_id_after,
            &record_for_persist.cache_name,
            &record_for_persist.expire_time,
            prefix_for_persist.last_cached_message_id.as_deref(),
            record_for_persist.total_token_count,
            &prefix_for_persist.doc_snapshots,
            &now_for_persist,
        )?;
        db_cache::get(conn, &story_id_after)
    })?;
    emit_cache_state_changed(&app, &story_id, &status)?;
    info!(story_id = %story_id, cache_name = %record.cache_name, "create_story_cache: ok");
    Ok(status)
}

/// Best-effort `DELETE` to Gemini, then NULL the local row's cache fields,
/// then emit. Always succeeds locally even if the remote call errors.
#[tauri::command]
pub async fn delete_story_cache(
    app: tauri::AppHandle,
    story_id: String,
) -> Result<CacheStatus, LoomError> {
    let state = app.state::<AppState>();
    let api_key = access::with_api_key(&state, |k| Ok(k.to_owned()))?;

    let cache_name =
        access::with_active_conn(
            &state,
            |conn| Ok(db_cache::get(conn, &story_id)?.cache_name),
        )?;
    if let Some(name) = cache_name {
        if let Err(e) =
            cache_service::delete_cache(crate::services::gemini::GEMINI_BASE_URL, &api_key, &name)
                .await
        {
            warn!("delete_story_cache: best-effort delete failed: {e}");
        }
    }

    let now = chrono::Utc::now().to_rfc3339();
    let story_id_after = story_id.clone();
    let status = access::with_active_conn(&state, |conn| {
        db_cache::clear_active(conn, &story_id_after, &now)?;
        db_cache::get(conn, &story_id_after)
    })?;
    emit_cache_state_changed(&app, &story_id, &status)?;
    Ok(status)
}

/// Right-pane Cache section list. Returns story rows + active
/// consulting-session rows (Doc 22 §View Cache Status).
#[tauri::command]
pub fn list_alive_caches(state: State<'_, AppState>) -> Result<Vec<AliveCacheRow>, LoomError> {
    access::with_active_conn(&state, |conn| {
        let story_rows = db_cache::list_alive_story_rows(conn)?;
        let mut out: Vec<AliveCacheRow> = story_rows
            .into_iter()
            .map(|r| AliveCacheRow {
                story_id: r.story_id,
                story_name: r.story_name,
                session_id: None,
                session_name: None,
                total_tokens: r.total_tokens,
                expiry_at: r.expiry_at,
                is_stale: r.is_stale,
            })
            .collect();
        for r in crate::db::conversation_sessions::list_alive_session_rows(conn)? {
            out.push(AliveCacheRow {
                story_id: r.story_id,
                story_name: r.story_name,
                session_id: Some(r.session_id),
                session_name: Some(r.session_name),
                total_tokens: 0, // Session token total lands when session-cache create stores it (Phase 6C in-progress).
                expiry_at: r.expiry_at,
                is_stale: r.is_stale,
            });
        }
        Ok(out)
    })
}

/// Read the current session-cache state. Returns the cache fields embedded
/// in the session row. NotFound when the session id doesn't resolve.
#[tauri::command]
pub fn get_session_cache_state(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<SessionCacheStatus, LoomError> {
    access::with_active_conn(&state, |conn| {
        let session = crate::db::conversation_sessions::get_session(conn, &session_id)?
            .ok_or_else(|| LoomError::NotFound(format!("session {session_id} not found")))?;
        Ok(SessionCacheStatus {
            cache_name: session.cache_name,
            expiry_at: session.cache_expiry_at,
            is_stale: session.cache_is_stale,
        })
    })
}
