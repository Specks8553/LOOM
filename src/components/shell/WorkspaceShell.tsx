import { devSetAppPhase } from '@/lib/tauriApi/appPhase';
import { useAppStore } from '@/stores/appStore';

/** Phase 0 placeholder. Real layout (Doc 10) lands in subsequent phases. */
export function WorkspaceShell() {
  const setAppPhase = useAppStore((s) => s.setAppPhase);
  return (
    <main className="grid h-full place-items-center text-[--color-text-muted]">
      <div className="flex flex-col items-center gap-4">
        <h1 className="text-2xl text-[--color-text-primary]">Workspace</h1>
        <p>Phase 0 substrate — features land in Phases 1+</p>
        <button
          type="button"
          className="border border-[--color-border] px-3 py-1 text-sm hover:bg-[--color-bg-soft]"
          onClick={() => {
            void devSetAppPhase('locked').catch(() => {
              setAppPhase('locked');
            });
          }}
        >
          Lock
        </button>
      </div>
    </main>
  );
}
