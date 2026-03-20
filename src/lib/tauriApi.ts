/**
 * Typed wrappers for all Tauri invoke() calls.
 * Per CLAUDE.md: no raw invoke() scattered through components.
 */
import { invoke } from "@tauri-apps/api/core";
import type { WorldMeta, VaultItemMeta, VaultItem, UserContent, ChatMessage, StoryPayload, StreamDone, Template, ContextDoc, BranchMapData, Checkpoint, BranchDeletionResult, AccordionSegment } from "./types";

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

export function undeleteMessage(storyId: string, messageIds: string[]): Promise<void> {
  return invoke("undelete_message", { storyId, messageIds });
}

export function setStoryLeafId(storyId: string, leafId: string): Promise<void> {
  return invoke("set_story_leaf_id", { storyId, leafId });
}

export function getMessage(messageId: string): Promise<ChatMessage> {
  return invoke<ChatMessage>("get_message", { messageId });
}

// ─── Phase 8: Settings ──────────────────────────────────────────────────────

export function getSettingsAll(): Promise<Record<string, string>> {
  return invoke<Record<string, string>>("get_settings_all");
}

export function saveSetting(key: string, value: string): Promise<void> {
  return invoke("save_setting", { key, value });
}

export function syncAccentToWorldMeta(hex: string): Promise<void> {
  return invoke("sync_accent_to_world_meta", { hex });
}

export function resetRateLimiter(): Promise<void> {
  return invoke("reset_rate_limiter");
}

export function getTelemetry(): Promise<import("./types").TelemetryCounters> {
  return invoke<import("./types").TelemetryCounters>("get_telemetry");
}

export function checkRateLimit(): Promise<import("./types").RateLimitStatus> {
  return invoke<import("./types").RateLimitStatus>("check_rate_limit");
}

export function hasApiKey(): Promise<boolean> {
  return invoke<boolean>("has_api_key");
}

export function changeMasterPassword(oldPassword: string, newPassword: string): Promise<void> {
  return invoke("change_master_password", { oldPassword, newPassword });
}

// ─── Phase 9: Control Pane ──────────────────────────────────────────────────

export function updateItemDescription(id: string, description: string): Promise<void> {
  return invoke("update_item_description", { id, description });
}

export function getStorySettings(storyId: string): Promise<Record<string, string>> {
  return invoke<Record<string, string>>("get_story_settings", { storyId });
}

export function saveStorySetting(storyId: string, key: string, value: string): Promise<void> {
  return invoke("save_story_setting", { storyId, key, value });
}

export function updateMessageFeedback(messageId: string, feedback: string): Promise<void> {
  return invoke("update_message_feedback", { messageId, feedback });
}

export function getBranchInfo(storyId: string): Promise<[number, number]> {
  return invoke<[number, number]>("get_branch_info", { storyId });
}

// ─── Phase 9: Context Doc Attachment ─────────────────────────────────────────

export function attachContextDoc(storyId: string, docId: string): Promise<void> {
  return invoke("attach_context_doc", { storyId, docId });
}

export function detachContextDoc(storyId: string, docId: string): Promise<void> {
  return invoke("detach_context_doc", { storyId, docId });
}

export function getContextDocs(storyId: string): Promise<ContextDoc[]> {
  return invoke<ContextDoc[]>("get_context_docs", { storyId });
}

// ─── Phase 11: Source Document Editor + Templates ────────────────────────────

export function vaultGetItem(id: string): Promise<VaultItem> {
  return invoke<VaultItem>("vault_get_item", { id });
}

export function vaultUpdateItemContent(id: string, content: string): Promise<void> {
  return invoke("vault_update_item_content", { id, content });
}

export function vaultCreateItemWithContent(
  itemType: string,
  name: string,
  parentId: string | null,
  subtype: string | null,
  content: string,
): Promise<VaultItemMeta> {
  return invoke<VaultItemMeta>("vault_create_item_with_content", {
    itemType,
    name,
    parentId,
    subtype,
    content,
  });
}

export function listTemplates(): Promise<Template[]> {
  return invoke<Template[]>("list_templates");
}

export function saveTemplateCmd(template: Template): Promise<Template> {
  return invoke<Template>("save_template", { template });
}

export function deleteTemplateCmd(id: string): Promise<void> {
  return invoke("delete_template", { id });
}

// ─── Phase 12: Ghostwriter ──────────────────────────────────────────────────

export interface GhostwriterResult {
  new_content: string;
  token_count: number;
}

export function updateMessageContent(
  messageId: string,
  newContent: string,
): Promise<void> {
  return invoke("update_message_content", { messageId, newContent });
}

export function sendGhostwriterRequest(
  messageId: string,
  selectedText: string,
  instruction: string,
  originalContent: string,
  storyId: string,
  leafId: string,
  selectionStart: number,
  selectionEnd: number,
): Promise<GhostwriterResult> {
  return invoke<GhostwriterResult>("send_ghostwriter_request", {
    messageId,
    selectedText,
    instruction,
    originalContent,
    storyId,
    leafId,
    selectionStart,
    selectionEnd,
  });
}

export function saveGhostwriterEdit(
  messageId: string,
  newContent: string,
  historyEntry: {
    edited_at: string;
    original_content: string;
    new_content: string;
    instruction: string;
    selected_text: string;
  },
): Promise<void> {
  return invoke("save_ghostwriter_edit", { messageId, newContent, historyEntry });
}

// ─── Phase 13: Branch Map + Checkpoints ────────────────────────────────────

export function loadBranchMap(storyId: string): Promise<BranchMapData> {
  return invoke<BranchMapData>("load_branch_map", { storyId });
}

export function createCheckpointCmd(
  storyId: string,
  afterMessageId: string | null,
  name: string,
): Promise<Checkpoint> {
  return invoke<Checkpoint>("create_checkpoint", {
    storyId,
    afterMessageId,
    name,
  });
}

export function renameCheckpointCmd(checkpointId: string, name: string): Promise<void> {
  return invoke("rename_checkpoint", { checkpointId, name });
}

export function deleteCheckpointCmd(storyId: string, checkpointId: string): Promise<void> {
  return invoke("delete_checkpoint", { storyId, checkpointId });
}

export function deleteBranchFrom(storyId: string, modelMsgId: string): Promise<BranchDeletionResult> {
  return invoke<BranchDeletionResult>("delete_branch_from", { storyId, modelMsgId });
}

// ─── Phase 14: Accordion ───────────────────────────────────────────────────

export function getAccordionSegments(storyId: string): Promise<AccordionSegment[]> {
  return invoke<AccordionSegment[]>("get_accordion_segments", { storyId });
}

export function summariseSegmentCmd(
  segmentId: string,
  storyId: string,
  leafId: string,
): Promise<string> {
  return invoke<string>("summarise_segment", { segmentId, storyId, leafId });
}

export function setSegmentCollapsed(
  segmentId: string,
  storyId: string,
  collapsed: boolean,
): Promise<void> {
  return invoke("set_segment_collapsed", { segmentId, storyId, collapsed });
}

// ─── Phase 15: Image Upload ───────────────────────────────────────────────

export function vaultUploadImage(
  srcPath: string,
  name: string,
  parentId: string | null,
): Promise<VaultItemMeta> {
  return invoke<VaultItemMeta>("vault_upload_image", { srcPath, name, parentId });
}

export function vaultGetAssetPath(itemId: string): Promise<string> {
  return invoke<string>("vault_get_asset_path", { itemId });
}
