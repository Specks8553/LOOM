# PATCH — 12-Source-Document-Viewer-and-Editor.md
# Issues addressed: #4 (assets/ path), #5 (caption in items.content),
#   #1/#2 (File API cache + expiry via get_or_upload_file_api_uri)
# Apply: replace the listed sections in full.
---

## SECTION 6 — Image Documents (FULL REPLACEMENT)

Source Documents of type `image` (subtype `image`) open in a simple lightbox-style
view instead of the text editor:

```
← Back to Story    Reference: Castle Exterior
[  image rendered full-size, centered  ]
Caption: [ Gothic architecture, stormy sky        ] [Save]
```

- **Asset storage:** `worlds/<world_id>/assets/<item_id>.<ext>` — the canonical
  path defined in Doc 19 §1.1. There is no `images/` subdirectory.
- **Caption:** stored in `items.content` (plain string, not JSON). Empty string
  `""` by default on upload; updated by the user via the caption field.
  Saved with `vault_update_item_content(id, caption)` on blur or Save button click.
- **No text editor** for image items — only the caption field.
- **Lightbox URL** constructed via `convertFileSrc` + `vaultStore.activeWorldDir`
  (identical to the Navigator hover thumbnail, see Doc 19 §3.2).

---

## SECTION 7.2 — Request Assembly: Image Context Docs (FULL REPLACEMENT)

```
In send_message, for each attached context doc:

  For text Source Documents:
    Read items.content.
    Include inline as text "CONTEXT DOC [name]:\n[content]" in the current
    request's parts — not in history turns.

  For image Source Documents:
    Call get_or_upload_file_api_uri(conn, item_id, world_dir)
      → defined in Doc 19 §5.1 (vault.rs).
      → Caches the File API URI in items.file_api_uri.
      → Re-uploads automatically when the cached URI is ≥ 47 hours old.
    Include the returned URI as:
      fileData { fileUri: uri, mimeType: mime }
    On LoomError::Io (asset missing) or LoomError::Api (File API failure):
      Skip this image doc; log warn!; show toast:
      "Context image \'[name]\' could not be sent (File API error)."
      Continue send with remaining context docs.
```

Text context docs are assembled as additional parts in the current user turn,
after the user's plot direction / background / modificators.
This ensures the AI sees the documents but they do not accumulate in history.

---

## SECTION 7.3 — No File API for Text Documents (unchanged, reproduced for clarity)

Text Source Documents are always sent inline, regardless of size.
The Gemini File API is reserved for binary content (images).
This simplifies the architecture and avoids URI caching / invalidation complexity
for text content.
