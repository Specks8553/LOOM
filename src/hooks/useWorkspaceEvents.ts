import { listen } from '@tauri-apps/api/event';
import { useEffect } from 'react';

import { useCacheStore } from '@/stores/cacheStore';
import { useModeStore } from '@/stores/modeStore';
import { useVaultStore } from '@/stores/vaultStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { CacheStatus, SessionCacheStatus, SessionDivergence } from '@/lib/types';

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

    // --- Cache (Phase 6) ---
    track<{ story_id: string; status: CacheStatus }>('cache_state_changed', (p) => {
      useCacheStore.getState().handleStoryCacheEvent(p.story_id, p.status);
    });

    track<{ session_id: string; status: SessionCacheStatus }>(
      'session_cache_state_changed',
      (p) => {
        useCacheStore.getState().handleSessionCacheEvent(p.session_id, p.status);
      },
    );

    // --- Accordion (Phase 7) ---
    track<{ story_id: string; segment_id: string | null; checkpoint_id: string | null }>(
      'accordion_state_changed',
      (p) => {
        const ws = useWorkspaceStore.getState();
        if (ws.activeStoryId !== p.story_id) return;
        void ws.loadAccordionState().catch(console.error);
      },
    );

    // --- Marks (Phase 14, Doc 30) ---
    track<{ story_id: string; message_id: string | null }>('marks_changed', (p) => {
      const ws = useWorkspaceStore.getState();
      if (ws.activeStoryId !== p.story_id) return;
      void ws.loadMarks().catch(console.error);
    });

    track<{ story_id: string; reason: string }>('cache_unavailable', (p) => {
      // Imported lazily to avoid a top-level cycle through the toast lib.
      void import('sonner').then(({ toast }) => {
        toast.warning('Cache unavailable; sending inline.', {
          description: `story ${p.story_id.slice(0, 8)}: ${p.reason}`,
        });
      });
    });

    track<{ session_id: string; divergences: SessionDivergence[] }>(
      'session_cache_diverged',
      (p) => {
        if (p.divergences.length === 0) return;
        void import('sonner').then(({ toast }) => {
          toast.warning('Story has changed since this session was created. Context may differ.', {
            description: `${p.divergences.length} divergence${p.divergences.length === 1 ? '' : 's'} detected`,
          });
        });
      },
    );

    return () => {
      cancelled = true;
      for (const u of unlisteners) u();
    };
  }, []);

  // --- Cache lifecycle: load/clear story-cache state on activeStoryId change ---
  useEffect(() => {
    const unsub = useWorkspaceStore.subscribe((s, prev) => {
      if (s.activeStoryId === prev.activeStoryId) return;
      const cache = useCacheStore.getState();
      if (s.activeStoryId === null) {
        // Story closed — keep the alive list but drop the active byStory entry
        // (a future open will re-load via loadStoryCache).
        return;
      }
      void cache.loadStoryCache(s.activeStoryId).catch((e) => console.error('loadStoryCache', e));
    });
    return unsub;
  }, []);

  // --- Cache lifecycle: clear all caches on world switch / lock ---
  useEffect(() => {
    const unsub = useVaultStore.subscribe((s, prev) => {
      if (s.activeWorldId !== prev.activeWorldId) {
        useCacheStore.getState().clearAll();
        if (s.activeWorldId !== null) {
          void useCacheStore
            .getState()
            .refreshAlive()
            .catch((e) => console.error('refreshAlive', e));
        }
      }
    });
    return unsub;
  }, []);
}
