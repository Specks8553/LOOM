//! Accordion lifecycle (Doc 16 §Segment Lifecycle).
//!
//! Owns the segment split/merge logic, summary CRUD, stale-marking, and the
//! start-sentinel constructor used by `services/vault.rs::create_item`. The
//! summarisation flow (Gemini call + non-streaming pipeline) lands in Phase
//! 7C — `summarise_segment` is intentionally absent here.
//!
//! Per Doc 05 §Dependency Rules, this module never emits events; the command
//! layer in `commands/accordion.rs` emits `accordion_state_changed` after a
//! successful call returns.

use rusqlite::Connection;
use uuid::Uuid;

use crate::db::accordion::{self as db_accordion, AccordionSegment, AccordionState, Checkpoint};
use crate::db::messages;
use crate::error::{LoomError, ValidationKind};

/// Single source of truth for ISO 8601 timestamps in this module.
pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Insert the start sentinel for a freshly-created story. Per Doc 16 §Story
/// creation: `is_start = 1`, `after_message_id = NULL`, `name = "Chapter 1"`,
/// no `accordion_segments` row (the start sentinel's segment is open).
pub fn create_start_sentinel(conn: &Connection, story_id: &str) -> Result<Checkpoint, LoomError> {
    let now = now_iso();
    let cp = Checkpoint {
        id: Uuid::new_v4().to_string(),
        story_id: story_id.to_owned(),
        after_message_id: None,
        name: "Chapter 1".to_owned(),
        is_start: true,
        created_at: now.clone(),
        modified_at: now,
    };
    db_accordion::insert_checkpoint(conn, &cp)?;
    Ok(cp)
}

/// Return checkpoints + segments for a story as an `AccordionState` aggregate.
pub fn get_accordion_state(conn: &Connection, story_id: &str) -> Result<AccordionState, LoomError> {
    Ok(AccordionState {
        checkpoints: db_accordion::list_checkpoints(conn, story_id)?,
        segments: db_accordion::list_segments(conn, story_id)?,
    })
}

/// Insert a checkpoint at `after_message_id` and either close the open segment
/// or split the closed segment that contains the anchor message (Doc 16
/// §User creates a checkpoint, §Inserting a checkpoint inside an existing
/// closed segment).
///
/// Validation:
/// - `after_message_id` must resolve to a story-kind message on `story_id`.
/// - No two checkpoints may share the same anchor (rejected with a Validation
///   error — the UI shouldn't offer this, but defensive).
///
/// Returns the new checkpoint row.
pub fn create_checkpoint(
    conn: &Connection,
    story_id: &str,
    after_message_id: &str,
    name: &str,
) -> Result<Checkpoint, LoomError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(LoomError::validation("Checkpoint name cannot be empty."));
    }

    // Anchor message must exist and belong to this story.
    let anchor = messages::get_message(conn, after_message_id)?
        .ok_or_else(|| LoomError::NotFound(format!("message {after_message_id} not found")))?;
    if anchor.story_id != story_id {
        return Err(LoomError::validation(
            "Checkpoint anchor message does not belong to this story.",
        ));
    }

    // Reject duplicate anchor.
    let existing: Option<String> = conn
        .prepare(
            "SELECT id FROM checkpoints
             WHERE story_id = ?1 AND after_message_id = ?2 LIMIT 1",
        )?
        .query_row(rusqlite::params![story_id, after_message_id], |r| r.get(0))
        .ok();
    if existing.is_some() {
        return Err(LoomError::validation(
            "A checkpoint already exists at this message.",
        ));
    }

    let now = now_iso();
    let new_cp = Checkpoint {
        id: Uuid::new_v4().to_string(),
        story_id: story_id.to_owned(),
        after_message_id: Some(after_message_id.to_owned()),
        name: trimmed.to_owned(),
        is_start: false,
        created_at: now.clone(),
        modified_at: now.clone(),
    };

    // Two cases:
    //   A) Anchor sits in the open segment (no row): insert checkpoint, then
    //      create a closed segment from (prev_cp, new_cp).
    //   B) Anchor sits in a closed segment: split — delete the old row,
    //      insert two new rows (prev_cp..new_cp) and (new_cp..end_cp).
    // The old segment's summary is lost (Doc 16 §Inserting a checkpoint).
    let containing = db_accordion::find_segment_for_message(conn, story_id, after_message_id)?;

    db_accordion::insert_checkpoint(conn, &new_cp)?;

    match containing {
        None => {
            // Case A — close the open segment behind us.
            let prev_cp = previous_checkpoint_before_message(conn, story_id, &anchor.created_at)?
                .ok_or_else(|| {
                LoomError::Internal("no prior checkpoint found (start sentinel missing?)".into())
            })?;
            let seg = AccordionSegment {
                id: Uuid::new_v4().to_string(),
                story_id: story_id.to_owned(),
                start_cp_id: prev_cp.id,
                end_cp_id: new_cp.id.clone(),
                summary: None,
                is_collapsed: false,
                use_summary: true,
                is_stale: false,
                summarised_at: None,
                created_at: now.clone(),
                modified_at: now,
            };
            db_accordion::insert_segment(conn, &seg)?;
        }
        Some(old) => {
            // Case B — split. Old summary is intentionally discarded.
            db_accordion::delete_segment(conn, &old.id)?;
            let left = AccordionSegment {
                id: Uuid::new_v4().to_string(),
                story_id: story_id.to_owned(),
                start_cp_id: old.start_cp_id.clone(),
                end_cp_id: new_cp.id.clone(),
                summary: None,
                is_collapsed: false,
                use_summary: true,
                is_stale: false,
                summarised_at: None,
                created_at: now.clone(),
                modified_at: now.clone(),
            };
            let right = AccordionSegment {
                id: Uuid::new_v4().to_string(),
                story_id: story_id.to_owned(),
                start_cp_id: new_cp.id.clone(),
                end_cp_id: old.end_cp_id,
                summary: None,
                is_collapsed: false,
                use_summary: true,
                is_stale: false,
                summarised_at: None,
                created_at: now.clone(),
                modified_at: now,
            };
            db_accordion::insert_segment(conn, &left)?;
            db_accordion::insert_segment(conn, &right)?;
        }
    }

    Ok(new_cp)
}

/// Find the checkpoint with the largest anchor `created_at` strictly less than
/// `msg_created_at`. The start sentinel's anchor is treated as `''` so it
/// always sorts before every real message — guaranteeing a result whenever
/// the start sentinel exists.
fn previous_checkpoint_before_message(
    conn: &Connection,
    story_id: &str,
    msg_created_at: &str,
) -> Result<Option<Checkpoint>, LoomError> {
    let cps = db_accordion::list_checkpoints(conn, story_id)?;
    let mut chosen: Option<Checkpoint> = None;
    for cp in cps {
        let anchor_at = match &cp.after_message_id {
            None => String::new(), // start sentinel sorts first
            Some(mid) => {
                match messages::get_message(conn, mid)? {
                    Some(m) => m.created_at,
                    None => continue, // orphaned anchor — skip defensively
                }
            }
        };
        if anchor_at.as_str() < msg_created_at {
            chosen = Some(cp);
        } else {
            break; // list_checkpoints is already chronologically ordered
        }
    }
    Ok(chosen)
}

/// Rename a checkpoint (display only; not a stale trigger).
pub fn rename_checkpoint(conn: &Connection, id: &str, name: &str) -> Result<(), LoomError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(LoomError::validation("Checkpoint name cannot be empty."));
    }
    let cp = db_accordion::get_checkpoint(conn, id)?
        .ok_or_else(|| LoomError::NotFound(format!("checkpoint {id} not found")))?;
    db_accordion::rename_checkpoint(conn, &cp.id, trimmed, &now_iso())
}

/// Delete a user checkpoint and merge the two neighbouring segments. Returns
/// the merged segment (when one was created) so the caller can decide which
/// banner to focus next. The start sentinel is rejected with `ProtectedSentinel`.
pub fn delete_checkpoint(
    conn: &Connection,
    id: &str,
) -> Result<Option<AccordionSegment>, LoomError> {
    let cp = db_accordion::get_checkpoint(conn, id)?
        .ok_or_else(|| LoomError::NotFound(format!("checkpoint {id} not found")))?;
    if cp.is_start {
        return Err(LoomError::Validation {
            validation_kind: ValidationKind::ProtectedSentinel,
            key: None,
            reason: "The first chapter cannot be deleted.".into(),
        });
    }

    let (ending, starting) = db_accordion::segments_touching_checkpoint(conn, id)?;
    let now = now_iso();

    let merged = match (ending, starting) {
        (Some(end_seg), Some(start_seg)) => {
            // Standard interior delete — merge.
            let merged = AccordionSegment {
                id: Uuid::new_v4().to_string(),
                story_id: cp.story_id.clone(),
                start_cp_id: end_seg.start_cp_id.clone(),
                end_cp_id: start_seg.end_cp_id.clone(),
                summary: None,
                is_collapsed: false,
                use_summary: true,
                is_stale: false,
                summarised_at: None,
                created_at: now.clone(),
                modified_at: now.clone(),
            };
            db_accordion::delete_segment(conn, &end_seg.id)?;
            db_accordion::delete_segment(conn, &start_seg.id)?;
            db_accordion::insert_segment(conn, &merged)?;
            Some(merged)
        }
        (Some(end_seg), None) => {
            // Deleting the most-recent checkpoint: the prior closed segment
            // re-opens. Drop the ending row; no merge row is created (the
            // open segment carries no row).
            db_accordion::delete_segment(conn, &end_seg.id)?;
            None
        }
        (None, Some(start_seg)) => {
            // Defensive: only the start sentinel can sit "before" a segment
            // without an ending; non-start checkpoints always have an ending
            // segment. Drop the orphaned row and continue.
            db_accordion::delete_segment(conn, &start_seg.id)?;
            None
        }
        (None, None) => None,
    };

    db_accordion::delete_checkpoint(conn, id)?;
    Ok(merged)
}

/// Manual summary write (Doc 16 §Edit a summary by hand). Sets `is_stale = 0`
/// and `summarised_at = now()`; leaves `is_collapsed` and `use_summary` alone.
pub fn update_segment_summary(conn: &Connection, id: &str, summary: &str) -> Result<(), LoomError> {
    require_segment(conn, id)?;
    let now = now_iso();
    db_accordion::update_summary(conn, id, summary, &now, &now)
}

/// UI-only collapse toggle (Doc 16 §Collapse / expand). Never a cache-stale
/// trigger by itself.
pub fn set_segment_collapsed(
    conn: &Connection,
    id: &str,
    collapsed: bool,
) -> Result<(), LoomError> {
    require_segment(conn, id)?;
    db_accordion::set_collapsed(conn, id, collapsed, &now_iso())
}

/// API-level toggle (Doc 16 §Toggle "Use summary"). Cache-stale wiring lives
/// in `commands/accordion.rs` per Doc 05 §Dependency Rules.
pub fn set_segment_use_summary(
    conn: &Connection,
    id: &str,
    use_summary: bool,
) -> Result<(), LoomError> {
    require_segment(conn, id)?;
    db_accordion::set_use_summary(conn, id, use_summary, &now_iso())
}

/// Reset segment to its newly-created shape (`summary = NULL`,
/// `summarised_at = NULL`, `is_collapsed = 0`, `use_summary = 1`,
/// `is_stale = 0`). Doc 16 §Edit a summary by hand contrasts this with the
/// manual edit path: clear discards the summary entirely.
pub fn clear_segment_summary(conn: &Connection, id: &str) -> Result<(), LoomError> {
    require_segment(conn, id)?;
    db_accordion::clear_summary(conn, id, &now_iso())
}

/// Mark stale the segment whose range contains `message_id`. No-op when the
/// message lies in the open segment (no closed segment exists for it).
/// Returns the segment id that was marked (for the caller's emit payload), or
/// `None` when nothing was marked. Used by the conversation edit/regenerate/
/// feedback paths in Phase 7C.
pub fn mark_segment_stale_for_message(
    conn: &Connection,
    story_id: &str,
    message_id: &str,
) -> Result<Option<String>, LoomError> {
    let Some(seg) = db_accordion::find_segment_for_message(conn, story_id, message_id)? else {
        return Ok(None);
    };
    db_accordion::mark_segment_stale(conn, &seg.id, &now_iso())?;
    Ok(Some(seg.id))
}

fn require_segment(conn: &Connection, id: &str) -> Result<AccordionSegment, LoomError> {
    db_accordion::get_segment(conn, id)?
        .ok_or_else(|| LoomError::NotFound(format!("segment {id} not found")))
}

// ---- Tests ---------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::messages::{insert_message, ChatMessage};
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

    fn seed_msg(conn: &Connection, id: &str, role: &str, created_at: &str) {
        let m = ChatMessage {
            id: id.into(),
            story_id: "story1".into(),
            session_id: None,
            role: role.into(),
            content_type: "text".into(),
            content: "x".into(),
            token_count: None,
            model_name: None,
            finish_reason: None,
            created_at: created_at.into(),
            deleted_at: None,
            user_feedback: None,
            ghostwriter_history: "[]".into(),
            kind: "story".into(),
        };
        insert_message(conn, &m).unwrap();
    }

    #[test]
    fn start_sentinel_inserted_with_canonical_fields() {
        let c = fresh_conn();
        let cp = create_start_sentinel(&c, "story1").unwrap();
        assert!(cp.is_start);
        assert!(cp.after_message_id.is_none());
        assert_eq!(cp.name, "Chapter 1");
        let listed = db_accordion::list_checkpoints(&c, "story1").unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, cp.id);
    }

    #[test]
    fn first_user_checkpoint_closes_open_segment() {
        let c = fresh_conn();
        create_start_sentinel(&c, "story1").unwrap();
        seed_msg(&c, "m1", "user", "2026-01-02T00:00:00Z");
        seed_msg(&c, "m2", "model", "2026-01-02T00:00:01Z");

        let cp = create_checkpoint(&c, "story1", "m2", "Chapter 2").unwrap();
        assert!(!cp.is_start);

        let segs = db_accordion::list_segments(&c, "story1").unwrap();
        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0].end_cp_id, cp.id);
        assert!(segs[0].use_summary);
        assert!(!segs[0].is_collapsed);
        assert!(segs[0].summary.is_none());
    }

    #[test]
    fn checkpoint_inside_closed_segment_splits_and_drops_summary() {
        let c = fresh_conn();
        create_start_sentinel(&c, "story1").unwrap();
        seed_msg(&c, "m1", "model", "2026-01-02T00:00:00Z");
        seed_msg(&c, "m2", "user", "2026-01-03T00:00:00Z");
        seed_msg(&c, "m3", "model", "2026-01-04T00:00:00Z");

        // Close the whole range at m3.
        let cp_end = create_checkpoint(&c, "story1", "m3", "Chapter 2").unwrap();
        // Give that segment a summary so we can prove it's lost on split.
        let seg = db_accordion::list_segments(&c, "story1").unwrap().remove(0);
        update_segment_summary(&c, &seg.id, "old summary").unwrap();

        // Split at m1 (inside the closed segment).
        let cp_mid = create_checkpoint(&c, "story1", "m1", "Chapter 1.5").unwrap();

        let segs = db_accordion::list_segments(&c, "story1").unwrap();
        assert_eq!(segs.len(), 2);
        for s in &segs {
            assert!(s.summary.is_none(), "summary should be dropped on split");
            assert!(s.use_summary);
            assert!(!s.is_collapsed);
        }
        // Boundaries: one segment ends at cp_mid, the next starts at cp_mid.
        assert!(segs.iter().any(|s| s.end_cp_id == cp_mid.id));
        assert!(segs.iter().any(|s| s.start_cp_id == cp_mid.id));
        // And the original cp_end is still the terminal boundary somewhere.
        assert!(segs.iter().any(|s| s.end_cp_id == cp_end.id));
    }

    #[test]
    fn delete_checkpoint_merges_neighbour_segments() {
        let c = fresh_conn();
        create_start_sentinel(&c, "story1").unwrap();
        seed_msg(&c, "m1", "model", "2026-01-02T00:00:00Z");
        seed_msg(&c, "m2", "model", "2026-01-03T00:00:00Z");
        seed_msg(&c, "m3", "model", "2026-01-04T00:00:00Z");
        let cp_a = create_checkpoint(&c, "story1", "m1", "A").unwrap();
        let _cp_b = create_checkpoint(&c, "story1", "m2", "B").unwrap();
        let cp_c = create_checkpoint(&c, "story1", "m3", "C").unwrap();
        assert_eq!(db_accordion::list_segments(&c, "story1").unwrap().len(), 3);

        delete_checkpoint(&c, &cp_a.id).unwrap();
        let segs = db_accordion::list_segments(&c, "story1").unwrap();
        assert_eq!(segs.len(), 2, "two segments after merging A's neighbours");
        // The terminal boundary (cp_c) should still appear.
        assert!(segs.iter().any(|s| s.end_cp_id == cp_c.id));
    }

    #[test]
    fn delete_most_recent_checkpoint_reopens_segment() {
        let c = fresh_conn();
        create_start_sentinel(&c, "story1").unwrap();
        seed_msg(&c, "m1", "model", "2026-01-02T00:00:00Z");
        let cp = create_checkpoint(&c, "story1", "m1", "A").unwrap();
        assert_eq!(db_accordion::list_segments(&c, "story1").unwrap().len(), 1);

        delete_checkpoint(&c, &cp.id).unwrap();
        assert!(db_accordion::list_segments(&c, "story1")
            .unwrap()
            .is_empty());
        // The checkpoint is gone; only the start sentinel remains.
        let cps = db_accordion::list_checkpoints(&c, "story1").unwrap();
        assert_eq!(cps.len(), 1);
        assert!(cps[0].is_start);
    }

    #[test]
    fn delete_start_sentinel_rejected() {
        let c = fresh_conn();
        let start = create_start_sentinel(&c, "story1").unwrap();
        let err = delete_checkpoint(&c, &start.id).unwrap_err();
        match err {
            LoomError::Validation {
                validation_kind: ValidationKind::ProtectedSentinel,
                ..
            } => {}
            other => panic!("expected ProtectedSentinel, got {other:?}"),
        }
    }

    #[test]
    fn duplicate_anchor_rejected() {
        let c = fresh_conn();
        create_start_sentinel(&c, "story1").unwrap();
        seed_msg(&c, "m1", "model", "2026-01-02T00:00:00Z");
        create_checkpoint(&c, "story1", "m1", "A").unwrap();
        let err = create_checkpoint(&c, "story1", "m1", "B").unwrap_err();
        assert!(matches!(err, LoomError::Validation { .. }));
    }

    #[test]
    fn mark_stale_for_message_inside_closed_segment_returns_segment_id() {
        let c = fresh_conn();
        create_start_sentinel(&c, "story1").unwrap();
        seed_msg(&c, "m1", "model", "2026-01-02T00:00:00Z");
        seed_msg(&c, "m2", "model", "2026-01-03T00:00:00Z");
        create_checkpoint(&c, "story1", "m2", "A").unwrap();

        let id = mark_segment_stale_for_message(&c, "story1", "m1")
            .unwrap()
            .expect("m1 lives inside the closed segment");
        let seg = db_accordion::get_segment(&c, &id).unwrap().unwrap();
        assert!(seg.is_stale);

        // A message in the open segment yields no-op.
        seed_msg(&c, "m3", "model", "2026-01-04T00:00:00Z");
        assert!(mark_segment_stale_for_message(&c, "story1", "m3")
            .unwrap()
            .is_none());
    }

    #[test]
    fn clear_summary_resets_segment_state() {
        let c = fresh_conn();
        create_start_sentinel(&c, "story1").unwrap();
        seed_msg(&c, "m1", "model", "2026-01-02T00:00:00Z");
        create_checkpoint(&c, "story1", "m1", "A").unwrap();
        let seg_id = db_accordion::list_segments(&c, "story1")
            .unwrap()
            .remove(0)
            .id;
        update_segment_summary(&c, &seg_id, "S").unwrap();
        set_segment_collapsed(&c, &seg_id, true).unwrap();
        set_segment_use_summary(&c, &seg_id, false).unwrap();

        clear_segment_summary(&c, &seg_id).unwrap();
        let seg = db_accordion::get_segment(&c, &seg_id).unwrap().unwrap();
        assert!(seg.summary.is_none());
        assert!(seg.summarised_at.is_none());
        assert!(!seg.is_collapsed);
        assert!(seg.use_summary);
        assert!(!seg.is_stale);
    }
}
