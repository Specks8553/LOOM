//! `attachment_history` audit-trail rows (Doc 03, Doc 18 §Cascade Rules).
//!
//! Every attach / detach mutation appends one row here. Phase 5 only writes;
//! reads land in Phase 6 (cache prefix construction) and Phase 7 (Accordion
//! staleness).
//!
//! Per Doc 05 §Dependency Rules, `db/` may import `rusqlite` only.

use rusqlite::{params, Connection};
use uuid::Uuid;

use crate::error::LoomError;

/// Insert an `event='attach'` row. `reason` is always NULL for attaches.
pub fn insert_attach(
    conn: &Connection,
    story_id: &str,
    doc_id: &str,
    created_at: &str,
) -> Result<(), LoomError> {
    conn.execute(
        "INSERT INTO attachment_history (id, story_id, doc_id, event, reason, created_at)
         VALUES (?1, ?2, ?3, 'attach', NULL, ?4)",
        params![Uuid::new_v4().to_string(), story_id, doc_id, created_at],
    )
    .map_err(|e| LoomError::Database(e.to_string()))?;
    Ok(())
}

/// Insert an `event='detach'` row. `reason` is `'soft_delete'` for cascade
/// detaches; `None` (NULL) for user-initiated detaches.
pub fn insert_detach(
    conn: &Connection,
    story_id: &str,
    doc_id: &str,
    reason: Option<&str>,
    created_at: &str,
) -> Result<(), LoomError> {
    conn.execute(
        "INSERT INTO attachment_history (id, story_id, doc_id, event, reason, created_at)
         VALUES (?1, ?2, ?3, 'detach', ?4, ?5)",
        params![
            Uuid::new_v4().to_string(),
            story_id,
            doc_id,
            reason,
            created_at
        ],
    )
    .map_err(|e| LoomError::Database(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::{apply_pending, MigrationRoot};

    fn fresh_conn() -> Connection {
        let mut conn = Connection::open_in_memory().expect("in-memory open");
        apply_pending(&mut conn, MigrationRoot::World).expect("world migrations");
        // Seed two items so the FKs on attachment_history are satisfied.
        conn.execute(
            "INSERT INTO items (id, item_type, name, created_at, modified_at)
             VALUES ('s1', 'Story', 'Story', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
                    ('d1', 'SourceDocument', 'Doc', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        conn
    }

    fn rows(conn: &Connection) -> Vec<(String, String, Option<String>)> {
        let mut stmt = conn
            .prepare("SELECT event, doc_id, reason FROM attachment_history ORDER BY created_at, id")
            .unwrap();
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                ))
            })
            .unwrap();
        rows.map(|r| r.unwrap()).collect()
    }

    #[test]
    fn attach_writes_event_with_null_reason() {
        let conn = fresh_conn();
        insert_attach(&conn, "s1", "d1", "2026-05-14T00:00:00Z").unwrap();
        let rs = rows(&conn);
        assert_eq!(rs.len(), 1);
        assert_eq!(rs[0].0, "attach");
        assert_eq!(rs[0].1, "d1");
        assert!(rs[0].2.is_none());
    }

    #[test]
    fn detach_with_reason_persists_reason() {
        let conn = fresh_conn();
        insert_detach(
            &conn,
            "s1",
            "d1",
            Some("soft_delete"),
            "2026-05-14T00:00:00Z",
        )
        .unwrap();
        let rs = rows(&conn);
        assert_eq!(rs[0].0, "detach");
        assert_eq!(rs[0].2.as_deref(), Some("soft_delete"));
    }

    #[test]
    fn detach_without_reason_persists_null() {
        let conn = fresh_conn();
        insert_detach(&conn, "s1", "d1", None, "2026-05-14T00:00:00Z").unwrap();
        let rs = rows(&conn);
        assert_eq!(rs[0].0, "detach");
        assert!(rs[0].2.is_none());
    }
}
