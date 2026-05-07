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

const WORLD_MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    name: "001_initial",
    sql: include_str!("migrations/world/001_initial.sql"),
}];

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
pub fn apply_pending(conn: &mut Connection, root: MigrationRoot) -> Result<u32, LoomError> {
    ensure_migrations_table(conn)?;

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
    fn world_001_applies_to_fresh_db() {
        let mut conn = Connection::open_in_memory().unwrap();
        let n = apply_pending(&mut conn, MigrationRoot::World).unwrap();
        assert_eq!(n, 1);

        // schema_migrations recorded.
        let row: (u32, String) = conn
            .query_row(
                "SELECT version, name FROM schema_migrations WHERE version = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(row, (1, "001_initial".to_string()));

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
        assert_eq!(apply_pending(&mut conn, MigrationRoot::World).unwrap(), 1);
        assert_eq!(apply_pending(&mut conn, MigrationRoot::World).unwrap(), 0);
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
