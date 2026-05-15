import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { CacheContentsModal } from '@/components/theater/CacheContentsModal';
import { createStoryCache, deleteStoryCache } from '@/lib/tauriApi/cache';
import { formatTtl, ttlColorToken, useCacheStore } from '@/stores/cacheStore';

import type { AliveCacheRow } from '@/lib/types';

/**
 * Doc 22 §View Cache Status + Doc 27 §Right Pane §Cache section.
 *
 * Lists every alive cache (story + active consulting). Single shared 1 Hz
 * ticker via `cacheStore.subscribeTicker()` drives the TTL countdown
 * re-render. Click a row → Cache Contents modal. Right-click row → Delete
 * cache (story rows only; consulting rows live with the session lifecycle).
 */
export function CacheSection() {
  const alive = useCacheStore((s) => s.alive);
  const tick = useCacheStore((s) => s.tick);
  const refreshAlive = useCacheStore((s) => s.refreshAlive);
  const subscribeTicker = useCacheStore((s) => s.subscribeTicker);

  const [collapsed, setCollapsed] = useState(false);
  const [openModalForStory, setOpenModalForStory] = useState<string | null>(null);

  // Read tick to keep TTL fresh (no value used directly).
  void tick;

  useEffect(() => {
    void refreshAlive().catch((e) => console.error('refreshAlive', e));
  }, [refreshAlive]);

  // Subscribe to the shared 1 Hz ticker only when at least one row is shown.
  useEffect(() => {
    if (alive.length === 0) return;
    return subscribeTicker();
  }, [alive.length, subscribeTicker]);

  return (
    <section
      aria-label="Cache"
      className="flex shrink-0 flex-col border-t border-[--color-border] px-3 py-2"
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.08em] text-[--color-text-muted] hover:text-[--color-text-primary]"
      >
        {collapsed ? <ChevronRight size={12} aria-hidden /> : <ChevronDown size={12} aria-hidden />}
        Cache
      </button>
      {!collapsed && (
        <>
          {alive.length === 0 ? (
            <p className="text-[12px] text-[--color-text-muted]">No active caches.</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {alive.map((row) => (
                <CacheRow
                  key={`${row.story_id}:${row.session_id ?? '_'}`}
                  row={row}
                  onClick={() =>
                    row.session_id === null ? setOpenModalForStory(row.story_id) : undefined
                  }
                />
              ))}
            </ul>
          )}
        </>
      )}
      {openModalForStory !== null && (
        <CacheContentsModal
          storyId={openModalForStory}
          onClose={() => setOpenModalForStory(null)}
        />
      )}
    </section>
  );
}

interface CacheRowProps {
  row: AliveCacheRow;
  onClick?: () => void;
}

function CacheRow({ row, onClick }: CacheRowProps) {
  const tokensK = row.total_tokens > 0 ? `${Math.round(row.total_tokens / 1000)} k` : '—';
  const label =
    row.session_id === null
      ? row.story_name
      : `${row.story_name} › ${row.session_name ?? 'session'}`;

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (row.session_id !== null) {
      // Consulting rows are managed by the session lifecycle (exit_session
      // deletes); a manual delete affordance for them is out of 6D scope.
      return;
    }
    try {
      await deleteStoryCache(row.story_id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete cache');
    }
  }

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        onContextMenu={(e) => void handleDelete(e)}
        className="flex w-full items-center gap-2 rounded-sm px-1 py-0.5 text-left text-[12px] text-[--color-text-primary] hover:bg-[--color-bg-hover]"
      >
        <span className="flex-1 truncate">{label}</span>
        <span className="shrink-0 text-[--color-text-muted]">{tokensK}</span>
        <span
          className="shrink-0 tabular-nums"
          style={{ color: ttlColorToken(row.expiry_at) }}
          title={row.expiry_at}
        >
          {formatTtl(row.expiry_at)}
        </span>
        {row.is_stale && (
          <span
            aria-label="Stale"
            title="Cache is outdated"
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: 'var(--color-warning, var(--color-accent))' }}
          />
        )}
        {row.session_id === null && (
          <button
            type="button"
            onClick={(e) => void handleDelete(e)}
            aria-label={`Delete cache for ${row.story_name}`}
            className="invisible shrink-0 text-[--color-text-muted] hover:text-[--color-text-primary] group-hover:visible"
          >
            <Trash2 size={11} aria-hidden />
          </button>
        )}
      </button>
    </li>
  );
}

/** Manual create-cache button — appears in the right pane header for the
 *  active story. Wired from the parent so it can use `activeStoryId`. */
export function CreateCacheButton({ storyId }: { storyId: string }) {
  const [busy, setBusy] = useState(false);
  async function handleClick() {
    setBusy(true);
    try {
      await createStoryCache(storyId);
      toast.success('Cache created');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create cache');
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={busy}
      className="text-[11px] text-[--color-text-muted] underline-offset-2 hover:text-[--color-text-primary] hover:underline disabled:opacity-50"
    >
      {busy ? 'Creating…' : 'Update cache'}
    </button>
  );
}
