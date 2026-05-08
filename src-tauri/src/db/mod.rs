//! Typed DB access (Doc 05 §db). `db/` may import `rusqlite` only — no calls
//! into `services/`, `commands/`, or `security/`.

pub mod connection;
pub mod migrations;
pub mod settings;
