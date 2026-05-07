//! PBKDF2 key derivation and AES-256-GCM encryption primitives (Doc 02, Doc 13).
//!
//! This module may import only the crypto crates — never any other LOOM module.
//!
//! Key derivation parameters (Doc 02 §A6):
//!   - Algorithm:   PBKDF2-HMAC-SHA256
//!   - Iterations:  200 000
//!   - Salt:        32 random bytes (stored hex-encoded in app_config.json)
//!   - Output:      32 bytes (= AES-256 key)
//!
//! Encryption: AES-256-GCM
//!   - 12-byte random nonce per call
//!   - Authenticated; any tamper detected on decrypt

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use pbkdf2::pbkdf2_hmac;
use rand::{rngs::OsRng, RngCore};
use sha2::Sha256;

use crate::error::LoomError;

/// Iterations for PBKDF2 (Doc 02 §A6 — 200 000).
const PBKDF2_ITERS: u32 = 200_000;
/// Key output length in bytes (AES-256).
const KEY_LEN: usize = 32;
/// GCM nonce length.
const NONCE_LEN: usize = 12;

/// Derive a 32-byte master key from `password` and `salt` using PBKDF2-HMAC-SHA256.
///
/// The caller owns the returned array and is responsible for zeroing it after use.
pub fn derive_key(password: &str, salt: &[u8]) -> [u8; KEY_LEN] {
    let mut key = [0u8; KEY_LEN];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, PBKDF2_ITERS, &mut key);
    key
}

/// Generate a cryptographically random 32-byte salt.
pub fn generate_salt() -> [u8; 32] {
    let mut salt = [0u8; 32];
    OsRng.fill_bytes(&mut salt);
    salt
}

/// Encrypt `plaintext` with AES-256-GCM under `key`.
///
/// Returns `(nonce_bytes, ciphertext)`. The nonce is 12 random bytes generated
/// fresh per call; it must be stored alongside the ciphertext for decryption.
pub fn encrypt(
    key: &[u8; KEY_LEN],
    plaintext: &[u8],
) -> Result<([u8; NONCE_LEN], Vec<u8>), LoomError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| LoomError::Crypto(e.to_string()))?;

    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| LoomError::Crypto(e.to_string()))?;

    Ok((nonce_bytes, ciphertext))
}

/// Decrypt `ciphertext` with AES-256-GCM under `key` and `nonce`.
///
/// Returns `LoomError::Crypto` on authentication failure (wrong key, tampered data).
pub fn decrypt(
    key: &[u8; KEY_LEN],
    nonce: &[u8; NONCE_LEN],
    ciphertext: &[u8],
) -> Result<Vec<u8>, LoomError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| LoomError::Crypto(e.to_string()))?;
    let nonce = Nonce::from_slice(nonce);

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| LoomError::Crypto("Decryption failed — wrong key or corrupt data".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use zeroize::Zeroize;

    #[test]
    fn derive_key_is_deterministic() {
        let salt = [0xABu8; 32];
        let a = derive_key("hunter2", &salt);
        let b = derive_key("hunter2", &salt);
        assert_eq!(a, b);
    }

    #[test]
    fn different_passwords_produce_different_keys() {
        let salt = [0x01u8; 32];
        let a = derive_key("password1", &salt);
        let b = derive_key("password2", &salt);
        assert_ne!(a, b);
    }

    #[test]
    fn different_salts_produce_different_keys() {
        let a = derive_key("same-password", &[0x01u8; 32]);
        let b = derive_key("same-password", &[0x02u8; 32]);
        assert_ne!(a, b);
    }

    #[test]
    fn aes_gcm_round_trip() {
        let key = derive_key("test-password", &[0x42u8; 32]);
        let plaintext = b"Hello, LOOM!";
        let (nonce, ciphertext) = encrypt(&key, plaintext).expect("encrypt failed");
        let decrypted = decrypt(&key, &nonce, &ciphertext).expect("decrypt failed");
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn wrong_key_returns_crypto_error() {
        let key_a = derive_key("correct", &[0x01u8; 32]);
        let key_b = derive_key("wrong", &[0x01u8; 32]);
        let (nonce, ciphertext) = encrypt(&key_a, b"secret").expect("encrypt failed");
        let result = decrypt(&key_b, &nonce, &ciphertext);
        assert!(matches!(result, Err(LoomError::Crypto(_))));
    }

    #[test]
    fn corrupt_ciphertext_returns_crypto_error() {
        let key = derive_key("test", &[0x01u8; 32]);
        let (nonce, mut ciphertext) = encrypt(&key, b"data").expect("encrypt failed");
        ciphertext[0] ^= 0xFF; // flip a byte
        let result = decrypt(&key, &nonce, &ciphertext);
        assert!(matches!(result, Err(LoomError::Crypto(_))));
    }

    #[test]
    fn zero_length_plaintext_round_trips() {
        let key = derive_key("test", &[0xBBu8; 32]);
        let (nonce, ciphertext) = encrypt(&key, b"").expect("encrypt failed");
        let decrypted = decrypt(&key, &nonce, &ciphertext).expect("decrypt failed");
        assert_eq!(decrypted, b"");
    }

    #[test]
    fn generate_salt_is_random() {
        let a = generate_salt();
        let b = generate_salt();
        // Astronomically unlikely to collide
        assert_ne!(a, b);
    }

    #[test]
    fn key_can_be_zeroed() {
        let mut key = derive_key("test", &[0x01u8; 32]);
        key.zeroize();
        assert_eq!(key, [0u8; 32]);
    }
}
