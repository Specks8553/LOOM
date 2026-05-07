import { create } from 'zustand';

interface AuthState {
  isLocked: boolean;
  setLocked: (locked: boolean) => void;
}

/** Doc 06 §authStore. Phase 0 stub — locked-state machinery lands in Phase 1.
 * Exists in Phase 0 so the no-cross-store-imports lint rule (SB-2) has a second
 * store to assert against. */
export const useAuthStore = create<AuthState>((set) => ({
  isLocked: true,
  setLocked: (locked) => set({ isLocked: locked }),
}));
