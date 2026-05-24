//! Typed CRUD against the `important_marks` table (Doc 03 §`important_marks`,
//! Doc 30).
//!
//! Per Doc 05 §Dependency Rules, `db/` may import `rusqlite` only — orphan
//! re-evaluation (which needs the `UserContent` parser) lives in
//! `services/marks.rs`; event emission and accordion-stale wiring live in
//! `commands/marks.rs`.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::LoomError;

/// IPC payload for one mark row (Doc 03 §Marks).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/lib/types.generated.ts")]
pub struct ImportantMark {
    pub id: String,
    pub story_id: String,
    pub message_id: String,
    pub quoted_text: String,
    pub note: Option<String>,
    #[ts(type = "number | null")]
    pub char_start: Option<i64>,
    #[ts(type = "number | null")]
    pub char_end: Option<i64>,
    pub is_orphaned: bool,
    pub created_at: String,
    pub modified_at: String,
}

const COLS: &str =
    "id, story_id, message_id, quoted_text, note, char_start, char_end, is_orphaned, \
     created_at, modified_at";

fn row_to_mark(row: &Row<'_>) -> rusqlite::Result<ImportantMark> {
    Ok(ImportantMark {
        id: row.get("id")?,
        story_id: row.get("story_id")?,
        message_id: row.get("message_id")?,
        quoted_text: row.get("quoted_text")?,
        note: row.get("note")?,
        char_start: row.get("char_start")?,
        char_end: row.get("char_end")?,
        is_orphaned: row.get::<_, i64>("is_orphaned")? != 0,
        created_at: row.get("created_at")?,
        modified_at: row.get("modified_at")?,
    })
}

// ---- Reads ---------------------------------------------------------------

pub fn get_mark(conn: &Connection, id: &str) -> Result<Option<ImportantMark>, LoomError> {
    let sql = format!("SELECT {COLS} FROM important_marks WHERE id = ?1");
    Ok(conn
        .prepare(&sql)?
        .query_row(params![id], row_to_mark)
        .optional()?)
}

/// All marks for a story (both roles, including orphaned), oldest first.
pub fn list_for_story(conn: &Connection, story_id: &str) -> Result<Vec<ImportantMark>, LoomError> {
    let sql = format!(
        "SELECT {COLS} FROM important_marks WHERE story_id = ?1 ORDER BY created_at ASC, id ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![story_id], row_to_mark)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// All marks anchored to a single message (including orphaned).
pub fn list_for_message(
    conn: &Connection,
    message_id: &str,
) -> Result<Vec<ImportantMark>, LoomError> {
    let sql = format!(
        "SELECT {COLS} FROM important_marks WHERE message_id = ?1 ORDER BY created_at ASC, id ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![message_id], row_to_mark)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

// ---- Writes --------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
pub fn insert_mark(conn: &Connection, mark: &ImportantMark) -> Result<(), LoomError> {
    conn.execute(
        "INSERT INTO important_marks
            (id, story_id, message_id, quoted_text, note, char_start, char_end,
             is_orphaned, created_at, modified_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            mark.id,
            mark.story_id,
            mark.message_id,
            mark.quoted_text,
            mark.note,
            mark.char_start,
            mark.char_end,
            mark.is_orphaned as i64,
            mark.created_at,
            mark.modified_at,
        ],
    )?;
    Ok(())
}

pub fn delete_mark(conn: &Connection, id: &str) -> Result<(), LoomError> {
    conn.execute("DELETE FROM important_marks WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn update_note(
    conn: &Connection,
    id: &str,
    note: Option<&str>,
    now_iso: &str,
) -> Result<(), LoomError> {
    conn.execute(
        "UPDATE important_marks SET note = ?1, modified_at = ?2 WHERE id = ?3",
        params![note, now_iso, id],
    )?;
    Ok(())
}

/// Re-anchor a still-valid mark to fresh offsets and clear the orphan flag.
pub fn set_anchor(
    conn: &Connection,
    id: &str,
    char_start: Option<i64>,
    char_end: Option<i64>,
    now_iso: &str,
) -> Result<(), LoomError> {
    conn.execute(
        "UPDATE important_marks
         SET is_orphaned = 0, char_start = ?1, char_end = ?2, modified_at = ?3
         WHERE id = ?4",
        params![char_start, char_end, now_iso, id],
    )?;
    Ok(())
}

/// Flag a mark whose passage no longer exists in its host message. Clears the
/// offsets (they no longer index into anything).
pub fn set_orphaned(conn: &Connection, id: &str, now_iso: &str) -> Result<(), LoomError> {
    conn.execute(
        "UPDATE important_marks
         SET is_orphaned = 1, char_start = NULL, char_end = NULL, modified_at = ?1
         WHERE id = ?2",
        params![now_iso, id],
    )?;
    Ok(())
}

// ---- Tests ---------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::{apply_pending, MigrationRoot};

    fn open() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        apply_pending(&mut c, MigrationRoot::World).unwrap();
        c.execute(
            "INSERT INTO items (id, item_type, name, sort_order, created_at, modified_at)
             VALUES ('story1', 'Story', 'S', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO messages (id, story_id, session_id, kind, role, content_type, content, created_at)
             VALUES ('m1', 'story1', NULL, 'story', 'model', 'text', 'hello world', '2026-01-01T00:00:01Z')",
            [],
        )
        .unwrap();
        c
    }

    fn mark(id: &str, message_id: &str, quote: &str) -> ImportantMark {
        ImportantMark {
            id: id.into(),
            story_id: "story1".into(),
            message_id: message_id.into(),
            quoted_text: quote.into(),
            note: None,
            char_start: Some(0),
            char_end: Some(quote.chars().count() as i64),
            is_orphaned: false,
            created_at: "2026-01-01T00:00:02Z".into(),
            modified_at: "2026-01-01T00:00:02Z".into(),
        }
    }

    #[test]
    fn insert_list_round_trip() {
        let c = open();
        insert_mark(&c, &mark("k1", "m1", "hello")).unwrap();
        let by_story = list_for_story(&c, "story1").unwrap();
        assert_eq!(by_story.len(), 1);
        assert_eq!(by_story[0].quoted_text, "hello");
        let by_msg = list_for_message(&c, "m1").unwrap();
        assert_eq!(by_msg.len(), 1);
    }

    #[test]
    fn note_and_orphan_updates() {
        let c = open();
        insert_mark(&c, &mark("k1", "m1", "hello")).unwrap();
        update_note(&c, "k1", Some("keep"), "2026-01-02T00:00:00Z").unwrap();
        assert_eq!(
            get_mark(&c, "k1").unwrap().unwrap().note.as_deref(),
            Some("keep")
        );
        set_orphaned(&c, "k1", "2026-01-03T00:00:00Z").unwrap();
        let m = get_mark(&c, "k1").unwrap().unwrap();
        assert!(m.is_orphaned);
        assert!(m.char_start.is_none());
        set_anchor(&c, "k1", Some(2), Some(7), "2026-01-04T00:00:00Z").unwrap();
        let m = get_mark(&c, "k1").unwrap().unwrap();
        assert!(!m.is_orphaned);
        assert_eq!(m.char_start, Some(2));
    }

    #[test]
    fn cascade_deletes_marks_with_message() {
        let c = open();
        insert_mark(&c, &mark("k1", "m1", "hello")).unwrap();
        c.execute("DELETE FROM messages WHERE id = 'm1'", [])
            .unwrap();
        // FK ON DELETE CASCADE removes the mark (FK enforcement is on at runtime).
        assert!(list_for_story(&c, "story1").unwrap().is_empty());
    }

    #[test]
    fn delete_mark_removes_row() {
        let c = open();
        insert_mark(&c, &mark("k1", "m1", "hello")).unwrap();
        delete_mark(&c, "k1").unwrap();
        assert!(list_for_story(&c, "story1").unwrap().is_empty());
    }
}
