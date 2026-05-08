import { invoke } from '@tauri-apps/api/core';

import type { WorldMeta, WorldMetaPatch } from '@/lib/types';

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
