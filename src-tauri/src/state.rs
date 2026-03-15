use rusqlite::Connection;
use std::sync::Mutex;
use tokio::sync::watch;
use zeroize::Zeroize;

/// Global application state managed by Tauri.
///
/// - `master_key`: Derived from user password via PBKDF2. Zeroed on lock/close.
/// - `api_key`: Gemini API key from encrypted DB. Zeroed on lock/close.
/// - `active_conn`: SQLCipher connection to the active world's `loom.db`.
/// - `active_world_id`: UUID of the currently open world.
/// - `cancel_tx`: Cancellation signal for active stream generation.
pub struct AppState {
    pub master_key: Mutex<Option<[u8; 32]>>,
    pub api_key: Mutex<Option<String>>,
    pub active_conn: Mutex<Option<Connection>>,
    pub active_world_id: Mutex<Option<String>>,
    pub cancel_tx: Mutex<Option<watch::Sender<bool>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            master_key: Mutex::new(None),
            api_key: Mutex::new(None),
            active_conn: Mutex::new(None),
            active_world_id: Mutex::new(None),
            cancel_tx: Mutex::new(None),
        }
    }

    /// Zero out master key and API key, close DB connection.
    pub fn clear_sensitive(&self) {
        // Zero master key
        if let Ok(mut key) = self.master_key.lock() {
            if let Some(ref mut k) = *key {
                k.zeroize();
            }
            *key = None;
        }

        // Clear API key
        if let Ok(mut api) = self.api_key.lock() {
            if let Some(ref mut s) = *api {
                // Zeroize the string's bytes
                unsafe {
                    let bytes = s.as_bytes_mut();
                    bytes.zeroize();
                }
            }
            *api = None;
        }

        // Close DB connection
        if let Ok(mut conn) = self.active_conn.lock() {
            *conn = None;
        }

        // Clear world ID
        if let Ok(mut wid) = self.active_world_id.lock() {
            *wid = None;
        }

        // Cancel any active generation
        if let Ok(mut tx) = self.cancel_tx.lock() {
            if let Some(sender) = tx.take() {
                let _ = sender.send(true);
            }
        }
    }
}

impl Drop for AppState {
    fn drop(&mut self) {
        self.clear_sensitive();
    }
}
