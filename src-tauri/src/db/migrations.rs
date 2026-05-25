//! Versioned schema migrations (SB-6 / Doc 24 §Schema Migrations).
//!
//! Two roots — `world/` (for `loom.db`) and `app/` (for `app_settings.db`) —
//! each with its own `schema_migrations` table. Migrations are append-only;
//! a bug in `003` is fixed by `004`, never by editing `003`.
//!
//! Files are bundled at compile time via `include_str!`. The list below is
//! the source of truth for which migrations exist; numeric order is checked
//! at apply time.

use rusqlite::{Connection, Transaction};
use tracing::{debug, info};

use crate::error::LoomError;

/// Which schema root this connection corresponds to.
#[derive(Debug, Clone, Copy)]
pub enum MigrationRoot {
    World,
    App,
}

#[derive(Debug)]
struct Migration {
    version: u32,
    name: &'static str,
    sql: &'static str,
}

const WORLD_MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "001_initial",
        sql: include_str!("migrations/world/001_initial.sql"),
    },
    Migration {
        version: 2,
        name: "002_session_entry_fk",
        sql: include_str!("migrations/world/002_session_entry_fk.sql"),
    },
    Migration {
        version: 3,
        name: "003_backfill_start_sentinels",
        sql: include_str!("migrations/world/003_backfill_start_sentinels.sql"),
    },
    Migration {
        version: 4,
        name: "004_important_marks",
        sql: include_str!("migrations/world/004_important_marks.sql"),
    },
];

const APP_MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    name: "001_initial",
    sql: include_str!("migrations/app/001_initial.sql"),
}];

fn migrations_for(root: MigrationRoot) -> &'static [Migration] {
    match root {
        MigrationRoot::World => WORLD_MIGRATIONS,
        MigrationRoot::App => APP_MIGRATIONS,
    }
}

/// Apply all pending migrations on `conn` in numeric order, recording each in
/// `schema_migrations` on success. Each migration runs in its own transaction.
///
/// Foreign-key enforcement (on by default in this SQLCipher build) is disabled
/// for the duration of the apply loop and restored afterwards. Table-rebuild
/// migrations (the SQLite ALTER-via-recreate pattern, e.g. `world/002`) `DROP`
/// and recreate a table; with FK on, `DROP TABLE` performs an implicit `DELETE`
/// that would cascade into child rows (`messages.session_id ON DELETE CASCADE`).
/// `PRAGMA foreign_keys` is a no-op inside a transaction, so it must be toggled
/// here — outside the per-migration transactions (SQLite §ALTER TABLE rebuild).
pub fn apply_pending(conn: &mut Connection, root: MigrationRoot) -> Result<u32, LoomError> {
    ensure_migrations_table(conn)?;
    conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
    let result = apply_pending_inner(conn, root);
    // Always restore enforcement, even if a migration failed mid-loop. A
    // migration error takes precedence over a restore error.
    let restore = conn
        .execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(LoomError::from);
    match (result, restore) {
        (Err(e), _) => Err(e),
        (Ok(_), Err(e)) => Err(e),
        (Ok(n), Ok(())) => Ok(n),
    }
}

fn apply_pending_inner(conn: &mut Connection, root: MigrationRoot) -> Result<u32, LoomError> {
    let current: u32 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(LoomError::from)?;

    let mut applied = 0u32;
    let migrations = migrations_for(root);
    // Numeric-order safety: caller declares them in order; assert at apply time.
    for (idx, m) in migrations.iter().enumerate() {
        let expected = (idx as u32) + 1;
        debug_assert_eq!(
            m.version, expected,
            "migrations must be declared in contiguous numeric order"
        );
        if m.version <= current {
            continue;
        }
        debug!(root = ?root, version = m.version, name = m.name, "applying migration");
        let tx: Transaction<'_> = conn.transaction()?;
        tx.execute_batch(m.sql)?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at, name) VALUES (?1, ?2, ?3)",
            rusqlite::params![m.version, now_iso8601(), m.name],
        )?;
        tx.commit()?;
        applied += 1;
    }

    if applied > 0 {
        info!(root = ?root, applied, "schema migrations complete");
    }
    Ok(applied)
}

fn ensure_migrations_table(conn: &Connection) -> Result<(), LoomError> {
    conn.execute_batch(
        r"CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL,
            name       TEXT NOT NULL
        );",
    )
    .map_err(LoomError::from)
}

fn now_iso8601() -> String {
    // RFC 3339 / ISO 8601 with seconds. `time` crate would be cleaner but
    // we don't want a new dep just for this — std SystemTime is fine.
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Convert epoch seconds to a YYYY-MM-DDTHH:MM:SSZ string. We avoid pulling
    // chrono/time for one timestamp; the human-readable applied_at is for
    // diagnostics only — strict ordering uses `version`.
    let (y, mo, d, h, mi, s) = epoch_to_components(secs);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}

/// Civil time conversion for UTC epoch seconds. From Howard Hinnant's
/// `days_from_civil` algorithm. Public-domain.
fn epoch_to_components(secs: u64) -> (i64, u32, u32, u32, u32, u32) {
    let s = (secs % 60) as u32;
    let m = ((secs / 60) % 60) as u32;
    let h = ((secs / 3600) % 24) as u32;
    let days = (secs / 86_400) as i64;

    // Days from 1970-01-01 (epoch).
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = if mo <= 2 { y + 1 } else { y };
    (y, mo, d, h, m, s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn world_migrations_apply_to_fresh_db() {
        let mut conn = Connection::open_in_memory().unwrap();
        let n = apply_pending(&mut conn, MigrationRoot::World).unwrap();
        assert_eq!(n, 4);

        // schema_migrations recorded all versions.
        let row: (u32, String) = conn
            .query_row(
                "SELECT version, name FROM schema_migrations WHERE version = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(row, (1, "001_initial".to_string()));
        let row2: (u32, String) = conn
            .query_row(
                "SELECT version, name FROM schema_migrations WHERE version = 2",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(row2, (2, "002_session_entry_fk".to_string()));
        let row3: (u32, String) = conn
            .query_row(
                "SELECT version, name FROM schema_migrations WHERE version = 3",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(row3, (3, "003_backfill_start_sentinels".to_string()));
        let row4: (u32, String) = conn
            .query_row(
                "SELECT version, name FROM schema_migrations WHERE version = 4",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(row4, (4, "004_important_marks".to_string()));

        // A representative table from Doc 03 exists.
        let count: u32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='items'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn re_running_world_migrations_is_a_noop() {
        let mut conn = Connection::open_in_memory().unwrap();
        assert_eq!(apply_pending(&mut conn, MigrationRoot::World).unwrap(), 4);
        assert_eq!(apply_pending(&mut conn, MigrationRoot::World).unwrap(), 0);
    }

    #[test]
    fn migration_003_backfills_sentinel_for_sentinel_less_story() {
        // A world whose 001/002 ran but which contains a Story created before
        // the create_item sentinel logic: simulate by applying 001+002, then
        // inserting a Story with no checkpoint, then applying 003.
        let mut conn = Connection::open_in_memory().unwrap();

        // Apply only 001 + 002 by recording 003 as already-done is awkward;
        // instead apply all, delete the auto-nothing (fresh db has no stories),
        // then insert a sentinel-less story and re-run — 003 is idempotent and
        // re-applying the whole set is a no-op, so drive the INSERT directly via
        // a fresh apply path: apply 1+2 manually.
        ensure_migrations_table(&conn).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
        for m in WORLD_MIGRATIONS.iter().take(2) {
            conn.execute_batch(m.sql).unwrap();
            conn.execute(
                "INSERT INTO schema_migrations (version, applied_at, name) VALUES (?1, ?2, ?3)",
                rusqlite::params![m.version, now_iso8601(), m.name],
            )
            .unwrap();
        }
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();

        // A Story with no start sentinel.
        conn.execute(
            "INSERT INTO items (id, parent_id, item_type, name, sort_order, created_at, modified_at)
             VALUES ('story1', NULL, 'Story', 'Legacy', 0,
                     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();

        // Now apply pending — 003 (backfill) + 004 (important_marks) remain.
        let applied = apply_pending(&mut conn, MigrationRoot::World).unwrap();
        assert_eq!(applied, 2);

        // Exactly one start sentinel now exists for the story, named "Chapter 1".
        let (count, name, after_null): (u32, String, bool) = conn
            .query_row(
                "SELECT COUNT(*), MAX(name), MAX(after_message_id IS NULL) \
                 FROM checkpoints WHERE story_id = 'story1' AND is_start = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get::<_, i64>(2)? != 0)),
            )
            .unwrap();
        assert_eq!(count, 1);
        assert_eq!(name, "Chapter 1");
        assert!(after_null);

        // Re-running does not add a second sentinel (idempotent guard).
        assert_eq!(apply_pending(&mut conn, MigrationRoot::World).unwrap(), 0);
        let count2: u32 = conn
            .query_row(
                "SELECT COUNT(*) FROM checkpoints WHERE story_id = 'story1' AND is_start = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count2, 1);
    }

    #[test]
    fn migration_002_restores_entry_message_id_fk() {
        // SD-01: after 002, `conversation_sessions.entry_message_id` must carry
        // a FK to `messages(id)` with ON DELETE SET NULL.
        let mut conn = Connection::open_in_memory().unwrap();
        apply_pending(&mut conn, MigrationRoot::World).unwrap();

        let fk: Option<(String, String, String)> = conn
            .query_row(
                "SELECT \"table\", \"to\", on_delete \
                 FROM pragma_foreign_key_list('conversation_sessions') \
                 WHERE \"from\" = 'entry_message_id'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .ok();

        let (table, to, on_delete) = fk.expect("entry_message_id FK should exist after 002");
        assert_eq!(table, "messages");
        assert_eq!(to, "id");
        assert_eq!(on_delete, "SET NULL");
    }

    #[test]
    fn app_001_creates_app_settings_table() {
        let mut conn = Connection::open_in_memory().unwrap();
        let n = apply_pending(&mut conn, MigrationRoot::App).unwrap();
        assert_eq!(n, 1);
        let count: u32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='app_settings'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn epoch_components_for_known_timestamp() {
        // 2026-05-06 00:00:00 UTC = 1778025600 seconds.
        let (y, mo, d, h, mi, s) = epoch_to_components(1778025600);
        assert_eq!((y, mo, d, h, mi, s), (2026, 5, 6, 0, 0, 0));
    }
}
