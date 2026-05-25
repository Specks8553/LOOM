//! Modes Tauri commands (Doc 23 §Backend API, Doc 07 §modes).
//!
//! The nine commands here are an additional surface alongside
//! `commands/conversation.rs` — story-mode sends still go through
//! `send_message` and the `message_*` events. Session sends use
//! `send_session_message` and the `session_message_*` events. The streaming
//! finaliser shape mirrors story mode so the frontend can reuse the same
//! handler structure.

use serde::Serialize;
use tauri::{Emitter, Manager, State};
use tokio_util::sync::CancellationToken;
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::db::cache_state::SessionCacheStatus;
use crate::db::conversation_sessions::{
    delete_session as db_delete_session, get_session, list_sessions_for_story,
    update_session_cache, update_session_collapsed, update_session_name, ConversationSession,
};
use crate::db::messages::{insert_message, list_story_messages, ChatMessage};
use crate::db::settings::{get_story_state, set_story_state};
use crate::error::LoomError;
use crate::services::cache as cache_service;
use crate::services::cache::SessionDivergence;
use crate::services::gemini::{self, ChunkSink, GenerationParams, StreamOutcome, GEMINI_BASE_URL};
use crate::services::history::{self, AssembledRequest, SessionAssembleInputs};
use crate::services::modes::{create_session, CreateSessionInputs, SessionKind};
use crate::services::settings::resolve;
use crate::services::settings_keys::AppSettingKey;
use crate::services::settings_keys::StoryStateKey;
use crate::state::access;
use crate::state::AppState;

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn resolve_params(
    world: &rusqlite::Connection,
    app_db: &rusqlite::Connection,
) -> Result<GenerationParams, LoomError> {
    Ok(GenerationParams {
        temperature: resolve::<f64>(world, app_db, AppSettingKey::GenTemperature)?,
        top_p: resolve::<f64>(world, app_db, AppSettingKey::GenTopP)?,
        top_k: resolve::<u32>(world, app_db, AppSettingKey::GenTopK)?,
        max_output_tokens: resolve::<u32>(world, app_db, AppSettingKey::GenMaxOutputTokens)?,
    })
}

fn require_story(conn: &rusqlite::Connection, story_id: &str) -> Result<(), LoomError> {
    let item = crate::db::vault::get_item(conn, story_id)?
        .ok_or_else(|| LoomError::NotFound(format!("story {story_id} not found")))?;
    if item.item_type != "Story" {
        return Err(LoomError::validation("Sessions require a Story item."));
    }
    if item.deleted_at.is_some() {
        return Err(LoomError::validation("Story is in the trash."));
    }
    Ok(())
}

fn require_session(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> Result<ConversationSession, LoomError> {
    get_session(conn, session_id)?
        .ok_or_else(|| LoomError::NotFound(format!("session {session_id} not found")))
}

fn mode_si_key(kind: SessionKind) -> AppSettingKey {
    match kind {
        SessionKind::Handover => AppSettingKey::HandoverSi,
        SessionKind::Consulting => AppSettingKey::ConsultingSi,
    }
}

// --- IPC payloads -----------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
struct SessionCreatedPayload<'a> {
    session_id: &'a str,
    story_id: &'a str,
    kind: &'a str,
}

#[derive(Debug, Clone, Serialize)]
struct SessionChunkPayload<'a> {
    session_id: &'a str,
    chunk: &'a str,
}

#[derive(Debug, Clone, Serialize)]
struct SessionCompletePayload<'a> {
    session_id: &'a str,
    message_id: &'a str,
    finish_reason: Option<&'a str>,
    token_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
struct SessionCancelledPayload<'a> {
    session_id: &'a str,
    user_message_id: &'a str,
    model_message_id: &'a str,
}

#[derive(Debug, Clone, Serialize)]
struct SessionFailedPayload<'a> {
    session_id: &'a str,
    error_kind: &'a str,
    error_detail: &'a str,
}

#[derive(Debug, Clone, Serialize)]
struct SessionStateChangedPayload<'a> {
    session_id: &'a str,
    status: &'a str,
}

#[derive(Debug, Clone, Serialize)]
struct SessionCacheStateChangedPayload<'a> {
    session_id: &'a str,
    status: &'a SessionCacheStatus,
}

#[derive(Debug, Clone, Serialize)]
struct SessionCacheDivergedPayload<'a> {
    session_id: &'a str,
    divergences: &'a [SessionDivergence],
}

fn emit_session_cache_state_changed(
    app: &tauri::AppHandle,
    session_id: &str,
    status: &SessionCacheStatus,
) {
    let _ = app
        .emit(
            "session_cache_state_changed",
            SessionCacheStateChangedPayload { session_id, status },
        )
        .map_err(|e| warn!("emit session_cache_state_changed: {e}"));
}

/// Build the consulting cache, POST it to Gemini, persist, emit. Best-effort
/// on failures: if the create fails the session row stays cache-less and the
/// next session message falls back to inline assembly. Returns the recorded
/// divergences (if any) so the caller can also emit the warning event.
async fn ensure_consulting_cache(
    app: &tauri::AppHandle,
    state: &AppState,
    api_key: &str,
    session_id: &str,
) -> Result<Vec<SessionDivergence>, LoomError> {
    // 1. Synchronous prep — build the prefix from snapshot, delete any
    //    pre-existing cache fields under one with_two_conns block.
    let session_id_for_closure = session_id.to_string();
    let (prefix, divergences, model, ttl_secs, existing_cache_name) =
        access::with_two_conns(state, |app_db, world_db| {
            let model: String = resolve(world_db, app_db, AppSettingKey::TextModelName)?;
            let ttl_secs: u32 = resolve(world_db, app_db, AppSettingKey::CacheTtlSecs)?;
            let session = get_session(world_db, &session_id_for_closure)?.ok_or_else(|| {
                LoomError::NotFound(format!("session {session_id_for_closure} not found"))
            })?;
            if session.kind != "consulting" {
                return Err(LoomError::validation(format!(
                    "ensure_consulting_cache called on session kind '{}'",
                    session.kind
                )));
            }
            let (prefix, divergences) =
                cache_service::build_session_prefix(world_db, &session_id_for_closure)?;
            Ok((
                prefix,
                divergences,
                model,
                ttl_secs as u64,
                session.cache_name,
            ))
        })?;

    // 2. Best-effort delete of any existing cache (no lock).
    if let Some(name) = existing_cache_name {
        if let Err(e) = cache_service::delete_cache(GEMINI_BASE_URL, api_key, &name).await {
            warn!("ensure_consulting_cache: stale delete failed: {e}");
        }
    }

    // 3. Create new cache.
    let record = match cache_service::create_cache(
        GEMINI_BASE_URL,
        api_key,
        &model,
        &prefix,
        ttl_secs,
    )
    .await
    {
        Ok(r) => r,
        Err(e) => {
            warn!("consulting cache create failed; session will run inline: {e}");
            // Persist NULL fields so retries are predictable.
            let now = now_iso();
            let session_id_owned = session_id.to_string();
            let _ = access::with_active_conn(state, |conn| {
                update_session_cache(conn, &session_id_owned, None, None, false, &now)
            });
            let status = SessionCacheStatus::default();
            emit_session_cache_state_changed(app, session_id, &status);
            return Err(e);
        }
    };

    // 4. Persist + emit.
    let now = now_iso();
    let session_id_owned = session_id.to_string();
    let cache_name = record.cache_name.clone();
    let expire = record.expire_time.clone();
    let now_for_db = now.clone();
    access::with_active_conn(state, |conn| {
        update_session_cache(
            conn,
            &session_id_owned,
            Some(&cache_name),
            Some(&expire),
            false,
            &now_for_db,
        )
    })?;
    let status = SessionCacheStatus {
        cache_name: Some(record.cache_name),
        expiry_at: Some(record.expire_time),
        is_stale: false,
    };
    emit_session_cache_state_changed(app, session_id, &status);

    if !divergences.is_empty() {
        let _ = app
            .emit(
                "session_cache_diverged",
                SessionCacheDivergedPayload {
                    session_id,
                    divergences: &divergences,
                },
            )
            .map_err(|e| warn!("emit session_cache_diverged: {e}"));
    }

    Ok(divergences)
}

// --- Commands ---------------------------------------------------------------

#[tauri::command]
pub fn list_sessions(
    state: State<'_, AppState>,
    story_id: String,
) -> Result<Vec<ConversationSession>, LoomError> {
    access::with_active_conn(&state, |conn| list_sessions_for_story(conn, &story_id))
}

fn start_session_inner(
    state: &AppState,
    story_id: String,
    kind: SessionKind,
) -> Result<ConversationSession, LoomError> {
    let now = now_iso();
    access::with_two_conns(state, |app_db, world_db| {
        require_story(world_db, &story_id)?;
        let si: String = resolve(world_db, app_db, mode_si_key(kind))?;
        // Anchor: the most recent story-kind message, if any.
        let history = list_story_messages(world_db, &story_id)?;
        let entry_message_id: Option<&str> = history.last().map(|m| m.id.as_str());
        let row = create_session(
            world_db,
            CreateSessionInputs {
                story_id: &story_id,
                kind,
                system_instruction: &si,
                entry_message_id,
                now_iso: &now,
            },
        )?;
        Ok(row)
    })
}

#[tauri::command]
pub async fn start_handover_session(
    app: tauri::AppHandle,
    story_id: String,
) -> Result<ConversationSession, LoomError> {
    let state = app.state::<AppState>();
    let row = start_session_inner(&state, story_id.clone(), SessionKind::Handover)?;
    let _ = app
        .emit(
            "session_created",
            SessionCreatedPayload {
                session_id: &row.id,
                story_id: &story_id,
                kind: "handover",
            },
        )
        .map_err(|e| warn!("emit session_created: {e}"));
    Ok(row)
}

#[tauri::command]
pub async fn start_consulting_session(
    app: tauri::AppHandle,
    story_id: String,
) -> Result<ConversationSession, LoomError> {
    let state = app.state::<AppState>();
    let row = start_session_inner(&state, story_id.clone(), SessionKind::Consulting)?;
    let _ = app
        .emit(
            "session_created",
            SessionCreatedPayload {
                session_id: &row.id,
                story_id: &story_id,
                kind: "consulting",
            },
        )
        .map_err(|e| warn!("emit session_created: {e}"));

    // Eagerly create the Gemini cache for this session. Failure is logged
    // and the session falls back to inline; the writer's first send will
    // retry create automatically via the same path.
    if let Ok(api_key) = access::with_api_key(&state, |k| Ok(k.to_owned())) {
        if let Err(e) = ensure_consulting_cache(&app, &state, &api_key, &row.id).await {
            warn!("start_consulting_session: cache create failed: {e}");
        }
    }
    Ok(row)
}

#[tauri::command]
pub async fn enter_session(app: tauri::AppHandle, session_id: String) -> Result<(), LoomError> {
    let state = app.state::<AppState>();
    let kind = access::with_active_conn(&state, |conn| {
        let row = require_session(conn, &session_id)?;
        Ok(row.kind)
    })?;
    if kind == "consulting" {
        if let Ok(api_key) = access::with_api_key(&state, |k| Ok(k.to_owned())) {
            if let Err(e) = ensure_consulting_cache(&app, &state, &api_key, &session_id).await {
                warn!("enter_session: cache rebuild failed: {e}");
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn exit_session(app: tauri::AppHandle, session_id: String) -> Result<(), LoomError> {
    let state = app.state::<AppState>();
    let (kind, cache_name) = access::with_active_conn(&state, |conn| {
        let row = require_session(conn, &session_id)?;
        Ok((row.kind, row.cache_name))
    })?;
    if kind != "consulting" {
        return Ok(());
    }
    if let Some(name) = cache_name {
        if let Ok(api_key) = access::with_api_key(&state, |k| Ok(k.to_owned())) {
            if let Err(e) = cache_service::delete_cache(GEMINI_BASE_URL, &api_key, &name).await {
                warn!("exit_session: best-effort cache delete failed: {e}");
            }
        }
    }
    let now = now_iso();
    let session_id_owned = session_id.clone();
    access::with_active_conn(&state, |conn| {
        update_session_cache(conn, &session_id_owned, None, None, false, &now)
    })?;
    emit_session_cache_state_changed(&app, &session_id, &SessionCacheStatus::default());
    Ok(())
}

/// Payload returned by `send_session_message` — same shape as
/// `SendMessageResult` from `commands/conversation.rs` so the frontend can
/// reuse the pairing logic.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[ts(export, export_to = "../../src/lib/types.generated.ts")]
pub struct SendSessionMessageResult {
    pub user_message_id: String,
    pub model_message_id: String,
}

#[tauri::command]
pub async fn send_session_message(
    app: tauri::AppHandle,
    session_id: String,
    text: String,
) -> Result<SendSessionMessageResult, LoomError> {
    let state = app.state::<AppState>();
    let api_key = access::with_api_key(&state, |k| Ok(k.to_owned()))?;

    let user_id = Uuid::new_v4().to_string();
    let model_id = Uuid::new_v4().to_string();
    let user_id_for_closure = user_id.clone();
    let model_id_for_closure = model_id.clone();
    let session_id_for_closure = session_id.clone();
    let text_for_closure = text.clone();

    let (kind, model_name, mut request, params, cache_name, cache_ttl_secs) =
        access::with_two_conns(&state, |app_db, world_db| {
            let session = require_session(world_db, &session_id_for_closure)?;
            let kind = match session.kind.as_str() {
                "handover" => SessionKind::Handover,
                "consulting" => SessionKind::Consulting,
                other => {
                    return Err(LoomError::Internal(format!(
                        "session {} has unknown kind '{}'",
                        session_id_for_closure, other
                    )))
                }
            };

            let user_msg = ChatMessage {
                id: user_id_for_closure,
                story_id: session.story_id.clone(),
                session_id: Some(session_id_for_closure.clone()),
                role: "user".into(),
                content_type: "text".into(),
                content: text_for_closure.clone(),
                token_count: None,
                model_name: None,
                finish_reason: None,
                created_at: now_iso(),
                deleted_at: None,
                user_feedback: None,
                ghostwriter_history: "[]".into(),
                kind: session.kind.clone(),
            };
            insert_message(world_db, &user_msg)?;

            let model_name: String = resolve(world_db, app_db, AppSettingKey::TextModelName)?;
            let si: String = resolve(world_db, app_db, mode_si_key(kind))?;
            let fake_user_prompt: String =
                resolve(world_db, app_db, AppSettingKey::PromptAccordionFakeUser)?;
            let params = resolve_params(world_db, app_db)?;
            let mut request = history::assemble_session_request(
                world_db,
                SessionAssembleInputs {
                    session_id: &session_id_for_closure,
                    user_text: &text_for_closure,
                    system_instruction: &si,
                    fake_user_prompt: &fake_user_prompt,
                },
            )?;

            let model_msg = ChatMessage {
                id: model_id_for_closure,
                story_id: session.story_id.clone(),
                session_id: Some(session_id_for_closure.clone()),
                role: "model".into(),
                content_type: "text".into(),
                content: String::new(),
                token_count: None,
                model_name: Some(model_name.clone()),
                finish_reason: None,
                created_at: now_iso(),
                deleted_at: None,
                user_feedback: None,
                ghostwriter_history: "[]".into(),
                kind: session.kind.clone(),
            };
            insert_message(world_db, &model_msg)?;

            // Decide cached vs inline. Consulting only — handover never caches.
            let now = chrono::Utc::now().to_rfc3339();
            let cache_active = kind == SessionKind::Consulting
                && session.cache_name.is_some()
                && !session.cache_is_stale
                && session
                    .cache_expiry_at
                    .as_deref()
                    .map(|e| e > now.as_str())
                    .unwrap_or(false);
            // D-21: when this turn won't ride a cache (handover never caches;
            // consulting without a live cache), source documents must be
            // delivered inline — prepend them as the leading "fake cache".
            if !cache_active {
                let doc_pairs = cache_service::build_doc_pairs(world_db, &session.story_id)?;
                if !doc_pairs.is_empty() {
                    let mut prefixed = doc_pairs;
                    prefixed.append(&mut request.contents);
                    request.contents = prefixed;
                }
            }

            let cache_name = if cache_active {
                session.cache_name
            } else {
                None
            };
            let cache_ttl_secs: u32 = resolve(world_db, app_db, AppSettingKey::CacheTtlSecs)?;

            Ok((
                kind,
                model_name,
                request,
                params,
                cache_name,
                cache_ttl_secs as u64,
            ))
        })?;
    let _ = kind; // routing decided above; kind retained for later (gen-param-by-mode).

    // When riding an active cache, replace the inline request with a
    // cache-bound one carrying only the new user turn (the cached prefix
    // covers SI + story-up-to-entry + session-history-pre-edit).
    let refresh_cache_name = if let Some(name) = cache_name.as_ref() {
        let last_turn = request.contents.last().cloned();
        request = AssembledRequest {
            system_instruction: String::new(),
            contents: last_turn.map(|c| vec![c]).unwrap_or_default(),
            cached_content_name: Some(name.clone()),
        };
        Some(name.clone())
    } else {
        None
    };

    let cancel_token = access::try_install_cancel_token(&state)?;
    let user_message_id = user_id;
    let model_message_id = model_id;

    info!(
        session_id = %session_id,
        user_message_id = %user_message_id,
        model_message_id = %model_message_id,
        "send_session_message: streaming"
    );

    let task_app = app.clone();
    let task_session_id = session_id.clone();
    let task_user_id = user_message_id.clone();
    let task_model_id = model_message_id.clone();
    tokio::spawn(async move {
        run_session_stream(
            task_app,
            task_session_id,
            task_user_id,
            task_model_id,
            api_key,
            model_name,
            request,
            params,
            cancel_token,
            refresh_cache_name,
            cache_ttl_secs,
        )
        .await
    });

    Ok(SendSessionMessageResult {
        user_message_id,
        model_message_id,
    })
}

#[allow(clippy::too_many_arguments)]
async fn run_session_stream(
    app: tauri::AppHandle,
    session_id: String,
    user_message_id: String,
    model_message_id: String,
    api_key: String,
    model: String,
    request: AssembledRequest,
    params: GenerationParams,
    cancel_token: CancellationToken,
    refresh_cache_name: Option<String>,
    cache_ttl_secs: u64,
) {
    struct EventSink<'a> {
        app: &'a tauri::AppHandle,
        session_id: &'a str,
    }
    impl ChunkSink for EventSink<'_> {
        fn on_chunk(&mut self, chunk: &str) -> Result<(), LoomError> {
            self.app
                .emit(
                    "session_message_chunk",
                    SessionChunkPayload {
                        session_id: self.session_id,
                        chunk,
                    },
                )
                .map_err(|e| LoomError::Internal(format!("emit session_message_chunk: {e}")))?;
            Ok(())
        }
    }

    let mut sink = EventSink {
        app: &app,
        session_id: &session_id,
    };

    let stream_result = gemini::stream_generate_with_url(
        GEMINI_BASE_URL,
        &api_key,
        &model,
        &request,
        &params,
        &mut sink,
        cancel_token,
    )
    .await;

    let state = app.state::<AppState>();

    match stream_result {
        Ok(outcome) if outcome.cancelled => finalise_cancelled(
            &app,
            &state,
            &session_id,
            &user_message_id,
            &model_message_id,
            &model,
            outcome,
        ),
        Ok(outcome) => {
            let finished_clean = outcome
                .finish_reason
                .as_deref()
                .map(|r| r == "STOP")
                .unwrap_or(true);
            finalise_complete(
                &app,
                &state,
                &session_id,
                &model_message_id,
                &model,
                outcome,
            );
            if finished_clean {
                if let Some(name) = refresh_cache_name {
                    let task_app = app.clone();
                    let task_session_id = session_id.clone();
                    let task_api_key = api_key.clone();
                    tokio::spawn(async move {
                        spawn_session_cache_refresh(
                            task_app,
                            task_session_id,
                            task_api_key,
                            name,
                            cache_ttl_secs,
                        )
                        .await;
                    });
                }
            }
        }
        Err(e) => finalise_failed(
            &app,
            &state,
            &session_id,
            &user_message_id,
            &model_message_id,
            e,
        ),
    }

    // Release the in-flight slot for the next generation (CQ-03).
    let _ = access::clear_cancel_token(&state);
}

async fn spawn_session_cache_refresh(
    app: tauri::AppHandle,
    session_id: String,
    api_key: String,
    cache_name: String,
    ttl_secs: u64,
) {
    match cache_service::refresh_cache_ttl(GEMINI_BASE_URL, &api_key, &cache_name, ttl_secs).await {
        Ok(new_expiry) => {
            let now = now_iso();
            let session_id_for_db = session_id.clone();
            let new_expiry_for_db = new_expiry.clone();
            let state = app.state::<AppState>();
            let _ = access::with_active_conn(&state, |conn| {
                update_session_cache(
                    conn,
                    &session_id_for_db,
                    Some(&cache_name),
                    Some(&new_expiry_for_db),
                    false,
                    &now,
                )
            });
            let status = SessionCacheStatus {
                cache_name: Some(cache_name),
                expiry_at: Some(new_expiry),
                is_stale: false,
            };
            emit_session_cache_state_changed(&app, &session_id, &status);
        }
        Err(e) => warn!("session cache TTL refresh failed: {e}"),
    }
}

fn finalise_complete(
    app: &tauri::AppHandle,
    state: &AppState,
    session_id: &str,
    model_message_id: &str,
    model: &str,
    outcome: StreamOutcome,
) {
    let finish = outcome
        .finish_reason
        .clone()
        .unwrap_or_else(|| "STOP".into());
    let _ = access::with_active_conn(state, |conn| {
        crate::db::messages::update_message_content(
            conn,
            model_message_id,
            &outcome.full_text,
            outcome.token_count,
            Some(model),
            Some(&finish),
        )
    })
    .map_err(|e| warn!("session finalise_complete persist failed: {e}"));

    let _ = app
        .emit(
            "session_message_complete",
            SessionCompletePayload {
                session_id,
                message_id: model_message_id,
                finish_reason: outcome.finish_reason.as_deref(),
                token_count: outcome.token_count,
            },
        )
        .map_err(|e| warn!("emit session_message_complete: {e}"));
}

fn finalise_cancelled(
    app: &tauri::AppHandle,
    state: &AppState,
    session_id: &str,
    user_message_id: &str,
    model_message_id: &str,
    model: &str,
    outcome: StreamOutcome,
) {
    let _ = access::with_active_conn(state, |conn| {
        crate::db::messages::update_message_content(
            conn,
            model_message_id,
            &outcome.full_text,
            outcome.token_count,
            Some(model),
            Some("ERROR"),
        )
    });
    let _ = app
        .emit(
            "session_generation_cancelled",
            SessionCancelledPayload {
                session_id,
                user_message_id,
                model_message_id,
            },
        )
        .map_err(|e| warn!("emit session_generation_cancelled: {e}"));
}

fn finalise_failed(
    app: &tauri::AppHandle,
    state: &AppState,
    session_id: &str,
    user_message_id: &str,
    model_message_id: &str,
    err: LoomError,
) {
    // Mirror story-mode behaviour (Doc 15 §Bubble Lifecycle): hard-delete
    // both rows on HTTP / internal failure so the optimistic UI retracts
    // cleanly.
    let _ = access::with_active_conn(state, |conn| {
        conn.execute(
            "DELETE FROM messages WHERE id IN (?1, ?2)",
            rusqlite::params![user_message_id, model_message_id],
        )?;
        Ok::<(), LoomError>(())
    });

    let kind = match &err {
        LoomError::ApiError(_) => "api_error",
        LoomError::RateLimited(_) => "rate_limited",
        LoomError::Validation { .. } => "validation",
        _ => "internal",
    };
    let detail = err.to_string();
    let _ = app
        .emit(
            "session_generation_failed",
            SessionFailedPayload {
                session_id,
                error_kind: kind,
                error_detail: &detail,
            },
        )
        .map_err(|e| warn!("emit session_generation_failed: {e}"));
}

#[tauri::command]
pub fn cancel_session_generation(state: State<'_, AppState>) -> Result<(), LoomError> {
    debug!("cancel_session_generation");
    access::cancel_current(&state)
}

#[tauri::command]
pub fn rename_session(
    app: tauri::AppHandle,
    session_id: String,
    name: String,
) -> Result<(), LoomError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(LoomError::validation("Session name cannot be empty."));
    }
    let state = app.state::<AppState>();
    access::with_active_conn(&state, |conn| {
        update_session_name(conn, &session_id, trimmed, &now_iso())
    })?;
    let _ = app
        .emit(
            "session_state_changed",
            SessionStateChangedPayload {
                session_id: &session_id,
                status: "renamed",
            },
        )
        .map_err(|e| warn!("emit session_state_changed (rename): {e}"));
    Ok(())
}

#[tauri::command]
pub fn delete_session(app: tauri::AppHandle, session_id: String) -> Result<(), LoomError> {
    let state = app.state::<AppState>();
    access::with_active_conn(&state, |conn| db_delete_session(conn, &session_id))?;
    let _ = app
        .emit(
            "session_state_changed",
            SessionStateChangedPayload {
                session_id: &session_id,
                status: "deleted",
            },
        )
        .map_err(|e| warn!("emit session_state_changed (delete): {e}"));
    Ok(())
}

/// Per-story active-mode state (Doc 23 §Re-opening, §Data Requirements;
/// persisted in `story_state` via the typed `StoryStateKey::ActiveMode` /
/// `ActiveSessionId` accessors). The frontend writes via
/// `set_story_active_mode` from `modeStore` actions and reads via
/// `get_story_active_mode` on story open.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[ts(export, export_to = "../../src/lib/types.generated.ts")]
pub struct StoryActiveMode {
    pub active_mode: String,
    pub active_session_id: Option<String>,
}

#[tauri::command]
pub fn get_story_active_mode(
    state: State<'_, AppState>,
    story_id: String,
) -> Result<StoryActiveMode, LoomError> {
    access::with_active_conn(&state, |conn| {
        let active_mode: String = get_story_state(conn, &story_id, StoryStateKey::ActiveMode)?;
        let raw_session: String = get_story_state(conn, &story_id, StoryStateKey::ActiveSessionId)?;
        let active_session_id = if raw_session.is_empty() {
            None
        } else {
            Some(raw_session)
        };
        Ok(StoryActiveMode {
            active_mode,
            active_session_id,
        })
    })
}

#[tauri::command]
pub fn set_story_active_mode(
    state: State<'_, AppState>,
    story_id: String,
    active_mode: String,
    active_session_id: Option<String>,
) -> Result<(), LoomError> {
    match active_mode.as_str() {
        "story" | "handover" | "consulting" => {}
        other => {
            return Err(LoomError::validation(format!(
                "invalid active_mode '{other}'"
            )))
        }
    }
    access::with_active_conn(&state, |conn| {
        set_story_state(conn, &story_id, StoryStateKey::ActiveMode, &active_mode)?;
        let raw = active_session_id.as_deref().unwrap_or("");
        set_story_state(conn, &story_id, StoryStateKey::ActiveSessionId, raw)?;
        Ok(())
    })
}

#[tauri::command]
pub fn set_session_collapsed(
    app: tauri::AppHandle,
    session_id: String,
    collapsed: bool,
) -> Result<(), LoomError> {
    let state = app.state::<AppState>();
    access::with_active_conn(&state, |conn| {
        update_session_collapsed(conn, &session_id, collapsed, &now_iso())
    })?;
    let _ = app
        .emit(
            "session_state_changed",
            SessionStateChangedPayload {
                session_id: &session_id,
                status: if collapsed { "collapsed" } else { "expanded" },
            },
        )
        .map_err(|e| warn!("emit session_state_changed (collapsed): {e}"));
    Ok(())
}
