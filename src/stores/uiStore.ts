import { create } from "zustand";

type AppPhase = "onboarding" | "locked" | "workspace";

interface UiStore {
  appPhase: AppPhase;
  rightPaneCollapsed: boolean;
  branchMapOpen: boolean;
  viewportNarrow: boolean;
  worldPickerOpen: boolean;
  setAppPhase: (p: AppPhase) => void;
  setRightPaneCollapsed: (v: boolean) => void;
  setBranchMapOpen: (v: boolean) => void;
  setViewportNarrow: (v: boolean) => void;
  setWorldPickerOpen: (v: boolean) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  appPhase: "locked",
  rightPaneCollapsed: localStorage.getItem("right_pane_collapsed") === "true",
  branchMapOpen: false,
  viewportNarrow: false,
  worldPickerOpen: false,

  setAppPhase: (p) => set({ appPhase: p }),
  setRightPaneCollapsed: (v) => {
    localStorage.setItem("right_pane_collapsed", String(v));
    set({ rightPaneCollapsed: v });
  },
  setBranchMapOpen: (v) => set({ branchMapOpen: v }),
  setViewportNarrow: (v) => set({ viewportNarrow: v }),
  setWorldPickerOpen: (v) => set({ worldPickerOpen: v }),
}));
