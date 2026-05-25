-- SD-01: restore the `conversation_sessions.entry_message_id` foreign key.
--
-- 001_initial.sql declared the column as a bare `TEXT`, dropping the
-- `REFERENCES messages(id) ON DELETE SET NULL` clause Doc 03 §conversation_sessions
-- promises. SQLite cannot ALTER a constraint in place, so this recreates the
-- table with the FK and copies the rows across (the standard table-rebuild).
--
-- Safe inside the migration runner's per-file transaction: foreign-key
-- enforcement is OFF for the connection (never PRAGMA-enabled), so the
-- drop/rename does not trip referential checks. The column set, CHECK
-- constraints, and indexes are reproduced verbatim from 001_initial.sql.

CREATE TABLE conversation_sessions_new (
    id                TEXT PRIMARY KEY,
    story_id          TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    kind              TEXT NOT NULL CHECK(kind IN ('handover','consulting')),
    name              TEXT NOT NULL,
    entry_message_id  TEXT REFERENCES messages(id) ON DELETE SET NULL,
    entry_snapshot    TEXT NOT NULL,
    is_collapsed      INTEGER NOT NULL DEFAULT 0,
    cache_name        TEXT,
    cache_expiry_at   TEXT,
    cache_is_stale    INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL,
    modified_at       TEXT NOT NULL,
    CHECK (kind = 'consulting' OR (cache_name IS NULL
                               AND cache_expiry_at IS NULL
                               AND cache_is_stale = 0))
);

INSERT INTO conversation_sessions_new
    (id, story_id, kind, name, entry_message_id, entry_snapshot, is_collapsed,
     cache_name, cache_expiry_at, cache_is_stale, created_at, modified_at)
SELECT
    id, story_id, kind, name, entry_message_id, entry_snapshot, is_collapsed,
    cache_name, cache_expiry_at, cache_is_stale, created_at, modified_at
FROM conversation_sessions;

DROP TABLE conversation_sessions;

ALTER TABLE conversation_sessions_new RENAME TO conversation_sessions;

CREATE INDEX idx_sessions_story ON conversation_sessions(story_id);
CREATE INDEX idx_sessions_kind  ON conversation_sessions(kind);
