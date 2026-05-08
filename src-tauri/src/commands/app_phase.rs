//! App-phase shell commands (Phase 0 substrate).
//!
//! `get_app_phase` is read-only and always available. `dev_set_app_phase` is
//! gated on `cfg(debug_assertions)` so the frontend can drive transitions
//! before Auth (Phase 1) wires up the real lock/unlock flow.

use tauri::State;
use tracing::info;

use crate::error::LoomError;
use crate::state::{access, AppState};
use crate::AppPhase;

#[tauri::command]
pub fn get_app_phase(state: State<'_, AppState>) -> Result<AppPhase, LoomError> {
    access::read_app_phase(&state)
}

/// Dev-only phase driver. In release builds this is a `Forbidden` no-op so
/// the surface stays present for the IPC contract but cannot be abused.
#[tauri::command]
pub fn dev_set_app_phase(state: State<'_, AppState>, phase: AppPhase) -> Result<(), LoomError> {
    if !cfg!(debug_assertions) {
        return Err(LoomError::Forbidden(
            "dev_set_app_phase is disabled in release builds".into(),
        ));
    }
    info!(?phase, "dev_set_app_phase");
    access::set_app_phase(&state, phase)
}
