import { create } from 'zustand';

import { diffWords } from '@/lib/diff';
import { errorMessage, surfaceError, surfaceGenerationError } from '@/lib/errors';
import {
  clearSegmentSummary as ipcClearSegmentSummary,
  createCheckpoint as ipcCreateCheckpoint,
  deleteCheckpoint as ipcDeleteCheckpoint,
  getAccordionState as ipcGetAccordionState,
  renameCheckpoint as ipcRenameCheckpoint,
  setSegmentCollapsed as ipcSetSegmentCollapsed,
  setSegmentUseSummary as ipcSetSegmentUseSummary,
  summariseSegment as ipcSummariseSegment,
  updateSegmentSummary as ipcUpdateSegmentSummary,
} from '@/lib/tauriApi/accordion';
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
  cancelGhostwriterGeneration as ipcCancelGhostwriter,
  revertGhostwriterEdit as ipcRevertGhostwriter,
  saveGhostwriterEdit as ipcSaveGhostwriter,
  sendGhostwriterRequest as ipcSendGhostwriter,
} from '@/lib/tauriApi/ghostwriter';
import {
  addMark as ipcAddMark,
  listMarks as ipcListMarks,
  removeMark as ipcRemoveMark,
  updateMarkNote as ipcUpdateMarkNote,
} from '@/lib/tauriApi/marks';
import {
  cancelSessionGeneration as ipcCancelSessionGeneration,
  sendSessionMessage as ipcSendSessionMessage,
} from '@/lib/tauriApi/modes';
import {
  attachContextDoc as ipcAttachContextDoc,
  detachContextDoc as ipcDetachContextDoc,
  listAttachedDocs as ipcListAttachedDocs,
  updateItemContent as ipcUpdateItemContent,
} from '@/lib/tauriApi/vault';

import type {
  AccordionSegment,
  ChatMessage,
  Checkpoint,
  DiffSpan,
  GhostwriterEdit,
  GhostwriterSelection,
  ImportantMark,
  InputDraft,
  TokenEstimate,
  UserContent,
  VaultItemMeta,
} from '@/lib/types';

/** Doc 17 §Frontend State. Ghostwriter mode is workspace-scoped, one bubble
 *  at a time. The whole object is `null` when no bubble is in mode. */
export interface GhostwriterMode {
  /** The model bubble currently in Ghostwriter mode. */
  activeMessageId: string;
  phase: 'selecting' | 'composing' | 'generating' | 'reviewing';
  selection: GhostwriterSelection | null;
  instruction: string;
  /** Populated in `reviewing` — word-level diff of original vs revision. */
  diff: DiffSpan[] | null;
  /** The stitched result awaiting accept / reject. */
  pendingNewContent: string | null;
}

/** A selection is valid (≥ 1 word, Doc 17 §Selection constraints) iff it has
 *  at least one non-whitespace character. */
function isValidSelection(sel: GhostwriterSelection | null): boolean {
  return sel !== null && /\S/u.test(sel.selectedText);
}

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

  // --- Phase 5: Source Documents ---
  /** When set, DocEditor takes the workspace surface (Doc 10 Theater priority). */
  activeDocId: string | null;
  /** Per-story attachment list (mirrors story_state.context_doc_ids). */
  contextDocIds: string[];
  /** Resolved attached doc metadata for the active story (insertion order). */
  attachedDocs: VaultItemMeta[];

  // --- Phase 7: Accordion (Doc 16) ---
  /** Every checkpoint for the active story (start sentinel first). */
  checkpoints: Checkpoint[];
  /** Every closed segment for the active story, ordered by start anchor. */
  segments: AccordionSegment[];
  /** Set of segment ids the user is summarising right now. Multiple is
   *  prevented by the global isGenerating flag, but the set lets the banner
   *  show a per-segment spinner. */
  summarisingSegmentIds: Set<string>;

  // --- Phase 8: Ghostwriter (Doc 17) ---
  /** Non-null when a model bubble is in Ghostwriter mode. */
  ghostwriter: GhostwriterMode | null;

  // --- Phase 9: Feedback (Doc 28) ---
  /** Message id whose feedback strip is in edit mode; null = none open.
   *  Only the fact of editing is global — the textarea value is local to
   *  the `FeedbackStrip` component. */
  feedbackEditingMessageId: string | null;

  // --- Phase 14: Marks (Doc 30) ---
  /** Every mark for the active story (both roles, including orphaned). Loaded
   *  with messages; per-bubble rendering filters by `message_id`. */
  marks: ImportantMark[];

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

  // --- Phase 5: Source Documents (5B/5C wire UI into these) ---
  openDoc(id: string): void;
  closeDoc(): Promise<void>;
  /** Edit a doc's content; schedules a 1 s debounced save. 5B fills the body. */
  updateDocContent(id: string, content: string): void;
  /** Force any pending debounced save to complete now. Called on lock /
   *  close / world-switch (Doc 18 §Edit a doc). */
  flushDocSave(): Promise<void>;
  attachDoc(docId: string): Promise<void>;
  detachDoc(docId: string): Promise<void>;
  /** Reload `contextDocIds` + `attachedDocs` from the backend for the active story. */
  loadAttachedDocs(): Promise<void>;

  // --- Phase 7: Accordion (Doc 16) ---
  /** Re-fetch checkpoints + segments for the active story. Called on story
   *  activation and from the `accordion_state_changed` listener. */
  loadAccordionState(): Promise<void>;
  createCheckpoint(afterMessageId: string, name: string): Promise<void>;
  renameCheckpoint(checkpointId: string, name: string): Promise<void>;
  deleteCheckpoint(checkpointId: string): Promise<void>;
  updateSegmentSummary(segmentId: string, summary: string): Promise<void>;
  setSegmentCollapsed(segmentId: string, collapsed: boolean): Promise<void>;
  setSegmentUseSummary(segmentId: string, useSummary: boolean): Promise<void>;
  clearSegmentSummary(segmentId: string): Promise<void>;
  /** Triggers a non-streaming Gemini summarisation. Raises the global
   *  `isGenerating` flag (Architecture Wall #6 — one model call at a time;
   *  CQ-11) in addition to adding the segment id to `summarisingSegmentIds`
   *  for the per-segment spinner. No-op if a generation is already in flight.
   *  Resolves to the new summary, or `null` on cancellation / when gated out. */
  summariseSegment(segmentId: string): Promise<string | null>;

  // --- Phase 8: Ghostwriter (Doc 17) ---
  /** Enter Ghostwriter mode on a model bubble. Callers must resolve the
   *  one-bubble-at-a-time discard confirmation (Doc 17) before calling. */
  enterGhostwriter(messageId: string): void;
  /** Exit mode — drops the pulse frame, panel, and plain-text rendering. */
  exitGhostwriter(): void;
  /** Record the current in-bubble selection; transitions selecting<->composing. */
  setGhostwriterSelection(sel: GhostwriterSelection | null): void;
  setGhostwriterInstruction(text: string): void;
  /** Run `send_ghostwriter_request`; on success computes the diff and moves to
   *  `reviewing`. On cancel returns to `selecting`; on error to `composing`. */
  generateGhostwriter(): Promise<void>;
  /** Signal the in-flight Ghostwriter generation to cancel. */
  cancelGhostwriterGeneration(): Promise<void>;
  /** Persist the pending revision via `save_ghostwriter_edit`, then exit mode.
   *  Callers must resolve the cached-message guard (Doc 22) beforehand. */
  acceptGhostwriter(): Promise<void>;
  /** Discard the pending diff; return to `composing` with instruction kept. */
  rejectGhostwriter(): void;
  /** Pop the most-recent accepted edit for a message via
   *  `revert_ghostwriter_edit`. Works whether or not the bubble is in mode. */
  revertGhostwriter(messageId: string): Promise<void>;

  // --- Phase 9: Feedback (Doc 28) ---
  /** Open the feedback editor on a bubble. Implicitly cancels any other
   *  bubble's open edit (one editor at a time). */
  beginFeedbackEdit(messageId: string): void;
  /** Close the feedback editor without saving. */
  cancelFeedbackEdit(): void;
  /** Persist a feedback value via `update_feedback`, then close the editor.
   *  Callers resolve the cached-message guard (Doc 22) beforehand. */
  commitFeedbackEdit(messageId: string, value: string): Promise<void>;

  // --- Phase 14: Marks (Doc 30) ---
  /** Re-fetch all marks for the active story. Called on story activation and
   *  from the `marks_changed` listener. */
  loadMarks(): Promise<void>;
  /** Create a mark on a story bubble. `offsets` are present for AI bubbles and
   *  `null` for user bubbles (no single-string mapping). Not gated by
   *  `isGenerating` — a pure DB write (Doc 30 §3). */
  addMark(
    messageId: string,
    quotedText: string,
    offsets: { start: number; end: number } | null,
    note?: string | null,
  ): Promise<void>;
  removeMark(markId: string): Promise<void>;
  updateMarkNote(markId: string, note: string | null): Promise<void>;

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

// --- DocEditor autosave debounce (module-scope, Phase 5) ---
const DOC_SAVE_DEBOUNCE_MS = 1000;
let docTimer: ReturnType<typeof setTimeout> | null = null;
let pendingDocId: string | null = null;
let pendingDocContent: string = '';

function scheduleDocSave(docId: string, content: string): void {
  if (docTimer !== null) clearTimeout(docTimer);
  pendingDocId = docId;
  pendingDocContent = content;
  docTimer = setTimeout(() => {
    const id = pendingDocId;
    const text = pendingDocContent;
    docTimer = null;
    pendingDocId = null;
    pendingDocContent = '';
    if (id === null) return;
    void ipcUpdateItemContent(id, text).catch((e) => {
      console.error('update_item_content failed', e);
    });
  }, DOC_SAVE_DEBOUNCE_MS);
}

/** Force any pending debounced doc save to complete now. Used by lock /
 *  closeDoc / world-switch. */
export async function flushPendingDocSave(): Promise<void> {
  if (docTimer === null || pendingDocId === null) return;
  clearTimeout(docTimer);
  const id = pendingDocId;
  const content = pendingDocContent;
  docTimer = null;
  pendingDocId = null;
  pendingDocContent = '';
  await ipcUpdateItemContent(id, content);
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

  activeDocId: null,
  contextDocIds: [],
  attachedDocs: [],

  checkpoints: [],
  segments: [],
  summarisingSegmentIds: new Set<string>(),

  ghostwriter: null,
  feedbackEditingMessageId: null,

  marks: [],

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
        contextDocIds: [],
        attachedDocs: [],
        checkpoints: [],
        segments: [],
        summarisingSegmentIds: new Set<string>(),
        ghostwriter: null,
        feedbackEditingMessageId: null,
        marks: [],
      });
      return;
    }

    set({
      activeStoryId: storyId,
      messages: [],
      draft: EMPTY_DRAFT,
      generationStatus: { kind: 'idle' },
      tokenEstimate: null,
      contextDocIds: [],
      attachedDocs: [],
      checkpoints: [],
      segments: [],
      summarisingSegmentIds: new Set<string>(),
      ghostwriter: null,
      feedbackEditingMessageId: null,
      marks: [],
    });

    const [messages, draft, attached, accordion, marks] = await Promise.all([
      ipcLoadMessages(storyId),
      ipcGetDraft(storyId),
      ipcListAttachedDocs(storyId),
      ipcGetAccordionState(storyId),
      ipcListMarks(storyId),
    ]);

    // Only commit if this is still the active story (guard against rapid switches).
    if (get().activeStoryId === storyId) {
      set({
        messages,
        draft,
        attachedDocs: attached,
        contextDocIds: attached.map((d) => d.id),
        checkpoints: accordion.checkpoints,
        segments: accordion.segments,
        marks,
      });
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
          detail: errorMessage(e),
        },
      });
      surfaceError(e, 'Could not send your message.');
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
          detail: errorMessage(e),
        },
      });
      surfaceError(e, 'Could not send your message.');
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
          detail: errorMessage(e),
        },
      });
      surfaceError(e, 'Could not send your message.');
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
          detail: errorMessage(e),
        },
      });
      surfaceError(e, 'Could not send your message.');
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

  // --- Phase 5: Source Documents ---

  openDoc(id) {
    set({ activeDocId: id });
  },

  async closeDoc() {
    try {
      await flushPendingDocSave();
    } catch (e) {
      console.error('flushPendingDocSave failed on closeDoc', e);
    }
    set({ activeDocId: null });
  },

  updateDocContent(id, content) {
    scheduleDocSave(id, content);
  },

  async flushDocSave() {
    await flushPendingDocSave();
  },

  async attachDoc(docId) {
    const storyId = get().activeStoryId;
    if (storyId === null) return;
    const ids = await ipcAttachContextDoc(storyId, docId);
    // Refresh resolved metadata so UI gets the names.
    let attached: VaultItemMeta[] = [];
    try {
      attached = await ipcListAttachedDocs(storyId);
    } catch (e) {
      console.error('list_attached_docs after attach failed', e);
    }
    if (get().activeStoryId === storyId) {
      set({ contextDocIds: ids, attachedDocs: attached });
    }
  },

  async detachDoc(docId) {
    const storyId = get().activeStoryId;
    if (storyId === null) return;
    const ids = await ipcDetachContextDoc(storyId, docId);
    let attached: VaultItemMeta[] = [];
    try {
      attached = await ipcListAttachedDocs(storyId);
    } catch (e) {
      console.error('list_attached_docs after detach failed', e);
    }
    if (get().activeStoryId === storyId) {
      set({ contextDocIds: ids, attachedDocs: attached });
    }
  },

  async loadAttachedDocs() {
    const storyId = get().activeStoryId;
    if (storyId === null) {
      set({ contextDocIds: [], attachedDocs: [] });
      return;
    }
    const attached = await ipcListAttachedDocs(storyId);
    if (get().activeStoryId === storyId) {
      set({ contextDocIds: attached.map((d) => d.id), attachedDocs: attached });
    }
  },

  // --- Phase 7: Accordion ---

  async loadAccordionState() {
    const storyId = get().activeStoryId;
    if (storyId === null) {
      set({ checkpoints: [], segments: [] });
      return;
    }
    const accordion = await ipcGetAccordionState(storyId);
    if (get().activeStoryId === storyId) {
      set({ checkpoints: accordion.checkpoints, segments: accordion.segments });
    }
  },

  async createCheckpoint(afterMessageId, name) {
    const storyId = get().activeStoryId;
    if (storyId === null) return;
    await ipcCreateCheckpoint(storyId, afterMessageId, name);
    // Listener will refetch, but call directly so the UI updates without
    // round-tripping the event.
    await get().loadAccordionState();
  },

  async renameCheckpoint(checkpointId, name) {
    await ipcRenameCheckpoint(checkpointId, name);
    await get().loadAccordionState();
  },

  async deleteCheckpoint(checkpointId) {
    await ipcDeleteCheckpoint(checkpointId);
    await get().loadAccordionState();
  },

  async updateSegmentSummary(segmentId, summary) {
    await ipcUpdateSegmentSummary(segmentId, summary);
    await get().loadAccordionState();
  },

  async setSegmentCollapsed(segmentId, collapsed) {
    await ipcSetSegmentCollapsed(segmentId, collapsed);
    await get().loadAccordionState();
  },

  async setSegmentUseSummary(segmentId, useSummary) {
    await ipcSetSegmentUseSummary(segmentId, useSummary);
    await get().loadAccordionState();
  },

  async clearSegmentSummary(segmentId) {
    await ipcClearSegmentSummary(segmentId);
    await get().loadAccordionState();
  },

  async summariseSegment(segmentId) {
    // Architecture Wall #6 (CQ-11): summarisation is a real model call, so it
    // participates in the single global in-flight flag. The backend now also
    // rejects concurrent generations (CQ-03), but the frontend gate keeps the
    // UI honest (Send/regenerate/ghostwriter disabled while summarising). The
    // per-segment spinner (`summarisingSegmentIds`) is purely visual.
    if (get().isGenerating) return null;
    const nextSet = new Set(get().summarisingSegmentIds);
    nextSet.add(segmentId);
    set({ summarisingSegmentIds: nextSet, isGenerating: true });
    try {
      const result = await ipcSummariseSegment(segmentId);
      await get().loadAccordionState();
      return result;
    } catch (e) {
      surfaceError(e, "Couldn't summarise this section.");
      return null;
    } finally {
      const after = new Set(get().summarisingSegmentIds);
      after.delete(segmentId);
      set({ summarisingSegmentIds: after, isGenerating: false });
    }
  },

  // --- Phase 8: Ghostwriter (Doc 17) ---

  enterGhostwriter(messageId) {
    set({
      ghostwriter: {
        activeMessageId: messageId,
        phase: 'selecting',
        selection: null,
        instruction: '',
        diff: null,
        pendingNewContent: null,
      },
      // Ghostwriter hides the feedback affordance (Doc 28 §With Ghostwriter).
      feedbackEditingMessageId: null,
    });
  },

  exitGhostwriter() {
    set({ ghostwriter: null });
  },

  setGhostwriterSelection(sel) {
    const gw = get().ghostwriter;
    if (gw === null) return;
    // Once a request is in flight or under review the selection is frozen.
    if (gw.phase === 'generating' || gw.phase === 'reviewing') return;
    const valid = isValidSelection(sel);
    set({ ghostwriter: { ...gw, selection: sel, phase: valid ? 'composing' : 'selecting' } });
  },

  setGhostwriterInstruction(text) {
    const gw = get().ghostwriter;
    if (gw === null) return;
    set({ ghostwriter: { ...gw, instruction: text } });
  },

  async generateGhostwriter() {
    const gw = get().ghostwriter;
    if (gw === null || gw.phase !== 'composing') return;
    const sel = gw.selection;
    if (!isValidSelection(sel) || sel === null) return;
    if (gw.instruction.trim().length === 0) return;
    if (get().isGenerating) return;
    const message = get().messages.find((m) => m.id === gw.activeMessageId);
    if (message === undefined) return;
    const original = message.content;

    set({ isGenerating: true, ghostwriter: { ...gw, phase: 'generating' } });

    let result;
    try {
      result = await ipcSendGhostwriter(
        gw.activeMessageId,
        sel.startOffset,
        sel.endOffset,
        gw.instruction,
      );
    } catch (e) {
      set({ isGenerating: false });
      const cur = get().ghostwriter;
      if (cur !== null && cur.activeMessageId === gw.activeMessageId) {
        set({ ghostwriter: { ...cur, phase: 'composing' } });
      }
      surfaceError(e, "Couldn't generate revision.");
      return;
    }

    set({ isGenerating: false });
    const cur = get().ghostwriter;
    // Mode may have been exited or moved to another bubble while awaiting.
    if (cur === null || cur.activeMessageId !== gw.activeMessageId) return;

    if (result.cancelled) {
      set({ ghostwriter: { ...cur, phase: 'selecting' } });
      return;
    }

    const revised = result.revised_passage.trim();
    const newContent = original.slice(0, sel.startOffset) + revised + original.slice(sel.endOffset);
    const diff = diffWords(original, newContent);
    set({ ghostwriter: { ...cur, phase: 'reviewing', diff, pendingNewContent: newContent } });
  },

  async cancelGhostwriterGeneration() {
    try {
      await ipcCancelGhostwriter();
    } catch (e) {
      console.error('cancel_ghostwriter_generation failed', e);
    }
  },

  async acceptGhostwriter() {
    const gw = get().ghostwriter;
    if (gw === null || gw.phase !== 'reviewing') return;
    if (gw.pendingNewContent === null || gw.selection === null) return;
    const message = get().messages.find((m) => m.id === gw.activeMessageId);
    if (message === undefined) return;

    const record: GhostwriterEdit = {
      edited_at: new Date().toISOString(),
      original_content: message.content,
      new_content: gw.pendingNewContent,
      instruction: gw.instruction,
      selected_text: gw.selection.selectedText,
    };

    try {
      await ipcSaveGhostwriter(gw.activeMessageId, gw.pendingNewContent, record);
    } catch (e) {
      console.error('save_ghostwriter_edit failed', e);
      surfaceError(e, "Couldn't save revision.");
      return;
    }

    const storyId = get().activeStoryId;
    if (storyId !== null) {
      try {
        const messages = await ipcLoadMessages(storyId);
        if (get().activeStoryId === storyId) set({ messages });
      } catch (e) {
        console.error('load_messages after ghostwriter accept failed', e);
      }
    }
    set({ ghostwriter: null });
  },

  rejectGhostwriter() {
    const gw = get().ghostwriter;
    if (gw === null) return;
    set({ ghostwriter: { ...gw, phase: 'composing', diff: null, pendingNewContent: null } });
  },

  async revertGhostwriter(messageId) {
    try {
      await ipcRevertGhostwriter(messageId);
    } catch (e) {
      console.error('revert_ghostwriter_edit failed', e);
      surfaceError(e, "Couldn't revert revision.");
      return;
    }
    const storyId = get().activeStoryId;
    if (storyId !== null) {
      try {
        const messages = await ipcLoadMessages(storyId);
        if (get().activeStoryId === storyId) set({ messages });
      } catch (e) {
        console.error('load_messages after ghostwriter revert failed', e);
      }
    }
  },

  // --- Phase 9: Feedback (Doc 28) ---

  beginFeedbackEdit(messageId) {
    set({ feedbackEditingMessageId: messageId });
  },

  cancelFeedbackEdit() {
    set({ feedbackEditingMessageId: null });
  },

  async commitFeedbackEdit(messageId, value) {
    await get().updateFeedback(messageId, value);
    if (get().feedbackEditingMessageId === messageId) {
      set({ feedbackEditingMessageId: null });
    }
  },

  // --- Phase 14: Marks (Doc 30) ---
  // Mutations rely on the backend's `marks_changed` event to refresh state
  // (the listener calls `loadMarks`) — the same single-update-path discipline
  // re-anchor / orphan from content-mutation commands also flows through.

  async loadMarks() {
    const storyId = get().activeStoryId;
    if (storyId === null) return;
    try {
      const marks = await ipcListMarks(storyId);
      if (get().activeStoryId === storyId) set({ marks });
    } catch (e) {
      console.error('list_marks failed', e);
    }
  },

  async addMark(messageId, quotedText, offsets, note) {
    try {
      await ipcAddMark(
        messageId,
        quotedText,
        offsets?.start ?? null,
        offsets?.end ?? null,
        note ?? null,
      );
    } catch (e) {
      console.error('add_mark failed', e);
      surfaceError(e, "Couldn't mark this passage.");
    }
  },

  async removeMark(markId) {
    try {
      await ipcRemoveMark(markId);
    } catch (e) {
      console.error('remove_mark failed', e);
      surfaceError(e, "Couldn't remove this mark.");
    }
  },

  async updateMarkNote(markId, note) {
    try {
      await ipcUpdateMarkNote(markId, note);
    } catch (e) {
      console.error('update_mark_note failed', e);
      surfaceError(e, "Couldn't update the note.");
    }
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
    surfaceGenerationError(errorKind);
  },

  clear() {
    if (draftTimer !== null) {
      clearTimeout(draftTimer);
      draftTimer = null;
      pendingDraftStoryId = null;
    }
    if (docTimer !== null) {
      clearTimeout(docTimer);
      docTimer = null;
      pendingDocId = null;
      pendingDocContent = '';
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
      activeDocId: null,
      contextDocIds: [],
      attachedDocs: [],
      checkpoints: [],
      segments: [],
      summarisingSegmentIds: new Set<string>(),
      ghostwriter: null,
      feedbackEditingMessageId: null,
      marks: [],
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
    surfaceGenerationError(errorKind);
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
