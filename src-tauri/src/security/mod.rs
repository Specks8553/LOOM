//! Crypto + sentinel (Doc 05 §security). Phase 0 stub — bodies land in Phase 1
//! (Auth & Onboarding, Doc 13).
//!
//! `security/` may import only the crypto crates (`rand`, `pbkdf2`, `aes-gcm`,
//! `zeroize`) — never any other LOOM module.
