import { useModeStore, type AppMode } from '@/stores/modeStore';

/**
 * Doc 23 §Switcher UI + Doc 10 §Mode Layout Variations.
 *
 * Horizontal tab strip at the top of the Theater. Three tabs:
 * `Story · Handover · Consulting`. The active tab is highlighted; when a
 * session is being driven, its name appears as a sub-label on the active tab.
 *
 * Click behaviour (Doc 23 §Switcher behaviour):
 *   - Story tab: activates story, exits any active session.
 *   - Handover tab w/ no handover session active: starts a new handover.
 *   - Consulting tab w/ no consulting session active: starts a new consulting.
 *   - Same-kind active: no-op.
 *
 * Mode switching is allowed mid-stream (Doc 23 §Switching during generation /
 * streaming) — Send is gated by `isGenerating`, the switcher itself is not.
 */
interface Props {
  storyId: string;
}

export function ModeSwitcher({ storyId }: Props) {
  const activeMode = useModeStore((s) => s.activeMode);
  const activeSessionId = useModeStore((s) => s.activeSessionId);
  const sessions = useModeStore((s) => s.sessions);
  const activateStoryMode = useModeStore((s) => s.activateStoryMode);
  const startNewSession = useModeStore((s) => s.startNewSession);

  const activeSession =
    activeSessionId === null ? null : (sessions.find((row) => row.id === activeSessionId) ?? null);

  async function handleStoryClick() {
    if (activeMode === 'story') return;
    await activateStoryMode();
  }

  async function handleSessionClick(kind: 'handover' | 'consulting') {
    if (activeMode === kind) return;
    await startNewSession(storyId, kind);
  }

  return (
    <div
      role="tablist"
      aria-label="Mode switcher"
      className="flex items-stretch gap-0 border-b border-[--color-border] bg-[--color-bg-soft] px-3 py-1.5 text-[12px]"
    >
      <Tab
        label="Story"
        isActive={activeMode === 'story'}
        onClick={() => void handleStoryClick()}
      />
      <Tab
        label="Handover"
        sublabel={activeMode === 'handover' ? activeSession?.name : undefined}
        isActive={activeMode === 'handover'}
        onClick={() => void handleSessionClick('handover')}
      />
      <Tab
        label="Consulting"
        sublabel={activeMode === 'consulting' ? activeSession?.name : undefined}
        isActive={activeMode === 'consulting'}
        onClick={() => void handleSessionClick('consulting')}
      />
    </div>
  );
}

interface TabProps {
  label: string;
  sublabel?: string;
  isActive: boolean;
  onClick: () => void;
}

function Tab({ label, sublabel, isActive, onClick }: TabProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={onClick}
      className={[
        'flex flex-col items-center justify-center rounded-sm px-3 py-1 text-[12px] outline-none transition-colors',
        isActive
          ? 'bg-[--color-bg] font-medium text-[--color-text-primary] shadow-[inset_0_-2px_0_var(--color-accent)]'
          : 'text-[--color-text-muted] hover:bg-[--color-bg] hover:text-[--color-text-primary]',
      ].join(' ')}
    >
      <span>{label}</span>
      {sublabel !== undefined && sublabel.length > 0 && (
        <span className="mt-0.5 text-[10px] text-[--color-text-muted]">{sublabel}</span>
      )}
    </button>
  );
}

// Re-export to avoid an unused-import error.
export type { AppMode };
