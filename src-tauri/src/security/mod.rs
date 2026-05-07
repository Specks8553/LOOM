//! Crypto + sentinel (Doc 05 §security).
//!
//! `security/` may import only the crypto crates (`rand`, `pbkdf2`, `aes-gcm`,
//! `zeroize`, `hex`) — never any other LOOM module except `crate::error`.

pub mod crypto;
pub mod sentinel;
