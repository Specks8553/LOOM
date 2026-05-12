//! Typed CRUD against the `messages` table (Doc 03 §`messages`, Doc 15).
//!
//! Per Doc 05 §Dependency Rules, `db/` may import only `rusqlite`. Business
//! logic (history assembly, mode dispatch, event emission) lives in
//! `services/history.rs` and `commands/conversation.rs`; this module owns
//! the SQL.
//!
//! v2.0 deletion is **hard-delete** with cascade (Doc 03 §`messages` comment;
//! Doc 15 §Deletion). The `deleted_at` column is reserved for v2.1 undo and
//! is left NULL by every v2.0 path. The cascade rules — drop checkpoints
//! anchored to deleted messages, drop accordion segments whose endpoints
//! reference those checkpoints — are encoded here once so every caller
//! (edit-truncate, delete-exchange, delete-from, regenerate-last) gets the
//! same behaviour.

use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::LoomError;

/// Per Doc 03 §TypeScript Interfaces §Conversation. The IPC payload type for
/// `load_messages` and any place a single message crosses the boundary.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/lib/types.ts")]
pub struct ChatMessage {
    pub id: String,
    pub story_id: String,
    pub session_id: Option<String>,
    pub role: String,         // 'user' | 'model'
    pub content_type: String, // 'json_user' | 'text' | 'blocks'
    pub content: String,
    pub token_count: Option<i64>,
    pub model_name: Option<String>,
    pub finish_reason: Option<String>,
    pub created_at: String,
    pub deleted_at: Option<String>,
    pub user_feedback: Option<String>,
    /// JSON array string; deserialised on the frontend per Doc 03's
    /// `GhostwriterEdit[]` interface. v2.0 Phase 3 stores `'[]'` for every
    /// new message — Ghostwriter writes here in Phase 8.
    pub ghostwriter_history: String,
    pub kind: String, // 'story' | 'handover' | 'consulting'
}

const MESSAGE_COLUMNS: &str = "id, story_id, session_id, role, content_type, content, \
                               token_count, model_name, finish_reason, created_at, \
                               deleted_at, user_feedback, ghostwriter_history, kind";

fn row_to_message(row: &Row<'_>) -> rusqlite::Result<ChatMessage> {
    Ok(ChatMessage {
        id: row.get("id")?,
        story_id: row.get("story_id")?,
        session_id: row.get("session_id")?,
        role: row.get("role")?,
        content_type: row.get("content_type")?,
        content: row.get("content")?,
        token_count: row.get("token_count")?,
        model_name: row.get("model_name")?,
        finish_reason: row.get("finish_reason")?,
        created_at: row.get("created_at")?,
        deleted_at: row.get("deleted_at")?,
        user_feedback: row.get("user_feedback")?,
        ghostwriter_history: row.get("ghostwriter_history")?,
        kind: row.get("kind")?,
    })
}

/// Insert a new message row. The CHECK constraint on the table enforces that
/// `kind = 'story'` rows have `session_id IS NULL`; callers must respect this.
pub fn insert_message(conn: &Connection, msg: &ChatMessage) -> Result<(), LoomError> {
    conn.execute(
        "INSERT INTO messages
            (id, story_id, session_id, role, content_type, content,
             token_count, model_name, finish_reason, created_at,
             deleted_at, user_feedback, ghostwriter_history, kind)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            msg.id,
            msg.story_id,
            msg.session_id,
            msg.role,
            msg.content_type,
            msg.content,
            msg.token_count,
            msg.model_name,
            msg.finish_reason,
            msg.created_at,
            msg.deleted_at,
            msg.user_feedback,
            msg.ghostwriter_history,
            msg.kind,
        ],
    )?;
    Ok(())
}

/// Fetch one message by id, or None if not found.
pub fn get_message(conn: &Connection, id: &str) -> Result<Option<ChatMessage>, LoomError> {
    let sql = format!("SELECT {MESSAGE_COLUMNS} FROM messages WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let row = stmt.query_row(params![id], row_to_message).ok();
    Ok(row)
}

/// Return every story-kind message for a story in chronological order.
/// Soft-deleted rows (`deleted_at IS NOT NULL`) are excluded — v2.0 never
/// produces them but the filter keeps history-assembly contracts stable for
/// v2.1's undo-redo work.
pub fn list_story_messages(
    conn: &Connection,
    story_id: &str,
) -> Result<Vec<ChatMessage>, LoomError> {
    let sql = format!(
        "SELECT {MESSAGE_COLUMNS} FROM messages
         WHERE story_id = ?1 AND kind = 'story' AND deleted_at IS NULL
         ORDER BY created_at ASC, id ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![story_id], row_to_message)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Return story-kind messages chronologically up to (and including)
/// `boundary_created_at` — used by session history assembly (Doc 23: handover
/// and consulting prefixes include "story-up-to-entry"). Pass `None` for the
/// boundary to mean "session was created before any story messages exist" —
/// the result is empty.
pub fn list_story_messages_up_to(
    conn: &Connection,
    story_id: &str,
    boundary_created_at: Option<&str>,
) -> Result<Vec<ChatMessage>, LoomError> {
    let Some(boundary) = boundary_created_at else {
        return Ok(Vec::new());
    };
    let sql = format!(
        "SELECT {MESSAGE_COLUMNS} FROM messages
         WHERE story_id = ?1 AND kind = 'story' AND deleted_at IS NULL
           AND created_at <= ?2
         ORDER BY created_at ASC, id ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![story_id, boundary], row_to_message)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Return every message for a session in chronological order. Used by
/// session history assembly (handover / consulting prior-turn injection) and
/// by the Theater to render a session partition's bubbles.
pub fn list_session_messages(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<ChatMessage>, LoomError> {
    let sql = format!(
        "SELECT {MESSAGE_COLUMNS} FROM messages
         WHERE session_id = ?1 AND deleted_at IS NULL
         ORDER BY created_at ASC, id ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![session_id], row_to_message)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Return every message for a story (any kind, any session) in chronological
/// order. Used by the Theater scroll surface and by export (Phase 5 / Phase
/// 21). The session bubbles render inside their session partitions; this
/// query is the single source of truth for "what messages exist on this
/// story at all".
pub fn list_all_messages(conn: &Connection, story_id: &str) -> Result<Vec<ChatMessage>, LoomError> {
    let sql = format!(
        "SELECT {MESSAGE_COLUMNS} FROM messages
         WHERE story_id = ?1 AND deleted_at IS NULL
         ORDER BY created_at ASC, id ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![story_id], row_to_message)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Update a message's content (and `model_name`, `token_count`, `finish_reason`
/// on stream completion). Used by:
///   - the streaming finaliser to write the accumulated model text + metadata
///   - `update_message_content` for in-place edits on AI bubbles
///
/// Only the supplied fields are written; pass `None` to leave a field
/// untouched. `content` is mandatory because every caller actually wants to
/// rewrite it.
pub fn update_message_content(
    conn: &Connection,
    id: &str,
    content: &str,
    token_count: Option<i64>,
    model_name: Option<&str>,
    finish_reason: Option<&str>,
) -> Result<(), LoomError> {
    conn.execute(
        "UPDATE messages SET
            content = ?1,
            token_count = COALESCE(?2, token_count),
            model_name = COALESCE(?3, model_name),
            finish_reason = COALESCE(?4, finish_reason)
         WHERE id = ?5",
        params![content, token_count, model_name, finish_reason, id],
    )?;
    Ok(())
}

/// Update only `user_feedback` (Doc 28 / Doc 15). Empty string clears.
pub fn update_user_feedback(conn: &Connection, id: &str, feedback: &str) -> Result<(), LoomError> {
    conn.execute(
        "UPDATE messages SET user_feedback = ?1 WHERE id = ?2",
        params![feedback, id],
    )?;
    Ok(())
}

/// Hard-delete every story-kind message strictly after `pivot_created_at` in
/// `(created_at, id)` order. Used by edit-truncate (Doc 15 §Editing). Cascade
/// rules per Doc 15 §Cascading Deletion are applied via the inner helper.
///
/// Returns the number of message rows removed.
pub fn truncate_story_after(
    conn: &mut Connection,
    story_id: &str,
    pivot_created_at: &str,
    pivot_id: &str,
) -> Result<usize, LoomError> {
    let tx = conn.transaction()?;
    let ids = collect_story_ids_after(&tx, story_id, pivot_created_at, pivot_id)?;
    let removed = hard_delete_with_cascade(&tx, &ids)?;
    tx.commit()?;
    Ok(removed)
}

/// Hard-delete the user/model pair containing `message_id`. Doc 15 §Deletion.
///
/// "Exchange" semantics:
///   - If `message_id` points to a model message → delete it + the user
///     message immediately preceding it in `(created_at, id)` order.
///   - If `message_id` points to a user message → delete it + the model
///     message immediately following it (if any — orphan user turns from a
///     failed/cancelled generation are deleted alone).
///
/// Returns the number of rows removed (1 or 2).
pub fn delete_exchange(conn: &mut Connection, message_id: &str) -> Result<usize, LoomError> {
    let tx = conn.transaction()?;
    let pivot = require_message(&tx, message_id)?;
    if pivot.kind != "story" {
        return Err(LoomError::validation(
            "delete_exchange only applies to story-kind messages",
        ));
    }
    let mut targets: Vec<String> = vec![pivot.id.clone()];
    if pivot.role == "model" {
        if let Some(partner) = previous_user_in_story(&tx, &pivot)? {
            targets.push(partner);
        }
    } else {
        if let Some(partner) = next_model_in_story(&tx, &pivot)? {
            targets.push(partner);
        }
    }
    let removed = hard_delete_with_cascade(&tx, &targets)?;
    tx.commit()?;
    Ok(removed)
}

/// Hard-delete the exchange containing `message_id` and every exchange after.
/// Doc 15 §Deletion. The exchange boundary is fuzzy when `message_id` is the
/// model half — we anchor "from" at the user half so the matching user turn
/// goes too.
pub fn delete_from(conn: &mut Connection, message_id: &str) -> Result<usize, LoomError> {
    let tx = conn.transaction()?;
    let pivot = require_message(&tx, message_id)?;
    if pivot.kind != "story" {
        return Err(LoomError::validation(
            "delete_from only applies to story-kind messages",
        ));
    }
    let anchor = if pivot.role == "model" {
        previous_user_in_story(&tx, &pivot)?
            .map(|id| require_message(&tx, &id))
            .transpose()?
            .unwrap_or(pivot)
    } else {
        pivot
    };
    let mut ids =
        collect_story_ids_at_or_after(&tx, &anchor.story_id, &anchor.created_at, &anchor.id)?;
    if !ids.iter().any(|id| id == &anchor.id) {
        ids.push(anchor.id);
    }
    let removed = hard_delete_with_cascade(&tx, &ids)?;
    tx.commit()?;
    Ok(removed)
}

/// Hard-delete the most recent story-kind message for this story. Used by
/// `regenerate_last_response` (Doc 15) — caller is responsible for verifying
/// it is a model message before calling.
pub fn delete_last_story_message(
    conn: &mut Connection,
    story_id: &str,
) -> Result<Option<String>, LoomError> {
    let tx = conn.transaction()?;
    let last_id: Option<String> = tx
        .query_row(
            "SELECT id FROM messages
             WHERE story_id = ?1 AND kind = 'story' AND deleted_at IS NULL
             ORDER BY created_at DESC, id DESC LIMIT 1",
            params![story_id],
            |row| row.get(0),
        )
        .ok();
    let Some(id) = last_id else {
        tx.commit()?;
        return Ok(None);
    };
    hard_delete_with_cascade(&tx, std::slice::from_ref(&id))?;
    tx.commit()?;
    Ok(Some(id))
}

// --- internals ---------------------------------------------------------------

fn require_message(conn: &Connection, id: &str) -> Result<ChatMessage, LoomError> {
    let sql = format!("SELECT {MESSAGE_COLUMNS} FROM messages WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    stmt.query_row(params![id], row_to_message)
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                LoomError::NotFound(format!("message {id} not found"))
            }
            other => LoomError::Database(other.to_string()),
        })
}

fn collect_story_ids_after(
    conn: &Connection,
    story_id: &str,
    pivot_created_at: &str,
    pivot_id: &str,
) -> Result<Vec<String>, LoomError> {
    let mut stmt = conn.prepare(
        "SELECT id FROM messages
         WHERE story_id = ?1 AND kind = 'story' AND deleted_at IS NULL
           AND ((created_at > ?2) OR (created_at = ?2 AND id > ?3))
         ORDER BY created_at ASC, id ASC",
    )?;
    let ids = stmt
        .query_map(params![story_id, pivot_created_at, pivot_id], |row| {
            row.get::<_, String>(0)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(ids)
}

fn collect_story_ids_at_or_after(
    conn: &Connection,
    story_id: &str,
    pivot_created_at: &str,
    pivot_id: &str,
) -> Result<Vec<String>, LoomError> {
    let mut stmt = conn.prepare(
        "SELECT id FROM messages
         WHERE story_id = ?1 AND kind = 'story' AND deleted_at IS NULL
           AND ((created_at > ?2) OR (created_at = ?2 AND id >= ?3))
         ORDER BY created_at ASC, id ASC",
    )?;
    let ids = stmt
        .query_map(params![story_id, pivot_created_at, pivot_id], |row| {
            row.get::<_, String>(0)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(ids)
}

fn previous_user_in_story(
    conn: &Connection,
    pivot: &ChatMessage,
) -> Result<Option<String>, LoomError> {
    let id: Option<String> = conn
        .query_row(
            "SELECT id FROM messages
             WHERE story_id = ?1 AND kind = 'story' AND role = 'user' AND deleted_at IS NULL
               AND ((created_at < ?2) OR (created_at = ?2 AND id < ?3))
             ORDER BY created_at DESC, id DESC LIMIT 1",
            params![pivot.story_id, pivot.created_at, pivot.id],
            |row| row.get(0),
        )
        .ok();
    Ok(id)
}

fn next_model_in_story(
    conn: &Connection,
    pivot: &ChatMessage,
) -> Result<Option<String>, LoomError> {
    let id: Option<String> = conn
        .query_row(
            "SELECT id FROM messages
             WHERE story_id = ?1 AND kind = 'story' AND role = 'model' AND deleted_at IS NULL
               AND ((created_at > ?2) OR (created_at = ?2 AND id > ?3))
             ORDER BY created_at ASC, id ASC LIMIT 1",
            params![pivot.story_id, pivot.created_at, pivot.id],
            |row| row.get(0),
        )
        .ok();
    Ok(id)
}

/// Drop the supplied message ids and the dependent rows defined in Doc 15
/// §Cascading Deletion:
///   1. Checkpoints anchored to any deleted message.
///   2. Accordion segments whose `start_cp_id` or `end_cp_id` references any
///      checkpoint deleted in step 1.
///
/// Phase 7 (Accordion) is the consumer; in Phase 3 there are no checkpoints
/// or segments, so steps 1+2 fire on empty sets. Encoding the cascade now
/// keeps every deletion path consistent later.
fn hard_delete_with_cascade(
    tx: &rusqlite::Transaction<'_>,
    message_ids: &[String],
) -> Result<usize, LoomError> {
    if message_ids.is_empty() {
        return Ok(0);
    }
    // 1. Find every checkpoint anchored to a deleted message.
    let msg_placeholders = vec!["?"; message_ids.len()].join(",");
    let cp_sql =
        format!("SELECT id FROM checkpoints WHERE after_message_id IN ({msg_placeholders})");
    let mut cp_stmt = tx.prepare(&cp_sql)?;
    let cp_ids: Vec<String> = cp_stmt
        .query_map(rusqlite::params_from_iter(message_ids.iter()), |row| {
            row.get::<_, String>(0)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(cp_stmt);

    // 2. Drop accordion segments referencing those checkpoints.
    if !cp_ids.is_empty() {
        let cp_placeholders = vec!["?"; cp_ids.len()].join(",");
        let seg_sql = format!(
            "DELETE FROM accordion_segments
             WHERE start_cp_id IN ({cp_placeholders})
                OR end_cp_id   IN ({cp_placeholders})"
        );
        // Bind cp_ids twice — once for each IN clause.
        let mut params_vec: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(cp_ids.len() * 2);
        for id in &cp_ids {
            params_vec.push(id);
        }
        for id in &cp_ids {
            params_vec.push(id);
        }
        tx.execute(&seg_sql, params_vec.as_slice())?;
    }

    // 3. Drop the checkpoints themselves.
    if !cp_ids.is_empty() {
        let cp_placeholders = vec!["?"; cp_ids.len()].join(",");
        let del_cp_sql = format!("DELETE FROM checkpoints WHERE id IN ({cp_placeholders})");
        tx.execute(&del_cp_sql, rusqlite::params_from_iter(cp_ids.iter()))?;
    }

    // 4. Drop the messages.
    let del_msg_sql = format!("DELETE FROM messages WHERE id IN ({msg_placeholders})");
    let removed = tx.execute(&del_msg_sql, rusqlite::params_from_iter(message_ids.iter()))?;
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::{apply_pending, MigrationRoot};

    fn fresh_conn() -> Connection {
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

    fn user_msg(id: &str, story_id: &str, created_at: &str, content: &str) -> ChatMessage {
        ChatMessage {
            id: id.into(),
            story_id: story_id.into(),
            session_id: None,
            role: "user".into(),
            content_type: "json_user".into(),
            content: content.into(),
            token_count: None,
            model_name: None,
            finish_reason: None,
            created_at: created_at.into(),
            deleted_at: None,
            user_feedback: None,
            ghostwriter_history: "[]".into(),
            kind: "story".into(),
        }
    }

    fn model_msg(id: &str, story_id: &str, created_at: &str, content: &str) -> ChatMessage {
        ChatMessage {
            id: id.into(),
            story_id: story_id.into(),
            session_id: None,
            role: "model".into(),
            content_type: "text".into(),
            content: content.into(),
            token_count: None,
            model_name: None,
            finish_reason: None,
            created_at: created_at.into(),
            deleted_at: None,
            user_feedback: None,
            ghostwriter_history: "[]".into(),
            kind: "story".into(),
        }
    }

    #[test]
    fn insert_and_list_round_trip() {
        let c = fresh_conn();
        insert_message(&c, &user_msg("u1", "story1", "2026-01-01T00:00:01Z", "hi")).unwrap();
        insert_message(
            &c,
            &model_msg("m1", "story1", "2026-01-01T00:00:02Z", "hello"),
        )
        .unwrap();
        let rows = list_story_messages(&c, "story1").unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].id, "u1");
        assert_eq!(rows[1].id, "m1");
    }

    #[test]
    fn list_excludes_session_kind() {
        let c = fresh_conn();
        c.execute(
            "INSERT INTO conversation_sessions
                (id, story_id, kind, name, entry_snapshot, created_at, modified_at)
             VALUES ('sess1', 'story1', 'consulting', 'C', '{}',
                     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        insert_message(
            &c,
            &user_msg("u1", "story1", "2026-01-01T00:00:01Z", "story-u"),
        )
        .unwrap();
        let mut session_msg = user_msg("s1", "story1", "2026-01-01T00:00:02Z", "session-u");
        session_msg.kind = "consulting".into();
        session_msg.session_id = Some("sess1".into());
        insert_message(&c, &session_msg).unwrap();
        let rows = list_story_messages(&c, "story1").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "u1");

        // list_all_messages returns both
        let all = list_all_messages(&c, "story1").unwrap();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn truncate_story_after_drops_only_following() {
        let mut c = fresh_conn();
        insert_message(&c, &user_msg("u1", "story1", "2026-01-01T00:00:01Z", "a")).unwrap();
        insert_message(&c, &model_msg("m1", "story1", "2026-01-01T00:00:02Z", "A")).unwrap();
        insert_message(&c, &user_msg("u2", "story1", "2026-01-01T00:00:03Z", "b")).unwrap();
        insert_message(&c, &model_msg("m2", "story1", "2026-01-01T00:00:04Z", "B")).unwrap();

        let n = truncate_story_after(&mut c, "story1", "2026-01-01T00:00:01Z", "u1").unwrap();
        assert_eq!(n, 3);
        let rows = list_story_messages(&c, "story1").unwrap();
        assert_eq!(
            rows.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            vec!["u1"]
        );
    }

    #[test]
    fn delete_exchange_drops_user_and_model_pair() {
        let mut c = fresh_conn();
        insert_message(&c, &user_msg("u1", "story1", "2026-01-01T00:00:01Z", "a")).unwrap();
        insert_message(&c, &model_msg("m1", "story1", "2026-01-01T00:00:02Z", "A")).unwrap();
        insert_message(&c, &user_msg("u2", "story1", "2026-01-01T00:00:03Z", "b")).unwrap();
        insert_message(&c, &model_msg("m2", "story1", "2026-01-01T00:00:04Z", "B")).unwrap();

        let n = delete_exchange(&mut c, "m1").unwrap();
        assert_eq!(n, 2);
        let ids: Vec<_> = list_story_messages(&c, "story1")
            .unwrap()
            .into_iter()
            .map(|m| m.id)
            .collect();
        assert_eq!(ids, vec!["u2", "m2"]);
    }

    #[test]
    fn delete_exchange_orphan_user_alone() {
        let mut c = fresh_conn();
        insert_message(&c, &user_msg("u1", "story1", "2026-01-01T00:00:01Z", "a")).unwrap();
        // No matching model — represents a failed/cancelled generation.
        let n = delete_exchange(&mut c, "u1").unwrap();
        assert_eq!(n, 1);
        assert_eq!(list_story_messages(&c, "story1").unwrap().len(), 0);
    }

    #[test]
    fn delete_from_drops_anchor_and_following() {
        let mut c = fresh_conn();
        insert_message(&c, &user_msg("u1", "story1", "2026-01-01T00:00:01Z", "a")).unwrap();
        insert_message(&c, &model_msg("m1", "story1", "2026-01-01T00:00:02Z", "A")).unwrap();
        insert_message(&c, &user_msg("u2", "story1", "2026-01-01T00:00:03Z", "b")).unwrap();
        insert_message(&c, &model_msg("m2", "story1", "2026-01-01T00:00:04Z", "B")).unwrap();

        // Anchoring on a model message rolls back to the matching user.
        let n = delete_from(&mut c, "m1").unwrap();
        assert_eq!(n, 4);
        assert_eq!(list_story_messages(&c, "story1").unwrap().len(), 0);
    }

    #[test]
    fn delete_last_story_message_returns_id_and_drops_row() {
        let mut c = fresh_conn();
        insert_message(&c, &user_msg("u1", "story1", "2026-01-01T00:00:01Z", "a")).unwrap();
        insert_message(&c, &model_msg("m1", "story1", "2026-01-01T00:00:02Z", "A")).unwrap();
        let dropped = delete_last_story_message(&mut c, "story1").unwrap();
        assert_eq!(dropped.as_deref(), Some("m1"));
        let rows = list_story_messages(&c, "story1").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "u1");
    }

    #[test]
    fn cascade_drops_anchored_checkpoint_and_segment() {
        let mut c = fresh_conn();
        insert_message(&c, &user_msg("u1", "story1", "2026-01-01T00:00:01Z", "a")).unwrap();
        insert_message(&c, &model_msg("m1", "story1", "2026-01-01T00:00:02Z", "A")).unwrap();
        insert_message(&c, &user_msg("u2", "story1", "2026-01-01T00:00:03Z", "b")).unwrap();
        insert_message(&c, &model_msg("m2", "story1", "2026-01-01T00:00:04Z", "B")).unwrap();
        c.execute(
            "INSERT INTO checkpoints (id, story_id, after_message_id, name, is_start, created_at, modified_at)
             VALUES ('cp_start', 'story1', NULL, 'Chapter 1', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
                    ('cp_after_m1', 'story1', 'm1', 'Chapter 2', 0, '2026-01-01T00:00:02Z', '2026-01-01T00:00:02Z')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO accordion_segments
                (id, story_id, start_cp_id, end_cp_id, summary, is_collapsed, use_summary, is_stale,
                 summarised_at, created_at, modified_at)
             VALUES ('seg1', 'story1', 'cp_start', 'cp_after_m1', NULL, 0, 1, 0, NULL,
                     '2026-01-01T00:00:02Z', '2026-01-01T00:00:02Z')",
            [],
        )
        .unwrap();

        // Deleting m1 must drop cp_after_m1 (anchored) and seg1 (references it).
        truncate_story_after(&mut c, "story1", "2026-01-01T00:00:01Z", "u1").unwrap();

        let cp_count: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM checkpoints WHERE id = 'cp_after_m1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cp_count, 0);
        let seg_count: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM accordion_segments WHERE id = 'seg1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(seg_count, 0);
        // Start sentinel is unaffected.
        let start_count: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM checkpoints WHERE id = 'cp_start'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(start_count, 1);
    }

    #[test]
    fn update_message_content_writes_metadata() {
        let c = fresh_conn();
        insert_message(&c, &model_msg("m1", "story1", "2026-01-01T00:00:01Z", "")).unwrap();
        update_message_content(
            &c,
            "m1",
            "final",
            Some(123),
            Some("gemini-2.5-flash"),
            Some("STOP"),
        )
        .unwrap();
        let m = get_message(&c, "m1").unwrap().unwrap();
        assert_eq!(m.content, "final");
        assert_eq!(m.token_count, Some(123));
        assert_eq!(m.model_name.as_deref(), Some("gemini-2.5-flash"));
        assert_eq!(m.finish_reason.as_deref(), Some("STOP"));
    }

    #[test]
    fn update_user_feedback_round_trip() {
        let c = fresh_conn();
        insert_message(&c, &model_msg("m1", "story1", "2026-01-01T00:00:01Z", "x")).unwrap();
        update_user_feedback(&c, "m1", "more dialogue").unwrap();
        let m = get_message(&c, "m1").unwrap().unwrap();
        assert_eq!(m.user_feedback.as_deref(), Some("more dialogue"));
        update_user_feedback(&c, "m1", "").unwrap();
        let m = get_message(&c, "m1").unwrap().unwrap();
        assert_eq!(m.user_feedback.as_deref(), Some(""));
    }
}
