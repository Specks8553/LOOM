//! Typed DB access (Doc 05 §db). `db/` may import `rusqlite` only — no calls
//! into `services/`, `commands/`, or `security/`.

pub mod accordion;
pub mod attachment_history;
pub mod cache_state;
pub mod connection;
pub mod conversation_sessions;
pub mod messages;
pub mod migrations;
pub mod settings;
pub mod templates;
pub mod vault;
