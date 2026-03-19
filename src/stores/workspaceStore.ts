import { create } from "zustand";
import type { ChatMessage, SiblingCount } from "../lib/types";

interface WorkspaceStore {
  activeStoryId: string | null;
  currentLeafId: string | null;
  isGenerating: boolean;
  streamingMsgId: string | null;
  messages: ChatMessage[];
  siblingCounts: SiblingCount[];

  // Phase 9: Context doc attachment
  attachedDocIds: string[];

  // Phase 11: Doc editor state
  activeDocId: string | null;
  docContent: string;
  docSavedContent: string;
  docDirty: boolean;
  docName: string;
  docSubtype: string | null;
  docItemType: string | null;

  setActiveStoryId: (id: string | null) => void;
  setCurrentLeafId: (id: string | null) => void;
  setIsGenerating: (v: boolean) => void;
  setStreamingMsgId: (id: string | null) => void;
  setMessages: (msgs: ChatMessage[]) => void;
  setSiblingCounts: (counts: SiblingCount[]) => void;
  appendStreamDelta: (msgId: string, delta: string) => void;
  finalizeStream: (tempId: string, modelMsg: ChatMessage) => void;
  addOptimisticMessages: (userMsg: ChatMessage, modelPlaceholder: ChatMessage) => void;
  removeMessages: (ids: string[]) => void;
  clearWorkspace: () => void;

  // Phase 9: Context doc actions
  setAttachedDocIds: (ids: string[]) => void;
  addAttachedDocId: (id: string) => void;
  removeAttachedDocId: (id: string) => void;

  // Phase 11: Doc editor actions
  openDoc: (id: string, content: string, name: string, subtype: string | null, itemType: string) => void;
  closeDoc: () => void;
  setDocContent: (content: string) => void;
  markDocSaved: () => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  activeStoryId: null,
  currentLeafId: null,
  isGenerating: false,
  streamingMsgId: null,
  messages: [],
  siblingCounts: [],

  // Phase 9 defaults
  attachedDocIds: [],

  // Phase 11 defaults
  activeDocId: null,
  docContent: "",
  docSavedContent: "",
  docDirty: false,
  docName: "",
  docSubtype: null,
  docItemType: null,

  setActiveStoryId: (id) => set({ activeStoryId: id, activeDocId: null, attachedDocIds: [] }),
  setCurrentLeafId: (id) => set({ currentLeafId: id }),
  setIsGenerating: (v) => set({ isGenerating: v }),
  setStreamingMsgId: (id) => set({ streamingMsgId: id }),
  setMessages: (msgs) => set({ messages: msgs }),
  setSiblingCounts: (counts) => set({ siblingCounts: counts }),

  appendStreamDelta: (msgId, delta) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === msgId ? { ...m, content: m.content + delta } : m,
      ),
    })),

  finalizeStream: (tempId, modelMsg) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === tempId ? modelMsg : m)),
      currentLeafId: modelMsg.id,
      isGenerating: false,
      streamingMsgId: null,
    })),

  addOptimisticMessages: (userMsg, modelPlaceholder) =>
    set((state) => ({
      messages: [...state.messages, userMsg, modelPlaceholder],
    })),

  removeMessages: (ids) =>
    set((state) => ({
      messages: state.messages.filter((m) => !ids.includes(m.id)),
    })),

  clearWorkspace: () =>
    set({
      activeStoryId: null,
      currentLeafId: null,
      isGenerating: false,
      streamingMsgId: null,
      messages: [],
      siblingCounts: [],
      attachedDocIds: [],
      activeDocId: null,
      docContent: "",
      docSavedContent: "",
      docDirty: false,
      docName: "",
      docSubtype: null,
      docItemType: null,
    }),

  // Phase 9: Context doc actions
  setAttachedDocIds: (ids) => set({ attachedDocIds: ids }),
  addAttachedDocId: (id) =>
    set((state) => ({
      attachedDocIds: state.attachedDocIds.includes(id)
        ? state.attachedDocIds
        : [...state.attachedDocIds, id],
    })),
  removeAttachedDocId: (id) =>
    set((state) => ({
      attachedDocIds: state.attachedDocIds.filter((d) => d !== id),
    })),

  // Phase 11: Doc editor actions
  openDoc: (id, content, name, subtype, itemType) =>
    set({
      activeDocId: id,
      docContent: content,
      docSavedContent: content,
      docDirty: false,
      docName: name,
      docSubtype: subtype,
      docItemType: itemType,
    }),

  closeDoc: () =>
    set({
      activeDocId: null,
      docContent: "",
      docSavedContent: "",
      docDirty: false,
      docName: "",
      docSubtype: null,
      docItemType: null,
    }),

  setDocContent: (content) =>
    set((state) => ({
      docContent: content,
      docDirty: content !== state.docSavedContent,
    })),

  markDocSaved: () =>
    set((state) => ({
      docSavedContent: state.docContent,
      docDirty: false,
    })),
}));
