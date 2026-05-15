//! Business logic that is not trivial CRUD (Doc 05 §services).
//! `services/` may import `db/`, `security/`, and `state/` (read-only) — never `commands/`.

pub mod accordion;
pub mod cache;
pub mod config;
pub mod file_api;
pub mod gemini;
pub mod ghostwriter;
pub mod history;
pub mod modes;
pub mod settings;
pub mod settings_keys;
pub mod vault;
pub mod world;
