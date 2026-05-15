//! Conversation Tauri commands (Doc 15 §Backend API, Doc 07 §conversation).
//!
//! Eleven commands implement the story-mode round-trip end-to-end (Phase 3).
//! Mode dispatch is hard-coded to `ConversationMode::Story` here; Phase 4
//! will route to handover/consulting via the active mode in `story_state`.
//!
//! Streaming flow:
//!   1. `send_message` validates inputs, persists the user turn + an empty
//!      model placeholder, snapshots resolved settings, installs a fresh
//!      cancellation token, and spawns the stream task.
//!   2. The task drives `services/gemini::stream_generate_with_url`, emitting
//!      `message_chunk` per chunk. On completion / cancellation / failure
//!      it updates the model row and emits `message_complete` /
//!      `generation_cancelled` / `generation_failed`.
//!   3. Backend never holds a `Connection` lock across an `await` — every
//!      DB touch goes through `with_active_conn` and releases immediately.

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};
use tokio_util::sync::CancellationToken;
use tracing::{debug, info, warn};
use ts_rs::TS;
use uuid::Uuid;

use crate::db::cache_state as db_cache;
use crate::db::cache_state::CacheStatus;
use crate::db::messages::{
    self as db_messages, delete_exchange as db_delete_exchange, delete_from as db_delete_from,
    delete_last_story_message, get_message, insert_message, list_all_messages, list_story_messages,
    truncate_story_after, update_message_content as db_update_message_content,
    update_user_feedback as db_update_user_feedback, ChatMessage,
};
use crate::db::settings::{get_story_state, set_story_state};
use crate::error::LoomError;
use crate::services::cache as cache_service;
use crate::services::gemini::{
    self, ChunkSink, GenerationParams, StreamOutcome, TokenEstimate, GEMINI_BASE_URL,
};
use crate::services::history::{
    self, AssembleInputs, AssembledRequest, ConversationMode, UserContent,
};
use crate::services::settings::resolve;
use crate::services::settings_keys::{AppSettingKey, StoryStateKey};
use crate::state::access;
use crate::state::AppState;

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Doc 22 §Stale Triggers — story cache subset. When `message_id` falls at or
/// before `cache_state.last_cached_message_id`, mark the story cache stale and
/// emit `cache_state_changed`. Idempotent and safe when no cache exists.
/// Returns the story_id we touched (so the caller doesn't re-query).
fn mark_story_cache_stale_for_message(
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
        if !cache_service::is_cached_story_message(conn, &msg.story_id, message_id)? {
            return Ok(None);
        }
        cache_service::mark_story_stale(conn, &msg.story_id)?;
        let status = db_cache::get(conn, &msg.story_id)?;
        Ok(Some((msg.story_id, status)))
    })?;
    if let Some((story_id, status)) = result {
        let _ = app.emit(
            "cache_state_changed",
            serde_json::json!({ "story_id": story_id, "status": status }),
        );
    }
    Ok(())
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

/// Read the active aux slot's content from the cascade. Empty string means
/// "no aux injection" — Phase 3's default since aux UI lands in Phase 11.
fn resolve_aux_text(
    world: &rusqlite::Connection,
    app_db: &rusqlite::Connection,
    story_id: &str,
) -> Result<String, LoomError> {
    let active: String = get_story_state(world, story_id, StoryStateKey::ActiveAuxSlot)?;
    let key = match active.as_str() {
        "2" => AppSettingKey::AuxSlot2Content,
        _ => AppSettingKey::AuxSlot1Content,
    };
    resolve::<String>(world, app_db, key)
}

/// Verify the story exists and is a Story-typed item. Returns the story id
/// on success.
fn require_story(conn: &rusqlite::Connection, story_id: &str) -> Result<(), LoomError> {
    let item = crate::db::vault::get_item(conn, story_id)?
        .ok_or_else(|| LoomError::NotFound(format!("story {story_id} not found")))?;
    if item.item_type != "Story" {
        return Err(LoomError::validation("Conversations require a Story item."));
    }
    if item.deleted_at.is_some() {
        return Err(LoomError::validation("Story is in the trash."));
    }
    Ok(())
}

// --- IPC payload types -------------------------------------------------------

/// Returned by `send_message` so the frontend can attach the optimistic user
/// bubble to its persisted id and listen for its model counterpart.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/lib/types.ts")]
pub struct SendMessageResult {
    pub user_message_id: String,
    pub model_message_id: String,
}

#[derive(Debug, Clone, Serialize)]
struct MessageChunkPayload<'a> {
    story_id: &'a str,
    chunk: &'a str,
}

#[derive(Debug, Clone, Serialize)]
struct MessageCompletePayload<'a> {
    story_id: &'a str,
    message_id: &'a str,
    finish_reason: Option<&'a str>,
    token_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
struct GenerationCancelledPayload<'a> {
    story_id: &'a str,
    user_message_id: &'a str,
    model_message_id: &'a str,
}

#[derive(Debug, Clone, Serialize)]
struct GenerationFailedPayload<'a> {
    story_id: &'a str,
    error_kind: &'a str,
    error_detail: &'a str,
}

// --- Commands ----------------------------------------------------------------

#[tauri::command]
pub fn load_messages(
    state: State<'_, AppState>,
    story_id: String,
) -> Result<Vec<ChatMessage>, LoomError> {
    access::with_active_conn(&state, |conn| list_all_messages(conn, &story_id))
}

#[tauri::command]
pub fn load_story_messages(
    state: State<'_, AppState>,
    story_id: String,
) -> Result<Vec<ChatMessage>, LoomError> {
    access::with_active_conn(&state, |conn| list_story_messages(conn, &story_id))
}

/// Output of the synchronous prep #1 block — everything the cache decision
/// needs but no Gemini-side state yet.
struct SendPrepRaw {
    model_name: String,
    /// Inline (no-cache) request: SI + docs + history + new turn.
    inline_request: AssembledRequest,
    params: GenerationParams,
    cache_state: CacheStatus,
    /// Cache prefix that excludes the new user turn — used both for the
    /// threshold gate and as the body of a cache-create POST.
    would_be_prefix: cache_service::CachePrefix,
    cache_min_tokens: i64,
    cache_ttl_secs: u64,
}

/// Bundle returned by the synchronous prep block of `send_message`. The
/// streaming task receives only by-value fields so no AppState locks are
/// held across awaits.
struct SendPrep {
    model_name: String,
    request: AssembledRequest,
    params: GenerationParams,
    /// Active cache name to refresh on a successful STOP, if any.
    refresh_cache_name: Option<String>,
    /// TTL to use when refreshing.
    cache_ttl_secs: u64,
}

#[derive(Debug, Clone, Serialize)]
struct CacheUnavailablePayload<'a> {
    story_id: &'a str,
    reason: &'a str,
}

/// Decide whether this send rides an existing cache, creates a new one, or
/// goes inline. Doc 22 §Auto-rebuild on Expiry. May issue a Gemini POST
/// (cache create) — runs without holding any AppState lock.
async fn decide_cache_path(
    app: &tauri::AppHandle,
    state: &AppState,
    api_key: &str,
    story_id: &str,
    raw: SendPrepRaw,
) -> Result<SendPrep, LoomError> {
    let SendPrepRaw {
        model_name,
        inline_request,
        params,
        cache_state,
        would_be_prefix,
        cache_min_tokens,
        cache_ttl_secs,
    } = raw;

    let now = chrono::Utc::now().to_rfc3339();
    let cache_active = cache_state.cache_name.is_some()
        && !cache_state.is_stale
        && cache_state
            .expiry_at
            .as_deref()
            .map(|e| e > now.as_str())
            .unwrap_or(false);

    if cache_active {
        let name = cache_state.cache_name.clone().unwrap();
        let request = build_cached_request(&inline_request, name.clone());
        return Ok(SendPrep {
            model_name,
            request,
            params,
            refresh_cache_name: Some(name),
            cache_ttl_secs,
        });
    }

    let estimated = cache_service::estimate_prefix_tokens(&would_be_prefix);
    let needs_rebuild = cache_state.cache_name.is_some()
        && (cache_state.is_stale
            || cache_state
                .expiry_at
                .as_deref()
                .map(|e| e <= now.as_str())
                .unwrap_or(true));

    if estimated < cache_min_tokens {
        // Sub-threshold → inline. Best-effort delete any stale/expired cache
        // so the row matches reality.
        if needs_rebuild {
            if let Some(stale) = cache_state.cache_name.as_deref() {
                if let Err(e) = cache_service::delete_cache(GEMINI_BASE_URL, api_key, stale).await {
                    warn!("decide_cache_path: stale cache delete failed: {e}");
                }
                let now2 = chrono::Utc::now().to_rfc3339();
                let story_id_owned = story_id.to_string();
                let _ = access::with_active_conn(state, |conn| {
                    db_cache::clear_active(conn, &story_id_owned, &now2)
                });
                let _ = app.emit(
                    "cache_state_changed",
                    serde_json::json!({
                        "story_id": story_id,
                        "status": db_cache::CacheStatus::empty(),
                    }),
                );
            }
        }
        return Ok(SendPrep {
            model_name,
            request: inline_request,
            params,
            refresh_cache_name: None,
            cache_ttl_secs,
        });
    }

    // Threshold met. Best-effort delete any stale/expired cache, then create.
    if needs_rebuild {
        if let Some(stale) = cache_state.cache_name.as_deref() {
            if let Err(e) = cache_service::delete_cache(GEMINI_BASE_URL, api_key, stale).await {
                warn!("decide_cache_path: stale cache delete failed: {e}");
            }
        }
    }

    match cache_service::create_cache(
        GEMINI_BASE_URL,
        api_key,
        &model_name,
        &would_be_prefix,
        cache_ttl_secs,
    )
    .await
    {
        Ok(record) => {
            let now = chrono::Utc::now().to_rfc3339();
            let story_id_owned = story_id.to_string();
            let prefix_for_persist = would_be_prefix.clone();
            let record_for_persist = record.clone();
            let now_for_persist = now.clone();
            let status = access::with_active_conn(state, |conn| {
                db_cache::upsert_active(
                    conn,
                    &story_id_owned,
                    &record_for_persist.cache_name,
                    &record_for_persist.expire_time,
                    prefix_for_persist.last_cached_message_id.as_deref(),
                    record_for_persist.total_token_count,
                    &prefix_for_persist.doc_snapshots,
                    &now_for_persist,
                )?;
                db_cache::get(conn, &story_id_owned)
            })?;
            let _ = app.emit(
                "cache_state_changed",
                serde_json::json!({ "story_id": story_id, "status": status }),
            );
            let request = build_cached_request(&inline_request, record.cache_name.clone());
            Ok(SendPrep {
                model_name,
                request,
                params,
                refresh_cache_name: Some(record.cache_name),
                cache_ttl_secs,
            })
        }
        Err(e) => {
            warn!("cache create failed; sending inline: {e}");
            let _ = app.emit(
                "cache_unavailable",
                CacheUnavailablePayload {
                    story_id,
                    reason: "create_failed",
                },
            );
            Ok(SendPrep {
                model_name,
                request: inline_request,
                params,
                refresh_cache_name: None,
                cache_ttl_secs,
            })
        }
    }
}

/// Build the cached-mode send body. The cache contains SI + docs + all
/// history-up-to-prior-model; the request only carries the new user turn
/// (which is the last entry of the inline request).
fn build_cached_request(inline: &AssembledRequest, cache_name: String) -> AssembledRequest {
    let last_turn = inline.contents.last().cloned();
    AssembledRequest {
        // SI lives in the cache; clear it locally so the body builder skips it.
        system_instruction: String::new(),
        contents: last_turn.map(|c| vec![c]).unwrap_or_default(),
        cached_content_name: Some(cache_name),
    }
}

#[tauri::command]
pub async fn send_message(
    app: tauri::AppHandle,
    story_id: String,
    draft: UserContent,
) -> Result<SendMessageResult, LoomError> {
    let state = app.state::<AppState>();
    let api_key = access::with_api_key(&state, |k| Ok(k.to_owned()))?;

    let user_id = Uuid::new_v4().to_string();
    let model_id = Uuid::new_v4().to_string();
    let story_id_for_closure = story_id.clone();
    let user_id_for_closure = user_id.clone();
    let model_id_for_closure = model_id.clone();
    let draft_for_closure = draft.clone();

    // 1. Synchronous prep #1 (under locks): validate, capture prior tail,
    //    persist user msg, build inline request, decide whether to attempt
    //    cache create, capture would-be cache prefix.
    let prep_in = access::with_two_conns(&state, |app_db, world_db| {
        require_story(world_db, &story_id_for_closure)?;

        // Capture the high-water mark before inserting the new user msg. The
        // cache prefix excludes the new turn (it's appended live by Gemini).
        let prior_tail_id: Option<String> = list_story_messages(world_db, &story_id_for_closure)?
            .last()
            .map(|m| m.id.clone());

        let user_content_json = serde_json::to_string(&draft_for_closure)?;
        let user_msg = ChatMessage {
            id: user_id_for_closure,
            story_id: story_id_for_closure.clone(),
            session_id: None,
            role: "user".into(),
            content_type: "json_user".into(),
            content: user_content_json,
            token_count: None,
            model_name: None,
            finish_reason: None,
            created_at: now_iso(),
            deleted_at: None,
            user_feedback: None,
            ghostwriter_history: "[]".into(),
            kind: "story".into(),
        };
        insert_message(world_db, &user_msg)?;

        let model_name: String = resolve(world_db, app_db, AppSettingKey::TextModelName)?;
        let system_instruction: String = resolve(world_db, app_db, AppSettingKey::StorySi)?;
        let aux_text = resolve_aux_text(world_db, app_db, &story_id_for_closure)?;
        let fake_user_prompt: String =
            resolve(world_db, app_db, AppSettingKey::PromptAccordionFakeUser)?;
        let params = resolve_params(world_db, app_db)?;
        let inline_request = history::assemble_request(
            world_db,
            ConversationMode::Story,
            AssembleInputs {
                story_id: &story_id_for_closure,
                draft: &draft_for_closure,
                system_instruction: &system_instruction,
                aux_text: &aux_text,
                fake_user_prompt: &fake_user_prompt,
            },
        )?;

        let cache_state = db_cache::get(world_db, &story_id_for_closure)?;
        let cache_min_tokens: i64 =
            resolve::<u32>(world_db, app_db, AppSettingKey::CacheMinTokens)? as i64;
        let cache_ttl_secs: u32 = resolve(world_db, app_db, AppSettingKey::CacheTtlSecs)?;

        // Build the would-be cache prefix only when needed (no active fresh
        // cache or a fresh cache exists but we still want the prefix-hash for
        // potential rebuild). We compute it unconditionally — it's cheap.
        let would_be_prefix = cache_service::build_cache_prefix(
            world_db,
            app_db,
            cache_service::CacheScope::Story(story_id_for_closure.clone()),
            prior_tail_id.as_deref(),
        )?;

        let model_msg = ChatMessage {
            id: model_id_for_closure,
            story_id: story_id_for_closure.clone(),
            session_id: None,
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
            kind: "story".into(),
        };
        insert_message(world_db, &model_msg)?;

        Ok(SendPrepRaw {
            model_name,
            inline_request,
            params,
            cache_state,
            would_be_prefix,
            cache_min_tokens,
            cache_ttl_secs: cache_ttl_secs as u64,
        })
    })?;

    // 2. Decide cache path (no locks held — may issue a Gemini POST).
    let SendPrep {
        model_name,
        request,
        params,
        refresh_cache_name,
        cache_ttl_secs,
    } = decide_cache_path(&app, &state, &api_key, &story_id, prep_in).await?;

    let cancel_token = access::install_cancel_token(&state)?;
    let user_message_id = user_id;
    let model_message_id = model_id;

    info!(
        story_id = %story_id,
        user_message_id = %user_message_id,
        model_message_id = %model_message_id,
        "send_message: streaming"
    );

    // 3. Spawn the stream task; return the ids immediately.
    let task_app = app.clone();
    let task_story_id = story_id.clone();
    let task_user_id = user_message_id.clone();
    let task_model_id = model_message_id.clone();
    tokio::spawn(async move {
        run_stream(
            task_app,
            task_story_id,
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

    Ok(SendMessageResult {
        user_message_id,
        model_message_id,
    })
}

/// Spawned streaming worker. Owns its inputs by value — no AppState locks
/// held across awaits.
#[allow(clippy::too_many_arguments)]
async fn run_stream(
    app: tauri::AppHandle,
    story_id: String,
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
        story_id: &'a str,
    }
    impl ChunkSink for EventSink<'_> {
        fn on_chunk(&mut self, chunk: &str) -> Result<(), LoomError> {
            self.app
                .emit(
                    "message_chunk",
                    MessageChunkPayload {
                        story_id: self.story_id,
                        chunk,
                    },
                )
                .map_err(|e| LoomError::Internal(format!("emit message_chunk: {e}")))?;
            Ok(())
        }
    }

    let mut sink = EventSink {
        app: &app,
        story_id: &story_id,
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
            &story_id,
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
            finalise_complete(&app, &state, &story_id, &model_message_id, &model, outcome);
            // Fire-and-forget TTL refresh after a clean STOP, per Doc 22.
            // Errors are logged; the cache continues until TTL expires.
            if finished_clean {
                if let Some(name) = refresh_cache_name {
                    let task_app = app.clone();
                    let task_story_id = story_id.clone();
                    let task_api_key = api_key.clone();
                    tokio::spawn(async move {
                        spawn_cache_refresh(
                            task_app,
                            task_story_id,
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
            &story_id,
            &user_message_id,
            &model_message_id,
            e,
        ),
    }
}

async fn spawn_cache_refresh(
    app: tauri::AppHandle,
    story_id: String,
    api_key: String,
    cache_name: String,
    ttl_secs: u64,
) {
    match cache_service::refresh_cache_ttl(GEMINI_BASE_URL, &api_key, &cache_name, ttl_secs).await {
        Ok(new_expiry) => {
            let now = now_iso();
            let story_id_for_db = story_id.clone();
            let new_expiry_for_db = new_expiry.clone();
            let state = app.state::<AppState>();
            let status = access::with_active_conn(&state, |conn| {
                let _ = db_cache::refresh_expiry(conn, &story_id_for_db, &new_expiry_for_db, &now)?;
                db_cache::get(conn, &story_id_for_db)
            });
            if let Ok(s) = status {
                let _ = app.emit(
                    "cache_state_changed",
                    serde_json::json!({ "story_id": story_id, "status": s }),
                );
            }
        }
        Err(e) => warn!("cache TTL refresh failed: {e}"),
    }
}

fn finalise_complete(
    app: &tauri::AppHandle,
    state: &AppState,
    story_id: &str,
    model_message_id: &str,
    model: &str,
    outcome: StreamOutcome,
) {
    let finish = outcome
        .finish_reason
        .clone()
        .unwrap_or_else(|| "STOP".into());
    let _ = access::with_active_conn(state, |conn| {
        db_update_message_content(
            conn,
            model_message_id,
            &outcome.full_text,
            outcome.token_count,
            Some(model),
            Some(&finish),
        )
    })
    .map_err(|e| warn!("finalise_complete persist failed: {e}"));

    // Clear the draft only on a clean STOP (Doc 15 §Drafts).
    if finish == "STOP" {
        let _ = access::with_active_conn(state, |conn| {
            set_story_state(conn, story_id, StoryStateKey::Draft, "{}")
        });
    }

    let _ = app
        .emit(
            "message_complete",
            MessageCompletePayload {
                story_id,
                message_id: model_message_id,
                finish_reason: outcome.finish_reason.as_deref(),
                token_count: outcome.token_count,
            },
        )
        .map_err(|e| warn!("emit message_complete: {e}"));
}

fn finalise_cancelled(
    app: &tauri::AppHandle,
    state: &AppState,
    story_id: &str,
    user_message_id: &str,
    model_message_id: &str,
    model: &str,
    outcome: StreamOutcome,
) {
    // Per Doc 15 §Cancellation Taxonomy: backend preserves the partial AI
    // text. The frontend distinguishes "user stop" (issues delete_exchange)
    // from "lock fired" (no cleanup). We mark finish_reason='ERROR' to flag
    // the partial.
    let _ = access::with_active_conn(state, |conn| {
        db_update_message_content(
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
            "generation_cancelled",
            GenerationCancelledPayload {
                story_id,
                user_message_id,
                model_message_id,
            },
        )
        .map_err(|e| warn!("emit generation_cancelled: {e}"));
}

fn finalise_failed(
    app: &tauri::AppHandle,
    state: &AppState,
    story_id: &str,
    user_message_id: &str,
    model_message_id: &str,
    err: LoomError,
) {
    // Per Doc 15 §Bubble Lifecycle, an HTTP error retracts the optimistic
    // user bubble — we drop both rows here so the frontend's local state is
    // the single truth on the failure path.
    let _ = access::with_active_conn(state, |conn| {
        let _ = db_messages::get_message(conn, model_message_id)?;
        // Hard delete both rows; cascade is empty in Phase 3 (no
        // checkpoints/segments) so no extra cleanup needed.
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
            "generation_failed",
            GenerationFailedPayload {
                story_id,
                error_kind: kind,
                error_detail: &detail,
            },
        )
        .map_err(|e| warn!("emit generation_failed: {e}"));
}

#[tauri::command]
pub fn cancel_generation(state: State<'_, AppState>) -> Result<(), LoomError> {
    debug!("cancel_generation");
    access::cancel_current(&state)
}

#[tauri::command]
pub async fn edit_user_message(
    app: tauri::AppHandle,
    message_id: String,
    new_content: UserContent,
) -> Result<SendMessageResult, LoomError> {
    let state = app.state::<AppState>();

    // Truncate everything strictly after this user message in the same
    // transaction, then update the user message itself, then re-trigger
    // generation as if Send had been pressed.
    let story_id = access::with_active_conn(&state, |conn| {
        let pivot = get_message(conn, &message_id)?
            .ok_or_else(|| LoomError::NotFound(format!("message {message_id} not found")))?;
        if pivot.kind != "story" || pivot.role != "user" {
            return Err(LoomError::validation(
                "edit_user_message only applies to story-kind user messages.",
            ));
        }
        Ok(pivot.story_id)
    })?;

    // Stale-mark before truncate (truncate may delete the pivot itself).
    mark_story_cache_stale_for_message(&app, &state, &message_id)?;

    // Truncate (separate call because it needs `&mut Connection` for the
    // transaction). Then rewrite the user content.
    let pivot_id = message_id.clone();
    let new_content_json = serde_json::to_string(&new_content)?;
    access::with_active_conn_mut(&state, |conn| {
        // Pull the pivot's created_at for the truncate boundary.
        let pivot = get_message(conn, &pivot_id)?
            .ok_or_else(|| LoomError::NotFound(format!("message {pivot_id} not found")))?;
        truncate_story_after(conn, &pivot.story_id, &pivot.created_at, &pivot.id)?;
        db_update_message_content(conn, &pivot.id, &new_content_json, None, None, None)?;
        Ok(())
    })?;

    // Re-fire generation. Re-using send_message would double-insert the
    // user message, so we replicate just the streaming half.
    re_send_after_edit(app, story_id, new_content).await
}

/// Internal helper for `edit_user_message` and `regenerate_last_response`:
/// the user message already exists (or has been re-anchored); generate a
/// fresh model response.
async fn re_send_after_edit(
    app: tauri::AppHandle,
    story_id: String,
    user_content: UserContent,
) -> Result<SendMessageResult, LoomError> {
    let state = app.state::<AppState>();
    let api_key = access::with_api_key(&state, |k| Ok(k.to_owned()))?;

    let model_id = Uuid::new_v4().to_string();
    let model_id_for_closure = model_id.clone();
    let story_id_for_closure = story_id.clone();
    let user_content_for_closure = user_content.clone();
    let (model_name, request, params) = access::with_two_conns(&state, |app_db, world_db| {
        require_story(world_db, &story_id_for_closure)?;
        let model_name: String = resolve(world_db, app_db, AppSettingKey::TextModelName)?;
        let system_instruction: String = resolve(world_db, app_db, AppSettingKey::StorySi)?;
        let aux_text = resolve_aux_text(world_db, app_db, &story_id_for_closure)?;
        let fake_user_prompt: String =
            resolve(world_db, app_db, AppSettingKey::PromptAccordionFakeUser)?;
        let params = resolve_params(world_db, app_db)?;
        let request = history::assemble_request(
            world_db,
            ConversationMode::Story,
            AssembleInputs {
                story_id: &story_id_for_closure,
                draft: &user_content_for_closure,
                system_instruction: &system_instruction,
                aux_text: &aux_text,
                fake_user_prompt: &fake_user_prompt,
            },
        )?;
        let model_msg = ChatMessage {
            id: model_id_for_closure,
            story_id: story_id_for_closure,
            session_id: None,
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
            kind: "story".into(),
        };
        insert_message(world_db, &model_msg)?;
        Ok((model_name, request, params))
    })?;
    let cancel_token = access::install_cancel_token(&state)?;
    let model_message_id = model_id;

    // Re-issue: there's no separate user message id here — the caller is
    // responsible for knowing the existing one. We emit it as
    // `model_message_id` to keep the frontend listener generic.
    //
    // Edit/regenerate sends always go inline (no auto-create, no refresh).
    // The stale-trigger path on edit/delete already invalidates any active
    // cache; the next plain send rebuilds it.
    let task_app = app.clone();
    let task_story_id = story_id.clone();
    let task_model_id = model_message_id.clone();
    tokio::spawn(async move {
        run_stream(
            task_app,
            task_story_id,
            // No optimistic user bubble to retract on edit-truncate; the
            // user row already exists in DB. We re-use its id below.
            String::new(),
            task_model_id,
            api_key,
            model_name,
            request,
            params,
            cancel_token,
            None,
            0,
        )
        .await
    });

    Ok(SendMessageResult {
        user_message_id: String::new(),
        model_message_id,
    })
}

#[tauri::command]
pub fn update_message_content(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    message_id: String,
    new_text: String,
) -> Result<(), LoomError> {
    access::with_active_conn(&state, |conn| {
        let pivot = get_message(conn, &message_id)?
            .ok_or_else(|| LoomError::NotFound(format!("message {message_id} not found")))?;
        if pivot.role != "model" {
            return Err(LoomError::validation(
                "update_message_content only applies to model messages.",
            ));
        }
        db_update_message_content(conn, &message_id, &new_text, None, None, None)
    })?;
    mark_story_cache_stale_for_message(&app, &state, &message_id)?;
    Ok(())
}

#[tauri::command]
pub async fn regenerate_last_response(
    app: tauri::AppHandle,
    story_id: String,
) -> Result<SendMessageResult, LoomError> {
    let state = app.state::<AppState>();

    // 1. Drop the most recent message; ensure it was a model message.
    //    Capture its id first so we can stale-mark if it was cached.
    let story_id_for_closure = story_id.clone();
    let last_msg_id = access::with_active_conn(&state, |conn| {
        let last = list_story_messages(conn, &story_id_for_closure)?;
        Ok(last.last().map(|m| m.id.clone()))
    })?;
    if let Some(id) = last_msg_id {
        mark_story_cache_stale_for_message(&app, &state, &id)?;
    }
    let last_user_content = access::with_active_conn_mut(&state, |conn| {
        let last = list_story_messages(conn, &story_id_for_closure)?;
        let last_msg = last
            .last()
            .ok_or_else(|| LoomError::validation("Nothing to regenerate."))?
            .clone();
        if last_msg.role != "model" {
            return Err(LoomError::validation(
                "Cannot regenerate when the last turn is a user message.",
            ));
        }
        delete_last_story_message(conn, &story_id_for_closure)?;
        // The user turn is now the last row. Parse it back into UserContent.
        let new_last = list_story_messages(conn, &story_id_for_closure)?;
        let user_msg = new_last
            .last()
            .ok_or_else(|| LoomError::validation("Story has no user turn to regenerate from."))?;
        if user_msg.role != "user" {
            return Err(LoomError::validation("Story tail is not a user turn."));
        }
        Ok(serde_json::from_str::<UserContent>(&user_msg.content)?)
    })?;

    re_send_after_edit(app, story_id, last_user_content).await
}

#[tauri::command]
pub fn delete_exchange(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    message_id: String,
) -> Result<(), LoomError> {
    // Stale-mark BEFORE delete — otherwise the message is gone and we can't
    // resolve its story_id. Idempotent if no cache exists.
    mark_story_cache_stale_for_message(&app, &state, &message_id)?;
    access::with_active_conn_mut(&state, |conn| {
        db_delete_exchange(conn, &message_id)?;
        Ok(())
    })
}

#[tauri::command]
pub fn delete_from(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    message_id: String,
) -> Result<(), LoomError> {
    mark_story_cache_stale_for_message(&app, &state, &message_id)?;
    access::with_active_conn_mut(&state, |conn| {
        db_delete_from(conn, &message_id)?;
        Ok(())
    })
}

#[tauri::command]
pub fn update_feedback(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    message_id: String,
    feedback: String,
) -> Result<(), LoomError> {
    access::with_active_conn(&state, |conn| {
        db_update_user_feedback(conn, &message_id, &feedback)
    })?;
    mark_story_cache_stale_for_message(&app, &state, &message_id)?;
    Ok(())
}

#[tauri::command]
pub async fn get_token_count(
    app: tauri::AppHandle,
    story_id: String,
    draft: UserContent,
) -> Result<TokenEstimate, LoomError> {
    let state = app.state::<AppState>();
    let api_key = access::with_api_key(&state, |k| Ok(k.to_owned()))?;
    let (model, request) = access::with_two_conns(&state, |app_db, world_db| {
        require_story(world_db, &story_id)?;
        let model: String = resolve(world_db, app_db, AppSettingKey::TextModelName)?;
        let system_instruction: String = resolve(world_db, app_db, AppSettingKey::StorySi)?;
        let aux_text = resolve_aux_text(world_db, app_db, &story_id)?;
        let fake_user_prompt: String =
            resolve(world_db, app_db, AppSettingKey::PromptAccordionFakeUser)?;
        let request = history::assemble_request(
            world_db,
            ConversationMode::Story,
            AssembleInputs {
                story_id: &story_id,
                draft: &draft,
                system_instruction: &system_instruction,
                aux_text: &aux_text,
                fake_user_prompt: &fake_user_prompt,
            },
        )?;
        Ok((model, request))
    })?;

    gemini::count_tokens(&api_key, &model, &request).await
}

#[tauri::command]
pub fn get_draft(state: State<'_, AppState>, story_id: String) -> Result<UserContent, LoomError> {
    access::with_active_conn(&state, |conn| {
        let raw: String = get_story_state(conn, &story_id, StoryStateKey::Draft)?;
        if raw.is_empty() || raw == "{}" {
            return Ok(UserContent::default());
        }
        serde_json::from_str::<UserContent>(&raw).map_err(LoomError::from)
    })
}

#[tauri::command]
pub fn save_draft(
    state: State<'_, AppState>,
    story_id: String,
    draft: UserContent,
) -> Result<(), LoomError> {
    let json = serde_json::to_string(&draft)?;
    access::with_active_conn(&state, |conn| {
        set_story_state(conn, &story_id, StoryStateKey::Draft, &json)
    })
}

#[tauri::command]
pub fn clear_draft(state: State<'_, AppState>, story_id: String) -> Result<(), LoomError> {
    access::with_active_conn(&state, |conn| {
        set_story_state(conn, &story_id, StoryStateKey::Draft, "{}")
    })
}
