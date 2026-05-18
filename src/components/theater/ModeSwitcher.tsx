import { useModeStore, type AppMode } from '@/stores/modeStore';

/**
 * Doc 23 §Switcher UI + Doc 10 §Mode Layout Variations + Doc 27 §Mode switcher.
 *
 * Segmented pill row at the *bottom* of the Theater, directly above the input
 * area (the switcher + input form the bottom input region). Three segments:
 * `Story · Handover · Consulting`. The active segment is filled; when a
 * session is being driven, its name is appended (`Consulting · Consulting 2`).
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
      className="flex shrink-0 gap-1 border-t border-[--color-border] bg-[--color-bg-elevated] px-3 pt-2.5 pb-0.5"
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
  const text = sublabel !== undefined && sublabel.length > 0 ? `${label} · ${sublabel}` : label;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={onClick}
      className={[
        'max-w-[200px] truncate rounded-sm px-3 py-1 text-[11px] outline-none transition-colors',
        isActive
          ? 'bg-[--color-bg-active] font-medium text-[--color-text-primary]'
          : 'text-[--color-text-muted] hover:bg-[--color-bg-hover] hover:text-[--color-text-primary]',
      ].join(' ')}
    >
      {text}
    </button>
  );
}

// Re-export to avoid an unused-import error.
export type { AppMode };
