import { create } from 'zustand';
import type { AppPhase } from '@/lib/types';

interface AppState {
  appPhase: AppPhase;
  setAppPhase: (phase: AppPhase) => void;
}

/** Doc 06 §appStore. Owns the phase machine: onboarding → locked → workspace.
 * No router lib (D-05) — App.tsx renders the matching shell by phase. */
export const useAppStore = create<AppState>((set) => ({
  appPhase: 'onboarding',
  setAppPhase: (phase) => set({ appPhase: phase }),
}));
