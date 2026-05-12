import { create } from 'zustand';

import {
  deleteSession as ipcDeleteSession,
  enterSession as ipcEnterSession,
  exitSession as ipcExitSession,
  getStoryActiveMode,
  listSessions,
  renameSession as ipcRenameSession,
  setSessionCollapsed as ipcSetSessionCollapsed,
  setStoryActiveMode,
  startConsultingSession,
  startHandoverSession,
} from '@/lib/tauriApi/modes';

import type { ConversationSession, SessionKind, StoryActiveMode } from '@/lib/types';

export type AppMode = 'story' | 'handover' | 'consulting';

/**
 * Doc 23 §Frontend State (`modeStore`).
 *
 * Owns the active mode + the active session being driven. The full
 * `sessions[]` list lives here so the Theater can render banners/partitions
 * by walking it once per render rather than per-bubble.
 *
 * Per Doc 23 §Switcher behaviour:
 *   - Clicking Story tab activates story, exits any active session.
 *   - Clicking Handover/Consulting with no active session of that kind
 *     creates a new session at the current story tail.
 *   - With an active session of the target kind: no-op.
 *
 * Re-entry into an existing session is **not** triggered by the switcher —
 * it goes through Banner Enter (Doc 23 §Banners).
 */
interface ModeState {
  activeMode: AppMode;
  /** Null when activeMode === 'story'. Otherwise the session being driven. */
  activeSessionId: string | null;
  sessions: ConversationSession[];
  /** The story whose mode state this store mirrors. Set by the shell on
   *  story open via `restoreForStory` / `loadSessions`; cleared by `clear()`.
   *  Used internally so transition actions know where to persist. */
  storyId: string | null;

  // Actions
  loadSessions(storyId: string): Promise<void>;
  /** Doc 23 §Re-opening. Read persisted `active_mode` / `active_session_id`
   *  for the story. Silent fallback to story mode when the persisted session
   *  no longer exists (CD-9). Does NOT call `enter_session` — re-entry into
   *  consulting requires the explicit banner click. */
  restoreForStory(storyId: string): Promise<void>;
  startNewSession(storyId: string, kind: SessionKind): Promise<ConversationSession>;
  enterSession(session: ConversationSession): Promise<void>;
  exitSession(): Promise<void>;
  /** Doc 23 §Switcher behaviour: clicking Story tab → activates story,
   *  exits any active session. */
  activateStoryMode(): Promise<void>;
  renameSession(sessionId: string, name: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  setSessionCollapsed(sessionId: string, collapsed: boolean): Promise<void>;

  /** Called by useWorkspaceEvents when `session_state_changed` fires —
   *  refetches the list. */
  refreshFromEvent(storyId: string): Promise<void>;

  /** Story switch / world switch / vault lock. */
  clear(): void;
}

const INITIAL: Pick<ModeState, 'activeMode' | 'activeSessionId' | 'sessions' | 'storyId'> = {
  activeMode: 'story',
  activeSessionId: null,
  sessions: [],
  storyId: null,
};

/** Best-effort persistence — failures log but never throw. Mode UI must
 *  remain responsive even if `story_state` writes fail. */
async function persistActiveMode(
  storyId: string | null,
  mode: AppMode,
  sessionId: string | null,
): Promise<void> {
  if (storyId === null) return;
  try {
    await setStoryActiveMode(storyId, mode, sessionId);
  } catch (e) {
    console.error('set_story_active_mode failed', e);
  }
}

export const useModeStore = create<ModeState>((set, get) => ({
  ...INITIAL,

  async loadSessions(storyId) {
    const sessions = await listSessions(storyId);
    set({ sessions, storyId });
  },

  async restoreForStory(storyId) {
    // Read sessions first so we can validate the persisted active_session_id.
    const sessions = await listSessions(storyId);
    let active: StoryActiveMode;
    try {
      active = await getStoryActiveMode(storyId);
    } catch (e) {
      console.error('get_story_active_mode failed; defaulting to story', e);
      set({ sessions, storyId, activeMode: 'story', activeSessionId: null });
      return;
    }
    const candidateId = active.active_session_id;
    const sessionStillExists = candidateId !== null && sessions.some((s) => s.id === candidateId);
    const mode: AppMode = sessionStillExists ? active.active_mode : 'story';
    const sessionId = sessionStillExists ? candidateId : null;
    set({ sessions, storyId, activeMode: mode, activeSessionId: sessionId });
    // Silent fallback (Doc 23 §Edge Cases): if the persisted session vanished,
    // clear the keys so the next reopen doesn't re-read stale state.
    if (!sessionStillExists && (active.active_mode !== 'story' || candidateId !== null)) {
      await persistActiveMode(storyId, 'story', null);
    }
  },

  async startNewSession(storyId, kind) {
    // Doc 23: clicking the tab while a session of that kind is already
    // active is a no-op (handled at the caller — switcher click). This
    // function unconditionally creates.
    const session =
      kind === 'handover'
        ? await startHandoverSession(storyId)
        : await startConsultingSession(storyId);
    set((s) => ({
      sessions: [...s.sessions, session],
      activeMode: kind,
      activeSessionId: session.id,
      storyId,
    }));
    await persistActiveMode(storyId, kind, session.id);
    return session;
  },

  async enterSession(session) {
    // Phase 4: backend validate-only; Phase 6 will rebuild the consulting
    // cache here.
    await ipcEnterSession(session.id);
    const mode = session.kind as AppMode;
    set({
      activeMode: mode,
      activeSessionId: session.id,
    });
    await persistActiveMode(get().storyId, mode, session.id);
  },

  async exitSession() {
    const activeId = get().activeSessionId;
    if (activeId !== null) {
      try {
        await ipcExitSession(activeId);
      } catch (e) {
        console.error('exit_session failed', e);
      }
    }
    set({ activeMode: 'story', activeSessionId: null });
    await persistActiveMode(get().storyId, 'story', null);
  },

  async activateStoryMode() {
    // Story tab click: exit any active session, then sit in story mode.
    // Persists once via exitSession; if no session was active we still write
    // (idempotent).
    const activeId = get().activeSessionId;
    if (activeId !== null) {
      try {
        await ipcExitSession(activeId);
      } catch (e) {
        console.error('exit_session failed', e);
      }
    }
    set({ activeMode: 'story', activeSessionId: null });
    await persistActiveMode(get().storyId, 'story', null);
  },

  async renameSession(sessionId, name) {
    await ipcRenameSession(sessionId, name);
    set((s) => ({
      sessions: s.sessions.map((row) => (row.id === sessionId ? { ...row, name } : row)),
    }));
  },

  async deleteSession(sessionId) {
    await ipcDeleteSession(sessionId);
    const wasActive = get().activeSessionId === sessionId;
    set((s) => {
      const isActive = s.activeSessionId === sessionId;
      return {
        sessions: s.sessions.filter((row) => row.id !== sessionId),
        activeMode: isActive ? 'story' : s.activeMode,
        activeSessionId: isActive ? null : s.activeSessionId,
      };
    });
    if (wasActive) {
      await persistActiveMode(get().storyId, 'story', null);
    }
  },

  async setSessionCollapsed(sessionId, collapsed) {
    await ipcSetSessionCollapsed(sessionId, collapsed);
    set((s) => ({
      sessions: s.sessions.map((row) =>
        row.id === sessionId ? { ...row, is_collapsed: collapsed } : row,
      ),
    }));
  },

  async refreshFromEvent(storyId) {
    try {
      const sessions = await listSessions(storyId);
      let needsPersist = false;
      set((s) => {
        // If the active session was deleted out from under us, fall back to
        // story (Doc 23 §CD-9: silent fallback when session removed).
        const stillExists =
          s.activeSessionId === null || sessions.some((row) => row.id === s.activeSessionId);
        needsPersist = !stillExists;
        return {
          sessions,
          activeMode: stillExists ? s.activeMode : 'story',
          activeSessionId: stillExists ? s.activeSessionId : null,
        };
      });
      if (needsPersist) {
        await persistActiveMode(get().storyId, 'story', null);
      }
    } catch (e) {
      console.error('refreshFromEvent failed', e);
    }
  },

  clear() {
    set(INITIAL);
  },
}));
