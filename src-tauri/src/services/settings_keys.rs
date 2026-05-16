//! Typed setting keys (SB-1 / Doc 24 §Settings Access).
//!
//! Stringly-typed access to `app_settings` or `story_state` is forbidden —
//! all reads and writes go through these enums. Variant set mirrors Doc 03's
//! known-keys tables; adding a key happens in the same PR as the Doc 03 edit.

use serde::{Deserialize, Serialize};

/// Keys persisted in `app_settings.db` (Doc 03 §app_settings).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AppSettingKey {
    ApiKey,
    TextModelName,
    GenTemperature,
    GenTopP,
    GenTopK,
    GenMaxOutputTokens,
    GenSummariseTemperature,
    GenSummariseTopP,
    GenSummariseTopK,
    GenSummariseMaxOutputTokens,
    AccentColor,
    BodyFont,
    BubbleUserColor,
    BubbleAiColor,
    GhostwriterColor,
    CheckpointColor,
    AccordionColor,
    FeedbackColor,
    AutoLockSecs,
    RateLimitRpm,
    RateLimitTpm,
    RateLimitRpd,
    ContextTokenLimit,
    ImgGenProviderId,
    ImgGenDefaultWidth,
    ImgGenDefaultHeight,
    TtsModelName,
    CacheTtlSecs,
    CacheMinTokens,
    InlineContextFallback,
    StorySi,
    HandoverSi,
    ConsultingSi,
    AuxSlot1Name,
    AuxSlot1Content,
    AuxSlot2Name,
    AuxSlot2Content,
    PromptGhostwriter,
    PromptAccordionSummarise,
    PromptAccordionFakeUser,
    PromptHandoverSeed,
    PromptConsultingSeed,
}

/// Keys persisted in `story_state` (Doc 03 §story_state).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StoryStateKey {
    ContextDocIds,
    ActiveMode,
    ActiveSessionId,
    ActiveAuxSlot,
    Draft,
}

impl AppSettingKey {
    /// Canonical column key (the literal `app_settings.key` value).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ApiKey => "api_key",
            Self::TextModelName => "text_model_name",
            Self::GenTemperature => "gen_temperature",
            Self::GenTopP => "gen_top_p",
            Self::GenTopK => "gen_top_k",
            Self::GenMaxOutputTokens => "gen_max_output_tokens",
            Self::GenSummariseTemperature => "gen_summarise_temperature",
            Self::GenSummariseTopP => "gen_summarise_top_p",
            Self::GenSummariseTopK => "gen_summarise_top_k",
            Self::GenSummariseMaxOutputTokens => "gen_summarise_max_output_tokens",
            Self::AccentColor => "accent_color",
            Self::BodyFont => "body_font",
            Self::BubbleUserColor => "bubble_user_color",
            Self::BubbleAiColor => "bubble_ai_color",
            Self::GhostwriterColor => "ghostwriter_color",
            Self::CheckpointColor => "checkpoint_color",
            Self::AccordionColor => "accordion_color",
            Self::FeedbackColor => "feedback_color",
            Self::AutoLockSecs => "auto_lock_secs",
            Self::RateLimitRpm => "rate_limit_rpm",
            Self::RateLimitTpm => "rate_limit_tpm",
            Self::RateLimitRpd => "rate_limit_rpd",
            Self::ContextTokenLimit => "context_token_limit",
            Self::ImgGenProviderId => "img_gen_provider_id",
            Self::ImgGenDefaultWidth => "img_gen_default_width",
            Self::ImgGenDefaultHeight => "img_gen_default_height",
            Self::TtsModelName => "tts_model_name",
            Self::CacheTtlSecs => "cache_ttl_secs",
            Self::CacheMinTokens => "cache_min_tokens",
            Self::InlineContextFallback => "inline_context_fallback",
            Self::StorySi => "story_si",
            Self::HandoverSi => "handover_si",
            Self::ConsultingSi => "consulting_si",
            Self::AuxSlot1Name => "aux_slot_1_name",
            Self::AuxSlot1Content => "aux_slot_1_content",
            Self::AuxSlot2Name => "aux_slot_2_name",
            Self::AuxSlot2Content => "aux_slot_2_content",
            Self::PromptGhostwriter => "prompt_ghostwriter",
            Self::PromptAccordionSummarise => "prompt_accordion_summarise",
            Self::PromptAccordionFakeUser => "prompt_accordion_fake_user",
            Self::PromptHandoverSeed => "prompt_handover_seed",
            Self::PromptConsultingSeed => "prompt_consulting_seed",
        }
    }

    /// Hardcoded fallback per Doc 03's defaults column. The Developer-only
    /// long prompts have `""` here; their real baselines live in
    /// `services/<feature>/constants.rs` and are written to `app_settings`
    /// on first run via the seed migration / restore-default helpers.
    pub const fn default_value(self) -> &'static str {
        match self {
            Self::TextModelName => "gemini-2.5-flash",
            Self::GenTemperature => "1.0",
            Self::GenTopP => "0.95",
            Self::GenTopK => "40",
            Self::GenMaxOutputTokens => "8192",
            Self::GenSummariseTemperature => "0.3",
            Self::GenSummariseTopP => "0.95",
            Self::GenSummariseTopK => "40",
            Self::GenSummariseMaxOutputTokens => "2048",
            Self::AccentColor => "#7c3aed",
            Self::BodyFont => "serif",
            // Feedback uses a stable amber by default — it does not track
            // accent (Doc 28 / Doc 20 §Features).
            Self::FeedbackColor => "#f59e0b",
            Self::AutoLockSecs => "900",
            Self::RateLimitRpm => "10",
            Self::RateLimitTpm => "250000",
            Self::RateLimitRpd => "1500",
            Self::ContextTokenLimit => "128000",
            Self::ImgGenDefaultWidth => "1024",
            Self::ImgGenDefaultHeight => "1024",
            Self::CacheTtlSecs => "3600",
            Self::CacheMinTokens => "4096",
            Self::InlineContextFallback => "false",
            Self::AuxSlot1Name => "Slot 1",
            Self::AuxSlot2Name => "Slot 2",
            // Empty string defaults — keys that are populated at runtime or by user input.
            // The empty colour keys resolve in `applyTheme`: bubble colours
            // fall back to the CSS token default; ghostwriter / checkpoint /
            // accordion colours track the accent (Doc 20 §Theme System).
            Self::ApiKey
            | Self::ImgGenProviderId
            | Self::TtsModelName
            | Self::BubbleUserColor
            | Self::BubbleAiColor
            | Self::GhostwriterColor
            | Self::CheckpointColor
            | Self::AccordionColor
            | Self::StorySi
            | Self::HandoverSi
            | Self::ConsultingSi
            | Self::AuxSlot1Content
            | Self::AuxSlot2Content
            | Self::PromptGhostwriter
            | Self::PromptAccordionSummarise
            | Self::PromptAccordionFakeUser
            | Self::PromptHandoverSeed
            | Self::PromptConsultingSeed => "",
        }
    }

    /// Every `AppSettingKey` variant. Used to enumerate raw values for the
    /// Settings UI and to map column keys back to the typed enum.
    pub const ALL: &'static [AppSettingKey] = &[
        Self::ApiKey,
        Self::TextModelName,
        Self::GenTemperature,
        Self::GenTopP,
        Self::GenTopK,
        Self::GenMaxOutputTokens,
        Self::GenSummariseTemperature,
        Self::GenSummariseTopP,
        Self::GenSummariseTopK,
        Self::GenSummariseMaxOutputTokens,
        Self::AccentColor,
        Self::BodyFont,
        Self::BubbleUserColor,
        Self::BubbleAiColor,
        Self::GhostwriterColor,
        Self::CheckpointColor,
        Self::AccordionColor,
        Self::FeedbackColor,
        Self::AutoLockSecs,
        Self::RateLimitRpm,
        Self::RateLimitTpm,
        Self::RateLimitRpd,
        Self::ContextTokenLimit,
        Self::ImgGenProviderId,
        Self::ImgGenDefaultWidth,
        Self::ImgGenDefaultHeight,
        Self::TtsModelName,
        Self::CacheTtlSecs,
        Self::CacheMinTokens,
        Self::InlineContextFallback,
        Self::StorySi,
        Self::HandoverSi,
        Self::ConsultingSi,
        Self::AuxSlot1Name,
        Self::AuxSlot1Content,
        Self::AuxSlot2Name,
        Self::AuxSlot2Content,
        Self::PromptGhostwriter,
        Self::PromptAccordionSummarise,
        Self::PromptAccordionFakeUser,
        Self::PromptHandoverSeed,
        Self::PromptConsultingSeed,
    ];

    /// Parse a raw column key (the literal `app_settings.key` value) back into
    /// the typed enum. `None` for an unknown key — callers reject it as a
    /// validation error rather than silently accepting an untyped write.
    pub fn from_key_str(key: &str) -> Option<Self> {
        Self::ALL.iter().copied().find(|k| k.as_str() == key)
    }
}

impl StoryStateKey {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ContextDocIds => "context_doc_ids",
            Self::ActiveMode => "active_mode",
            Self::ActiveSessionId => "active_session_id",
            Self::ActiveAuxSlot => "active_aux_slot",
            Self::Draft => "draft",
        }
    }

    pub const fn default_value(self) -> &'static str {
        match self {
            Self::ContextDocIds => "[]",
            Self::ActiveMode => "story",
            Self::ActiveSessionId => "",
            Self::ActiveAuxSlot => "1",
            Self::Draft => "{}",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_setting_round_trip() {
        // Spot-check a representative variant.
        assert_eq!(AppSettingKey::CacheTtlSecs.as_str(), "cache_ttl_secs");
        assert_eq!(AppSettingKey::CacheTtlSecs.default_value(), "3600");
        assert_eq!(AppSettingKey::ApiKey.as_str(), "api_key");
        assert_eq!(AppSettingKey::ApiKey.default_value(), "");
    }

    #[test]
    fn story_state_round_trip() {
        assert_eq!(StoryStateKey::ActiveMode.as_str(), "active_mode");
        assert_eq!(StoryStateKey::ActiveMode.default_value(), "story");
        assert_eq!(StoryStateKey::ActiveSessionId.default_value(), "");
        assert_eq!(StoryStateKey::Draft.default_value(), "{}");
    }

    #[test]
    fn keys_unique() {
        // No duplicate `as_str()` values across AppSettingKey variants.
        let keys: Vec<&'static str> = AppSettingKey::ALL.iter().map(|k| k.as_str()).collect();
        let mut sorted = keys.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(
            keys.len(),
            sorted.len(),
            "duplicate AppSettingKey column keys"
        );
    }

    #[test]
    fn from_key_str_round_trips_every_variant() {
        for &k in AppSettingKey::ALL {
            assert_eq!(AppSettingKey::from_key_str(k.as_str()), Some(k));
        }
        assert_eq!(AppSettingKey::from_key_str("not_a_real_key"), None);
    }
}
