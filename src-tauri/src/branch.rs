use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::error::LoomError;
use crate::messages;

// ─── Types ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ModelOrigin {
    Normal,
    Ghostwriter,
    Regenerated,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchMapNode {
    pub user_msg_id: String,
    pub model_msg_id: String,
    pub excerpt: String,
    pub token_count: Option<u32>,
    pub created_at: String,
    pub is_current_leaf: bool,
    pub user_was_edited: bool,
    pub model_origin: ModelOrigin,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchMapEdge {
    pub parent_model_msg_id: String,
    pub child_user_msg_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Checkpoint {
    pub id: String,
    pub story_id: String,
    pub after_message_id: Option<String>,
    pub name: String,
    pub is_start: bool,
    pub created_at: String,
    pub modified_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccordionSegment {
    pub id: String,
    pub story_id: String,
    pub start_cp_id: String,
    pub end_cp_id: String,
    pub summary: Option<String>,
    pub is_collapsed: bool,
    pub is_stale: bool,
    pub branch_leaf_id: Option<String>,
    pub summarised_at: Option<String>,
    pub created_at: String,
    pub modified_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchMapData {
    pub nodes: Vec<BranchMapNode>,
    pub edges: Vec<BranchMapEdge>,
    pub checkpoints: Vec<Checkpoint>,
    pub accordion_segments: Vec<AccordionSegment>,
    pub current_leaf_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchDeletionResult {
    pub new_leaf_id: Option<String>,
    pub deleted_ids: Vec<String>,
}

// ─── Branch Map Loading ─────────────────────────────────────────────────────

/// Load the full branch map data for a story.
/// Returns all non-deleted message pairs, edges, checkpoints, and accordion segments.
pub fn load_branch_map(
    conn: &Connection,
    story_id: &str,
    current_leaf_id: &str,
) -> Result<BranchMapData, LoomError> {
    // Ensure a Start checkpoint exists
    ensure_start_checkpoint(conn, story_id)?;

    // Clean up orphaned checkpoints
    cleanup_orphaned_checkpoints(conn, story_id)?;

    // Query all non-deleted model messages (each represents a node = user+model pair)
    let mut stmt = conn.prepare(
        "SELECT m.id, m.content, m.token_count, m.created_at,
                m.ghostwriter_history,
                u.id AS user_msg_id, u.content_type AS user_ct
         FROM messages m
         JOIN messages u ON m.parent_id = u.id
         WHERE m.story_id = ?1
           AND m.role = 'model'
           AND m.deleted_at IS NULL
           AND u.deleted_at IS NULL
         ORDER BY m.created_at ASC",
    )?;

    let mut nodes = Vec::new();

    let rows = stmt.query_map(rusqlite::params![story_id], |row| {
        let model_msg_id: String = row.get(0)?;
        let model_content: String = row.get(1)?;
        let token_count: Option<u32> = row.get(2)?;
        let created_at: String = row.get(3)?;
        let gw_history: String = row.get(4)?;
        let user_msg_id: String = row.get(5)?;
        let user_ct: String = row.get(6)?;
        Ok((model_msg_id, model_content, token_count, created_at, gw_history, user_msg_id, user_ct))
    })?;

    for row in rows {
        let (model_msg_id, model_content, token_count, created_at, gw_history, user_msg_id, user_ct) = row?;

        let excerpt = make_excerpt(&model_content, 60);
        let user_was_edited = detect_user_edited(&user_ct);
        let model_origin = detect_model_origin(&gw_history);
        let is_current_leaf = model_msg_id == current_leaf_id;

        nodes.push(BranchMapNode {
            user_msg_id,
            model_msg_id,
            excerpt,
            token_count,
            created_at,
            is_current_leaf,
            user_was_edited,
            model_origin,
        });
    }

    // Build edges: for each user message, find its parent (a model message from the previous pair)
    let mut edges = Vec::new();
    let mut edge_stmt = conn.prepare(
        "SELECT u.id AS user_msg_id, u.parent_id AS parent_model_msg_id
         FROM messages u
         WHERE u.story_id = ?1
           AND u.role = 'user'
           AND u.deleted_at IS NULL
           AND u.parent_id IS NOT NULL",
    )?;

    let edge_rows = edge_stmt.query_map(rusqlite::params![story_id], |row| {
        let user_msg_id: String = row.get(0)?;
        let parent_model_msg_id: String = row.get(1)?;
        Ok((user_msg_id, parent_model_msg_id))
    })?;

    for row in edge_rows {
        let (child_user_msg_id, parent_model_msg_id) = row?;
        // Only add edge if parent is a model message (not the root user message)
        // The root user message has parent_id = NULL, so this only catches subsequent pairs
        // Check that the parent is actually a model message that exists in our nodes
        if nodes.iter().any(|n| n.model_msg_id == parent_model_msg_id) {
            edges.push(BranchMapEdge {
                parent_model_msg_id,
                child_user_msg_id,
            });
        }
    }

    // Load checkpoints
    let checkpoints = load_checkpoints(conn, story_id)?;

    // Load accordion segments (read-only for Phase 13)
    let accordion_segments = load_accordion_segments(conn, story_id)?;

    Ok(BranchMapData {
        nodes,
        edges,
        checkpoints,
        accordion_segments,
        current_leaf_id: current_leaf_id.to_string(),
    })
}

/// Truncate content to N chars for excerpt display.
fn make_excerpt(content: &str, max_chars: usize) -> String {
    let trimmed = content.trim();
    if trimmed.chars().count() <= max_chars {
        trimmed.to_string()
    } else {
        let end = trimmed
            .char_indices()
            .nth(max_chars)
            .map(|(i, _)| i)
            .unwrap_or(trimmed.len());
        format!("{}...", &trimmed[..end])
    }
}

/// Detect if user message was edited.
/// Edits in LOOM create new branches, so this is currently always false.
fn detect_user_edited(_content_type: &str) -> bool {
    false
}

/// Detect model origin from ghostwriter_history JSON.
fn detect_model_origin(gw_history: &str) -> ModelOrigin {
    if gw_history != "[]" && !gw_history.is_empty() {
        // Has ghostwriter edits
        ModelOrigin::Ghostwriter
    } else {
        ModelOrigin::Normal
    }
}

// ─── Checkpoints ────────────────────────────────────────────────────────────

/// Ensure a Start checkpoint exists for the story.
fn ensure_start_checkpoint(conn: &Connection, story_id: &str) -> Result<(), LoomError> {
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM checkpoints WHERE story_id = ?1 AND is_start = 1",
            rusqlite::params![story_id],
            |row| row.get(0),
        )
        .unwrap_or(false);

    if !exists {
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO checkpoints (id, story_id, after_message_id, name, is_start, created_at, modified_at)
             VALUES (?1, ?2, NULL, 'Start', 1, ?3, ?4)",
            rusqlite::params![uuid::Uuid::new_v4().to_string(), story_id, &now, &now],
        )?;
    }
    Ok(())
}

/// Load all checkpoints for a story.
pub fn load_checkpoints(conn: &Connection, story_id: &str) -> Result<Vec<Checkpoint>, LoomError> {
    let mut stmt = conn.prepare(
        "SELECT id, story_id, after_message_id, name, is_start, created_at, modified_at
         FROM checkpoints
         WHERE story_id = ?1
         ORDER BY created_at ASC",
    )?;

    let rows = stmt.query_map(rusqlite::params![story_id], |row| {
        Ok(Checkpoint {
            id: row.get(0)?,
            story_id: row.get(1)?,
            after_message_id: row.get(2)?,
            name: row.get(3)?,
            is_start: row.get::<_, i32>(4)? != 0,
            created_at: row.get(5)?,
            modified_at: row.get(6)?,
        })
    })?;

    rows.collect::<Result<Vec<_>, _>>().map_err(LoomError::from)
}

pub fn load_accordion_segments(
    conn: &Connection,
    story_id: &str,
) -> Result<Vec<AccordionSegment>, LoomError> {
    let mut stmt = conn.prepare(
        "SELECT id, story_id, start_cp_id, end_cp_id, summary,
                is_collapsed, is_stale, branch_leaf_id, summarised_at,
                created_at, modified_at
         FROM accordion_segments
         WHERE story_id = ?1
         ORDER BY created_at ASC",
    )?;

    let rows = stmt.query_map(rusqlite::params![story_id], |row| {
        Ok(AccordionSegment {
            id: row.get(0)?,
            story_id: row.get(1)?,
            start_cp_id: row.get(2)?,
            end_cp_id: row.get(3)?,
            summary: row.get(4)?,
            is_collapsed: row.get::<_, i32>(5)? != 0,
            is_stale: row.get::<_, i32>(6)? != 0,
            branch_leaf_id: row.get(7)?,
            summarised_at: row.get(8)?,
            created_at: row.get(9)?,
            modified_at: row.get(10)?,
        })
    })?;

    rows.collect::<Result<Vec<_>, _>>().map_err(LoomError::from)
}

/// Set an accordion segment's collapsed state — Doc 18 §5.
pub fn set_segment_collapsed(
    conn: &Connection,
    segment_id: &str,
    collapsed: bool,
) -> Result<(), LoomError> {
    let now = chrono::Utc::now().to_rfc3339();
    let rows = conn.execute(
        "UPDATE accordion_segments SET is_collapsed = ?1, modified_at = ?2 WHERE id = ?3",
        rusqlite::params![collapsed as i32, &now, segment_id],
    )?;
    if rows == 0 {
        return Err(LoomError::ItemNotFound(format!("Segment {} not found", segment_id)));
    }
    Ok(())
}

/// Save a summary for an accordion segment — Doc 18 §4.4.
pub fn save_segment_summary(
    conn: &Connection,
    segment_id: &str,
    summary: &str,
) -> Result<(), LoomError> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE accordion_segments SET summary = ?1, summarised_at = ?2, is_stale = 0, modified_at = ?3
         WHERE id = ?4",
        rusqlite::params![summary, &now, &now, segment_id],
    )?;
    Ok(())
}

/// Mark a segment as stale — Doc 18 §7.3.
pub fn mark_segment_stale(
    conn: &Connection,
    segment_id: &str,
) -> Result<(), LoomError> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE accordion_segments SET is_stale = 1, modified_at = ?1 WHERE id = ?2",
        rusqlite::params![&now, segment_id],
    )?;
    Ok(())
}

/// Find which accordion segment a message belongs to, given checkpoints.
/// Returns the segment if the message is inside a collapsed segment.
pub fn find_collapsed_segment_for_message(
    message_id: &str,
    segments: &[AccordionSegment],
    checkpoints: &[Checkpoint],
    branch_messages: &[crate::gemini::ChatMessage],
    current_leaf_id: &str,
) -> Option<AccordionSegment> {
    // Build a position map: message_id → index in the branch
    let pos: std::collections::HashMap<&str, usize> = branch_messages
        .iter()
        .enumerate()
        .map(|(i, m)| (m.id.as_str(), i))
        .collect();

    let msg_pos = pos.get(message_id)?;

    for seg in segments {
        if !seg.is_collapsed || seg.summary.is_none() {
            continue;
        }
        // Check branch_leaf_id: if set, only applies to that branch
        if let Some(ref blid) = seg.branch_leaf_id {
            if blid != current_leaf_id {
                continue;
            }
        }

        // Find the position range for this segment:
        // start_cp after_message_id → end_cp after_message_id
        let start_cp = checkpoints.iter().find(|c| c.id == seg.start_cp_id);
        let end_cp = checkpoints.iter().find(|c| c.id == seg.end_cp_id);

        let start_pos = match start_cp {
            Some(cp) => match &cp.after_message_id {
                Some(mid) => pos.get(mid.as_str()).map(|p| p + 1), // segment starts AFTER this message
                None => Some(0), // start checkpoint → from beginning
            },
            None => continue,
        };

        let end_pos = match end_cp {
            Some(cp) => match &cp.after_message_id {
                Some(mid) => pos.get(mid.as_str()).copied(), // segment ends AT this message (inclusive)
                None => continue, // end checkpoint with no after_message_id is unusual
            },
            None => continue,
        };

        if let (Some(sp), Some(ep)) = (start_pos, end_pos) {
            if *msg_pos >= sp && *msg_pos <= ep {
                return Some(seg.clone());
            }
        }
    }

    None
}

/// Create a new checkpoint after a specific message.
/// Also auto-creates an accordion_segment between the previous checkpoint and
/// this new one (Doc 18 §3.1).
pub fn create_checkpoint(
    conn: &Connection,
    story_id: &str,
    after_message_id: Option<&str>,
    name: &str,
) -> Result<Checkpoint, LoomError> {
    let cp_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO checkpoints (id, story_id, after_message_id, name, is_start, created_at, modified_at)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6)",
        rusqlite::params![&cp_id, story_id, after_message_id, name, &now, &now],
    )?;

    // Auto-create accordion segment: find the previous checkpoint for this story.
    // "Previous" = the checkpoint whose after_message_id comes before this one
    // in the message chain, OR the start checkpoint (after_message_id IS NULL).
    // For simplicity, use the most recently created non-start checkpoint before this,
    // or the start checkpoint if this is the second checkpoint.
    let prev_cp_id: Option<String> = conn
        .query_row(
            "SELECT id FROM checkpoints
             WHERE story_id = ?1 AND id != ?2
             ORDER BY
                CASE WHEN is_start = 1 THEN 0 ELSE 1 END,
                created_at DESC
             LIMIT 1",
            rusqlite::params![story_id, &cp_id],
            |row| row.get(0),
        )
        .ok();

    if let Some(prev_id) = prev_cp_id {
        let seg_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO accordion_segments (id, story_id, start_cp_id, end_cp_id, created_at, modified_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![&seg_id, story_id, &prev_id, &cp_id, &now, &now],
        )?;
    }

    Ok(Checkpoint {
        id: cp_id,
        story_id: story_id.to_string(),
        after_message_id: after_message_id.map(|s| s.to_string()),
        name: name.to_string(),
        is_start: false,
        created_at: now.clone(),
        modified_at: now,
    })
}

/// Rename a checkpoint.
pub fn rename_checkpoint(conn: &Connection, id: &str, name: &str) -> Result<(), LoomError> {
    let now = chrono::Utc::now().to_rfc3339();
    let rows = conn.execute(
        "UPDATE checkpoints SET name = ?1, modified_at = ?2 WHERE id = ?3",
        rusqlite::params![name, &now, id],
    )?;
    if rows == 0 {
        return Err(LoomError::ItemNotFound(format!("Checkpoint {} not found", id)));
    }
    Ok(())
}

/// Delete a checkpoint (refuses to delete Start checkpoints).
/// If adjacent accordion segments exist, merges them.
pub fn delete_checkpoint(conn: &Connection, id: &str) -> Result<(), LoomError> {
    // Check it's not a Start checkpoint
    let is_start: bool = conn
        .query_row(
            "SELECT is_start FROM checkpoints WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get::<_, i32>(0).map(|v| v != 0),
        )
        .map_err(|_| LoomError::ItemNotFound(format!("Checkpoint {} not found", id)))?;

    if is_start {
        return Err(LoomError::Validation("Cannot delete the Start checkpoint.".to_string()));
    }

    let now = chrono::Utc::now().to_rfc3339();

    // Doc 18 §3.2: Merge adjacent accordion segments.
    // Segment A ends at this checkpoint (end_cp_id = id).
    // Segment B starts at this checkpoint (start_cp_id = id).
    // Merged segment: A.start_cp_id → B.end_cp_id, summary = NULL, is_collapsed = 0.
    let seg_a: Option<(String, String)> = conn
        .query_row(
            "SELECT id, start_cp_id FROM accordion_segments WHERE end_cp_id = ?1 LIMIT 1",
            rusqlite::params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();

    let seg_b: Option<(String, String, String)> = conn
        .query_row(
            "SELECT id, end_cp_id, story_id FROM accordion_segments WHERE start_cp_id = ?1 LIMIT 1",
            rusqlite::params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .ok();

    match (&seg_a, &seg_b) {
        (Some((a_id, a_start)), Some((b_id, b_end, seg_story_id))) => {
            // Both exist — delete both and create merged segment
            conn.execute("DELETE FROM accordion_segments WHERE id = ?1", rusqlite::params![a_id])?;
            conn.execute("DELETE FROM accordion_segments WHERE id = ?1", rusqlite::params![b_id])?;
            let merged_id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO accordion_segments (id, story_id, start_cp_id, end_cp_id, created_at, modified_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![&merged_id, seg_story_id, a_start, b_end, &now, &now],
            )?;
        }
        (Some((a_id, _)), None) => {
            conn.execute("DELETE FROM accordion_segments WHERE id = ?1", rusqlite::params![a_id])?;
        }
        (None, Some((b_id, _, _))) => {
            conn.execute("DELETE FROM accordion_segments WHERE id = ?1", rusqlite::params![b_id])?;
        }
        (None, None) => {}
    }

    // Delete the checkpoint
    conn.execute("DELETE FROM checkpoints WHERE id = ?1", rusqlite::params![id])?;

    Ok(())
}

/// Soft-delete a branch starting from a given model message, including all descendants.
/// Returns the new leaf ID and the list of deleted message IDs.
pub fn delete_branch_from(
    conn: &Connection,
    story_id: &str,
    model_msg_id: &str,
) -> Result<BranchDeletionResult, LoomError> {
    let now = chrono::Utc::now().to_rfc3339();

    // Get the user message (parent of the model message)
    let user_msg_id: String = conn
        .query_row(
            "SELECT parent_id FROM messages WHERE id = ?1",
            rusqlite::params![model_msg_id],
            |row| row.get(0),
        )
        .map_err(|_| LoomError::ItemNotFound(format!("Message {} not found", model_msg_id)))?;

    // Find all descendant messages using recursive CTE starting from user message
    let mut desc_stmt = conn.prepare(
        "WITH RECURSIVE descendants(id) AS (
            SELECT ?1
            UNION ALL
            SELECT m.id FROM messages m
            JOIN descendants d ON m.parent_id = d.id
            WHERE m.deleted_at IS NULL
         )
         SELECT id FROM descendants",
    )?;

    let deleted_ids: Vec<String> = desc_stmt
        .query_map(rusqlite::params![&user_msg_id], |row| row.get(0))?
        .collect::<Result<Vec<String>, _>>()?;

    // Soft-delete all collected messages
    for id in &deleted_ids {
        conn.execute(
            "UPDATE messages SET deleted_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            rusqlite::params![&now, id],
        )?;
    }

    // Determine new leaf: find a sibling branch or fall back to parent
    let user_parent_id: Option<String> = conn
        .query_row(
            "SELECT parent_id FROM messages WHERE id = ?1",
            rusqlite::params![&user_msg_id],
            |row| row.get(0),
        )
        .ok()
        .flatten();

    let new_leaf_id = if let Some(ref parent_id) = user_parent_id {
        // Look for a non-deleted sibling of user_msg (another child of the same parent)
        let sibling: Option<String> = conn
            .query_row(
                "SELECT m2.id FROM messages m2
                 WHERE m2.parent_id = ?1 AND m2.deleted_at IS NULL AND m2.id != ?2
                 ORDER BY m2.created_at DESC LIMIT 1",
                rusqlite::params![parent_id, &user_msg_id],
                |row| row.get(0),
            )
            .ok();

        if let Some(sibling_id) = sibling {
            // Find the deepest leaf of this sibling branch
            find_deepest_leaf(conn, &sibling_id)?
        } else {
            // No sibling — parent becomes the new leaf
            Some(parent_id.clone())
        }
    } else {
        // Root was deleted — no messages left
        None
    };

    // Update leaf_id in story_settings
    if let Some(ref leaf) = new_leaf_id {
        messages::set_story_leaf_id(conn, story_id, leaf)?;
    }

    Ok(BranchDeletionResult {
        new_leaf_id,
        deleted_ids,
    })
}

/// Find the deepest leaf message in a branch starting from a given message.
fn find_deepest_leaf(conn: &Connection, start_id: &str) -> Result<Option<String>, LoomError> {
    let mut current = start_id.to_string();
    loop {
        let child: Option<String> = conn
            .query_row(
                "SELECT id FROM messages WHERE parent_id = ?1 AND deleted_at IS NULL
                 ORDER BY created_at DESC LIMIT 1",
                rusqlite::params![&current],
                |row| row.get(0),
            )
            .ok();

        match child {
            Some(c) => current = c,
            None => return Ok(Some(current)),
        }
    }
}

/// Detect and delete orphaned checkpoints (Doc 17 §7.6).
/// Orphaned = after_message_id points to a permanently deleted message (not in messages table at all).
fn cleanup_orphaned_checkpoints(conn: &Connection, story_id: &str) -> Result<(), LoomError> {
    let orphans: Vec<String> = conn
        .prepare(
            "SELECT cp.id FROM checkpoints cp
             WHERE cp.story_id = ?1
               AND cp.after_message_id IS NOT NULL
               AND cp.is_start = 0
               AND NOT EXISTS (
                   SELECT 1 FROM messages m WHERE m.id = cp.after_message_id
               )",
        )?
        .query_map(rusqlite::params![story_id], |row| row.get(0))?
        .collect::<Result<Vec<String>, _>>()?;

    if !orphans.is_empty() {
        log::warn!(
            "Cleaning up {} orphaned checkpoint(s) in story {}",
            orphans.len(),
            story_id
        );
        for id in &orphans {
            conn.execute(
                "DELETE FROM checkpoints WHERE id = ?1",
                rusqlite::params![id],
            )?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        db::init_schema(&conn).unwrap();
        conn
    }

    fn insert_story(conn: &Connection) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO items (id, item_type, name, created_at, modified_at)
             VALUES (?1, 'Story', 'Test Story', ?2, ?3)",
            rusqlite::params![&id, &now, &now],
        )
        .unwrap();
        id
    }

    fn insert_msg(conn: &Connection, story_id: &str, parent_id: Option<&str>, role: &str) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let ct = if role == "user" { "json_user" } else { "text" };
        conn.execute(
            "INSERT INTO messages (id, story_id, parent_id, role, content_type, content, created_at, ghostwriter_history)
             VALUES (?1, ?2, ?3, ?4, ?5, 'test content', ?6, '[]')",
            rusqlite::params![&id, story_id, parent_id, role, ct, &now],
        )
        .unwrap();
        id
    }

    #[test]
    fn test_ensure_start_checkpoint() {
        let conn = test_db();
        let story_id = insert_story(&conn);

        ensure_start_checkpoint(&conn, &story_id).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM checkpoints WHERE story_id = ?1 AND is_start = 1",
                rusqlite::params![&story_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);

        // Calling again shouldn't create a duplicate
        ensure_start_checkpoint(&conn, &story_id).unwrap();
        let count2: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM checkpoints WHERE story_id = ?1 AND is_start = 1",
                rusqlite::params![&story_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count2, 1);
    }

    #[test]
    fn test_create_and_delete_checkpoint() {
        let conn = test_db();
        let story_id = insert_story(&conn);
        let u1 = insert_msg(&conn, &story_id, None, "user");
        let m1 = insert_msg(&conn, &story_id, Some(&u1), "model");

        let cp = create_checkpoint(&conn, &story_id, Some(&m1), "Act I").unwrap();
        assert_eq!(cp.name, "Act I");
        assert!(!cp.is_start);

        // Rename
        rename_checkpoint(&conn, &cp.id, "Chapter One").unwrap();

        // Delete
        delete_checkpoint(&conn, &cp.id).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM checkpoints WHERE id = ?1",
                rusqlite::params![&cp.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_cannot_delete_start_checkpoint() {
        let conn = test_db();
        let story_id = insert_story(&conn);
        ensure_start_checkpoint(&conn, &story_id).unwrap();

        let start_id: String = conn
            .query_row(
                "SELECT id FROM checkpoints WHERE story_id = ?1 AND is_start = 1",
                rusqlite::params![&story_id],
                |row| row.get(0),
            )
            .unwrap();

        let result = delete_checkpoint(&conn, &start_id);
        assert!(result.is_err());
    }

    #[test]
    fn test_load_branch_map_basic() {
        let conn = test_db();
        let story_id = insert_story(&conn);
        let u1 = insert_msg(&conn, &story_id, None, "user");
        let m1 = insert_msg(&conn, &story_id, Some(&u1), "model");

        // Set leaf_id
        messages::set_story_leaf_id(&conn, &story_id, &m1).unwrap();

        let data = load_branch_map(&conn, &story_id, &m1).unwrap();
        assert_eq!(data.nodes.len(), 1);
        assert_eq!(data.nodes[0].model_msg_id, m1);
        assert!(data.nodes[0].is_current_leaf);
        assert_eq!(data.edges.len(), 0); // Root pair has no incoming edge
        assert!(data.checkpoints.iter().any(|c| c.is_start));
    }

    #[test]
    fn test_branch_deletion() {
        let conn = test_db();
        let story_id = insert_story(&conn);
        let u1 = insert_msg(&conn, &story_id, None, "user");
        let m1 = insert_msg(&conn, &story_id, Some(&u1), "model");
        let u2 = insert_msg(&conn, &story_id, Some(&m1), "user");
        let m2 = insert_msg(&conn, &story_id, Some(&u2), "model");

        messages::set_story_leaf_id(&conn, &story_id, &m2).unwrap();

        // Delete from m2 (leaf)
        let result = delete_branch_from(&conn, &story_id, &m2).unwrap();
        assert!(result.deleted_ids.contains(&u2));
        assert!(result.deleted_ids.contains(&m2));
        assert_eq!(result.new_leaf_id, Some(m1.clone()));
    }
}
