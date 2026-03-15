use rusqlite::Connection;

use crate::error::LoomError;

/// Open a SQLCipher-encrypted world database.
pub fn open_world_db(db_path: &std::path::Path, key: &[u8; 32]) -> Result<Connection, LoomError> {
    let conn = Connection::open(db_path)?;

    // Set the encryption key via PRAGMA
    let key_hex = hex::encode(key);
    conn.execute_batch(&format!("PRAGMA key = \"x'{key_hex}'\";"))?;

    // Verify the connection works by reading the schema
    conn.execute_batch("SELECT count(*) FROM sqlite_master;")?;

    // Run dev-phase migrations for schema changes
    migrate_dev_schema(&conn)?;

    Ok(conn)
}

/// Initialize the full database schema for a new world.
/// Creates all 9+2 tables per Doc 15 §7.
pub fn init_schema(conn: &Connection) -> Result<(), LoomError> {
    conn.execute_batch(
        "
        -- Vault tree nodes (stories, folders, docs, images)
        CREATE TABLE IF NOT EXISTS items (
            id           TEXT PRIMARY KEY,
            story_id     TEXT,
            parent_id    TEXT REFERENCES items(id) ON DELETE SET NULL,
            item_type    TEXT NOT NULL CHECK(item_type IN ('Story','Folder','SourceDocument','Image')),
            item_subtype TEXT,
            name         TEXT NOT NULL,
            content      TEXT NOT NULL DEFAULT '',
            description  TEXT,
            sort_order   INTEGER NOT NULL DEFAULT 0,
            created_at   TEXT NOT NULL,
            modified_at  TEXT NOT NULL,
            deleted_at   TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_items_parent  ON items(parent_id);
        CREATE INDEX IF NOT EXISTS idx_items_type    ON items(item_type);
        CREATE INDEX IF NOT EXISTS idx_items_deleted ON items(deleted_at);

        -- Conversation messages (DAG structure) — Doc 09 §1.1
        CREATE TABLE IF NOT EXISTS messages (
            id                  TEXT PRIMARY KEY,
            story_id            TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
            parent_id           TEXT REFERENCES messages(id) ON DELETE SET NULL,
            role                TEXT NOT NULL CHECK(role IN ('user','model')),
            content_type        TEXT NOT NULL DEFAULT 'text'
                                  CHECK(content_type IN ('json_user','text','blocks')),
            content             TEXT NOT NULL DEFAULT '',
            token_count         INTEGER,
            model_name          TEXT,
            finish_reason       TEXT CHECK(finish_reason IN ('STOP','MAX_TOKENS','SAFETY','ERROR') OR finish_reason IS NULL),
            created_at          TEXT NOT NULL,
            deleted_at          TEXT,
            user_feedback       TEXT,
            ghostwriter_history TEXT NOT NULL DEFAULT '[]'
        );
        CREATE INDEX IF NOT EXISTS idx_messages_story  ON messages(story_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_id);

        -- Per-story key-value settings
        CREATE TABLE IF NOT EXISTS story_settings (
            story_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
            key      TEXT NOT NULL,
            value    TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (story_id, key)
        );

        -- Branch checkpoints (used by Branch Map + Accordion)
        CREATE TABLE IF NOT EXISTS checkpoints (
            id          TEXT PRIMARY KEY,
            story_id    TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
            message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
            name        TEXT NOT NULL,
            created_at  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_checkpoints_story ON checkpoints(story_id);

        -- Accordion segment summaries
        CREATE TABLE IF NOT EXISTS accordion_segments (
            id             TEXT PRIMARY KEY,
            story_id       TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
            start_msg_id   TEXT NOT NULL REFERENCES messages(id),
            end_msg_id     TEXT NOT NULL REFERENCES messages(id),
            summary_user   TEXT NOT NULL DEFAULT '',
            summary_model  TEXT NOT NULL DEFAULT '',
            token_count    INTEGER,
            created_at     TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_accordion_story ON accordion_segments(story_id);

        -- User-defined Source Document templates
        CREATE TABLE IF NOT EXISTS templates (
            id              TEXT PRIMARY KEY,
            slug            TEXT NOT NULL UNIQUE,
            name            TEXT NOT NULL,
            icon            TEXT NOT NULL DEFAULT 'FileText',
            default_content TEXT NOT NULL DEFAULT '',
            is_builtin      INTEGER NOT NULL DEFAULT 0,
            created_at      TEXT NOT NULL,
            modified_at     TEXT NOT NULL
        );

        -- World-level key-value settings
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL DEFAULT ''
        );

        -- Rate limiter counters (3 rows: text, image_gen, tts)
        CREATE TABLE IF NOT EXISTS telemetry (
            provider       TEXT PRIMARY KEY,
            req_count_min  INTEGER NOT NULL DEFAULT 0,
            req_count_day  INTEGER NOT NULL DEFAULT 0,
            token_count_min INTEGER NOT NULL DEFAULT 0,
            last_req_at    TEXT,
            window_start_min TEXT,
            window_start_day TEXT
        );

        -- Doc attachment/detach audit trail
        CREATE TABLE IF NOT EXISTS attachment_history (
            id          TEXT PRIMARY KEY,
            story_id    TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
            doc_id      TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
            action      TEXT NOT NULL CHECK(action IN ('attach','detach')),
            created_at  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_attachment_story ON attachment_history(story_id);
        "
    )?;

    Ok(())
}

/// Seed the settings table with all default values per Doc 05 §11.
pub fn seed_default_settings(conn: &Connection) -> Result<(), LoomError> {
    let defaults = vec![
        ("system_instructions", ""),
        ("text_model_name", "gemini-2.5-flash"),
        ("text_model_options", r#"["gemini-2.5-flash","gemini-2.5-pro","gemini-2.0-flash"]"#),
        ("accent_color", "#7c3aed"),
        ("body_font", "serif"),
        ("bubble_user_color", ""),
        ("bubble_ai_color", "#1a1a1a"),
        ("ghostwriter_frame_color", ""),
        ("ghostwriter_diff_color", ""),
        ("checkpoint_color", ""),
        ("accordion_color", ""),
        ("rate_limit_rpm", "10"),
        ("rate_limit_tpm", "250000"),
        ("rate_limit_rpd", "1500"),
        ("context_token_limit", "128000"),
        ("modificator_presets", "[]"),
        ("last_open_story_id", ""),
        ("img_gen_model_name", ""),
        ("tts_model_name", ""),
        ("prompt_ghostwriter", "You are a skilled creative writing editor. The user will provide their original text and a description of the changes they want. Rewrite the text incorporating the requested changes while preserving the author's voice and style. Return ONLY the rewritten text, nothing else."),
        ("prompt_accordion_summarise", "Summarize the following conversation segment concisely. Capture the key plot points, character developments, and world-building details. Focus on information that would be needed to continue the story coherently."),
        ("prompt_accordion_fake_user", "Summarize this chapter: actions, character states, and world state at the end of the chapter."),
    ];

    let mut stmt = conn.prepare(
        "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)"
    )?;

    for (key, value) in defaults {
        stmt.execute(rusqlite::params![key, value])?;
    }

    Ok(())
}

/// Seed the telemetry table with 3 provider rows.
pub fn seed_telemetry(conn: &Connection) -> Result<(), LoomError> {
    let providers = ["text", "image_gen", "tts"];

    let mut stmt = conn.prepare(
        "INSERT OR IGNORE INTO telemetry (provider) VALUES (?1)"
    )?;

    for provider in &providers {
        stmt.execute(rusqlite::params![provider])?;
    }

    Ok(())
}

/// Seed built-in templates.
pub fn seed_builtin_templates(conn: &Connection) -> Result<(), LoomError> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT OR IGNORE INTO templates (id, slug, name, icon, default_content, is_builtin, created_at, modified_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7)",
        rusqlite::params![
            uuid::Uuid::new_v4().to_string(),
            "image",
            "Image",
            "Image",
            "",
            &now,
            &now,
        ],
    )?;
    Ok(())
}

/// Run development-phase schema migrations.
/// Drops and recreates tables whose schema has changed since prior phases.
/// Safe to call on every open — only acts if the old schema is detected.
pub fn migrate_dev_schema(conn: &Connection) -> Result<(), LoomError> {
    // Check if messages table has the old content_type constraint (Phase 4 schema had 'text','image')
    let table_sql: Option<String> = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'",
            [],
            |row| row.get(0),
        )
        .ok();

    if let Some(sql) = table_sql {
        if sql.contains("'image'") || !sql.contains("'json_user'") {
            // Old schema — drop and let init_schema recreate it
            // Messages table should be empty at this development stage
            log::info!("Migrating messages table to Phase 6 schema");
            conn.execute_batch(
                "DROP TABLE IF EXISTS messages;
                 DROP TABLE IF EXISTS story_settings;"
            )?;
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS messages (
                    id                  TEXT PRIMARY KEY,
                    story_id            TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                    parent_id           TEXT REFERENCES messages(id) ON DELETE SET NULL,
                    role                TEXT NOT NULL CHECK(role IN ('user','model')),
                    content_type        TEXT NOT NULL DEFAULT 'text'
                                          CHECK(content_type IN ('json_user','text','blocks')),
                    content             TEXT NOT NULL DEFAULT '',
                    token_count         INTEGER,
                    model_name          TEXT,
                    finish_reason       TEXT CHECK(finish_reason IN ('STOP','MAX_TOKENS','SAFETY','ERROR') OR finish_reason IS NULL),
                    created_at          TEXT NOT NULL,
                    deleted_at          TEXT,
                    user_feedback       TEXT,
                    ghostwriter_history TEXT NOT NULL DEFAULT '[]'
                );
                CREATE INDEX IF NOT EXISTS idx_messages_story  ON messages(story_id, created_at);
                CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_id);
                CREATE TABLE IF NOT EXISTS story_settings (
                    story_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                    key      TEXT NOT NULL,
                    value    TEXT NOT NULL DEFAULT '',
                    PRIMARY KEY (story_id, key)
                );"
            )?;
        }
    }

    // Fix outdated model name from earlier phases
    conn.execute(
        "UPDATE settings SET value = 'gemini-2.5-flash' WHERE key = 'text_model_name' AND value = 'gemini-2.5-flash-preview'",
        [],
    ).ok();
    conn.execute(
        "UPDATE settings SET value = ?1 WHERE key = 'text_model_options' AND value LIKE '%flash-preview%'",
        rusqlite::params![r#"["gemini-2.5-flash","gemini-2.5-pro","gemini-2.0-flash"]"#],
    ).ok();

    Ok(())
}

/// Close a database connection.
pub fn close_db(conn: Connection) {
    // Connection is dropped, which closes it
    drop(conn);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn in_memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn test_init_schema_creates_all_tables() {
        let conn = in_memory_db();
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        let expected = vec![
            "accordion_segments",
            "attachment_history",
            "checkpoints",
            "items",
            "messages",
            "settings",
            "story_settings",
            "telemetry",
            "templates",
        ];
        assert_eq!(tables, expected);
    }

    #[test]
    fn test_seed_default_settings() {
        let conn = in_memory_db();
        seed_default_settings(&conn).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM settings", [], |row| row.get(0))
            .unwrap();
        assert!(count >= 20, "Expected at least 20 default settings, got {}", count);

        let model: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'text_model_name'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(model, "gemini-2.5-flash");
    }

    #[test]
    fn test_seed_telemetry() {
        let conn = in_memory_db();
        seed_telemetry(&conn).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM telemetry", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 3);
    }
}
