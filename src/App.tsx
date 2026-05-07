import { Toaster } from 'sonner';

import { LockedShell } from '@/components/shell/LockedShell';
import { OnboardingShell } from '@/components/shell/OnboardingShell';
import { WorkspaceShell } from '@/components/shell/WorkspaceShell';
import { useAppStore } from '@/stores/appStore';

export function App() {
  const phase = useAppStore((s) => s.appPhase);

  return (
    <>
      {phase === 'onboarding' && <OnboardingShell />}
      {phase === 'locked' && <LockedShell />}
      {phase === 'workspace' && <WorkspaceShell />}
      <Toaster position="bottom-right" theme="dark" />
    </>
  );
}
