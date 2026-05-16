//! Typed CRUD against the world `templates` table (Doc 03 §`templates`,
//! Doc 20 §Templates).
//!
//! Per Doc 05 §Dependency Rules, `db/` may import `rusqlite` only. Event
//! emission lives in `commands/settings.rs`.
//!
//! Three built-in templates (`image`, `character_profile`, `world_building`)
//! are seeded into every world. They are renameable and their
//! `default_content` is editable, but they cannot be deleted. `ensure_builtins`
//! is idempotent (`INSERT OR IGNORE` by `slug`) so it is safe to call on every
//! world open — pre-existing worlds gain the built-ins lazily.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::LoomError;

/// Doc 03 §`templates`. A source-document template — built-in or user-created.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/lib/types.ts")]
pub struct Template {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub icon: String,
    pub default_content: String,
    /// Forward-compat for the v2.1 Source Document Creator — not surfaced in
    /// v2.0's Settings UI (Doc 20 §Templates).
    pub creator_instructions: String,
    pub is_builtin: bool,
    pub sort_order: i64,
    pub created_at: String,
    pub modified_at: String,
}

/// A built-in template's immutable baseline. `restore_template_default`
/// writes `name` / `icon` / `default_content` back from here.
struct Builtin {
    slug: &'static str,
    name: &'static str,
    icon: &'static str,
    default_content: &'static str,
}

/// The three built-ins seeded into every world (Doc 20 §Templates). Copy is
/// provisional — final wording is a Phase 12 concern (NB-2).
const BUILTINS: &[Builtin] = &[
    Builtin {
        slug: "character_profile",
        name: "Character Profile",
        icon: "User",
        default_content: "# Name\n\n## Role\n\n## Appearance\n\n## Personality\n\n## Background\n\n## Relationships\n\n## Notes\n",
    },
    Builtin {
        slug: "world_building",
        name: "World Building",
        icon: "Globe",
        default_content: "# Title\n\n## Overview\n\n## Geography\n\n## History\n\n## Culture & Society\n\n## Rules & Systems\n\n## Notes\n",
    },
    Builtin {
        slug: "image",
        name: "Image",
        icon: "Image",
        default_content: "# Caption\n\n## Description\n\n## Notes\n",
    },
];

const COLUMNS: &str = "id, slug, name, icon, default_content, creator_instructions, \
                       is_builtin, sort_order, created_at, modified_at";

fn row_to_template(row: &Row<'_>) -> rusqlite::Result<Template> {
    Ok(Template {
        id: row.get("id")?,
        slug: row.get("slug")?,
        name: row.get("name")?,
        icon: row.get("icon")?,
        default_content: row.get("default_content")?,
        creator_instructions: row.get("creator_instructions")?,
        is_builtin: row.get::<_, i64>("is_builtin")? != 0,
        sort_order: row.get("sort_order")?,
        created_at: row.get("created_at")?,
        modified_at: row.get("modified_at")?,
    })
}

/// List every template. Built-ins sort first (by `sort_order`), then
/// user-created (by `sort_order`, then `name`).
pub fn list(conn: &Connection) -> Result<Vec<Template>, LoomError> {
    let sql = format!(
        "SELECT {COLUMNS} FROM templates \
         ORDER BY is_builtin DESC, sort_order ASC, name ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_template)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Read a single template by id.
pub fn get(conn: &Connection, id: &str) -> Result<Option<Template>, LoomError> {
    let sql = format!("SELECT {COLUMNS} FROM templates WHERE id = ?1");
    let t = conn
        .query_row(&sql, params![id], row_to_template)
        .optional()?;
    Ok(t)
}

/// Full-row UPSERT on `id`.
pub fn upsert(conn: &Connection, t: &Template) -> Result<(), LoomError> {
    conn.execute(
        "INSERT INTO templates
             (id, slug, name, icon, default_content, creator_instructions,
              is_builtin, sort_order, created_at, modified_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(id) DO UPDATE SET
             slug = excluded.slug,
             name = excluded.name,
             icon = excluded.icon,
             default_content = excluded.default_content,
             creator_instructions = excluded.creator_instructions,
             sort_order = excluded.sort_order,
             modified_at = excluded.modified_at",
        params![
            t.id,
            t.slug,
            t.name,
            t.icon,
            t.default_content,
            t.creator_instructions,
            i64::from(t.is_builtin),
            t.sort_order,
            t.created_at,
            t.modified_at,
        ],
    )?;
    Ok(())
}

/// Delete a template by id. The caller (command layer) rejects deletion of
/// built-ins with `LoomError::Forbidden` before reaching here.
pub fn delete(conn: &Connection, id: &str) -> Result<(), LoomError> {
    conn.execute("DELETE FROM templates WHERE id = ?1", params![id])?;
    Ok(())
}

/// Seed the three built-in templates. Idempotent — `INSERT OR IGNORE` by the
/// unique `slug`, so a world that already has them is left untouched.
pub fn ensure_builtins(conn: &Connection, now: &str) -> Result<(), LoomError> {
    for (i, b) in BUILTINS.iter().enumerate() {
        conn.execute(
            "INSERT OR IGNORE INTO templates
                 (id, slug, name, icon, default_content, creator_instructions,
                  is_builtin, sort_order, created_at, modified_at)
             VALUES (?1, ?2, ?3, ?4, ?5, '', 1, ?6, ?7, ?7)",
            params![
                format!("builtin-{}", b.slug),
                b.slug,
                b.name,
                b.icon,
                b.default_content,
                i as i64,
                now,
            ],
        )?;
    }
    Ok(())
}

/// Restore a built-in's `name` / `icon` / `default_content` to its baseline
/// (Doc 20 §Templates — `[Restore Default]`). Returns `false` when `id` is not
/// a known built-in.
pub fn restore_builtin(conn: &Connection, id: &str, now: &str) -> Result<bool, LoomError> {
    let Some(b) = BUILTINS
        .iter()
        .find(|b| format!("builtin-{}", b.slug) == id)
    else {
        return Ok(false);
    };
    conn.execute(
        "UPDATE templates
            SET name = ?2, icon = ?3, default_content = ?4, modified_at = ?5
          WHERE id = ?1",
        params![id, b.name, b.icon, b.default_content, now],
    )?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::{apply_pending, MigrationRoot};

    fn fresh_world() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        apply_pending(&mut c, MigrationRoot::World).unwrap();
        c
    }

    #[test]
    fn ensure_builtins_seeds_three_and_is_idempotent() {
        let c = fresh_world();
        ensure_builtins(&c, "2026-05-16T00:00:00Z").unwrap();
        ensure_builtins(&c, "2026-05-16T00:00:00Z").unwrap();
        let all = list(&c).unwrap();
        assert_eq!(all.len(), 3);
        assert!(all.iter().all(|t| t.is_builtin));
    }

    #[test]
    fn user_template_crud() {
        let c = fresh_world();
        let t = Template {
            id: "t1".into(),
            slug: "user-notes".into(),
            name: "Notes".into(),
            icon: "FileText".into(),
            default_content: "body".into(),
            creator_instructions: String::new(),
            is_builtin: false,
            sort_order: 0,
            created_at: "2026-05-16T00:00:00Z".into(),
            modified_at: "2026-05-16T00:00:00Z".into(),
        };
        upsert(&c, &t).unwrap();
        assert_eq!(get(&c, "t1").unwrap().unwrap().name, "Notes");

        let mut updated = t.clone();
        updated.name = "Renamed".into();
        upsert(&c, &updated).unwrap();
        assert_eq!(get(&c, "t1").unwrap().unwrap().name, "Renamed");

        delete(&c, "t1").unwrap();
        assert!(get(&c, "t1").unwrap().is_none());
    }

    #[test]
    fn restore_builtin_resets_edited_fields() {
        let c = fresh_world();
        ensure_builtins(&c, "2026-05-16T00:00:00Z").unwrap();
        let id = "builtin-character_profile";
        let mut edited = get(&c, id).unwrap().unwrap();
        edited.name = "Hacked".into();
        edited.default_content = "wiped".into();
        upsert(&c, &edited).unwrap();
        assert_eq!(get(&c, id).unwrap().unwrap().name, "Hacked");

        assert!(restore_builtin(&c, id, "2026-05-16T01:00:00Z").unwrap());
        let restored = get(&c, id).unwrap().unwrap();
        assert_eq!(restored.name, "Character Profile");
        assert!(restored.default_content.starts_with("# Name"));

        assert!(!restore_builtin(&c, "builtin-nope", "2026-05-16T01:00:00Z").unwrap());
    }

    #[test]
    fn list_orders_builtins_before_user() {
        let c = fresh_world();
        ensure_builtins(&c, "2026-05-16T00:00:00Z").unwrap();
        upsert(
            &c,
            &Template {
                id: "u1".into(),
                slug: "u1".into(),
                name: "AAA user".into(),
                icon: "FileText".into(),
                default_content: String::new(),
                creator_instructions: String::new(),
                is_builtin: false,
                sort_order: 0,
                created_at: "2026-05-16T00:00:00Z".into(),
                modified_at: "2026-05-16T00:00:00Z".into(),
            },
        )
        .unwrap();
        let all = list(&c).unwrap();
        assert_eq!(all.len(), 4);
        assert!(all[0].is_builtin);
        assert!(all[1].is_builtin);
        assert!(all[2].is_builtin);
        assert!(!all[3].is_builtin);
    }
}
