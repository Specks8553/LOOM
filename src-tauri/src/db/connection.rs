//! Encrypted SQLCipher connection helpers.
//!
//! Both `app_settings.db` and per-world `loom.db` files are opened the same
//! way: `rusqlite::Connection::open` followed by `PRAGMA key = "x'<hex>'";`.
//! Centralising the call site keeps the hex-formatting consistent and avoids
//! every command duplicating the same five lines.
//!
//! Per Doc 05 §Dependency Rules, `db/` may only import `rusqlite`. The key is
//! formatted with `hex::encode` which is a thin wrapper around the standard
//! library; that crate is allowed.

use std::path::Path;

use rusqlite::Connection;

use crate::db::migrations::{apply_pending, MigrationRoot};
use crate::error::LoomError;

/// Open a SQLCipher database at `path` and authenticate with `key`.
///
/// The 32-byte key is hex-encoded and passed via SQLCipher's `x'<hex>'` syntax.
/// Key bytes are never logged. If `path` does not exist, SQLCipher creates it
/// (caller decides whether that should happen — usually paired with
/// `provision_pending` afterwards).
pub fn open_encrypted(path: &Path, key: &[u8; 32]) -> Result<Connection, LoomError> {
    let conn = Connection::open(path).map_err(|e| LoomError::Database(e.to_string()))?;
    let key_hex = hex::encode(key);
    conn.execute_batch(&format!("PRAGMA key = \"x'{key_hex}'\";"))
        .map_err(|e| LoomError::Crypto(format!("PRAGMA key failed: {e}")))?;
    Ok(conn)
}

/// Open `path` and apply all pending migrations for `root`.
///
/// Used both at first-create (where the file doesn't exist yet) and at
/// re-open paths where additional migrations may have been added between
/// app versions.
pub fn open_and_migrate(
    path: &Path,
    key: &[u8; 32],
    root: MigrationRoot,
) -> Result<Connection, LoomError> {
    let mut conn = open_encrypted(path, key)?;
    apply_pending(&mut conn, root)?;
    Ok(conn)
}
