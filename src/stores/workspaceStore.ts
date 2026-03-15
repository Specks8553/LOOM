import { create } from "zustand";
import type { ChatMessage, SiblingCount } from "../lib/types";

interface WorkspaceStore {
  activeStoryId: string | null;
  currentLeafId: string | null;
  isGenerating: boolean;
  streamingMsgId: string | null;
  messages: ChatMessage[];
  siblingCounts: SiblingCount[];

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
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  activeStoryId: null,
  currentLeafId: null,
  isGenerating: false,
  streamingMsgId: null,
  messages: [],
  siblingCounts: [],

  setActiveStoryId: (id) => set({ activeStoryId: id }),
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
    }),
}));
