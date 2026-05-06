# 18 — Source Documents

> **Status:** Complete
> **Last updated:** 2026-05-03 — pre-implementation audit resolution: `attachment_history.event` (and new `reason` column) reconciled with Doc 03 (HB-2); `vault_updated` event payload documented as `{ world_id }` matching Doc 07 — frontend reloads via `list_items` (IP-8); `attach_context_doc` / `detach_context_doc` returning `Vec<String>` confirmed (CD-8).
> **Earlier:** 2026-04-29 — first full design pass; Source Document Creator deferred to v2.1 (see `docs-v2/future/source-document-creator.md`); editor model retains v1's textarea + Markdown preview toggle; save changes to debounced auto-save (~1 s); attach via vault paperclip / right-click only, detach via right pane only; soft-delete cascades to detach; image lightbox spec'd here, File API mechanics owned by Doc 19
> **Scope:** Source Documents — text or image vault items that supply the model with reference material (world bible, character sheets, scene notes, lore images). The doc covers the editor (DocEditor), the attach / detach lifecycle, request-assembly inclusion rules across all three modes, and template management.

Source Documents are the writer's reference library. Unlike a story, a source document does not have a conversation — it has *content*, which is fed to the model on every relevant request as context. The writer authors and curates source documents through the **DocEditor**, attaches them to one or more stories as Context Documents, and trusts that every send (story / handover / consulting) carries them forward.

This doc owns: the DocEditor visual + behaviour, the attach / detach surfaces, the cascade rules when documents are renamed / deleted / restored, the request-assembly contract for source docs, and the templates system. It does **not** own File API upload mechanics for images (Doc 19), the cache prefix layout (Doc 22), or the modes' SI / session shape (Doc 23).

---

## Item Types Covered

Three of the four `items.item_type` values are in scope here:

| `item_type` | `item_subtype` | Editor view | Sent to model |
|---|---|---|---|
| `SourceDocument` | template slug (e.g. `character_profile`) | DocEditor (textarea + Markdown preview toggle) | Inline text in cache prefix |
| `Image` | `image` | Lightbox view (full-size image + caption field) | File API URI in cache prefix |
| `Folder` | NULL | n/a — folders are vault-only | n/a |

`Story` items have their own editor (the Theater) and are not source documents. The remaining sections of this doc only address `SourceDocument` and `Image`.

---

## DocEditor

### When the editor opens

The DocEditor opens via:
- **Double-click** on a `SourceDocument` or `Image` item in the Navigator vault tree.
- **Right-click → Open** on the same.
- **Just-created** — when the Create Source Document flow completes (Doc 14 §Create source document), the editor opens immediately on the new item.

The editor sets `workspaceStore.activeDocId = <item id>`. Setting `activeDocId` is mutually exclusive with reading from the Theater — see §Mode-Switcher Interplay below.

### Layout — text source documents

```
┌────────────────────────────────────────────────────────────────────┐
│  ← Back     📄 Character Profile — Elara Voss          [Preview]  │  ← header bar
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ## Elara Voss                                                     │
│  **Age:** {{age}}                                                  │
│  **Occupation:** {{occupation}}                                    │
│                                                                    │
│  ### Backstory                                                     │
│  {{backstory}}                                                     │
│                                                                    │
│                                                                    │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

| Region | Content |
|---|---|
| Header — left | `← Back` button (closes editor; returns to whatever was active before) |
| Header — middle | Item icon (template icon if SourceDocument, image glyph if Image) + item name + an unsaved-changes dot `·` while a debounced save is pending |
| Header — right | `[Preview]` toggle for SourceDocument (text only); absent for Image |
| Body | A full-height `<textarea>` in `--font-mono` 13px, `--color-bg-base` background, no border, generous padding |

The body switches between **edit mode** (textarea) and **preview mode** (rendered Markdown div) via the `[Preview]` toggle. Mode is in-memory only; closing and re-opening the editor returns to edit mode by default.

### Layout — image source documents

```
┌────────────────────────────────────────────────────────────────────┐
│  ← Back     🖼 Reference — Castle Exterior                         │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│                                                                    │
│              [ Image rendered full-size, centered ]                │
│                                                                    │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│  Caption  [ Gothic architecture, stormy sky                     ]  │
└────────────────────────────────────────────────────────────────────┘
```

The image renders via `convertFileSrc` against `vaultStore.activeWorldDir + asset_path`. The caption is a single-line input that maps to `items.content` (an Image item stores its caption — and only its caption — in the `content` column). The byte-level upload, asset-path discovery, File API URI lifecycle, and thumbnail rendering are owned by Doc 19.

### Markdown preview rendering

Preview mode renders the textarea content as Markdown. ⚠️ The exact renderer (`marked`, `remark`, `markdown-it`) is an implementation choice; whatever lands must be GFM-compatible.

| Element | Style |
|---|---|
| `h1` / `h2` / `h3` | Inter, scaled per Doc 08 type ramp, `--color-text-primary` |
| `p` | `--font-theater-body` 15px, line-height 1.7, `--color-text-primary` |
| `strong` | Inter 600 |
| `em` | italic |
| `code` (inline) | `--font-mono` 13px, `--color-bg-elevated` background |
| `pre code` | `--font-mono` 13px, `--color-bg-elevated`, padded, rounded |
| `blockquote` | 3px left border `--color-border`, `--color-text-secondary` |
| `a` | `--color-accent-text`, no underline-on-hover |
| Lists | standard indent, 8px item gap |

`{{placeholder}}` tokens are **not** styled differently in preview — they render as literal `{{...}}` text. They are an *editing* affordance, not a presentation feature.

### Save behaviour — debounced auto-save

Editing the textarea schedules a debounced save:
- **Debounce window:** 1000 ms after the last keystroke.
- **Trigger:** any keystroke that changes content (`onChange`).
- **Action:** call `update_item_content(item_id, content)` in the background.
- **Visual:** the unsaved-changes dot `·` next to the item name appears as soon as content diverges from the last saved state and disappears as soon as the save resolves successfully.

**No `[Save]` button. No on-blur trigger. No unsaved-changes guard modal.** The writer never thinks about saving; the system saves continuously. This matches the draft-saving model in Doc 15 §Drafts.

| Edge case | Behaviour |
|---|---|
| Save fails (DB error, vault locked) | Toast: `"Couldn't save document — <reason>"`. Unsaved dot persists. Next keystroke re-schedules. |
| Editor closed with a debounced save still pending | Pending save is awaited before the close completes (analogue of Doc 15's draft-on-lock rule). |
| Vault locked with a debounced save still pending | Lock command awaits the pending save before zeroing keys. |
| World switch with a debounced save still pending | Switch awaits pending save; the new world's docs are loaded fresh. |

For an Image item the same rule applies — typing in the caption field triggers the same debounce against `update_item_content` (the caption is the content). No separate save command for images.

### Tab placeholder navigation

While at least one `{{placeholder}}` token exists in the textarea content:
- `Tab` — selects the next `{{...}}` token from the cursor position. Wraps to the first match if past the last.
- `Shift+Tab` — selects the previous token, wrapping if needed.
- The textarea's normal Tab-shifts-focus behaviour is suppressed in this state.

When **no placeholders remain** in the document:
- `Tab` inserts two spaces (literal indent).
- `Shift+Tab` is a no-op.

Detection uses the regex `/\{\{[^}]+\}\}/g` against the live textarea value on each keystroke; navigation state itself is computed on demand at Tab-press time and is not persisted.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Tab` | Next placeholder (or insert two spaces if none) |
| `Shift+Tab` | Previous placeholder (or no-op) |
| `Escape` | Close editor (no save guard — debounced save flushes on close) |

`Ctrl+S` is **not** wired. There is no manual save concept. ⚠️ If the writer's muscle memory complains during testing, re-evaluate whether to bind it as a no-op flush.

---

## Mode-Switcher Interplay

Per Doc 23, the workspace shell has a top-bar mode switcher (Story / Handover / Consulting). When the DocEditor opens it takes the entire workspace surface — the mode switcher is **hidden**, the right pane is **hidden**, and the Theater is **hidden**. The editor is its own focused state.

```
┌────────────────────────────────────────────────────────────────────┐
│  Navigator  │           DocEditor (full width)                     │
│             │                                                      │
│  …          │   ← Back     📄 Character Profile — Elara Voss       │
│             │   ──────────────────────────────────────────         │
│             │                                                      │
│             │   ## Elara Voss                                      │
│             │   …                                                  │
│             │                                                      │
└────────────────────────────────────────────────────────────────────┘
```

The Navigator (left pane) remains visible and interactive — the writer can click another item to switch the editor's target.

### Returning from the editor

`← Back` (or `Escape`) sets `activeDocId = null`. The mode switcher and right pane reappear; the previously-active mode (story / handover / consulting) is restored from `story_state.active_mode`.

Closing the editor does **not** affect any in-flight generation — if the writer was streaming a story turn when they opened a doc, the stream continues in the background; on return, the Theater shows the completed message.

### Switching modes while the editor is open

Not possible directly — the mode switcher is hidden. The writer must `← Back` first. This reinforces that document editing and mode operation are distinct activities. No unsaved-changes prompt on close (debounced save handles persistence).

### Switching the active story while the editor is open

If the writer clicks a different story in the Navigator while a doc editor is open, the editor stays open on its current document (docs are vault-scoped, not story-scoped). The mode switcher is still hidden (editor is open). The active story has changed in the background; on `← Back` the workspace returns to the new story's mode and Theater state.

### Per-item editor closure

If the currently-edited item is soft-deleted or hard-deleted by another action (e.g. via the Trash flow), the editor closes immediately (no warning — the action that deleted it was the user's). If the editor was open on an attached doc that's been auto-detached by deletion, the editor still closes; the detach is a separate effect.

---

## Templates

### Schema (recap from Doc 03)

```sql
CREATE TABLE templates (
    id                   TEXT PRIMARY KEY,
    slug                 TEXT NOT NULL UNIQUE,
    name                 TEXT NOT NULL,
    icon                 TEXT NOT NULL DEFAULT 'FileText',
    default_content      TEXT NOT NULL DEFAULT '',
    creator_instructions TEXT NOT NULL DEFAULT '',
    is_builtin           INTEGER NOT NULL DEFAULT 0,
    sort_order           INTEGER NOT NULL DEFAULT 0,
    created_at           TEXT NOT NULL,
    modified_at          TEXT NOT NULL
);
```

Built-ins seeded on world creation: `image`, `character_profile`, `world_building`. Built-ins cannot be deleted; they can be renamed and have their content edited, with a Restore Default action per template.

### `creator_instructions` — reserved for v2.1

`creator_instructions` is **not used in v2.0**. The Source Document Creator that consumes this field was deferred — see `docs-v2/future/source-document-creator.md`. The schema field is retained so that v2.1 can ship the Creator without a migration.

### Settings — Templates management

Owned by Doc 20 (Settings, currently a stub). The expected operations:

| Action | Affects | Notes |
|---|---|---|
| Create template | New row with `is_builtin = 0` | Slug auto-derived from name |
| Rename template | `templates.name` | Allowed for built-ins and user templates |
| Edit `default_content` | `templates.default_content` | Allowed for both |
| Edit `creator_instructions` | `templates.creator_instructions` | Field exists; ignored until v2.1 |
| Delete template | `is_builtin = 0` only | User-defined templates only |
| Restore default | Built-in only | Resets `name`, `icon`, `default_content`, `creator_instructions` to seed values |

A template change does **not** affect existing documents — `default_content` is copied into `items.content` at creation time and never re-read.

### Creating a source document from a template

Already specified in Doc 14 §Create source document:

1. "+" → New Source Document, **or** right-click → New Source Document.
2. Modal: `Name` + `Template ▾` (defaults to Blank).
3. On Create: the new `items` row is inserted with `item_subtype = <template slug>`, `content = <template default_content>` (verbatim, including all `{{placeholders}}`).
4. DocEditor opens on the new item.

A `Blank` template is implicit — selecting it skips the `default_content` copy and creates an empty document with `item_subtype = NULL`.

---

## Context Doc Attachment

Source documents become *Context Documents* when they're attached to a story. The story's `story_state.context_doc_ids` JSON array tracks the attachments in insertion order. Cache prefix construction (Doc 22) reads this array to determine which docs are sent on every relevant request.

### Attach surfaces — vault-side only

The writer attaches a doc from the vault. There are **two affordances**, both in the Navigator:

1. **Hover paperclip** — when the writer hovers a `SourceDocument` or `Image` row in the vault tree, a paperclip icon appears in the row's right gutter. Click attaches the item to the active story. The icon is filled (`--color-accent`) when the item is already attached to the active story; clicking a filled paperclip is a no-op (use the right pane to detach — see below).
2. **Right-click → Attach to story** — context menu entry. Disabled when the item is already attached, and disabled when no story is active.

The Right Pane's Context Documents section does **not** offer an attach affordance (no `+` button, no picker modal). All attachment originates from the vault, where the writer can see the item they want.

Attach behaviour:
- Calls `attach_context_doc(story_id, doc_id)`; receives the new `Vec<String>` (ordered `context_doc_ids`).
- Adds `doc_id` to `story_state.context_doc_ids` (insertion order — appended).
- Inserts an `attachment_history` row (`event = 'attach'`, `reason = NULL`).
- Marks the story cache stale (Doc 22 §Stale Triggers).
- Emits `vault_updated { world_id }` (so other vault rows refresh their paperclip state via a fresh `list_items`) and `cache_state_changed`.

### Detach surface — right pane only

The Right Pane's Context Documents section lists currently-attached docs in insertion order, each with a small `×` (close) icon. Click `×` to detach. Doc 27 / Doc 10 own the visual detail; this section owns the behaviour.

Detach behaviour:
- Calls `detach_context_doc(story_id, doc_id)`; receives the new `Vec<String>` (ordered `context_doc_ids`).
- Removes `doc_id` from `story_state.context_doc_ids`.
- Inserts an `attachment_history` row (`event = 'detach'`, `reason = NULL`).
- Marks the story cache stale.
- Emits `vault_updated { world_id }` and `cache_state_changed`.

### Why split: vault-attach, right-pane-detach

The writer attaches *while browsing* the vault for a relevant doc — that's the natural moment to commit. The writer detaches *while looking at the right pane and seeing the current attachment list* — that's when they realise something doesn't belong. Splitting the surfaces matches the moment-of-decision in each direction. The Right Pane's role is "review the current list and prune"; the vault's role is "discover what to add."

### What can be attached

| `item_type` | Attachable? | Sent how |
|---|---|---|
| `SourceDocument` | ✅ | Inline text in cache prefix |
| `Image` | ✅ | File API URI in cache prefix (Doc 19) |
| `Folder` | ❌ — paperclip + Attach context entry hidden | — |
| `Story` | ❌ — same | — |

### Maximum attachments

No hard limit. The token meter (Doc 15 §Status Section) shows the cumulative cache-prefix size; large attachment counts surface there. The writer is responsible for the cost / context trade-off.

---

## Request-Assembly Inclusion Rules

Source documents are sent on **every** story / handover / consulting request, in insertion order from `story_state.context_doc_ids`. They are part of the cache prefix when caching is active (Doc 22) and are included inline when not.

### Header format (locked from Doc 22 §O13)

Each source doc is wrapped in a header line:

```
=== SOURCE DOCUMENT: <subtype> — <name> ===
<content>
```

Where:
- `<subtype>` is the resolved template slug (e.g. `character_profile`); for items with `item_subtype = NULL`, the literal string `Blank` is used.
- `<name>` is `items.name`.
- `<content>` is `items.content` verbatim — placeholders included if the writer left them; markdown preserved (the model parses fine).

For Image items the format is identical except `<content>` is replaced by a `fileData` part referencing the cached or freshly-uploaded File API URI. The header is still emitted as a sibling text part, so the model has the human-readable label adjacent to the binary.

### Position in the request

Source docs are placed **before** the story / session history, as a leading user/model pair (per Doc 22 §3 / v1.0 §10.2 layout). This is what makes them cache-friendly: a stable prefix that doesn't change between turns.

### Inclusion across modes

| Mode | Source docs included? |
|---|---|
| Story | ✅ — cached in story cache |
| Handover | ✅ — inline (handover is uncached per Doc 22) |
| Consulting | ✅ — cached in per-session cache, captured in `entry_snapshot` |

All three modes see the same source doc set as story mode. Sessions capture the attachment list at session-start time via `entry_snapshot`; subsequent attach / detach during the session updates the story state but does **not** affect the in-flight session (the snapshot is authoritative for that session).

### Image File API mechanics

Owned by Doc 19. Doc 18's contract: when the request assembler encounters an `Image` source doc, it calls `get_or_upload_file_api_uri(conn, item_id, world_dir)` (Doc 19 §Gemini File API URI Cache). On `LoomError::Io` (asset missing) or `LoomError::Api` (File API failure), the assembler:
- Skips this image doc.
- Logs a `warn!` with the item ID.
- Surfaces a toast: `"Context image '<name>' could not be sent (File API error)."`
- Continues with the remaining context docs.

The send proceeds; the image is silently dropped from this request only (the next attempt re-tries the upload).

---

## Cascade Rules

### Soft-delete (move to Trash)

When a `SourceDocument` or `Image` item is moved to Trash (`items.deleted_at` set):

1. The backend reads every `story_state` row where `context_doc_ids` contains this `doc_id`.
2. For each such story, the `doc_id` is stripped from the array.
3. An `attachment_history` row (`event = 'detach'`, `reason = 'soft_delete'`) is inserted for each affected story.
4. Each affected story's cache is marked stale.
5. `vault_updated` and `cache_state_changed` are emitted (one per affected story).

The writer sees the doc disappear from each story's Right Pane Context Documents list. The doc itself remains in the vault (visible in Trash view).

### Restore from Trash

Restoring (`items.deleted_at` cleared) does **not** auto-reattach to any story. The writer must explicitly attach again via the vault paperclip. This avoids the surprise of "where did this attachment come back from" when restoring an item that was attached to multiple stories ago.

### Hard-delete (Empty Trash)

When the doc is permanently deleted:
- `items` row is removed.
- `attachment_history` rows where `doc_id` references this item are removed via `ON DELETE CASCADE` (per Doc 03 schema).
- `story_state.context_doc_ids` arrays are already cleaned (the soft-delete pass cleaned them); nothing further to do for live stories.
- File API: the cached `file_api_uri` (for Image items) is forgotten with the row; a best-effort `DELETE` to the Gemini File API is **not** issued (see Out of Scope).

### Rename

Renaming a SourceDocument or Image (`items.name` changed) updates the `=== SOURCE DOCUMENT: <subtype> — <name> ===` header on the next send, which **changes the cache prefix bytes**. Therefore: a rename of any attached doc marks the story cache stale.

This is already covered by Doc 22 §Stale Triggers (`Source doc content edited (any document currently in either cache's doc_snapshots set)`) — name is part of the cached prefix.

### Content edit

Same as rename — the cached prefix changed. Mark cache stale on every save (the debounced save already calls `update_item_content`, which marks stale per Doc 22 §Stale Triggers).

### Template deletion or restore-default

User-defined template deleted: pre-existing documents that used it are unaffected (they hold a copy of `default_content`). The deleted template's slug remains in `items.item_subtype` for affected docs; the editor renders them with a generic `FileText` icon.

Built-in template restore-default: same — does not touch existing documents.

---

## Data Requirements

| Table | Field | Role in Doc 18 |
|---|---|---|
| `items` | `id`, `parent_id`, `item_type`, `item_subtype`, `name`, `content`, `description`, `sort_order`, `created_at`, `modified_at`, `deleted_at` | Source doc rows |
| `items` | `asset_path`, `asset_meta`, `file_api_uri`, `file_api_uploaded_at` | Image-only fields; managed jointly with Doc 19 |
| `templates` | all columns | Template registry |
| `story_state` | `context_doc_ids` | Per-story attachment list |
| `attachment_history` | all columns | Audit trail consumed by cache staleness |

No new schema in v2.0; everything is already in Doc 03.

---

## Backend API

All commands live in `commands/vault.rs` (per Doc 07's vault domain) — they are vault operations that happen to involve source-doc semantics.

### `update_item_content`

```rust
#[tauri::command]
pub async fn update_item_content(
    state: State<'_, AppState>,
    id: String,
    content: String,
) -> Result<(), LoomError>
```

**Preconditions:** vault unlocked; `id` resolves to an `items` row with `item_type IN ('SourceDocument','Image')`.
**Behaviour:** updates `items.content` and `items.modified_at`. If the item is currently attached to any story (via `story_state.context_doc_ids`), marks each affected story's cache stale and emits `cache_state_changed` per affected story.
**Errors:** `Validation` (item not editable), `NotFound`, `Database`.

### `attach_context_doc`

```rust
#[tauri::command]
pub async fn attach_context_doc(
    state: State<'_, AppState>,
    story_id: String,
    doc_id: String,
) -> Result<Vec<String>, LoomError>  // returns the new context_doc_ids order
```

**Preconditions:** vault unlocked; `story_id` resolves to a `Story` item; `doc_id` resolves to a `SourceDocument` or `Image` (live, not soft-deleted); `doc_id` is not already in this story's `context_doc_ids`.
**Behaviour:** appends `doc_id` to `story_state.context_doc_ids`; inserts `attachment_history` row with `event='attach'`; marks story cache stale; emits `vault_updated` (story-scope) and `cache_state_changed`.
**Errors:** `Validation` (story not active, doc soft-deleted, already attached), `NotFound`, `Database`.

### `detach_context_doc`

```rust
#[tauri::command]
pub async fn detach_context_doc(
    state: State<'_, AppState>,
    story_id: String,
    doc_id: String,
) -> Result<Vec<String>, LoomError>
```

**Preconditions:** vault unlocked; `doc_id` is in `story_state.context_doc_ids`.
**Behaviour:** removes `doc_id` from the array; inserts `attachment_history` row with `event='detach'`; marks story cache stale; emits `vault_updated` and `cache_state_changed`.
**Errors:** `Validation` (not attached), `NotFound`, `Database`.

### `list_attached_docs`

```rust
#[tauri::command]
pub async fn list_attached_docs(
    state: State<'_, AppState>,
    story_id: String,
) -> Result<Vec<VaultItemMeta>, LoomError>
```

**Preconditions:** vault unlocked; story exists.
**Behaviour:** reads `story_state.context_doc_ids`, returns the matching live `items` rows in array order (skipping any IDs that no longer resolve — defensive against legacy state).
**Errors:** `Database`, `NotFound`.

### `list_templates`

```rust
#[tauri::command]
pub async fn list_templates(
    state: State<'_, AppState>,
) -> Result<Vec<Template>, LoomError>
```

**Preconditions:** vault unlocked.
**Behaviour:** returns all rows from `templates` ordered by `sort_order`.

### `create_template` / `update_template` / `delete_template` / `restore_template_default`

Owned by Doc 20 (Settings → Templates). Listed here for cross-reference; full signatures live in Doc 20.

---

## Frontend State (`workspaceStore`)

The DocEditor is part of `workspaceStore` (already declared per Doc 06). Relevant fields:

```typescript
interface WorkspaceStore {
  // ...existing fields...
  activeStoryId: string | null;
  activeDocId: string | null;            // when set, DocEditor takes the workspace surface

  // Existing per-story attachment list (mirrors story_state.context_doc_ids)
  contextDocIds: string[];

  // Doc 18 actions
  openDoc: (id: string) => void;          // sets activeDocId
  closeDoc: () => Promise<void>;          // awaits any pending debounced save; clears activeDocId
  updateDocContent: (id: string, content: string) => void;
                                           // schedules 1 s debounced save
  flushDocSave: () => Promise<void>;     // forces immediate save (called on lock / close / world switch)

  attachDoc: (docId: string) => Promise<void>;
  detachDoc: (docId: string) => Promise<void>;
  loadAttachedDocs: () => Promise<void>;  // reads list_attached_docs for the active story
}
```

The Right Pane's Context Documents section subscribes to `contextDocIds` and renders each as a row with a `×` icon. The vault row's hover paperclip subscribes to `(activeStoryId, contextDocIds)` to determine its filled / unfilled state.

The DocEditor itself is a self-contained React component that takes `activeDocId` and renders the textarea or lightbox accordingly. It does not read from or mutate any other store.

---

## Edge Cases and Error Handling

| Scenario | Behaviour |
|---|---|
| Open a soft-deleted item (e.g. via stale URL) | Editor opens read-only with a banner: `"This document is in Trash — restore to edit."` ⚠️ provisional copy. |
| Save fails (DB error) | Toast `"Couldn't save document — <reason>"`. Unsaved dot persists; next keystroke re-schedules. |
| Save while vault locked (race) | Backend rejects with `LoomError::Validation`; frontend retries on next unlock — pending content is held in memory until then or until close. |
| Edit an attached doc — cache implications | Debounced save calls `update_item_content`, which marks the story cache stale per Doc 22. The right pane's cache section reflects the new state via `cache_state_changed`. |
| Attach an already-attached doc | Backend rejects with `LoomError::Validation`; frontend shouldn't get here (paperclip is filled / attach menu is disabled). |
| Detach a not-attached doc | Same — rejected; defensive only. |
| Attach with no active story | Paperclip disabled / hidden; right-click menu shows the entry as disabled. Backend rejects too. |
| Soft-delete an attached doc | Cascade per §Soft-delete; the doc disappears from the right pane. |
| Restore an item that was attached before deletion | Doc reappears in the vault but is **not** auto-reattached. The writer must reattach via the paperclip. |
| Image asset file missing on disk (Image item) | Lightbox renders a placeholder glyph + caption; the request assembler logs `warn!` and skips the image (Doc 19 owns the upload-side handling). |
| Template deleted while a doc was opened from it | Editor stays open; the doc's content is unaffected (a copy was made at creation). The icon falls back to `FileText`. |
| Two rapid edits within 1 s debounce | Only one save fires (the latest content wins). |
| Open a doc while a story turn is streaming | Allowed. Stream continues in the background; `← Back` reveals the completed message. |
| `Tab` in a doc with placeholders, cursor after the last token | Wraps to the first match. |
| `Tab` in a doc with no placeholders | Inserts two literal spaces. |

---

## Out of Scope

- **Source Document Creator** — the multi-turn AI dialogue that helped fill out templates in v1.0. Deferred to v2.1; full v1 spec preserved in `docs-v2/future/source-document-creator.md`.
- **Split-pane editor** (edit + preview side-by-side). v2.0 retains v1's mutually-exclusive toggle.
- **WYSIWYG / inline-rendered Markdown editor** (CodeMirror, Tiptap). v2.0 stays with a plain `<textarea>`.
- **Manual `Ctrl+S`**. Replaced entirely by debounced auto-save.
- **Unsaved-changes guard modal**. Same — no longer needed; debounced save flushes on close / lock / world switch.
- **Doc-importance ordering of attached docs** — insertion order only in v2.0 (Doc 22 O12). Future enhancement.
- **Doc folders as attachable units** — folders are not source docs and cannot be attached. The writer must attach individual items.
- **Per-story or per-mode source-doc filters** ("only attach this doc when in consulting"). All attachments apply to all modes.
- **Best-effort `DELETE` to Gemini File API on hard-delete of an Image item.** Out of scope for v2.0; the URI expires on its own (~48 h per Doc 19). Future refinement.
- **Image generation as a source-doc surface** (writer presses a button, the doc is auto-populated by an image-gen call). Lives in Doc 19 / Doc 20 once the provider question (Q1 in TODO) lands.
- **Versioning / history of source-doc edits.** Out of scope; source docs are non-versioned in v2.0.
- **Markdown linting / placeholder validation in the editor.** No real-time check that placeholders are valid; the writer's responsibility.

---

## Cross-References

- **Doc 03** — `items` schema (including `item_subtype`, `content`, image fields), `templates` schema, `story_state.context_doc_ids`, `attachment_history`.
- **Doc 06** — `workspaceStore` ownership of `activeDocId`, `contextDocIds`, doc-edit actions.
- **Doc 07** — vault command domain (`update_item_content`, `attach_context_doc`, `detach_context_doc`, `list_attached_docs`, `list_templates`).
- **Doc 10** — workspace shell layout (Navigator + main + right pane); editor takes the main + right-pane region.
- **Doc 11** — keyboard shortcuts (Tab placeholder navigation; Escape close).
- **Doc 14** — vault tree, Create Source Document flow, item delete / restore.
- **Doc 15** — debounced-save model the editor mirrors; `update_item_content` cache-stale rule.
- **Doc 19** — Image File API mechanics, asset path conventions, upload-side error handling.
- **Doc 20** — Settings → Templates management UI.
- **Doc 22** — Cache prefix construction, `=== SOURCE DOCUMENT: ===` header, stale triggers from doc edits, attach / detach effects.
- **Doc 23** — Mode behaviours; source docs included in story / handover / consulting requests; `entry_snapshot` capture.
- **Doc 27** — Right-pane Context Documents list visual; DocEditor-takes-workspace pattern.
- **`docs-v2/future/source-document-creator.md`** — v2.1 design carry-forward for the multi-turn template-filling Creator.
