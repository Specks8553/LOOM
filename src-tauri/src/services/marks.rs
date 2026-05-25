//! Mark policy (Doc 30 §8 — Orphaning).
//!
//! `db/marks.rs` is pure CRUD. This layer re-evaluates a message's marks after
//! an in-place content mutation — it needs the `UserContent` parser to match a
//! quoted passage against the *rendered* user fields, which `db/` may not import.

use rusqlite::Connection;

use crate::db::marks as db_marks;
use crate::db::messages::get_message;
use crate::error::LoomError;
use crate::services::history::UserContent;

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Re-evaluate every mark on `message_id` after its host content changed in
/// place (Ghostwriter accept / revert, model edit, user edit). A mark whose
/// `quoted_text` still occurs is re-anchored (model bubbles get fresh char
/// offsets; user bubbles keep NULL offsets); one whose passage is gone is
/// orphaned. Returns `true` when any row changed.
pub fn reevaluate_for_message(conn: &Connection, message_id: &str) -> Result<bool, LoomError> {
    let Some(msg) = get_message(conn, message_id)? else {
        return Ok(false);
    };
    let marks = db_marks::list_for_message(conn, message_id)?;
    if marks.is_empty() {
        return Ok(false);
    }
    let now = now_iso();
    let mut changed = false;
    for m in &marks {
        match locate(&msg.content_type, &msg.content, &m.quoted_text) {
            Some((cs, ce)) => {
                if m.is_orphaned || m.char_start != cs || m.char_end != ce {
                    db_marks::set_anchor(conn, &m.id, cs, ce, &now)?;
                    changed = true;
                }
            }
            None => {
                if !m.is_orphaned {
                    db_marks::set_orphaned(conn, &m.id, &now)?;
                    changed = true;
                }
            }
        }
    }
    Ok(changed)
}

/// Locate `quote` in a message's content. Returns `None` when absent.
///
/// - `text` (model bubble): character offsets into `content` when present.
/// - `json_user` (user bubble): matched against the rendered fields; offsets
///   stay `None` (multi-field render has no single-string offset, Doc 30 §5).
fn locate(content_type: &str, content: &str, quote: &str) -> Option<(Option<i64>, Option<i64>)> {
    match content_type {
        "text" => content.find(quote).map(|byte_idx| {
            let start = content[..byte_idx].chars().count() as i64;
            let end = start + quote.chars().count() as i64;
            (Some(start), Some(end))
        }),
        "json_user" => {
            let found = serde_json::from_str::<UserContent>(content)
                .map(|uc| {
                    uc.plot_direction.contains(quote)
                        || uc.background_information.contains(quote)
                        || uc.constraints.contains(quote)
                        || uc.modificators.iter().any(|m| m.contains(quote))
                })
                .unwrap_or_else(|_| content.contains(quote));
            found.then_some((None, None))
        }
        _ => content.contains(quote).then_some((None, None)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::marks::ImportantMark;
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
        c
    }

    fn seed_model(conn: &Connection, id: &str, content: &str) {
        conn.execute(
            "INSERT INTO messages (id, story_id, session_id, kind, role, content_type, content, created_at)
             VALUES (?1, 'story1', NULL, 'story', 'model', 'text', ?2, '2026-01-01T00:00:01Z')",
            rusqlite::params![id, content],
        )
        .unwrap();
    }

    fn seed_mark(conn: &Connection, id: &str, message_id: &str, quote: &str) {
        db_marks::insert_mark(
            conn,
            &ImportantMark {
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
            },
        )
        .unwrap();
    }

    #[test]
    fn orphans_when_passage_removed() {
        let c = open();
        seed_model(&c, "m1", "the cat sat on the mat");
        seed_mark(&c, "k1", "m1", "the cat");
        // Rewrite content so "the cat" no longer appears.
        c.execute(
            "UPDATE messages SET content = 'a dog ran' WHERE id = 'm1'",
            [],
        )
        .unwrap();
        let changed = reevaluate_for_message(&c, "m1").unwrap();
        assert!(changed);
        assert!(db_marks::get_mark(&c, "k1").unwrap().unwrap().is_orphaned);
    }

    #[test]
    fn reanchors_when_passage_shifts() {
        let c = open();
        seed_model(&c, "m1", "the cat sat");
        seed_mark(&c, "k1", "m1", "cat");
        // Prepend text — "cat" shifts to a later offset.
        c.execute(
            "UPDATE messages SET content = 'oh, the cat sat' WHERE id = 'm1'",
            [],
        )
        .unwrap();
        assert!(reevaluate_for_message(&c, "m1").unwrap());
        let m = db_marks::get_mark(&c, "k1").unwrap().unwrap();
        assert!(!m.is_orphaned);
        assert_eq!(m.char_start, Some(8)); // index of "cat" in "oh, the cat sat"
        assert_eq!(m.char_end, Some(11));
    }

    #[test]
    fn revive_orphan_when_passage_returns() {
        let c = open();
        seed_model(&c, "m1", "nothing here");
        seed_mark(&c, "k1", "m1", "cat");
        db_marks::set_orphaned(&c, "k1", "2026-01-01T00:00:03Z").unwrap();
        c.execute(
            "UPDATE messages SET content = 'a cat appears' WHERE id = 'm1'",
            [],
        )
        .unwrap();
        assert!(reevaluate_for_message(&c, "m1").unwrap());
        assert!(!db_marks::get_mark(&c, "k1").unwrap().unwrap().is_orphaned);
    }
}
