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
use loom_app_lib::commands::conversation::SendMessageResult;
use loom_app_lib::commands::modes::{SendSessionMessageResult, StoryActiveMode};
use loom_app_lib::db::conversation_sessions::ConversationSession;
use loom_app_lib::db::messages::ChatMessage;
use loom_app_lib::db::templates::Template;
use loom_app_lib::db::vault::{ImageAssetMeta, VaultItemMeta};
use loom_app_lib::services::settings::ResolvedSettings;
use loom_app_lib::error::{LoomError, ValidationKind};
use loom_app_lib::security::sentinel::Sentinel;
use loom_app_lib::services::config::{AppConfig, WorldEntry};
use loom_app_lib::services::gemini::TokenEstimate;
use loom_app_lib::services::history::UserContent;
use loom_app_lib::services::modes::{
    AccordionSnapshotEntry, AttachedDocEntry, SessionKind, SessionSnapshot,
};
use loom_app_lib::services::world::{WorldMeta, WorldMetaPatch};
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
    // Phase 2 types
    WorldMeta::export_all().expect("WorldMeta export failed");
    WorldMetaPatch::export_all().expect("WorldMetaPatch export failed");
    VaultItemMeta::export_all().expect("VaultItemMeta export failed");
    ImageAssetMeta::export_all().expect("ImageAssetMeta export failed");
    // Phase 3 types
    ChatMessage::export_all().expect("ChatMessage export failed");
    UserContent::export_all().expect("UserContent export failed");
    TokenEstimate::export_all().expect("TokenEstimate export failed");
    SendMessageResult::export_all().expect("SendMessageResult export failed");
    // Phase 4 types (Doc 23)
    ConversationSession::export_all().expect("ConversationSession export failed");
    SessionKind::export_all().expect("SessionKind export failed");
    SessionSnapshot::export_all().expect("SessionSnapshot export failed");
    AccordionSnapshotEntry::export_all().expect("AccordionSnapshotEntry export failed");
    AttachedDocEntry::export_all().expect("AttachedDocEntry export failed");
    SendSessionMessageResult::export_all().expect("SendSessionMessageResult export failed");
    StoryActiveMode::export_all().expect("StoryActiveMode export failed");
    // Phase 11 types (Doc 20)
    ResolvedSettings::export_all().expect("ResolvedSettings export failed");
    Template::export_all().expect("Template export failed");
}
