import { invoke } from '@tauri-apps/api/core';

import type {
  ChatMessage,
  InputDraft,
  SendMessageResult,
  TokenEstimate,
  UserContent,
} from '@/lib/types';

// --- Doc 15 §Backend API. Typed wrappers for `commands/conversation.rs`. ---

/** Every live message for the story, chronological. Includes session-kind. */
export async function loadMessages(storyId: string): Promise<ChatMessage[]> {
  return invoke<ChatMessage[]>('load_messages', { storyId });
}

/** Story-kind messages only (excludes handover / consulting). Used by Theater
 * in Phase 3 (story-mode only). */
export async function loadStoryMessages(storyId: string): Promise<ChatMessage[]> {
  return invoke<ChatMessage[]>('load_story_messages', { storyId });
}

/** Persist the user turn + empty model placeholder, then spawn the stream
 * task. Returns the two ids; the frontend pairs the optimistic UI to them
 * and listens for `message_chunk` / `message_complete`. */
export async function sendMessage(storyId: string, draft: UserContent): Promise<SendMessageResult> {
  return invoke<SendMessageResult>('send_message', { storyId, draft });
}

/** Cancels the in-flight generation. Idempotent. */
export async function cancelGeneration(): Promise<void> {
  return invoke('cancel_generation');
}

/** Edit a user message: truncate-and-replace, then regenerate. Doc 15
 * §Editing a Message. Returns the new model_message_id (user_message_id is
 * empty — the existing row is re-anchored). */
export async function editUserMessage(
  messageId: string,
  newContent: UserContent,
): Promise<SendMessageResult> {
  return invoke<SendMessageResult>('edit_user_message', { messageId, newContent });
}

/** In-place edit of a model message. No truncation, no regeneration. */
export async function updateMessageContent(messageId: string, newText: string): Promise<void> {
  return invoke('update_message_content', { messageId, newText });
}

/** Hard-delete the most recent model message and re-fire generation. */
export async function regenerateLastResponse(storyId: string): Promise<SendMessageResult> {
  return invoke<SendMessageResult>('regenerate_last_response', { storyId });
}

/** Hard-delete the user/model pair containing `messageId` (cascades through
 * checkpoints / segments). */
export async function deleteExchange(messageId: string): Promise<void> {
  return invoke('delete_exchange', { messageId });
}

/** Hard-delete the exchange containing `messageId` and every exchange after. */
export async function deleteFrom(messageId: string): Promise<void> {
  return invoke('delete_from', { messageId });
}

/** Writes (or clears with `""`) `messages.user_feedback`. */
export async function updateFeedback(messageId: string, feedback: string): Promise<void> {
  return invoke('update_feedback', { messageId, feedback });
}

/** Pre-flight token count via Gemini `countTokens`. Doc 15 §Token Counting. */
export async function getTokenCount(storyId: string, draft: UserContent): Promise<TokenEstimate> {
  return invoke<TokenEstimate>('get_token_count', { storyId, draft });
}

// --- Drafts ---

export async function getDraft(storyId: string): Promise<InputDraft> {
  return invoke<InputDraft>('get_draft', { storyId });
}

export async function saveDraft(storyId: string, draft: InputDraft): Promise<void> {
  return invoke('save_draft', { storyId, draft });
}

export async function clearDraft(storyId: string): Promise<void> {
  return invoke('clear_draft', { storyId });
}
