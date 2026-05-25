-- D-25 / Doc 30: "mark as important" annotations on story bubbles.
-- A mark is a verbatim passage the writer flags so summary AIs preserve it.
-- Source of truth: docs-v2/foundation/03-data-model.md §important_marks.
-- Append-only: never edit this file.

CREATE TABLE important_marks (
    id           TEXT PRIMARY KEY,
    story_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    message_id   TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    quoted_text  TEXT NOT NULL,
    note         TEXT,
    char_start   INTEGER,
    char_end     INTEGER,
    is_orphaned  INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    modified_at  TEXT NOT NULL
);

CREATE INDEX idx_important_marks_story   ON important_marks(story_id);
CREATE INDEX idx_important_marks_message ON important_marks(message_id);
