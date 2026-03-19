import { create } from "zustand";

/** Character-offset selection within a message's plain-text content. */
export interface GhostwriterSelection {
  startOffset: number;
  endOffset: number;
  selectedText: string;
}

/** A single diff span (changed or unchanged). */
export interface DiffSpan {
  type: "unchanged" | "changed";
  text: string;
}

/** Full diff result after Ghostwriter generation. */
export interface GhostwriterDiff {
  spans: DiffSpan[];
  newContent: string;
}

/** Record stored in ghostwriter_history JSON array per message. */
export interface GhostwriterEdit {
  edited_at: string;
  original_content: string;
  new_content: string;
  instruction: string;
  selected_text: string;
}

type Phase = "idle" | "selecting" | "generating" | "reviewing";

interface GhostwriterStore {
  /** Which AI message is in Ghostwriter mode (null = inactive). */
  activeMsgId: string | null;
  /** Current phase of the Ghostwriter workflow. */
  phase: Phase;
  /** Text selection within the active bubble. */
  selection: GhostwriterSelection | null;
  /** User's revision instruction. */
  instruction: string;
  /** True while the Ghostwriter API request is in flight. */
  isGenerating: boolean;
  /** Diff result after generation completes. */
  pendingDiff: GhostwriterDiff | null;
  /** Original content of the message before any edits (for reject/revert). */
  originalContent: string;

  // ─── Actions ──────────────────────────────────────────────────────────────────

  /** Enter Ghostwriter mode on a message. */
  enter: (msgId: string, content: string) => void;
  /** Exit Ghostwriter mode, resetting all state. */
  exit: () => void;
  /** Set the text selection offsets. */
  setSelection: (sel: GhostwriterSelection | null) => void;
  /** Update the instruction text. */
  setInstruction: (text: string) => void;
  /** Mark generation as started. */
  startGeneration: () => void;
  /** Store the diff result after generation completes. */
  setDiff: (diff: GhostwriterDiff) => void;
  /** Mark generation as finished (success or failure). */
  stopGeneration: () => void;
}

export const useGhostwriterStore = create<GhostwriterStore>((set) => ({
  activeMsgId: null,
  phase: "idle",
  selection: null,
  instruction: "",
  isGenerating: false,
  pendingDiff: null,
  originalContent: "",

  enter: (msgId, content) =>
    set({
      activeMsgId: msgId,
      phase: "selecting",
      selection: null,
      instruction: "",
      isGenerating: false,
      pendingDiff: null,
      originalContent: content,
    }),

  exit: () =>
    set({
      activeMsgId: null,
      phase: "idle",
      selection: null,
      instruction: "",
      isGenerating: false,
      pendingDiff: null,
      originalContent: "",
    }),

  setSelection: (sel) => set({ selection: sel }),
  setInstruction: (text) => set({ instruction: text }),

  startGeneration: () => set({ isGenerating: true, phase: "generating" }),

  setDiff: (diff) =>
    set({ pendingDiff: diff, isGenerating: false, phase: "reviewing" }),

  stopGeneration: () => set({ isGenerating: false, phase: "selecting" }),
}));
