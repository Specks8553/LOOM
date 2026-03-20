# 19 — Media System: Image Uploads (v1)

## Purpose

This document specifies image upload, storage, display, and Context Doc attachment
for the LOOM vault. Images are first-class vault items stored as files on disk
with database references. They render as thumbnails in the Navigator and inline
in message bubbles in the Theater.

> **Coding-agent note:** `ItemType::Image` is a first-class item type. Image
> binaries are stored in `worlds/<world_id>/assets/` — never as SQLite BLOBs.
> The `items` table row stores the relative asset path, MIME type, and pixel
> dimensions. All image Tauri commands live in `vault.rs`. Inline rendering
> uses the Tauri asset protocol (`asset://`). World export bundles the `assets/`
> directory alongside `loom.db`.

---

## 1. Data Model

### 1.1 Storage Layout

```
worlds/<world_id>/
├── loom.db
├── world_meta.json
└── assets/
    ├── <item_id>.png
    ├── <item_id>.jpg
    └── <item_id>.webp
```

File naming: `<item_id>.<extension>`. The item ID is the DB primary key UUID.
Supported formats: `jpg`, `jpeg`, `png`, `webp`, `gif` (static only).

### 1.2 `items` Table Extensions

```sql
ALTER TABLE items ADD COLUMN asset_path  TEXT NULL;
-- Relative path from world dir: "assets/<item_id>.png"

ALTER TABLE items ADD COLUMN asset_meta  TEXT NULL;
-- JSON: { "mime": "image/png", "width": 1920, "height": 1080, "size_bytes": 204800 }
```

`NULL` for all non-image item types.

### 1.3 TypeScript Interface

```ts
export interface AssetMeta {
  mime:       string;   // "image/png" | "image/jpeg" | "image/webp" | "image/gif"
  width:      number;
  height:     number;
  size_bytes: number;
}

export interface VaultImageItem extends VaultItemMeta {
  item_type:  "Image";
  asset_path: string;      // relative: "assets/<item_id>.png"
  asset_meta: AssetMeta;
}
```

---

## 2. Upload Flow

### 2.1 `vault_upload_image` Tauri Command

```rust
#[tauri::command]
pub async fn vault_upload_image(
    state: tauri::State<'_, AppState>,
    src_path: String,     // absolute path from native dialog
    name: String,         // display name (filename without extension by default)
    parent_path: String,  // vault tree parent path
) -> Result<VaultItemMeta, LoomError>
```

**Steps:**
1. Validate `is_unlocked()`
2. Read file from `src_path`. Validate MIME by magic bytes (not file extension).
   Accept: `image/png`, `image/jpeg`, `image/webp`, `image/gif`.
3. Enforce max file size: **10 MB**. Return `LoomError::Io` if exceeded.
4. Generate UUID `item_id`
5. Create `assets/` directory if absent
6. Copy source file to `worlds/<world_id>/assets/<item_id>.<ext>`
7. Read pixel dimensions using `image` crate
8. Build `asset_meta` JSON
9. Insert into `items` table (`content = ""` for image items)
10. Return `VaultItemMeta`

### 2.2 Frontend Trigger

- **Drag-and-drop** onto the Navigator tree (Tauri drag event)
- **`[+ Image]`** in Navigator toolbar `+` menu → native file picker (image types)

```ts
export async function vaultUploadImage(
  srcPath: string, name: string, parentPath: string
): Promise<VaultItemMeta> {
  return invoke("vault_upload_image", { srcPath, name, parentPath });
}
```

---

## 3. Display in Navigator

### 3.1 Image Tree Item

| Element | Behaviour |
|---|---|
| Icon | `lucide-react Image`, `16px` |
| Hover thumbnail | Floating tooltip, `max: 160 × 160px`, uses `asset://` protocol |
| Right-click menu | Rename · Delete · Attach as Context Doc · Properties |

### 3.2 Asset Protocol URL

```ts
import { convertFileSrc } from "@tauri-apps/api/core";

const assetUrl = convertFileSrc(`${worldDir}/${item.asset_path}`);
// → asset://localhost/<absolute_path>
```

`worldDir` (absolute world directory path) stored in `vaultStore.activeWorldDir`.

---

## 4. Inline Images in Message Bubbles

### 4.1 Message Content Format

When a user message contains images, `content` is stored as a JSON array
of `MessageBlock[]`. Plain text messages remain plain strings.
`content_type` column handles detection — no prefix sniffing.

```ts
type MessageBlock =
  | { type: "text";  text: string }
  | { type: "image"; item_id: string; asset_path: string };
```

When `content_type === "blocks"`: parse `content` as `MessageBlock[]`.

### 4.2 Inserting an Image into a Message

Image insert button in the Theater input area attachment row:

```
[🖼 + Image]   [▼ Background]  [▼ Modificators]
```

Click → **Vault Image Picker modal**: grid of all image items, thumbnails.
Selecting appends an image block. Image renders as dismissible thumbnail chip in input.

### 4.3 Rendering in Bubbles

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
  return <ReactMarkdown>{msg.content}</ReactMarkdown>;
}
```

`<InlineImage />`: renders with `convertFileSrc`, click → full-screen lightbox.

### 4.4 Thumbnail Sizes

| Context | Max size | Behaviour |
|---|---|---|
| Navigator hover | `160 × 160px` | Proportional fit |
| Inline in bubble | `100% bubble width × 400px max` | Proportional, click to expand |
| Lightbox | `90vw × 90vh` | Click outside to close |

### 4.5 Sending Images to Gemini

```rust
for block in message_blocks {
    match block {
        MessageBlock::Text { text } => parts.push(Part::text(text)),
        MessageBlock::Image { asset_path, .. } => {
            let bytes = std::fs::read(&abs_asset_path)?;
            if bytes.len() <= 4_000_000 {
                parts.push(Part::inline_data(mime_type, base64::encode(bytes)));
            } else {
                let uri = upload_to_file_api(&bytes, &mime_type).await?;
                parts.push(Part::file_data(uri));
            }
        }
    }
}
```

Inline base64 for images ≤ 4 MB; Gemini File API upload for larger images.

---

## 5. Image as Context Doc

Image items support the `[📎]` paperclip attachment in the Navigator, identical
to text Source Documents.

On attach: image file uploaded to Gemini File API as binary.
Returned `file_uri` used as `file_data` part in context block (alongside text docs).
Attachment highlighted in Navigator with accent color.

---

## 6. Deletion

- **Soft delete** `vault_soft_delete(id)`: sets `deleted_at` on DB row.
  Asset file on disk is **not deleted** at this point.
- **Purge** `vault_purge_item(id)`: deletes DB row AND asset file:
  ```rust
  std::fs::remove_file(&abs_asset_path).ok(); // best-effort, log on failure
  conn.execute("DELETE FROM items WHERE id = ?1", [id])?;
  ```
- **Empty Trash**: for each image item, delete asset file before bulk `DELETE`.

---

## 7. World Export / Import

### 7.1 Export Format

`.loom-backup` is a **zip archive** containing:

```
loom-backup/
├── loom.db       ← SQLCipher encrypted database
└── assets/       ← image files (not individually encrypted)
    ├── <id>.png
    └── <id>.jpg
```

```rust
pub async fn vault_export_world(dest_path: String) -> Result<(), LoomError> {
    // 1. Backup loom.db via SQLite Online Backup API
    // 2. Copy assets/ directory recursively
    // 3. Bundle both into <dest>.loom-backup zip archive
}
```

**Security note:** Asset files in the backup archive are not individually
encrypted. The zip file is protected only by filesystem permissions.
Display this caveat in the export dialog.

`Cargo.toml`:
```toml
zip   = { version = "2", default-features = false, features = ["deflate"] }
image = { version = "0.25", default-features = false,
          features = ["png", "jpeg", "webp", "gif"] }
```

### 7.2 Import

`vault_import_world` extracts the zip archive, places `loom.db` and `assets/`
in the new world directory, then proceeds with existing import logic.

---

## 8. Tauri Command Reference

| Command | Parameters | Returns |
|---|---|---|
| `vault_upload_image` | `src_path, name, parent_path` | `VaultItemMeta` |
| `vault_export_world` | `dest_path: String` | `()` |
| `vault_import_world` | `src_path: String` | `WorldMeta` |
| `vault_read_item` | `id: String` | `VaultItem` |