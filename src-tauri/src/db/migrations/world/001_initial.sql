-- World database baseline schema for LOOM 2.0.
-- Source of truth: docs-v2/foundation/03-data-model.md.
-- Append-only: future changes ship as 002_*.sql, never edit this file.

CREATE TABLE items (
    id           TEXT PRIMARY KEY,
    parent_id    TEXT REFERENCES items(id) ON DELETE SET NULL,
    item_type    TEXT NOT NULL
                   CHECK(item_type IN ('Story','Folder','SourceDocument','Image')),
    item_subtype TEXT,
    name         TEXT NOT NULL,
    content      TEXT NOT NULL DEFAULT '',
    description  TEXT,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    modified_at  TEXT NOT NULL,
    deleted_at   TEXT,
    asset_path   TEXT,
    asset_meta   TEXT,
    file_api_uri TEXT,
    file_api_uploaded_at TEXT
);

CREATE INDEX idx_items_parent      ON items(parent_id);
CREATE INDEX idx_items_type        ON items(item_type);
CREATE INDEX idx_items_deleted     ON items(deleted_at);

CREATE TABLE conversation_sessions (
    id                TEXT PRIMARY KEY,
    story_id          TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    kind              TEXT NOT NULL CHECK(kind IN ('handover','consulting')),
    name              TEXT NOT NULL,
    entry_message_id  TEXT,
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

CREATE INDEX idx_sessions_story ON conversation_sessions(story_id);
CREATE INDEX idx_sessions_kind  ON conversation_sessions(kind);

CREATE TABLE messages (
    id                  TEXT PRIMARY KEY,
    story_id            TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    session_id          TEXT REFERENCES conversation_sessions(id) ON DELETE CASCADE,
    role                TEXT NOT NULL CHECK(role IN ('user','model')),
    content_type        TEXT NOT NULL DEFAULT 'text'
                          CHECK(content_type IN ('json_user','text','blocks')),
    content             TEXT NOT NULL DEFAULT '',
    token_count         INTEGER,
    model_name          TEXT,
    finish_reason       TEXT
                          CHECK(finish_reason IN ('STOP','MAX_TOKENS','SAFETY','ERROR')
                                OR finish_reason IS NULL),
    created_at          TEXT NOT NULL,
    deleted_at          TEXT,
    user_feedback       TEXT,
    ghostwriter_history TEXT NOT NULL DEFAULT '[]',
    kind                TEXT NOT NULL DEFAULT 'story'
                          CHECK(kind IN ('story','handover','consulting')),
    CHECK ((kind = 'story'      AND session_id IS NULL)
        OR (kind IN ('handover','consulting') AND session_id IS NOT NULL))
);

CREATE INDEX idx_messages_story_created ON messages(story_id, created_at);
CREATE INDEX idx_messages_session       ON messages(session_id);
CREATE INDEX idx_messages_kind          ON messages(kind);

CREATE TABLE story_state (
    story_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    key      TEXT NOT NULL,
    value    TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (story_id, key)
);

CREATE TABLE checkpoints (
    id               TEXT PRIMARY KEY,
    story_id         TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    after_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
    name             TEXT NOT NULL DEFAULT 'Chapter',
    is_start         INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL,
    modified_at      TEXT NOT NULL
);

CREATE INDEX idx_checkpoints_story ON checkpoints(story_id);

CREATE TABLE accordion_segments (
    id              TEXT PRIMARY KEY,
    story_id        TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    start_cp_id     TEXT NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
    end_cp_id       TEXT NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
    summary         TEXT,
    is_collapsed    INTEGER NOT NULL DEFAULT 0,
    use_summary     INTEGER NOT NULL DEFAULT 1,
    is_stale        INTEGER NOT NULL DEFAULT 0,
    summarised_at   TEXT,
    created_at      TEXT NOT NULL,
    modified_at     TEXT NOT NULL
);

CREATE INDEX idx_segments_story ON accordion_segments(story_id);

-- World-level setting overrides. Cascade rule: world value → app default → hardcoded fallback.
CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE templates (
    id                   TEXT PRIMARY KEY,
    slug                 TEXT NOT NULL UNIQUE,
    name                 TEXT NOT NULL,
    icon                 TEXT NOT NULL DEFAULT 'FileText',
    default_content      TEXT NOT NULL DEFAULT '',
    creator_instructions TEXT NOT NULL DEFAULT '',
    is_builtin           INTEGER NOT NULL DEFAULT 0,
    sort_order           INTEGER NOT NULL DEFAULT 0,
    created_at           TEXT NOT NULL,
    modified_at          TEXT NOT NULL
);

CREATE TABLE telemetry (
    provider          TEXT PRIMARY KEY
                        CHECK(provider IN ('text','image_gen','tts')),
    req_count_min     INTEGER NOT NULL DEFAULT 0,
    req_count_day     INTEGER NOT NULL DEFAULT 0,
    token_count_min   INTEGER NOT NULL DEFAULT 0,
    last_req_at       TEXT,
    window_start_min  TEXT,
    window_start_day  TEXT
);

CREATE TABLE attachment_history (
    id         TEXT PRIMARY KEY,
    story_id   TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    doc_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    event      TEXT NOT NULL CHECK(event IN ('attach','detach')),
    reason     TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_attach_history_story ON attachment_history(story_id, created_at);

CREATE TABLE creator_messages (
    id         TEXT PRIMARY KEY,
    doc_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK(role IN ('user','model')),
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_creator_messages_doc ON creator_messages(doc_id, created_at);

CREATE TABLE cache_state (
    story_id               TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
    cache_name             TEXT,
    expiry_at              TEXT,
    is_stale               INTEGER NOT NULL DEFAULT 0,
    last_cached_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
    total_token_count      INTEGER,
    doc_snapshots          TEXT NOT NULL DEFAULT '{}',
    created_at             TEXT NOT NULL,
    updated_at             TEXT NOT NULL
);

-- Seed the three telemetry rows so updates can use UPSERT-by-PK without first existence checks.
INSERT INTO telemetry (provider) VALUES ('text');
INSERT INTO telemetry (provider) VALUES ('image_gen');
INSERT INTO telemetry (provider) VALUES ('tts');
