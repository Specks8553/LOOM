# 19 — Media System

> **Status:** Deferred to v2.1 (D-20, 2026-05-16)
> **Last updated:** 2026-05-16 — D-20: the entire media surface — image source documents included — is deferred to v2.1. Phase 10's re-scope dropped image-as-source-doc from v2.0 (the File API integration and the inline-vs-cache delivery question were entangled; v2.0 ships text source documents only). The implemented-but-dormant `services/file_api.rs` and the `Image` branches in `services/cache.rs` are retained, reserved for the v2.1 pickup. The body below is the v2.1 design carry-forward — **none of it is v2.0 scope.**
> **Earlier:** 2026-05-03 — pre-implementation audit resolution: dropped reference to nonexistent `vault_read_item` command (IP-2). 2026-04-29 — first full design pass; v2.0 scope cut to image-as-source-doc only; image generation, TTS, per-turn user-message images, and `content_type = 'blocks'` messages deferred to v2.1.
> **Scope:** Image upload, asset storage, Gemini File API URI cache, and rendering primitives. **All deferred to v2.1 per D-20.** v2.0 source documents are text-only (Doc 18). World backup (`.loom-backup` zip) is unaffected — it lives in Doc 14 §World Backup and ships in v2.0.

`Image` is one of four `items.item_type` values (alongside `Story`, `Folder`, `SourceDocument`). Per Doc 18, an Image item is a kind of source document — it has a caption (stored in `items.content`), it's attachable to stories via the same paperclip surface as text source documents, and it's sent to Gemini on every relevant request as a Context Document. Doc 19's job is the **byte-level layer**: how the bytes get onto disk, how the bytes get to Gemini, and how the bytes get back into the UI as pixels.

This doc owns: the upload command, the asset-path / `assets/` directory convention, MIME and size validation, the `get_or_upload_file_api_uri` helper that Doc 18's request assembler calls, thumbnail rendering primitives, and asset cleanup on hard-delete. It does **not** own item creation flows (Doc 14), image-as-context-doc attach/detach (Doc 18), the lightbox UI (Doc 18), or any v2.1-deferred work (`docs-v2/future/media-generation.md`).

---

## v2.0 Scope (Slim)

| Feature | v2.0 | Owned by |
|---|---|---|
| Image vault items (`Image` `item_type`) | ✅ | Doc 18 (lifecycle), Doc 19 (bytes) |
| Upload via file picker | ✅ | Doc 19 |
| Upload via drag-and-drop | ✅ | Doc 19 |
| Multi-file upload | ✅ | Doc 19 |
| Caption editing | ✅ | Doc 18 |
| Lightbox display in DocEditor | ✅ | Doc 18 |
| Navigator hover thumbnail | ✅ | Doc 19 |
| Image as Context Document (attach/detach + send-time inclusion) | ✅ | Doc 18 (UX), Doc 19 (File API) |
| Gemini File API URI cache (`get_or_upload_file_api_uri`) | ✅ | Doc 19 |
| Per-turn image attachments in user messages | ❌ — dropped from `UserContent` in Doc 15 | — |
| AI-generated images in model messages (`content_type = 'blocks'`) | ❌ — deferred | `docs-v2/future/media-generation.md` |
| Image generation (Imagen / Stability / etc.) | ❌ — deferred | `docs-v2/future/media-generation.md` |
| TTS / audio | ❌ — deferred | `docs-v2/future/media-generation.md` |
| World backup as `.loom-backup` zip | ✅ | Doc 14 §World Backup |
| Story export to readable formats | ❌ — deferred | Doc 21 (v2.1) |

The slim scope means Doc 19 is structurally small: one upload command, one helper, a few rendering primitives, and the cleanup contract.

---

## Asset Storage

### Directory layout

```
worlds/<world_id>/
├── loom.db
├── world_meta.json
└── assets/
    ├── <item_id>.png
    ├── <item_id>.jpg
    ├── <item_id>.webp
    └── <item_id>.gif
```

The `assets/` directory is created on first upload (idempotent `mkdir`). The asset file is named `<item_id>.<extension>` where `<item_id>` is the UUID primary key in the `items` table — so the on-disk filename is content-addressable from any `items` row without an extra lookup.

### `items` columns (already locked in Doc 03)

```
asset_path           TEXT  -- relative: "assets/<item_id>.<ext>"
asset_meta           TEXT  -- JSON: { mime, width, height, size_bytes }
file_api_uri         TEXT  -- Gemini File API URI; managed by get_or_upload_file_api_uri
file_api_uploaded_at TEXT  -- ISO 8601 UTC; NULL until first upload
```

All four are `NULL` for non-Image items. `file_api_uri` and `file_api_uploaded_at` are **backend-only** — never written from the frontend, never returned in IPC payloads. Backend debugging reads them via standard DB inspection.

### Supported formats

| MIME | Extension | Notes |
|---|---|---|
| `image/png` | `.png` | |
| `image/jpeg` | `.jpg`, `.jpeg` | |
| `image/webp` | `.webp` | |
| `image/gif` | `.gif` | Animated GIFs supported but Gemini reads only the first frame |

MIME is validated by **magic bytes**, not by file extension. The `image` Rust crate handles both detection and dimension extraction.

### Maximum file size

**10 MB per image.** Above this, `upload_image` returns `LoomError::Validation` with reason `"image exceeds 10 MB limit"`. The frontend surfaces this as a toast.

10 MB is the upload ceiling, not the Gemini API ceiling — Gemini accepts inline base64 up to ~4 MB and uses the File API above that, transparently handled by `get_or_upload_file_api_uri` (see §File API Cache).

---

## Upload Flow

### Triggers

1. **Picker** — `[+]` menu in the Navigator → **New Image** → native OS file dialog filtered to image types. Multi-select supported (each selection becomes one Image item).
2. **Drag-and-drop** — drag image file(s) onto the Navigator from the OS file manager. Tauri drag-event listener registered on the Navigator container.

### Drop target

| Trigger | Where the image lands |
|---|---|
| Picker, no folder selected | Vault root |
| Picker, folder selected | Inside that folder |
| Drag-and-drop onto a folder row | Inside that folder |
| Drag-and-drop onto a leaf (Story, SourceDocument, Image) | Same parent as the dropped-on item |
| Drag-and-drop onto the vault background | Vault root |

These rules mirror Doc 14's other create flows.

### Default name

`<filename without extension>` from the source path. The writer can rename inline via the standard Doc 14 rename affordance.

### Multi-file upload

Each file becomes one Image item with a separate `upload_image` call. Failures are per-file:
- Successful uploads add their items to the vault as they complete.
- A failure (size limit, unsupported MIME, disk error) raises a per-file toast and does not abort the others.

⚠️ Visual phase may revisit: a single bulk progress indicator vs. per-file silent success is a UI question. v2.0 ships with per-file failure toasts and silent successes.

### Steps performed by `upload_image`

1. Validate vault is unlocked.
2. Read source file bytes from `src_path`.
3. Validate MIME by magic bytes; reject unsupported formats with `LoomError::Validation`.
4. Validate size ≤ 10 MB; reject with `LoomError::Validation` if exceeded.
5. Generate UUID `item_id`.
6. Derive extension from MIME (canonical: png/jpg/webp/gif).
7. Ensure `worlds/<world_id>/assets/` exists; create if absent.
8. Copy bytes to `worlds/<world_id>/assets/<item_id>.<ext>`.
9. Decode pixel dimensions via the `image` crate.
10. Build `asset_meta` JSON `{ mime, width, height, size_bytes }`.
11. Insert `items` row with `item_type = 'Image'`, `item_subtype = 'image'`, `name`, `parent_id`, `content = ''` (empty caption), `asset_path = "assets/<item_id>.<ext>"`, `asset_meta = <json>`, `file_api_uri = NULL`, `file_api_uploaded_at = NULL`.
12. Emit `vault_updated` event.
13. Return the new `VaultItemMeta`.

### Atomicity

Steps 8 and 11 are not in one transaction (one is filesystem, one is SQLite). Failure handling:
- If the file copy succeeds but the DB insert fails → best-effort delete the orphaned asset file; return the original error.
- If the DB insert succeeds but a subsequent step (event emit, return) fails → the row is committed and the file is on disk; subsequent reads work normally.

---

## Gemini File API URI Cache

### Purpose

Gemini's File API caches uploaded media for ~48 hours, after which the URI hard-expires. Re-uploading on every request is wasteful (a request that includes 4 attached images would do 4 uploads); reading from a stale URI returns an error. The cache helper amortises uploads across requests and refreshes only when needed.

### `get_or_upload_file_api_uri`

```rust
/// Returns a valid Gemini File API URI for an image item.
/// Uploads (or re-uploads) the asset and updates the cache when stale.
/// Lives in `services/file_api.rs`. Called from request-assembly paths
/// (Doc 18 source-doc inclusion, Doc 22 cache-prefix construction).
pub async fn get_or_upload_file_api_uri(
    conn:      &Connection,
    item_id:   &str,
    world_dir: &Path,
) -> Result<String, LoomError>
```

### Behaviour

1. Read `(asset_path, asset_meta.mime, file_api_uri, file_api_uploaded_at)` from the `items` row.
2. If `file_api_uri` is `Some` and `file_api_uploaded_at` is < 47 hours old → return the cached URI.
3. Otherwise, read the asset bytes from `world_dir + asset_path`.
4. Upload to Gemini File API; receive a new URI.
5. Update `items.file_api_uri = <new uri>` and `items.file_api_uploaded_at = <now ISO 8601>` in a single DB write.
6. Return the new URI.

### Why 47 hours, not 48

The 1-hour buffer accommodates clock skew, slow assembly, and the latency of the request that *uses* the URI. A request that begins at 47 h 55 m would have its URI rejected by Gemini at the call site if we cached for the full 48.

### Error handling for callers

| Error | Caller behaviour (the request-assembly path) |
|---|---|
| `LoomError::Io` (asset file missing on disk) | Skip this image; log `warn!`; emit toast `"Image '<name>' couldn't be sent (asset file missing)."`; continue with remaining context docs |
| `LoomError::Api` (File API rejected upload) | Skip this image; log `warn!`; emit toast `"Image '<name>' couldn't be sent (File API error)."`; continue with remaining context docs |
| `LoomError::Database` (DB update after successful upload) | URI is used for the current request; warn logged; the next call will re-upload (the missed write means the cache row still says "uploaded long ago") |

The send proceeds on per-image failure — one broken image doesn't block the whole turn. The text + remaining images continue to assemble.

### When the helper is called

- **Doc 18 source-doc inclusion** — every `send_message` / `send_session_message` call iterates `story_state.context_doc_ids`; for each Image item, the assembler calls `get_or_upload_file_api_uri` to get the URI for the `fileData` part.
- **Doc 22 cache-prefix construction** — when building or rebuilding the cached prefix (story or consulting session), each Image source doc's URI is fetched the same way. The cache itself stores the URI; if the cache is later reused and the URI has expired, the cache is rebuilt on the next send (Doc 22 §Stale Triggers — file-API expiry is a stale trigger handled implicitly via the upload-on-stale path).

The helper is **not** called from non-request paths — there's no "pre-warm the URI" or "bulk-refresh" flow in v2.0.

### Rate limiting

File API uploads do **not** consume the `'text'` rate-limit window. `telemetry.image_gen` and `telemetry.tts` rows stay at zero in v2.0; they're reserved for v2.1.

---

## Rendering

### Asset URL via `convertFileSrc`

Asset binaries are served via Tauri's asset protocol, not via the database. The frontend constructs the URL:

```ts
import { convertFileSrc } from '@tauri-apps/api/core';

const assetUrl = convertFileSrc(`${vaultStore.activeWorldDir}/${item.asset_path}`);
// → asset://localhost/<absolute_path>
```

`activeWorldDir` is the absolute world directory path, populated when a world opens (Doc 14).

### Navigator hover thumbnail

When the writer hovers an Image row in the Navigator vault tree (Doc 14), a floating thumbnail tooltip renders:

| Property | Value |
|---|---|
| Container | absolute-positioned floating popover |
| Max size | 160 × 160 px ⚠️ provisional |
| Image fit | proportional (preserve aspect ratio) |
| Background | `--color-bg-elevated` |
| Show delay | 200 ms after hover ⚠️ provisional |
| Hide trigger | mouseleave or scroll |

The thumbnail uses the same `convertFileSrc` URL — no separate thumbnail file is generated. Browser-level image scaling handles the resize.

### DocEditor lightbox

Owned by Doc 18 §Layout — image source documents. Doc 19's contract is just the URL primitive: `convertFileSrc(world_dir + asset_path)`.

### Inline image rendering primitive

A reusable `<InlineImage />` component (Doc 09 owns the visual catalogue):

```tsx
function InlineImage({ itemId, assetPath }: { itemId: string; assetPath: string }) {
  const url = convertFileSrc(`${activeWorldDir}/${assetPath}`);
  return (
    <img
      src={url}
      onClick={() => openLightbox(itemId)}
      onError={() => /* render fallback glyph */}
      // ⚠️ visual specifics owned by Doc 09 / visual phase
    />
  );
}
```

In v2.0, `<InlineImage />` is used by the Navigator hover tooltip and the DocEditor lightbox. It is **not** used inside message bubbles — there are no inline-images-in-bubbles in v2.0.

### Missing-asset fallback

If the asset file is missing on disk (manual deletion, world directory corruption), the `<img>` tag's `onError` swaps in a small fallback glyph (`lucide-react ImageOff`, `--color-text-muted`). The item row stays in the vault; the writer can delete it via the standard flow. ⚠️ Exact glyph and styling owned by visual phase.

---

## Cleanup

### Soft-delete (move to Trash)

`items.deleted_at` is set; the asset file on disk is **not touched**. The item disappears from the live vault tree but appears in Trash view (Doc 14). Restore from Trash works normally — the asset file is still where it always was.

Per Doc 18, soft-delete also strips the doc from every story's `context_doc_ids` and marks affected caches stale.

### Hard-delete (Empty Trash, `delete_item_permanent`)

The `items` row is removed; the asset file is deleted from disk:

```rust
let abs_asset_path = world_dir.join(&items.asset_path);
match std::fs::remove_file(&abs_asset_path) {
    Ok(_) => {}
    Err(e) => log::warn!("asset cleanup failed for {item_id}: {e}"),
}
conn.execute("DELETE FROM items WHERE id = ?1", [item_id])?;
```

**Best-effort** — if the file delete fails (permissions, file locked, disk error), a `warn!` is logged and the DB delete proceeds. Orphaned asset files are harmless (they live in `assets/` but no `items` row references them) and can be cleaned up manually by the writer if needed. v2.0 does **not** include a periodic orphan sweep.

### Best-effort DELETE to Gemini File API

When an Image item is hard-deleted, **no** `DELETE` request is issued to Gemini for the cached `file_api_uri`. The Gemini File API auto-expires uploads at 48 h, and the orphaned URI is harmless until then. Adding a network call to the delete path would add friction for an operation that should be local-fast.

### Asset cleanup on World hard-delete

When a world is permanently deleted (Doc 14 §Delete World), the entire `worlds/<world_id>/` directory is removed — `loom.db`, `world_meta.json`, and `assets/` together. No per-item cleanup needed.

---

## Backend API

All commands live in `commands/vault.rs` (per Doc 07's vault domain).

### `upload_image`

```rust
#[tauri::command]
pub async fn upload_image(
    state: State<'_, AppState>,
    src_path: String,        // absolute path from native dialog or drag-event
    name: String,            // display name (filename without extension by default)
    parent_id: Option<String>,  // None = vault root; Some(folder_id) = inside that folder
) -> Result<VaultItemMeta, LoomError>
```

**Preconditions:** vault unlocked; world open; `parent_id`, if `Some`, resolves to a `Folder` item.

**Errors:**
- `Validation` — bad MIME, file > 10 MB, parent not a folder.
- `Io` — file read failure, asset write failure.
- `Database` — insert failure.
- `NotFound` — `parent_id` doesn't resolve.

**Emits:** `vault_updated { world_id }`.

### Helper — not a Tauri command

`get_or_upload_file_api_uri(conn, item_id, world_dir) -> Result<String, LoomError>` is an internal Rust function in `services/file_api.rs`. It is **not** exposed as a Tauri command. Frontend code never calls it directly; it's invoked exclusively by the request-assembly paths (`send_message`, `send_session_message`, accordion summarise, cache prefix construction).

### No other Doc 19 commands

Image item lifecycle (rename, move, delete, restore) is covered by the generic vault commands in Doc 14. Caption editing uses `update_item_content` (Doc 18). There is no `upload_image_to_file_api` Tauri command — the cache helper is internal.

---

## Frontend State

Image-related state is already on `workspaceStore` and `vaultStore` (Doc 06):

- `vaultStore.items` includes Image items alongside Stories / Folders / SourceDocuments — no per-type segregation.
- `vaultStore.activeWorldDir` provides the absolute path for `convertFileSrc`.
- `workspaceStore.contextDocIds` (Doc 18) includes attached Image items alongside text source docs.

No new store fields, no new actions. The upload flow calls `upload_image` directly via `tauriApi.uploadImage(srcPath, name, parentId)` and refreshes the items list on the `vault_updated` event.

---

## Data Requirements

| Table | Field | Role |
|---|---|---|
| `items` | `item_type = 'Image'`, `item_subtype = 'image'` | Vault item row |
| `items` | `name`, `parent_id`, `content`, `created_at`, `modified_at`, `deleted_at` | Standard vault fields (Doc 14) |
| `items` | `asset_path` | Relative path to asset file |
| `items` | `asset_meta` | JSON metadata (mime, width, height, size_bytes) |
| `items` | `file_api_uri` | Cached Gemini URI; managed by helper |
| `items` | `file_api_uploaded_at` | ISO 8601 timestamp of last upload |

No new schema in v2.0; everything is in Doc 03.

---

## Edge Cases and Error Handling

| Scenario | Behaviour |
|---|---|
| Upload a file that's not an image (e.g. `.pdf`) | `LoomError::Validation`; toast `"Unsupported file type. Use PNG, JPEG, WebP, or GIF."` |
| Upload a file > 10 MB | `LoomError::Validation`; toast `"Image too large. Maximum size is 10 MB."` |
| Upload a corrupt image (magic bytes match but `image` crate can't decode) | `LoomError::Validation`; toast `"Couldn't read image dimensions — file may be corrupt."` |
| Multi-drop with one bad file | Per-file failure toast; the rest succeed |
| Drag-and-drop while vault is locked | Drop handler refuses; toast `"Unlock the vault to upload."` |
| Drag-and-drop with no world open | Drop handler refuses; toast `"Open a world to upload."` |
| File API upload fails on first send | Image part skipped; toast; send proceeds with remaining content |
| File API upload succeeds but DB write fails | URI used for this request; next request re-uploads |
| Asset file deleted manually outside LOOM | Navigator hover thumbnail and DocEditor lightbox show the missing-asset fallback glyph; on send, the request assembler logs warn and skips the image |
| Same source path uploaded twice | Two separate Image items with two separate `<item_id>.ext` asset files. No deduplication in v2.0 |
| GIF with multiple frames | Uploaded; Gemini reads first frame; LOOM renders animated in the lightbox (browser default) |
| Asset path collision (UUID collision) | Effectively impossible (UUIDv4 collision probability); not handled defensively |
| World moved to a different filesystem path between sessions | The relative `asset_path` resolves via `activeWorldDir`; thumbnails work normally as long as the world directory is intact |
| Bulk drag of 50 images | Each runs as a separate `upload_image` call; serialised on the frontend (loop with `await` to avoid hammering the disk and the SQLite single-writer lock) |
| Image item soft-deleted while attached as Context Doc | Per Doc 18 cascade — auto-detached from every story; cache marked stale per affected story |

---

## Out of Scope (v2.0)

Deferred to v2.1 — design preserved in `docs-v2/future/media-generation.md`:
- **Image generation** (Imagen, Stability, Replicate, fal.ai, etc.) — provider trait, generation request flow, prompt construction, AI-images-in-message-bubbles via `content_type = 'blocks'`.
- **TTS / audio** — provider, voice selection, audio playback, audio-in-message-bubbles.
- **`content_type = 'blocks'` model messages** — the schema enum value exists in Doc 03, but no v2.0 path produces it.
- **Per-turn image attachments in user messages** — `image_blocks` field on `UserContent` was dropped in Doc 15. To send an image to the model, the writer creates an Image vault item and attaches it as a Context Document.

Out of scope entirely (not in any v2.x roadmap):
- Image editing (crop, rotate, filters) inside LOOM.
- Thumbnail file generation as a separate cached file. Browser-level scaling is the only resize path.
- Periodic orphan-asset sweep.
- Best-effort `DELETE` to Gemini File API on hard-delete.
- File API quota tracking.
- Image deduplication across uploads.
- Animated GIF preservation in Gemini requests (the API reads first frame only).
- Image re-encoding (e.g. PNG → WebP) for size reduction.
- Per-image rate-limit tracking (the `image_gen` and `tts` `telemetry` rows stay at zero in v2.0).

---

## Cross-References

- **Doc 03** — `items.asset_path`, `asset_meta`, `file_api_uri`, `file_api_uploaded_at`; `messages.content_type` enum (`'blocks'` deferred).
- **Doc 06** — `vaultStore.activeWorldDir`, `vaultStore.items`, `workspaceStore.contextDocIds`.
- **Doc 07** — `upload_image` command in vault domain; `vault_updated` event.
- **Doc 09** — `<InlineImage />` component visual catalogue (lightbox, error fallback).
- **Doc 14** — Vault tree, item creation flows, drop targets, **World Backup** (`.loom-backup` zip export/import).
- **Doc 15** — `UserContent` (no `image_blocks`); `content_type` enum.
- **Doc 17** — Ghostwriter on `'blocks'` messages deferred (action-row button hidden).
- **Doc 18** — Image source documents (lightbox, caption, attach/detach); request-assembly inclusion via `get_or_upload_file_api_uri`.
- **Doc 22** — File API URI presence in cached prefix; staleness triggered implicitly by helper.
- **`docs-v2/future/media-generation.md`** — v2.1 design carry-forward for image generation, TTS, and `'blocks'` AI-image messages.
