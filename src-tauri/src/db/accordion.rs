//! Typed CRUD against the `checkpoints` and `accordion_segments` tables
//! (Doc 03 §`checkpoints`, §`accordion_segments`; Doc 16).
//!
//! Per Doc 05 §Dependency Rules, `db/` may import `rusqlite` only — event
//! emission, Gemini calls, and lifecycle policy live in `services/accordion.rs`
//! and `commands/accordion.rs`.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::LoomError;

/// IPC payload for a checkpoint row.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/lib/types.generated.ts")]
pub struct Checkpoint {
    pub id: String,
    pub story_id: String,
    /// `None` only on the start sentinel.
    pub after_message_id: Option<String>,
    pub name: String,
    pub is_start: bool,
    pub created_at: String,
    pub modified_at: String,
}

/// IPC payload for a closed segment row.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/lib/types.generated.ts")]
pub struct AccordionSegment {
    pub id: String,
    pub story_id: String,
    pub start_cp_id: String,
    pub end_cp_id: String,
    pub summary: Option<String>,
    pub is_collapsed: bool,
    pub use_summary: bool,
    pub is_stale: bool,
    pub summarised_at: Option<String>,
    pub created_at: String,
    pub modified_at: String,
}

/// Aggregate payload returned by `get_accordion_state`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/lib/types.generated.ts")]
pub struct AccordionState {
    pub checkpoints: Vec<Checkpoint>,
    pub segments: Vec<AccordionSegment>,
}

fn cp_row(row: &Row<'_>) -> rusqlite::Result<Checkpoint> {
    Ok(Checkpoint {
        id: row.get("id")?,
        story_id: row.get("story_id")?,
        after_message_id: row.get("after_message_id")?,
        name: row.get("name")?,
        is_start: row.get::<_, i64>("is_start")? != 0,
        created_at: row.get("created_at")?,
        modified_at: row.get("modified_at")?,
    })
}

fn seg_row(row: &Row<'_>) -> rusqlite::Result<AccordionSegment> {
    Ok(AccordionSegment {
        id: row.get("id")?,
        story_id: row.get("story_id")?,
        start_cp_id: row.get("start_cp_id")?,
        end_cp_id: row.get("end_cp_id")?,
        summary: row.get("summary")?,
        is_collapsed: row.get::<_, i64>("is_collapsed")? != 0,
        use_summary: row.get::<_, i64>("use_summary")? != 0,
        is_stale: row.get::<_, i64>("is_stale")? != 0,
        summarised_at: row.get("summarised_at")?,
        created_at: row.get("created_at")?,
        modified_at: row.get("modified_at")?,
    })
}

const CP_COLS: &str = "id, story_id, after_message_id, name, is_start, created_at, modified_at";
const SEG_COLS: &str = "id, story_id, start_cp_id, end_cp_id, summary, \
                        is_collapsed, use_summary, is_stale, summarised_at, \
                        created_at, modified_at";

// ---- Checkpoint reads ----------------------------------------------------

pub fn get_checkpoint(conn: &Connection, id: &str) -> Result<Option<Checkpoint>, LoomError> {
    let sql = format!("SELECT {CP_COLS} FROM checkpoints WHERE id = ?1");
    Ok(conn
        .prepare(&sql)?
        .query_row(params![id], cp_row)
        .optional()?)
}

/// List a story's checkpoints in chronological order. The start sentinel
/// (`is_start = 1`, `after_message_id IS NULL`) sorts first; remaining
/// checkpoints are ordered by their anchor message's `created_at`.
pub fn list_checkpoints(conn: &Connection, story_id: &str) -> Result<Vec<Checkpoint>, LoomError> {
    let sql = format!(
        "SELECT {CP_COLS} FROM checkpoints
         WHERE story_id = ?1
         ORDER BY is_start DESC,
                  COALESCE(
                      (SELECT m.created_at FROM messages m WHERE m.id = checkpoints.after_message_id),
                      checkpoints.created_at
                  ) ASC,
                  checkpoints.created_at ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![story_id], cp_row)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Find the start sentinel for a story (the row with `is_start = 1`).
pub fn get_start_sentinel(
    conn: &Connection,
    story_id: &str,
) -> Result<Option<Checkpoint>, LoomError> {
    let sql = format!(
        "SELECT {CP_COLS} FROM checkpoints
         WHERE story_id = ?1 AND is_start = 1 LIMIT 1"
    );
    Ok(conn
        .prepare(&sql)?
        .query_row(params![story_id], cp_row)
        .optional()?)
}

// ---- Checkpoint writes ---------------------------------------------------

pub fn insert_checkpoint(conn: &Connection, cp: &Checkpoint) -> Result<(), LoomError> {
    conn.execute(
        "INSERT INTO checkpoints
            (id, story_id, after_message_id, name, is_start, created_at, modified_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            cp.id,
            cp.story_id,
            cp.after_message_id,
            cp.name,
            cp.is_start as i64,
            cp.created_at,
            cp.modified_at,
        ],
    )?;
    Ok(())
}

pub fn rename_checkpoint(
    conn: &Connection,
    id: &str,
    name: &str,
    now_iso: &str,
) -> Result<(), LoomError> {
    conn.execute(
        "UPDATE checkpoints SET name = ?1, modified_at = ?2 WHERE id = ?3",
        params![name, now_iso, id],
    )?;
    Ok(())
}

pub fn delete_checkpoint(conn: &Connection, id: &str) -> Result<(), LoomError> {
    conn.execute("DELETE FROM checkpoints WHERE id = ?1", params![id])?;
    Ok(())
}

// ---- Segment reads -------------------------------------------------------

pub fn get_segment(conn: &Connection, id: &str) -> Result<Option<AccordionSegment>, LoomError> {
    let sql = format!("SELECT {SEG_COLS} FROM accordion_segments WHERE id = ?1");
    Ok(conn
        .prepare(&sql)?
        .query_row(params![id], seg_row)
        .optional()?)
}

/// List a story's closed segments. Order is by the start-checkpoint's
/// position in the story (start sentinel first, then chronological by anchor).
pub fn list_segments(
    conn: &Connection,
    story_id: &str,
) -> Result<Vec<AccordionSegment>, LoomError> {
    let sql = format!(
        "SELECT {SEG_COLS} FROM accordion_segments
         WHERE story_id = ?1
         ORDER BY (
             SELECT COALESCE(
                 (SELECT m.created_at FROM messages m
                  WHERE m.id = (SELECT after_message_id FROM checkpoints WHERE id = accordion_segments.start_cp_id)),
                 (SELECT created_at FROM checkpoints WHERE id = accordion_segments.start_cp_id)
             )
         ) ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![story_id], seg_row)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Find the (at most two) segments that reference a checkpoint as a boundary.
/// Returned tuple is `(segment_ending_at_cp, segment_starting_at_cp)`.
pub fn segments_touching_checkpoint(
    conn: &Connection,
    cp_id: &str,
) -> Result<(Option<AccordionSegment>, Option<AccordionSegment>), LoomError> {
    let ending_sql = format!("SELECT {SEG_COLS} FROM accordion_segments WHERE end_cp_id = ?1");
    let starting_sql = format!("SELECT {SEG_COLS} FROM accordion_segments WHERE start_cp_id = ?1");
    let ending = conn
        .prepare(&ending_sql)?
        .query_row(params![cp_id], seg_row)
        .optional()?;
    let starting = conn
        .prepare(&starting_sql)?
        .query_row(params![cp_id], seg_row)
        .optional()?;
    Ok((ending, starting))
}

// ---- Segment writes ------------------------------------------------------

pub fn insert_segment(conn: &Connection, seg: &AccordionSegment) -> Result<(), LoomError> {
    conn.execute(
        "INSERT INTO accordion_segments
            (id, story_id, start_cp_id, end_cp_id, summary, is_collapsed,
             use_summary, is_stale, summarised_at, created_at, modified_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            seg.id,
            seg.story_id,
            seg.start_cp_id,
            seg.end_cp_id,
            seg.summary,
            seg.is_collapsed as i64,
            seg.use_summary as i64,
            seg.is_stale as i64,
            seg.summarised_at,
            seg.created_at,
            seg.modified_at,
        ],
    )?;
    Ok(())
}

pub fn delete_segment(conn: &Connection, id: &str) -> Result<(), LoomError> {
    conn.execute("DELETE FROM accordion_segments WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn update_summary(
    conn: &Connection,
    id: &str,
    summary: &str,
    summarised_at: &str,
    now_iso: &str,
) -> Result<(), LoomError> {
    conn.execute(
        "UPDATE accordion_segments SET
            summary = ?1, summarised_at = ?2, is_stale = 0, modified_at = ?3
         WHERE id = ?4",
        params![summary, summarised_at, now_iso, id],
    )?;
    Ok(())
}

/// Reset the segment to its newly-created state (`summary = NULL`,
/// `summarised_at = NULL`, `is_collapsed = 0`, `use_summary = 1`,
/// `is_stale = 0`).
pub fn clear_summary(conn: &Connection, id: &str, now_iso: &str) -> Result<(), LoomError> {
    conn.execute(
        "UPDATE accordion_segments SET
            summary = NULL, summarised_at = NULL,
            is_collapsed = 0, use_summary = 1, is_stale = 0,
            modified_at = ?1
         WHERE id = ?2",
        params![now_iso, id],
    )?;
    Ok(())
}

pub fn set_collapsed(
    conn: &Connection,
    id: &str,
    collapsed: bool,
    now_iso: &str,
) -> Result<(), LoomError> {
    conn.execute(
        "UPDATE accordion_segments SET is_collapsed = ?1, modified_at = ?2 WHERE id = ?3",
        params![collapsed as i64, now_iso, id],
    )?;
    Ok(())
}

pub fn set_use_summary(
    conn: &Connection,
    id: &str,
    use_summary: bool,
    now_iso: &str,
) -> Result<(), LoomError> {
    conn.execute(
        "UPDATE accordion_segments SET use_summary = ?1, modified_at = ?2 WHERE id = ?3",
        params![use_summary as i64, now_iso, id],
    )?;
    Ok(())
}

pub fn mark_segment_stale(conn: &Connection, id: &str, now_iso: &str) -> Result<(), LoomError> {
    conn.execute(
        "UPDATE accordion_segments SET is_stale = 1, modified_at = ?1 WHERE id = ?2",
        params![now_iso, id],
    )?;
    Ok(())
}

/// Locate the closed segment whose chronological range contains the given
/// message. Returns `None` when the message lies in the open segment (after
/// the most recent checkpoint) or no segments exist.
///
/// The range test compares `messages.created_at` against the anchor messages
/// of the segment's two boundary checkpoints. The start sentinel has
/// `after_message_id = NULL`; its "anchor" is treated as `created_at = ''`
/// (sorts before every real message).
pub fn find_segment_for_message(
    conn: &Connection,
    story_id: &str,
    message_id: &str,
) -> Result<Option<AccordionSegment>, LoomError> {
    let msg_created_at: Option<String> = conn
        .prepare("SELECT created_at FROM messages WHERE id = ?1")?
        .query_row(params![message_id], |r| r.get(0))
        .optional()?;
    let Some(msg_at) = msg_created_at else {
        return Ok(None);
    };

    let sql = format!(
        "SELECT {SEG_COLS} FROM accordion_segments
         WHERE story_id = ?1
         AND COALESCE(
                 (SELECT m.created_at FROM messages m
                  WHERE m.id = (SELECT after_message_id FROM checkpoints WHERE id = accordion_segments.start_cp_id)),
                 ''
             ) < ?2
         AND ?2 <= COALESCE(
                 (SELECT m.created_at FROM messages m
                  WHERE m.id = (SELECT after_message_id FROM checkpoints WHERE id = accordion_segments.end_cp_id)),
                 ''
             )
         LIMIT 1"
    );
    Ok(conn
        .prepare(&sql)?
        .query_row(params![story_id, msg_at], seg_row)
        .optional()?)
}

// ---- Tests ---------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::{apply_pending, MigrationRoot};

    fn open() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        apply_pending(&mut c, MigrationRoot::World).unwrap();
        c
    }

    fn seed_story(conn: &Connection, story_id: &str) {
        conn.execute(
            "INSERT INTO items (id, parent_id, item_type, name, sort_order, created_at, modified_at)
             VALUES (?1, NULL, 'Story', 'S', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            params![story_id],
        )
        .unwrap();
    }

    fn seed_message(conn: &Connection, id: &str, story_id: &str, created_at: &str) {
        conn.execute(
            "INSERT INTO messages (id, story_id, session_id, kind, role, content, created_at)
             VALUES (?1, ?2, NULL, 'story', 'user', '', ?3)",
            params![id, story_id, created_at],
        )
        .unwrap();
    }

    #[test]
    fn checkpoint_and_segment_round_trip() {
        let c = open();
        seed_story(&c, "story1");
        let cp = Checkpoint {
            id: "cp1".into(),
            story_id: "story1".into(),
            after_message_id: None,
            name: "Chapter 1".into(),
            is_start: true,
            created_at: "2026-01-01T00:00:00Z".into(),
            modified_at: "2026-01-01T00:00:00Z".into(),
        };
        insert_checkpoint(&c, &cp).unwrap();
        let fetched = get_checkpoint(&c, "cp1").unwrap().unwrap();
        assert_eq!(fetched.name, "Chapter 1");
        assert!(fetched.is_start);

        let cp2 = Checkpoint {
            id: "cp2".into(),
            story_id: "story1".into(),
            after_message_id: Some("m1".into()),
            name: "Chapter 2".into(),
            is_start: false,
            created_at: "2026-01-02T00:00:00Z".into(),
            modified_at: "2026-01-02T00:00:00Z".into(),
        };
        // Need an anchor message for cp2.
        seed_message(&c, "m1", "story1", "2026-01-02T00:00:00Z");
        insert_checkpoint(&c, &cp2).unwrap();

        let seg = AccordionSegment {
            id: "seg1".into(),
            story_id: "story1".into(),
            start_cp_id: "cp1".into(),
            end_cp_id: "cp2".into(),
            summary: None,
            is_collapsed: false,
            use_summary: true,
            is_stale: false,
            summarised_at: None,
            created_at: "2026-01-02T00:00:00Z".into(),
            modified_at: "2026-01-02T00:00:00Z".into(),
        };
        insert_segment(&c, &seg).unwrap();
        let segs = list_segments(&c, "story1").unwrap();
        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0].id, "seg1");
        assert!(segs[0].use_summary);
    }

    #[test]
    fn list_checkpoints_orders_start_sentinel_first() {
        let c = open();
        seed_story(&c, "story1");
        seed_message(&c, "m1", "story1", "2026-01-02T00:00:00Z");

        // Insert non-start first then the start sentinel — list should still
        // return the sentinel first.
        insert_checkpoint(
            &c,
            &Checkpoint {
                id: "cpA".into(),
                story_id: "story1".into(),
                after_message_id: Some("m1".into()),
                name: "Chapter 2".into(),
                is_start: false,
                created_at: "2026-01-02T00:00:00Z".into(),
                modified_at: "2026-01-02T00:00:00Z".into(),
            },
        )
        .unwrap();
        insert_checkpoint(
            &c,
            &Checkpoint {
                id: "cpStart".into(),
                story_id: "story1".into(),
                after_message_id: None,
                name: "Chapter 1".into(),
                is_start: true,
                created_at: "2026-01-03T00:00:00Z".into(),
                modified_at: "2026-01-03T00:00:00Z".into(),
            },
        )
        .unwrap();

        let cps = list_checkpoints(&c, "story1").unwrap();
        assert_eq!(cps.len(), 2);
        assert!(cps[0].is_start);
        assert_eq!(cps[1].id, "cpA");
    }

    #[test]
    fn find_segment_for_message_locates_containing_segment() {
        let c = open();
        seed_story(&c, "story1");
        seed_message(&c, "m1", "story1", "2026-01-02T00:00:00Z");
        seed_message(&c, "m2", "story1", "2026-01-03T00:00:00Z");
        seed_message(&c, "m3", "story1", "2026-01-04T00:00:00Z");

        insert_checkpoint(
            &c,
            &Checkpoint {
                id: "cpStart".into(),
                story_id: "story1".into(),
                after_message_id: None,
                name: "Chapter 1".into(),
                is_start: true,
                created_at: "2026-01-01T00:00:00Z".into(),
                modified_at: "2026-01-01T00:00:00Z".into(),
            },
        )
        .unwrap();
        insert_checkpoint(
            &c,
            &Checkpoint {
                id: "cpEnd".into(),
                story_id: "story1".into(),
                after_message_id: Some("m2".into()),
                name: "Chapter 2".into(),
                is_start: false,
                created_at: "2026-01-03T00:00:00Z".into(),
                modified_at: "2026-01-03T00:00:00Z".into(),
            },
        )
        .unwrap();
        insert_segment(
            &c,
            &AccordionSegment {
                id: "seg1".into(),
                story_id: "story1".into(),
                start_cp_id: "cpStart".into(),
                end_cp_id: "cpEnd".into(),
                summary: None,
                is_collapsed: false,
                use_summary: true,
                is_stale: false,
                summarised_at: None,
                created_at: "2026-01-03T00:00:00Z".into(),
                modified_at: "2026-01-03T00:00:00Z".into(),
            },
        )
        .unwrap();

        // m1 and m2 are inside the segment; m3 is in the open segment.
        let s1 = find_segment_for_message(&c, "story1", "m1").unwrap();
        let s2 = find_segment_for_message(&c, "story1", "m2").unwrap();
        let s3 = find_segment_for_message(&c, "story1", "m3").unwrap();
        assert_eq!(s1.unwrap().id, "seg1");
        assert_eq!(s2.unwrap().id, "seg1");
        assert!(s3.is_none());
    }

    #[test]
    fn segments_touching_checkpoint_returns_neighbours() {
        let c = open();
        seed_story(&c, "story1");
        seed_message(&c, "m1", "story1", "2026-01-02T00:00:00Z");
        seed_message(&c, "m2", "story1", "2026-01-03T00:00:00Z");

        insert_checkpoint(
            &c,
            &Checkpoint {
                id: "cpStart".into(),
                story_id: "story1".into(),
                after_message_id: None,
                name: "Chapter 1".into(),
                is_start: true,
                created_at: "2026-01-01T00:00:00Z".into(),
                modified_at: "2026-01-01T00:00:00Z".into(),
            },
        )
        .unwrap();
        insert_checkpoint(
            &c,
            &Checkpoint {
                id: "cpMid".into(),
                story_id: "story1".into(),
                after_message_id: Some("m1".into()),
                name: "Chapter 2".into(),
                is_start: false,
                created_at: "2026-01-02T00:00:00Z".into(),
                modified_at: "2026-01-02T00:00:00Z".into(),
            },
        )
        .unwrap();
        insert_checkpoint(
            &c,
            &Checkpoint {
                id: "cpEnd".into(),
                story_id: "story1".into(),
                after_message_id: Some("m2".into()),
                name: "Chapter 3".into(),
                is_start: false,
                created_at: "2026-01-03T00:00:00Z".into(),
                modified_at: "2026-01-03T00:00:00Z".into(),
            },
        )
        .unwrap();
        insert_segment(
            &c,
            &AccordionSegment {
                id: "segA".into(),
                story_id: "story1".into(),
                start_cp_id: "cpStart".into(),
                end_cp_id: "cpMid".into(),
                summary: None,
                is_collapsed: false,
                use_summary: true,
                is_stale: false,
                summarised_at: None,
                created_at: "2026-01-02T00:00:00Z".into(),
                modified_at: "2026-01-02T00:00:00Z".into(),
            },
        )
        .unwrap();
        insert_segment(
            &c,
            &AccordionSegment {
                id: "segB".into(),
                story_id: "story1".into(),
                start_cp_id: "cpMid".into(),
                end_cp_id: "cpEnd".into(),
                summary: None,
                is_collapsed: false,
                use_summary: true,
                is_stale: false,
                summarised_at: None,
                created_at: "2026-01-03T00:00:00Z".into(),
                modified_at: "2026-01-03T00:00:00Z".into(),
            },
        )
        .unwrap();

        let (ending, starting) = segments_touching_checkpoint(&c, "cpMid").unwrap();
        assert_eq!(ending.unwrap().id, "segA");
        assert_eq!(starting.unwrap().id, "segB");
    }

    #[test]
    fn update_summary_clears_stale_and_records_timestamp() {
        let c = open();
        seed_story(&c, "story1");
        seed_message(&c, "m1", "story1", "2026-01-02T00:00:00Z");
        insert_checkpoint(
            &c,
            &Checkpoint {
                id: "cpStart".into(),
                story_id: "story1".into(),
                after_message_id: None,
                name: "Chapter 1".into(),
                is_start: true,
                created_at: "2026-01-01T00:00:00Z".into(),
                modified_at: "2026-01-01T00:00:00Z".into(),
            },
        )
        .unwrap();
        insert_checkpoint(
            &c,
            &Checkpoint {
                id: "cpEnd".into(),
                story_id: "story1".into(),
                after_message_id: Some("m1".into()),
                name: "Chapter 2".into(),
                is_start: false,
                created_at: "2026-01-02T00:00:00Z".into(),
                modified_at: "2026-01-02T00:00:00Z".into(),
            },
        )
        .unwrap();
        insert_segment(
            &c,
            &AccordionSegment {
                id: "seg1".into(),
                story_id: "story1".into(),
                start_cp_id: "cpStart".into(),
                end_cp_id: "cpEnd".into(),
                summary: None,
                is_collapsed: false,
                use_summary: true,
                is_stale: true,
                summarised_at: None,
                created_at: "2026-01-02T00:00:00Z".into(),
                modified_at: "2026-01-02T00:00:00Z".into(),
            },
        )
        .unwrap();
        update_summary(
            &c,
            "seg1",
            "S",
            "2026-01-03T00:00:00Z",
            "2026-01-03T00:00:00Z",
        )
        .unwrap();
        let fetched = get_segment(&c, "seg1").unwrap().unwrap();
        assert_eq!(fetched.summary.as_deref(), Some("S"));
        assert_eq!(
            fetched.summarised_at.as_deref(),
            Some("2026-01-03T00:00:00Z")
        );
        assert!(!fetched.is_stale);
    }
}
