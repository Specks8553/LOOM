import { create } from "zustand";

interface WorkspaceStore {
  activeStoryId: string | null;
  currentLeafId: string | null;
  isGenerating: boolean;
  streamingMsgId: string | null;
  setActiveStoryId: (id: string | null) => void;
  setCurrentLeafId: (id: string | null) => void;
  setIsGenerating: (v: boolean) => void;
  setStreamingMsgId: (id: string | null) => void;
  clearWorkspace: () => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  activeStoryId: null,
  currentLeafId: null,
  isGenerating: false,
  streamingMsgId: null,

  setActiveStoryId: (id) => set({ activeStoryId: id }),
  setCurrentLeafId: (id) => set({ currentLeafId: id }),
  setIsGenerating: (v) => set({ isGenerating: v }),
  setStreamingMsgId: (id) => set({ streamingMsgId: id }),
  clearWorkspace: () =>
    set({
      activeStoryId: null,
      currentLeafId: null,
      isGenerating: false,
      streamingMsgId: null,
    }),
}));
