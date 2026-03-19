# 12 — Source Document Viewer and Editor

## Purpose

This document specifies the Source Document (Context Doc) viewing and editing
experience in LOOM: how documents are opened, the editor interface, Markdown
rendering, template placeholder navigation, and and inline context doc injection.

> **Coding-agent note:** The editor is `src/components/DocEditor.tsx`. It renders
> inside the Theater pane, replacing the story view when a document is open.
> The editor uses a simple `<textarea>` for input and a `<div>` for rendered
> Markdown preview (using `marked` or `remark`). Document content is stored
> in the `items` table `content` column.

---

## 1. Opening a Source Document

### 1.1 Open Triggers

- **Double-click** on a Source Document item in the Navigator vault tree
- **Right-click → Open** in the context menu

### 1.2 Theater Behaviour When Doc is Open

The DocEditor overlays the Theater content area. The message list and input area
are hidden (not destroyed). The active story remains in memory.

**Header bar** replaces Theater toolbar:

```
┌──────────────────────────────────────────────────────────────────┐
│  ← Back to Story    📄 Character Profile — Elara Voss    [Save] │
└──────────────────────────────────────────────────────────────────┘
```

- `← Back to Story`: closes editor, returns to Theater (save guard if dirty)
- Document name + type label
- `[Save]`: accent button, saves immediately (`Ctrl+S` also saves)
- Unsaved indicator: `·` dot appended to doc name when dirty

---

## 2. Editor Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  ← Back to Story  📄 Character Profile — Elara Voss  [Preview] [Save]│
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ## Elara Voss                                                   │
│  **Age:** {{age}}                                               │
│  **Occupation:** {{occupation}}                                 │
│                                                                  │
│  ### Backstory                                                   │
│  {{backstory}}                                                  │
│                                                                  │
│  [Tab → next placeholder]                                       │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

- **Editor pane:** `<textarea>`, full-height, monospaced font (`--font-mono`, `13px`),
  `--color-bg-base` background, no border
- **Preview toggle:** `[Preview]` button in header. Switches between edit and rendered
  Markdown view. In preview mode: `--font-theater-body`, `15px`, standard prose rendering
- No split-view in v1 — toggle only

---

## 3. Template Placeholders

### 3.1 Placeholder Format

`{{placeholder_name}}` — double curly braces.

When a document is created from a template, the template's `default_content` is
inserted verbatim including placeholders. The `Tab` key navigates between them.

### 3.2 `Tab` Navigation

- `Tab`: jump to next `{{placeholder}}` in document (selects the entire `{{...}}` text)
- `Shift+Tab`: jump to previous `{{placeholder}}`
- If no placeholders remain in forward direction: `Tab` inserts 2 spaces instead
- Placeholder navigation state is UI-only (not persisted)

### 3.3 Placeholder Detection

```ts
const PLACEHOLDER_RE = /\{\{[^}]+\}\}/g;

function findPlaceholders(content: string): Array<{ start: number; end: number; text: string }> {
  const matches = [];
  let m;
  while ((m = PLACEHOLDER_RE.exec(content)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  }
  return matches;
}
```

---

## 4. Save Behaviour

### 4.1 Auto-Save on Blur

The document content saves automatically when the editor textarea loses focus
(user clicks elsewhere in the app). Does not save mid-edit.

### 4.2 Manual Save

`Ctrl+S` or `[Save]` button → calls `vault_update_item_content(id, content)`.
Success: inline `lucide-react Check` flash (300ms) next to `[Save]` button.

### 4.3 Unsaved Changes Guard

When editor has unsaved changes and user tries to navigate away:

```
Unsaved changes
  "Elara Voss" has unsaved changes that will be lost.

                      [Discard]   [Save and Close]
```

Triggers on:
- `← Back to Story` click
- Clicking a different story in Navigator
- `Escape` (priority 5 in Escape chain when editor has unsaved changes)
- World switch

### 4.4 `vault_update_item_content` Tauri Command

```rust
#[tauri::command]
pub async fn vault_update_item_content(
    state: tauri::State<'_, AppState>,
    id: String,
    content: String,
) -> Result<(), LoomError>
```

Updates `items.content` and `items.modified_at`.

---

## 5. Markdown Preview

Preview mode renders the document content as Markdown using `marked` (or `remark`).

Rendered styles applied:
- `h1`, `h2`, `h3`: Inter, appropriate sizes, `--color-text-primary`
- `p`: `--font-theater-body`, `15px`, `1.7` line-height, `--color-text-primary`
- `strong`: `Inter 600`
- `em`: italic
- `code` (inline): `--font-mono`, `13px`, `--color-bg-elevated` background, `3px 5px` padding
- `pre code` (block): `--font-mono`, `13px`, `--color-bg-elevated` background, `12px` padding,
  `border-radius: 4px`
- `blockquote`: left border `3px solid --color-border`, `--color-text-secondary`, `padding-left: 12px`
- `hr`: `--color-border`
- `a`: `--color-accent-text`, no underline on hover
- Lists: standard indentation, `8px` item gap

Placeholder tokens (`{{placeholder}}`) not highlighted in preview mode.

---

## 6. Image Documents

Source Documents of type `image` (subtype `"image"`) open in a simple
lightbox-style view instead of the text editor:

```
┌──────────────────────────────────────────────────────────────────┐
│  ← Back to Story    🖼 Reference — Castle Exterior               │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│              [ Image rendered full-size, centered ]              │
│                                                                  │
│   Caption: [ Gothic architecture, stormy sky  ]   [Save]        │
└──────────────────────────────────────────────────────────────────┘
```

- Image stored as file in `worlds/<world_id>/images/<uuid>.<ext>`
- Caption stored in `items.content`
- No text editor for image items — only caption field

---

## 7. Context Doc Injection

### 7.1 Overview

When a text Source Document is attached to a story as a Context Doc, its content
is sent **inline with the current request only**. It is never added to the
conversation history — this avoids bloating the history with repeated document
content on every turn.

Image documents attached as Context Docs are uploaded to the Gemini File API
and sent as file URIs (see Doc 19 — Media System: Image Uploads).

### 7.2 Request Assembly

In `send_message`, for each attached context doc:

```
For text Source Documents:
  → Read items.content
  → Include inline as { text: "[CONTEXT DOC: <name>]\n<content>" }
    in the current request's parts (not in history turns)

For image Source Documents:
  → Upload to Gemini File API if no cached URI
  → Include as { fileData: { fileUri: "<uri>", mimeType: "<mime>" } }
```

Text context docs are assembled as additional parts in the **current user turn**
(after the user's plot direction / background / modificators), not as separate
history entries. This ensures the AI sees the documents but they don't accumulate
in the message history.

### 7.3 No File API for Text Documents

Text Source Documents are **always sent inline**, regardless of size. The Gemini
File API is reserved for binary content (images). This simplifies the architecture
and avoids URI caching / invalidation complexity for text content.

---

## 8. Keyboard Shortcuts (Editor-Specific)

| Shortcut | Action |
|---|---|
| `Ctrl+S` | Save document |
| `Tab` | Jump to next `{{placeholder}}` (or insert 2 spaces if none) |
| `Shift+Tab` | Jump to previous `{{placeholder}}` |
| `Escape` | Close editor (triggers unsaved changes guard if dirty) |

---

## 9. Tauri Command Reference

| Command | Parameters | Returns |
|---|---|---|
| `vault_get_item` | `id: String` | `VaultItem` |
| `vault_update_item_content` | `id: String, content: String` | `()` |
| ~~`upload_doc_to_file_api`~~ | *Removed — text docs always inline; images use File API (Doc 19)* | — |
