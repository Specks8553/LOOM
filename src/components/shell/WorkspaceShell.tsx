import { useState } from 'react';

import { LeftPane } from '@/components/layout/LeftPane';
import { PaneDivider } from '@/components/layout/PaneDivider';
import { RightPane } from '@/components/layout/RightPane';
import { Theater } from '@/components/layout/Theater';
import { lockVault } from '@/lib/tauriApi/auth';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { useVaultStore } from '@/stores/vaultStore';

// Doc 10 §Pane Sizing Rules.
const LEFT_DEFAULT = 260;
const LEFT_MIN = 200;
const LEFT_MAX = 360;
const RIGHT_DEFAULT = 280;
const RIGHT_MIN = 240;
const RIGHT_MAX = 400;

const LEFT_LS_KEY = 'left_pane_width';
const RIGHT_LS_KEY = 'right_pane_width';

function readWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return fallback;
    const n = Number.parseInt(stored, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  } catch {
    return fallback;
  }
}

function writeWidth(key: string, width: number): void {
  try {
    localStorage.setItem(key, String(width));
  } catch {
    // ignore — localStorage may be unavailable in non-app contexts (tests)
  }
}

/**
 * Three-pane workspace shell (Doc 10). Phase 2B lands the layout primitives;
 * pane content (Navigator, Theater body, right-pane sections) is filled in
 * by 2C and downstream phases.
 */
export function WorkspaceShell() {
  const [leftWidth, setLeftWidth] = useState(() =>
    readWidth(LEFT_LS_KEY, LEFT_DEFAULT, LEFT_MIN, LEFT_MAX),
  );
  const [rightWidth, setRightWidth] = useState(() =>
    readWidth(RIGHT_LS_KEY, RIGHT_DEFAULT, RIGHT_MIN, RIGHT_MAX),
  );
  const rightCollapsed = useAppStore((s) => s.rightPaneCollapsed);

  const setAppPhase = useAppStore((s) => s.setAppPhase);
  const onLock = useAuthStore((s) => s.onLock);
  const worlds = useVaultStore((s) => s.worlds);

  async function handleLock() {
    try {
      await lockVault();
    } finally {
      onLock();
      setAppPhase('locked');
    }
  }

  return (
    <main className="flex h-full w-full overflow-hidden bg-[--color-bg-base]">
      <LeftPane width={leftWidth}>
        <NavigatorPlaceholder worldCount={worlds.length} onLock={() => void handleLock()} />
      </LeftPane>
      <PaneDivider
        side="left"
        width={leftWidth}
        min={LEFT_MIN}
        max={LEFT_MAX}
        onResize={setLeftWidth}
        onResizeEnd={(w) => writeWidth(LEFT_LS_KEY, w)}
      />
      <Theater>
        <TheaterPlaceholder />
      </Theater>
      {!rightCollapsed && (
        <PaneDivider
          side="right"
          width={rightWidth}
          min={RIGHT_MIN}
          max={RIGHT_MAX}
          onResize={setRightWidth}
          onResizeEnd={(w) => writeWidth(RIGHT_LS_KEY, w)}
        />
      )}
      <RightPane width={rightWidth}>
        <RightPanePlaceholder />
      </RightPane>
    </main>
  );
}

// --- Placeholder pane bodies (filled in by Phase 2C / 3+) ---

function NavigatorPlaceholder({ worldCount, onLock }: { worldCount: number; onLock: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-9 shrink-0 items-center justify-between border-b border-[--color-border] px-3 text-[11px] uppercase tracking-wider text-[--color-text-muted]">
        <span>Navigator</span>
        <button
          type="button"
          onClick={onLock}
          className="text-[--color-text-muted] hover:text-[--color-text-primary]"
        >
          Lock
        </button>
      </header>
      <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-[--color-text-muted]">
        {worldCount === 0
          ? 'No worlds yet.'
          : `${worldCount} world${worldCount === 1 ? '' : 's'} loaded.`}
      </div>
    </div>
  );
}

function TheaterPlaceholder() {
  return (
    <div className="grid h-full place-items-center text-center text-sm text-[--color-text-muted]">
      <p>Select a story from the Navigator, or create one to begin.</p>
    </div>
  );
}

function RightPanePlaceholder() {
  return (
    <div className="px-3 pb-3 text-[11px] uppercase tracking-wider text-[--color-text-muted]">
      Control
    </div>
  );
}
