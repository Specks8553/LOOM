//! Message DB operations — insert, load branch, leaf ID persistence.
//!
//! Doc 09 §1–§2: Messages form a DAG. Branch reconstruction is server-side
//! via Recursive CTE.

use rusqlite::Connection;

use crate::error::LoomError;
use crate::gemini::{ChatMessage, SiblingCount, StoryPayload, UserContent};

/// Insert a user message into the messages table.
pub fn insert_user_message(
    conn: &Connection,
    story_id: &str,
    parent_id: Option<&str>,
    content: &UserContent,
) -> Result<ChatMessage, LoomError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let content_json = serde_json::to_string(content)?;

    conn.execute(
        "INSERT INTO messages (id, story_id, parent_id, role, content_type, content, created_at, ghostwriter_history)
         VALUES (?1, ?2, ?3, 'user', 'json_user', ?4, ?5, '[]')",
        rusqlite::params![id, story_id, parent_id, content_json, now],
    )?;

    // Update story modified_at
    conn.execute(
        "UPDATE items SET modified_at = ?1 WHERE id = ?2",
        rusqlite::params![now, story_id],
    )?;

    Ok(ChatMessage {
        id,
        story_id: story_id.to_string(),
        parent_id: parent_id.map(|s| s.to_string()),
        role: "user".to_string(),
        content_type: "json_user".to_string(),
        content: content_json,
        token_count: None,
        model_name: None,
        finish_reason: None,
        created_at: now,
        deleted_at: None,
        user_feedback: None,
        ghostwriter_history: "[]".to_string(),
    })
}

/// Insert a completed model message into the messages table.
pub fn insert_model_message(
    conn: &Connection,
    story_id: &str,
    parent_id: &str,
    content: &str,
    token_count: Option<i64>,
    model_name: &str,
    finish_reason: Option<&str>,
) -> Result<ChatMessage, LoomError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO messages (id, story_id, parent_id, role, content_type, content, token_count, model_name, finish_reason, created_at, ghostwriter_history)
         VALUES (?1, ?2, ?3, 'model', 'text', ?4, ?5, ?6, ?7, ?8, '[]')",
        rusqlite::params![id, story_id, parent_id, content, token_count, model_name, finish_reason, now],
    )?;

    // Update story modified_at
    conn.execute(
        "UPDATE items SET modified_at = ?1 WHERE id = ?2",
        rusqlite::params![now, story_id],
    )?;

    Ok(ChatMessage {
        id,
        story_id: story_id.to_string(),
        parent_id: Some(parent_id.to_string()),
        role: "model".to_string(),
        content_type: "text".to_string(),
        content: content.to_string(),
        token_count,
        model_name: Some(model_name.to_string()),
        finish_reason: finish_reason.map(|s| s.to_string()),
        created_at: now,
        deleted_at: None,
        user_feedback: None,
        ghostwriter_history: "[]".to_string(),
    })
}

/// Load the active branch of a story via Recursive CTE — Doc 09 §2.2.
///
/// Returns messages ordered root→leaf, plus sibling counts for fork points.
pub fn load_story_messages(
    conn: &Connection,
    story_id: &str,
    leaf_id: &str,
) -> Result<StoryPayload, LoomError> {
    // Active branch: walk from leaf to root, then reverse
    let mut stmt = conn.prepare(
        "WITH RECURSIVE branch AS (
            SELECT id, parent_id, role, content_type, content, token_count,
                   model_name, finish_reason, created_at, deleted_at,
                   user_feedback, ghostwriter_history, 0 AS depth
            FROM messages
            WHERE id = ?1 AND deleted_at IS NULL
            UNION ALL
            SELECT m.id, m.parent_id, m.role, m.content_type, m.content,
                   m.token_count, m.model_name, m.finish_reason, m.created_at,
                   m.deleted_at, m.user_feedback, m.ghostwriter_history,
                   b.depth + 1
            FROM messages m
            JOIN branch b ON m.id = b.parent_id
            WHERE m.deleted_at IS NULL
        )
        SELECT id, parent_id, role, content_type, content, token_count,
               model_name, finish_reason, created_at, deleted_at,
               user_feedback, ghostwriter_history
        FROM branch
        ORDER BY depth DESC",
    )?;

    let messages: Vec<ChatMessage> = stmt
        .query_map(rusqlite::params![leaf_id], |row| {
            Ok(ChatMessage {
                id: row.get(0)?,
                story_id: story_id.to_string(),
                parent_id: row.get(1)?,
                role: row.get(2)?,
                content_type: row.get(3)?,
                content: row.get(4)?,
                token_count: row.get(5)?,
                model_name: row.get(6)?,
                finish_reason: row.get(7)?,
                created_at: row.get(8)?,
                deleted_at: row.get(9)?,
                user_feedback: row.get(10)?,
                ghostwriter_history: row.get::<_, String>(11).unwrap_or_else(|_| "[]".to_string()),
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    // Sibling counts: fork points with >1 child — Doc 09 §2.2
    // Use COALESCE so root-level messages (parent_id IS NULL) are counted under '__root__'
    let mut sc_stmt = conn.prepare(
        "SELECT COALESCE(parent_id, '__root__') AS pid, COUNT(*) AS sibling_count
         FROM messages
         WHERE story_id = ?1 AND deleted_at IS NULL
         GROUP BY pid
         HAVING sibling_count > 1",
    )?;

    let sibling_counts: Vec<SiblingCount> = sc_stmt
        .query_map(rusqlite::params![story_id], |row| {
            Ok(SiblingCount {
                parent_id: row.get(0)?,
                count: row.get(1)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(StoryPayload {
        messages,
        sibling_counts,
    })
}

/// Get the saved leaf ID for a story from story_settings.
pub fn get_story_leaf_id(conn: &Connection, story_id: &str) -> Result<Option<String>, LoomError> {
    let result = conn
        .query_row(
            "SELECT value FROM story_settings WHERE story_id = ?1 AND key = 'leaf_id'",
            rusqlite::params![story_id],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .filter(|s| !s.is_empty());

    Ok(result)
}

/// Save the leaf ID for a story to story_settings.
pub fn set_story_leaf_id(
    conn: &Connection,
    story_id: &str,
    leaf_id: &str,
) -> Result<(), LoomError> {
    conn.execute(
        "INSERT OR REPLACE INTO story_settings (story_id, key, value) VALUES (?1, 'leaf_id', ?2)",
        rusqlite::params![story_id, leaf_id],
    )?;
    Ok(())
}

/// Get ordered sibling IDs for a given parent_id — Doc 09 §2.2.
/// Returns (sibling_ids, current_index) for navigation.
pub fn get_siblings(
    conn: &Connection,
    story_id: &str,
    parent_id: Option<&str>,
    current_id: &str,
) -> Result<(Vec<String>, usize), LoomError> {
    let siblings: Vec<String> = if let Some(pid) = parent_id {
        let mut stmt = conn.prepare(
            "SELECT id FROM messages
             WHERE story_id = ?1 AND parent_id = ?2 AND deleted_at IS NULL
             ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(rusqlite::params![story_id, pid], |row| row.get(0))?;
        rows.filter_map(|r| r.ok()).collect()
    } else {
        // Root messages (parent_id IS NULL)
        let mut stmt = conn.prepare(
            "SELECT id FROM messages
             WHERE story_id = ?1 AND parent_id IS NULL AND deleted_at IS NULL
             ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(rusqlite::params![story_id], |row| row.get(0))?;
        rows.filter_map(|r| r.ok()).collect()
    };

    let idx = siblings.iter().position(|id| id == current_id).unwrap_or(0);
    Ok((siblings, idx))
}

/// Find the deepest leaf reachable from a given message — Doc 09 §7.
/// Follows first child at each level until a leaf is reached.
pub fn find_deepest_leaf(conn: &Connection, story_id: &str, msg_id: &str) -> Result<String, LoomError> {
    let mut current = msg_id.to_string();
    loop {
        let child: Option<String> = conn
            .query_row(
                "SELECT id FROM messages
                 WHERE story_id = ?1 AND parent_id = ?2 AND deleted_at IS NULL
                 ORDER BY created_at ASC LIMIT 1",
                rusqlite::params![story_id, current],
                |row| row.get(0),
            )
            .ok();
        match child {
            Some(c) => current = c,
            None => return Ok(current),
        }
    }
}

/// Soft-delete a message (set deleted_at). Returns the parent_id.
pub fn soft_delete_message(conn: &Connection, message_id: &str) -> Result<Option<String>, LoomError> {
    let now = chrono::Utc::now().to_rfc3339();
    let parent_id: Option<String> = conn.query_row(
        "SELECT parent_id FROM messages WHERE id = ?1",
        rusqlite::params![message_id],
        |row| row.get(0),
    )?;

    conn.execute(
        "UPDATE messages SET deleted_at = ?1 WHERE id = ?2",
        rusqlite::params![now, message_id],
    )?;
    Ok(parent_id)
}

/// Undo soft-delete of a message (clear deleted_at).
pub fn undelete_message(conn: &Connection, message_id: &str) -> Result<(), LoomError> {
    conn.execute(
        "UPDATE messages SET deleted_at = NULL WHERE id = ?1",
        rusqlite::params![message_id],
    )?;
    Ok(())
}

/// Get a single message by ID.
pub fn get_message(conn: &Connection, message_id: &str) -> Result<ChatMessage, LoomError> {
    conn.query_row(
        "SELECT id, story_id, parent_id, role, content_type, content, token_count,
                model_name, finish_reason, created_at, deleted_at, user_feedback,
                ghostwriter_history
         FROM messages WHERE id = ?1",
        rusqlite::params![message_id],
        |row| {
            Ok(ChatMessage {
                id: row.get(0)?,
                story_id: row.get(1)?,
                parent_id: row.get(2)?,
                role: row.get(3)?,
                content_type: row.get(4)?,
                content: row.get(5)?,
                token_count: row.get(6)?,
                model_name: row.get(7)?,
                finish_reason: row.get(8)?,
                created_at: row.get(9)?,
                deleted_at: row.get(10)?,
                user_feedback: row.get(11)?,
                ghostwriter_history: row.get::<_, String>(12).unwrap_or_else(|_| "[]".to_string()),
            })
        },
    )
    .map_err(|_| LoomError::ItemNotFound(format!("Message {} not found", message_id)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        db::init_schema(&conn).unwrap();
        // Create a test story item
        conn.execute(
            "INSERT INTO items (id, item_type, name, sort_order, created_at, modified_at)
             VALUES ('story1', 'Story', 'Test Story', 0, '2024-01-01', '2024-01-01')",
            [],
        )
        .unwrap();
        conn
    }

    #[test]
    fn test_insert_and_load_messages() {
        let conn = test_db();

        let uc = UserContent {
            plot_direction: "The hero enters the cave.".to_string(),
            background_information: String::new(),
            modificators: vec![],
            constraints: String::new(),
            output_length: None,
            context_doc_names: vec![],
            image_blocks: vec![],
        };

        let user_msg = insert_user_message(&conn, "story1", None, &uc).unwrap();
        assert_eq!(user_msg.role, "user");
        assert_eq!(user_msg.content_type, "json_user");

        let model_msg = insert_model_message(
            &conn,
            "story1",
            &user_msg.id,
            "Darkness engulfed the hero...",
            Some(42),
            "gemini-2.5-flash",
            Some("STOP"),
        )
        .unwrap();
        assert_eq!(model_msg.role, "model");

        // Load the branch
        let payload = load_story_messages(&conn, "story1", &model_msg.id).unwrap();
        assert_eq!(payload.messages.len(), 2);
        assert_eq!(payload.messages[0].role, "user");
        assert_eq!(payload.messages[1].role, "model");
    }

    #[test]
    fn test_leaf_id_persistence() {
        let conn = test_db();

        assert!(get_story_leaf_id(&conn, "story1").unwrap().is_none());

        set_story_leaf_id(&conn, "story1", "msg123").unwrap();
        assert_eq!(
            get_story_leaf_id(&conn, "story1").unwrap(),
            Some("msg123".to_string())
        );

        // Overwrite
        set_story_leaf_id(&conn, "story1", "msg456").unwrap();
        assert_eq!(
            get_story_leaf_id(&conn, "story1").unwrap(),
            Some("msg456".to_string())
        );
    }
}
