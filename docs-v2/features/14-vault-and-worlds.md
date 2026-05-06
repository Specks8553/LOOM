# 14 — Vault and Worlds

> **Status:** Complete
> **Last updated:** 2026-05-03 — pre-implementation audit resolution: `WorldMetaPatch` defined in Doc 03 §IPC Payload and Result Types — `Partial<WorldMeta>` shape, optional fields, explicit `null` clears (IP-3); `vaultStore` field shape canonical in Doc 06 (CD-7).
> **Earlier:** 2026-04-29 — Doc 19 design pass: World Backup section added (`.loom-backup` zip export/import via `export_world` / `import_world`); imports get a new `world_id` to avoid collision; deferred narrative export to Doc 21
> **Earlier:** 2026-04-29 — Doc 18 design pass: hover paperclip affordance added to vault row anatomy for `SourceDocument` and `Image` items
> **Earlier:** 2026-04-27 — consultant pass: world_meta.json write-through rule documented for accent and other display fields

World management, the Navigator, vault tree CRUD, trash, multi-select, and search.

---

## Overview

A **World** is an isolated, encrypted workspace. Each World has its own `loom.db` and `world_meta.json`. Worlds do not share data — switching worlds closes one database and opens another.

The **vault** is the tree of content within a World: stories, folders, source documents, and images. It lives in the Navigator (left pane).

---

## Navigator Structure

The left pane is the Navigator. Top to bottom:

```
┌──────────────────────────────────────┐
│  [Current World Name ▾]  [⚙]  [🔒]  │  ← world picker button, settings, lock
├──────────────────────────────────────┤
│  [Filter items...         ]  [+]     │  ← filter input, new item button
├──────────────────────────────────────┤
│                                      │
│  vault tree                          │
│  (scrollable)                        │
│                                      │
├──────────────────────────────────────┤
│  Trash                               │  ← fixed at bottom, opens Trash view
└──────────────────────────────────────┘
```

**World picker button:** Shows the name of the currently open world. Click opens the WorldPickerModal. If no world is open, shows "Select a world".

**Settings icon:** Opens the main Settings modal (Doc 20).

**Lock icon:** Locks the vault (with confirmation if generation is in progress — see Doc 11).

**Filter bar:** Real-time name filter. Filters the visible tree as the user types. Shows the NoSearchResults empty state (Doc 12) when no matches. Cleared on world switch.

**"+" button:** Opens a popover with options: New Story, New Folder, New Source Document. Created item's position depends on selection state — see item creation flows below.

**Trash:** Fixed row at the bottom of the Navigator. Clicking it opens the Trash view in place of the normal vault tree.

---

## World Picker Modal

Opened by clicking the world picker button. Full-screen overlay (shadcn Dialog).

### World cards

Each World is displayed as a card:

```
┌─────────────────────────────────────┐
│  [⚙] [🗑]                          │  ← icons in top-right corner
│                                     │
│  World Name                         │  ← --color-text-primary, 15px/500
│  Last opened: 2 days ago            │  ← --color-text-muted, 12px
│  Description text if defined        │  ← --color-text-secondary, 13px
│  [tag] [tag]                        │  ← tags if defined
│                                     │
└─────────────────────────────────────┘
```

**Left-click anywhere on the card** → open the world (switches to that world).
**Settings icon (top-right)** → open Settings modal scoped to that world's settings.
**Delete icon (top-right)** → begin world deletion flow.
**Right-click on card** → context menu with: Open, Settings, Delete.

Currently open world card has an accent-colored left border.

### World creation

A "Create World" button is shown in the WorldPickerModal (below the card grid). Clicking it opens a small inline form:

```
World name  [                    ]
            [Create]  [Cancel]
```

Name is required. On Create: backend creates `app_config.json` entry, `world_meta.json`, and empty `loom.db`. The new world opens immediately.

### Empty state

No worlds exist:

```
Icon:       Globe (40px)
Headline:   "No worlds yet."
Subtext:    "A world holds your stories, documents, and settings."
Action:     [Create your first world]
```

---

## World Flows

### Open / switch world

Left-click a world card. Instant — no confirmation. Backend closes current `active_conn` (if any), opens the selected world's `loom.db`, stores connection in `AppState.active_conn`. `vaultStore` reloads.

### Delete world

1. Click Delete icon or right-click → Delete on a world card.
2. Confirmation dialog:
   ```
   Title:  "Delete this world?"
   Body:   "Type the world name to confirm. This cannot be undone."
   Input:  [World name confirmation field]
   [Cancel]  [Delete permanently]
   ```
   The "Delete permanently" button is disabled until the typed name exactly matches the world name.
3. On confirm: backend removes the world from `app_config.json`, deletes `loom.db` and `world_meta.json` from disk. If the deleted world was currently open, the vault returns to the "no world selected" state.

**No soft delete for worlds** — deletion is immediate and permanent.

### Edit world settings

Via the Settings modal (world settings section — see Doc 20). Covers: name, cover image (deferred — see Out of Scope), tags, description, accent color, fonts, system instructions, auxiliary instruction slots.

---

## Vault Tree

The vault tree renders all non-deleted items in the active world. Folders are collapsible. Items within a folder or at root level are ordered by `sort_order`.

### Item types and icons

| Type | Icon | Notes |
|---|---|---|
| Story | `BookOpen` | Opens in Theater on click |
| Folder | `Folder` / `FolderOpen` | Collapsible; open = `FolderOpen` |
| SourceDocument | `FileText` (or template icon) | Opens in DocEditor on click |
| Image | `Image` | Deferred — see Out of Scope |

### Tree row anatomy

```
[▶] [Icon]  Item name              [📎] [context menu trigger]
```

- Disclosure triangle (▶/▼) on Folders only. Hidden for leaf items (aligned space).
- Item name: `--color-text-primary`, 13px.
- Selected item: `--color-accent-subtle` background, `--color-accent-text` text.
- Hover: `--color-bg-hover` background.
- **Paperclip** (`Paperclip` icon, 14px) appears on hover for `SourceDocument` and `Image` rows when a story is active. Click → attach this item to the active story (Doc 18 §Context Doc Attachment). Filled (`--color-accent`) when already attached. Hidden for `Folder` and `Story` rows, and when no story is active.
- Context menu trigger: appears on hover (three-dot icon, 14px, `--color-text-muted`). Right-click anywhere on the row has the same effect.

### Nesting

Folders can be nested to any depth. Stories and SourceDocuments are leaf nodes — they cannot contain children.

---

## Item Flows

### Create story or folder

1. Click "+" → select "New Story" or "New Folder" from popover, **or** right-click a folder or the vault background → "New Story" / "New Folder".
2. New item appears inline in the tree with an active text input for the name.
3. Press Enter or click away → commits with the typed name (or "Untitled Story" / "New Folder" if empty).
4. Escape → cancels creation.

**Placement:** If a folder is selected, the item is created inside it. Otherwise, it is created at the vault root.

### Create source document

1. Click "+" → "New Source Document", **or** right-click → "New Source Document".
2. A small modal opens:
   ```
   Name     [                    ]
   Template [Blank           ▾]
            [Create]  [Cancel]
   ```
   Template list is populated from the world's `templates` table (managed in Settings — see Doc 20).
3. On Create: item appears in tree, DocEditor opens immediately.

### Rename

Double-click the item name, **or** right-click → Rename. The name becomes an inline editable input. Enter commits, Escape cancels. Empty name reverts to the previous name.

### Move

**Drag and drop:** Drag a vault item onto a folder to move it inside. Drag between items to reorder within the current parent. See Doc 11 for DnD visual feedback rules.

**Context menu:** Right-click → Move to... opens a folder picker overlay listing all folders in the vault. The current parent is shown as the default. Select a folder (or "Vault root") to move.

### Delete (soft)

Right-click → Delete, **or** select and press Delete key. Item moves to Trash (`deleted_at` set). No confirmation dialog — an undo toast appears instead:

```
"Story moved to Trash"  [Undo]  (4 seconds)
```

Undo restores the item (`deleted_at` cleared).

**Folder deletion:** A folder can only be deleted if it has no children (all children must be deleted or moved first). If children exist, the Delete option is disabled in the context menu and the keyboard shortcut is a no-op.

### Multi-select

Ctrl+Click / Cmd+Click to add/remove items. Shift+Click for range select. When two or more items are selected, the BulkActionBar replaces the Navigator header:

```
┌──────────────────────────────────────┐
│  3 selected    [Move to…]  [Delete]  │
└──────────────────────────────────────┘
```

Bulk actions: Move to (folder picker), Delete (soft-deletes all selected; single undo toast with count: "3 items moved to Trash").

---

## Trash

Accessed via the Trash row at the bottom of the Navigator. Switches the main vault tree area to the Trash view.

Trash view shows all soft-deleted items (flat list — folder hierarchy is not shown in Trash).

### Trash item actions (context menu and row buttons)

- **Restore** → clears `deleted_at`, item returns to its original parent (or vault root if parent was also deleted).
- **Delete permanently** → confirmation dialog: "Delete permanently? This cannot be undone." [Cancel] [Delete permanently]. On confirm: record deleted from DB, asset files removed from disk (Image type only).

### Empty Trash

A "Empty Trash" button appears in the Trash view header when items exist. Confirmation: "Permanently delete all X items in Trash?" [Cancel] [Empty Trash].

### Empty state

When Trash is empty: Trash Empty state (Doc 12).

---

## World Backup

Resilience for the writer: zip up an entire world (encrypted DB + assets) so it can be moved between machines, archived, or restored after disk loss. World backup is **not** narrative export — exporting a story to a readable PDF / HTML / markdown is Doc 21 (deferred to v2.1). World backup is plumbing, not a deliverable for a reader.

### Format

A `.loom-backup` file is a standard zip archive:

```
loom-backup/
├── loom.db        ← SQLCipher-encrypted database (still encrypted in the archive)
└── assets/        ← image files copied verbatim from worlds/<world_id>/assets/
    ├── <item_id>.png
    └── …
```

The encrypted `loom.db` file inside the archive remains encrypted — opening the restored world requires the master password. The `assets/` directory is **not** individually encrypted; the zip archive is protected only by filesystem permissions of wherever the writer saves it. The export dialog surfaces this caveat.

`world_meta.json` is **not** included — it's a display cache that the import flow regenerates from `loom.db` (which holds the canonical fields) and from the writer's chosen world name.

### Export flow

1. Settings → World → **Export world** (button in the active world's settings).
2. Native save dialog: writer picks a destination path; default filename `<world_name>.loom-backup`.
3. Backend `export_world(dest_path)`:
   - Open `loom.db` via the SQLite Online Backup API to a temporary copy in the OS temp dir (so an in-use connection doesn't block).
   - Copy `assets/` recursively into the staging directory.
   - Zip both into `<dest>.loom-backup` with `deflate` compression.
   - Clean up the staging directory.
4. Toast on success: `"World exported to <path>"`.

The world stays open during export — the backup is a snapshot at the time of the call.

### Import flow

1. World Picker Modal → **Import world** button (alongside Create world).
2. Native open dialog: writer picks a `.loom-backup` file.
3. Backend `import_world(src_path, name)`:
   - Validate the archive: must contain `loom.db`; `assets/` is optional (worlds without images skip it).
   - Generate a new `world_id` UUID for the imported world (does not collide with the source's).
   - Create `worlds/<new_world_id>/` directory.
   - Extract `loom.db` and `assets/` into that directory.
   - Rebuild `world_meta.json` by opening the extracted `loom.db` (prompting for the master password to decrypt) and reading the canonical fields.
   - Add an entry to `app_config.json` with the new world's metadata.
4. The new world appears in the World Picker. It is **not** auto-opened — the writer can review and unlock as usual.

### Why a new `world_id` on import

Re-using the source's `world_id` would collide if the writer also still has the original world. Generating a new UUID makes the imported world a distinct world from the user's perspective even if the underlying data is the same.

### Errors

| Scenario | Behaviour |
|---|---|
| Export — destination not writable | Toast `"Couldn't export — <reason>"`; no partial files left behind |
| Export — `loom.db` backup fails (lock contention, disk error) | Toast; staging cleanup; no `.loom-backup` produced |
| Import — corrupt zip / missing `loom.db` | Toast `"This file isn't a valid LOOM backup."`; no world created |
| Import — wrong password on the included `loom.db` | World is created and registered, but stays in the locked state until the correct password is provided. The writer can retry from the world picker |
| Import — disk full during extraction | Partially-extracted directory is deleted; toast |

### Backend commands

```
export_world(world_id: String, dest_path: String) -> Result<()>
import_world(src_path: String) -> Result<WorldMeta>
```

Both live in `commands/vault.rs`. `export_world` requires the world to be unlocked (the SQLite Online Backup API needs the connection); `import_world` requires only that the vault is unlocked enough for `app_config.json` to be writable.

### Out of scope

- **Incremental / differential backups** — every export is a full archive.
- **Encrypted `.loom-backup` archives** — `loom.db` is already encrypted; assets are not. Wrapping the whole archive in an additional encryption layer is future work.
- **Cloud / remote backup** — local file save only. The writer is responsible for moving `.loom-backup` files off the device.
- **Story-level export** — exporting one story (vs. an entire world) is part of Doc 21 (v2.1).
- **Cross-version compatibility** — v2.0 backups are guaranteed to import into v2.0. Forward compatibility (v2.1 reading v2.0 backups, v2.0 reading v2.1 backups) is best-effort but not contractual.

---

## Filter / Search

The filter bar in the Navigator filters the visible tree by item name. Matching is case-insensitive substring. Non-matching items are hidden; ancestor folders of matching items remain visible (to show the path).

Filter is applied client-side against the loaded vault tree. It does not trigger a backend query.

Cleared automatically on world switch.

---

## Data Requirements

All data shapes are defined in Doc 03. Relevant tables: `items`, `story_state`.

Relevant `world_meta.json` fields read by the WorldPickerModal: `id`, `name`, `tags`, `accent_color`, `cover_image_path` (deferred), `created_at`, `modified_at`.

### world_meta.json write-through rule

`world_meta.json` is a display cache for the WorldPickerModal so it can render without decrypting `loom.db`. Several of its fields shadow values that also live inside the encrypted DB (`accent_color` is also in the world `settings` table; `name` is also in `app_config.json`). Whenever the source-of-truth value changes, the backend rewrites `world_meta.json` atomically (`.tmp` → rename) in the same command. The frontend does not write `world_meta.json`.

| world_meta.json field | Source of truth (encrypted) | Rewrite trigger |
|---|---|---|
| `name` | `app_config.json` (and is the canonical world name) | `update_world_meta` |
| `tags` | `world_meta.json` only | `update_world_meta` |
| `accent_color` | world `settings` table | any `save_world_setting` writing `accent_color` |
| `cover_image_path` | world `settings` table (when implemented) | deferred |
| `modified_at` | computed | every world-modifying command |

Any command that updates a shadowed field is responsible for the write-through. If a write-through fails, the encrypted source is rolled back and the command returns an error — the two stores must not diverge.

---

## Backend Commands

Populates the vault section of Doc 07 (IPC Contracts).

```
// Worlds
create_world(name: String) -> Result<WorldMeta>
list_worlds() -> Result<Vec<WorldMeta>>
open_world(world_id: String) -> Result<()>
delete_world(world_id: String, name_confirmation: String) -> Result<()>
update_world_meta(world_id: String, patch: WorldMetaPatch) -> Result<WorldMeta>
  // WorldMetaPatch = Partial<WorldMeta> — optional fields; explicit null clears
  // cover_image_path. Defined in Doc 03 §IPC Payload and Result Types.

// Items
create_item(parent_id: Option<String>, item_type: String, name: String, template_slug: Option<String>) -> Result<VaultItemMeta>
list_items(include_deleted: bool) -> Result<Vec<VaultItemMeta>>
rename_item(item_id: String, name: String) -> Result<()>
move_item(item_id: String, new_parent_id: Option<String>, new_sort_order: i64) -> Result<()>
delete_item(item_id: String) -> Result<()>        // soft delete
restore_item(item_id: String) -> Result<()>       // clears deleted_at
delete_item_permanent(item_id: String) -> Result<()>
empty_trash() -> Result<u32>                      // returns count of deleted items
```

**Events emitted:** `vault_updated` (Tauri event) — emitted after any mutation. Frontend listens and reloads the vault tree.

---

## Frontend State (`vaultStore`)

The canonical TypeScript shape lives in **Doc 06 §`vaultStore`** — `selectedIds` is `Set<string>` (O(1) membership), field names are `filterQuery` / `isTrashView` / `expandedFolderIds`, and the action set covers `loadVault`, `loadTrash`, `setFilter`, `setSelected`, `toggleSelection`, `toggleExpanded`, `setTrashView`, `clear`.

**No derived state stored in the store.** Tree structure and filtered lists are computed in selectors from `items` and `filterQuery`.

---

## Edge Cases and Error Handling

| Scenario | Behaviour |
|---|---|
| Create world — name already exists | Inline error: "A world with this name already exists." |
| Delete world — name confirmation mismatch | "Delete permanently" button stays disabled |
| Delete folder with children | Delete option disabled in context menu; no-op on keyboard shortcut |
| Restore item whose parent folder was deleted | Item restored to vault root |
| Move item to its current parent | No-op |
| Rename to empty string | Reverts to previous name |
| `vault_updated` event received during drag | Drag is cancelled; tree reloads |
| World DB missing on open | Toast: "Cannot open this world. The file may be missing or corrupted." |

---

## Out of Scope

- World cover image (deferred — `cover_image_path` field reserved in `world_meta.json`)
- Image item type (field reserved in `items`; file management deferred to Doc 19)
- World export / archive
- Story description UI (field reserved in `items` — see IMPL-NOTES IN-14-A)
- Item tagging (stories, docs) — no tag field on items in v2.0
