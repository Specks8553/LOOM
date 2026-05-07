import { devSetAppPhase } from '@/lib/tauriApi/appPhase';
import { useAppStore } from '@/stores/appStore';

/** Phase 0 placeholder. The real lock screen lands in Phase 1 (Doc 13). */
export function LockedShell() {
  const setAppPhase = useAppStore((s) => s.setAppPhase);
  return (
    <main className="grid h-full place-items-center text-[--color-text-muted]">
      <div className="flex flex-col items-center gap-4">
        <h1 className="text-2xl text-[--color-text-primary]">Locked</h1>
        <p>Lock screen — Phase 0 substrate</p>
        <button
          type="button"
          className="border border-[--color-border] px-3 py-1 text-sm hover:bg-[--color-bg-soft]"
          onClick={() => {
            void devSetAppPhase('workspace').catch(() => {
              setAppPhase('workspace');
            });
          }}
        >
          Unlock → workspace
        </button>
      </div>
    </main>
  );
}
