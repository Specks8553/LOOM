//! Business logic that is not trivial CRUD (Doc 05 §services).
//! `services/` may import `db/`, `security/`, and `state/` (read-only) — never `commands/`.

pub mod settings_keys;
