//! Key verification sentinel (Doc 02 §Key Lifecycle, Doc 13 §Data Requirements).
//!
//! The sentinel is an AES-256-GCM encryption of the known plaintext `"LOOM_KEY_CHECK"`.
//! It is stored in `app_config.json` as `{ nonce_hex, ciphertext_hex }`. Password
//! correctness is verified by decrypting the sentinel — works even when no World
//! databases exist (D-04).
//!
//! This module may only import `security::crypto` — never higher-level LOOM modules.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::LoomError;
use crate::security::crypto;

/// Known plaintext used for the sentinel. Must match on every verify call.
const KNOWN_PLAINTEXT: &[u8] = b"LOOM_KEY_CHECK";

/// Sentinel payload stored in `app_config.json`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/lib/types.generated.ts")]
pub struct Sentinel {
    pub nonce_hex: String,
    pub ciphertext_hex: String,
}

/// Encrypt `LOOM_KEY_CHECK` under `key` and return the sentinel.
///
/// Called once during `setup_vault` (first launch) and again during
/// `change_password` with the new key.
pub fn create(key: &[u8; 32]) -> Result<Sentinel, LoomError> {
    let (nonce, ciphertext) = crypto::encrypt(key, KNOWN_PLAINTEXT)?;
    Ok(Sentinel {
        nonce_hex: hex::encode(nonce),
        ciphertext_hex: hex::encode(ciphertext),
    })
}

/// Verify `key` against a stored `sentinel`.
///
/// Returns `Ok(())` if the key is correct, `LoomError::Crypto` if it is wrong
/// or the sentinel is corrupt.
pub fn verify(key: &[u8; 32], sentinel: &Sentinel) -> Result<(), LoomError> {
    let nonce_bytes = hex::decode(&sentinel.nonce_hex)
        .map_err(|_| LoomError::Crypto("Sentinel nonce is not valid hex".into()))?;
    let ciphertext = hex::decode(&sentinel.ciphertext_hex)
        .map_err(|_| LoomError::Crypto("Sentinel ciphertext is not valid hex".into()))?;

    if nonce_bytes.len() != 12 {
        return Err(LoomError::Crypto("Sentinel nonce has wrong length".into()));
    }
    let nonce: [u8; 12] = nonce_bytes.try_into().expect("length checked above");

    let plaintext = crypto::decrypt(key, &nonce, &ciphertext)?;

    if plaintext != KNOWN_PLAINTEXT {
        return Err(LoomError::Crypto("Sentinel plaintext mismatch".into()));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::crypto;

    fn test_key(password: &str) -> [u8; 32] {
        crypto::derive_key(password, &[0x42u8; 32])
    }

    #[test]
    fn create_and_verify_round_trip() {
        let key = test_key("correct-password");
        let sentinel = create(&key).expect("create failed");
        assert!(verify(&key, &sentinel).is_ok());
    }

    #[test]
    fn wrong_password_fails_verify() {
        let key_correct = test_key("correct");
        let key_wrong = test_key("wrong");
        let sentinel = create(&key_correct).expect("create failed");
        let result = verify(&key_wrong, &sentinel);
        assert!(matches!(result, Err(LoomError::Crypto(_))));
    }

    #[test]
    fn corrupt_ciphertext_fails_verify() {
        let key = test_key("test");
        let mut sentinel = create(&key).expect("create failed");
        // Flip the first hex char to corrupt the ciphertext
        let mut bytes = hex::decode(&sentinel.ciphertext_hex).unwrap();
        bytes[0] ^= 0xFF;
        sentinel.ciphertext_hex = hex::encode(bytes);
        let result = verify(&key, &sentinel);
        assert!(matches!(result, Err(LoomError::Crypto(_))));
    }

    #[test]
    fn invalid_hex_nonce_fails_gracefully() {
        let key = test_key("test");
        let sentinel = Sentinel {
            nonce_hex: "not-hex!".into(),
            ciphertext_hex: "deadbeef".into(),
        };
        let result = verify(&key, &sentinel);
        assert!(matches!(result, Err(LoomError::Crypto(_))));
    }
}
