import { create } from "zustand";
import type { BranchMapData } from "../lib/types";
import { loadBranchMap } from "../lib/tauriApi";

interface BranchMapStore {
  data: BranchMapData | null;
  isLoading: boolean;
  scrollToId: string | null;

  load: (storyId: string) => Promise<void>;
  setScrollTo: (id: string | null) => void;
  clear: () => void;
}

export const useBranchMapStore = create<BranchMapStore>((set) => ({
  data: null,
  isLoading: false,
  scrollToId: null,

  load: async (storyId: string) => {
    set({ isLoading: true });
    try {
      const data = await loadBranchMap(storyId);
      set({ data, isLoading: false });
    } catch (err) {
      console.error("Failed to load branch map:", err);
      set({ isLoading: false });
    }
  },

  setScrollTo: (id) => set({ scrollToId: id }),

  clear: () => set({ data: null, isLoading: false, scrollToId: null }),
}));
