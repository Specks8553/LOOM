//! Settings cascade (Doc 05 §services/settings.rs).
//!
//! Cascade order per Doc 03 §`settings`: **world override → `app_settings` →
//! hardcoded `default_value()`**. Phase 3 only needs the resolver — the
//! per-key validators referenced by Doc 24 land in Phase 11 (Settings UI).

use rusqlite::Connection;

use crate::db::settings::{get_app_setting, get_world_setting, FromSettingValue};
use crate::error::LoomError;
use crate::services::settings_keys::AppSettingKey;

/// Resolve a setting using the world → app → default cascade.
///
/// `world_conn` is the active world's `loom.db`; `app_conn` is the
/// `app_settings.db`. The caller holds both via `with_two_conns`.
pub fn resolve<T: FromSettingValue>(
    world_conn: &Connection,
    app_conn: &Connection,
    key: AppSettingKey,
) -> Result<T, LoomError> {
    if let Some(raw) = get_world_setting(world_conn, key)? {
        if !raw.is_empty() {
            return T::from_setting_value(&raw, key.as_str());
        }
    }
    // No (or empty) world override → fall through to app_settings, which
    // itself falls through to the hardcoded default in db/settings.rs.
    get_app_setting(app_conn, key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::{apply_pending, MigrationRoot};
    use crate::db::settings::{set_app_setting, set_world_setting};

    fn fresh_app() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        apply_pending(&mut c, MigrationRoot::App).unwrap();
        c
    }

    fn fresh_world() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        apply_pending(&mut c, MigrationRoot::World).unwrap();
        c
    }

    #[test]
    fn cascade_falls_through_to_default_when_unset() {
        let world = fresh_world();
        let app = fresh_app();
        let v: String = resolve(&world, &app, AppSettingKey::TextModelName).unwrap();
        assert_eq!(v, "gemini-2.5-flash"); // default
    }

    #[test]
    fn cascade_returns_app_when_world_unset() {
        let world = fresh_world();
        let app = fresh_app();
        set_app_setting(&app, AppSettingKey::TextModelName, "gemini-3").unwrap();
        let v: String = resolve(&world, &app, AppSettingKey::TextModelName).unwrap();
        assert_eq!(v, "gemini-3");
    }

    #[test]
    fn cascade_world_override_beats_app_default() {
        let world = fresh_world();
        let app = fresh_app();
        set_app_setting(&app, AppSettingKey::TextModelName, "gemini-3").unwrap();
        set_world_setting(&world, AppSettingKey::TextModelName, "gemini-2.5-pro").unwrap();
        let v: String = resolve(&world, &app, AppSettingKey::TextModelName).unwrap();
        assert_eq!(v, "gemini-2.5-pro");
    }

    #[test]
    fn empty_world_override_falls_through() {
        let world = fresh_world();
        let app = fresh_app();
        set_app_setting(&app, AppSettingKey::TextModelName, "gemini-3").unwrap();
        // World value is the empty string — treated as "no override" so the
        // app value wins.
        set_world_setting(&world, AppSettingKey::TextModelName, "").unwrap();
        let v: String = resolve(&world, &app, AppSettingKey::TextModelName).unwrap();
        assert_eq!(v, "gemini-3");
    }
}
