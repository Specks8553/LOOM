//! Canary integration test (Doc 25 §Rust Integration Tests).
//!
//! Proves the test binary links and runs, and that the in-memory SQLite
//! fixture recipe works end-to-end. This is not a comprehensive test of any
//! single module — those live alongside the module in `#[cfg(test)]` blocks.

use loom_app_lib::db::migrations::{apply_pending, MigrationRoot};
use rusqlite::Connection;

/// Open a fresh in-memory world DB with the full schema applied.
fn world_db() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    apply_pending(&mut conn, MigrationRoot::World).unwrap();
    conn
}

/// Open a fresh in-memory app DB with the full schema applied.
fn app_db() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    apply_pending(&mut conn, MigrationRoot::App).unwrap();
    conn
}

#[test]
fn world_schema_applies_and_items_table_exists() {
    let conn = world_db();
    let count: u32 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='items'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1, "items table must exist after world migration");
}

#[test]
fn app_schema_applies_and_settings_table_exists() {
    let conn = app_db();
    let count: u32 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='app_settings'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        count, 1,
        "app_settings table must exist after app migration"
    );
}

#[test]
fn each_test_gets_an_isolated_db() {
    // Two calls to world_db() produce independent connections.
    let conn_a = world_db();
    let conn_b = world_db();

    conn_a
        .execute(
            "INSERT INTO items (id, item_type, name, content, created_at, modified_at, sort_order) \
             VALUES ('i-1', 'Story', 'alpha', '', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0)",
            [],
        )
        .unwrap();

    // conn_b sees no rows — it is a separate in-memory DB.
    let count: u32 = conn_b
        .query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 0, "each world_db() call must be fully isolated");
}
