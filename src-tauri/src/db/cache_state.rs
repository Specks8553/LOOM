//! Typed CRUD against the `cache_state` table (Doc 03 §`cache_state`, Doc 22).
//!
//! Per Doc 05 §Dependency Rules, `db/` may import `rusqlite` only — event
//! emission and Gemini API calls live in `commands/cache.rs` and
//! `services/cache.rs` respectively.
//!
//! One row per story. Created on first cache-create; persists across delete
//! (the row is wiped via `clear_active`, which NULLs the cache fields and
//! resets `is_stale`, but the row stays so the high-water-mark history is
//! recoverable for v2.1 undo if needed).

use std::collections::BTreeMap;

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::LoomError;

/// IPC payload per Doc 03 §TypeScript Interfaces §Context Caching.
/// Returned by `get_cache_state` and embedded in `cache_state_changed` events.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/lib/types.generated.ts")]
pub struct CacheStatus {
    pub cache_name: Option<String>,
    pub expiry_at: Option<String>,
    pub is_stale: bool,
    pub last_cached_message_id: Option<String>,
    #[ts(type = "number | null")]
    pub total_token_count: Option<i64>,
    /// `doc_id -> SHA-256 hex` map. Empty when no cache is active.
    pub doc_snapshots: BTreeMap<String, String>,
}

impl CacheStatus {
    /// Empty status used when no `cache_state` row exists yet.
    pub fn empty() -> Self {
        Self {
            cache_name: None,
            expiry_at: None,
            is_stale: false,
            last_cached_message_id: None,
            total_token_count: None,
            doc_snapshots: BTreeMap::new(),
        }
    }

    pub fn is_active(&self) -> bool {
        self.cache_name.is_some()
    }
}

/// Session cache status (Doc 03 §TypeScript Interfaces §Context Caching).
/// Populated only for consulting sessions; handover always has all fields
/// NULL/false (table CHECK enforces).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/lib/types.generated.ts")]
pub struct SessionCacheStatus {
    pub cache_name: Option<String>,
    pub expiry_at: Option<String>,
    pub is_stale: bool,
}

const COLUMNS: &str = "cache_name, expiry_at, is_stale, last_cached_message_id, \
                       total_token_count, doc_snapshots";

fn row_to_status(row: &Row<'_>) -> rusqlite::Result<CacheStatus> {
    let snapshots_json: String = row.get("doc_snapshots")?;
    let doc_snapshots: BTreeMap<String, String> =
        serde_json::from_str(&snapshots_json).unwrap_or_default();
    Ok(CacheStatus {
        cache_name: row.get("cache_name")?,
        expiry_at: row.get("expiry_at")?,
        is_stale: row.get::<_, i64>("is_stale")? != 0,
        last_cached_message_id: row.get("last_cached_message_id")?,
        total_token_count: row.get("total_token_count")?,
        doc_snapshots,
    })
}

/// Fetch the `cache_state` row for a story, or `CacheStatus::empty()` if none.
pub fn get(conn: &Connection, story_id: &str) -> Result<CacheStatus, LoomError> {
    let sql = format!("SELECT {COLUMNS} FROM cache_state WHERE story_id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let result = stmt
        .query_row(params![story_id], row_to_status)
        .optional()?;
    Ok(result.unwrap_or_else(CacheStatus::empty))
}

/// Insert-or-update an active cache record for a story.
#[allow(clippy::too_many_arguments)]
pub fn upsert_active(
    conn: &Connection,
    story_id: &str,
    cache_name: &str,
    expiry_at: &str,
    last_cached_message_id: Option<&str>,
    total_token_count: i64,
    doc_snapshots: &BTreeMap<String, String>,
    now_iso: &str,
) -> Result<(), LoomError> {
    let snapshots_json = serde_json::to_string(doc_snapshots)?;
    conn.execute(
        "INSERT INTO cache_state
            (story_id, cache_name, expiry_at, is_stale, last_cached_message_id,
             total_token_count, doc_snapshots, created_at, updated_at)
         VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6, ?7, ?7)
         ON CONFLICT(story_id) DO UPDATE SET
            cache_name = excluded.cache_name,
            expiry_at = excluded.expiry_at,
            is_stale = 0,
            last_cached_message_id = excluded.last_cached_message_id,
            total_token_count = excluded.total_token_count,
            doc_snapshots = excluded.doc_snapshots,
            updated_at = excluded.updated_at",
        params![
            story_id,
            cache_name,
            expiry_at,
            last_cached_message_id,
            total_token_count,
            snapshots_json,
            now_iso,
        ],
    )?;
    Ok(())
}

/// Refresh just the TTL on an existing row (no other field changes).
/// Returns `false` if no row exists for the story.
pub fn refresh_expiry(
    conn: &Connection,
    story_id: &str,
    expiry_at: &str,
    now_iso: &str,
) -> Result<bool, LoomError> {
    let n = conn.execute(
        "UPDATE cache_state SET expiry_at = ?1, updated_at = ?2 WHERE story_id = ?3",
        params![expiry_at, now_iso, story_id],
    )?;
    Ok(n > 0)
}

/// Mark the story-level cache stale. Returns `false` if no row exists.
pub fn mark_stale(conn: &Connection, story_id: &str, now_iso: &str) -> Result<bool, LoomError> {
    let n = conn.execute(
        "UPDATE cache_state SET is_stale = 1, updated_at = ?1
         WHERE story_id = ?2 AND cache_name IS NOT NULL",
        params![now_iso, story_id],
    )?;
    Ok(n > 0)
}

/// Clear the active cache pointer (NULL `cache_name`, `expiry_at`,
/// `last_cached_message_id`, `total_token_count`; reset `is_stale`,
/// `doc_snapshots`). Row stays so future creates are upserts.
pub fn clear_active(conn: &Connection, story_id: &str, now_iso: &str) -> Result<(), LoomError> {
    conn.execute(
        "UPDATE cache_state SET
            cache_name = NULL,
            expiry_at = NULL,
            is_stale = 0,
            last_cached_message_id = NULL,
            total_token_count = NULL,
            doc_snapshots = '{}',
            updated_at = ?1
         WHERE story_id = ?2",
        params![now_iso, story_id],
    )?;
    Ok(())
}

/// Iterate every story_id with a row in `cache_state` (active or not). Used
/// by Phase 11 settings writes that mark every world-story stale.
pub fn list_story_ids(conn: &Connection) -> Result<Vec<String>, LoomError> {
    let mut stmt = conn.prepare("SELECT story_id FROM cache_state")?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Row used by `list_alive_caches` for the right-pane Cache section.
/// Shared shape with `services/cache.rs::AliveCacheRow` (the IPC type).
#[derive(Debug, Clone)]
pub struct AliveStoryRow {
    pub story_id: String,
    pub story_name: String,
    pub total_tokens: i64,
    pub expiry_at: String,
    pub is_stale: bool,
}

/// All story caches with `cache_name IS NOT NULL` joined to `items.name`.
pub fn list_alive_story_rows(conn: &Connection) -> Result<Vec<AliveStoryRow>, LoomError> {
    let mut stmt = conn.prepare(
        "SELECT cs.story_id, i.name, cs.total_token_count, cs.expiry_at, cs.is_stale
         FROM cache_state cs
         JOIN items i ON i.id = cs.story_id
         WHERE cs.cache_name IS NOT NULL
         ORDER BY cs.expiry_at",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(AliveStoryRow {
            story_id: r.get(0)?,
            story_name: r.get(1)?,
            total_tokens: r.get::<_, Option<i64>>(2)?.unwrap_or(0),
            expiry_at: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
            is_stale: r.get::<_, i64>(4)? != 0,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::{apply_pending, MigrationRoot};

    fn fresh_world() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        apply_pending(&mut c, MigrationRoot::World).unwrap();
        c.execute(
            "INSERT INTO items (id, item_type, name, sort_order, created_at, modified_at)
             VALUES ('story1', 'Story', 'Test', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        c
    }

    #[test]
    fn get_returns_empty_when_no_row() {
        let c = fresh_world();
        let s = get(&c, "story1").unwrap();
        assert!(!s.is_active());
        assert!(!s.is_stale);
        assert!(s.doc_snapshots.is_empty());
    }

    #[test]
    fn upsert_then_get_roundtrips() {
        let c = fresh_world();
        let mut snaps = BTreeMap::new();
        snaps.insert("docA".into(), "abc".into());
        upsert_active(
            &c,
            "story1",
            "cachedContents/xyz",
            "2026-05-14T13:00:00Z",
            None,
            10_000,
            &snaps,
            "2026-05-14T12:00:00Z",
        )
        .unwrap();
        let s = get(&c, "story1").unwrap();
        assert_eq!(s.cache_name.as_deref(), Some("cachedContents/xyz"));
        assert_eq!(s.expiry_at.as_deref(), Some("2026-05-14T13:00:00Z"));
        assert!(!s.is_stale);
        assert!(s.last_cached_message_id.is_none());
        assert_eq!(s.total_token_count, Some(10_000));
        assert_eq!(s.doc_snapshots.get("docA").map(String::as_str), Some("abc"));
    }

    #[test]
    fn upsert_clears_stale_on_overwrite() {
        let c = fresh_world();
        upsert_active(
            &c,
            "story1",
            "cachedContents/old",
            "2026-05-14T13:00:00Z",
            None,
            1,
            &BTreeMap::new(),
            "2026-05-14T12:00:00Z",
        )
        .unwrap();
        mark_stale(&c, "story1", "2026-05-14T12:30:00Z").unwrap();
        assert!(get(&c, "story1").unwrap().is_stale);

        upsert_active(
            &c,
            "story1",
            "cachedContents/new",
            "2026-05-14T14:00:00Z",
            None,
            2,
            &BTreeMap::new(),
            "2026-05-14T12:45:00Z",
        )
        .unwrap();
        let s = get(&c, "story1").unwrap();
        assert!(!s.is_stale);
        assert_eq!(s.cache_name.as_deref(), Some("cachedContents/new"));
    }

    #[test]
    fn mark_stale_no_op_when_no_active_cache() {
        let c = fresh_world();
        // No row at all.
        let touched = mark_stale(&c, "story1", "2026-05-14T12:30:00Z").unwrap();
        assert!(!touched);
        // Row exists but cache_name is NULL.
        upsert_active(
            &c,
            "story1",
            "cachedContents/x",
            "2026-05-14T13:00:00Z",
            None,
            1,
            &BTreeMap::new(),
            "2026-05-14T12:00:00Z",
        )
        .unwrap();
        clear_active(&c, "story1", "2026-05-14T12:15:00Z").unwrap();
        let touched = mark_stale(&c, "story1", "2026-05-14T12:30:00Z").unwrap();
        assert!(!touched);
        assert!(!get(&c, "story1").unwrap().is_stale);
    }

    #[test]
    fn clear_active_keeps_row_but_nulls_fields() {
        let c = fresh_world();
        upsert_active(
            &c,
            "story1",
            "cachedContents/x",
            "2026-05-14T13:00:00Z",
            None,
            5,
            &BTreeMap::new(),
            "2026-05-14T12:00:00Z",
        )
        .unwrap();
        clear_active(&c, "story1", "2026-05-14T12:15:00Z").unwrap();
        let s = get(&c, "story1").unwrap();
        assert!(!s.is_active());
        assert!(s.last_cached_message_id.is_none());
        assert!(s.total_token_count.is_none());
        assert_eq!(list_story_ids(&c).unwrap(), vec!["story1".to_string()]);
    }

    #[test]
    fn list_alive_story_rows_filters_inactive() {
        let c = fresh_world();
        c.execute(
            "INSERT INTO items (id, item_type, name, sort_order, created_at, modified_at)
             VALUES ('story2', 'Story', 'Two', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        upsert_active(
            &c,
            "story1",
            "cachedContents/a",
            "2026-05-14T13:00:00Z",
            None,
            10,
            &BTreeMap::new(),
            "2026-05-14T12:00:00Z",
        )
        .unwrap();
        upsert_active(
            &c,
            "story2",
            "cachedContents/b",
            "2026-05-14T12:30:00Z",
            None,
            20,
            &BTreeMap::new(),
            "2026-05-14T12:00:00Z",
        )
        .unwrap();
        clear_active(&c, "story2", "2026-05-14T12:10:00Z").unwrap();

        let alive = list_alive_story_rows(&c).unwrap();
        assert_eq!(alive.len(), 1);
        assert_eq!(alive[0].story_id, "story1");
        assert_eq!(alive[0].story_name, "Test");
        assert_eq!(alive[0].total_tokens, 10);
    }

    #[test]
    fn refresh_expiry_returns_false_when_missing() {
        let c = fresh_world();
        assert!(!refresh_expiry(&c, "story1", "2026-05-14T15:00:00Z", "now").unwrap());
        upsert_active(
            &c,
            "story1",
            "cachedContents/x",
            "2026-05-14T13:00:00Z",
            None,
            1,
            &BTreeMap::new(),
            "2026-05-14T12:00:00Z",
        )
        .unwrap();
        assert!(refresh_expiry(&c, "story1", "2026-05-14T15:00:00Z", "now").unwrap());
        let s = get(&c, "story1").unwrap();
        assert_eq!(s.expiry_at.as_deref(), Some("2026-05-14T15:00:00Z"));
    }
}
