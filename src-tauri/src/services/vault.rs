//! Vault item domain logic (Doc 14 §Vault Tree, Doc 18 §Cascade Rules).
//!
//! Owns:
//!   - Item creation with default sort_order + UUID + timestamps
//!   - Folder-with-children gate on soft-delete (Doc 14)
//!   - Restore behavior (orphan parent → restore to root)
//!   - Now-iso clock (single source for `created_at` / `modified_at`)
//!
//! Out of scope here (defers to later phases):
//!   - Soft-delete cascade detach for SourceDocuments (Doc 18; Phase 5)
//!   - Image assets removal from disk on hard-delete (Phase 10)
//!   - Template-driven SourceDocument body initialisation (Phase 5)
//!
//! Per Doc 05 §Dependency Rules, `services/` may import `db/` and `state/`
//! (read-only). Event emission is the command layer's responsibility — this
//! module is sync and side-effect-bounded to the SQL.

use rusqlite::Connection;
use uuid::Uuid;

use crate::db::vault::{self, VaultItemMeta};
use crate::error::LoomError;

/// Single source of truth for ISO 8601 timestamps in this module.
pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Validate item name. Empty / whitespace / overlong names are rejected.
fn validate_item_name(name: &str) -> Result<String, LoomError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(LoomError::validation("Item name cannot be empty"));
    }
    if trimmed.chars().count() > 200 {
        return Err(LoomError::validation(
            "Item name must be 200 characters or fewer",
        ));
    }
    Ok(trimmed.to_owned())
}

/// Allowed item types accepted at the IPC boundary. `Image` is reserved for
/// Phase 10; v2.0 Phase 2 only creates Story / Folder / SourceDocument.
fn validate_item_type(item_type: &str) -> Result<(), LoomError> {
    match item_type {
        "Story" | "Folder" | "SourceDocument" => Ok(()),
        "Image" => Err(LoomError::validation(
            "Image items cannot be created directly; use upload_image (Phase 10).",
        )),
        other => Err(LoomError::validation(format!("Unknown item type: {other}"))),
    }
}

/// Verify `parent_id` references a live folder (or is None for root).
fn validate_parent(conn: &Connection, parent_id: Option<&str>) -> Result<(), LoomError> {
    let Some(pid) = parent_id else { return Ok(()) };
    let Some(parent) = vault::get_item(conn, pid)? else {
        return Err(LoomError::NotFound(format!("parent item {pid} not found")));
    };
    if parent.deleted_at.is_some() {
        return Err(LoomError::validation(
            "Cannot create an item under a deleted folder.",
        ));
    }
    if parent.item_type != "Folder" {
        return Err(LoomError::validation("Parent must be a folder."));
    }
    Ok(())
}

/// Create a new item: validate, generate id + sort_order + timestamps,
/// insert. Returns the persisted record.
pub fn create_item(
    conn: &Connection,
    parent_id: Option<&str>,
    item_type: &str,
    name: &str,
    template_slug: Option<&str>,
) -> Result<VaultItemMeta, LoomError> {
    validate_item_type(item_type)?;
    validate_parent(conn, parent_id)?;
    let trimmed_name = validate_item_name(name)?;

    // template_slug is only meaningful on SourceDocument items; for Phase 2C
    // it's stored as `item_subtype` and the template body is left empty
    // (Phase 5 owns DocEditor + template content loading).
    let item_subtype = match (item_type, template_slug) {
        ("SourceDocument", Some(slug)) => Some(slug.to_owned()),
        _ => None,
    };

    let now = now_iso();
    let item = VaultItemMeta {
        id: Uuid::new_v4().to_string(),
        parent_id: parent_id.map(str::to_owned),
        item_type: item_type.to_owned(),
        item_subtype,
        name: trimmed_name,
        description: None,
        sort_order: vault::next_sort_order(conn, parent_id)?,
        created_at: now.clone(),
        modified_at: now,
        deleted_at: None,
        asset_path: None,
        asset_meta: None,
        file_api_uri: None,
    };
    vault::insert_item(conn, &item)?;
    Ok(item)
}

/// Rename an item; bumps `modified_at`.
pub fn rename_item(conn: &Connection, id: &str, name: &str) -> Result<(), LoomError> {
    let trimmed = validate_item_name(name)?;
    vault::rename_item(conn, id, &trimmed, &now_iso())
}

/// Move an item to a new parent / sort_order. Validates the new parent and
/// rejects cycles (moving a folder under one of its own descendants).
pub fn move_item(
    conn: &Connection,
    id: &str,
    new_parent_id: Option<&str>,
    new_sort_order: i64,
) -> Result<(), LoomError> {
    if Some(id) == new_parent_id {
        return Err(LoomError::validation("An item cannot be its own parent."));
    }
    validate_parent(conn, new_parent_id)?;

    // Walk ancestors of new_parent_id; if any ancestor is `id`, the move
    // would create a cycle.
    let mut cursor = new_parent_id.map(str::to_owned);
    while let Some(pid) = cursor {
        if pid == id {
            return Err(LoomError::validation(
                "Cannot move a folder into one of its own descendants.",
            ));
        }
        cursor = match vault::get_item(conn, &pid)? {
            Some(parent) => parent.parent_id,
            None => None,
        };
    }

    vault::move_item(conn, id, new_parent_id, new_sort_order, &now_iso())
}

/// Soft-delete with the folder-children gate. Doc 14 §Delete (soft):
/// folders cannot be soft-deleted while they hold children — children must
/// be deleted or moved first.
pub fn soft_delete_item(conn: &Connection, id: &str) -> Result<(), LoomError> {
    let item = vault::get_item(conn, id)?
        .ok_or_else(|| LoomError::NotFound(format!("item {id} not found")))?;
    if item.deleted_at.is_some() {
        return Ok(()); // already trashed; idempotent
    }
    if item.item_type == "Folder" && vault::folder_has_children(conn, id)? {
        return Err(LoomError::validation(
            "A folder must be empty before it can be deleted.",
        ));
    }
    vault::soft_delete_item(conn, id, &now_iso())
}

/// Restore from trash. If the original parent was also soft-deleted, the
/// item is restored to the vault root (Doc 14 §Edge Cases).
pub fn restore_item(conn: &Connection, id: &str) -> Result<(), LoomError> {
    let item = vault::get_item(conn, id)?
        .ok_or_else(|| LoomError::NotFound(format!("item {id} not found")))?;

    if let Some(pid) = item.parent_id.as_deref() {
        if let Some(parent) = vault::get_item(conn, pid)? {
            if parent.deleted_at.is_some() {
                // Reparent to root before restoring.
                vault::move_item(
                    conn,
                    id,
                    None,
                    vault::next_sort_order(conn, None)?,
                    &now_iso(),
                )?;
            }
        }
    }
    vault::restore_item(conn, id)
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

    #[test]
    fn create_item_assigns_id_and_sort_order() {
        let conn = fresh_conn();
        let a = create_item(&conn, None, "Story", "First", None).unwrap();
        assert!(!a.id.is_empty());
        assert_eq!(a.sort_order, 0);

        let b = create_item(&conn, None, "Story", "Second", None).unwrap();
        assert_eq!(b.sort_order, 1);
    }

    #[test]
    fn create_item_rejects_image_type() {
        let conn = fresh_conn();
        let err = create_item(&conn, None, "Image", "x.png", None).unwrap_err();
        assert!(matches!(err, LoomError::Validation { .. }));
    }

    #[test]
    fn create_item_rejects_unknown_type() {
        let conn = fresh_conn();
        let err = create_item(&conn, None, "Wibble", "x", None).unwrap_err();
        assert!(matches!(err, LoomError::Validation { .. }));
    }

    #[test]
    fn create_item_rejects_empty_name() {
        let conn = fresh_conn();
        let err = create_item(&conn, None, "Story", "   ", None).unwrap_err();
        assert!(matches!(err, LoomError::Validation { .. }));
    }

    #[test]
    fn create_item_under_non_folder_parent_fails() {
        let conn = fresh_conn();
        let s = create_item(&conn, None, "Story", "Tale", None).unwrap();
        let err = create_item(&conn, Some(&s.id), "Story", "Sub", None).unwrap_err();
        assert!(matches!(err, LoomError::Validation { .. }));
    }

    #[test]
    fn template_slug_lands_in_item_subtype_for_source_documents_only() {
        let conn = fresh_conn();
        let doc = create_item(&conn, None, "SourceDocument", "Doc", Some("character")).unwrap();
        assert_eq!(doc.item_subtype.as_deref(), Some("character"));

        let story = create_item(&conn, None, "Story", "Story", Some("character")).unwrap();
        assert_eq!(story.item_subtype, None);
    }

    #[test]
    fn soft_delete_blocks_folder_with_children() {
        let conn = fresh_conn();
        let p = create_item(&conn, None, "Folder", "P", None).unwrap();
        let _c = create_item(&conn, Some(&p.id), "Story", "C", None).unwrap();
        let err = soft_delete_item(&conn, &p.id).unwrap_err();
        assert!(matches!(err, LoomError::Validation { .. }));
    }

    #[test]
    fn soft_delete_idempotent() {
        let conn = fresh_conn();
        let s = create_item(&conn, None, "Story", "S", None).unwrap();
        soft_delete_item(&conn, &s.id).unwrap();
        // Second call must not error.
        soft_delete_item(&conn, &s.id).unwrap();
    }

    #[test]
    fn restore_with_deleted_parent_reparents_to_root() {
        let conn = fresh_conn();
        let p = create_item(&conn, None, "Folder", "P", None).unwrap();
        let c = create_item(&conn, Some(&p.id), "Story", "C", None).unwrap();
        // Delete child first, then parent (parent now empty), then trash both.
        soft_delete_item(&conn, &c.id).unwrap();
        soft_delete_item(&conn, &p.id).unwrap();
        // Restore the child: parent is still trashed → child should land at root.
        restore_item(&conn, &c.id).unwrap();
        let restored = vault::get_item(&conn, &c.id).unwrap().unwrap();
        assert!(restored.deleted_at.is_none());
        assert!(restored.parent_id.is_none());
    }

    #[test]
    fn move_item_rejects_self_as_parent() {
        let conn = fresh_conn();
        let f = create_item(&conn, None, "Folder", "F", None).unwrap();
        let err = move_item(&conn, &f.id, Some(&f.id), 0).unwrap_err();
        assert!(matches!(err, LoomError::Validation { .. }));
    }

    #[test]
    fn move_item_rejects_descendant_as_parent() {
        let conn = fresh_conn();
        let outer = create_item(&conn, None, "Folder", "Outer", None).unwrap();
        let inner = create_item(&conn, Some(&outer.id), "Folder", "Inner", None).unwrap();
        let err = move_item(&conn, &outer.id, Some(&inner.id), 0).unwrap_err();
        assert!(matches!(err, LoomError::Validation { .. }));
    }
}
