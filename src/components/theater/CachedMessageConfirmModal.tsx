import { useEffect } from 'react';

interface CachedMessageConfirmModalProps {
  /** 'edit' | 'delete' shapes the message body and the confirm button label. */
  action: 'edit' | 'delete';
  /** What kind of cache the message is in. Doc 22 phrases the consulting
   *  variant differently. */
  scope: 'story' | 'consulting';
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Doc 22 §Cached-message Edit/Delete Protection. One-shot confirmation that
 * the writer is about to invalidate the active cache. Dismissal proceeds
 * with the operation (the backend's stale-trigger then marks the cache
 * stale and the next send rebuilds).
 */
export function CachedMessageConfirmModal({
  action,
  scope,
  onConfirm,
  onCancel,
}: CachedMessageConfirmModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
      else if (e.key === 'Enter') onConfirm();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel, onConfirm]);

  const cacheLabel = scope === 'consulting' ? 'consulting session cache' : 'active cache';
  const verb = action === 'edit' ? 'Editing' : 'Deleting';
  const confirmLabel = action === 'edit' ? 'Edit anyway' : 'Delete anyway';

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Cached message warning"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-bg-base)]/70 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-md border border-[var(--color-border)] bg-[var(--color-bg-pane)] p-4 shadow-lg"
      >
        <h2 className="mb-2 text-[14px] font-semibold text-[var(--color-text-primary)]">
          Message is in the {cacheLabel}
        </h2>
        <p className="mb-4 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
          {verb} this message will invalidate the cache. The next send will rebuild it.
        </p>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-sm border border-[var(--color-border)] px-3 py-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className="rounded-sm bg-[var(--color-accent)] px-3 py-1 text-[12px] font-medium text-white"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
