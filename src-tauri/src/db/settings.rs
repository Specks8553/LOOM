//! Typed setting accessors (SB-1 / Doc 24 §Settings Access).
//!
//! The **only** place in the codebase that may run a `SELECT ... FROM
//! app_settings` or `SELECT ... FROM story_state` query — call-site discipline
//! enforced by Doc 24's grep gate.

use std::str::FromStr;

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::{LoomError, ValidationKind};
use crate::services::settings_keys::{AppSettingKey, StoryStateKey};

/// Trait for converting a raw setting string into a typed value. Every
/// concrete return type implements this — no generic FromStr blanket so we
/// can keep error mapping under our control.
pub trait FromSettingValue: Sized {
    fn from_setting_value(raw: &str, key: &'static str) -> Result<Self, LoomError>;
}

impl FromSettingValue for String {
    fn from_setting_value(raw: &str, _key: &'static str) -> Result<Self, LoomError> {
        Ok(raw.to_string())
    }
}

macro_rules! impl_from_setting_via_fromstr {
    ($($t:ty),*) => {$(
        impl FromSettingValue for $t {
            fn from_setting_value(raw: &str, key: &'static str) -> Result<Self, LoomError> {
                <$t as FromStr>::from_str(raw).map_err(|_| LoomError::Validation {
                    validation_kind: ValidationKind::InvalidSettingValue,
                    key: Some(key.into()),
                    reason: format!("could not parse '{raw}' as {}", stringify!($t)),
                })
            }
        }
    )*};
}

impl_from_setting_via_fromstr!(u32, u64, i32, i64, f32, f64, bool);

/// Read an app-settings value. Returns the stored value if present, the
/// hardcoded `default_value()` otherwise.
pub fn get_app_setting<T: FromSettingValue>(
    conn: &Connection,
    key: AppSettingKey,
) -> Result<T, LoomError> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params![key.as_str()],
            |row| row.get(0),
        )
        .optional()?;
    let raw = raw.unwrap_or_else(|| key.default_value().to_string());
    T::from_setting_value(&raw, key.as_str())
}

/// Write an app-settings value (UPSERT).
pub fn set_app_setting(
    conn: &Connection,
    key: AppSettingKey,
    value: &str,
) -> Result<(), LoomError> {
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key.as_str(), value],
    )?;
    Ok(())
}

/// Read a per-story state value, falling back to the key's `default_value()`.
pub fn get_story_state<T: FromSettingValue>(
    conn: &Connection,
    story_id: &str,
    key: StoryStateKey,
) -> Result<T, LoomError> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM story_state WHERE story_id = ?1 AND key = ?2",
            params![story_id, key.as_str()],
            |row| row.get(0),
        )
        .optional()?;
    let raw = raw.unwrap_or_else(|| key.default_value().to_string());
    T::from_setting_value(&raw, key.as_str())
}

/// Write a per-story state value (UPSERT).
pub fn set_story_state(
    conn: &Connection,
    story_id: &str,
    key: StoryStateKey,
    value: &str,
) -> Result<(), LoomError> {
    conn.execute(
        "INSERT INTO story_state (story_id, key, value) VALUES (?1, ?2, ?3)
         ON CONFLICT(story_id, key) DO UPDATE SET value = excluded.value",
        params![story_id, key.as_str(), value],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::{apply_pending, MigrationRoot};

    fn fresh_app_db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        apply_pending(&mut c, MigrationRoot::App).unwrap();
        c
    }

    fn fresh_world_db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        apply_pending(&mut c, MigrationRoot::World).unwrap();
        // Seed a story row so story_state writes don't violate the FK.
        c.execute(
            "INSERT INTO items (id, item_type, name, created_at, modified_at)
             VALUES ('s1', 'Story', 'Test', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        c
    }

    #[test]
    fn app_setting_default_when_unset() {
        let c = fresh_app_db();
        let v: String = get_app_setting(&c, AppSettingKey::TextModelName).unwrap();
        assert_eq!(v, "gemini-2.5-flash");
    }

    #[test]
    fn app_setting_round_trip_string() {
        let c = fresh_app_db();
        set_app_setting(&c, AppSettingKey::TextModelName, "gemini-3").unwrap();
        let v: String = get_app_setting(&c, AppSettingKey::TextModelName).unwrap();
        assert_eq!(v, "gemini-3");
    }

    #[test]
    fn app_setting_round_trip_typed_numeric() {
        let c = fresh_app_db();
        set_app_setting(&c, AppSettingKey::CacheTtlSecs, "7200").unwrap();
        let v: u32 = get_app_setting(&c, AppSettingKey::CacheTtlSecs).unwrap();
        assert_eq!(v, 7200);
    }

    #[test]
    fn app_setting_invalid_value_returns_validation_error() {
        let c = fresh_app_db();
        set_app_setting(&c, AppSettingKey::CacheTtlSecs, "not-a-number").unwrap();
        let err = get_app_setting::<u32>(&c, AppSettingKey::CacheTtlSecs).unwrap_err();
        match err {
            LoomError::Validation { validation_kind, key, .. } => {
                assert!(matches!(validation_kind, ValidationKind::InvalidSettingValue));
                assert_eq!(key.as_deref(), Some("cache_ttl_secs"));
            }
            other => panic!("expected Validation, got {other:?}"),
        }
    }

    #[test]
    fn story_state_round_trip() {
        let c = fresh_world_db();
        let v: String = get_story_state(&c, "s1", StoryStateKey::ActiveMode).unwrap();
        assert_eq!(v, "story"); // default
        set_story_state(&c, "s1", StoryStateKey::ActiveMode, "consulting").unwrap();
        let v: String = get_story_state(&c, "s1", StoryStateKey::ActiveMode).unwrap();
        assert_eq!(v, "consulting");
    }
}
