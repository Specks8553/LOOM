import { invoke } from '@tauri-apps/api/core';

import type { GhostwriterEdit, GhostwriterResponse, RevertResult } from '@/lib/types';

// --- Doc 17 §Backend API. Typed wrappers for `commands/ghostwriter.rs`. ---

/** Build the surgical-stitching request, run a non-streaming Gemini call, and
 *  return the revised passage. Offsets are UTF-16 code units (matching the JS
 *  `Selection` API). `cancelled` is `true` when the user aborted mid-flight. */
export async function sendGhostwriterRequest(
  messageId: string,
  selectionStart: number,
  selectionEnd: number,
  instruction: string,
): Promise<GhostwriterResponse> {
  return invoke<GhostwriterResponse>('send_ghostwriter_request', {
    messageId,
    selectionStart,
    selectionEnd,
    instruction,
  });
}

/** Cancel the in-flight Ghostwriter generation. Idempotent — shares the global
 *  cancellation token with story / session sends. */
export async function cancelGhostwriterGeneration(): Promise<void> {
  return invoke('cancel_ghostwriter_generation');
}

/** Persist an accepted edit: appends `historyEntry` to `ghostwriter_history`
 *  and updates `messages.content` in a single transaction. Marks the story
 *  cache + containing accordion segment stale where applicable. */
export async function saveGhostwriterEdit(
  messageId: string,
  newContent: string,
  historyEntry: GhostwriterEdit,
): Promise<void> {
  return invoke('save_ghostwriter_edit', { messageId, newContent, historyEntry });
}

/** Pop the most-recent accepted edit, restoring the prior content. Returns the
 *  restored content and the remaining history length (drives `[Revert]`
 *  visibility). */
export async function revertGhostwriterEdit(messageId: string): Promise<RevertResult> {
  return invoke<RevertResult>('revert_ghostwriter_edit', { messageId });
}
