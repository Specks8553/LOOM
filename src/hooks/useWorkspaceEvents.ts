import { listen } from '@tauri-apps/api/event';
import { useEffect } from 'react';

import { useModeStore } from '@/stores/modeStore';
import { useVaultStore } from '@/stores/vaultStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

/**
 * Doc 07 §Events. Global subscription for backend-emitted events.
 *
 * Phase 2C wired `vault_updated`. Phase 3 adds the four conversation events:
 *   - `message_chunk`        — per Gemini SSE chunk
 *   - `message_complete`     — generation finished cleanly
 *   - `generation_cancelled` — user-stop or lock-fired
 *   - `generation_failed`    — HTTP error / backend panic / pre-flight fail
 *
 * Mount once at the workspace shell level (not in every component).
 */
export function useWorkspaceEvents(): void {
  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    const track = <T>(name: string, handler: (payload: T) => void): void => {
      void listen<T>(name, (e) => {
        if (cancelled) return;
        handler(e.payload);
      }).then((u) => {
        if (cancelled) {
          u();
        } else {
          unlisteners.push(u);
        }
      });
    };

    // --- Vault (Phase 2C; Phase 5 adds attached-docs reload) ---
    track<{ world_id: string }>('vault_updated', () => {
      const store = useVaultStore.getState();
      if (store.isTrashView) {
        void store.loadTrash().catch(console.error);
      } else {
        void store.loadVault().catch(console.error);
      }
      // Doc 18 §Cascade Rules: a vault mutation may have detached attached
      // docs (soft-delete cascade) — refresh the workspace's attached-doc
      // list so the right pane and Navigator paperclip state stay in sync.
      const ws = useWorkspaceStore.getState();
      if (ws.activeStoryId !== null) {
        void ws.loadAttachedDocs().catch(console.error);
      }
    });

    // --- Conversation (Phase 3) ---
    track<{ story_id: string; chunk: string }>('message_chunk', (p) => {
      useWorkspaceStore.getState().onMessageChunk(p.story_id, p.chunk);
    });

    track<{
      story_id: string;
      message_id: string;
      finish_reason: string | null;
      token_count: number | null;
    }>('message_complete', (p) => {
      void useWorkspaceStore
        .getState()
        .onMessageComplete(p.story_id, p.message_id, p.finish_reason, p.token_count)
        .catch(console.error);
    });

    track<{ story_id: string; user_message_id: string; model_message_id: string }>(
      'generation_cancelled',
      (p) => {
        void useWorkspaceStore
          .getState()
          .onGenerationCancelled(p.story_id, p.user_message_id, p.model_message_id)
          .catch(console.error);
      },
    );

    track<{ story_id: string; error_kind: string; error_detail: string }>(
      'generation_failed',
      (p) => {
        void useWorkspaceStore
          .getState()
          .onGenerationFailed(p.story_id, p.error_kind, p.error_detail)
          .catch(console.error);
      },
    );

    // --- Modes (Phase 4) ---

    const refreshSessions = () => {
      const storyId = useWorkspaceStore.getState().activeStoryId;
      if (storyId === null) return;
      void useModeStore.getState().refreshFromEvent(storyId);
    };

    track<{ session_id: string; story_id: string; kind: string }>('session_created', () =>
      refreshSessions(),
    );

    track<{ session_id: string; chunk: string }>('session_message_chunk', (p) => {
      useWorkspaceStore.getState().onSessionMessageChunk(p.session_id, p.chunk);
    });

    track<{
      session_id: string;
      message_id: string;
      finish_reason: string | null;
      token_count: number | null;
    }>('session_message_complete', (p) => {
      void useWorkspaceStore
        .getState()
        .onSessionMessageComplete(p.session_id, p.message_id, p.finish_reason, p.token_count)
        .catch(console.error);
    });

    track<{ session_id: string; user_message_id: string; model_message_id: string }>(
      'session_generation_cancelled',
      (p) => {
        void useWorkspaceStore
          .getState()
          .onSessionGenerationCancelled(p.session_id, p.user_message_id, p.model_message_id)
          .catch(console.error);
      },
    );

    track<{ session_id: string; error_kind: string; error_detail: string }>(
      'session_generation_failed',
      (p) => {
        void useWorkspaceStore
          .getState()
          .onSessionGenerationFailed(p.session_id, p.error_kind, p.error_detail)
          .catch(console.error);
      },
    );

    track<{ session_id: string; status: string }>('session_state_changed', () => {
      refreshSessions();
    });

    return () => {
      cancelled = true;
      for (const u of unlisteners) u();
    };
  }, []);
}
