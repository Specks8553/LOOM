-- App-settings database baseline schema for LOOM 2.0.
-- Source of truth: docs-v2/foundation/03-data-model.md §app_settings.
-- Append-only.

CREATE TABLE app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);
