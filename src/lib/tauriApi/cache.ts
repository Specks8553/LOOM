import { invoke } from '@tauri-apps/api/core';

import type { AliveCacheRow, CacheStatus, SessionCacheStatus } from '@/lib/types';

// --- Doc 22 §Backend API. Typed wrappers for `commands/cache.rs`. ---

/** Read the current story-cache state. Returns an empty status when no row
 *  exists (the frontend renders a placeholder, not an error). */
export async function getCacheState(storyId: string): Promise<CacheStatus> {
  return invoke<CacheStatus>('get_cache_state', { storyId });
}

/** Manual cache create / recreate. Best-effort delete of any existing cache
 *  first, then POST cachedContents. Emits `cache_state_changed` on success. */
export async function createStoryCache(storyId: string): Promise<CacheStatus> {
  return invoke<CacheStatus>('create_story_cache', { storyId });
}

/** Best-effort delete to Gemini, then NULL the local row's cache fields.
 *  Always succeeds locally even if the remote call errors. Emits
 *  `cache_state_changed`. */
export async function deleteStoryCache(storyId: string): Promise<CacheStatus> {
  return invoke<CacheStatus>('delete_story_cache', { storyId });
}

/** Right-pane Cache section list. Returns story rows + active
 *  consulting-session rows. */
export async function listAliveCaches(): Promise<AliveCacheRow[]> {
  return invoke<AliveCacheRow[]>('list_alive_caches');
}

/** Read the current session cache state. NotFound when the session id
 *  doesn't resolve. */
export async function getSessionCacheState(sessionId: string): Promise<SessionCacheStatus> {
  return invoke<SessionCacheStatus>('get_session_cache_state', { sessionId });
}
