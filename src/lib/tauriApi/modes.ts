import { invoke } from '@tauri-apps/api/core';

import type { ConversationSession, SendSessionMessageResult, StoryActiveMode } from '@/lib/types';

// --- Doc 23 §Backend API. Typed wrappers for `commands/modes.rs`. ---

export async function listSessions(storyId: string): Promise<ConversationSession[]> {
  return invoke<ConversationSession[]>('list_sessions', { storyId });
}

/** Create a new handover session anchored at the current story tail.
 *  Emits `session_created`. */
export async function startHandoverSession(storyId: string): Promise<ConversationSession> {
  return invoke<ConversationSession>('start_handover_session', { storyId });
}

/** Create a new consulting session. Phase 4 captures `entry_snapshot` only;
 *  Phase 6 turns on Gemini cache creation here. Emits `session_created`. */
export async function startConsultingSession(storyId: string): Promise<ConversationSession> {
  return invoke<ConversationSession>('start_consulting_session', { storyId });
}

/** Phase 4: validate the session exists (frontend tracks active session
 *  state). Phase 6 will rebuild consulting cache from snapshot here. */
export async function enterSession(sessionId: string): Promise<void> {
  return invoke('enter_session', { sessionId });
}

/** Phase 4 no-op (cache lifecycle is Phase 6). */
export async function exitSession(sessionId: string): Promise<void> {
  return invoke('exit_session', { sessionId });
}

/** Send a turn to a handover or consulting session. Streams via
 *  `session_message_chunk` / `session_message_complete`. */
export async function sendSessionMessage(
  sessionId: string,
  text: string,
): Promise<SendSessionMessageResult> {
  return invoke<SendSessionMessageResult>('send_session_message', { sessionId, text });
}

/** Cancel the in-flight session generation. Idempotent. Shares the global
 *  cancellation token with story-mode (Architecture Wall #6). */
export async function cancelSessionGeneration(): Promise<void> {
  return invoke('cancel_session_generation');
}

export async function renameSession(sessionId: string, name: string): Promise<void> {
  return invoke('rename_session', { sessionId, name });
}

export async function deleteSession(sessionId: string): Promise<void> {
  return invoke('delete_session', { sessionId });
}

export async function setSessionCollapsed(sessionId: string, collapsed: boolean): Promise<void> {
  return invoke('set_session_collapsed', { sessionId, collapsed });
}

/** Doc 23 §Re-opening. Read the persisted active-mode state for a story
 *  (call on story open). */
export async function getStoryActiveMode(storyId: string): Promise<StoryActiveMode> {
  return invoke<StoryActiveMode>('get_story_active_mode', { storyId });
}

/** Doc 23 §Re-opening. Persist the active-mode state — called by `modeStore`
 *  actions after each transition. */
export async function setStoryActiveMode(
  storyId: string,
  activeMode: 'story' | 'handover' | 'consulting',
  activeSessionId: string | null,
): Promise<void> {
  return invoke('set_story_active_mode', {
    storyId,
    activeMode,
    activeSessionId,
  });
}
