import { useRef, useState } from 'react';

import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { ImportantMark } from '@/lib/types';

/**
 * Doc 30 §4 — the per-bubble mark indicator. A dot at the bubble's
 * bottom-right corner whenever the message has at least one mark; hovering it
 * opens a popover listing the marks with Edit-note / Remove affordances. The
 * dot switches to a warning treatment when any of the message's marks are
 * orphaned (§8). The host bubble must be `position: relative`.
 */

const CLOSE_DELAY_MS = 120;

interface MarkDotProps {
  /** This message's marks (orphaned included — the dot surfaces both). */
  marks: ImportantMark[];
}

export function MarkDot({ marks }: MarkDotProps) {
  const removeMark = useWorkspaceStore((s) => s.removeMark);
  const updateMarkNote = useWorkspaceStore((s) => s.updateMarkNote);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (marks.length === 0) return null;

  const orphanCount = marks.filter((m) => m.is_orphaned).length;
  const liveCount = marks.length - orphanCount;
  const hasWarning = orphanCount > 0;

  function show() {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    setOpen(true);
  }
  function scheduleHide() {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      setEditingId(null);
    }, CLOSE_DELAY_MS);
  }

  function startEdit(m: ImportantMark) {
    setEditingId(m.id);
    setNoteDraft(m.note ?? '');
  }
  async function saveNote(id: string) {
    const trimmed = noteDraft.trim();
    await updateMarkNote(id, trimmed.length === 0 ? null : trimmed);
    setEditingId(null);
  }

  return (
    <div
      className="absolute -bottom-1.5 -right-1.5 z-10"
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
    >
      <button
        type="button"
        aria-label={`Marked important (${liveCount})${hasWarning ? `, ${orphanCount} need attention` : ''}`}
        className="block h-2.5 w-2.5 rounded-full ring-2 ring-[var(--color-bg-base)] transition-transform hover:scale-125"
        style={{ backgroundColor: hasWarning ? 'var(--color-warning)' : 'var(--color-mark)' }}
      />
      {open && (
        // Transparent padding bridges the dot→popover gap so the hover survives.
        <div className="absolute bottom-full right-0 pb-1.5">
          <div
            role="tooltip"
            // Keep the native bubble selection alive if the user drags here.
            onMouseDown={(e) => e.preventDefault()}
            className="w-72 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2.5 font-sans text-[12px] text-[var(--color-text-primary)] shadow-lg"
          >
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
              Marked important ({liveCount})
              {hasWarning && (
                <span className="text-[var(--color-warning)]">
                  {' '}
                  · ⚠ {orphanCount} need{orphanCount === 1 ? 's' : ''} attention
                </span>
              )}
            </div>
            <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
              {marks.map((m) => (
                <li key={m.id} className="rounded-sm bg-[var(--color-bg-base)] px-2 py-1.5">
                  <div
                    className={`line-clamp-2 ${
                      m.is_orphaned
                        ? 'text-[var(--color-text-muted)] line-through'
                        : 'text-[var(--color-text-primary)]'
                    }`}
                  >
                    &ldquo;{m.quoted_text}&rdquo;
                  </div>

                  {m.is_orphaned ? (
                    <div className="mt-1 text-[11px] text-[var(--color-warning)]">
                      ⚠ The marked passage changed. Re-mark or remove.
                    </div>
                  ) : editingId === m.id ? (
                    <div className="mt-1.5 flex flex-col gap-1">
                      <input
                        autoFocus
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void saveNote(m.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        placeholder="Why does this matter?"
                        className="w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-1.5 py-1 text-[12px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveNote(m.id)}
                          className="text-[11px] text-[var(--color-accent-text)] hover:underline"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    m.note !== null &&
                    m.note.length > 0 && (
                      <div className="mt-1 text-[11px] italic text-[var(--color-text-secondary)]">
                        note: {m.note}
                      </div>
                    )
                  )}

                  {editingId !== m.id && (
                    <div className="mt-1 flex justify-end gap-3">
                      {!m.is_orphaned && (
                        <button
                          type="button"
                          onClick={() => startEdit(m)}
                          className="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                        >
                          {m.note !== null && m.note.length > 0 ? 'Edit note' : 'Add note'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void removeMark(m.id)}
                        className="text-[11px] text-[var(--color-error)] hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
