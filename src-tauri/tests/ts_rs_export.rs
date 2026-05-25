//! ts-rs drift-check (SB-3 / Doc 24 §Type Generation).
//!
//! Generates the frontend's IPC type artefact at `src/lib/types.generated.ts`
//! from the Rust structs (the single source of truth). The hand-written barrel
//! `src/lib/types.ts` re-exports it (`export *`) and adds the few frontend-only
//! types ts-rs cannot generate (event payloads emitted via inline JSON, string
//! unions stored as TEXT, and the word-diff/selection helpers).
//!
//! The CI "ts-rs drift check" runs this test then `git diff --exit-code
//! src/lib/types.generated.ts` — so any Rust-struct change that is not
//! regenerated-and-committed fails CI (SB-01 / SB-02).
//!
//! To add a new IPC type: annotate the Rust struct with
//! `#[derive(TS)] #[ts(export, export_to = "../src/lib/types.generated.ts")]`
//! and add an `::export_all()` call below.

use loom_app_lib::commands::auth::UnlockResult;
use loom_app_lib::commands::conversation::SendMessageResult;
use loom_app_lib::commands::ghostwriter::{GhostwriterResponse, RevertResult};
use loom_app_lib::commands::modes::{SendSessionMessageResult, StoryActiveMode};
use loom_app_lib::db::accordion::{AccordionSegment, AccordionState, Checkpoint};
use loom_app_lib::db::cache_state::{CacheStatus, SessionCacheStatus};
use loom_app_lib::db::conversation_sessions::ConversationSession;
use loom_app_lib::db::marks::ImportantMark;
use loom_app_lib::db::messages::ChatMessage;
use loom_app_lib::db::templates::Template;
use loom_app_lib::db::vault::{ImageAssetMeta, VaultItemMeta};
use loom_app_lib::error::{LoomError, ValidationKind};
use loom_app_lib::security::sentinel::Sentinel;
use loom_app_lib::services::cache::{AliveCacheRow, SessionDivergence, SessionDivergenceKind};
use loom_app_lib::services::config::{AppConfig, WorldEntry};
use loom_app_lib::services::gemini::TokenEstimate;
use loom_app_lib::services::ghostwriter::GhostwriterEdit;
use loom_app_lib::services::history::UserContent;
use loom_app_lib::services::modes::{
    AccordionSnapshotEntry, AttachedDocEntry, SessionKind, SessionSnapshot,
};
use loom_app_lib::services::settings::ResolvedSettings;
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
    // Phase 6 types (Doc 22 — context caching)
    CacheStatus::export_all().expect("CacheStatus export failed");
    SessionCacheStatus::export_all().expect("SessionCacheStatus export failed");
    AliveCacheRow::export_all().expect("AliveCacheRow export failed");
    SessionDivergence::export_all().expect("SessionDivergence export failed");
    SessionDivergenceKind::export_all().expect("SessionDivergenceKind export failed");
    // Phase 7 types (Doc 16 — accordion)
    Checkpoint::export_all().expect("Checkpoint export failed");
    AccordionSegment::export_all().expect("AccordionSegment export failed");
    AccordionState::export_all().expect("AccordionState export failed");
    // Phase 8 types (Doc 17 — ghostwriter)
    GhostwriterEdit::export_all().expect("GhostwriterEdit export failed");
    GhostwriterResponse::export_all().expect("GhostwriterResponse export failed");
    RevertResult::export_all().expect("RevertResult export failed");
    // Phase 11 types (Doc 20)
    ResolvedSettings::export_all().expect("ResolvedSettings export failed");
    Template::export_all().expect("Template export failed");
    // Phase 14 types (Doc 30 — marks)
    ImportantMark::export_all().expect("ImportantMark export failed");
}
