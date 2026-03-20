# PATCH — 19-Media-System-Image-Uploads.md
# Issues addressed: #1 (File API URI cache), #2 (48h expiry),
#   #3 (user message content_type), #4 (assets/ path canon),
#   #5 (caption in items.content)
# Apply: replace/add the listed sections in full.
---

## SECTION 1.2 — items Table Extensions (FULL REPLACEMENT)

```sql
ALTER TABLE items ADD COLUMN asset_path          TEXT NULL;
-- Relative path from world dir: "assets/<item_id>.png"

ALTER TABLE items ADD COLUMN asset_meta          TEXT NULL;
-- JSON: { "mime": "image/png", "width": 1920, "height": 1080, "size_bytes": 204800 }

ALTER TABLE items ADD COLUMN file_api_uri        TEXT NULL;
-- Gemini File API resource name, e.g. "files/abc123def456".
-- NULL until the first File API upload.
-- Written (or overwritten) by get_or_upload_file_api_uri() whenever a fresh
-- upload is required. Never read by frontend — backend only.

ALTER TABLE items ADD COLUMN file_api_uploaded_at TEXT NULL;
-- ISO-8601 UTC timestamp of the last successful File API upload.
-- Used by get_or_upload_file_api_uri() to detect 47-hour staleness.
-- NULL when file_api_uri is NULL.
```

`asset_path`, `asset_meta`, `file_api_uri`, `file_api_uploaded_at` are all `NULL`
for non-image item types.

---

## SECTION 1.3 — TypeScript Interface (FULL REPLACEMENT)

```ts
export interface AssetMeta {
  mime:       string;   // "image/png" | "image/jpeg" | "image/webp" | "image/gif"
  width:      number;
  height:     number;
  size_bytes: number;
}

export interface VaultImageItem extends VaultItemMeta {
  item_type:            "Image";
  asset_path:           string;       // relative: "assets/<item_id>.png"
  asset_meta:           AssetMeta;
  file_api_uri:         string | null; // null until first File API upload
  file_api_uploaded_at: string | null; // ISO-8601 UTC; null until first upload
}
```

> `file_api_uri` and `file_api_uploaded_at` are **read-only** on the frontend
> (exposed via `vault_read_item` for debugging). They are managed exclusively by
> the Rust backend via `get_or_upload_file_api_uri()`.

---

## SECTION 2.1 — vault_upload_image: Step 9 (REPLACE step text)

> **Step 9 (was):** Insert into `items` table (`content = ""` for image items)
>
> **Step 9 (now):** Insert into `items` table with `content = ""` (caption field —
> empty by default, editable post-upload via `vault_update_item_content`).
> `file_api_uri` and `file_api_uploaded_at` are inserted as `NULL`.

---

## SECTION 4 — Inline Images in Message Bubbles (FULL REPLACEMENT)

### 4.1 Message Content Format

User messages with attached images use `content_type = "jsonuser"` — identical to
text-only user messages. The `UserContent` struct (canonical definition in Doc 09 §1.3)
gains an optional `image_blocks` field:

```ts
// Defined in Doc 09 §1.3 — reproduced here for reference
interface ImageBlock {
  item_id:    string;
  asset_path: string;   // relative: "assets/<item_id>.<ext>"
}

interface UserContent {
  plot_direction:         string;
  background_information: string;
  modificators:           string[];
  image_blocks?:          ImageBlock[];  // omitted or [] when no images attached
}
```

> **Why not `content_type = "blocks"`?**
> Keeping user messages as `"jsonuser"` preserves the edit flow (all three input
> fields + image chips repopulate from a single JSON parse) and keeps history
> assembly unified. `content_type = "blocks"` is reserved for **model** messages
> that include AI-generated images (Doc 20).

### 4.2 Inserting an Image into a Message

Image insert button in the Theater input area attachment row:

```
[🖼 + Image]   [▼ Background]  [▼ Modificators]
```

Click → **Vault Image Picker modal**: grid of all image items, thumbnails.
Selecting appends an `ImageBlock` to the component's local `image_blocks` state.
The image renders as a **dismissible thumbnail chip** in the input area.

On **Send**: the full `UserContent` — including `image_blocks` — is serialised to
JSON and stored in `messages.content` with `content_type = "jsonuser"`.
No separate `"blocks"` content type is used for user messages.

### 4.3 Rendering User Bubbles with Images

When rendering a user bubble, parse `UserContent` from the `"jsonuser"` content.
If `image_blocks` is present and non-empty, render each `ImageBlock` as
`<InlineImage />` directly below the plot direction text, before the Background
and Modificators pills.

```tsx
function UserBubble({ msg }: { msg: ChatMessage }) {
  const content = JSON.parse(msg.content) as UserContent;
  return (
    <div>
      <p>{content.plot_direction}</p>
      {content.image_blocks?.map((b, i) => (
        <InlineImage key={i} itemId={b.item_id} assetPath={b.asset_path} />
      ))}
      {content.background_information && <BackgroundPill text={content.background_information} />}
      {content.modificators.length > 0  && <ModificatorPill tags={content.modificators} />}
    </div>
  );
}
```

### 4.4 Rendering Model Bubbles — `blocks` Content (unchanged)

Model messages with `content_type = "blocks"` (Doc 20 image generation) are
rendered as before:

```tsx
function MessageRenderer({ msg }: { msg: ChatMessage }) {
  if (msg.content_type === "blocks") {
    const blocks = JSON.parse(msg.content) as MessageBlock[];
    return (
      <div>
        {blocks.map((block, i) =>
          block.type === "text"
            ? <ReactMarkdown key={i}>{block.text}</ReactMarkdown>
            : <InlineImage key={i} itemId={block.item_id} assetPath={block.asset_path} />
        )}
      </div>
    );
  }
  // "text" content_type — plain model response
  return <ReactMarkdown>{msg.content}</ReactMarkdown>;
}
```

### 4.5 Thumbnail Sizes (unchanged)

| Context          | Max size                       | Behaviour              |
|------------------|--------------------------------|------------------------|
| Navigator hover  | `160 × 160px`                  | Proportional fit       |
| Inline in bubble | `100% bubble width × 400px max`| Proportional, click to expand |
| Lightbox         | `90vw × 90vh`                  | Click outside to close |

### 4.6 Sending Images to Gemini

Sending logic lives in `build_user_turn()` in `commands.rs` / `gemini.rs`
(canonical definition: Doc 09 §4.2). Summary:

- Images **≤ 4 MB**: sent as `inlineData` (base64).
- Images **> 4 MB**: uploaded via Gemini File API using `get_or_upload_file_api_uri()`
  (defined in §5.1 below); the returned URI is sent as `fileData`.
- Missing asset file or File API failure: image part is **skipped**; text send
  continues; warning logged; toast shown (see §5.1 error handling).

---

## SECTION 5 — Image as Context Doc (FULL REPLACEMENT)

Image items support the `[📎]` paperclip attachment in the Navigator, identical
to text Source Documents.

On attach: the item ID is added to `storysettings.context_doc_ids` (same as text docs).
Attachment highlighted in Navigator with accent color.

On `send_message`, for each attached image Context Doc:

```rust
let uri = get_or_upload_file_api_uri(conn, &item_id, world_dir).await?;
parts.push(Part::file_data(uri));   // alongside text context doc parts
```

> Do **not** call `upload_to_file_api` directly. Always go through
> `get_or_upload_file_api_uri()` to benefit from the 47-hour cache.

---

## NEW SECTION 5.1 — File API URI Cache (ADD after §5)

All Gemini File API uploads are routed through a single helper that caches the
returned URI in `items.file_api_uri` and re-uploads only when the cached URI is
≥ 47 hours old (Gemini hard-expires files at 48 hours).

```rust
/// Returns a valid Gemini File API URI for an image item.
/// Uploads (or re-uploads) the asset and updates the cache when stale.
/// Lives in `vault.rs`. Called from `send_message` and Accordion summarisation.
pub async fn get_or_upload_file_api_uri(
    conn:      &Connection,
    item_id:   &str,
    world_dir: &Path,
) -> Result<String, LoomError> {
    let (asset_path, mime, cached_uri, uploaded_at): (
        String, String, Option<String>, Option<String>
    ) = conn.query_row(
        "SELECT asset_path,
                json_extract(asset_meta, '$.mime'),
                file_api_uri,
                file_api_uploaded_at
         FROM items WHERE id = ?1",
        [item_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;

    // Check freshness (< 47 hours → reuse cached URI)
    if let (Some(uri), Some(ts)) = (&cached_uri, &uploaded_at) {
        if let Ok(uploaded) = DateTime::parse_from_rfc3339(ts) {
            let age_hours = Utc::now()
                .signed_duration_since(uploaded.with_timezone(&Utc))
                .num_hours();
            if age_hours < 47 {
                return Ok(uri.clone());
            }
        }
    }

    // Upload (or re-upload)
    let abs_path = world_dir.join(&asset_path);
    let bytes = std::fs::read(&abs_path)
        .map_err(|e| LoomError::Io(format!("asset read failed for {item_id}: {e}")))?;
    let uri = upload_to_file_api(&bytes, &mime).await?;
    let now = Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE items
         SET file_api_uri = ?1, file_api_uploaded_at = ?2
         WHERE id = ?3",
        params![uri, now, item_id],
    )?;

    Ok(uri)
}
```

**Error handling for callers:**

| Error | Caller behaviour |
|-------|-----------------|
| `LoomError::Io` — asset file missing from disk | Skip image part; log `warn!`; continue send |
| `LoomError::Api` — Gemini File API rejected upload | Skip image part; log `warn!`; show toast: *"One image couldn't be sent to Gemini (File API error). Message sent without it."* |
| `LoomError::Db` — DB update failed after upload | URI used for this request; warn logged; next call will re-upload |

---

## SECTION 6 — Image Documents in Source Doc Viewer: Storage Path (CROSS-REF FIX)

> **Doc 12 §6 previously stated:** `worlds/<world_id>/images/<uuid>.<ext>`
>
> **Canonical path (this doc, §1.1):** `worlds/<world_id>/assets/<item_id>.<ext>`
>
> Doc 12 §6 has been updated to reflect this. `assets/` is the single authoritative
> location for all image binaries. There is no `images/` directory.

---

## SECTION 8 — Tauri Command Reference (ADD row)

| Command | Parameters | Returns |
|---|---|---|
| `vault_upload_image` | `src_path, name, parent_path` | `VaultItemMeta` |
| `vault_export_world` | `dest_path: String` | `()` |
| `vault_import_world` | `src_path: String` | `WorldMeta` |
| `vault_read_item`    | `id: String` | `VaultItem` |
| `vault_update_item_content` | `id: String, content: String` | `()` — used to save image caption |
