import { useEffect, useRef } from 'react';
import { Toaster } from 'sonner';

import { LockedShell } from '@/components/shell/LockedShell';
import { OnboardingShell } from '@/components/shell/OnboardingShell';
import { WorkspaceShell } from '@/components/shell/WorkspaceShell';
import { checkOnboarding } from '@/lib/tauriApi/auth';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { useVaultStore } from '@/stores/vaultStore';

export function App() {
  const phase = useAppStore((s) => s.appPhase);
  const setAppPhase = useAppStore((s) => s.setAppPhase);
  const isLocked = useAuthStore((s) => s.isLocked);
  const resetAutoLockTimer = useAuthStore((s) => s.resetAutoLockTimer);

  // On mount: ask the backend whether onboarding is complete.
  useEffect(() => {
    void checkOnboarding()
      .then((complete) => {
        if (complete) setAppPhase('locked');
      })
      .catch(console.error);
  }, [setAppPhase]);

  // React to auto-lock: when isLocked flips true while in workspace, go to locked phase.
  useEffect(() => {
    if (isLocked && phase === 'workspace') {
      setAppPhase('locked');
    }
  }, [isLocked, phase, setAppPhase]);

  // On entering workspace: load the world list. On leaving (lock): clear vault state.
  const refreshWorlds = useVaultStore((s) => s.refreshWorlds);
  const clearVault = useVaultStore((s) => s.clear);
  useEffect(() => {
    if (phase === 'workspace') {
      void refreshWorlds().catch(console.error);
    } else {
      clearVault();
    }
  }, [phase, refreshWorlds, clearVault]);

  // Activity listener for auto-lock reset (Doc 13 §Auto-Lock).
  const scrollThrottle = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onActivity() {
      resetAutoLockTimer();
    }

    function onScroll() {
      if (scrollThrottle.current) return;
      scrollThrottle.current = setTimeout(() => {
        scrollThrottle.current = null;
        resetAutoLockTimer();
      }, 250);
    }

    document.addEventListener('keydown', onActivity);
    document.addEventListener('click', onActivity);
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });

    return () => {
      document.removeEventListener('keydown', onActivity);
      document.removeEventListener('click', onActivity);
      document.removeEventListener('scroll', onScroll, { capture: true });
      if (scrollThrottle.current) clearTimeout(scrollThrottle.current);
    };
  }, [resetAutoLockTimer]);

  return (
    <>
      {phase === 'onboarding' && <OnboardingShell />}
      {phase === 'locked' && <LockedShell />}
      {phase === 'workspace' && <WorkspaceShell />}
      <Toaster position="bottom-right" theme="dark" />
    </>
  );
}
