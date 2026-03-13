import { create } from "zustand";

interface AuthStore {
  isUnlocked: boolean;
  isUnlocking: boolean;
  unlockError: string | null;
  setUnlocked: (v: boolean) => void;
  setUnlocking: (v: boolean) => void;
  setUnlockError: (e: string | null) => void;
  reset: () => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  isUnlocked: false,
  isUnlocking: false,
  unlockError: null,

  setUnlocked: (v) => set({ isUnlocked: v }),
  setUnlocking: (v) => set({ isUnlocking: v }),
  setUnlockError: (e) => set({ unlockError: e }),
  reset: () =>
    set({ isUnlocked: false, isUnlocking: false, unlockError: null }),
}));
