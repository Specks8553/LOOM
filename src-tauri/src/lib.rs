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
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::app_phase::get_app_phase,
            commands::app_phase::dev_set_app_phase,
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
