import { useAppStore } from '@/stores/appStore';
import { devSetAppPhase } from '@/lib/tauriApi/appPhase';

/** Phase 0 placeholder. The real onboarding flow lands in Phase 1 (Doc 13). */
export function OnboardingShell() {
  const setAppPhase = useAppStore((s) => s.setAppPhase);
  return (
    <main className="grid h-full place-items-center text-[--color-text-muted]">
      <div className="flex flex-col items-center gap-4">
        <h1 className="text-2xl text-[--color-text-primary]">LOOM 2.0</h1>
        <p>Onboarding shell — Phase 0 substrate</p>
        <button
          type="button"
          className="border border-[--color-border] px-3 py-1 text-sm hover:bg-[--color-bg-soft]"
          onClick={() => {
            void devSetAppPhase('locked').catch(() => {
              setAppPhase('locked');
            });
          }}
        >
          Continue → locked
        </button>
      </div>
    </main>
  );
}
