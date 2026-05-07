use serde::Serialize;
use ts_rs::TS;

/// Single error type for every Tauri command (Doc 05 §LoomError).
/// Eleven variants — adding a twelfth requires a Doc 05 amendment.
#[derive(Debug, thiserror::Error, Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export, export_to = "../src/lib/types.ts")]
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
#[ts(export, export_to = "../src/lib/types.ts")]
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
