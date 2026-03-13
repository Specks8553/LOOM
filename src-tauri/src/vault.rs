use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::error::LoomError;

/// Vault item metadata returned to the frontend (excludes `content` and `story_id`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultItemMeta {
    pub id: String,
    pub parent_id: Option<String>,
    pub item_type: String,
    pub item_subtype: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
    pub modified_at: String,
    pub deleted_at: Option<String>,
}

/// List all non-deleted vault items.
pub fn list_items(conn: &Connection) -> Result<Vec<VaultItemMeta>, LoomError> {
    let mut stmt = conn.prepare(
        "SELECT id, parent_id, item_type, item_subtype, name, description, sort_order,
                created_at, modified_at, deleted_at
         FROM items WHERE deleted_at IS NULL
         ORDER BY sort_order ASC, name ASC"
    )?;

    let items = stmt.query_map([], |row| {
        Ok(VaultItemMeta {
            id: row.get(0)?,
            parent_id: row.get(1)?,
            item_type: row.get(2)?,
            item_subtype: row.get(3)?,
            name: row.get(4)?,
            description: row.get(5)?,
            sort_order: row.get(6)?,
            created_at: row.get(7)?,
            modified_at: row.get(8)?,
            deleted_at: row.get(9)?,
        })
    })?.filter_map(|r| r.ok()).collect();

    Ok(items)
}

/// List all soft-deleted vault items (trash).
pub fn list_trash(conn: &Connection) -> Result<Vec<VaultItemMeta>, LoomError> {
    let mut stmt = conn.prepare(
        "SELECT id, parent_id, item_type, item_subtype, name, description, sort_order,
                created_at, modified_at, deleted_at
         FROM items WHERE deleted_at IS NOT NULL
         ORDER BY deleted_at DESC"
    )?;

    let items = stmt.query_map([], |row| {
        Ok(VaultItemMeta {
            id: row.get(0)?,
            parent_id: row.get(1)?,
            item_type: row.get(2)?,
            item_subtype: row.get(3)?,
            name: row.get(4)?,
            description: row.get(5)?,
            sort_order: row.get(6)?,
            created_at: row.get(7)?,
            modified_at: row.get(8)?,
            deleted_at: row.get(9)?,
        })
    })?.filter_map(|r| r.ok()).collect();

    Ok(items)
}

/// Calculate the nesting depth of a parent_id by walking the parent chain.
/// Returns 0 for root items (parent_id = NULL), 1 for children of root, etc.
fn get_depth(conn: &Connection, parent_id: Option<&str>) -> Result<u32, LoomError> {
    let pid = match parent_id {
        Some(id) if !id.is_empty() => id,
        _ => return Ok(0),
    };

    let depth: u32 = conn.query_row(
        "WITH RECURSIVE ancestors(id, parent_id, depth) AS (
            SELECT id, parent_id, 1 FROM items WHERE id = ?1
            UNION ALL
            SELECT i.id, i.parent_id, a.depth + 1
            FROM items i JOIN ancestors a ON i.id = a.parent_id
            WHERE i.parent_id IS NOT NULL
        )
        SELECT MAX(depth) FROM ancestors",
        rusqlite::params![pid],
        |row| row.get::<_, u32>(0),
    )?;

    Ok(depth)
}

/// Create a new vault item.
pub fn create_item(
    conn: &Connection,
    item_type: &str,
    name: &str,
    parent_id: Option<&str>,
    subtype: Option<&str>,
) -> Result<VaultItemMeta, LoomError> {
    // Validate item type
    match item_type {
        "Story" | "Folder" | "SourceDocument" | "Image" => {}
        other => return Err(LoomError::InvalidItemType(other.to_string())),
    }

    // Enforce 5-level nesting depth
    let depth = get_depth(conn, parent_id)?;
    if depth >= 5 {
        return Err(LoomError::MaxNestingDepth);
    }

    // Calculate sort_order: max existing + 1 at this level
    let sort_order: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM items
         WHERE parent_id IS ?1 AND deleted_at IS NULL",
        rusqlite::params![parent_id],
        |row| row.get(0),
    )?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // For stories, story_id = id. For others, story_id is NULL.
    let story_id: Option<&str> = if item_type == "Story" { Some(&id) } else { None };

    conn.execute(
        "INSERT INTO items (id, story_id, parent_id, item_type, item_subtype, name, content,
                           description, sort_order, created_at, modified_at, deleted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, '', NULL, ?7, ?8, ?9, NULL)",
        rusqlite::params![id, story_id, parent_id, item_type, subtype, name, sort_order, now, now],
    )?;

    log::info!("Vault item created: id={}, type={}", id, item_type);

    Ok(VaultItemMeta {
        id,
        parent_id: parent_id.map(|s| s.to_string()),
        item_type: item_type.to_string(),
        item_subtype: subtype.map(|s| s.to_string()),
        name: name.to_string(),
        description: None,
        sort_order,
        created_at: now.clone(),
        modified_at: now,
        deleted_at: None,
    })
}

/// Rename a vault item.
pub fn rename_item(conn: &Connection, id: &str, name: &str) -> Result<(), LoomError> {
    let now = chrono::Utc::now().to_rfc3339();
    let rows = conn.execute(
        "UPDATE items SET name = ?1, modified_at = ?2 WHERE id = ?3",
        rusqlite::params![name, now, id],
    )?;
    if rows == 0 {
        return Err(LoomError::ItemNotFound(id.to_string()));
    }
    Ok(())
}

/// Move a vault item to a new parent with a new sort order.
pub fn move_item(
    conn: &Connection,
    id: &str,
    new_parent_id: Option<&str>,
    new_sort_order: i64,
) -> Result<(), LoomError> {
    // Enforce depth limit
    let depth = get_depth(conn, new_parent_id)?;
    // +1 because the item itself adds one more level; also check if item is a folder with children
    if depth >= 5 {
        return Err(LoomError::MaxNestingDepth);
    }

    // Prevent moving item into itself or its own descendant
    if let Some(pid) = new_parent_id {
        if pid == id {
            return Err(LoomError::Validation("Cannot move item into itself.".into()));
        }
        // Check if new_parent_id is a descendant of id
        let is_descendant: bool = conn.query_row(
            "WITH RECURSIVE ancestors(aid) AS (
                SELECT parent_id FROM items WHERE id = ?1
                UNION ALL
                SELECT i.parent_id FROM items i JOIN ancestors a ON i.id = a.aid
                WHERE i.parent_id IS NOT NULL
            )
            SELECT EXISTS(SELECT 1 FROM ancestors WHERE aid = ?2)",
            rusqlite::params![pid, id],
            |row| row.get(0),
        )?;
        if is_descendant {
            return Err(LoomError::Validation("Cannot move item into its own descendant.".into()));
        }
    }

    let now = chrono::Utc::now().to_rfc3339();
    let rows = conn.execute(
        "UPDATE items SET parent_id = ?1, sort_order = ?2, modified_at = ?3 WHERE id = ?4",
        rusqlite::params![new_parent_id, new_sort_order, now, id],
    )?;
    if rows == 0 {
        return Err(LoomError::ItemNotFound(id.to_string()));
    }
    Ok(())
}

/// Soft-delete a vault item (set deleted_at).
pub fn soft_delete(conn: &Connection, id: &str) -> Result<(), LoomError> {
    let now = chrono::Utc::now().to_rfc3339();
    let rows = conn.execute(
        "UPDATE items SET deleted_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
        rusqlite::params![now, id],
    )?;
    if rows == 0 {
        return Err(LoomError::ItemNotFound(id.to_string()));
    }

    // Also soft-delete children (for folders)
    conn.execute(
        "UPDATE items SET deleted_at = ?1 WHERE parent_id = ?2 AND deleted_at IS NULL",
        rusqlite::params![now, id],
    )?;

    Ok(())
}

/// Restore a soft-deleted vault item.
pub fn restore_item(conn: &Connection, id: &str) -> Result<(), LoomError> {
    let rows = conn.execute(
        "UPDATE items SET deleted_at = NULL WHERE id = ?1 AND deleted_at IS NOT NULL",
        rusqlite::params![id],
    )?;
    if rows == 0 {
        return Err(LoomError::ItemNotFound(id.to_string()));
    }

    // Also restore children that were deleted at the same time
    conn.execute(
        "UPDATE items SET deleted_at = NULL WHERE parent_id = ?1 AND deleted_at IS NOT NULL",
        rusqlite::params![id],
    )?;

    Ok(())
}

/// Permanently delete a vault item and all its children.
pub fn purge_item(conn: &Connection, id: &str) -> Result<(), LoomError> {
    // Delete children first (recursive via foreign key would also work with CASCADE
    // but we do explicit for safety)
    conn.execute(
        "DELETE FROM items WHERE parent_id = ?1",
        rusqlite::params![id],
    )?;
    let rows = conn.execute(
        "DELETE FROM items WHERE id = ?1",
        rusqlite::params![id],
    )?;
    if rows == 0 {
        return Err(LoomError::ItemNotFound(id.to_string()));
    }
    Ok(())
}

/// Batch update sort_order for multiple items.
pub fn update_sort_order(
    conn: &Connection,
    items: &[(String, i64)],
) -> Result<(), LoomError> {
    let mut stmt = conn.prepare(
        "UPDATE items SET sort_order = ?1 WHERE id = ?2"
    )?;
    for (id, order) in items {
        stmt.execute(rusqlite::params![order, id])?;
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

    #[test]
    fn test_create_and_list_items() {
        let conn = test_db();
        let item = create_item(&conn, "Story", "Test Story", None, None).unwrap();
        assert_eq!(item.name, "Test Story");
        assert_eq!(item.item_type, "Story");

        let items = list_items(&conn).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "Test Story");
    }

    #[test]
    fn test_rename_item() {
        let conn = test_db();
        let item = create_item(&conn, "Story", "Original", None, None).unwrap();
        rename_item(&conn, &item.id, "Renamed").unwrap();

        let items = list_items(&conn).unwrap();
        assert_eq!(items[0].name, "Renamed");
    }

    #[test]
    fn test_soft_delete_and_restore() {
        let conn = test_db();
        let item = create_item(&conn, "Story", "ToDelete", None, None).unwrap();

        soft_delete(&conn, &item.id).unwrap();
        assert_eq!(list_items(&conn).unwrap().len(), 0);
        assert_eq!(list_trash(&conn).unwrap().len(), 1);

        restore_item(&conn, &item.id).unwrap();
        assert_eq!(list_items(&conn).unwrap().len(), 1);
        assert_eq!(list_trash(&conn).unwrap().len(), 0);
    }

    #[test]
    fn test_purge_item() {
        let conn = test_db();
        let item = create_item(&conn, "Story", "ToPurge", None, None).unwrap();
        purge_item(&conn, &item.id).unwrap();
        assert_eq!(list_items(&conn).unwrap().len(), 0);
        assert_eq!(list_trash(&conn).unwrap().len(), 0);
    }

    #[test]
    fn test_max_nesting_depth() {
        let conn = test_db();
        let f1 = create_item(&conn, "Folder", "L1", None, None).unwrap();
        let f2 = create_item(&conn, "Folder", "L2", Some(&f1.id), None).unwrap();
        let f3 = create_item(&conn, "Folder", "L3", Some(&f2.id), None).unwrap();
        let f4 = create_item(&conn, "Folder", "L4", Some(&f3.id), None).unwrap();
        let f5 = create_item(&conn, "Folder", "L5", Some(&f4.id), None).unwrap();

        // L6 should fail
        let result = create_item(&conn, "Folder", "L6", Some(&f5.id), None);
        assert!(result.is_err());
    }

    #[test]
    fn test_sort_order_increments() {
        let conn = test_db();
        let a = create_item(&conn, "Story", "A", None, None).unwrap();
        let b = create_item(&conn, "Story", "B", None, None).unwrap();
        let c = create_item(&conn, "Story", "C", None, None).unwrap();
        assert_eq!(a.sort_order, 0);
        assert_eq!(b.sort_order, 1);
        assert_eq!(c.sort_order, 2);
    }
}
