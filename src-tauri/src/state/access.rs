//! Lock-access helpers (SB-5 / Doc 24 §AppState Access).
//!
//! These are the **only** call sites that may invoke `.lock()` on `AppState`
//! mutex fields. A grep for `state\.\w+_(?:conn|key|tx|id|phase)\.lock\(\)`
//! outside this file must return zero matches — CI grep gate enforces it.
//!
//! Each helper:
//!   1. Acquires the mutex (poison → `LoomError::Internal`).
//!   2. Unwraps the `Option` (None → `LoomError::Validation { reason }`).
//!   3. Hands a borrow to `f`, then drops the guard.
//!
//! Lock-ordering invariant (Doc 05 §AppState): when multiple guards are
//! required, acquire in the order declared on `AppState`. The `with_two_conns`
//! helper enforces this for the common settings + world pair.

use rusqlite::Connection;
use tokio_util::sync::CancellationToken;
use zeroize::Zeroize;

use crate::error::{LoomError, ValidationKind};
use crate::AppPhase;

use super::AppState;

/// Map a poisoned mutex to `Internal`.
fn poison<T>(_: std::sync::PoisonError<T>) -> LoomError {
    LoomError::Internal("mutex poisoned".into())
}

/// Map "vault locked / world not open" to a structured validation error.
fn missing(key: &str, reason: &str) -> LoomError {
    LoomError::Validation {
        validation_kind: ValidationKind::Generic,
        key: Some(key.into()),
        reason: reason.into(),
    }
}

pub fn with_active_conn<T>(
    state: &AppState,
    f: impl FnOnce(&Connection) -> Result<T, LoomError>,
) -> Result<T, LoomError> {
    let guard = state.active_conn.lock().map_err(poison)?;
    let conn = guard
        .as_ref()
        .ok_or_else(|| missing("active_conn", "no world is open"))?;
    f(conn)
}

pub fn with_settings_conn<T>(
    state: &AppState,
    f: impl FnOnce(&Connection) -> Result<T, LoomError>,
) -> Result<T, LoomError> {
    let guard = state.settings_conn.lock().map_err(poison)?;
    let conn = guard
        .as_ref()
        .ok_or_else(|| missing("settings_conn", "vault is locked"))?;
    f(conn)
}

pub fn with_master_key<T>(
    state: &AppState,
    f: impl FnOnce(&[u8; 32]) -> Result<T, LoomError>,
) -> Result<T, LoomError> {
    let guard = state.master_key.lock().map_err(poison)?;
    let key = guard
        .as_ref()
        .ok_or_else(|| missing("master_key", "vault is locked"))?;
    f(key)
}

pub fn with_api_key<T>(
    state: &AppState,
    f: impl FnOnce(&str) -> Result<T, LoomError>,
) -> Result<T, LoomError> {
    let guard = state.api_key.lock().map_err(poison)?;
    let key = guard
        .as_deref()
        .ok_or_else(|| missing("api_key", "API key not set"))?;
    f(key)
}

pub fn with_active_world_id<T>(
    state: &AppState,
    f: impl FnOnce(&str) -> Result<T, LoomError>,
) -> Result<T, LoomError> {
    let guard = state.active_world_id.lock().map_err(poison)?;
    let id = guard
        .as_deref()
        .ok_or_else(|| missing("active_world_id", "no world is open"))?;
    f(id)
}

pub fn with_two_conns<T>(
    state: &AppState,
    f: impl FnOnce(&Connection, &Connection) -> Result<T, LoomError>,
) -> Result<T, LoomError> {
    // Lock-ordering invariant: settings_conn before active_conn.
    let settings_guard = state.settings_conn.lock().map_err(poison)?;
    let settings = settings_guard
        .as_ref()
        .ok_or_else(|| missing("settings_conn", "vault is locked"))?;
    let active_guard = state.active_conn.lock().map_err(poison)?;
    let active = active_guard
        .as_ref()
        .ok_or_else(|| missing("active_conn", "no world is open"))?;
    f(settings, active)
}

/// Replace the master key, zeroing the previous value if present.
///
/// Pass `None` to clear (e.g. on lock). Pass `Some(new)` to install a freshly
/// derived key. Callers are responsible for zeroing their own stack copy of
/// `new` after this returns.
pub fn replace_master_key(state: &AppState, new: Option<[u8; 32]>) -> Result<(), LoomError> {
    let mut guard = state.master_key.lock().map_err(poison)?;
    if let Some(ref mut old) = *guard {
        old.zeroize();
    }
    *guard = new;
    Ok(())
}

/// Replace the API key, zeroing the previous value if present.
pub fn replace_api_key(state: &AppState, new: Option<String>) -> Result<(), LoomError> {
    let mut guard = state.api_key.lock().map_err(poison)?;
    if let Some(ref mut old) = *guard {
        old.zeroize();
    }
    *guard = new;
    Ok(())
}

/// Replace the app-settings DB connection. Drops (and thereby closes) the prior
/// connection if any.
pub fn replace_settings_conn(state: &AppState, new: Option<Connection>) -> Result<(), LoomError> {
    let mut guard = state.settings_conn.lock().map_err(poison)?;
    *guard = new;
    Ok(())
}

/// Replace the active world DB connection. Drops the prior connection if any.
pub fn replace_active_conn(state: &AppState, new: Option<Connection>) -> Result<(), LoomError> {
    let mut guard = state.active_conn.lock().map_err(poison)?;
    *guard = new;
    Ok(())
}

/// Replace the active world id.
pub fn replace_active_world_id(state: &AppState, new: Option<String>) -> Result<(), LoomError> {
    let mut guard = state.active_world_id.lock().map_err(poison)?;
    *guard = new;
    Ok(())
}

/// Read the current app phase.
pub fn read_app_phase(state: &AppState) -> Result<AppPhase, LoomError> {
    let guard = state.app_phase.lock().map_err(poison)?;
    Ok(*guard)
}

/// Set the app phase.
pub fn set_app_phase(state: &AppState, phase: AppPhase) -> Result<(), LoomError> {
    let mut guard = state.app_phase.lock().map_err(poison)?;
    *guard = phase;
    Ok(())
}

/// Install a fresh cancellation token, returning a clone for the worker.
/// Any previously-installed token is dropped; cancelling it after this point
/// is a no-op (SB-4 — Doc 05 §Cancellation Lifecycle).
pub fn install_cancel_token(state: &AppState) -> Result<CancellationToken, LoomError> {
    let token = CancellationToken::new();
    let mut guard = state.cancel_tx.lock().map_err(poison)?;
    *guard = Some(token.clone());
    Ok(token)
}

/// Signal cancellation on the currently-installed token, if any.
pub fn cancel_current(state: &AppState) -> Result<(), LoomError> {
    let guard = state.cancel_tx.lock().map_err(poison)?;
    if let Some(token) = guard.as_ref() {
        token.cancel();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn with_active_conn_returns_no_world_open_when_locked() {
        let state = AppState::default();
        let err = with_active_conn(&state, |_| Ok(())).unwrap_err();
        match err {
            LoomError::Validation { key, reason, .. } => {
                assert_eq!(key.as_deref(), Some("active_conn"));
                assert!(reason.contains("no world is open"));
            }
            other => panic!("expected Validation, got {other:?}"),
        }
    }

    #[test]
    fn with_settings_conn_returns_vault_locked_when_unset() {
        let state = AppState::default();
        let err = with_settings_conn(&state, |_| Ok(())).unwrap_err();
        match err {
            LoomError::Validation { key, reason, .. } => {
                assert_eq!(key.as_deref(), Some("settings_conn"));
                assert!(reason.contains("vault is locked"));
            }
            other => panic!("expected Validation, got {other:?}"),
        }
    }

    #[test]
    fn with_master_key_returns_vault_locked_when_unset() {
        let state = AppState::default();
        let err = with_master_key(&state, |_| Ok(())).unwrap_err();
        assert!(matches!(err, LoomError::Validation { .. }));
    }

    #[test]
    fn install_then_cancel_marks_token_cancelled() {
        let state = AppState::default();
        let token = install_cancel_token(&state).unwrap();
        assert!(!token.is_cancelled());
        cancel_current(&state).unwrap();
        assert!(token.is_cancelled());
    }

    #[test]
    fn new_token_supersedes_old_one() {
        let state = AppState::default();
        let first = install_cancel_token(&state).unwrap();
        let second = install_cancel_token(&state).unwrap();
        cancel_current(&state).unwrap();
        // Cancel hits the *current* token, which is `second`. The first is
        // already dropped from state and unaffected.
        assert!(second.is_cancelled());
        assert!(!first.is_cancelled());
    }

    #[test]
    fn with_active_conn_runs_f_when_open() {
        let state = AppState::default();
        let conn = Connection::open_in_memory().unwrap();
        *state.active_conn.lock().unwrap() = Some(conn);
        let result: Result<i32, LoomError> = with_active_conn(&state, |c| {
            c.execute_batch("SELECT 1")?;
            Ok(7)
        });
        assert_eq!(result.unwrap(), 7);
    }
}
