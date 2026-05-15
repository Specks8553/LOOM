// cacheStore unit tests (Doc 25 §Store unit test recipe, Doc 22).

import { describe, expect, it, vi } from 'vitest';

import { formatTtl, isStoryCacheActive, useCacheStore } from '../stores/cacheStore';

import type { CacheStatus, SessionCacheStatus } from '../lib/types';

// Stub the typed wrappers so the auto-`refreshAlive` after every event
// reducer doesn't invoke Tauri (which is undefined under happy-dom).
vi.mock('../lib/tauriApi/cache', () => ({
  getCacheState: vi.fn().mockResolvedValue({
    cache_name: null,
    expiry_at: null,
    is_stale: false,
    last_cached_message_id: null,
    total_token_count: null,
    doc_snapshots: {},
  }),
  getSessionCacheState: vi
    .fn()
    .mockResolvedValue({ cache_name: null, expiry_at: null, is_stale: false }),
  listAliveCaches: vi.fn().mockResolvedValue([]),
}));

function freshStatus(overrides: Partial<CacheStatus> = {}): CacheStatus {
  return {
    cache_name: 'cachedContents/abc',
    expiry_at: new Date(Date.now() + 60_000).toISOString(),
    is_stale: false,
    last_cached_message_id: 'm1',
    total_token_count: 10_000,
    doc_snapshots: { docA: 'hash' },
    ...overrides,
  };
}

function reset(): void {
  useCacheStore.setState({ byStory: {}, bySession: {}, alive: [], tick: 0 });
}

describe('cacheStore', () => {
  it('handleStoryCacheEvent merges incoming status', () => {
    reset();
    const status = freshStatus();
    useCacheStore.getState().handleStoryCacheEvent('story1', status);
    expect(useCacheStore.getState().byStory['story1']).toEqual(status);
  });

  it('handleSessionCacheEvent merges session status', () => {
    reset();
    const status: SessionCacheStatus = {
      cache_name: 'cachedContents/sess',
      expiry_at: new Date(Date.now() + 30_000).toISOString(),
      is_stale: false,
    };
    useCacheStore.getState().handleSessionCacheEvent('s1', status);
    expect(useCacheStore.getState().bySession['s1']).toEqual(status);
  });

  it('clearAll wipes byStory + bySession', () => {
    reset();
    useCacheStore.getState().handleStoryCacheEvent('story1', freshStatus());
    useCacheStore
      .getState()
      .handleSessionCacheEvent('s1', { cache_name: 'x', expiry_at: '2026', is_stale: false });
    useCacheStore.getState().clearAll();
    expect(useCacheStore.getState().byStory).toEqual({});
    expect(useCacheStore.getState().bySession).toEqual({});
  });

  it('subscribeTicker increments tick once per second', () => {
    vi.useFakeTimers();
    reset();
    const unsub = useCacheStore.getState().subscribeTicker();
    expect(useCacheStore.getState().tick).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(useCacheStore.getState().tick).toBe(1);
    vi.advanceTimersByTime(2500);
    expect(useCacheStore.getState().tick).toBe(3);
    unsub();
    // After unsubscribe, no further ticks.
    vi.advanceTimersByTime(5000);
    expect(useCacheStore.getState().tick).toBe(3);
    vi.useRealTimers();
  });

  it('subscribeTicker shares one interval across multiple subscribers', () => {
    vi.useFakeTimers();
    reset();
    const u1 = useCacheStore.getState().subscribeTicker();
    const u2 = useCacheStore.getState().subscribeTicker();
    vi.advanceTimersByTime(1000);
    // Single shared interval => one increment per second regardless of count.
    expect(useCacheStore.getState().tick).toBe(1);
    u1();
    vi.advanceTimersByTime(1000);
    expect(useCacheStore.getState().tick).toBe(2);
    u2();
    vi.advanceTimersByTime(5000);
    expect(useCacheStore.getState().tick).toBe(2);
    vi.useRealTimers();
  });
});

describe('isStoryCacheActive', () => {
  it('false when cache_name is null', () => {
    expect(
      isStoryCacheActive({
        cache_name: null,
        expiry_at: null,
        is_stale: false,
        last_cached_message_id: null,
        total_token_count: null,
        doc_snapshots: {},
      }),
    ).toBe(false);
  });

  it('false when stale', () => {
    expect(isStoryCacheActive(freshStatus({ is_stale: true }))).toBe(false);
  });

  it('false when expired', () => {
    expect(
      isStoryCacheActive(freshStatus({ expiry_at: new Date(Date.now() - 1000).toISOString() })),
    ).toBe(false);
  });

  it('true when fresh and unexpired', () => {
    expect(isStoryCacheActive(freshStatus())).toBe(true);
  });
});

describe('formatTtl', () => {
  it('returns --:-- for null', () => {
    expect(formatTtl(null)).toBe('--:--');
  });

  it('returns 00:00 for past timestamps', () => {
    expect(formatTtl(new Date(Date.now() - 5000).toISOString())).toBe('00:00');
  });

  it('formats minute:second for sub-hour', () => {
    const future = new Date(Date.now() + 90_500).toISOString();
    const out = formatTtl(future);
    expect(out).toMatch(/^0[01]:\d{2}$/);
  });
});
