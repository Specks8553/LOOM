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

use crate::db::{
    attachment_history, settings as db_settings,
    vault::{self, VaultItemMeta},
};
use crate::error::LoomError;
use crate::services::accordion;
use crate::services::cache;
use crate::services::settings_keys::StoryStateKey;

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

    // Doc 16 §Story creation: every new Story gets a start-sentinel checkpoint
    // so the accordion algorithm always finds a "previous checkpoint" when the
    // user inserts the first chapter.
    if item.item_type == "Story" {
        accordion::create_start_sentinel(conn, &item.id)?;
    }

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
    vault::soft_delete_item(conn, id, &now_iso())?;
    // Doc 18 §Cascade Rules — soft-deleting a SourceDocument / Image must
    // detach it from every story that currently attaches it.
    if is_content_editable(&item.item_type) {
        cascade_detach_on_soft_delete(conn, id)?;
    }
    Ok(())
}

// --- Source-document content (Phase 5) ---------------------------------------

/// True iff this item type can hold editable source-doc content (Doc 18).
fn is_content_editable(item_type: &str) -> bool {
    matches!(item_type, "SourceDocument" | "Image")
}

/// Read an item's `content`. Returns the empty string for items without
/// content (the schema default). Errors `NotFound` if the item id does not
/// resolve, and `Validation` if the item is not a SourceDocument or Image.
pub fn get_item_content(conn: &Connection, id: &str) -> Result<String, LoomError> {
    let item = vault::get_item(conn, id)?
        .ok_or_else(|| LoomError::NotFound(format!("item {id} not found")))?;
    if !is_content_editable(&item.item_type) {
        return Err(LoomError::validation(
            "Only Source Documents and Images can be opened in the editor.",
        ));
    }
    let content = vault::get_item_content(conn, id)?
        .ok_or_else(|| LoomError::NotFound(format!("item {id} not found")))?;
    Ok(content)
}

/// Write an item's `content` and bump `modified_at`. Validates type and
/// soft-delete state. Marks the story cache stale for every story that has
/// this doc attached (Doc 18 §Cascade Rules — content edit).
pub fn update_item_content(conn: &Connection, id: &str, content: &str) -> Result<(), LoomError> {
    let item = vault::get_item(conn, id)?
        .ok_or_else(|| LoomError::NotFound(format!("item {id} not found")))?;
    if !is_content_editable(&item.item_type) {
        return Err(LoomError::validation(
            "Only Source Documents and Images can be edited.",
        ));
    }
    if item.deleted_at.is_some() {
        return Err(LoomError::validation(
            "Cannot edit a deleted document; restore it first.",
        ));
    }
    let now = now_iso();
    vault::update_item_content(conn, id, content, &now)?;

    // Mark cache stale for every story this doc is attached to (Phase 6
    // makes this actually mutate `cache_state`).
    for story_id in stories_with_attached_doc(conn, id)? {
        cache::mark_story_stale(conn, &story_id)?;
    }
    Ok(())
}

// --- Attachment (Phase 5) ----------------------------------------------------

/// Read `story_state.context_doc_ids` as a `Vec<String>`. Empty when the row
/// is missing or holds the default `[]`.
pub fn get_context_doc_ids(conn: &Connection, story_id: &str) -> Result<Vec<String>, LoomError> {
    let raw: String = db_settings::get_story_state(conn, story_id, StoryStateKey::ContextDocIds)?;
    if raw.is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(&raw)
        .map_err(|e| LoomError::Serialization(format!("context_doc_ids JSON parse failed: {e}")))
}

/// Write `story_state.context_doc_ids` as a JSON array.
fn set_context_doc_ids(conn: &Connection, story_id: &str, ids: &[String]) -> Result<(), LoomError> {
    let json = serde_json::to_string(ids).map_err(LoomError::from)?;
    db_settings::set_story_state(conn, story_id, StoryStateKey::ContextDocIds, &json)
}

/// Validate that `story_id` resolves to a live Story.
fn require_live_story(conn: &Connection, story_id: &str) -> Result<(), LoomError> {
    let story = vault::get_item(conn, story_id)?
        .ok_or_else(|| LoomError::NotFound(format!("story {story_id} not found")))?;
    if story.item_type != "Story" {
        return Err(LoomError::validation("Attachments require a Story item."));
    }
    if story.deleted_at.is_some() {
        return Err(LoomError::validation("Cannot attach to a deleted story."));
    }
    Ok(())
}

/// Validate that `doc_id` resolves to a live SourceDocument or Image.
fn require_live_doc(conn: &Connection, doc_id: &str) -> Result<(), LoomError> {
    let doc = vault::get_item(conn, doc_id)?
        .ok_or_else(|| LoomError::NotFound(format!("doc {doc_id} not found")))?;
    if !is_content_editable(&doc.item_type) {
        return Err(LoomError::validation(
            "Only Source Documents and Images can be attached.",
        ));
    }
    if doc.deleted_at.is_some() {
        return Err(LoomError::validation(
            "Cannot attach a deleted document; restore it first.",
        ));
    }
    Ok(())
}

/// Append `doc_id` to `story_state.context_doc_ids`. Returns the new ordered
/// list (Doc 18 §`attach_context_doc`).
pub fn attach_context_doc(
    conn: &Connection,
    story_id: &str,
    doc_id: &str,
) -> Result<Vec<String>, LoomError> {
    require_live_story(conn, story_id)?;
    require_live_doc(conn, doc_id)?;

    let mut ids = get_context_doc_ids(conn, story_id)?;
    if ids.iter().any(|id| id == doc_id) {
        return Err(LoomError::validation(
            "This document is already attached to the story.",
        ));
    }
    ids.push(doc_id.to_owned());
    set_context_doc_ids(conn, story_id, &ids)?;
    attachment_history::insert_attach(conn, story_id, doc_id, &now_iso())?;
    cache::mark_story_stale(conn, story_id)?;
    Ok(ids)
}

/// Remove `doc_id` from `story_state.context_doc_ids`. `reason = Some("soft_delete")`
/// for cascade detaches; `None` for user-initiated detaches.
pub fn detach_context_doc(
    conn: &Connection,
    story_id: &str,
    doc_id: &str,
    reason: Option<&str>,
) -> Result<Vec<String>, LoomError> {
    let mut ids = get_context_doc_ids(conn, story_id)?;
    let pos = ids
        .iter()
        .position(|id| id == doc_id)
        .ok_or_else(|| LoomError::validation("Document is not attached to this story."))?;
    ids.remove(pos);
    set_context_doc_ids(conn, story_id, &ids)?;
    attachment_history::insert_detach(conn, story_id, doc_id, reason, &now_iso())?;
    cache::mark_story_stale(conn, story_id)?;
    Ok(ids)
}

/// Public re-export for cache stale-trigger paths in `commands/vault.rs`.
pub fn stories_with_attached_doc_pub(
    conn: &Connection,
    doc_id: &str,
) -> Result<Vec<String>, LoomError> {
    stories_with_attached_doc(conn, doc_id)
}

/// Return every `story_id` whose `story_state.context_doc_ids` contains `doc_id`.
/// JSON lookup uses a simple `LIKE` heuristic over the encoded list — fine
/// because IDs are UUIDs (no false positives possible).
fn stories_with_attached_doc(conn: &Connection, doc_id: &str) -> Result<Vec<String>, LoomError> {
    let pattern = format!("%\"{doc_id}\"%");
    let mut stmt = conn
        .prepare(
            "SELECT story_id FROM story_state
             WHERE key = ?1 AND value LIKE ?2",
        )
        .map_err(|e| LoomError::Database(e.to_string()))?;
    let rows = stmt
        .query_map(
            rusqlite::params![StoryStateKey::ContextDocIds.as_str(), pattern],
            |r| r.get::<_, String>(0),
        )
        .map_err(|e| LoomError::Database(e.to_string()))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| LoomError::Database(e.to_string()))?);
    }
    // Defensive: verify the doc is really in each list (LIKE is loose).
    let mut filtered = Vec::with_capacity(out.len());
    for story_id in out {
        let ids = get_context_doc_ids(conn, &story_id)?;
        if ids.iter().any(|id| id == doc_id) {
            filtered.push(story_id);
        }
    }
    Ok(filtered)
}

/// Cascade-detach: when a SourceDocument / Image is soft-deleted, remove it
/// from every story's `context_doc_ids` and log each detach with
/// `reason='soft_delete'` (Doc 18 §Cascade Rules).
pub fn cascade_detach_on_soft_delete(conn: &Connection, doc_id: &str) -> Result<(), LoomError> {
    let stories = stories_with_attached_doc(conn, doc_id)?;
    for story_id in stories {
        detach_context_doc(conn, &story_id, doc_id, Some("soft_delete"))?;
    }
    Ok(())
}

/// Return the live `VaultItemMeta` rows for every doc currently attached to
/// `story_id`, in insertion order. Skips ids that no longer resolve to a
/// live row (defensive against legacy state — Doc 18 §`list_attached_docs`).
pub fn list_attached_docs(
    conn: &Connection,
    story_id: &str,
) -> Result<Vec<VaultItemMeta>, LoomError> {
    let ids = get_context_doc_ids(conn, story_id)?;
    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        if let Some(item) = vault::get_item(conn, &id)? {
            if item.deleted_at.is_none() {
                out.push(item);
            }
        }
    }
    Ok(out)
}

// --- Existing logic continues ------------------------------------------------

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

    // --- Phase 5: source-doc content + attach/detach + cascade ---

    #[test]
    fn get_item_content_rejects_non_source_document() {
        let conn = fresh_conn();
        let story = create_item(&conn, None, "Story", "Tale", None).unwrap();
        let err = get_item_content(&conn, &story.id).unwrap_err();
        assert!(matches!(err, LoomError::Validation { .. }));
    }

    #[test]
    fn update_then_get_content_round_trips() {
        let conn = fresh_conn();
        let doc = create_item(&conn, None, "SourceDocument", "Doc", None).unwrap();
        assert_eq!(get_item_content(&conn, &doc.id).unwrap(), "");
        update_item_content(&conn, &doc.id, "Body text").unwrap();
        assert_eq!(get_item_content(&conn, &doc.id).unwrap(), "Body text");
    }

    #[test]
    fn update_content_rejects_deleted_doc() {
        let conn = fresh_conn();
        let doc = create_item(&conn, None, "SourceDocument", "Doc", None).unwrap();
        soft_delete_item(&conn, &doc.id).unwrap();
        let err = update_item_content(&conn, &doc.id, "x").unwrap_err();
        assert!(matches!(err, LoomError::Validation { .. }));
    }

    #[test]
    fn attach_appends_then_detach_removes() {
        let conn = fresh_conn();
        let story = create_item(&conn, None, "Story", "S", None).unwrap();
        let d1 = create_item(&conn, None, "SourceDocument", "D1", None).unwrap();
        let d2 = create_item(&conn, None, "SourceDocument", "D2", None).unwrap();

        let after_a1 = attach_context_doc(&conn, &story.id, &d1.id).unwrap();
        assert_eq!(after_a1, vec![d1.id.clone()]);
        let after_a2 = attach_context_doc(&conn, &story.id, &d2.id).unwrap();
        assert_eq!(after_a2, vec![d1.id.clone(), d2.id.clone()]);

        let after_d = detach_context_doc(&conn, &story.id, &d1.id, None).unwrap();
        assert_eq!(after_d, vec![d2.id.clone()]);
    }

    #[test]
    fn double_attach_rejected() {
        let conn = fresh_conn();
        let story = create_item(&conn, None, "Story", "S", None).unwrap();
        let doc = create_item(&conn, None, "SourceDocument", "D", None).unwrap();
        attach_context_doc(&conn, &story.id, &doc.id).unwrap();
        let err = attach_context_doc(&conn, &story.id, &doc.id).unwrap_err();
        assert!(matches!(err, LoomError::Validation { .. }));
    }

    #[test]
    fn attach_rejects_soft_deleted_doc() {
        let conn = fresh_conn();
        let story = create_item(&conn, None, "Story", "S", None).unwrap();
        let doc = create_item(&conn, None, "SourceDocument", "D", None).unwrap();
        soft_delete_item(&conn, &doc.id).unwrap();
        let err = attach_context_doc(&conn, &story.id, &doc.id).unwrap_err();
        assert!(matches!(err, LoomError::Validation { .. }));
    }

    #[test]
    fn attach_rejects_non_story_target() {
        let conn = fresh_conn();
        let folder = create_item(&conn, None, "Folder", "F", None).unwrap();
        let doc = create_item(&conn, None, "SourceDocument", "D", None).unwrap();
        let err = attach_context_doc(&conn, &folder.id, &doc.id).unwrap_err();
        assert!(matches!(err, LoomError::Validation { .. }));
    }

    #[test]
    fn detach_unattached_doc_rejected() {
        let conn = fresh_conn();
        let story = create_item(&conn, None, "Story", "S", None).unwrap();
        let doc = create_item(&conn, None, "SourceDocument", "D", None).unwrap();
        let err = detach_context_doc(&conn, &story.id, &doc.id, None).unwrap_err();
        assert!(matches!(err, LoomError::Validation { .. }));
    }

    #[test]
    fn soft_delete_cascades_detach_with_reason() {
        let conn = fresh_conn();
        let s1 = create_item(&conn, None, "Story", "S1", None).unwrap();
        let s2 = create_item(&conn, None, "Story", "S2", None).unwrap();
        let doc = create_item(&conn, None, "SourceDocument", "D", None).unwrap();

        attach_context_doc(&conn, &s1.id, &doc.id).unwrap();
        attach_context_doc(&conn, &s2.id, &doc.id).unwrap();

        soft_delete_item(&conn, &doc.id).unwrap();

        assert!(get_context_doc_ids(&conn, &s1.id).unwrap().is_empty());
        assert!(get_context_doc_ids(&conn, &s2.id).unwrap().is_empty());

        // attachment_history should contain detach rows with reason='soft_delete'
        // for both stories.
        let mut stmt = conn
            .prepare(
                "SELECT story_id, event, reason FROM attachment_history
                 WHERE doc_id = ?1 AND event = 'detach'
                 ORDER BY created_at, id",
            )
            .unwrap();
        let rows: Vec<(String, String, Option<String>)> = stmt
            .query_map([&doc.id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                ))
            })
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(rows.len(), 2);
        for (_, event, reason) in &rows {
            assert_eq!(event, "detach");
            assert_eq!(reason.as_deref(), Some("soft_delete"));
        }
    }

    #[test]
    fn list_attached_docs_returns_in_insertion_order_and_skips_dead() {
        let conn = fresh_conn();
        let story = create_item(&conn, None, "Story", "S", None).unwrap();
        let d1 = create_item(&conn, None, "SourceDocument", "D1", None).unwrap();
        let d2 = create_item(&conn, None, "SourceDocument", "D2", None).unwrap();
        attach_context_doc(&conn, &story.id, &d1.id).unwrap();
        attach_context_doc(&conn, &story.id, &d2.id).unwrap();

        let attached = list_attached_docs(&conn, &story.id).unwrap();
        assert_eq!(attached.len(), 2);
        assert_eq!(attached[0].id, d1.id);
        assert_eq!(attached[1].id, d2.id);
    }
}
