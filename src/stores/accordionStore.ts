import { create } from "zustand";
import type { AccordionSegment } from "../lib/types";
import { getAccordionSegments, summariseSegmentCmd, setSegmentCollapsed } from "../lib/tauriApi";
import { toast } from "sonner";

interface AccordionStore {
  segments: AccordionSegment[];
  isLoading: boolean;

  /** Load all segments for a story. */
  load: (storyId: string) => Promise<void>;

  /** Clear segments (on story switch / lock). */
  clear: () => void;

  /** Summarise a segment via Gemini. */
  summarise: (segmentId: string, storyId: string, leafId: string) => Promise<void>;

  /** Collapse a segment (must have summary). */
  collapse: (segmentId: string, storyId: string) => Promise<void>;

  /** Expand a collapsed segment. */
  expand: (segmentId: string, storyId: string) => Promise<void>;

  /** Refresh segments after external change. */
  refresh: (storyId: string) => Promise<void>;
}

export const useAccordionStore = create<AccordionStore>((set, get) => ({
  segments: [],
  isLoading: false,

  load: async (storyId) => {
    set({ isLoading: true });
    try {
      const segments = await getAccordionSegments(storyId);
      set({ segments, isLoading: false });
    } catch (e) {
      console.error("Failed to load accordion segments:", e);
      set({ isLoading: false });
    }
  },

  clear: () => set({ segments: [] }),

  summarise: async (segmentId, storyId, leafId) => {
    try {
      const summary = await summariseSegmentCmd(segmentId, storyId, leafId);
      // Update local state
      set({
        segments: get().segments.map((s) =>
          s.id === segmentId
            ? { ...s, summary, is_stale: false, summarised_at: new Date().toISOString() }
            : s,
        ),
      });
      toast("Summary generated. Collapse the chapter to use it in context.", {
        action: {
          label: "Collapse Now",
          onClick: () => get().collapse(segmentId, storyId),
        },
      });
    } catch (e) {
      console.error("Summarisation failed:", e);
      toast.error(`Summarisation failed: ${e}`);
    }
  },

  collapse: async (segmentId, storyId) => {
    try {
      await setSegmentCollapsed(segmentId, storyId, true);
      set({
        segments: get().segments.map((s) =>
          s.id === segmentId ? { ...s, is_collapsed: true } : s,
        ),
      });
    } catch (e) {
      toast.error(`Failed to collapse: ${e}`);
    }
  },

  expand: async (segmentId, storyId) => {
    try {
      await setSegmentCollapsed(segmentId, storyId, false);
      set({
        segments: get().segments.map((s) =>
          s.id === segmentId ? { ...s, is_collapsed: false } : s,
        ),
      });
    } catch (e) {
      toast.error(`Failed to expand: ${e}`);
    }
  },

  refresh: async (storyId) => {
    try {
      const segments = await getAccordionSegments(storyId);
      set({ segments });
    } catch (e) {
      console.error("Failed to refresh accordion segments:", e);
    }
  },
}));
