# 08 — Vault and World Management

## Purpose

This document specifies world management (creation, switching, deletion, world
cards), vault tree behaviour (item types, folders, sort order, rename, move,
multi-select), and the Source Document Template system.

> **Coding-agent note:** World metadata lives in `world_meta.json` inside each
> world directory. The vault tree is driven by the `items` table in the world's
> SQLCipher database. Templates are stored in the `templates` table (§5).
> The World Picker is `src/components/modals/WorldPickerModal.tsx`.

---

## 1. World Switching

### 1.1 Normal Switch

When user selects a different world and `workspaceStore.isGenerating === false`:

1. Close World Picker modal
2. Call `switch_world(world_id)` Tauri command
3. Clear `workspaceStore` and `vaultStore` in-memory state
4. Load new world's vault tree, settings, and telemetry
5. Apply new world's theme (accent, font, bubble colors, feature colors)
6. Render Workspace with `<NoStorySelected />`

### 1.2 Switch During Generation

Show confirmation:
```
Switch world?
A response is being generated. Switching now will cancel it.
The partial response will not be saved.

            [Cancel]   [Switch Anyway]
```

On "Switch Anyway": call `cancel_generation()` then proceed with §1.1.

---

## 2. World Picker Modal

### 2.1 Open Trigger

Click the **world name header** at the top of the Navigator.

```
┌──────────────────────────────┐
│  Mirrorlands  ▾              │  ← click to open
├──────────────────────────────┤
```

### 2.2 Modal Layout

```
┌───────────────────────────────────────────────────────────────┐
│  Worlds                                          [✕]          │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────────┐  ┌─────────────────────┐            │
│  │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│  │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│            │
│  │  Mirrorlands  ●     │  │  The Fold           │            │
│  │  fantasy · dark  ·  │  │  4 stories          │            │
│  │  12 stories         │  │                     │            │
│  └─────────────────────┘  └─────────────────────┘            │
│                                                               │
│  ┌─────────────────────┐  ┌─────────────────────┐            │
│  │  + New World        │  │  ↑ Import World      │            │
│  └─────────────────────┘  └─────────────────────┘            │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

- Modal width: `600px`, max-height `70vh`, scrollable card grid
- Card grid: 2 columns, `gap: 16px`
- Card size: `~270px × 140px`
- Active world: outlined in that world's **own accent color** (from `world_meta.json`)

### 2.3 World Card

Each world card shows its own accent color for the active outline, providing
immediate visual identification across worlds.

**Active card:**
```css
.world-card-active {
  outline: 2px solid <world.accent_color from world_meta.json>;
  outline-offset: -2px;
}
```

For full card visual spec see `02-Design-System.md §9`.

**Right-click context menu:**
Rename · Set Background Image · Remove Background Image · Manage Tags · Delete · Properties

### 2.4 World Background Image

- Right-click → "Set Background Image" → native file picker (jpg, png, webp)
- Copied to `worlds/<world_id>/cover.<ext>`
- Path stored in `world_meta.json` as `cover_image: "cover.jpg"` (relative)

### 2.5 World Tags

Short freeform labels. Right-click → "Manage Tags" → inline tag editor.
Stored in `world_meta.json` as `tags: string[]`.

### 2.6 New World

Clicking "New World" → inline Create World form within modal:
```
  World name    [ __________________________ ]
  Tags          [ fantasy                 × ] [ + ]
                              [Cancel]  [Create]
```

On Create: calls `create_world(name, tags)`. Does not auto-switch.

### 2.7 Import World

Clicking "Import World" → native file picker filtered to `.loom-backup`
→ calls `vault_import_world(src_path)` → new world card appears.

---

## 3. World Deletion

### 3.1 Soft Delete

Right-click → Delete → confirmation with name typing:
```
Delete "Mirrorlands"?
Type the world name to confirm:
[ _________________________________ ]
This world will be moved to Trash.

                    [Cancel]  [Delete]
```

Delete enabled only when typed name exactly matches. World marked with
`deleted_at` in `app_config.json`. Directory not removed.

Deleted world appears in a **Trash section** at the bottom of World Picker
with `[Restore]` button.

### 3.2 Permanent Deletion

In Trash section: `[Delete Permanently]` → second confirmation (no name typing)
→ `std::fs::remove_dir_all(world_dir)` → removed from `app_config.json`.

---

## 4. Vault Tree

### 4.1 Item Types

| Type | Icon | Created by | Notes |
|---|---|---|---|
| Story | `lucide-react BookOpen` | Create dialog | Primary writing item |
| Folder | `lucide-react Folder` | Create dialog | Container for organisation |
| SourceDocument | Template icon | Create dialog | Context doc for AI |
| Image | `lucide-react Image` | Create dialog | Visual reference |

### 4.2 Tree Rendering

Each item row in the Navigator:
```
📖 The Glass Architect        [📎] [⋯]
```

- Item icon + name
- `[📎]` Paperclip icon (visible on hover, for Source Documents only):
  toggles attachment to current story as Context Doc
  - Accent colored when currently attached
- `[⋯]` Context menu button (visible on hover)

Folders are collapsible. Expanded state persisted in `localStorage`
(`vaultStore.expandedPaths`).

### 4.3 Search/Filter Input

At the top of the Navigator tree, above the vault items:

```
┌──────────────────────────────┐
│  🔍  Filter...               │
└──────────────────────────────┘
```

- Keyboard shortcut: `Ctrl+F` when Navigator has focus
- Typing filters the tree in real-time (debounced 150ms)
- Matching items are shown; parent folders are auto-expanded to reveal matches
- Non-matching items hidden
- Search scoped to active world only
- Clear button `[×]` appears when filter is non-empty
- Filter state is not persisted — cleared on story switch

### 4.4 Item Context Menu (right-click or `[⋯]`)

| Item type | Actions |
|---|---|
| Story | Open · Rename · Duplicate · Move to Folder · Set Checkpoint · Delete |
| Folder | Rename · Delete (with contents) |
| SourceDocument | Open · Rename · Attach/Detach · Move to Folder · Delete |
| Image | Open · Rename · Move to Folder · Delete |

### 4.5 Multi-Select

Users can select multiple items with:
- `Ctrl+Click`: toggle individual item selection
- `Shift+Click`: range select between last selected and clicked item

When ≥ 2 items selected, a contextual **bulk action bar** appears at the
bottom of the Navigator:

```
┌──────────────────────────────────────────────┐
│  3 items selected              [Move] [Delete]│
└──────────────────────────────────────────────┘
```

- `[Move]`: shows folder picker dropdown → calls `vault_move_item` for each
- `[Delete]`: confirmation dialog listing item names → soft-deletes all

Multi-select is cleared on: story click, world switch, Escape key.
Selected items stored in `vaultStore.selectedItems: Set<string>`.

### 4.6 Story Description Tooltip

Stories with a non-empty `description` field show it as a tooltip on hover
in the vault tree (`300ms` delay, `max-width: 240px`).

### 4.7 Inline Rename

Double-click or right-click → Rename:
- Name becomes `<input type="text">` in place
- `Enter` confirms, `Escape` cancels
- Empty name: reverts to original
- Calls `vault_rename_item(id, new_name)`

### 4.8 Drag-and-Drop (Move)

- Drag onto Folder → moves inside
- Drag between items at same level → reorders (`sort_order` update)
- Drag to root → moves to root
- Visual: horizontal insertion line + folder highlights with `--color-accent-subtle`
- On drop: calls `vault_move_item(id, new_parent_path, new_sort_order)`

### 4.9 Sort Order

Items ordered by `sort_order` (integer, ascending). Manual drag-and-drop only.
New items appended at bottom (`sort_order = max(existing) + 1`).

### 4.10 Maximum Folder Nesting Depth

Folders can be nested up to **5 levels deep**. Enforced in `vault_create_item`
and `vault_move_item` — both commands return `LoomError::Io("Maximum folder
nesting depth (5) exceeded")` if the operation would exceed the limit.

Depth is calculated from the root: root-level items are depth 0, items inside
a root-level folder are depth 1, etc. The limit is applied to the **parent path**
of the item being created or moved.

### 4.11 Full-Text Search (Not in v1)

The Navigator filter (§4.3) searches only item names. Full-text search across
document content and message text is planned for v1.1. The v1 architecture does
not preclude adding FTS5 to the SQLCipher database in a future release.

---

## 5. Create New Dialog

Opened via `+` button in Navigator toolbar.

```
┌────────────────────────────────────────────────┐
│  Create New                             [✕]    │
│                                                 │
│  📖 Story                                      │
│  📁 Folder                                     │
│  ── Source Documents ──────────────────────    │
│  👤 Character Profile                          │
│  🌍 World Building                             │
│  🖼 Image                                     │
│                                                 │
│  + New template type…                          │
└────────────────────────────────────────────────┘
```

- Story and Folder always at top
- Source Documents section only if ≥ 1 template exists
- Image always in Source Documents section (built-in)
- "New template type…" links to Settings → Templates tab
- Clicking Story/Folder: inline name input in tree
- Clicking SourceDocument: name input dialog → creates with template default content

---

## 6. Source Document Templates

### 6.1 Overview

Templates define custom Source Document types:
- **Name**: e.g. `Character Profile`
- **Slug**: e.g. `character_profile` (auto-generated, editable, unique)
- **Icon**: from preset lucide-react list
- **Default content**: Markdown with `{{placeholder}}` tab-stops

### 6.2 `templates` Table

```sql
CREATE TABLE IF NOT EXISTS templates (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    icon            TEXT NOT NULL DEFAULT 'FileText',
    default_content TEXT NOT NULL DEFAULT '',
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    modified_at     TEXT NOT NULL
);
```

### 6.3 `items` Table Extension

```sql
ALTER TABLE items ADD COLUMN item_subtype TEXT NULL;
-- "character_profile", "world_building", etc. for SourceDocuments
-- "image" for Image items
-- NULL for Story, Folder
```

Also:
```sql
ALTER TABLE items ADD COLUMN description TEXT NULL;
-- Optional synopsis/notes for Story items
```

### 6.4 Built-in Template: Image

- `slug = "image"`, `icon = "Image"`, `default_content = ""`
- Non-deletable, not shown in Templates Settings tab

### 6.5 Settings — Templates Tab

See `05-Settings-Modal.md §9`. Allows create/edit/delete of user-defined templates.

---

## 7. `world_meta.json` Schema

```json
{
  "id":           "uuid-v4",
  "name":         "Mirrorlands",
  "tags":         ["fantasy", "dark"],
  "cover_image":  "cover.jpg",
  "accent_color": "#7c3aed",
  "created_at":   "2026-03-07T14:00:00Z",
  "modified_at":  "2026-03-07T15:30:00Z",
  "deleted_at":   null
}
```

`accent_color` is a cache of the world's `settings` table value. Updated
synchronously whenever `save_settings("accent_color", hex)` is called
(via `sync_accent_to_world_meta` backend call). Used by the World Picker
to show each world's accent color without opening its DB.

`cover_image` is a relative filename within the world directory. `null` if unset.

---

## 8. Vault Tauri Command Reference

| Command | Parameters | Returns |
|---|---|---|
| `switch_world` | `world_id: String` | `WorldMeta` |
| `create_world` | `name: String, tags: Option<Vec<String>>` | `WorldMeta` |
| `rename_world` | `world_id: String, name: String` | `()` |
| `delete_world` | `world_id: String` | `()` |
| `restore_world` | `world_id: String` | `()` |
| `purge_world` | `world_id: String` | `()` |
| `set_world_cover` | `world_id: String, src_path: String` | `()` |
| `remove_world_cover` | `world_id: String` | `()` |
| `set_world_tags` | `world_id: String, tags: Vec<String>` | `()` |
| `list_worlds` | — | `Vec<WorldMeta>` |
| `vault_create_item` | `item_type, name, parent_path, subtype?` | `VaultItemMeta` |
| `vault_rename_item` | `id: String, name: String` | `()` |
| `vault_move_item` | `id, new_parent_path, new_sort_order` | `()` |
| `vault_soft_delete` | `id: String` | `()` |
| `vault_restore_item` | `id: String` | `()` |
| `vault_purge_item` | `id: String` | `()` |
| `vault_update_sort_order` | `items: Vec<{id, sort_order}>` | `()` |
| `vault_import_world` | `src_path: String` | `WorldMeta` |
| `vault_export_world` | `dest_path: String` | `()` |
| `update_item_description` | `id: String, description: String` | `()` |
| `sync_accent_to_world_meta` | `hex: String` | `()` |
| `list_templates` | — | `Vec<Template>` |
| `save_template` | `template: Template` | `Template` |
| `delete_template` | `id: String` | `()` |
