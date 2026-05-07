//! ts-rs drift-check (SB-3 / Doc 24 §Type Generation).
//!
//! Generates a reference type file at `src-tauri/src/lib/types.ts` (internal
//! Rust tree) alongside the manually-maintained frontend types at
//! `src/lib/types.ts`. The CI `check:types` gate checks that the committed
//! `src/lib/types.ts` has no uncommitted changes, ensuring developers manually
//! sync it when they add or modify IPC types.
//!
//! To add a new type: annotate with `#[derive(TS)] #[ts(export, export_to = ...)]`
//! and add it to this test.

use loom_app_lib::commands::auth::UnlockResult;
use loom_app_lib::error::{LoomError, ValidationKind};
use loom_app_lib::security::sentinel::Sentinel;
use loom_app_lib::services::config::{AppConfig, WorldEntry};
use loom_app_lib::AppPhase;
use ts_rs::TS;

#[test]
fn export_all_ts_types() {
    // Phase 0 types
    LoomError::export_all().expect("LoomError export failed");
    ValidationKind::export_all().expect("ValidationKind export failed");
    AppPhase::export_all().expect("AppPhase export failed");
    // Phase 1 types
    Sentinel::export_all().expect("Sentinel export failed");
    WorldEntry::export_all().expect("WorldEntry export failed");
    UnlockResult::export_all().expect("UnlockResult export failed");
    AppConfig::export_all().expect("AppConfig export failed");
}
