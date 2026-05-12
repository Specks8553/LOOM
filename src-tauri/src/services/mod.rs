//! Business logic that is not trivial CRUD (Doc 05 §services).
//! `services/` may import `db/`, `security/`, and `state/` (read-only) — never `commands/`.

pub mod config;
pub mod gemini;
pub mod history;
pub mod modes;
pub mod settings;
pub mod settings_keys;
pub mod vault;
pub mod world;
