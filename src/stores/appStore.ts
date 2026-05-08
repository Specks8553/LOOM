import { create } from 'zustand';

import type { AppPhase } from '@/lib/types';

interface AppState {
  appPhase: AppPhase;
  setAppPhase: (phase: AppPhase) => void;
  /** Doc 10 §Right Pane Collapse. In-memory only — restart persistence is a
   * future refinement. */
  rightPaneCollapsed: boolean;
  setRightPaneCollapsed: (collapsed: boolean) => void;
  toggleRightPane: () => void;
}

/** Doc 06 §appStore. Owns the phase machine: onboarding → locked → workspace.
 * No router lib (D-05) — App.tsx renders the matching shell by phase. */
export const useAppStore = create<AppState>((set) => ({
  appPhase: 'onboarding',
  setAppPhase: (phase) => set({ appPhase: phase }),
  rightPaneCollapsed: false,
  setRightPaneCollapsed: (collapsed) => set({ rightPaneCollapsed: collapsed }),
  toggleRightPane: () => set((s) => ({ rightPaneCollapsed: !s.rightPaneCollapsed })),
}));
