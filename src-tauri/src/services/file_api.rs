//! Gemini File API client (Doc 22 §Image source documents, Doc 05
//! §services/file_api.rs).
//!
//! Owns: read the cached `(file_api_uri, file_api_uploaded_at)` for an
//! Image item; if the URI is < 47 hours old, return it verbatim; otherwise
//! upload the bytes via Gemini `POST /upload/v1beta/files` and persist the
//! new URI + timestamp.
//!
//! 47 hours is conservative: Gemini deletes files at the 48-hour mark, and
//! a request submitted near the boundary needs a small safety margin.
//!
//! Per Doc 05 §Dependency Rules, this module may import `db/`, `security/`,
//! and `state/` (read-only) — never `commands/`. The Rust `reqwest` client
//! is built per-call (small, cheap; mirrors `services/gemini.rs`).

use std::path::{Path, PathBuf};

use chrono::{DateTime, Duration, Utc};
use rusqlite::Connection;
use serde::Deserialize;
use tracing::{debug, warn};

use crate::db::vault::{get_file_api_state, get_item, set_file_api_uri};
use crate::error::LoomError;

/// Conservative TTL — re-upload after 47 hours so a request submitted in the
/// last hour still has at least 60 minutes of validity on the Gemini side.
const REUPLOAD_AFTER: Duration = Duration::hours(47);

const FILES_UPLOAD_PATH: &str = "/upload/v1beta/files";

#[derive(Debug, Deserialize)]
struct FilesUploadResponse {
    file: FilesUploadFile,
}

#[derive(Debug, Deserialize)]
struct FilesUploadFile {
    uri: String,
    #[allow(dead_code)]
    name: Option<String>,
}

/// Resolve the absolute on-disk path for an Image item's `asset_path` (which
/// may be stored relative to the world directory). Caller hands in the world
/// dir; relative paths are joined onto it.
fn resolve_asset_path(world_dir: &Path, asset_path: &str) -> PathBuf {
    let p = Path::new(asset_path);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        world_dir.join(p)
    }
}

/// Has the cached URI exceeded `REUPLOAD_AFTER`? `now` is injected so tests
/// can drive the boundary without mocking the clock.
fn is_uri_stale(uploaded_at: Option<&str>, now: DateTime<Utc>) -> bool {
    let Some(ts) = uploaded_at else {
        return true;
    };
    match DateTime::parse_from_rfc3339(ts) {
        Ok(parsed) => {
            let age = now.signed_duration_since(parsed.with_timezone(&Utc));
            age >= REUPLOAD_AFTER
        }
        Err(_) => true,
    }
}

/// Return a Gemini File API URI for `item_id`, uploading first when no fresh
/// URI is on file. Caller holds the active world `Connection` and supplies
/// the world dir + api key. The Gemini base URL is injectable so wiremock
/// tests can run against a local server.
pub async fn get_or_upload_file_api_uri(
    conn: &Connection,
    base_url: &str,
    api_key: &str,
    item_id: &str,
    world_dir: &Path,
) -> Result<String, LoomError> {
    get_or_upload_with_now(conn, base_url, api_key, item_id, world_dir, Utc::now()).await
}

/// Internal: same as `get_or_upload_file_api_uri` with a caller-supplied
/// "now" for deterministic tests.
pub async fn get_or_upload_with_now(
    conn: &Connection,
    base_url: &str,
    api_key: &str,
    item_id: &str,
    world_dir: &Path,
    now: DateTime<Utc>,
) -> Result<String, LoomError> {
    let item = get_item(conn, item_id)?
        .ok_or_else(|| LoomError::NotFound(format!("item {item_id} not found")))?;
    if item.item_type != "Image" {
        return Err(LoomError::validation(format!(
            "file_api upload only applies to Image items (got {})",
            item.item_type
        )));
    }
    let asset_path = item
        .asset_path
        .as_deref()
        .ok_or_else(|| LoomError::validation("Image has no asset_path"))?;
    let mime = item
        .asset_meta
        .as_ref()
        .map(|m| m.mime_type.clone())
        .ok_or_else(|| LoomError::validation("Image has no asset_meta.mime_type"))?;

    let (cached_uri, uploaded_at) = get_file_api_state(conn, item_id)?;
    if let Some(uri) = cached_uri.as_ref() {
        if !is_uri_stale(uploaded_at.as_deref(), now) {
            debug!(item_id = %item_id, "file_api: cache hit");
            return Ok(uri.clone());
        }
    }

    let abs_path = resolve_asset_path(world_dir, asset_path);
    let bytes = std::fs::read(&abs_path)
        .map_err(|e| LoomError::Io(format!("read asset {}: {e}", abs_path.display())))?;
    let uri = upload_bytes(base_url, api_key, &mime, bytes).await?;
    set_file_api_uri(conn, item_id, &uri, &now.to_rfc3339())?;
    Ok(uri)
}

/// Issue a Gemini Files API upload. Uses simple (non-resumable) upload —
/// good enough for source-doc-sized images (the resumable path is needed
/// only for files > ~5 MiB, which v2.0 doesn't currently produce).
async fn upload_bytes(
    base_url: &str,
    api_key: &str,
    mime_type: &str,
    bytes: Vec<u8>,
) -> Result<String, LoomError> {
    let url = format!("{base_url}{FILES_UPLOAD_PATH}?uploadType=media&key={api_key}");
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| LoomError::ApiError(format!("client build: {e}")))?;
    let resp = client
        .post(&url)
        .header("Content-Type", mime_type)
        .body(bytes)
        .send()
        .await
        .map_err(|e| LoomError::ApiError(format!("file upload send: {e}")))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(LoomError::ApiError(format!(
            "file upload HTTP {status}: {text}"
        )));
    }
    let parsed: FilesUploadResponse = resp.json().await.map_err(|e| {
        warn!("file upload parse failure: {e}");
        LoomError::ApiError(format!("file upload parse: {e}"))
    })?;
    Ok(parsed.file.uri)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::{apply_pending, MigrationRoot};
    use crate::db::vault::{insert_item, ImageAssetMeta, VaultItemMeta};
    use chrono::TimeZone;
    use std::io::Write;
    use tempfile::TempDir;

    fn fresh_world() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        apply_pending(&mut c, MigrationRoot::World).unwrap();
        c
    }

    fn insert_image(c: &Connection, id: &str, asset_rel_path: &str) {
        insert_item(
            c,
            &VaultItemMeta {
                id: id.into(),
                parent_id: None,
                item_type: "Image".into(),
                item_subtype: Some("Reference".into()),
                name: format!("img-{id}"),
                description: None,
                sort_order: 0,
                created_at: "2026-05-01T00:00:00Z".into(),
                modified_at: "2026-05-01T00:00:00Z".into(),
                deleted_at: None,
                asset_path: Some(asset_rel_path.into()),
                asset_meta: Some(ImageAssetMeta {
                    width: 100,
                    height: 100,
                    mime_type: "image/png".into(),
                }),
                file_api_uri: None,
            },
        )
        .unwrap();
    }

    #[test]
    fn is_uri_stale_returns_true_when_uploaded_at_missing() {
        let now = Utc.with_ymd_and_hms(2026, 5, 14, 12, 0, 0).unwrap();
        assert!(is_uri_stale(None, now));
    }

    #[test]
    fn is_uri_stale_within_47h_returns_false() {
        let now = Utc.with_ymd_and_hms(2026, 5, 14, 12, 0, 0).unwrap();
        // 46 hours ago — fresh.
        let then = now - Duration::hours(46);
        assert!(!is_uri_stale(Some(&then.to_rfc3339()), now));
    }

    #[test]
    fn is_uri_stale_at_or_past_47h_returns_true() {
        let now = Utc.with_ymd_and_hms(2026, 5, 14, 12, 0, 0).unwrap();
        let exactly = now - Duration::hours(47);
        assert!(is_uri_stale(Some(&exactly.to_rfc3339()), now));
        let beyond = now - Duration::hours(48);
        assert!(is_uri_stale(Some(&beyond.to_rfc3339()), now));
    }

    #[tokio::test]
    async fn returns_cached_uri_when_fresh_no_http_call() {
        use wiremock::{matchers::method, Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        // Mount a "fail if called" mock — if we hit the server, the test fails.
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(500))
            .expect(0)
            .mount(&server)
            .await;

        let c = fresh_world();
        let dir = TempDir::new().unwrap();
        insert_image(&c, "img1", "missing.png"); // bytes never read on cache hit
                                                 // Seed a fresh URI.
        let now = Utc.with_ymd_and_hms(2026, 5, 14, 12, 0, 0).unwrap();
        let recent = (now - Duration::hours(1)).to_rfc3339();
        set_file_api_uri(&c, "img1", "files/abc", &recent).unwrap();

        let uri = get_or_upload_with_now(&c, &server.uri(), "key", "img1", dir.path(), now)
            .await
            .unwrap();
        assert_eq!(uri, "files/abc");
    }

    #[tokio::test]
    async fn uploads_when_no_cached_uri() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/upload/v1beta/files"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "file": { "uri": "https://files.gemini/abc", "name": "files/abc" }
            })))
            .mount(&server)
            .await;

        let c = fresh_world();
        let dir = TempDir::new().unwrap();
        let img_path = dir.path().join("hello.png");
        let mut f = std::fs::File::create(&img_path).unwrap();
        f.write_all(b"\x89PNG\r\n\x1a\nfake").unwrap();

        insert_image(&c, "img1", "hello.png");

        let now = Utc.with_ymd_and_hms(2026, 5, 14, 12, 0, 0).unwrap();
        let uri = get_or_upload_with_now(&c, &server.uri(), "key", "img1", dir.path(), now)
            .await
            .unwrap();
        assert_eq!(uri, "https://files.gemini/abc");
        // Persisted.
        let (cached, uploaded_at) = get_file_api_state(&c, "img1").unwrap();
        assert_eq!(cached.as_deref(), Some("https://files.gemini/abc"));
        assert!(uploaded_at.is_some());
    }

    #[tokio::test]
    async fn re_uploads_when_cached_uri_is_stale() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/upload/v1beta/files"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "file": { "uri": "https://files.gemini/refreshed", "name": "files/refreshed" }
            })))
            .mount(&server)
            .await;

        let c = fresh_world();
        let dir = TempDir::new().unwrap();
        let img_path = dir.path().join("img.png");
        std::fs::write(&img_path, b"bytes").unwrap();
        insert_image(&c, "img1", "img.png");

        let now = Utc.with_ymd_and_hms(2026, 5, 14, 12, 0, 0).unwrap();
        let stale = (now - Duration::hours(48)).to_rfc3339();
        set_file_api_uri(&c, "img1", "https://files.gemini/old", &stale).unwrap();

        let uri = get_or_upload_with_now(&c, &server.uri(), "key", "img1", dir.path(), now)
            .await
            .unwrap();
        assert_eq!(uri, "https://files.gemini/refreshed");
    }
}
