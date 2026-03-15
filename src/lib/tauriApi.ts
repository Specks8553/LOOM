/**
 * Typed wrappers for all Tauri invoke() calls.
 * Per CLAUDE.md: no raw invoke() scattered through components.
 */
import { invoke } from "@tauri-apps/api/core";
import type { WorldMeta, VaultItemMeta, UserContent, ChatMessage, StoryPayload, StreamDone } from "./types";

// ─── Auth & Config ────────────────────────────────────────────────────────────

export function checkAppConfig(): Promise<boolean> {
  return invoke<boolean>("check_app_config");
}

export function createAppConfig(password: string): Promise<void> {
  return invoke("create_app_config", { password });
}

export function unlockVault(password: string): Promise<void> {
  return invoke("unlock_vault", { password });
}

export function lockVault(): Promise<void> {
  return invoke("lock_vault");
}

export function validateAndStoreApiKey(key: string): Promise<void> {
  return invoke("validate_and_store_api_key", { key });
}

export function saveApiKeyToDb(): Promise<void> {
  return invoke("save_api_key_to_db");
}

export function generateRecoveryFile(): Promise<string> {
  return invoke<string>("generate_recovery_file");
}

export function restoreAppConfig(recoveryJson: string, password: string): Promise<void> {
  return invoke("restore_app_config", { recoveryJson, password });
}

// ─── World Management ─────────────────────────────────────────────────────────

export function listWorlds(): Promise<WorldMeta[]> {
  return invoke<WorldMeta[]>("list_worlds");
}

export function createWorld(name: string, tags?: string[]): Promise<WorldMeta> {
  return invoke<WorldMeta>("create_world", { name, tags: tags ?? null });
}

export function switchWorld(worldId: string): Promise<WorldMeta> {
  return invoke<WorldMeta>("switch_world", { worldId });
}

export function renameWorld(worldId: string, name: string): Promise<void> {
  return invoke("rename_world", { worldId, name });
}

export function deleteWorld(worldId: string): Promise<void> {
  return invoke("delete_world", { worldId });
}

export function restoreWorldCmd(worldId: string): Promise<void> {
  return invoke("restore_world", { worldId });
}

export function purgeWorld(worldId: string): Promise<void> {
  return invoke("purge_world", { worldId });
}

export function listDeletedWorlds(): Promise<WorldMeta[]> {
  return invoke<WorldMeta[]>("list_deleted_worlds");
}

// ─── Vault Items ──────────────────────────────────────────────────────────────

export function vaultListItems(): Promise<VaultItemMeta[]> {
  return invoke<VaultItemMeta[]>("vault_list_items");
}

export function vaultListTrash(): Promise<VaultItemMeta[]> {
  return invoke<VaultItemMeta[]>("vault_list_trash");
}

export function vaultCreateItem(
  itemType: string,
  name: string,
  parentId?: string | null,
  subtype?: string | null,
): Promise<VaultItemMeta> {
  return invoke<VaultItemMeta>("vault_create_item", {
    itemType,
    name,
    parentId: parentId ?? null,
    subtype: subtype ?? null,
  });
}

export function vaultRenameItem(id: string, name: string): Promise<void> {
  return invoke("vault_rename_item", { id, name });
}

export function vaultMoveItem(
  id: string,
  newParentId: string | null,
  newSortOrder: number,
): Promise<void> {
  return invoke("vault_move_item", { id, newParentId, newSortOrder });
}

export function vaultSoftDelete(id: string): Promise<void> {
  return invoke("vault_soft_delete", { id });
}

export function vaultRestoreItem(id: string): Promise<void> {
  return invoke("vault_restore_item", { id });
}

export function vaultPurgeItem(id: string): Promise<void> {
  return invoke("vault_purge_item", { id });
}

export function vaultUpdateSortOrder(items: [string, number][]): Promise<void> {
  return invoke("vault_update_sort_order", { items });
}

// ─── Conversation Engine ─────────────────────────────────────────────────────

export function sendMessage(
  storyId: string,
  leafId: string | null,
  userContent: UserContent,
  tempModelId: string,
): Promise<StreamDone> {
  return invoke<StreamDone>("send_message", {
    storyId,
    leafId: leafId ?? null,
    userContent,
    tempModelId,
  });
}

export function cancelGeneration(): Promise<void> {
  return invoke("cancel_generation");
}

export function loadStoryMessages(
  storyId: string,
  leafId: string,
): Promise<StoryPayload> {
  return invoke<StoryPayload>("load_story_messages", { storyId, leafId });
}

export function getStoryLeafId(storyId: string): Promise<string | null> {
  return invoke<string | null>("get_story_leaf_id", { storyId });
}

// ─── Phase 7: Branching ─────────────────────────────────────────────────────

export function getSiblings(
  storyId: string,
  parentId: string | null,
  currentId: string,
): Promise<[string[], number]> {
  return invoke<[string[], number]>("get_siblings", {
    storyId,
    parentId: parentId ?? null,
    currentId,
  });
}

export function navigateToSibling(
  storyId: string,
  siblingId: string,
): Promise<StoryPayload> {
  return invoke<StoryPayload>("navigate_to_sibling", { storyId, siblingId });
}

export function deleteMessageCmd(
  storyId: string,
  messageId: string,
): Promise<string | null> {
  return invoke<string | null>("delete_message", { storyId, messageId });
}

export function undeleteMessage(messageIds: string[]): Promise<void> {
  return invoke("undelete_message", { messageIds });
}

export function setStoryLeafId(storyId: string, leafId: string): Promise<void> {
  return invoke("set_story_leaf_id", { storyId, leafId });
}

export function getMessage(messageId: string): Promise<ChatMessage> {
  return invoke<ChatMessage>("get_message", { messageId });
}
