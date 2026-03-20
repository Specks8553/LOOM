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
    pub asset_path: Option<String>,
    pub asset_meta: Option<String>,
}

/// List all non-deleted vault items.
pub fn list_items(conn: &Connection) -> Result<Vec<VaultItemMeta>, LoomError> {
    let mut stmt = conn.prepare(
        "SELECT id, parent_id, item_type, item_subtype, name, description, sort_order,
                created_at, modified_at, deleted_at, asset_path, asset_meta
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
            asset_path: row.get(10)?,
            asset_meta: row.get(11)?,
        })
    })?.filter_map(|r| r.ok()).collect();

    Ok(items)
}

/// List all soft-deleted vault items (trash).
pub fn list_trash(conn: &Connection) -> Result<Vec<VaultItemMeta>, LoomError> {
    let mut stmt = conn.prepare(
        "SELECT id, parent_id, item_type, item_subtype, name, description, sort_order,
                created_at, modified_at, deleted_at, asset_path, asset_meta
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
            asset_path: row.get(10)?,
            asset_meta: row.get(11)?,
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
        asset_path: None,
        asset_meta: None,
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
/// If world_dir is provided, also deletes asset files for Image items.
pub fn purge_item(conn: &Connection, id: &str, world_dir: Option<&std::path::Path>) -> Result<(), LoomError> {
    // Collect asset paths to delete (children + self)
    if let Some(dir) = world_dir {
        let mut stmt = conn.prepare(
            "SELECT asset_path FROM items WHERE (id = ?1 OR parent_id = ?1) AND item_type = 'Image' AND asset_path IS NOT NULL"
        )?;
        let paths: Vec<String> = stmt.query_map(rusqlite::params![id], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        for path in paths {
            let full = dir.join(&path);
            if let Err(e) = std::fs::remove_file(&full) {
                log::warn!("Failed to delete asset file {:?}: {}", full, e);
            }
        }
    }

    // Delete children first
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

/// Full vault item including content (for doc editor).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultItem {
    pub id: String,
    pub parent_id: Option<String>,
    pub item_type: String,
    pub item_subtype: Option<String>,
    pub name: String,
    pub content: String,
    pub description: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
    pub modified_at: String,
    pub deleted_at: Option<String>,
    pub asset_path: Option<String>,
    pub asset_meta: Option<String>,
}

/// Get a single vault item including its content.
pub fn get_item(conn: &Connection, id: &str) -> Result<VaultItem, LoomError> {
    conn.query_row(
        "SELECT id, parent_id, item_type, item_subtype, name, content, description,
                sort_order, created_at, modified_at, deleted_at, asset_path, asset_meta
         FROM items WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            Ok(VaultItem {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                item_type: row.get(2)?,
                item_subtype: row.get(3)?,
                name: row.get(4)?,
                content: row.get(5)?,
                description: row.get(6)?,
                sort_order: row.get(7)?,
                created_at: row.get(8)?,
                modified_at: row.get(9)?,
                deleted_at: row.get(10)?,
                asset_path: row.get(11)?,
                asset_meta: row.get(12)?,
            })
        },
    )
    .map_err(|_| LoomError::ItemNotFound(id.to_string()))
}

/// Update the content of a vault item (for doc editor save).
pub fn update_item_content(conn: &Connection, id: &str, content: &str) -> Result<(), LoomError> {
    let now = chrono::Utc::now().to_rfc3339();
    let rows = conn.execute(
        "UPDATE items SET content = ?1, modified_at = ?2 WHERE id = ?3",
        rusqlite::params![content, now, id],
    )?;
    if rows == 0 {
        return Err(LoomError::ItemNotFound(id.to_string()));
    }
    Ok(())
}

/// Create a vault item with initial content (for template-based creation).
pub fn create_item_with_content(
    conn: &Connection,
    item_type: &str,
    name: &str,
    parent_id: Option<&str>,
    subtype: Option<&str>,
    content: &str,
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

    let sort_order: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM items
         WHERE parent_id IS ?1 AND deleted_at IS NULL",
        rusqlite::params![parent_id],
        |row| row.get(0),
    )?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let story_id: Option<&str> = if item_type == "Story" { Some(&id) } else { None };

    conn.execute(
        "INSERT INTO items (id, story_id, parent_id, item_type, item_subtype, name, content,
                           description, sort_order, created_at, modified_at, deleted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9, ?10, NULL)",
        rusqlite::params![id, story_id, parent_id, item_type, subtype, name, content, sort_order, now, now],
    )?;

    log::info!("Vault item created with content: id={}, type={}", id, item_type);

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
        asset_path: None,
        asset_meta: None,
    })
}

// ─── Image Upload ────────────────────────────────────────────────────────────

/// Upload an image to the vault. Validates format/size, copies to assets/, inserts DB row.
pub fn upload_image(
    conn: &Connection,
    world_dir: &std::path::Path,
    src_path: &str,
    name: &str,
    parent_id: Option<&str>,
) -> Result<VaultItemMeta, LoomError> {
    let src = std::path::Path::new(src_path);
    let bytes = std::fs::read(src)
        .map_err(|e| LoomError::Internal(format!("Failed to read image file: {}", e)))?;

    // Validate size ≤ 10 MB
    if bytes.len() > 10 * 1024 * 1024 {
        return Err(LoomError::Validation("Image exceeds 10 MB limit".to_string()));
    }

    // Detect format
    let format = image::guess_format(&bytes)
        .map_err(|_| LoomError::Validation("Unsupported image format".to_string()))?;

    let (mime, ext) = match format {
        image::ImageFormat::Png => ("image/png", "png"),
        image::ImageFormat::Jpeg => ("image/jpeg", "jpg"),
        image::ImageFormat::WebP => ("image/webp", "webp"),
        image::ImageFormat::Gif => ("image/gif", "gif"),
        _ => return Err(LoomError::Validation("Unsupported image format. Use PNG, JPEG, WebP, or GIF.".to_string())),
    };

    // Get dimensions
    let reader = image::ImageReader::new(std::io::Cursor::new(&bytes))
        .with_guessed_format()
        .map_err(|e| LoomError::Internal(format!("Failed to read image dimensions: {}", e)))?;
    let (width, height) = reader.into_dimensions()
        .map_err(|e| LoomError::Internal(format!("Failed to decode image dimensions: {}", e)))?;

    // Generate ID, create assets dir, copy file
    let id = uuid::Uuid::new_v4().to_string();
    let assets_dir = world_dir.join("assets");
    std::fs::create_dir_all(&assets_dir)
        .map_err(|e| LoomError::Internal(format!("Failed to create assets dir: {}", e)))?;

    let asset_filename = format!("{}.{}", id, ext);
    let asset_rel_path = format!("assets/{}", asset_filename);
    let dest = assets_dir.join(&asset_filename);
    std::fs::write(&dest, &bytes)
        .map_err(|e| LoomError::Internal(format!("Failed to write asset file: {}", e)))?;

    // Build asset_meta JSON
    let asset_meta = serde_json::json!({
        "mime": mime,
        "width": width,
        "height": height,
        "size_bytes": bytes.len(),
    }).to_string();

    // Determine sort_order
    let sort_order: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM items
         WHERE parent_id IS ?1 AND deleted_at IS NULL",
        rusqlite::params![parent_id],
        |row| row.get(0),
    )?;

    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO items (id, story_id, parent_id, item_type, item_subtype, name, content,
                           description, sort_order, created_at, modified_at, deleted_at,
                           asset_path, asset_meta)
         VALUES (?1, NULL, ?2, 'Image', NULL, ?3, '', NULL, ?4, ?5, ?6, NULL, ?7, ?8)",
        rusqlite::params![id, parent_id, name, sort_order, now, now, asset_rel_path, asset_meta],
    )?;

    log::info!("Image uploaded: id={}, path={}", id, asset_rel_path);

    Ok(VaultItemMeta {
        id,
        parent_id: parent_id.map(|s| s.to_string()),
        item_type: "Image".to_string(),
        item_subtype: None,
        name: name.to_string(),
        description: None,
        sort_order,
        created_at: now.clone(),
        modified_at: now,
        deleted_at: None,
        asset_path: Some(asset_rel_path),
        asset_meta: Some(asset_meta),
    })
}

// ─── Template CRUD ───────────────────────────────────────────────────────────

/// Template for Source Documents.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Template {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub icon: String,
    pub default_content: String,
    pub is_builtin: bool,
    pub created_at: String,
    pub modified_at: String,
}

/// List all templates.
pub fn list_templates(conn: &Connection) -> Result<Vec<Template>, LoomError> {
    let mut stmt = conn.prepare(
        "SELECT id, slug, name, icon, default_content, is_builtin, created_at, modified_at
         FROM templates ORDER BY sort_order ASC, name ASC"
    )?;

    let templates = stmt.query_map([], |row| {
        Ok(Template {
            id: row.get(0)?,
            slug: row.get(1)?,
            name: row.get(2)?,
            icon: row.get(3)?,
            default_content: row.get(4)?,
            is_builtin: row.get::<_, i32>(5)? != 0,
            created_at: row.get(6)?,
            modified_at: row.get(7)?,
        })
    })?.filter_map(|r| r.ok()).collect();

    Ok(templates)
}

/// Save (create or update) a template.
pub fn save_template(conn: &Connection, template: &Template) -> Result<Template, LoomError> {
    let now = chrono::Utc::now().to_rfc3339();

    // Check if exists
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM templates WHERE id = ?1)",
        rusqlite::params![template.id],
        |row| row.get(0),
    )?;

    if exists {
        // Built-in templates: only default_content is editable
        // Custom templates: all fields are editable
        let is_builtin: bool = conn.query_row(
            "SELECT is_builtin FROM templates WHERE id = ?1",
            rusqlite::params![template.id],
            |row| row.get::<_, i32>(0).map(|v| v != 0),
        )?;

        if is_builtin {
            conn.execute(
                "UPDATE templates SET default_content = ?1, modified_at = ?2 WHERE id = ?3",
                rusqlite::params![template.default_content, now, template.id],
            )?;
        } else {
            conn.execute(
                "UPDATE templates SET slug = ?1, name = ?2, icon = ?3, default_content = ?4, modified_at = ?5
                 WHERE id = ?6",
                rusqlite::params![template.slug, template.name, template.icon, template.default_content, now, template.id],
            )?;
        }
    } else {
        let sort_order: i64 = conn.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM templates",
            [],
            |row| row.get(0),
        )?;
        conn.execute(
            "INSERT INTO templates (id, slug, name, icon, default_content, is_builtin, sort_order, created_at, modified_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, ?8)",
            rusqlite::params![template.id, template.slug, template.name, template.icon, template.default_content, sort_order, now, now],
        )?;
    }

    Ok(Template {
        id: template.id.clone(),
        slug: template.slug.clone(),
        name: template.name.clone(),
        icon: template.icon.clone(),
        default_content: template.default_content.clone(),
        is_builtin: false,
        created_at: if exists { template.created_at.clone() } else { now.clone() },
        modified_at: now,
    })
}

/// Delete a template (only non-builtin).
pub fn delete_template(conn: &Connection, id: &str) -> Result<(), LoomError> {
    let rows = conn.execute(
        "DELETE FROM templates WHERE id = ?1 AND is_builtin = 0",
        rusqlite::params![id],
    )?;
    if rows == 0 {
        return Err(LoomError::ItemNotFound(id.to_string()));
    }
    Ok(())
}

// ─── Context Doc Attachment ──────────────────────────────────────────────────

/// Attach a source document to a story as a context doc.
/// Adds the doc_id to the story's `context_doc_ids` in story_settings
/// and writes an entry to attachment_history.
pub fn attach_context_doc(
    conn: &Connection,
    story_id: &str,
    doc_id: &str,
) -> Result<(), LoomError> {
    // Read current attached doc IDs
    let current: String = conn
        .query_row(
            "SELECT value FROM story_settings WHERE story_id = ?1 AND key = 'context_doc_ids'",
            rusqlite::params![story_id],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "[]".to_string());

    let mut ids: Vec<String> = serde_json::from_str(&current).unwrap_or_default();

    // Don't duplicate
    if ids.contains(&doc_id.to_string()) {
        return Ok(());
    }

    ids.push(doc_id.to_string());
    let new_value = serde_json::to_string(&ids)
        .map_err(|e| LoomError::Internal(format!("JSON serialize error: {}", e)))?;

    conn.execute(
        "INSERT OR REPLACE INTO story_settings (story_id, key, value) VALUES (?1, 'context_doc_ids', ?2)",
        rusqlite::params![story_id, new_value],
    )?;

    // Get doc name for attachment_history
    let doc_name: String = conn
        .query_row(
            "SELECT name FROM items WHERE id = ?1",
            rusqlite::params![doc_id],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "Unknown".to_string());

    let now = chrono::Utc::now().to_rfc3339();
    let history_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO attachment_history (id, story_id, doc_id, doc_name, attached_at, detached_at, doc_purged)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, 0)",
        rusqlite::params![history_id, story_id, doc_id, doc_name, now],
    )?;

    log::info!("Context doc attached: doc_id={}, story_id={}", doc_id, story_id);
    Ok(())
}

/// Detach a source document from a story.
/// Removes the doc_id from `context_doc_ids` and updates attachment_history.
pub fn detach_context_doc(
    conn: &Connection,
    story_id: &str,
    doc_id: &str,
) -> Result<(), LoomError> {
    // Read current attached doc IDs
    let current: String = conn
        .query_row(
            "SELECT value FROM story_settings WHERE story_id = ?1 AND key = 'context_doc_ids'",
            rusqlite::params![story_id],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "[]".to_string());

    let mut ids: Vec<String> = serde_json::from_str(&current).unwrap_or_default();
    ids.retain(|id| id != doc_id);

    let new_value = serde_json::to_string(&ids)
        .map_err(|e| LoomError::Internal(format!("JSON serialize error: {}", e)))?;

    conn.execute(
        "INSERT OR REPLACE INTO story_settings (story_id, key, value) VALUES (?1, 'context_doc_ids', ?2)",
        rusqlite::params![story_id, new_value],
    )?;

    // Update attachment_history: set detached_at on the most recent un-detached entry
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE attachment_history SET detached_at = ?1
         WHERE story_id = ?2 AND doc_id = ?3 AND detached_at IS NULL",
        rusqlite::params![now, story_id, doc_id],
    )?;

    log::info!("Context doc detached: doc_id={}, story_id={}", doc_id, story_id);
    Ok(())
}

/// Context doc info for the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextDoc {
    pub id: String,
    pub name: String,
    pub item_type: String,
    pub item_subtype: Option<String>,
    pub content: String,
    pub asset_path: Option<String>,
}

/// Get all attached context docs for a story (full content included).
pub fn get_context_docs(
    conn: &Connection,
    story_id: &str,
) -> Result<Vec<ContextDoc>, LoomError> {
    let raw: String = conn
        .query_row(
            "SELECT value FROM story_settings WHERE story_id = ?1 AND key = 'context_doc_ids'",
            rusqlite::params![story_id],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "[]".to_string());

    let ids: Vec<String> = serde_json::from_str(&raw).unwrap_or_default();
    let mut docs = Vec::new();

    for doc_id in &ids {
        if let Ok(item) = get_item(conn, doc_id) {
            if item.deleted_at.is_none() {
                docs.push(ContextDoc {
                    id: item.id,
                    name: item.name,
                    item_type: item.item_type,
                    item_subtype: item.item_subtype,
                    content: item.content,
                    asset_path: item.asset_path,
                });
            }
        }
    }

    Ok(docs)
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
        purge_item(&conn, &item.id, None).unwrap();
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
