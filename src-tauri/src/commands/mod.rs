//! Tauri command handlers (Doc 05 §Module Structure). Thin handlers — validate,
//! call into `services/` or `db/`, return. Anything > ~30 lines belongs in a service.
//!
//! One file per backend domain. Phase 0 ships only `app_phase` (the shell driver);
//! feature domains land in their respective phases.

pub mod accordion;
pub mod app_phase;
pub mod auth;
pub mod cache;
pub mod conversation;
pub mod ghostwriter;
pub mod modes;
pub mod vault;
