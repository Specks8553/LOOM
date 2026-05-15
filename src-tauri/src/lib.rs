//! `lib.rs` is registration-only (Doc 24 §General — Appendix A11).
//! No business logic, no DB calls, no service calls — only Tauri builder
//! configuration and command registration.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub mod commands;
pub mod db;
pub mod error;
pub mod security;
pub mod services;
pub mod state;

/// Three-state app phase (D-05). Conditional rendering on this field is the
/// only "router" the frontend uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../src/lib/types.ts")]
pub enum AppPhase {
    Onboarding,
    Locked,
    Workspace,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::app_phase::get_app_phase,
            commands::app_phase::dev_set_app_phase,
            commands::auth::check_onboarding,
            commands::auth::setup_vault,
            commands::auth::unlock_vault,
            commands::auth::lock_vault,
            commands::auth::change_password,
            commands::auth::set_api_key,
            commands::auth::has_api_key,
            commands::vault::list_worlds,
            commands::vault::create_world,
            commands::vault::open_world,
            commands::vault::delete_world,
            commands::vault::update_world_meta,
            commands::vault::list_items,
            commands::vault::create_item,
            commands::vault::rename_item,
            commands::vault::move_item,
            commands::vault::delete_item,
            commands::vault::restore_item,
            commands::vault::delete_item_permanent,
            commands::vault::empty_trash,
            commands::vault::export_world,
            commands::vault::import_world,
            commands::vault::get_item_content,
            commands::vault::update_item_content,
            commands::vault::attach_context_doc,
            commands::vault::detach_context_doc,
            commands::vault::list_attached_docs,
            commands::conversation::load_messages,
            commands::conversation::load_story_messages,
            commands::conversation::send_message,
            commands::conversation::cancel_generation,
            commands::conversation::edit_user_message,
            commands::conversation::update_message_content,
            commands::conversation::regenerate_last_response,
            commands::conversation::delete_exchange,
            commands::conversation::delete_from,
            commands::conversation::update_feedback,
            commands::conversation::get_token_count,
            commands::conversation::get_draft,
            commands::conversation::save_draft,
            commands::conversation::clear_draft,
            commands::modes::list_sessions,
            commands::modes::start_handover_session,
            commands::modes::start_consulting_session,
            commands::modes::enter_session,
            commands::modes::exit_session,
            commands::modes::send_session_message,
            commands::modes::cancel_session_generation,
            commands::modes::rename_session,
            commands::modes::delete_session,
            commands::modes::set_session_collapsed,
            commands::modes::get_story_active_mode,
            commands::modes::set_story_active_mode,
            commands::cache::get_cache_state,
            commands::cache::create_story_cache,
            commands::cache::delete_story_cache,
            commands::cache::list_alive_caches,
            commands::cache::get_session_cache_state,
            commands::accordion::get_accordion_state,
            commands::accordion::create_checkpoint,
            commands::accordion::rename_checkpoint,
            commands::accordion::delete_checkpoint,
            commands::accordion::update_segment_summary,
            commands::accordion::set_segment_collapsed,
            commands::accordion::set_segment_use_summary,
            commands::accordion::clear_segment_summary,
            commands::accordion::summarise_segment,
            commands::ghostwriter::send_ghostwriter_request,
            commands::ghostwriter::cancel_ghostwriter_generation,
            commands::ghostwriter::save_ghostwriter_edit,
            commands::ghostwriter::revert_ghostwriter_edit,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Subscriber install (Doc 24 §Logging). Pretty in dev, JSON in release.
/// Field redaction is enforced at call sites (never log key/content); this
/// just wires the formatter and the env-filter.
fn init_tracing() {
    use tracing_subscriber::{fmt, prelude::*, EnvFilter};

    // Default to `info` for our crate, `warn` for everything else, unless
    // RUST_LOG is set explicitly.
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("warn,loom_app_lib=info"));

    #[cfg(debug_assertions)]
    let layer = fmt::layer().with_target(true).with_line_number(true);
    #[cfg(not(debug_assertions))]
    let layer = fmt::layer().json().with_current_span(true);

    let _ = tracing_subscriber::registry()
        .with(filter)
        .with(layer)
        .try_init();
}
