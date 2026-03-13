use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use pbkdf2::pbkdf2_hmac;
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use zeroize::Zeroize;

use crate::error::LoomError;

/// Known plaintext used for key verification sentinel.
const SENTINEL_PLAINTEXT: &[u8] = b"LOOM_KEY_CHECK";

/// AES-256-GCM encrypted sentinel stored in app_config.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SentinelData {
    pub nonce_hex: String,
    pub ciphertext_hex: String,
}

/// Derive a 32-byte key from password using PBKDF2-HMAC-SHA256.
pub fn derive_key(password: &str, salt: &[u8], iterations: u32) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, iterations, &mut key);
    key
}

/// Generate a random 32-byte salt.
pub fn generate_salt() -> [u8; 32] {
    rand::thread_rng().gen::<[u8; 32]>()
}

/// Create a new AES-256-GCM sentinel from the derived key.
pub fn create_sentinel(key: &[u8; 32]) -> Result<SentinelData, LoomError> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| LoomError::KeyDerivation(e.to_string()))?;
    let nonce_bytes: [u8; 12] = rand::thread_rng().gen();
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, SENTINEL_PLAINTEXT)
        .map_err(|e| LoomError::KeyDerivation(e.to_string()))?;
    Ok(SentinelData {
        nonce_hex: hex::encode(nonce_bytes),
        ciphertext_hex: hex::encode(ciphertext),
    })
}

/// Verify the derived key against a stored sentinel.
/// Returns true if the key is correct.
pub fn verify_sentinel(key: &[u8; 32], sentinel: &SentinelData) -> bool {
    let cipher = match Aes256Gcm::new_from_slice(key) {
        Ok(c) => c,
        Err(_) => return false,
    };
    let nonce_bytes = match hex::decode(&sentinel.nonce_hex) {
        Ok(b) => b,
        Err(_) => return false,
    };
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = match hex::decode(&sentinel.ciphertext_hex) {
        Ok(b) => b,
        Err(_) => return false,
    };
    cipher.decrypt(nonce, ciphertext.as_ref()).is_ok()
}

/// Zero out a 32-byte key in memory.
pub fn zero_key(key: &mut [u8; 32]) {
    key.zeroize();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_derive_key_deterministic() {
        let salt = [0u8; 32];
        let key1 = derive_key("testpass", &salt, 1000);
        let key2 = derive_key("testpass", &salt, 1000);
        assert_eq!(key1, key2);
    }

    #[test]
    fn test_derive_key_different_passwords() {
        let salt = [0u8; 32];
        let key1 = derive_key("pass1", &salt, 1000);
        let key2 = derive_key("pass2", &salt, 1000);
        assert_ne!(key1, key2);
    }

    #[test]
    fn test_sentinel_roundtrip() {
        let key = derive_key("testpass123", &generate_salt(), 1000);
        let sentinel = create_sentinel(&key).unwrap();
        assert!(verify_sentinel(&key, &sentinel));
    }

    #[test]
    fn test_sentinel_wrong_key() {
        let salt = generate_salt();
        let key_correct = derive_key("correct", &salt, 1000);
        let key_wrong = derive_key("wrong", &salt, 1000);
        let sentinel = create_sentinel(&key_correct).unwrap();
        assert!(!verify_sentinel(&key_wrong, &sentinel));
    }

    #[test]
    fn test_zero_key() {
        let mut key = derive_key("test", &[0u8; 32], 1000);
        assert_ne!(key, [0u8; 32]);
        zero_key(&mut key);
        assert_eq!(key, [0u8; 32]);
    }
}
