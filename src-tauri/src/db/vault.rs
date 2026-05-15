//! Typed CRUD against the `items` table (Doc 03 §`items`, Doc 14).
//!
//! Per Doc 05 §Dependency Rules, `db/` may import only `rusqlite`. Business
//! logic (folder-children gating, vault_updated event emission, attachment
//! cascade) lives in `services/vault.rs` and `commands/vault.rs`; this
//! module owns the SQL.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::LoomError;

/// Per Doc 03 §`items`. IPC payload type for `list_items`, `create_item`,
/// etc. The schema's `content` column is fetched separately (only relevant
/// for SourceDocument bodies — Phase 5).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/lib/types.ts")]
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
    // Image-only fields (Phase 10). Always None for Story / Folder /
    // SourceDocument in v2.0.
    pub asset_path: Option<String>,
    pub asset_meta: Option<ImageAssetMeta>,
    pub file_api_uri: Option<String>,
}

/// Per Doc 03 §IPC Payload and Result Types. Image item metadata.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/lib/types.ts")]
pub struct ImageAssetMeta {
    pub width: i64,
    pub height: i64,
    pub mime_type: String,
}

/// SQL columns returned by `SELECT … FROM items`. Used by `row_to_item`.
const ITEM_COLUMNS: &str = "id, parent_id, item_type, item_subtype, name, description, \
                            sort_order, created_at, modified_at, deleted_at, \
                            asset_path, asset_meta, file_api_uri";

fn row_to_item(row: &Row<'_>) -> rusqlite::Result<VaultItemMeta> {
    let asset_meta_json: Option<String> = row.get("asset_meta")?;
    let asset_meta = match asset_meta_json {
        Some(json) => serde_json::from_str(&json).ok(),
        None => None,
    };
    Ok(VaultItemMeta {
        id: row.get("id")?,
        parent_id: row.get("parent_id")?,
        item_type: row.get("item_type")?,
        item_subtype: row.get("item_subtype")?,
        name: row.get("name")?,
        description: row.get("description")?,
        sort_order: row.get("sort_order")?,
        created_at: row.get("created_at")?,
        modified_at: row.get("modified_at")?,
        deleted_at: row.get("deleted_at")?,
        asset_path: row.get("asset_path")?,
        asset_meta,
        file_api_uri: row.get("file_api_uri")?,
    })
}

/// Insert a single item row.
pub fn insert_item(conn: &Connection, item: &VaultItemMeta) -> Result<(), LoomError> {
    let asset_meta_json = match &item.asset_meta {
        Some(meta) => Some(serde_json::to_string(meta).map_err(LoomError::from)?),
        None => None,
    };
    conn.execute(
        "INSERT INTO items
            (id, parent_id, item_type, item_subtype, name, description,
             sort_order, created_at, modified_at, deleted_at,
             asset_path, asset_meta, file_api_uri)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            item.id,
            item.parent_id,
            item.item_type,
            item.item_subtype,
            item.name,
            item.description,
            item.sort_order,
            item.created_at,
            item.modified_at,
            item.deleted_at,
            item.asset_path,
            asset_meta_json,
            item.file_api_uri,
        ],
    )
    .map_err(|e| LoomError::Database(e.to_string()))?;
    Ok(())
}

/// Return one item by id, or None if not found.
pub fn get_item(conn: &Connection, id: &str) -> Result<Option<VaultItemMeta>, LoomError> {
    let sql = format!("SELECT {ITEM_COLUMNS} FROM items WHERE id = ?1");
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| LoomError::Database(e.to_string()))?;
    let mut rows = stmt
        .query(params![id])
        .map_err(|e| LoomError::Database(e.to_string()))?;
    match rows
        .next()
        .map_err(|e| LoomError::Database(e.to_string()))?
    {
        Some(row) => Ok(Some(
            row_to_item(row).map_err(|e| LoomError::Database(e.to_string()))?,
        )),
        None => Ok(None),
    }
}

/// List all items. With `include_deleted = false`, only live items
/// (`deleted_at IS NULL`) are returned. With `true`, every row is
/// returned — used for the Trash view.
///
/// Ordered by `(parent_id NULLS FIRST, sort_order, name)` so callers can
/// rebuild the tree without further sorting.
pub fn list_items(
    conn: &Connection,
    include_deleted: bool,
) -> Result<Vec<VaultItemMeta>, LoomError> {
    let where_clause = if include_deleted {
        ""
    } else {
        "WHERE deleted_at IS NULL"
    };
    let sql = format!(
        "SELECT {ITEM_COLUMNS} FROM items {where_clause}
         ORDER BY parent_id IS NULL DESC, parent_id, sort_order, name"
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| LoomError::Database(e.to_string()))?;
    let rows = stmt
        .query_map([], row_to_item)
        .map_err(|e| LoomError::Database(e.to_string()))?;
    let mut items = Vec::new();
    for r in rows {
        items.push(r.map_err(|e| LoomError::Database(e.to_string()))?);
    }
    Ok(items)
}

/// Read the Gemini File API URI + upload timestamp for an Image item. Both
/// fields are nullable until the first successful upload (Doc 22 §Image
/// source documents, Phase 6B). Returns `(None, None)` for items without an
/// upload yet, or for non-Image rows.
pub fn get_file_api_state(
    conn: &Connection,
    id: &str,
) -> Result<(Option<String>, Option<String>), LoomError> {
    let row = conn
        .query_row(
            "SELECT file_api_uri, file_api_uploaded_at FROM items WHERE id = ?1",
            params![id],
            |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?,
                    r.get::<_, Option<String>>(1)?,
                ))
            },
        )
        .optional()?;
    Ok(row.unwrap_or((None, None)))
}

/// Persist a freshly-uploaded File API URI for an Image item. Caller is
/// responsible for `now_iso()` formatting.
pub fn set_file_api_uri(
    conn: &Connection,
    id: &str,
    uri: &str,
    uploaded_at: &str,
) -> Result<(), LoomError> {
    let n = conn.execute(
        "UPDATE items SET file_api_uri = ?1, file_api_uploaded_at = ?2, modified_at = ?2
         WHERE id = ?3",
        params![uri, uploaded_at, id],
    )?;
    if n == 0 {
        return Err(LoomError::NotFound(format!("item {id} not found")));
    }
    Ok(())
}

/// Read an item's `content` column. Returns `None` if the item does not
/// exist. Empty string for items without source-doc content (the schema
/// default).
pub fn get_item_content(conn: &Connection, id: &str) -> Result<Option<String>, LoomError> {
    let content: Option<String> = conn
        .query_row(
            "SELECT content FROM items WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| LoomError::Database(e.to_string()))?;
    Ok(content)
}

/// Update `content` and `modified_at` on a single item. The service layer
/// validates that the item is a SourceDocument or Image; this function
/// trusts its inputs.
pub fn update_item_content(
    conn: &Connection,
    id: &str,
    content: &str,
    modified_at: &str,
) -> Result<(), LoomError> {
    let n = conn
        .execute(
            "UPDATE items SET content = ?1, modified_at = ?2 WHERE id = ?3",
            params![content, modified_at, id],
        )
        .map_err(|e| LoomError::Database(e.to_string()))?;
    if n == 0 {
        return Err(LoomError::NotFound(format!("item {id} not found")));
    }
    Ok(())
}

/// Update `name` and `modified_at` on a single item. Empty `name` is
/// rejected at the service layer; this function trusts its inputs.
pub fn rename_item(
    conn: &Connection,
    id: &str,
    name: &str,
    modified_at: &str,
) -> Result<(), LoomError> {
    let n = conn
        .execute(
            "UPDATE items SET name = ?1, modified_at = ?2 WHERE id = ?3",
            params![name, modified_at, id],
        )
        .map_err(|e| LoomError::Database(e.to_string()))?;
    if n == 0 {
        return Err(LoomError::NotFound(format!("item {id} not found")));
    }
    Ok(())
}

/// Update `parent_id`, `sort_order`, and `modified_at`.
pub fn move_item(
    conn: &Connection,
    id: &str,
    new_parent_id: Option<&str>,
    new_sort_order: i64,
    modified_at: &str,
) -> Result<(), LoomError> {
    let n = conn
        .execute(
            "UPDATE items SET parent_id = ?1, sort_order = ?2, modified_at = ?3 WHERE id = ?4",
            params![new_parent_id, new_sort_order, modified_at, id],
        )
        .map_err(|e| LoomError::Database(e.to_string()))?;
    if n == 0 {
        return Err(LoomError::NotFound(format!("item {id} not found")));
    }
    Ok(())
}

/// Set `deleted_at` (soft delete). The `modified_at` field is NOT touched —
/// soft-delete is metadata, not user-facing modification.
pub fn soft_delete_item(conn: &Connection, id: &str, deleted_at: &str) -> Result<(), LoomError> {
    let n = conn
        .execute(
            "UPDATE items SET deleted_at = ?1 WHERE id = ?2",
            params![deleted_at, id],
        )
        .map_err(|e| LoomError::Database(e.to_string()))?;
    if n == 0 {
        return Err(LoomError::NotFound(format!("item {id} not found")));
    }
    Ok(())
}

/// Clear `deleted_at` (restore from trash).
pub fn restore_item(conn: &Connection, id: &str) -> Result<(), LoomError> {
    let n = conn
        .execute(
            "UPDATE items SET deleted_at = NULL WHERE id = ?1",
            params![id],
        )
        .map_err(|e| LoomError::Database(e.to_string()))?;
    if n == 0 {
        return Err(LoomError::NotFound(format!("item {id} not found")));
    }
    Ok(())
}

/// Hard delete a single item. Cascading FK constraints (e.g.
/// `messages.story_id REFERENCES items(id) ON DELETE CASCADE`) handle
/// dependent rows.
pub fn delete_item_permanent(conn: &Connection, id: &str) -> Result<(), LoomError> {
    let n = conn
        .execute("DELETE FROM items WHERE id = ?1", params![id])
        .map_err(|e| LoomError::Database(e.to_string()))?;
    if n == 0 {
        return Err(LoomError::NotFound(format!("item {id} not found")));
    }
    Ok(())
}

/// Hard delete every soft-deleted item. Returns the count removed.
pub fn empty_trash(conn: &Connection) -> Result<u32, LoomError> {
    let n = conn
        .execute("DELETE FROM items WHERE deleted_at IS NOT NULL", [])
        .map_err(|e| LoomError::Database(e.to_string()))?;
    u32::try_from(n).map_err(|_| LoomError::Internal("empty_trash count overflow".into()))
}

/// True if `id` references a folder that has at least one live (non-deleted)
/// child. Doc 14 §Delete (soft) — folders cannot be soft-deleted while they
/// hold children.
pub fn folder_has_children(conn: &Connection, id: &str) -> Result<bool, LoomError> {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM items WHERE parent_id = ?1 AND deleted_at IS NULL",
            params![id],
            |r| r.get(0),
        )
        .map_err(|e| LoomError::Database(e.to_string()))?;
    Ok(n > 0)
}

/// Compute the next sort_order for a new item under `parent_id` (or root).
/// Used so newly-created items append to the end of their siblings.
pub fn next_sort_order(conn: &Connection, parent_id: Option<&str>) -> Result<i64, LoomError> {
    // SQLite treats `IS ?` differently from `=` when matching NULL — using
    // `IS` here so root-level items (parent_id NULL) are matched correctly.
    let n: Option<i64> = conn
        .query_row(
            "SELECT MAX(sort_order) FROM items WHERE parent_id IS ?1",
            params![parent_id],
            |r| r.get(0),
        )
        .map_err(|e| LoomError::Database(e.to_string()))?;
    Ok(n.map(|x| x + 1).unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::{apply_pending, MigrationRoot};

    fn fresh_conn() -> Connection {
        let mut conn = Connection::open_in_memory().expect("in-memory open");
        apply_pending(&mut conn, MigrationRoot::World).expect("world migrations");
        conn
    }

    fn make_item(
        id: &str,
        parent: Option<&str>,
        kind: &str,
        name: &str,
        sort: i64,
    ) -> VaultItemMeta {
        VaultItemMeta {
            id: id.into(),
            parent_id: parent.map(str::to_owned),
            item_type: kind.into(),
            item_subtype: None,
            name: name.into(),
            description: None,
            sort_order: sort,
            created_at: "2026-01-01T00:00:00Z".into(),
            modified_at: "2026-01-01T00:00:00Z".into(),
            deleted_at: None,
            asset_path: None,
            asset_meta: None,
            file_api_uri: None,
        }
    }

    #[test]
    fn insert_and_get_round_trip() {
        let conn = fresh_conn();
        let item = make_item("a", None, "Story", "First", 0);
        insert_item(&conn, &item).unwrap();
        let loaded = get_item(&conn, "a").unwrap().unwrap();
        assert_eq!(loaded.name, "First");
        assert_eq!(loaded.item_type, "Story");
    }

    #[test]
    fn list_excludes_soft_deleted_by_default() {
        let conn = fresh_conn();
        insert_item(&conn, &make_item("a", None, "Story", "Live", 0)).unwrap();
        insert_item(&conn, &make_item("b", None, "Story", "Trashed", 1)).unwrap();
        soft_delete_item(&conn, "b", "2026-02-01T00:00:00Z").unwrap();

        let live = list_items(&conn, false).unwrap();
        assert_eq!(live.len(), 1);
        assert_eq!(live[0].id, "a");

        let all = list_items(&conn, true).unwrap();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn rename_updates_name_and_modified_at() {
        let conn = fresh_conn();
        insert_item(&conn, &make_item("a", None, "Story", "Old", 0)).unwrap();
        rename_item(&conn, "a", "New", "2026-03-01T00:00:00Z").unwrap();
        let item = get_item(&conn, "a").unwrap().unwrap();
        assert_eq!(item.name, "New");
        assert_eq!(item.modified_at, "2026-03-01T00:00:00Z");
    }

    #[test]
    fn move_changes_parent_and_sort_order() {
        let conn = fresh_conn();
        insert_item(&conn, &make_item("p", None, "Folder", "Parent", 0)).unwrap();
        insert_item(&conn, &make_item("a", None, "Story", "Item", 0)).unwrap();
        move_item(&conn, "a", Some("p"), 5, "2026-04-01T00:00:00Z").unwrap();
        let item = get_item(&conn, "a").unwrap().unwrap();
        assert_eq!(item.parent_id.as_deref(), Some("p"));
        assert_eq!(item.sort_order, 5);
    }

    #[test]
    fn folder_has_children_detects_live_only() {
        let conn = fresh_conn();
        insert_item(&conn, &make_item("p", None, "Folder", "Parent", 0)).unwrap();
        assert!(!folder_has_children(&conn, "p").unwrap());

        insert_item(&conn, &make_item("a", Some("p"), "Story", "Child", 0)).unwrap();
        assert!(folder_has_children(&conn, "p").unwrap());

        soft_delete_item(&conn, "a", "2026-04-01T00:00:00Z").unwrap();
        // Soft-deleted children no longer count.
        assert!(!folder_has_children(&conn, "p").unwrap());
    }

    #[test]
    fn empty_trash_removes_all_soft_deleted() {
        let conn = fresh_conn();
        insert_item(&conn, &make_item("a", None, "Story", "A", 0)).unwrap();
        insert_item(&conn, &make_item("b", None, "Story", "B", 1)).unwrap();
        insert_item(&conn, &make_item("c", None, "Story", "C", 2)).unwrap();
        soft_delete_item(&conn, "a", "2026-04-01T00:00:00Z").unwrap();
        soft_delete_item(&conn, "c", "2026-04-01T00:00:00Z").unwrap();
        let n = empty_trash(&conn).unwrap();
        assert_eq!(n, 2);
        assert_eq!(list_items(&conn, true).unwrap().len(), 1);
    }

    #[test]
    fn next_sort_order_root_starts_at_zero() {
        let conn = fresh_conn();
        assert_eq!(next_sort_order(&conn, None).unwrap(), 0);
        insert_item(&conn, &make_item("a", None, "Story", "A", 0)).unwrap();
        assert_eq!(next_sort_order(&conn, None).unwrap(), 1);
        insert_item(&conn, &make_item("b", None, "Story", "B", 1)).unwrap();
        assert_eq!(next_sort_order(&conn, None).unwrap(), 2);
    }

    #[test]
    fn next_sort_order_nested() {
        let conn = fresh_conn();
        insert_item(&conn, &make_item("p", None, "Folder", "P", 0)).unwrap();
        assert_eq!(next_sort_order(&conn, Some("p")).unwrap(), 0);
        insert_item(&conn, &make_item("a", Some("p"), "Story", "A", 0)).unwrap();
        assert_eq!(next_sort_order(&conn, Some("p")).unwrap(), 1);
    }

    #[test]
    fn restore_clears_deleted_at() {
        let conn = fresh_conn();
        insert_item(&conn, &make_item("a", None, "Story", "A", 0)).unwrap();
        soft_delete_item(&conn, "a", "2026-04-01T00:00:00Z").unwrap();
        restore_item(&conn, "a").unwrap();
        let item = get_item(&conn, "a").unwrap().unwrap();
        assert!(item.deleted_at.is_none());
    }
}
