//! Context cache service (Doc 22).
//!
//! Owns:
//!   1. The `cache_state` stale-marking contract (called from vault, conversation,
//!      modes commands). Service does NOT emit events — that's command-layer
//!      responsibility per Doc 05 §Dependency Rules.
//!   2. Prefix assembly: SI + attached docs + story-history-up-to-prior-model
//!      (story scope). The Session arm is added in Phase 6C.
//!   3. Gemini cachedContents HTTP — create / refresh-TTL / delete. URL is
//!      injectable so wiremock-driven tests can run without touching the live
//!      Gemini host.
//!
//! Per Doc 05 §Dependency Rules, `services/` may import `db/`, `security/`, and
//! `state/` (read-only) — never `commands/`.

use std::collections::BTreeMap;

use chrono::{Duration, Utc};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use ts_rs::TS;

use crate::db::accordion::{self as db_accordion, AccordionSegment, Checkpoint};
use crate::db::cache_state as db_cache;
use crate::db::messages::{list_story_messages, ChatMessage};
use crate::db::vault::VaultItemMeta;
use crate::error::LoomError;
use crate::services::history::{
    append_feedback, build_history_with_accordion, render_user_content, GeminiContent, UserContent,
};
use crate::services::settings::resolve;
use crate::services::settings_keys::AppSettingKey;
use crate::services::vault::list_attached_docs;

pub use crate::db::cache_state::CacheStatus;

/// Which cache the prefix is being built for. Phase 6A only implements the
/// `Story` arm; `Session(_)` lands in Phase 6C with snapshot reconstruction.
#[derive(Debug, Clone)]
pub enum CacheScope {
    Story(String),
    Session(String),
}

/// Output of `build_cache_prefix`. Carries the assembled `Vec<GeminiContent>`,
/// the resolved system instruction, the high-water message id (set only when
/// the prefix has at least one story-kind message), the per-doc SHA-256
/// snapshot map, and a rolling SHA-256 hash over the canonicalised prefix
/// (used by snapshot integrity checks in 6C).
#[derive(Debug, Clone)]
pub struct CachePrefix {
    pub system_instruction: String,
    pub contents: Vec<GeminiContent>,
    pub last_cached_message_id: Option<String>,
    pub doc_snapshots: BTreeMap<String, String>,
    pub prefix_hash: String,
}

/// Returned by `create_cache` after a successful Gemini round-trip.
#[derive(Debug, Clone)]
pub struct CacheRecord {
    pub cache_name: String,
    pub expire_time: String,
    pub total_token_count: i64,
}

/// Row shape for the right-pane Cache section. Lives here because Doc 03 §IPC
/// names `services/cache.rs::AliveCacheRow` as the authoritative ts-rs source.
/// Story rows have `session_id = None`; consulting rows (added in 6C) carry
/// the active session id + name.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/lib/types.ts")]
pub struct AliveCacheRow {
    pub story_id: String,
    pub story_name: String,
    pub session_id: Option<String>,
    pub session_name: Option<String>,
    pub total_tokens: i64,
    pub expiry_at: String,
    pub is_stale: bool,
}

// --- Stale marking (called from vault / conversation / modes commands) -------

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

/// Mark a story-level cache stale. No-op when no active cache row exists for
/// the story (a fresh story with no cache cannot be "more stale"). Caller is
/// responsible for emitting `cache_state_changed` from the command layer.
pub fn mark_story_stale(conn: &Connection, story_id: &str) -> Result<(), LoomError> {
    db_cache::mark_stale(conn, story_id, &now_iso())?;
    Ok(())
}

/// Mark a consulting session cache stale. Per Doc 22 §Stale Triggers
/// (consulting subset): session message edit/delete, snapshot-divergence on
/// re-entry. Handover sessions can never have an active cache; the table
/// CHECK guarantees `cache_name IS NULL` for them, so the UPDATE is a no-op.
/// Caller emits `session_cache_state_changed` from the command layer.
pub fn mark_session_stale(conn: &Connection, session_id: &str) -> Result<(), LoomError> {
    let now = now_iso();
    conn.execute(
        "UPDATE conversation_sessions SET cache_is_stale = 1, modified_at = ?1
         WHERE id = ?2 AND cache_name IS NOT NULL",
        rusqlite::params![now, session_id],
    )?;
    Ok(())
}

/// Mark every story in this world stale. Stub for Phase 11 — settings writes
/// (story_si, consulting_si, text_model_name) call this so cache invalidation
/// is centralised. The `_world_id` arg is unused today (one connection = one
/// world by SB-3); kept for call-site clarity.
#[allow(unused_variables)]
pub fn mark_world_stories_stale(conn: &Connection, world_id: &str) -> Result<(), LoomError> {
    let now = now_iso();
    for story_id in db_cache::list_story_ids(conn)? {
        db_cache::mark_stale(conn, &story_id, &now)?;
    }
    Ok(())
}

/// True when the message id is at-or-before the story cache's high-water
/// mark. False when no cache exists, no high-water set, or the message lives
/// after the mark. Used by `commands/conversation.rs` to decide whether an
/// edit / delete needs the cached-message confirmation modal (6D).
pub fn is_cached_story_message(
    conn: &Connection,
    story_id: &str,
    message_id: &str,
) -> Result<bool, LoomError> {
    let status = db_cache::get(conn, story_id)?;
    if !status.is_active() {
        return Ok(false);
    }
    let Some(high_water) = status.last_cached_message_id else {
        return Ok(false);
    };
    if high_water == message_id {
        return Ok(true);
    }
    let high_msg = crate::db::messages::get_message(conn, &high_water)?;
    let target_msg = crate::db::messages::get_message(conn, message_id)?;
    match (high_msg, target_msg) {
        (Some(h), Some(t)) => Ok(t.created_at <= h.created_at),
        _ => Ok(false),
    }
}

/// True iff the segment's range overlaps the story's currently-cached prefix
/// (Doc 16 §Accordion + Cache Interaction). A segment overlaps when its
/// start anchor's `created_at` is strictly before the cache high-water
/// message's `created_at` — i.e. at least one byte of the segment's content
/// is part of what the cache covers. Returns false when no active cache
/// exists or the segment / its start anchor has been deleted.
pub fn segment_overlaps_cached_prefix(
    conn: &Connection,
    story_id: &str,
    segment_id: &str,
) -> Result<bool, LoomError> {
    let status = db_cache::get(conn, story_id)?;
    if !status.is_active() {
        return Ok(false);
    }
    let Some(high_water_id) = status.last_cached_message_id else {
        return Ok(false);
    };
    let Some(high_water_msg) = crate::db::messages::get_message(conn, &high_water_id)? else {
        return Ok(false);
    };
    let Some(seg) = db_accordion::get_segment(conn, segment_id)? else {
        return Ok(false);
    };
    let start_at = segment_start_anchor_created_at(conn, &seg.start_cp_id)?;
    Ok(start_at.as_str() < high_water_msg.created_at.as_str())
}

/// Anchor `created_at` for a checkpoint by id. Start sentinel returns `""`
/// (sorts before every real ISO-8601 timestamp).
fn segment_start_anchor_created_at(
    conn: &Connection,
    start_cp_id: &str,
) -> Result<String, LoomError> {
    let Some(cp) = db_accordion::get_checkpoint(conn, start_cp_id)? else {
        return Ok(String::new());
    };
    match cp.after_message_id {
        None => Ok(String::new()),
        Some(mid) => Ok(crate::db::messages::get_message(conn, &mid)?
            .map(|m| m.created_at)
            .unwrap_or_default()),
    }
}

// --- Prefix assembly ---------------------------------------------------------

/// SHA-256 hex of a UTF-8 string.
fn hash_utf8(s: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(s.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Wrap a source-doc body with the canonical header per Doc 22.
fn doc_header(doc: &VaultItemMeta) -> String {
    format!(
        "=== SOURCE DOCUMENT: {} — {} ===",
        doc.item_subtype.as_deref().unwrap_or("Unspecified"),
        doc.name
    )
}

/// Body of an attached doc as the prefix builder needs it.
pub enum DocPayload {
    /// SourceDocument: raw stored content rendered inline.
    Text(String),
    /// Image: reference to a Gemini File API resource (Phase 6B).
    File { uri: String, mime_type: String },
}

/// One attached doc as the prefix builder needs it: metadata for headers +
/// the payload (loaded separately because `VaultItemMeta` carries metadata
/// only).
pub struct AttachedDocBody<'a> {
    pub meta: &'a VaultItemMeta,
    pub payload: DocPayload,
}

/// Inputs needed to build a story-cache prefix: which story, the story messages
/// to include (caller decides the high-water — the auto-create path passes
/// "everything before the current user turn"), the resolved system instruction,
/// and the attached doc list.
pub struct StoryPrefixInputs<'a> {
    pub story_id: &'a str,
    pub system_instruction: &'a str,
    pub attached_docs: &'a [AttachedDocBody<'a>],
    pub history: &'a [ChatMessage],
    /// Closed segments for this story. Substitution applies to runs of
    /// messages whose containing segment has a summary and is collapsed or
    /// has `use_summary = 1` (Doc 16 §History Assembly).
    pub segments: &'a [AccordionSegment],
    pub checkpoints: &'a [Checkpoint],
    /// Resolved `prompt_accordion_fake_user`. Empty string is acceptable
    /// when no segments will substitute.
    pub fake_user_prompt: &'a str,
}

/// Assemble the prefix `Vec<GeminiContent>` for a story-mode cache. Order
/// per Doc 22 §What Gets Cached:
///   1. Source documents — leading user/model pair, one entry per doc, in
///      attachment order, each wrapped in `=== SOURCE DOCUMENT: ... ===`.
///   2. Story history — every story-kind message up to the high-water,
///      with feedback appended on model turns.
///
/// SI is returned separately (Gemini's cachedContents accepts a top-level
/// `systemInstruction` field).
pub fn build_story_prefix(inputs: StoryPrefixInputs<'_>) -> Result<CachePrefix, LoomError> {
    let mut contents: Vec<GeminiContent> =
        Vec::with_capacity(inputs.attached_docs.len() * 2 + inputs.history.len());
    let mut snapshots: BTreeMap<String, String> = BTreeMap::new();

    // 1. Attached docs as user/model pairs. Image docs land in 6B (their
    //    body becomes a fileData reference, not inline content) — caller
    //    fills `AttachedDocBody.body` accordingly.
    for doc in inputs.attached_docs {
        let header = doc_header(doc.meta);
        let mut parts: Vec<crate::services::history::GeminiPart> =
            vec![crate::services::history::GeminiPart::text(format!(
                "{header}\n"
            ))];
        match &doc.payload {
            DocPayload::Text(body) => {
                // Append body as a second text part so the header stays its own
                // chunk (cleaner Gemini wire shape; merges identically client-side).
                parts.push(crate::services::history::GeminiPart::text(body.clone()));
                snapshots.insert(doc.meta.id.clone(), hash_utf8(body));
            }
            DocPayload::File { uri, mime_type } => {
                parts.push(crate::services::history::GeminiPart::file(uri, mime_type));
                // Snapshot key for an Image is the URI — stable per upload.
                snapshots.insert(doc.meta.id.clone(), hash_utf8(uri));
            }
        }
        contents.push(GeminiContent {
            role: "user".into(),
            parts,
        });
        contents.push(GeminiContent {
            role: "model".into(),
            parts: vec![crate::services::history::GeminiPart::text("Acknowledged.")],
        });
    }

    // 2. Story history — with Accordion fake-pair substitution (Doc 16
    //    §History Assembly). The high-water id is still the chronologically
    //    last underlying message, not the fake-pair, so cached-prefix
    //    overlap checks line up with what's actually persisted.
    let history_contents = build_history_with_accordion(
        inputs.history,
        inputs.segments,
        inputs.checkpoints,
        inputs.fake_user_prompt,
    )?;
    contents.extend(history_contents);
    let last_id = inputs.history.last().map(|m| m.id.clone());

    // Rolling hash over (system_instruction || every part text in order).
    // Order-stable because BTreeMap keys are sorted; canonical for snapshot
    // integrity checks in 6C.
    let mut hasher = Sha256::new();
    hasher.update(inputs.system_instruction.as_bytes());
    hasher.update([0xff]);
    for c in &contents {
        hasher.update(c.role.as_bytes());
        hasher.update([0xfe]);
        for p in &c.parts {
            hasher.update(p.text.as_bytes());
            hasher.update([0xfd]);
        }
    }
    let prefix_hash = format!("{:x}", hasher.finalize());

    Ok(CachePrefix {
        system_instruction: inputs.system_instruction.to_owned(),
        contents,
        last_cached_message_id: last_id,
        doc_snapshots: snapshots,
        prefix_hash,
    })
}

/// Resolve all ingredients and assemble the story prefix. `up_to_message_id`
/// is the high-water mark — every story-kind message with `created_at <=` that
/// message's `created_at` is included. `None` means "all story-kind messages".
pub fn build_cache_prefix(
    world: &Connection,
    app_db: &Connection,
    scope: CacheScope,
    up_to_message_id: Option<&str>,
) -> Result<CachePrefix, LoomError> {
    match scope {
        CacheScope::Story(story_id) => {
            let system_instruction: String = resolve(world, app_db, AppSettingKey::StorySi)?;
            let attached_metas = list_attached_docs(world, &story_id)?;
            // Resolve doc payloads. Image rows expect a pre-resolved
            // `file_api_uri` on the row (Phase 6B's `services/file_api.rs`
            // populates this lazily). When missing — typically because the
            // image hasn't been uploaded yet — we fall back to the 6A text
            // placeholder so a cache create doesn't fail; the next manual
            // refresh after an upload will pick up the URI.
            let mut bodies: Vec<(VaultItemMeta, DocPayload)> =
                Vec::with_capacity(attached_metas.len());
            for meta in attached_metas {
                let payload = if meta.item_type == "Image" {
                    match (
                        meta.file_api_uri.as_deref(),
                        meta.asset_meta.as_ref().map(|m| m.mime_type.clone()),
                    ) {
                        (Some(uri), Some(mime)) => DocPayload::File {
                            uri: uri.to_owned(),
                            mime_type: mime,
                        },
                        _ => DocPayload::Text(format!("[image: {}]", meta.name)),
                    }
                } else {
                    DocPayload::Text(
                        crate::db::vault::get_item_content(world, &meta.id)?.unwrap_or_default(),
                    )
                };
                bodies.push((meta, payload));
            }
            let docs: Vec<AttachedDocBody<'_>> = bodies
                .iter()
                .map(|(m, p)| AttachedDocBody {
                    meta: m,
                    payload: match p {
                        DocPayload::Text(s) => DocPayload::Text(s.clone()),
                        DocPayload::File { uri, mime_type } => DocPayload::File {
                            uri: uri.clone(),
                            mime_type: mime_type.clone(),
                        },
                    },
                })
                .collect();
            let history = match up_to_message_id {
                None => list_story_messages(world, &story_id)?,
                Some(id) => {
                    let pivot = crate::db::messages::get_message(world, id)?.ok_or_else(|| {
                        LoomError::NotFound(format!("message {id} not found for cache prefix"))
                    })?;
                    crate::db::messages::list_story_messages_up_to(
                        world,
                        &story_id,
                        Some(&pivot.created_at),
                    )?
                }
            };
            let segments = db_accordion::list_segments(world, &story_id)?;
            let checkpoints = db_accordion::list_checkpoints(world, &story_id)?;
            let fake_user_prompt: String =
                resolve(world, app_db, AppSettingKey::PromptAccordionFakeUser)?;
            build_story_prefix(StoryPrefixInputs {
                story_id: &story_id,
                system_instruction: &system_instruction,
                attached_docs: &docs,
                history: &history,
                segments: &segments,
                checkpoints: &checkpoints,
                fake_user_prompt: &fake_user_prompt,
            })
        }
        CacheScope::Session(session_id) => {
            let (prefix, _divergences) = build_session_prefix(world, &session_id)?;
            Ok(prefix)
        }
    }
}

/// Doc 22 §Re-entry algorithm — diagnostic record of every snapshot/state
/// disagreement encountered while rebuilding a session prefix. Non-blocking:
/// the prefix is still returned, and the caller surfaces these via a
/// `session_cache_diverged` event for the frontend toast.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/lib/types.ts")]
pub struct SessionDivergence {
    pub kind: SessionDivergenceKind,
    /// The id of the message / doc / segment in question. Empty for
    /// `PrefixHashMismatch`.
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../src/lib/types.ts")]
pub enum SessionDivergenceKind {
    /// The snapshot referenced a story-kind message that no longer exists
    /// (writer hard-deleted it via the cached-message warning path).
    MissingStoryMessage,
    /// The snapshot referenced an attached doc that has since been
    /// soft-deleted or hard-deleted.
    MissingAttachedDoc,
    /// An attached doc's current SHA-256 differs from the snapshot's.
    AttachedDocChanged,
    /// The recomputed prefix hash differs from the snapshot's stored value.
    PrefixHashMismatch,
}

/// Build a consulting-session cache prefix from `entry_snapshot`. Per Doc 22:
/// captured summaries and SI are used verbatim; story messages are fetched
/// by id (skip + record on missing); attached docs are fetched by id and
/// content-compared.
pub fn build_session_prefix(
    world: &Connection,
    session_id: &str,
) -> Result<(CachePrefix, Vec<SessionDivergence>), LoomError> {
    use crate::db::conversation_sessions::get_session;
    use crate::services::modes::SessionSnapshot;

    let session = get_session(world, session_id)?
        .ok_or_else(|| LoomError::NotFound(format!("session {session_id} not found")))?;
    if session.kind != "consulting" {
        return Err(LoomError::validation(format!(
            "session {session_id} is kind '{}'; only consulting sessions cache",
            session.kind
        )));
    }
    let snapshot: SessionSnapshot = serde_json::from_str(&session.entry_snapshot).map_err(|e| {
        LoomError::Internal(format!(
            "session {session_id} entry_snapshot is not valid JSON: {e}"
        ))
    })?;

    let mut divergences: Vec<SessionDivergence> = Vec::new();
    let mut contents: Vec<GeminiContent> = Vec::new();
    let mut snapshots: BTreeMap<String, String> = BTreeMap::new();

    // 1. Attached docs in snapshot order. Compare current hash to snapshot.
    for doc_entry in &snapshot.attached_docs {
        let item = crate::db::vault::get_item(world, &doc_entry.doc_id)?;
        match item {
            Some(meta) if meta.deleted_at.is_none() => {
                let payload = if meta.item_type == "Image" {
                    match (
                        meta.file_api_uri.as_deref(),
                        meta.asset_meta.as_ref().map(|m| m.mime_type.clone()),
                    ) {
                        (Some(uri), Some(mime)) => DocPayload::File {
                            uri: uri.to_owned(),
                            mime_type: mime,
                        },
                        _ => DocPayload::Text(format!("[image: {}]", meta.name)),
                    }
                } else {
                    let body =
                        crate::db::vault::get_item_content(world, &meta.id)?.unwrap_or_default();
                    let current_hash = hash_utf8(&body);
                    if current_hash != doc_entry.content_hash {
                        divergences.push(SessionDivergence {
                            kind: SessionDivergenceKind::AttachedDocChanged,
                            id: meta.id.clone(),
                        });
                    }
                    DocPayload::Text(body)
                };
                let header = doc_header(&meta);
                let mut parts: Vec<crate::services::history::GeminiPart> =
                    vec![crate::services::history::GeminiPart::text(format!(
                        "{header}\n"
                    ))];
                match &payload {
                    DocPayload::Text(body) => {
                        parts.push(crate::services::history::GeminiPart::text(body.clone()));
                        snapshots.insert(meta.id.clone(), hash_utf8(body));
                    }
                    DocPayload::File { uri, mime_type } => {
                        parts.push(crate::services::history::GeminiPart::file(uri, mime_type));
                        snapshots.insert(meta.id.clone(), hash_utf8(uri));
                    }
                }
                contents.push(GeminiContent {
                    role: "user".into(),
                    parts,
                });
                contents.push(GeminiContent {
                    role: "model".into(),
                    parts: vec![crate::services::history::GeminiPart::text("Acknowledged.")],
                });
            }
            _ => {
                divergences.push(SessionDivergence {
                    kind: SessionDivergenceKind::MissingAttachedDoc,
                    id: doc_entry.doc_id.clone(),
                });
            }
        }
    }

    // 2. Story-kind messages by snapshot order. Captured accordion summaries
    //    (Phase 7) substitute for runs of original messages — Phase 6C does
    //    NOT cross-reference current accordion state; the snapshot is the
    //    authority for what the original AI saw. For Phase 4-snapshot rows
    //    `accordion_state` is empty, so this loop reduces to a per-id fetch.
    let mut last_id: Option<String> = None;
    for msg_id in &snapshot.story_message_ids {
        match crate::db::messages::get_message(world, msg_id)? {
            Some(msg) if msg.kind == "story" => {
                match msg.role.as_str() {
                    "user" => {
                        if msg.content_type != "json_user" {
                            return Err(LoomError::Internal(format!(
                                "session-cache user msg {} content_type '{}'",
                                msg.id, msg.content_type
                            )));
                        }
                        let parsed: UserContent = serde_json::from_str(&msg.content)?;
                        let rendered = render_user_content(&parsed);
                        if !rendered.is_empty() {
                            contents.push(GeminiContent {
                                role: "user".into(),
                                parts: vec![crate::services::history::GeminiPart::text(rendered)],
                            });
                        }
                    }
                    "model" => {
                        let with_feedback =
                            append_feedback(&msg.content, msg.user_feedback.as_deref());
                        contents.push(GeminiContent {
                            role: "model".into(),
                            parts: vec![crate::services::history::GeminiPart::text(with_feedback)],
                        });
                    }
                    other => {
                        return Err(LoomError::Internal(format!(
                            "unexpected message role '{other}' in session prefix",
                        )));
                    }
                }
                last_id = Some(msg.id.clone());
            }
            _ => {
                divergences.push(SessionDivergence {
                    kind: SessionDivergenceKind::MissingStoryMessage,
                    id: msg_id.clone(),
                });
            }
        }
    }

    // Divergence integrity check (Doc 22 §Re-entry step 5). Recompute the
    // snapshot-style hash from CURRENT inputs (doc ids whose hashes match
    // current content; story ids actually fetched in this rebuild). If it
    // differs from the snapshot's stored value, something has shifted since
    // the original capture. Independent of the rendered-bytes prefix_hash
    // returned in `CachePrefix`, which is used for cache-create's own
    // integrity chain (6A/B).
    let current_doc_entries: Vec<crate::services::modes::AttachedDocEntry> = snapshot
        .attached_docs
        .iter()
        .map(|d| crate::services::modes::AttachedDocEntry {
            doc_id: d.doc_id.clone(),
            content_hash: snapshots
                .get(&d.doc_id)
                .cloned()
                .unwrap_or_else(|| d.content_hash.clone()),
        })
        .collect();
    let fetched_msg_ids: Vec<String> = contents
        .iter()
        .enumerate()
        .filter_map(|(i, _)| {
            // Doc-pair contents come first (one user + one model per doc);
            // skip them, then the remaining IDs are stored in last_id /
            // intermediate progress. Easier: just rebuild from messages we
            // actually fetched — track them separately.
            let _ = i;
            None
        })
        .collect();
    let _ = fetched_msg_ids; // unused; we use the explicit ids instead.

    // Recompute against the snapshot's id list — the snapshot's view of order.
    // Missing-message divergences are already recorded above.
    let recomputed = crate::services::modes::canonicalise_and_hash(
        &snapshot.system_instruction,
        &snapshot.story_message_ids,
        &snapshot.accordion_state,
        &current_doc_entries,
    );
    if recomputed != snapshot.prefix_hash {
        divergences.push(SessionDivergence {
            kind: SessionDivergenceKind::PrefixHashMismatch,
            id: String::new(),
        });
    }

    // Rendered-bytes hash for cache-create's own integrity chain.
    let mut hasher = Sha256::new();
    hasher.update(snapshot.system_instruction.as_bytes());
    hasher.update([0xff]);
    for c in &contents {
        hasher.update(c.role.as_bytes());
        hasher.update([0xfe]);
        for p in &c.parts {
            hasher.update(p.text.as_bytes());
            hasher.update([0xfd]);
        }
    }
    let prefix_hash = format!("{:x}", hasher.finalize());

    Ok((
        CachePrefix {
            system_instruction: snapshot.system_instruction.clone(),
            contents,
            last_cached_message_id: last_id,
            doc_snapshots: snapshots,
            prefix_hash,
        },
        divergences,
    ))
}

/// True when `message_id` is in the snapshot's `story_message_ids` for the
/// session — i.e., the message was part of the cached prefix when the AI
/// originally saw the session. Used by `commands/modes.rs` to decide whether
/// a session-edit needs the cached-message confirmation modal in 6D.
pub fn is_cached_session_message(
    conn: &Connection,
    session_id: &str,
    message_id: &str,
) -> Result<bool, LoomError> {
    use crate::db::conversation_sessions::get_session;
    use crate::services::modes::SessionSnapshot;

    let Some(session) = get_session(conn, session_id)? else {
        return Ok(false);
    };
    if session.cache_name.is_none() {
        return Ok(false);
    }
    let snapshot: SessionSnapshot = match serde_json::from_str(&session.entry_snapshot) {
        Ok(s) => s,
        Err(_) => return Ok(false),
    };
    Ok(snapshot.story_message_ids.iter().any(|id| id == message_id))
}

/// Rough token estimate for a `CachePrefix`. Uses chars/4 — accurate enough
/// for the cache_min_tokens gate (Doc 22 §Auto-rebuild). A countTokens
/// round-trip would be more accurate but adds latency on every send; we
/// accept the heuristic for 6A and revisit per TD-1.
pub fn estimate_prefix_tokens(prefix: &CachePrefix) -> i64 {
    let mut chars: usize = prefix.system_instruction.chars().count();
    for c in &prefix.contents {
        for p in &c.parts {
            chars += p.text.chars().count();
        }
    }
    (chars / 4) as i64
}

// --- Gemini HTTP boundary ----------------------------------------------------

const CACHED_CONTENTS_PATH: &str = "/cachedContents";

/// Body for `POST /v1beta/cachedContents`.
fn build_create_body(model: &str, prefix: &CachePrefix, ttl_secs: u64) -> Value {
    let mut body = json!({
        "model": format!("models/{model}"),
        "contents": prefix.contents,
        "ttl": format!("{ttl_secs}s"),
    });
    if !prefix.system_instruction.trim().is_empty() {
        body["systemInstruction"] = json!({
            "parts": [{ "text": prefix.system_instruction }]
        });
    }
    body
}

#[derive(Debug, Deserialize)]
struct CachedContentsResponse {
    name: String,
    #[serde(rename = "expireTime")]
    expire_time: Option<String>,
    #[serde(rename = "usageMetadata")]
    usage_metadata: Option<CacheUsageMetadata>,
}

#[derive(Debug, Deserialize)]
struct CacheUsageMetadata {
    #[serde(rename = "totalTokenCount")]
    total_token_count: Option<i64>,
}

/// `POST /v1beta/cachedContents` — create a new cache.
pub async fn create_cache(
    base_url: &str,
    api_key: &str,
    model: &str,
    prefix: &CachePrefix,
    ttl_secs: u64,
) -> Result<CacheRecord, LoomError> {
    let url = format!("{base_url}{CACHED_CONTENTS_PATH}?key={api_key}");
    let body = build_create_body(model, prefix, ttl_secs);
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| LoomError::CacheCreate(format!("client build: {e}")))?;
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| LoomError::CacheCreate(format!("create send: {e}")))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(LoomError::CacheCreate(format!(
            "cachedContents HTTP {status}: {text}"
        )));
    }
    let parsed: CachedContentsResponse = resp
        .json()
        .await
        .map_err(|e| LoomError::CacheCreate(format!("parse: {e}")))?;
    let expire = parsed.expire_time.unwrap_or_else(|| {
        // Fallback: now + ttl. Gemini always returns expireTime, but be safe.
        (Utc::now() + Duration::seconds(ttl_secs as i64)).to_rfc3339()
    });
    Ok(CacheRecord {
        cache_name: parsed.name,
        expire_time: expire,
        total_token_count: parsed
            .usage_metadata
            .and_then(|u| u.total_token_count)
            .unwrap_or(0),
    })
}

/// `PATCH /v1beta/{cache_name}?updateMask=ttl` — refresh TTL. Caller spawns
/// this fire-and-forget per Doc 22 §Refresh; never blocks the send response.
pub async fn refresh_cache_ttl(
    base_url: &str,
    api_key: &str,
    cache_name: &str,
    ttl_secs: u64,
) -> Result<String, LoomError> {
    let url = format!("{base_url}/{cache_name}?key={api_key}&updateMask=ttl");
    let body = json!({ "ttl": format!("{ttl_secs}s") });
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| LoomError::ApiError(format!("client build: {e}")))?;
    let resp = client
        .patch(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| LoomError::ApiError(format!("refresh send: {e}")))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(LoomError::ApiError(format!(
            "refresh HTTP {status}: {text}"
        )));
    }
    let parsed: CachedContentsResponse = resp
        .json()
        .await
        .map_err(|e| LoomError::ApiError(format!("parse: {e}")))?;
    Ok(parsed
        .expire_time
        .unwrap_or_else(|| (Utc::now() + Duration::seconds(ttl_secs as i64)).to_rfc3339()))
}

/// `DELETE /v1beta/{cache_name}` — best-effort. 4xx/5xx are logged but not
/// propagated; callers always wipe the local row regardless.
pub async fn delete_cache(
    base_url: &str,
    api_key: &str,
    cache_name: &str,
) -> Result<(), LoomError> {
    let url = format!("{base_url}/{cache_name}?key={api_key}");
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| LoomError::ApiError(format!("client build: {e}")))?;
    let resp = client
        .delete(&url)
        .send()
        .await
        .map_err(|e| LoomError::ApiError(format!("delete send: {e}")))?;
    if !resp.status().is_success() && resp.status().as_u16() != 404 {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(LoomError::ApiError(format!("delete HTTP {status}: {text}")));
    }
    Ok(())
}

// --- Tests -------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::messages::{insert_message, ChatMessage};
    use crate::db::migrations::{apply_pending, MigrationRoot};
    use crate::services::history::UserContent;
    use rusqlite::Connection;

    fn fresh_world() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        apply_pending(&mut c, MigrationRoot::World).unwrap();
        c.execute(
            "INSERT INTO items (id, item_type, name, sort_order, created_at, modified_at)
             VALUES ('story1', 'Story', 'Test', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        c
    }

    fn insert_doc(c: &Connection, id: &str, subtype: &str, name: &str, content: &str) {
        c.execute(
            "INSERT INTO items (id, item_type, item_subtype, name, content, sort_order, created_at, modified_at)
             VALUES (?1, 'SourceDocument', ?2, ?3, ?4, 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            rusqlite::params![id, subtype, name, content],
        )
        .unwrap();
    }

    fn user_msg(id: &str, created: &str, plot: &str) -> ChatMessage {
        let uc = UserContent {
            plot_direction: plot.into(),
            ..Default::default()
        };
        ChatMessage {
            id: id.into(),
            story_id: "story1".into(),
            session_id: None,
            role: "user".into(),
            content_type: "json_user".into(),
            content: serde_json::to_string(&uc).unwrap(),
            token_count: None,
            model_name: None,
            finish_reason: None,
            created_at: created.into(),
            deleted_at: None,
            user_feedback: None,
            ghostwriter_history: "[]".into(),
            kind: "story".into(),
        }
    }

    fn model_msg(id: &str, created: &str, text: &str, fb: Option<&str>) -> ChatMessage {
        ChatMessage {
            id: id.into(),
            story_id: "story1".into(),
            session_id: None,
            role: "model".into(),
            content_type: "text".into(),
            content: text.into(),
            token_count: None,
            model_name: None,
            finish_reason: None,
            created_at: created.into(),
            deleted_at: None,
            user_feedback: fb.map(str::to_owned),
            ghostwriter_history: "[]".into(),
            kind: "story".into(),
        }
    }

    #[test]
    fn build_story_prefix_orders_docs_then_history_with_headers() {
        let c = fresh_world();
        insert_doc(&c, "docA", "World", "Atlas", "Continent map.");
        insert_doc(&c, "docB", "Character", "Mira", "Detective.");
        let m1 = user_msg("u1", "2026-01-02T00:00:00Z", "Open with rain.");
        let m2 = model_msg(
            "m1",
            "2026-01-02T00:01:00Z",
            "Rain falls.",
            Some("more dialogue"),
        );
        insert_message(&c, &m1).unwrap();
        insert_message(&c, &m2).unwrap();

        let meta_a = crate::db::vault::get_item(&c, "docA").unwrap().unwrap();
        let meta_b = crate::db::vault::get_item(&c, "docB").unwrap().unwrap();
        let body_a = crate::db::vault::get_item_content(&c, "docA")
            .unwrap()
            .unwrap();
        let body_b = crate::db::vault::get_item_content(&c, "docB")
            .unwrap()
            .unwrap();
        let docs = vec![
            AttachedDocBody {
                meta: &meta_a,
                payload: DocPayload::Text(body_a),
            },
            AttachedDocBody {
                meta: &meta_b,
                payload: DocPayload::Text(body_b),
            },
        ];
        let history = vec![m1.clone(), m2.clone()];

        let prefix = build_story_prefix(StoryPrefixInputs {
            story_id: "story1",
            system_instruction: "SI here.",
            attached_docs: &docs,
            history: &history,
            segments: &[],
            checkpoints: &[],
            fake_user_prompt: "",
        })
        .unwrap();

        // 2 docs × 2 contents (user + ack model) + 2 history entries = 6.
        assert_eq!(prefix.contents.len(), 6);
        assert!(prefix.contents[0].parts[0]
            .text
            .starts_with("=== SOURCE DOCUMENT: World — Atlas ==="));
        assert!(prefix.contents[2].parts[0]
            .text
            .starts_with("=== SOURCE DOCUMENT: Character — Mira ==="));
        assert!(prefix.contents[4].parts[0]
            .text
            .contains("[PLOT DIRECTION]"));
        assert!(prefix.contents[5].parts[0]
            .text
            .contains("[WRITER FEEDBACK]\nmore dialogue"));
        assert_eq!(prefix.last_cached_message_id.as_deref(), Some("m1"));
        assert_eq!(prefix.doc_snapshots.len(), 2);
        assert_eq!(prefix.system_instruction, "SI here.");
        assert!(!prefix.prefix_hash.is_empty());
    }

    #[test]
    fn mark_story_stale_writes_is_stale_and_is_idempotent() {
        let c = fresh_world();
        // No row yet → no-op success.
        mark_story_stale(&c, "story1").unwrap();
        // Seed an active cache row.
        let mut snaps = BTreeMap::new();
        snaps.insert("docA".into(), "h".into());
        db_cache::upsert_active(
            &c,
            "story1",
            "cachedContents/x",
            "2026-05-14T13:00:00Z",
            None,
            10,
            &snaps,
            "2026-05-14T12:00:00Z",
        )
        .unwrap();
        mark_story_stale(&c, "story1").unwrap();
        assert!(db_cache::get(&c, "story1").unwrap().is_stale);
        // Idempotent.
        mark_story_stale(&c, "story1").unwrap();
        assert!(db_cache::get(&c, "story1").unwrap().is_stale);
    }

    #[test]
    fn is_cached_story_message_true_for_high_water_and_earlier() {
        let c = fresh_world();
        let m1 = user_msg("u1", "2026-01-02T00:00:00Z", "x");
        let m2 = model_msg("m1", "2026-01-02T00:01:00Z", "y", None);
        let m3 = user_msg("u2", "2026-01-02T00:02:00Z", "z");
        insert_message(&c, &m1).unwrap();
        insert_message(&c, &m2).unwrap();
        insert_message(&c, &m3).unwrap();

        // No cache → always false.
        assert!(!is_cached_story_message(&c, "story1", "u1").unwrap());

        db_cache::upsert_active(
            &c,
            "story1",
            "cachedContents/x",
            "2026-05-14T13:00:00Z",
            Some("m1"),
            10,
            &BTreeMap::new(),
            "2026-05-14T12:00:00Z",
        )
        .unwrap();
        assert!(is_cached_story_message(&c, "story1", "u1").unwrap());
        assert!(is_cached_story_message(&c, "story1", "m1").unwrap());
        assert!(!is_cached_story_message(&c, "story1", "u2").unwrap());
    }

    // --- 6C: session-cache tests ---

    fn insert_consulting_session(
        c: &Connection,
        id: &str,
        snapshot: &crate::services::modes::SessionSnapshot,
        cache_name: Option<&str>,
    ) {
        let snap_json = serde_json::to_string(snapshot).unwrap();
        let row = crate::db::conversation_sessions::ConversationSession {
            id: id.into(),
            story_id: "story1".into(),
            kind: "consulting".into(),
            name: format!("Consulting {id}"),
            entry_message_id: snapshot.story_message_ids.last().cloned(),
            entry_snapshot: snap_json,
            is_collapsed: false,
            cache_name: cache_name.map(str::to_owned),
            cache_expiry_at: cache_name.map(|_| "2026-05-15T00:00:00Z".to_owned()),
            cache_is_stale: false,
            created_at: "2026-05-14T00:00:00Z".into(),
            modified_at: "2026-05-14T00:00:00Z".into(),
        };
        crate::db::conversation_sessions::insert_session(c, &row).unwrap();
    }

    #[test]
    fn build_session_prefix_round_trips_snapshot() {
        use crate::services::modes::{build_snapshot, SessionSnapshot};
        let c = fresh_world();
        let m1 = user_msg("u1", "2026-01-02T00:00:00Z", "begin");
        let m2 = model_msg("m1", "2026-01-02T00:01:00Z", "ok", None);
        insert_message(&c, &m1).unwrap();
        insert_message(&c, &m2).unwrap();
        let snap: SessionSnapshot = build_snapshot(&c, "story1", "consult-si").unwrap();
        insert_consulting_session(&c, "s1", &snap, Some("cachedContents/x"));

        let (prefix, divergences) = build_session_prefix(&c, "s1").unwrap();
        assert!(
            divergences.is_empty(),
            "no divergences expected: {divergences:?}"
        );
        assert_eq!(prefix.system_instruction, "consult-si");
        // Two history rows; no docs yet.
        assert_eq!(prefix.contents.len(), 2);
        assert_eq!(prefix.last_cached_message_id.as_deref(), Some("m1"));
    }

    #[test]
    fn build_session_prefix_records_missing_message() {
        use crate::services::modes::SessionSnapshot;
        let c = fresh_world();
        // Snapshot references "u1" but we never insert it.
        let snap = SessionSnapshot {
            schema_version: 1,
            system_instruction: "si".into(),
            story_message_ids: vec!["u1".into()],
            accordion_state: vec![],
            attached_docs: vec![],
            prefix_hash: "stale".into(),
        };
        insert_consulting_session(&c, "s1", &snap, Some("cachedContents/x"));
        let (_prefix, divergences) = build_session_prefix(&c, "s1").unwrap();
        assert!(divergences
            .iter()
            .any(|d| matches!(d.kind, SessionDivergenceKind::MissingStoryMessage)));
        // PrefixHashMismatch also fires because the captured hash was bogus.
        assert!(divergences
            .iter()
            .any(|d| matches!(d.kind, SessionDivergenceKind::PrefixHashMismatch)));
    }

    #[test]
    fn mark_session_stale_writes_one_when_active() {
        let c = fresh_world();
        use crate::services::modes::SessionSnapshot;
        let snap = SessionSnapshot {
            schema_version: 1,
            system_instruction: "si".into(),
            story_message_ids: vec![],
            accordion_state: vec![],
            attached_docs: vec![],
            prefix_hash: "h".into(),
        };
        insert_consulting_session(&c, "s1", &snap, Some("cachedContents/x"));
        mark_session_stale(&c, "s1").unwrap();
        let row = crate::db::conversation_sessions::get_session(&c, "s1")
            .unwrap()
            .unwrap();
        assert!(row.cache_is_stale);

        // No-op when no active cache: insert a session without cache_name.
        insert_consulting_session(&c, "s2", &snap, None);
        mark_session_stale(&c, "s2").unwrap();
        let row2 = crate::db::conversation_sessions::get_session(&c, "s2")
            .unwrap()
            .unwrap();
        assert!(!row2.cache_is_stale);
    }

    #[test]
    fn is_cached_session_message_true_for_snapshot_id() {
        use crate::services::modes::SessionSnapshot;
        let c = fresh_world();
        let snap = SessionSnapshot {
            schema_version: 1,
            system_instruction: "si".into(),
            story_message_ids: vec!["u1".into(), "m1".into()],
            accordion_state: vec![],
            attached_docs: vec![],
            prefix_hash: "h".into(),
        };
        insert_consulting_session(&c, "s1", &snap, Some("cachedContents/x"));
        assert!(is_cached_session_message(&c, "s1", "u1").unwrap());
        assert!(is_cached_session_message(&c, "s1", "m1").unwrap());
        assert!(!is_cached_session_message(&c, "s1", "m2").unwrap());

        // No active cache → always false.
        insert_consulting_session(&c, "s2", &snap, None);
        assert!(!is_cached_session_message(&c, "s2", "u1").unwrap());
    }

    #[tokio::test]
    async fn create_cache_returns_record_on_200() {
        use wiremock::matchers::{header_exists, method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/cachedContents"))
            .and(header_exists("content-type"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "name": "cachedContents/abc",
                "expireTime": "2026-05-14T14:00:00Z",
                "usageMetadata": { "totalTokenCount": 12345 }
            })))
            .mount(&server)
            .await;
        let prefix = CachePrefix {
            system_instruction: "SI".into(),
            contents: vec![],
            last_cached_message_id: None,
            doc_snapshots: BTreeMap::new(),
            prefix_hash: "h".into(),
        };
        let rec = create_cache(&server.uri(), "key", "gemini-2.5-flash", &prefix, 3600)
            .await
            .unwrap();
        assert_eq!(rec.cache_name, "cachedContents/abc");
        assert_eq!(rec.total_token_count, 12345);
    }

    #[tokio::test]
    async fn create_cache_returns_cache_create_on_failure() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/cachedContents"))
            .respond_with(ResponseTemplate::new(400).set_body_string("bad request"))
            .mount(&server)
            .await;
        let prefix = CachePrefix {
            system_instruction: "SI".into(),
            contents: vec![],
            last_cached_message_id: None,
            doc_snapshots: BTreeMap::new(),
            prefix_hash: "h".into(),
        };
        let err = create_cache(&server.uri(), "key", "gemini-2.5-flash", &prefix, 3600)
            .await
            .unwrap_err();
        assert!(matches!(err, LoomError::CacheCreate(_)));
    }
}
