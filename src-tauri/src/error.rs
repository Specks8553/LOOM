use serde::Serialize;
use ts_rs::TS;

/// Single error type for every Tauri command (Doc 05 §LoomError).
/// Eleven variants — adding a twelfth requires a Doc 05 amendment.
///
/// **Serde representation (HB-01).** Adjacently tagged — `{ "kind": …, "message": … }`.
/// The internally-tagged form (`#[serde(tag = "kind")]`) *cannot* serialize a
/// newtype variant wrapping a bare `String`; serde fails at runtime with
/// "cannot serialize tagged newtype variant …". Ten of these eleven variants
/// are newtype-of-`String`, so internal tagging silently broke the IPC error
/// contract. Adjacent tagging puts the payload under `message`: String variants
/// produce `{ "kind": "crypto", "message": "…" }`; the one struct variant
/// (`Validation`) produces `{ "kind": "validation", "message": { … } }`.
#[derive(Debug, thiserror::Error, Serialize, TS)]
#[serde(tag = "kind", content = "message", rename_all = "snake_case")]
#[ts(export, export_to = "../../src/lib/types.generated.ts")]
pub enum LoomError {
    #[error("Crypto error: {0}")]
    Crypto(String),

    #[error("Database error: {0}")]
    Database(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Validation error: {reason}")]
    Validation {
        validation_kind: ValidationKind,
        key: Option<String>,
        reason: String,
    },

    #[error("Forbidden: {0}")]
    Forbidden(String),

    #[error("API error: {0}")]
    ApiError(String),

    #[error("Cache create failed: {0}")]
    CacheCreate(String),

    #[error("Rate limited: {0}")]
    RateLimited(String),

    #[error("IO error: {0}")]
    Io(String),

    #[error("Serialization error: {0}")]
    Serialization(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

/// Structured discriminator for `LoomError::Validation` (Doc 05).
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../src/lib/types.generated.ts")]
pub enum ValidationKind {
    Generic,
    InvalidSettingValue,
    NoBaseline,
    ProtectedSentinel,
}

impl LoomError {
    /// Convenience for the most common validation shape.
    pub fn validation(reason: impl Into<String>) -> Self {
        Self::Validation {
            validation_kind: ValidationKind::Generic,
            key: None,
            reason: reason.into(),
        }
    }
}

impl From<rusqlite::Error> for LoomError {
    fn from(err: rusqlite::Error) -> Self {
        Self::Database(err.to_string())
    }
}

impl From<std::io::Error> for LoomError {
    fn from(err: std::io::Error) -> Self {
        Self::Io(err.to_string())
    }
}

impl From<serde_json::Error> for LoomError {
    fn from(err: serde_json::Error) -> Self {
        Self::Serialization(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    /// HB-01 contract: every variant must serialize to the adjacently-tagged
    /// `{ "kind", "message" }` shape the frontend consumes. Under the previous
    /// internally-tagged representation, the ten String variants failed here
    /// at runtime. This locks the contract so a regression fails CI.
    #[test]
    fn every_string_variant_serializes_to_kind_and_message() {
        let cases: Vec<(LoomError, &str)> = vec![
            (LoomError::Crypto("c".into()), "crypto"),
            (LoomError::Database("d".into()), "database"),
            (LoomError::NotFound("n".into()), "not_found"),
            (LoomError::Forbidden("f".into()), "forbidden"),
            (LoomError::ApiError("a".into()), "api_error"),
            (LoomError::CacheCreate("cc".into()), "cache_create"),
            (LoomError::RateLimited("r".into()), "rate_limited"),
            (LoomError::Io("io".into()), "io"),
            (LoomError::Serialization("s".into()), "serialization"),
            (LoomError::Internal("i".into()), "internal"),
        ];
        for (err, expected_kind) in cases {
            let v: Value = serde_json::to_value(&err)
                .unwrap_or_else(|e| panic!("serialize {expected_kind} failed: {e}"));
            assert_eq!(
                v.get("kind").and_then(Value::as_str),
                Some(expected_kind),
                "wrong kind for {expected_kind}: {v}"
            );
            assert!(
                v.get("message").and_then(Value::as_str).is_some(),
                "message must be a string for {expected_kind}: {v}"
            );
        }
    }

    /// The one struct variant nests its fields under `message`.
    #[test]
    fn validation_variant_serializes_with_nested_message() {
        let err = LoomError::Validation {
            validation_kind: ValidationKind::InvalidSettingValue,
            key: Some("accent_color".into()),
            reason: "must be a hex colour".into(),
        };
        let v: Value = serde_json::to_value(&err).expect("serialize validation failed");
        assert_eq!(v.get("kind").and_then(Value::as_str), Some("validation"));
        let msg = v.get("message").expect("message present");
        assert_eq!(
            msg.get("validation_kind").and_then(Value::as_str),
            Some("invalid_setting_value")
        );
        assert_eq!(msg.get("key").and_then(Value::as_str), Some("accent_color"));
        assert_eq!(
            msg.get("reason").and_then(Value::as_str),
            Some("must be a hex colour")
        );
    }
}
