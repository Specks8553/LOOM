import { invoke } from '@tauri-apps/api/core';

import type { VaultItemMeta, VaultItemType, WorldMeta, WorldMetaPatch } from '@/lib/types';

// --- Worlds (Phase 2A) ---

/** Return every world registered in app_config.json with its full meta. */
export async function listWorlds(): Promise<WorldMeta[]> {
  return invoke<WorldMeta[]>('list_worlds');
}

/** Provision a new world: directory, encrypted DB, world_meta.json, app_config entry. */
export async function createWorld(name: string): Promise<WorldMeta> {
  return invoke<WorldMeta>('create_world', { name });
}

/** Open an existing world: load its encrypted DB and replace `active_conn`. */
export async function openWorld(worldId: string): Promise<void> {
  return invoke('open_world', { worldId });
}

/**
 * Permanently delete a world. `nameConfirmation` must match the world's display
 * name exactly (Doc 14 §Delete world). If the deleted world was active, the
 * active connection is cleared automatically.
 */
export async function deleteWorld(worldId: string, nameConfirmation: string): Promise<void> {
  return invoke('delete_world', { worldId, nameConfirmation });
}

/** Patch a world's display metadata. Returns the new full meta. */
export async function updateWorldMeta(worldId: string, patch: WorldMetaPatch): Promise<WorldMeta> {
  return invoke<WorldMeta>('update_world_meta', { worldId, patch });
}

// --- Items (Phase 2C) ---

/** List items in the active world. With `includeDeleted=true` the trash is included. */
export async function listItems(includeDeleted = false): Promise<VaultItemMeta[]> {
  return invoke<VaultItemMeta[]>('list_items', { includeDeleted });
}

/** Create a vault item. `templateSlug` is recorded as `item_subtype` on SourceDocuments. */
export async function createItem(
  parentId: string | null,
  itemType: VaultItemType,
  name: string,
  templateSlug: string | null = null,
): Promise<VaultItemMeta> {
  return invoke<VaultItemMeta>('create_item', {
    parentId,
    itemType,
    name,
    templateSlug,
  });
}

/** Rename an item. */
export async function renameItem(itemId: string, name: string): Promise<void> {
  return invoke('rename_item', { itemId, name });
}

/** Move an item to a new parent / sort order. `null` parent = vault root. */
export async function moveItem(
  itemId: string,
  newParentId: string | null,
  newSortOrder: number,
): Promise<void> {
  return invoke('move_item', { itemId, newParentId, newSortOrder });
}

/** Soft-delete (move to Trash). Folders must be empty. Idempotent. */
export async function deleteItem(itemId: string): Promise<void> {
  return invoke('delete_item', { itemId });
}

/** Restore a soft-deleted item. Reparents to root if its parent is also trashed. */
export async function restoreItem(itemId: string): Promise<void> {
  return invoke('restore_item', { itemId });
}

/** Permanently delete a single item (FK cascades clean up dependent rows). */
export async function deleteItemPermanent(itemId: string): Promise<void> {
  return invoke('delete_item_permanent', { itemId });
}

/** Permanently delete every soft-deleted item. Returns the count removed. */
export async function emptyTrash(): Promise<number> {
  return invoke<number>('empty_trash');
}

// --- World backup (Phase 2D) ---

/**
 * Export a world to a `.loom-backup` zip at `destPath`. The frontend picks
 * the destination via the native save dialog; the backend snapshots `loom.db`
 * via SQLite Online Backup so a live connection isn't blocked, then zips
 * `loom.db` (still encrypted) and any `assets/` files into the archive.
 */
export async function exportWorld(worldId: string, destPath: string): Promise<void> {
  return invoke('export_world', { worldId, destPath });
}

/**
 * Import a world from a `.loom-backup` zip at `srcPath`. Generates a fresh
 * `world_id`, registers the world in `app_config.json`, and returns the new
 * world's metadata. The new world is **not** auto-opened.
 */
export async function importWorld(srcPath: string): Promise<WorldMeta> {
  return invoke<WorldMeta>('import_world', { srcPath });
}
