import { useEffect, useState } from 'react';

import { LeftPane } from '@/components/layout/LeftPane';
import { PaneDivider } from '@/components/layout/PaneDivider';
import { RightPane } from '@/components/layout/RightPane';
import { Theater } from '@/components/layout/Theater';
import { Navigator } from '@/components/navigator/Navigator';
import { Settings } from '@/components/settings/Settings';
import { ContextMenuProvider } from '@/components/shared/ContextMenu';
import { SelectionToolbar } from '@/components/shared/SelectionToolbar';
import { CacheSection } from '@/components/theater/CacheSection';
import { ContextDocsSection } from '@/components/theater/ContextDocsSection';
import { DocEditor } from '@/components/theater/DocEditor';
import { StatusSection } from '@/components/theater/StatusSection';
import { TheaterBody } from '@/components/theater/TheaterBody';
import { WorldPickerModal } from '@/components/world-picker/WorldPickerModal';
import { useWorkspaceEvents } from '@/hooks/useWorkspaceEvents';
import { lockVault } from '@/lib/tauriApi/auth';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { useModeStore } from '@/stores/modeStore';
import { useVaultStore } from '@/stores/vaultStore';
import { flushPendingDocSave, flushPendingDraft, useWorkspaceStore } from '@/stores/workspaceStore';

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
 * Three-pane workspace shell (Doc 10). Layout primitives + Navigator host.
 * Theater body and right-pane sections fill in from Phase 3 onwards.
 */
export function WorkspaceShell() {
  const [leftWidth, setLeftWidth] = useState(() =>
    readWidth(LEFT_LS_KEY, LEFT_DEFAULT, LEFT_MIN, LEFT_MAX),
  );
  const [rightWidth, setRightWidth] = useState(() =>
    readWidth(RIGHT_LS_KEY, RIGHT_DEFAULT, RIGHT_MIN, RIGHT_MAX),
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const rightCollapsed = useAppStore((s) => s.rightPaneCollapsed);

  const setAppPhase = useAppStore((s) => s.setAppPhase);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const openSettings = useAppStore((s) => s.openSettings);
  const closeSettings = useAppStore((s) => s.closeSettings);
  const onLock = useAuthStore((s) => s.onLock);
  const activeWorldId = useVaultStore((s) => s.activeWorldId);
  const isGenerating = useWorkspaceStore((s) => s.isGenerating);
  const workspaceClear = useWorkspaceStore((s) => s.clear);
  const activeStoryId = useWorkspaceStore((s) => s.activeStoryId);
  const activeDocId = useWorkspaceStore((s) => s.activeDocId);
  const modeClear = useModeStore((s) => s.clear);
  const restoreForStory = useModeStore((s) => s.restoreForStory);

  // Subscribe to backend events (vault_updated + conversation streaming +
  // session lifecycle).
  useWorkspaceEvents();

  // Reset workspace state on world switch — story messages, drafts, and
  // session lists all live inside the active world's DB and become invalid
  // when it changes. Flush any pending doc save first so the prior world's
  // edits aren't lost (Doc 18 §Save behaviour — world switch).
  useEffect(() => {
    void flushPendingDocSave()
      .catch(() => {
        // best-effort — switch should not be blocked by a save
      })
      .finally(() => {
        workspaceClear();
        modeClear();
        closeSettings();
      });
  }, [activeWorldId, workspaceClear, modeClear, closeSettings]);

  // On story open: load this story's sessions and restore the persisted
  // `active_mode` / `active_session_id` from `story_state` (Doc 23
  // §Re-opening). Silent fallback to story mode happens inside
  // `restoreForStory` when the persisted session no longer exists (CD-9).
  // Note: per Doc 23, restoring `active_mode='consulting'` does NOT
  // auto-re-enter the session — that requires explicit banner Enter so a
  // consulting cache rebuild is gated on intentional user action.
  useEffect(() => {
    if (activeStoryId === null) {
      modeClear();
      return;
    }
    void restoreForStory(activeStoryId).catch((e) => console.error('restoreForStory failed', e));
  }, [activeStoryId, modeClear, restoreForStory]);

  // Auto-open the World Picker when no world is active.
  if (!pickerOpen && activeWorldId === null) {
    // Defer to a microtask to avoid setting state during render.
    queueMicrotask(() => setPickerOpen(true));
  }

  async function handleLock() {
    // Doc 15 §Cancellation Taxonomy: locking mid-stream is gated by a
    // confirmation prompt. On confirm, `lock_vault` cancels the in-flight
    // generation before zeroing keys.
    if (isGenerating && !window.confirm('Generation in progress. Cancel and lock?')) {
      return;
    }
    // Doc 15 §Edge Cases + Doc 18 §Save behaviour: flush any pending
    // debounced draft + doc-save before zeroing keys.
    try {
      await Promise.all([flushPendingDraft(), flushPendingDocSave()]);
    } catch {
      // best-effort
    }
    try {
      await lockVault();
    } finally {
      workspaceClear();
      modeClear();
      closeSettings();
      onLock();
      setAppPhase('locked');
    }
  }

  function handleOpenWorldPicker() {
    // Doc 15: blocking world-switch attempt mid-stream. Phase 3 uses a
    // confirm prompt; visual-design phase will replace with a proper modal.
    if (isGenerating) {
      if (!window.confirm('Generation in progress. Cancel and switch worlds?')) return;
      // Fire-and-forget cancel; the user can re-open the picker afterwards.
      void useWorkspaceStore.getState().cancel();
      return;
    }
    setPickerOpen(true);
  }

  return (
    <ContextMenuProvider>
      <main className="flex h-full w-full overflow-hidden bg-[var(--color-bg-base)]">
        <LeftPane width={leftWidth}>
          <Navigator
            onLock={() => void handleLock()}
            onOpenWorldPicker={handleOpenWorldPicker}
            onOpenSettings={openSettings}
          />
        </LeftPane>
        <PaneDivider
          side="left"
          width={leftWidth}
          min={LEFT_MIN}
          max={LEFT_MAX}
          onResize={setLeftWidth}
          onResizeEnd={(w) => writeWidth(LEFT_LS_KEY, w)}
        />
        {settingsOpen ? (
          // Doc 10 §Theater Content Switching priority (CD-5):
          // Settings > activeDocId > activeStoryId. Settings is a full-surface
          // view — ModeSwitcher and right pane hidden, Navigator stays visible.
          <Theater>
            <Settings />
          </Theater>
        ) : activeDocId !== null ? (
          // Doc 18 §Mode-Switcher Interplay: DocEditor takes the main + right
          // region. ModeSwitcher and right pane are hidden; Navigator stays
          // visible.
          <Theater>
            <DocEditor docId={activeDocId} />
          </Theater>
        ) : (
          <>
            <Theater>
              <TheaterBody />
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
              <div className="flex h-full flex-col">
                <div className="flex-1" />
                <ContextDocsSection />
                <CacheSection />
                <StatusSection />
              </div>
            </RightPane>
          </>
        )}

        <WorldPickerModal open={pickerOpen} onOpenChange={setPickerOpen} />
        <SelectionToolbar />
      </main>
    </ContextMenuProvider>
  );
}
