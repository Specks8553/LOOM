//! Settings cascade (Doc 05 §services/settings.rs).
//!
//! Cascade order per Doc 03 §`settings`: **world override → `app_settings` →
//! hardcoded `default_value()`**. Beyond the resolver this module owns the
//! merged `ResolvedSettings` payload, the per-key validators (Doc 20
//! §Validation — single source of truth, mirrored to the frontend over IPC),
//! and the tab→keys map used by `clear_all_world_overrides_in_tab`.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::settings::{get_app_setting, get_world_setting, FromSettingValue};
use crate::error::{LoomError, ValidationKind};
use crate::services::ghostwriter::DEFAULT_GHOSTWRITER_SI;
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

/// Merged settings cascade returned by `get_resolved_settings` (Doc 03
/// §`ResolvedSettings`). The frontend never performs cascade logic — it
/// consumes this object directly (theme, runtime gen params, telemetry-tab
/// ceilings).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/lib/types.ts")]
pub struct ResolvedSettings {
    // Gemini
    pub text_model_name: String,
    pub gen_temperature: f64,
    pub gen_top_p: f64,
    pub gen_top_k: u32,
    pub gen_max_output_tokens: u32,
    pub gen_summarise_temperature: f64,
    pub gen_summarise_top_p: f64,
    pub gen_summarise_top_k: u32,
    pub gen_summarise_max_output_tokens: u32,
    pub cache_ttl_secs: u32,
    pub cache_min_tokens: u32,
    pub context_token_limit: u32,
    // Theme
    pub accent_color: String,
    pub body_font: String,
    pub bubble_user_color: String,
    pub bubble_ai_color: String,
    pub ghostwriter_color: String,
    pub accordion_color: String,
    pub checkpoint_color: String,
    pub feedback_color: String,
    // System Instructions
    pub story_si: String,
    pub handover_si: String,
    pub consulting_si: String,
    pub aux_slot_1_name: String,
    pub aux_slot_1_content: String,
    pub aux_slot_2_name: String,
    pub aux_slot_2_content: String,
    // App-only (world cannot override)
    pub has_api_key: bool,
    pub auto_lock_secs: u32,
    pub rate_limit_rpm: u32,
    pub rate_limit_tpm: u32,
    pub rate_limit_rpd: u32,
}

/// Resolve the full settings cascade into a single payload.
pub fn resolve_all(
    world_conn: &Connection,
    app_conn: &Connection,
) -> Result<ResolvedSettings, LoomError> {
    use AppSettingKey as K;
    let api_key: String = get_app_setting(app_conn, K::ApiKey)?;
    Ok(ResolvedSettings {
        text_model_name: resolve(world_conn, app_conn, K::TextModelName)?,
        gen_temperature: resolve(world_conn, app_conn, K::GenTemperature)?,
        gen_top_p: resolve(world_conn, app_conn, K::GenTopP)?,
        gen_top_k: resolve(world_conn, app_conn, K::GenTopK)?,
        gen_max_output_tokens: resolve(world_conn, app_conn, K::GenMaxOutputTokens)?,
        gen_summarise_temperature: resolve(world_conn, app_conn, K::GenSummariseTemperature)?,
        gen_summarise_top_p: resolve(world_conn, app_conn, K::GenSummariseTopP)?,
        gen_summarise_top_k: resolve(world_conn, app_conn, K::GenSummariseTopK)?,
        gen_summarise_max_output_tokens: resolve(
            world_conn,
            app_conn,
            K::GenSummariseMaxOutputTokens,
        )?,
        cache_ttl_secs: resolve(world_conn, app_conn, K::CacheTtlSecs)?,
        cache_min_tokens: resolve(world_conn, app_conn, K::CacheMinTokens)?,
        context_token_limit: resolve(world_conn, app_conn, K::ContextTokenLimit)?,
        accent_color: resolve(world_conn, app_conn, K::AccentColor)?,
        body_font: resolve(world_conn, app_conn, K::BodyFont)?,
        bubble_user_color: resolve(world_conn, app_conn, K::BubbleUserColor)?,
        bubble_ai_color: resolve(world_conn, app_conn, K::BubbleAiColor)?,
        ghostwriter_color: resolve(world_conn, app_conn, K::GhostwriterColor)?,
        accordion_color: resolve(world_conn, app_conn, K::AccordionColor)?,
        checkpoint_color: resolve(world_conn, app_conn, K::CheckpointColor)?,
        feedback_color: resolve(world_conn, app_conn, K::FeedbackColor)?,
        story_si: resolve(world_conn, app_conn, K::StorySi)?,
        handover_si: resolve(world_conn, app_conn, K::HandoverSi)?,
        consulting_si: resolve(world_conn, app_conn, K::ConsultingSi)?,
        aux_slot_1_name: resolve(world_conn, app_conn, K::AuxSlot1Name)?,
        aux_slot_1_content: resolve(world_conn, app_conn, K::AuxSlot1Content)?,
        aux_slot_2_name: resolve(world_conn, app_conn, K::AuxSlot2Name)?,
        aux_slot_2_content: resolve(world_conn, app_conn, K::AuxSlot2Content)?,
        has_api_key: !api_key.is_empty(),
        auto_lock_secs: get_app_setting(app_conn, K::AutoLockSecs)?,
        rate_limit_rpm: get_app_setting(app_conn, K::RateLimitRpm)?,
        rate_limit_tpm: get_app_setting(app_conn, K::RateLimitTpm)?,
        rate_limit_rpd: get_app_setting(app_conn, K::RateLimitRpd)?,
    })
}

/// App-only resolution when no world is open — every world-overridable field
/// resolves straight to its `app_settings` value (the App phase becomes
/// `workspace` before a world is picked; Doc 20 §applyTheme trigger 1).
pub fn resolve_all_app_only(app_conn: &Connection) -> Result<ResolvedSettings, LoomError> {
    use AppSettingKey as K;
    let g = |k: K| get_app_setting::<String>(app_conn, k);
    let n = |k: K| get_app_setting::<u32>(app_conn, k);
    let f = |k: K| get_app_setting::<f64>(app_conn, k);
    let api_key = g(K::ApiKey)?;
    Ok(ResolvedSettings {
        text_model_name: g(K::TextModelName)?,
        gen_temperature: f(K::GenTemperature)?,
        gen_top_p: f(K::GenTopP)?,
        gen_top_k: n(K::GenTopK)?,
        gen_max_output_tokens: n(K::GenMaxOutputTokens)?,
        gen_summarise_temperature: f(K::GenSummariseTemperature)?,
        gen_summarise_top_p: f(K::GenSummariseTopP)?,
        gen_summarise_top_k: n(K::GenSummariseTopK)?,
        gen_summarise_max_output_tokens: n(K::GenSummariseMaxOutputTokens)?,
        cache_ttl_secs: n(K::CacheTtlSecs)?,
        cache_min_tokens: n(K::CacheMinTokens)?,
        context_token_limit: n(K::ContextTokenLimit)?,
        accent_color: g(K::AccentColor)?,
        body_font: g(K::BodyFont)?,
        bubble_user_color: g(K::BubbleUserColor)?,
        bubble_ai_color: g(K::BubbleAiColor)?,
        ghostwriter_color: g(K::GhostwriterColor)?,
        accordion_color: g(K::AccordionColor)?,
        checkpoint_color: g(K::CheckpointColor)?,
        feedback_color: g(K::FeedbackColor)?,
        story_si: g(K::StorySi)?,
        handover_si: g(K::HandoverSi)?,
        consulting_si: g(K::ConsultingSi)?,
        aux_slot_1_name: g(K::AuxSlot1Name)?,
        aux_slot_1_content: g(K::AuxSlot1Content)?,
        aux_slot_2_name: g(K::AuxSlot2Name)?,
        aux_slot_2_content: g(K::AuxSlot2Content)?,
        has_api_key: !api_key.is_empty(),
        auto_lock_secs: n(K::AutoLockSecs)?,
        rate_limit_rpm: n(K::RateLimitRpm)?,
        rate_limit_tpm: n(K::RateLimitTpm)?,
        rate_limit_rpd: n(K::RateLimitRpd)?,
    })
}

fn invalid(key: AppSettingKey, reason: impl Into<String>) -> LoomError {
    LoomError::Validation {
        validation_kind: ValidationKind::InvalidSettingValue,
        key: Some(key.as_str().to_owned()),
        reason: reason.into(),
    }
}

/// True for an empty string or a `#rgb` / `#rrggbb` hex colour.
fn is_blank_or_hex(value: &str) -> bool {
    if value.is_empty() {
        return true;
    }
    let Some(rest) = value.strip_prefix('#') else {
        return false;
    };
    (rest.len() == 3 || rest.len() == 6) && rest.chars().all(|c| c.is_ascii_hexdigit())
}

fn check_f64(key: AppSettingKey, value: &str, lo: f64, hi: f64) -> Result<(), LoomError> {
    let n: f64 = value
        .parse()
        .map_err(|_| invalid(key, format!("'{value}' is not a number")))?;
    if !(lo..=hi).contains(&n) {
        return Err(invalid(key, format!("must be between {lo} and {hi}")));
    }
    Ok(())
}

fn check_u32(key: AppSettingKey, value: &str, lo: u32, hi: u32) -> Result<(), LoomError> {
    let n: u32 = value
        .parse()
        .map_err(|_| invalid(key, format!("'{value}' is not a whole number")))?;
    if !(lo..=hi).contains(&n) {
        return Err(invalid(key, format!("must be between {lo} and {hi}")));
    }
    Ok(())
}

/// Validate a setting value before persisting (Doc 20 §Validation). The same
/// rules run on the frontend for inline UX; this is defense in depth.
///
/// `api_key` is rejected here — it has a dedicated `set_api_key` command so it
/// never flows through the generic settings write path.
pub fn validate_setting(key: AppSettingKey, value: &str) -> Result<(), LoomError> {
    use AppSettingKey as K;
    match key {
        K::ApiKey => Err(invalid(key, "API key must be set via set_api_key")),
        K::TextModelName => {
            if value.trim().is_empty() {
                Err(invalid(key, "model name cannot be empty"))
            } else {
                Ok(())
            }
        }
        K::GenTemperature | K::GenSummariseTemperature => check_f64(key, value, 0.0, 2.0),
        K::GenTopP | K::GenSummariseTopP => check_f64(key, value, 0.0, 1.0),
        K::GenTopK | K::GenSummariseTopK => check_u32(key, value, 1, 100),
        K::GenMaxOutputTokens | K::GenSummariseMaxOutputTokens => check_u32(key, value, 1, 32_768),
        K::CacheTtlSecs => check_u32(key, value, 60, 86_400),
        K::CacheMinTokens => check_u32(key, value, 0, 10_000_000),
        K::ContextTokenLimit => check_u32(key, value, 1, 10_000_000),
        K::AutoLockSecs => check_u32(key, value, 60, 86_400),
        K::RateLimitRpm | K::RateLimitRpd => check_u32(key, value, 1, 100_000),
        K::RateLimitTpm => check_u32(key, value, 1, 100_000_000),
        K::AccentColor => {
            if value.is_empty() {
                Err(invalid(key, "accent colour cannot be empty"))
            } else if is_blank_or_hex(value) {
                Ok(())
            } else {
                Err(invalid(key, "must be a hex colour like #6b9f78"))
            }
        }
        K::BubbleUserColor
        | K::BubbleAiColor
        | K::GhostwriterColor
        | K::CheckpointColor
        | K::AccordionColor
        | K::FeedbackColor => {
            if is_blank_or_hex(value) {
                Ok(())
            } else {
                Err(invalid(key, "must be empty or a hex colour like #f59e0b"))
            }
        }
        K::InlineContextFallback => {
            if value == "true" || value == "false" {
                Ok(())
            } else {
                Err(invalid(key, "must be 'true' or 'false'"))
            }
        }
        K::ImgGenDefaultWidth | K::ImgGenDefaultHeight => check_u32(key, value, 1, 8_192),
        // Free-text keys — body font, SIs, aux slots, internal prompts,
        // provider ids. No structural constraint.
        K::BodyFont
        | K::ImgGenProviderId
        | K::TtsModelName
        | K::StorySi
        | K::HandoverSi
        | K::ConsultingSi
        | K::AuxSlot1Name
        | K::AuxSlot1Content
        | K::AuxSlot2Name
        | K::AuxSlot2Content
        | K::PromptGhostwriter
        | K::PromptAccordionSummarise
        | K::PromptAccordionFakeUser
        | K::PromptHandoverSeed
        | K::PromptConsultingSeed => Ok(()),
    }
}

/// Keys belonging to a World-chapter Settings tab (Doc 20 §World Chapter
/// Tabs). Drives `clear_all_world_overrides_in_tab`. Returns an empty slice
/// for an unknown tab or a tab with no setting keys (e.g. `templates`).
pub fn world_tab_keys(tab: &str) -> &'static [AppSettingKey] {
    use AppSettingKey as K;
    match tab {
        "appearance" => &[K::AccentColor, K::BodyFont],
        "gemini" => &[
            K::TextModelName,
            K::GenTemperature,
            K::GenTopP,
            K::GenTopK,
            K::GenMaxOutputTokens,
            K::GenSummariseTemperature,
            K::GenSummariseTopP,
            K::GenSummariseTopK,
            K::GenSummariseMaxOutputTokens,
            K::CacheTtlSecs,
            K::CacheMinTokens,
            K::ContextTokenLimit,
        ],
        "system_instructions" => &[K::StorySi, K::HandoverSi, K::ConsultingSi],
        "features" => &[K::GhostwriterColor, K::AccordionColor, K::FeedbackColor],
        _ => &[],
    }
}

/// Hardcoded baseline written by `restore_prompt_default` (Doc 20 §Developer,
/// §System Instructions). Only `prompt_ghostwriter` ships a real baseline
/// constant; the accordion prompts and the mode SIs use the empty string,
/// which the resolver treats as "use the built-in behaviour".
pub fn prompt_baseline(key: AppSettingKey) -> &'static str {
    match key {
        AppSettingKey::PromptGhostwriter => DEFAULT_GHOSTWRITER_SI,
        other => other.default_value(),
    }
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

    #[test]
    fn resolve_all_returns_defaults_on_fresh_dbs() {
        let world = fresh_world();
        let app = fresh_app();
        let r = resolve_all(&world, &app).unwrap();
        assert_eq!(r.text_model_name, "gemini-2.5-flash");
        assert_eq!(r.gen_temperature, 1.0);
        assert_eq!(r.accent_color, "#6b9f78");
        assert_eq!(r.feedback_color, "#f59e0b");
        assert!(r.ghostwriter_color.is_empty());
        assert!(!r.has_api_key);
    }

    #[test]
    fn validator_accepts_in_range_and_rejects_out_of_range() {
        assert!(validate_setting(AppSettingKey::GenTemperature, "1.5").is_ok());
        assert!(validate_setting(AppSettingKey::GenTemperature, "2.5").is_err());
        assert!(validate_setting(AppSettingKey::GenTopK, "40").is_ok());
        assert!(validate_setting(AppSettingKey::GenTopK, "0").is_err());
        assert!(validate_setting(AppSettingKey::AccentColor, "#abc").is_ok());
        assert!(validate_setting(AppSettingKey::AccentColor, "#6b9f78").is_ok());
        assert!(validate_setting(AppSettingKey::AccentColor, "purple").is_err());
        assert!(validate_setting(AppSettingKey::AccentColor, "").is_err());
        // Feature colours may be empty (track-accent) or hex.
        assert!(validate_setting(AppSettingKey::GhostwriterColor, "").is_ok());
        assert!(validate_setting(AppSettingKey::GhostwriterColor, "#123456").is_ok());
        // API key never flows through the generic write path.
        assert!(validate_setting(AppSettingKey::ApiKey, "anything").is_err());
    }

    #[test]
    fn world_tab_keys_known_and_unknown() {
        assert_eq!(world_tab_keys("appearance").len(), 2);
        assert_eq!(world_tab_keys("features").len(), 3);
        assert!(world_tab_keys("templates").is_empty());
        assert!(world_tab_keys("nonsense").is_empty());
    }
}
