import { create } from 'zustand';

import { getCacheState, getSessionCacheState, listAliveCaches } from '@/lib/tauriApi/cache';

import type { AliveCacheRow, CacheStatus, SessionCacheStatus } from '@/lib/types';

/**
 * Doc 22 §Frontend State + §Cache Status UI.
 *
 * Holds the per-story and per-session cache snapshots, the list of alive
 * caches for the right pane, and a single shared 1 Hz ticker that drives
 * TTL countdowns. The ticker auto-starts when any subscriber is mounted
 * (`subscribeTicker`) and auto-stops when the last subscriber unmounts —
 * one global interval rather than one per row.
 *
 * Backend events drive every mutation. Components never call into Tauri
 * directly except via `loadStoryCache` / `loadSessionCache` / `refreshAlive`
 * (which delegate to the typed wrappers in `tauriApi/cache.ts`).
 */

const empty: CacheStatus = {
  cache_name: null,
  expiry_at: null,
  is_stale: false,
  last_cached_message_id: null,
  total_token_count: null,
  doc_snapshots: {},
};

interface CacheState {
  byStory: Record<string, CacheStatus>;
  bySession: Record<string, SessionCacheStatus>;
  alive: AliveCacheRow[];
  /** Increments on each tick — components reading TTL countdowns subscribe
   *  to this to re-render once per second without re-pulling state. */
  tick: number;

  // --- Selectors (called from components) ---
  getStory: (storyId: string) => CacheStatus;
  getSession: (sessionId: string) => SessionCacheStatus;

  // --- Loading from backend ---
  loadStoryCache: (storyId: string) => Promise<void>;
  loadSessionCache: (sessionId: string) => Promise<void>;
  refreshAlive: () => Promise<void>;

  // --- Event reducers ---
  handleStoryCacheEvent: (storyId: string, status: CacheStatus) => void;
  handleSessionCacheEvent: (sessionId: string, status: SessionCacheStatus) => void;

  // --- World-switch / lock cleanup ---
  clearAll: () => void;
  clearStory: (storyId: string) => void;
  clearSession: (sessionId: string) => void;

  // --- Ticker subscription (single shared interval) ---
  subscribeTicker: () => () => void;
}

let _tickerHandle: ReturnType<typeof setInterval> | null = null;
let _subscriberCount = 0;

export const useCacheStore = create<CacheState>((set, get) => ({
  byStory: {},
  bySession: {},
  alive: [],
  tick: 0,

  getStory: (storyId) => get().byStory[storyId] ?? empty,
  getSession: (sessionId) =>
    get().bySession[sessionId] ?? {
      cache_name: null,
      expiry_at: null,
      is_stale: false,
    },

  loadStoryCache: async (storyId) => {
    const status = await getCacheState(storyId);
    set((s) => ({ byStory: { ...s.byStory, [storyId]: status } }));
  },

  loadSessionCache: async (sessionId) => {
    const status = await getSessionCacheState(sessionId);
    set((s) => ({ bySession: { ...s.bySession, [sessionId]: status } }));
  },

  refreshAlive: async () => {
    const alive = await listAliveCaches();
    set({ alive });
  },

  handleStoryCacheEvent: (storyId, status) => {
    set((s) => {
      const byStory = { ...s.byStory, [storyId]: status };
      // Mirror into `alive` so the right-pane row stays consistent without
      // a round-trip. `refreshAlive` is still authoritative on creates.
      const alive = s.alive.map((r) =>
        r.story_id === storyId && r.session_id === null
          ? {
              ...r,
              expiry_at: status.expiry_at ?? r.expiry_at,
              is_stale: status.is_stale,
              total_tokens: status.total_token_count ?? r.total_tokens,
            }
          : r,
      );
      return { byStory, alive };
    });
    // Cache create / delete change which rows are alive — re-pull. Safe
    // even when nothing changed; the call is local-DB-only.
    void get().refreshAlive();
  },

  handleSessionCacheEvent: (sessionId, status) => {
    set((s) => {
      const bySession = { ...s.bySession, [sessionId]: status };
      const alive = s.alive.map((r) =>
        r.session_id === sessionId
          ? {
              ...r,
              expiry_at: status.expiry_at ?? r.expiry_at,
              is_stale: status.is_stale,
            }
          : r,
      );
      return { bySession, alive };
    });
    void get().refreshAlive();
  },

  clearAll: () => set({ byStory: {}, bySession: {}, alive: [] }),
  clearStory: (storyId) =>
    set((s) => {
      const next = { ...s.byStory };
      delete next[storyId];
      return { byStory: next };
    }),
  clearSession: (sessionId) =>
    set((s) => {
      const next = { ...s.bySession };
      delete next[sessionId];
      return { bySession: next };
    }),

  subscribeTicker: () => {
    _subscriberCount += 1;
    if (_subscriberCount === 1 && _tickerHandle === null) {
      _tickerHandle = setInterval(() => {
        set((s) => ({ tick: s.tick + 1 }));
      }, 1000);
    }
    return () => {
      _subscriberCount -= 1;
      if (_subscriberCount <= 0) {
        _subscriberCount = 0;
        if (_tickerHandle !== null) {
          clearInterval(_tickerHandle);
          _tickerHandle = null;
        }
      }
    };
  },
}));

/**
 * Predicate matching `cache_service::is_cached_story_message`. True when the
 * message is at-or-before the active story cache's high-water mark — i.e.
 * editing or deleting it would invalidate the cache and the user should be
 * prompted via the cached-message confirmation modal (Doc 22).
 *
 * Returns `false` when no cache is active. Callers that need the
 * "before-or-equal" check across messages must pass the message's
 * `created_at` and the high-water message's `created_at`; this helper takes
 * just the ids and uses `last_cached_message_id` strict equality + caller
 * lookup. To keep this predicate pure, the caller resolves "is this msg's
 * created_at <= high-water's created_at" itself using the messages array it
 * already has in scope.
 */
export function isStoryCacheActive(status: CacheStatus): boolean {
  if (status.cache_name === null) return false;
  if (status.is_stale) return false;
  if (status.expiry_at === null) return false;
  return status.expiry_at > new Date().toISOString();
}

/** Format an ISO 8601 expiry as `MM:SS` countdown vs. now. Returns `--:--`
 *  when expired or no expiry. */
export function formatTtl(expiryAt: string | null): string {
  if (expiryAt === null) return '--:--';
  const remainingMs = new Date(expiryAt).getTime() - Date.now();
  if (remainingMs <= 0) return '00:00';
  const totalSec = Math.floor(remainingMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Token thresholds for the TTL countdown color (Doc 22 §TTL Countdown).
 *  Tokens-only — exact hex deferred to Phase 12 visual pass per NB-1. */
export function ttlColorToken(expiryAt: string | null): string {
  if (expiryAt === null) return 'var(--color-text-muted)';
  const remainingMs = new Date(expiryAt).getTime() - Date.now();
  if (remainingMs > 5 * 60 * 1000) return 'var(--color-text-muted)';
  if (remainingMs > 60 * 1000) return 'var(--color-warning, var(--color-accent))';
  return 'var(--color-error, var(--color-accent))';
}
