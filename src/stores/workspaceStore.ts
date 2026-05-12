import { create } from 'zustand';

import {
  cancelGeneration as ipcCancelGeneration,
  clearDraft as ipcClearDraft,
  deleteExchange as ipcDeleteExchange,
  deleteFrom as ipcDeleteFrom,
  editUserMessage as ipcEditUserMessage,
  getDraft as ipcGetDraft,
  loadMessages as ipcLoadMessages,
  regenerateLastResponse as ipcRegenerateLast,
  saveDraft as ipcSaveDraft,
  sendMessage as ipcSendMessage,
  updateFeedback as ipcUpdateFeedback,
  updateMessageContent as ipcUpdateMessageContent,
} from '@/lib/tauriApi/conversation';
import {
  cancelSessionGeneration as ipcCancelSessionGeneration,
  sendSessionMessage as ipcSendSessionMessage,
} from '@/lib/tauriApi/modes';

import type { ChatMessage, InputDraft, TokenEstimate, UserContent } from '@/lib/types';

/** Doc 15 §Status View. The Theater Status section maps these to glyph + copy. */
export type GenerationStatus =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'thinking'; startedAt: number }
  | { kind: 'streaming'; startedAt: number; tokenCount: number }
  | { kind: 'complete'; finishReason: string; tokenCount: number | null; durationMs: number }
  | { kind: 'stopped'; finishReason: string; detail: string };

const EMPTY_DRAFT: InputDraft = {
  plot_direction: '',
  background_information: '',
  modificators: [],
  constraints: '',
};

/**
 * Doc 06 §workspaceStore. Phase 3 surface:
 *  - active story, story-kind messages, draft, generation lifecycle.
 *  - `isGenerating` is the single global flag (Architecture Wall #6) — one
 *    model call in flight at a time.
 *  - `currentUserMessageId` / `currentModelMessageId` track the in-flight
 *    pair so terminal events know what to retract / hard-delete.
 *  - `userInitiatedCancel` distinguishes user-stop (cleanup) from lock-fired
 *    (no cleanup) on `generation_cancelled` events.
 *
 * History assembly is server-side only (Architecture Wall #1). This store
 * never touches request shape — it sends `(story_id, draft: UserContent)`
 * and renders what comes back.
 */
interface WorkspaceState {
  activeStoryId: string | null;
  messages: ChatMessage[];
  draft: InputDraft;

  isGenerating: boolean;
  generationStatus: GenerationStatus;
  /** Set when the stream task begins; cleared on terminal event. */
  currentUserMessageId: string | null;
  currentModelMessageId: string | null;
  /** Set when a session send is in flight. `null` = story send (or idle).
   *  Disambiguates which IPC the cancel/handlers route to. */
  currentSessionId: string | null;
  /** True iff the frontend issued `cancel_generation`. Drives the
   *  user-stop vs lock-fired branch on `generation_cancelled`. */
  userInitiatedCancel: boolean;

  tokenEstimate: TokenEstimate | null;

  // --- Actions ---
  setIsGenerating(val: boolean): void; // legacy seam — Phase 3 keeps it for any non-IPC callers
  setActiveStory(storyId: string | null): Promise<void>;
  setDraftField<K extends keyof InputDraft>(field: K, value: InputDraft[K]): void;
  setDraft(draft: InputDraft): void;
  send(): Promise<void>;
  /** Phase 4: send a turn to a handover/consulting session. The text is the
   *  single-field input shape from Doc 23. */
  sendSession(sessionId: string, text: string): Promise<void>;
  cancel(): Promise<void>;
  editUser(messageId: string, content: UserContent): Promise<void>;
  updateModelContent(messageId: string, text: string): Promise<void>;
  regenerateLast(): Promise<void>;
  deleteExchange(messageId: string): Promise<void>;
  deleteFrom(messageId: string): Promise<void>;
  updateFeedback(messageId: string, feedback: string): Promise<void>;
  setTokenEstimate(est: TokenEstimate | null): void;

  // --- Event handlers (called by useWorkspaceEvents) ---
  onMessageChunk(storyId: string, chunk: string): void;
  onMessageComplete(
    storyId: string,
    messageId: string,
    finishReason: string | null,
    tokenCount: number | null,
  ): Promise<void>;
  onGenerationCancelled(
    storyId: string,
    userMessageId: string,
    modelMessageId: string,
  ): Promise<void>;
  onGenerationFailed(storyId: string, errorKind: string, errorDetail: string): Promise<void>;

  // --- Session event handlers (Phase 4, Doc 23) ---
  onSessionMessageChunk(sessionId: string, chunk: string): void;
  onSessionMessageComplete(
    sessionId: string,
    messageId: string,
    finishReason: string | null,
    tokenCount: number | null,
  ): Promise<void>;
  onSessionGenerationCancelled(
    sessionId: string,
    userMessageId: string,
    modelMessageId: string,
  ): Promise<void>;
  onSessionGenerationFailed(
    sessionId: string,
    errorKind: string,
    errorDetail: string,
  ): Promise<void>;

  clear(): void;
}

// --- Draft autosave debounce (module-scope) ---
const DRAFT_DEBOUNCE_MS = 1000;
let draftTimer: ReturnType<typeof setTimeout> | null = null;
let pendingDraftStoryId: string | null = null;

function scheduleDraftSave(storyId: string, draft: InputDraft): void {
  if (draftTimer !== null) clearTimeout(draftTimer);
  pendingDraftStoryId = storyId;
  draftTimer = setTimeout(() => {
    draftTimer = null;
    pendingDraftStoryId = null;
    void ipcSaveDraft(storyId, draft).catch((e) => {
      console.error('save_draft failed', e);
    });
  }, DRAFT_DEBOUNCE_MS);
}

/** Flush any pending debounced draft write synchronously (in the next tick).
 *  Used by `lockVault` and story switching — Doc 15 §Edge Cases. */
export async function flushPendingDraft(): Promise<void> {
  if (draftTimer === null || pendingDraftStoryId === null) return;
  clearTimeout(draftTimer);
  const storyId = pendingDraftStoryId;
  draftTimer = null;
  pendingDraftStoryId = null;
  const draft = useWorkspaceStore.getState().draft;
  await ipcSaveDraft(storyId, draft);
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  activeStoryId: null,
  messages: [],
  draft: EMPTY_DRAFT,

  isGenerating: false,
  generationStatus: { kind: 'idle' },
  currentUserMessageId: null,
  currentModelMessageId: null,
  currentSessionId: null,
  userInitiatedCancel: false,

  tokenEstimate: null,

  setIsGenerating(val) {
    set({ isGenerating: val });
  },

  async setActiveStory(storyId) {
    // Switching story flushes any pending draft for the previous story.
    if (get().activeStoryId !== null && get().activeStoryId !== storyId) {
      try {
        await flushPendingDraft();
      } catch {
        // best-effort — story switch should not be blocked by a draft save
      }
    }

    if (storyId === null) {
      set({
        activeStoryId: null,
        messages: [],
        draft: EMPTY_DRAFT,
        generationStatus: { kind: 'idle' },
        tokenEstimate: null,
      });
      return;
    }

    set({
      activeStoryId: storyId,
      messages: [],
      draft: EMPTY_DRAFT,
      generationStatus: { kind: 'idle' },
      tokenEstimate: null,
    });

    const [messages, draft] = await Promise.all([ipcLoadMessages(storyId), ipcGetDraft(storyId)]);

    // Only commit if this is still the active story (guard against rapid switches).
    if (get().activeStoryId === storyId) {
      set({ messages, draft });
    }
  },

  setDraftField(field, value) {
    const next: InputDraft = { ...get().draft, [field]: value };
    set({ draft: next });
    const storyId = get().activeStoryId;
    if (storyId !== null) scheduleDraftSave(storyId, next);
  },

  setDraft(draft) {
    set({ draft });
    const storyId = get().activeStoryId;
    if (storyId !== null) scheduleDraftSave(storyId, draft);
  },

  async send() {
    const storyId = get().activeStoryId;
    if (storyId === null) return;
    const draft = get().draft;
    if (draft.plot_direction.trim().length === 0) return;
    if (get().isGenerating) return;

    // Flush any pending debounced draft save before the send fires — backend
    // will clear the draft on STOP, but a stale write racing in after would
    // overwrite it. (Doc 15 §Edge Cases.)
    if (draftTimer !== null) {
      clearTimeout(draftTimer);
      draftTimer = null;
      pendingDraftStoryId = null;
    }

    set({
      isGenerating: true,
      generationStatus: { kind: 'preparing' },
      userInitiatedCancel: false,
    });

    let result;
    try {
      result = await ipcSendMessage(storyId, draft);
    } catch (e) {
      set({
        isGenerating: false,
        generationStatus: {
          kind: 'stopped',
          finishReason: 'ERROR',
          detail: e instanceof Error ? e.message : String(e),
        },
      });
      throw e;
    }

    set({
      currentUserMessageId: result.user_message_id,
      currentModelMessageId: result.model_message_id,
      generationStatus: { kind: 'thinking', startedAt: Date.now() },
    });

    // Reload the message list so the optimistic user bubble + empty model
    // placeholder show up immediately. The model row's content is empty until
    // chunks arrive.
    try {
      const messages = await ipcLoadMessages(storyId);
      if (get().activeStoryId === storyId) set({ messages });
    } catch (e) {
      console.error('load_story_messages after send failed', e);
    }
  },

  async cancel() {
    if (!get().isGenerating) return;
    set({ userInitiatedCancel: true });
    const sessionId = get().currentSessionId;
    try {
      // Backend's cancellation token is global (Architecture Wall #6: one
      // model call in flight at a time), but we route to the matching IPC
      // for telemetry parity with the originating send.
      if (sessionId !== null) {
        await ipcCancelSessionGeneration();
      } else {
        await ipcCancelGeneration();
      }
    } catch (e) {
      console.error('cancel_generation failed', e);
    }
  },

  async sendSession(sessionId, text) {
    const storyId = get().activeStoryId;
    if (storyId === null) return;
    if (text.trim().length === 0) return;
    if (get().isGenerating) return;

    set({
      isGenerating: true,
      generationStatus: { kind: 'preparing' },
      currentSessionId: sessionId,
      userInitiatedCancel: false,
    });

    let result;
    try {
      result = await ipcSendSessionMessage(sessionId, text);
    } catch (e) {
      set({
        isGenerating: false,
        currentSessionId: null,
        generationStatus: {
          kind: 'stopped',
          finishReason: 'ERROR',
          detail: e instanceof Error ? e.message : String(e),
        },
      });
      throw e;
    }

    set({
      currentUserMessageId: result.user_message_id,
      currentModelMessageId: result.model_message_id,
      generationStatus: { kind: 'thinking', startedAt: Date.now() },
    });

    try {
      const messages = await ipcLoadMessages(storyId);
      if (get().activeStoryId === storyId) set({ messages });
    } catch (e) {
      console.error('load_messages after sendSession failed', e);
    }
  },

  async editUser(messageId, content) {
    if (get().isGenerating) return;
    const storyId = get().activeStoryId;
    if (storyId === null) return;

    set({
      isGenerating: true,
      generationStatus: { kind: 'preparing' },
      userInitiatedCancel: false,
    });

    let result;
    try {
      result = await ipcEditUserMessage(messageId, content);
    } catch (e) {
      set({
        isGenerating: false,
        generationStatus: {
          kind: 'stopped',
          finishReason: 'ERROR',
          detail: e instanceof Error ? e.message : String(e),
        },
      });
      throw e;
    }

    // edit_user_message returns the new model_message_id; the user_message_id
    // is the existing one (the edited row was re-anchored, not re-inserted).
    set({
      currentUserMessageId: messageId,
      currentModelMessageId: result.model_message_id,
      generationStatus: { kind: 'thinking', startedAt: Date.now() },
    });

    try {
      const messages = await ipcLoadMessages(storyId);
      if (get().activeStoryId === storyId) set({ messages });
    } catch (e) {
      console.error('load_story_messages after edit failed', e);
    }
  },

  async updateModelContent(messageId, text) {
    if (get().isGenerating) return;
    await ipcUpdateMessageContent(messageId, text);
    const storyId = get().activeStoryId;
    if (storyId !== null) {
      const messages = await ipcLoadMessages(storyId);
      if (get().activeStoryId === storyId) set({ messages });
    }
  },

  async regenerateLast() {
    if (get().isGenerating) return;
    const storyId = get().activeStoryId;
    if (storyId === null) return;

    set({
      isGenerating: true,
      generationStatus: { kind: 'preparing' },
      userInitiatedCancel: false,
    });

    let result;
    try {
      result = await ipcRegenerateLast(storyId);
    } catch (e) {
      set({
        isGenerating: false,
        generationStatus: {
          kind: 'stopped',
          finishReason: 'ERROR',
          detail: e instanceof Error ? e.message : String(e),
        },
      });
      throw e;
    }

    set({
      currentUserMessageId: null,
      currentModelMessageId: result.model_message_id,
      generationStatus: { kind: 'thinking', startedAt: Date.now() },
    });

    try {
      const messages = await ipcLoadMessages(storyId);
      if (get().activeStoryId === storyId) set({ messages });
    } catch (e) {
      console.error('load_story_messages after regenerate failed', e);
    }
  },

  async deleteExchange(messageId) {
    if (get().isGenerating) return;
    const storyId = get().activeStoryId;
    if (storyId === null) return;
    await ipcDeleteExchange(messageId);
    const messages = await ipcLoadMessages(storyId);
    if (get().activeStoryId === storyId) set({ messages });
  },

  async deleteFrom(messageId) {
    if (get().isGenerating) return;
    const storyId = get().activeStoryId;
    if (storyId === null) return;
    await ipcDeleteFrom(messageId);
    const messages = await ipcLoadMessages(storyId);
    if (get().activeStoryId === storyId) set({ messages });
  },

  async updateFeedback(messageId, feedback) {
    await ipcUpdateFeedback(messageId, feedback);
    const storyId = get().activeStoryId;
    if (storyId === null) return;
    const messages = await ipcLoadMessages(storyId);
    if (get().activeStoryId === storyId) set({ messages });
  },

  setTokenEstimate(est) {
    set({ tokenEstimate: est });
  },

  onMessageChunk(storyId, chunk) {
    if (get().activeStoryId !== storyId) return;
    const modelId = get().currentModelMessageId;
    if (modelId === null) return;

    const messages = get().messages.map((m) =>
      m.id === modelId ? { ...m, content: m.content + chunk } : m,
    );

    const status = get().generationStatus;
    const startedAt =
      status.kind === 'streaming' || status.kind === 'thinking' ? status.startedAt : Date.now();
    const prevTokens = status.kind === 'streaming' ? status.tokenCount : 0;
    // Cheap chunk-count fallback — server provides the authoritative count
    // in `message_complete`. The Status display labels this as approximate.
    const newTokens = prevTokens + Math.max(1, Math.round(chunk.length / 4));

    set({
      messages,
      generationStatus: { kind: 'streaming', startedAt, tokenCount: newTokens },
    });
  },

  async onMessageComplete(storyId, messageId, finishReason, tokenCount) {
    if (get().activeStoryId !== storyId) {
      // Clear flight markers even if the story is no longer active.
      set({
        isGenerating: false,
        currentUserMessageId: null,
        currentModelMessageId: null,
        currentSessionId: null,
      });
      return;
    }

    const startedAt =
      get().generationStatus.kind === 'streaming' || get().generationStatus.kind === 'thinking'
        ? (get().generationStatus as { startedAt: number }).startedAt
        : Date.now();
    const duration = Date.now() - startedAt;
    const finish = finishReason ?? 'STOP';

    // Reload to get final content + token_count + finish_reason from DB.
    try {
      const messages = await ipcLoadMessages(storyId);
      if (get().activeStoryId === storyId) set({ messages });
    } catch (e) {
      console.error('load_story_messages after complete failed', e);
    }

    if (finish === 'STOP') {
      // Backend already cleared `story_state.draft`; mirror locally.
      set({
        draft: EMPTY_DRAFT,
        isGenerating: false,
        currentUserMessageId: null,
        currentModelMessageId: null,
        currentSessionId: null,
        generationStatus: {
          kind: 'complete',
          finishReason: finish,
          tokenCount,
          durationMs: duration,
        },
      });
    } else {
      set({
        isGenerating: false,
        currentUserMessageId: null,
        currentModelMessageId: null,
        currentSessionId: null,
        generationStatus: {
          kind: 'stopped',
          finishReason: finish,
          detail: messageIdDetail(messageId, finish),
        },
      });
    }
  },

  async onGenerationCancelled(storyId, userMessageId, modelMessageId) {
    const wasUserInitiated = get().userInitiatedCancel;

    if (wasUserInitiated && userMessageId !== '') {
      // Doc 15 §Cancellation Taxonomy: user-stop deletes both rows.
      try {
        await ipcDeleteExchange(userMessageId);
      } catch (e) {
        console.error('delete_exchange after user-cancel failed', e);
      }
    }
    // Otherwise (lock-fired, or edit-regenerate cancel with no user-row to
    // drop): backend has preserved the partial AI text. No frontend cleanup.

    if (get().activeStoryId === storyId) {
      try {
        const messages = await ipcLoadMessages(storyId);
        if (get().activeStoryId === storyId) set({ messages });
      } catch {
        /* ignore — vault may be locking */
      }
    }

    set({
      isGenerating: false,
      currentUserMessageId: null,
      currentModelMessageId: null,
      currentSessionId: null,
      userInitiatedCancel: false,
      generationStatus: wasUserInitiated
        ? { kind: 'idle' }
        : {
            kind: 'stopped',
            finishReason: 'CANCELLED',
            detail: `model_message_id=${modelMessageId}`,
          },
    });
  },

  async onGenerationFailed(storyId, errorKind, errorDetail) {
    // Backend already hard-deleted both rows on failure (Doc 15 §Bubble
    // Lifecycle). Reload to drop the optimistic UI.
    if (get().activeStoryId === storyId) {
      try {
        const messages = await ipcLoadMessages(storyId);
        if (get().activeStoryId === storyId) set({ messages });
      } catch {
        /* ignore */
      }
    }
    set({
      isGenerating: false,
      currentUserMessageId: null,
      currentModelMessageId: null,
      currentSessionId: null,
      userInitiatedCancel: false,
      generationStatus: { kind: 'stopped', finishReason: errorKind, detail: errorDetail },
    });
  },

  clear() {
    if (draftTimer !== null) {
      clearTimeout(draftTimer);
      draftTimer = null;
      pendingDraftStoryId = null;
    }
    set({
      activeStoryId: null,
      messages: [],
      draft: EMPTY_DRAFT,
      isGenerating: false,
      generationStatus: { kind: 'idle' },
      currentUserMessageId: null,
      currentModelMessageId: null,
      currentSessionId: null,
      userInitiatedCancel: false,
      tokenEstimate: null,
    });
  },

  // --- Session event handlers (Phase 4, Doc 23) ---
  // Structurally identical to the story-mode handlers above; chunks key off
  // `currentModelMessageId` (set by `sendSession`), not `sessionId`. The
  // session id is only used to filter events that belong to a different
  // story than the one currently active.

  onSessionMessageChunk(sessionId, chunk) {
    if (get().currentSessionId !== sessionId) return;
    const modelId = get().currentModelMessageId;
    if (modelId === null) return;

    const messages = get().messages.map((m) =>
      m.id === modelId ? { ...m, content: m.content + chunk } : m,
    );

    const status = get().generationStatus;
    const startedAt =
      status.kind === 'streaming' || status.kind === 'thinking' ? status.startedAt : Date.now();
    const prevTokens = status.kind === 'streaming' ? status.tokenCount : 0;
    const newTokens = prevTokens + Math.max(1, Math.round(chunk.length / 4));

    set({
      messages,
      generationStatus: { kind: 'streaming', startedAt, tokenCount: newTokens },
    });
  },

  async onSessionMessageComplete(sessionId, messageId, finishReason, tokenCount) {
    const isFlightSession = get().currentSessionId === sessionId;
    const storyId = get().activeStoryId;

    if (storyId !== null) {
      try {
        const messages = await ipcLoadMessages(storyId);
        if (get().activeStoryId === storyId) set({ messages });
      } catch (e) {
        console.error('load_messages after session complete failed', e);
      }
    }

    if (!isFlightSession) {
      // Stale event from a session we are no longer driving — clear nothing.
      return;
    }

    const startedAt =
      get().generationStatus.kind === 'streaming' || get().generationStatus.kind === 'thinking'
        ? (get().generationStatus as { startedAt: number }).startedAt
        : Date.now();
    const duration = Date.now() - startedAt;
    const finish = finishReason ?? 'STOP';

    if (finish === 'STOP') {
      set({
        isGenerating: false,
        currentUserMessageId: null,
        currentModelMessageId: null,
        currentSessionId: null,
        generationStatus: {
          kind: 'complete',
          finishReason: finish,
          tokenCount,
          durationMs: duration,
        },
      });
    } else {
      set({
        isGenerating: false,
        currentUserMessageId: null,
        currentModelMessageId: null,
        currentSessionId: null,
        generationStatus: {
          kind: 'stopped',
          finishReason: finish,
          detail: messageIdDetail(messageId, finish),
        },
      });
    }
  },

  async onSessionGenerationCancelled(sessionId, userMessageId, modelMessageId) {
    const wasUserInitiated = get().userInitiatedCancel;
    const isFlightSession = get().currentSessionId === sessionId;

    if (wasUserInitiated && isFlightSession && userMessageId !== '') {
      try {
        await ipcDeleteExchange(userMessageId);
      } catch (e) {
        console.error('delete_exchange after session user-cancel failed', e);
      }
    }

    const storyId = get().activeStoryId;
    if (storyId !== null) {
      try {
        const messages = await ipcLoadMessages(storyId);
        if (get().activeStoryId === storyId) set({ messages });
      } catch {
        /* ignore */
      }
    }

    if (!isFlightSession) return;

    set({
      isGenerating: false,
      currentUserMessageId: null,
      currentModelMessageId: null,
      currentSessionId: null,
      userInitiatedCancel: false,
      generationStatus: wasUserInitiated
        ? { kind: 'idle' }
        : {
            kind: 'stopped',
            finishReason: 'CANCELLED',
            detail: `model_message_id=${modelMessageId}`,
          },
    });
  },

  async onSessionGenerationFailed(sessionId, errorKind, errorDetail) {
    const isFlightSession = get().currentSessionId === sessionId;
    const storyId = get().activeStoryId;
    if (storyId !== null) {
      try {
        const messages = await ipcLoadMessages(storyId);
        if (get().activeStoryId === storyId) set({ messages });
      } catch {
        /* ignore */
      }
    }
    if (!isFlightSession) return;
    set({
      isGenerating: false,
      currentUserMessageId: null,
      currentModelMessageId: null,
      currentSessionId: null,
      userInitiatedCancel: false,
      generationStatus: { kind: 'stopped', finishReason: errorKind, detail: errorDetail },
    });
  },
}));

function messageIdDetail(messageId: string, finish: string): string {
  return `${finish} (message ${messageId.slice(0, 8)})`;
}

/** Hard-clear the draft via backend (writer "Clear" affordance). */
export async function clearDraftBackend(storyId: string): Promise<void> {
  await ipcClearDraft(storyId);
  useWorkspaceStore.setState({ draft: EMPTY_DRAFT });
}
