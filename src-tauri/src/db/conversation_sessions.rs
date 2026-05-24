//! Typed CRUD against the `conversation_sessions` table (Doc 03 §`conversation_sessions`,
//! Doc 23). A session is a self-contained sub-conversation (handover or
//! consulting) anchored to a story at a specific point in time.
//!
//! Per Doc 05 §Dependency Rules, `db/` may import only `rusqlite`. Lifecycle
//! (snapshot capture, cache create/drop, naming) lives in `services/modes.rs`.
//!
//! v2.0 deletion is hard-delete with FK CASCADE: removing a session row drops
//! every `messages` row whose `session_id` matches.

use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::LoomError;

/// IPC payload per Doc 03 §TypeScript Interfaces. `entry_snapshot` ships as
/// a JSON string; the frontend rarely needs to parse it (the cache rebuild
/// path is backend-only).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/lib/types.generated.ts")]
pub struct ConversationSession {
    pub id: String,
    pub story_id: String,
    pub kind: String, // 'handover' | 'consulting'
    pub name: String,
    pub entry_message_id: Option<String>,
    pub entry_snapshot: String, // JSON; see Doc 22 §Session Snapshot
    pub is_collapsed: bool,
    /// Populated only for consulting sessions with an active Gemini cache.
    /// Handover never sets these; the table CHECK enforces it.
    pub cache_name: Option<String>,
    pub cache_expiry_at: Option<String>,
    pub cache_is_stale: bool,
    pub created_at: String,
    pub modified_at: String,
}

const SESSION_COLUMNS: &str = "id, story_id, kind, name, entry_message_id, \
                               entry_snapshot, is_collapsed, cache_name, \
                               cache_expiry_at, cache_is_stale, \
                               created_at, modified_at";

fn row_to_session(row: &Row<'_>) -> rusqlite::Result<ConversationSession> {
    Ok(ConversationSession {
        id: row.get("id")?,
        story_id: row.get("story_id")?,
        kind: row.get("kind")?,
        name: row.get("name")?,
        entry_message_id: row.get("entry_message_id")?,
        entry_snapshot: row.get("entry_snapshot")?,
        is_collapsed: row.get::<_, i64>("is_collapsed")? != 0,
        cache_name: row.get("cache_name")?,
        cache_expiry_at: row.get("cache_expiry_at")?,
        cache_is_stale: row.get::<_, i64>("cache_is_stale")? != 0,
        created_at: row.get("created_at")?,
        modified_at: row.get("modified_at")?,
    })
}

pub fn insert_session(conn: &Connection, s: &ConversationSession) -> Result<(), LoomError> {
    conn.execute(
        "INSERT INTO conversation_sessions
            (id, story_id, kind, name, entry_message_id, entry_snapshot,
             is_collapsed, cache_name, cache_expiry_at, cache_is_stale,
             created_at, modified_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            s.id,
            s.story_id,
            s.kind,
            s.name,
            s.entry_message_id,
            s.entry_snapshot,
            s.is_collapsed as i64,
            s.cache_name,
            s.cache_expiry_at,
            s.cache_is_stale as i64,
            s.created_at,
            s.modified_at,
        ],
    )?;
    Ok(())
}

pub fn get_session(conn: &Connection, id: &str) -> Result<Option<ConversationSession>, LoomError> {
    let sql = format!("SELECT {SESSION_COLUMNS} FROM conversation_sessions WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let row = stmt.query_row(params![id], row_to_session).ok();
    Ok(row)
}

/// Every session for a story, ordered by `created_at` (matches Doc 23 list
/// semantics). Sessions are not soft-deleted — there's no `deleted_at` here.
pub fn list_sessions_for_story(
    conn: &Connection,
    story_id: &str,
) -> Result<Vec<ConversationSession>, LoomError> {
    let sql = format!(
        "SELECT {SESSION_COLUMNS} FROM conversation_sessions
         WHERE story_id = ?1
         ORDER BY created_at ASC, id ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![story_id], row_to_session)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Count sessions of a specific kind on a story. Used by `next_session_name`
/// to compute the next monotonic default (`"Handover 3"`, etc.).
pub fn count_sessions_by_kind(
    conn: &Connection,
    story_id: &str,
    kind: &str,
) -> Result<i64, LoomError> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM conversation_sessions WHERE story_id = ?1 AND kind = ?2",
        params![story_id, kind],
        |r| r.get(0),
    )?;
    Ok(n)
}

pub fn update_session_name(
    conn: &Connection,
    id: &str,
    name: &str,
    modified_at: &str,
) -> Result<(), LoomError> {
    conn.execute(
        "UPDATE conversation_sessions SET name = ?1, modified_at = ?2 WHERE id = ?3",
        params![name, modified_at, id],
    )?;
    Ok(())
}

pub fn update_session_collapsed(
    conn: &Connection,
    id: &str,
    collapsed: bool,
    modified_at: &str,
) -> Result<(), LoomError> {
    conn.execute(
        "UPDATE conversation_sessions SET is_collapsed = ?1, modified_at = ?2 WHERE id = ?3",
        params![collapsed as i64, modified_at, id],
    )?;
    Ok(())
}

/// Write the cache triple for a consulting session. Pass `None` everywhere
/// to clear (exit-session path). The table CHECK enforces that handover
/// sessions never carry cache state — callers must respect that. Phase 6
/// wires real cache creation; Phase 4 leaves these NULL.
pub fn update_session_cache(
    conn: &Connection,
    id: &str,
    cache_name: Option<&str>,
    cache_expiry_at: Option<&str>,
    cache_is_stale: bool,
    modified_at: &str,
) -> Result<(), LoomError> {
    conn.execute(
        "UPDATE conversation_sessions SET
            cache_name = ?1,
            cache_expiry_at = ?2,
            cache_is_stale = ?3,
            modified_at = ?4
         WHERE id = ?5",
        params![
            cache_name,
            cache_expiry_at,
            cache_is_stale as i64,
            modified_at,
            id
        ],
    )?;
    Ok(())
}

/// Row used by `list_alive_caches` for the right-pane Cache section
/// (consulting half). Joined to `items.name` for the story label.
#[derive(Debug, Clone)]
pub struct AliveSessionRow {
    pub story_id: String,
    pub story_name: String,
    pub session_id: String,
    pub session_name: String,
    pub expiry_at: String,
    pub is_stale: bool,
}

/// Every consulting session with `cache_name IS NOT NULL`.
pub fn list_alive_session_rows(conn: &Connection) -> Result<Vec<AliveSessionRow>, LoomError> {
    let mut stmt = conn.prepare(
        "SELECT cs.story_id, i.name, cs.id, cs.name, cs.cache_expiry_at, cs.cache_is_stale
         FROM conversation_sessions cs
         JOIN items i ON i.id = cs.story_id
         WHERE cs.kind = 'consulting' AND cs.cache_name IS NOT NULL
         ORDER BY cs.cache_expiry_at",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(AliveSessionRow {
            story_id: r.get(0)?,
            story_name: r.get(1)?,
            session_id: r.get(2)?,
            session_name: r.get(3)?,
            expiry_at: r.get::<_, Option<String>>(4)?.unwrap_or_default(),
            is_stale: r.get::<_, i64>(5)? != 0,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Hard-delete a session row. The `messages` FK has `ON DELETE CASCADE`, so
/// every message in the session is dropped in the same transaction.
pub fn delete_session(conn: &Connection, id: &str) -> Result<(), LoomError> {
    conn.execute(
        "DELETE FROM conversation_sessions WHERE id = ?1",
        params![id],
    )?;
    Ok(())
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
             VALUES ('story1', 'Story', 'Test', 0,
                     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        c
    }

    fn handover_row(id: &str, name: &str, created_at: &str) -> ConversationSession {
        ConversationSession {
            id: id.into(),
            story_id: "story1".into(),
            kind: "handover".into(),
            name: name.into(),
            entry_message_id: None,
            entry_snapshot: "{}".into(),
            is_collapsed: false,
            cache_name: None,
            cache_expiry_at: None,
            cache_is_stale: false,
            created_at: created_at.into(),
            modified_at: created_at.into(),
        }
    }

    #[test]
    fn insert_then_get_round_trips() {
        let c = fresh_conn();
        insert_session(
            &c,
            &handover_row("s1", "Handover 1", "2026-01-01T00:00:01Z"),
        )
        .unwrap();
        let got = get_session(&c, "s1").unwrap().unwrap();
        assert_eq!(got.id, "s1");
        assert_eq!(got.kind, "handover");
        assert_eq!(got.name, "Handover 1");
        assert!(!got.is_collapsed);
    }

    #[test]
    fn list_sessions_orders_by_created_at() {
        let c = fresh_conn();
        insert_session(&c, &handover_row("a", "A", "2026-01-01T00:00:02Z")).unwrap();
        insert_session(&c, &handover_row("b", "B", "2026-01-01T00:00:01Z")).unwrap();
        let rows = list_sessions_for_story(&c, "story1").unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].id, "b");
        assert_eq!(rows[1].id, "a");
    }

    #[test]
    fn count_sessions_by_kind_only_counts_matching() {
        let c = fresh_conn();
        insert_session(
            &c,
            &handover_row("h1", "Handover 1", "2026-01-01T00:00:01Z"),
        )
        .unwrap();
        let mut consulting = handover_row("c1", "Consulting 1", "2026-01-01T00:00:02Z");
        consulting.kind = "consulting".into();
        insert_session(&c, &consulting).unwrap();
        assert_eq!(count_sessions_by_kind(&c, "story1", "handover").unwrap(), 1);
        assert_eq!(
            count_sessions_by_kind(&c, "story1", "consulting").unwrap(),
            1
        );
    }

    #[test]
    fn update_name_and_collapsed() {
        let c = fresh_conn();
        insert_session(
            &c,
            &handover_row("s1", "Handover 1", "2026-01-01T00:00:01Z"),
        )
        .unwrap();
        update_session_name(&c, "s1", "Briefing", "2026-01-01T00:00:02Z").unwrap();
        update_session_collapsed(&c, "s1", true, "2026-01-01T00:00:03Z").unwrap();
        let got = get_session(&c, "s1").unwrap().unwrap();
        assert_eq!(got.name, "Briefing");
        assert!(got.is_collapsed);
        assert_eq!(got.modified_at, "2026-01-01T00:00:03Z");
    }

    #[test]
    fn update_session_cache_writes_consulting_fields() {
        let c = fresh_conn();
        let mut consulting = handover_row("c1", "Consulting 1", "2026-01-01T00:00:01Z");
        consulting.kind = "consulting".into();
        insert_session(&c, &consulting).unwrap();
        update_session_cache(
            &c,
            "c1",
            Some("cachedContents/abc"),
            Some("2026-01-01T01:00:00Z"),
            false,
            "2026-01-01T00:00:02Z",
        )
        .unwrap();
        let got = get_session(&c, "c1").unwrap().unwrap();
        assert_eq!(got.cache_name.as_deref(), Some("cachedContents/abc"));
        assert_eq!(got.cache_expiry_at.as_deref(), Some("2026-01-01T01:00:00Z"));
        assert!(!got.cache_is_stale);
    }

    #[test]
    fn update_session_cache_rejects_handover_via_table_check() {
        let c = fresh_conn();
        insert_session(
            &c,
            &handover_row("h1", "Handover 1", "2026-01-01T00:00:01Z"),
        )
        .unwrap();
        let err = update_session_cache(
            &c,
            "h1",
            Some("cachedContents/abc"),
            None,
            false,
            "2026-01-01T00:00:02Z",
        );
        // The CHECK constraint rejects cache fields on handover rows.
        assert!(err.is_err());
    }

    #[test]
    fn delete_session_cascades_messages() {
        let c = fresh_conn();
        insert_session(&c, &handover_row("s1", "H1", "2026-01-01T00:00:01Z")).unwrap();
        c.execute(
            "INSERT INTO messages
                (id, story_id, session_id, role, content_type, content,
                 created_at, kind)
             VALUES ('m1', 'story1', 's1', 'user', 'text', 'hi',
                     '2026-01-01T00:00:02Z', 'handover')",
            [],
        )
        .unwrap();
        delete_session(&c, "s1").unwrap();
        let count: i64 = c
            .query_row("SELECT COUNT(*) FROM messages WHERE id = 'm1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(count, 0);
    }
}
