# PATCH — 09-Conversation-and-Message-System.md
# Issues addressed: #3 (user message content_type), #6 (history assembly for images)
# Apply: replace the listed sections in full with the content below.
---

## SECTION 1.2 — Content Type Mapping (FULL REPLACEMENT)

> **Rule:** `content_type = "blocks"` is reserved exclusively for **model** messages
> that contain AI-generated images (Doc 20). User messages always use `"jsonuser"`.

| role  | content_type | content value |
|-------|-------------|---------------|
| user  | `jsonuser`  | `{plot_direction, background_information, modificators, image_blocks?}` — `image_blocks` omitted when no images are attached |
| model | `text`      | Plain Markdown string |
| model | `blocks`    | JSON array of `MessageBlock[]` — only when Doc 20 image generation appends a generated image to the AI response |

> Never detect content type via prefix — always use `content_type` field.

---

## SECTION 1.3 — ChatMessage TypeScript Interface (PARTIAL — add ImageBlock + update UserContent)

Add `ImageBlock` interface and extend `UserContent` with optional `image_blocks`:

```ts
export interface ImageBlock {
  item_id:    string;   // references items.id
  asset_path: string;   // relative: "assets/<item_id>.<ext>"
}

export interface UserContent {
  plot_direction:          string;
  background_information:  string;
  modificators:            string[];
  image_blocks?:           ImageBlock[];  // omitted or [] when no images attached
}
```

> `image_blocks` is serialised as part of the `messages.content` JSON alongside the
> three text fields. The `content_type` remains `"jsonuser"` regardless of whether
> images are present. This keeps the edit flow intact — re-entering edit mode on a
> user message repopulates all fields including the image chips from `image_blocks`.

---

## SECTION 4.2 — Gemini Request Assembly (FULL REPLACEMENT)

`build_user_turn` now returns `Vec<Part>` to accommodate image parts alongside text.
The **stored** `messages.content` is unchanged (raw `UserContent` JSON).
The `Vec<Part>` is a **runtime-only** Gemini representation, never persisted.

```rust
/// Assembles all Gemini `Part`s for a user turn.
/// Always returns at least one text Part; image Parts follow when present.
pub async fn build_user_turn(
    content:   &UserContent,
    conn:      &Connection,
    world_dir: &Path,
) -> Vec<Part> {
    let mut parts = Vec::new();

    // ── Text part ──────────────────────────────────────────────────────────
    let mut segments = vec![
        format!("PLOT DIRECTION:\n{}", content.plot_direction.trim()),
    ];
    if !content.background_information.trim().is_empty() {
        segments.push(format!(
            "\nBACKGROUND INFORMATION (NOT FOR THE READER):\n{}",
            content.background_information.trim()
        ));
    }
    if !content.modificators.is_empty() {
        segments.push(format!("\nMODIFICATORS:\n{}", content.modificators.join(", ")));
    }
    parts.push(Part::text(segments.join("")));

    // ── Image parts ────────────────────────────────────────────────────────
    if let Some(ref image_blocks) = content.image_blocks {
        for block in image_blocks {
            let abs_path = world_dir.join(&block.asset_path);
            match std::fs::read(&abs_path) {
                Ok(bytes) => {
                    let mime = get_asset_mime(conn, &block.item_id)
                        .unwrap_or_else(|_| "image/jpeg".to_string());
                    if bytes.len() <= 4_000_000 {
                        parts.push(Part::inline_data(mime, base64::encode(&bytes)));
                    } else {
                        match get_or_upload_file_api_uri(conn, &block.item_id, world_dir).await {
                            Ok(uri) => parts.push(Part::file_data(uri)),
                            Err(e)  => log::warn!("Image send skipped ({}): {e}", block.item_id),
                            // Image omitted; text send continues uninterrupted
                        }
                    }
                }
                Err(e) => {
                    log::warn!("Asset file missing ({}): {e}", block.item_id);
                    // Image omitted; text send continues uninterrupted
                }
            }
        }
    }

    parts
}
```

> `get_asset_mime` is a small helper: `SELECT json_extract(asset_meta, '$.mime') FROM items WHERE id = ?1`.
> `get_or_upload_file_api_uri` is defined in Doc 19 §5.1 and lives in `vault.rs`.

---

## SECTION 8.1 — Edit User Message: Enter Edit Mode (ADD paragraph at end)

> When entering edit mode on a user message that contains `image_blocks`, the image
> chips are re-populated in the input area from the parsed `UserContent.image_blocks`.
> The user may add or remove images before re-sending. The new `UserContent` (with the
> updated `image_blocks`) is stored in the new sibling message as normal.
