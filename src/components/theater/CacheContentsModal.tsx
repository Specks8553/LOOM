import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { createStoryCache, deleteStoryCache } from '@/lib/tauriApi/cache';
import { getItemContent } from '@/lib/tauriApi/vault';
import { formatTtl, useCacheStore } from '@/stores/cacheStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

interface CacheContentsModalProps {
  storyId: string;
  onClose: () => void;
}

/**
 * Doc 22 §Cache Status UI §Cache Contents Modal.
 *
 * Per-doc rows with dirty-check (SHA-256 of current content via
 * `crypto.subtle.digest` compared to `cache_state.doc_snapshots`),
 * story-history row with the cached message count, and Update / Delete /
 * Close actions. Dialog reuses the same fixed-overlay pattern as
 * `WorldPickerModal` (Doc 09 Dialog primitive lands in Phase 11).
 */
export function CacheContentsModal({ storyId, onClose }: CacheContentsModalProps) {
  const status = useCacheStore((s) => s.byStory[storyId]);
  const attachedDocs = useWorkspaceStore((s) =>
    s.activeStoryId === storyId ? s.attachedDocs : [],
  );
  const tick = useCacheStore((s) => s.tick);
  const subscribeTicker = useCacheStore((s) => s.subscribeTicker);

  void tick;
  useEffect(() => subscribeTicker(), [subscribeTicker]);

  // Esc-to-close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [busy, setBusy] = useState(false);
  const [docDirty, setDocDirty] = useState<Record<string, boolean>>({});

  // Run a per-doc SHA-256 dirty check whenever the modal opens or the
  // attached docs change. The hash compares the current item content to
  // the snapshot recorded in `cache_state.doc_snapshots`. Image rows are
  // hashed against the `file_api_uri`, mirroring the backend.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!status) return;
      const next: Record<string, boolean> = {};
      for (const doc of attachedDocs) {
        const snap = status.doc_snapshots[doc.id];
        if (snap === undefined) {
          // Doc was attached after cache create — counts as dirty.
          next[doc.id] = true;
          continue;
        }
        const currentHash = await hashCurrentDoc(doc);
        next[doc.id] = currentHash !== snap;
      }
      if (!cancelled) setDocDirty(next);
    }
    void run().catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [attachedDocs, status]);

  const docMessageCount = useMemo(() => {
    if (!status) return 0;
    return Object.keys(status.doc_snapshots).length;
  }, [status]);

  if (!status || status.cache_name === null) {
    return (
      <Overlay onClose={onClose} title="Cache contents">
        <p className="text-[13px] text-[--color-text-muted]">No active cache for this story.</p>
        <ActionRow onClose={onClose} />
      </Overlay>
    );
  }

  async function handleUpdate() {
    setBusy(true);
    try {
      await createStoryCache(storyId);
      toast.success('Cache refreshed');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not refresh cache');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await deleteStoryCache(storyId);
      toast.success('Cache deleted');
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete cache');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay onClose={onClose} title="Cache contents">
      <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
        <dt className="text-[--color-text-muted]">Resource</dt>
        <dd className="break-all font-mono text-[11px] text-[--color-text-primary]">
          {status.cache_name}
        </dd>
        <dt className="text-[--color-text-muted]">TTL</dt>
        <dd className="tabular-nums text-[--color-text-primary]">{formatTtl(status.expiry_at)}</dd>
        <dt className="text-[--color-text-muted]">Tokens</dt>
        <dd className="tabular-nums text-[--color-text-primary]">
          {status.total_token_count !== null ? `${status.total_token_count.toLocaleString()}` : '—'}
        </dd>
        {status.is_stale && (
          <>
            <dt className="text-[--color-text-muted]">Status</dt>
            <dd style={{ color: 'var(--color-warning, var(--color-accent))' }}>Stale</dd>
          </>
        )}
      </dl>

      <h3 className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-[--color-text-muted]">
        Source documents ({attachedDocs.length})
      </h3>
      {attachedDocs.length === 0 ? (
        <p className="mb-3 text-[12px] text-[--color-text-muted]">No documents in cache.</p>
      ) : (
        <ul className="mb-3 flex flex-col gap-0.5">
          {attachedDocs.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center gap-2 text-[12px] text-[--color-text-primary]"
            >
              <span className="flex-1 truncate">{doc.name}</span>
              <span className="shrink-0 text-[--color-text-muted]">
                {docDirty[doc.id] ? '⚠ changed' : '✓ unchanged'}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-[--color-text-muted]">
        Story history
      </h3>
      <p className="mb-3 text-[12px] text-[--color-text-primary]">
        {status.last_cached_message_id !== null
          ? `Through message ${status.last_cached_message_id.slice(0, 8)} (${docMessageCount} docs cached).`
          : 'No story history cached yet.'}
      </p>

      <ActionRow
        onClose={onClose}
        onUpdate={() => void handleUpdate()}
        onDelete={() => void handleDelete()}
        busy={busy}
      />
    </Overlay>
  );
}

function Overlay({
  onClose,
  title,
  children,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[--color-bg-base]/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-md border border-[--color-border] bg-[--color-bg-pane] p-4 shadow-lg"
      >
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-[--color-text-primary]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] text-[--color-text-muted] hover:text-[--color-text-primary]"
          >
            Close
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

interface ActionRowProps {
  onClose: () => void;
  onUpdate?: () => void;
  onDelete?: () => void;
  busy?: boolean;
}

function ActionRow({ onClose, onUpdate, onDelete, busy }: ActionRowProps) {
  return (
    <div className="flex items-center justify-end gap-2 pt-2">
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="rounded-sm border border-[--color-border] px-3 py-1 text-[12px] text-[--color-text-muted] hover:text-[--color-text-primary] disabled:opacity-50"
        >
          Delete
        </button>
      )}
      {onUpdate && (
        <button
          type="button"
          onClick={onUpdate}
          disabled={busy}
          className="rounded-sm border border-[--color-border] bg-[--color-bg] px-3 py-1 text-[12px] text-[--color-text-primary] hover:border-[--color-accent] disabled:opacity-50"
        >
          {busy ? 'Updating…' : 'Update'}
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        disabled={busy}
        className="rounded-sm bg-[--color-accent] px-3 py-1 text-[12px] font-medium text-white disabled:opacity-50"
      >
        Close
      </button>
    </div>
  );
}

// --- Dirty-check helper -----------------------------------------------------

interface DocLite {
  id: string;
  item_type: string;
  file_api_uri: string | null;
}

async function hashCurrentDoc(doc: DocLite): Promise<string> {
  // Image rows hash the URI (mirrors `services/cache.rs` for Image payloads
  // — `[image: <name>]` placeholder when `file_api_uri` is unset is also
  // possible, but for the dirty check the URI is the right canonical key).
  // SourceDocument rows hash the live content fetched via IPC.
  let input: string;
  if (doc.item_type === 'Image') {
    input = doc.file_api_uri ?? '';
  } else {
    input = await getItemContent(doc.id);
  }
  const encoded = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
