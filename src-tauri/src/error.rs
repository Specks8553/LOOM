use serde::Serialize;

/// Single error type for all LOOM Tauri commands.
/// Every Tauri command returns `Result<T, LoomError>`.
#[derive(Debug, thiserror::Error)]
pub enum LoomError {
    // -- Crypto & Auth --
    #[error("Incorrect password.")]
    IncorrectPassword,

    #[error("No master key available. Vault is locked.")]
    VaultLocked,

    #[error("Key derivation failed: {0}")]
    KeyDerivation(String),

    // -- Config --
    #[error("App config not found.")]
    ConfigNotFound,

    #[error("App config is corrupted: {0}")]
    ConfigCorrupted(String),

    // -- Database --
    #[error("Database error: {0}")]
    Database(String),

    #[error("No active database connection.")]
    NoActiveConnection,

    // -- World --
    #[error("World not found: {0}")]
    WorldNotFound(String),

    #[error("World directory already exists: {0}")]
    WorldExists(String),

    // -- Vault --
    #[error("Item not found: {0}")]
    ItemNotFound(String),

    #[error("Invalid item type: {0}")]
    InvalidItemType(String),

    #[error("Maximum folder nesting depth (5) exceeded.")]
    MaxNestingDepth,

    // -- API --
    #[error("API key not configured.")]
    ApiKeyMissing,

    #[error("API request failed: {0}")]
    ApiRequest(String),

    #[error("Rate limit exceeded. Try again later.")]
    RateLimitExceeded,

    // -- Generation --
    #[error("Generation cancelled.")]
    GenerationCancelled,

    #[error("Generation already in progress.")]
    GenerationInProgress,

    // -- IO --
    #[error("File I/O error: {0}")]
    Io(String),

    #[error("Serialization error: {0}")]
    Serialization(String),

    // -- Generic --
    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

// Serialize for Tauri IPC — sends the error message as a string
impl Serialize for LoomError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

// From impls for common error types
impl From<std::io::Error> for LoomError {
    fn from(e: std::io::Error) -> Self {
        LoomError::Io(e.to_string())
    }
}

impl From<serde_json::Error> for LoomError {
    fn from(e: serde_json::Error) -> Self {
        LoomError::Serialization(e.to_string())
    }
}

impl From<rusqlite::Error> for LoomError {
    fn from(e: rusqlite::Error) -> Self {
        LoomError::Database(e.to_string())
    }
}

impl From<hex::FromHexError> for LoomError {
    fn from(e: hex::FromHexError) -> Self {
        LoomError::Internal(format!("Hex decode error: {}", e))
    }
}

impl From<aes_gcm::Error> for LoomError {
    fn from(_: aes_gcm::Error) -> Self {
        LoomError::IncorrectPassword
    }
}
