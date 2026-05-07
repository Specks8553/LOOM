import { create } from 'zustand';

import { lockVault } from '@/lib/tauriApi/auth';

interface AuthState {
  isLocked: boolean;
  hasApiKey: boolean;
  autoLockSecs: number;
  autoLockTimerHandle: ReturnType<typeof setTimeout> | null;

  // Called on successful unlock with values from UnlockResult.
  onUnlock: (hasApiKey: boolean, autoLockSecs: number) => void;
  // Called on lock (manual or auto). Sets isLocked so App.tsx can react.
  onLock: () => void;
  setHasApiKey: (val: boolean) => void;
  startAutoLockTimer: () => void;
  resetAutoLockTimer: () => void;
  clearAutoLockTimer: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isLocked: true,
  hasApiKey: false,
  autoLockSecs: 900,
  autoLockTimerHandle: null,

  onUnlock(hasApiKey, autoLockSecs) {
    set({ isLocked: false, hasApiKey, autoLockSecs });
    get().startAutoLockTimer();
  },

  onLock() {
    get().clearAutoLockTimer();
    set({ isLocked: true, hasApiKey: false });
  },

  setHasApiKey(val) {
    set({ hasApiKey: val });
  },

  startAutoLockTimer() {
    get().clearAutoLockTimer();
    const { autoLockSecs } = get();
    if (autoLockSecs <= 0) return;

    const handle = setTimeout(() => {
      // Lock the backend; then set isLocked so App.tsx transitions phase.
      void lockVault()
        .then(() => get().onLock())
        .catch(console.error);
    }, autoLockSecs * 1000);

    set({ autoLockTimerHandle: handle });
  },

  resetAutoLockTimer() {
    if (get().isLocked) return;
    get().startAutoLockTimer();
  },

  clearAutoLockTimer() {
    const { autoLockTimerHandle } = get();
    if (autoLockTimerHandle !== null) {
      clearTimeout(autoLockTimerHandle);
      set({ autoLockTimerHandle: null });
    }
  },
}));
