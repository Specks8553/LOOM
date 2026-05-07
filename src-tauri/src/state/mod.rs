//! AppState (Doc 05 §AppState) — security-sensitive and connection state only.
//!
//! Direct `.lock()` calls on these fields outside `state::access` are forbidden
//! by Doc 24 §AppState Access (SB-5). Use the `with_*` helper family.

use std::sync::Mutex;

use rusqlite::Connection;
use tokio_util::sync::CancellationToken;

pub mod access;

/// Lock-acquisition order (acquire in this order when holding multiple):
/// `master_key` → `api_key` → `settings_conn` → `active_conn` → `active_world_id` → `cancel_tx`.
pub struct AppState {
    pub master_key: Mutex<Option<[u8; 32]>>,
    pub api_key: Mutex<Option<String>>,
    pub settings_conn: Mutex<Option<Connection>>,
    pub active_conn: Mutex<Option<Connection>>,
    pub active_world_id: Mutex<Option<String>>,
    /// Per-request cancellation token (SB-4). Replaced atomically on each new
    /// cancellable operation; cancel of an old token is a no-op on the new one.
    pub cancel_tx: Mutex<Option<CancellationToken>>,
    /// App-phase machine; backed by the frontend `appStore`. Set by auth
    /// commands and (in dev only) by `dev_set_app_phase`.
    pub app_phase: Mutex<crate::AppPhase>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            master_key: Mutex::new(None),
            api_key: Mutex::new(None),
            settings_conn: Mutex::new(None),
            active_conn: Mutex::new(None),
            active_world_id: Mutex::new(None),
            cancel_tx: Mutex::new(None),
            app_phase: Mutex::new(crate::AppPhase::Onboarding),
        }
    }
}
