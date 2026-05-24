import { useErrorModalStore } from '../../stores/errorModalStore';

/**
 * Blocking-modal error tier (Doc 12 §Error Display Hierarchy §3). Renders the
 * single active blocking error from `errorModalStore`. Per Doc 12 it cannot be
 * dismissed by clicking the backdrop or pressing Escape — only by the provided
 * action button. Mounted once near the app root.
 */
export function ErrorModal() {
  const current = useErrorModalStore((s) => s.current);
  const dismiss = useErrorModalStore((s) => s.dismiss);

  if (!current) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={current.title}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--color-bg-base)]/70 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-md border border-[var(--color-border)] bg-[var(--color-bg-pane)] p-4 shadow-lg">
        <h2 className="mb-2 flex items-center gap-2 text-[14px] font-semibold text-[var(--color-error)]">
          {current.title}
        </h2>
        <p className="mb-4 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
          {current.body}
        </p>
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={dismiss}
            autoFocus
            className="rounded-sm bg-[var(--color-accent)] px-3 py-1 text-[12px] font-medium text-white"
          >
            {current.actionLabel ?? 'Dismiss'}
          </button>
        </div>
      </div>
    </div>
  );
}
