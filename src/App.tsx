import { Toaster } from 'sonner';
import { useAppStore } from '@/stores/appStore';
import { OnboardingShell } from '@/components/shell/OnboardingShell';
import { LockedShell } from '@/components/shell/LockedShell';
import { WorkspaceShell } from '@/components/shell/WorkspaceShell';

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
