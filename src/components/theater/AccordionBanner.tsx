import { ChevronRight, ChevronsDown, ChevronsUp, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { AccordionSegment, Checkpoint } from '@/lib/types';

interface AccordionBannerProps {
  checkpoint: Checkpoint;
  /** Closed segment STARTING at this checkpoint (the "chapter starting here"
   *  per Doc 16 §Banners). `null` when the segment is open. */
  segment: AccordionSegment | null;
  /** Closed segment ENDING at this checkpoint — used for the "previous chapter"
   *  right-click actions (Doc 16 §Banner right-click menu). `null` on the
   *  start sentinel. */
  previousSegment: AccordionSegment | null;
  /** Message count inside the segment. Drives tail copy. */
  segmentMessageCount: number;
}

/**
 * Doc 16 §Banners. Renders one checkpoint's banner with the button-slot
 * state machine and the right-click menu. Visual tokens follow Doc 27's
 * provisional partition-banner shape (Phase 12 will style this).
 */
export function AccordionBanner({
  checkpoint,
  segment,
  previousSegment,
  segmentMessageCount,
}: AccordionBannerProps) {
  const isGenerating = useWorkspaceStore((s) => s.isGenerating);
  const summarisingIds = useWorkspaceStore((s) => s.summarisingSegmentIds);
  const renameCheckpoint = useWorkspaceStore((s) => s.renameCheckpoint);
  const deleteCheckpoint = useWorkspaceStore((s) => s.deleteCheckpoint);
  const updateSegmentSummary = useWorkspaceStore((s) => s.updateSegmentSummary);
  const setSegmentCollapsed = useWorkspaceStore((s) => s.setSegmentCollapsed);
  const setSegmentUseSummary = useWorkspaceStore((s) => s.setSegmentUseSummary);
  const clearSegmentSummary = useWorkspaceStore((s) => s.clearSegmentSummary);
  const summariseSegment = useWorkspaceStore((s) => s.summariseSegment);

  const [renameValue, setRenameValue] = useState<string | null>(null);
  const [editingSummary, setEditingSummary] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Doc 16 §Banner state matrix — `is_collapsed` is the canonical UI state,
  // but the chevron also reflects it. When the segment is null (open), the
  // banner is "expanded" with no body.
  const isCollapsed = segment !== null && segment.is_collapsed;
  const hasSummary = segment !== null && segment.summary !== null;
  const isStale = segment !== null && segment.is_stale;
  const isSummarising = segment !== null && summarisingIds.has(segment.id);

  // D-24 "Collapse previous": a remote control for the segment ENDING at this
  // checkpoint (the chapter above). Hidden on the start sentinel (no previous
  // chapter); present and active on the open-segment banner — where it is the
  // entry point to the summarise workflow.
  const prevCollapsed = previousSegment !== null && previousSegment.is_collapsed;

  // Close menu on outside click / escape.
  useEffect(() => {
    if (menuPos === null) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuPos(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuPos(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuPos]);

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setMenuPos({ x: e.clientX, y: e.clientY });
  }

  function toggleCollapse() {
    // D-24: collapse no longer requires a summary. The open segment (segment
    // null) has no row to collapse; everything else folds freely.
    if (segment === null) return;
    void setSegmentCollapsed(segment.id, !segment.is_collapsed);
  }

  function togglePreviousCollapse() {
    if (previousSegment === null) return;
    void setSegmentCollapsed(previousSegment.id, !previousSegment.is_collapsed);
  }

  async function handleGenerateSummary() {
    if (segment === null) return;
    await summariseSegment(segment.id);
  }

  async function handleRenameSubmit() {
    if (renameValue === null) return;
    const trimmed = renameValue.trim();
    if (trimmed.length === 0 || trimmed === checkpoint.name) {
      setRenameValue(null);
      return;
    }
    await renameCheckpoint(checkpoint.id, trimmed);
    setRenameValue(null);
  }

  async function handleDeleteCheckpoint() {
    setMenuPos(null);
    if (checkpoint.is_start) return;
    if (
      !window.confirm(
        `Delete checkpoint "${checkpoint.name}"?\nSurrounding chapters will be merged.\nThis cannot be undone in v2.0.`,
      )
    )
      return;
    await deleteCheckpoint(checkpoint.id);
  }

  async function handleSummariseSegment(seg: AccordionSegment) {
    setMenuPos(null);
    await summariseSegment(seg.id);
  }

  function handleEditSummary(seg: AccordionSegment) {
    setMenuPos(null);
    setEditingSummary(seg.summary ?? '');
  }

  async function handleSaveSummaryEdit() {
    if (segment === null || editingSummary === null) return;
    await updateSegmentSummary(segment.id, editingSummary);
    setEditingSummary(null);
  }

  async function handleClearSummary() {
    if (segment === null) return;
    setMenuPos(null);
    if (!window.confirm(`Clear summary for "${checkpoint.name}"?`)) return;
    await clearSegmentSummary(segment.id);
  }

  function handleToggleUseSummary() {
    if (segment === null) return;
    void setSegmentUseSummary(segment.id, !segment.use_summary);
  }

  // Tail text per Doc 16 §Token impact display (provisional copy).
  const tail = (() => {
    if (segment === null) return `${segmentMessageCount} messages so far`;
    if (segment.is_collapsed && segment.summary !== null) {
      // Provisional — real "tokens saved" needs a count helper.
      return `${segmentMessageCount} messages compressed`;
    }
    if (segment.is_collapsed && segment.summary === null) {
      // D-24: folded but unsummarised — full content still sent, no savings.
      return `~${segmentMessageCount} messages · summary needed`;
    }
    return `~${segmentMessageCount} messages`;
  })();

  const label = (
    <>
      <span className="font-medium text-[var(--color-text-primary)]">{checkpoint.name}</span>
      <span className="text-[var(--color-text-muted)]"> · {tail}</span>
      {isStale && (
        <span
          className="ml-1 text-[var(--color-warning)]"
          title="Segment is stale (a contained message was edited)"
        >
          ⚠
        </span>
      )}
    </>
  );

  return (
    <div
      className="my-2 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)]"
      onContextMenu={handleContextMenu}
    >
      <div className="flex w-full items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={toggleCollapse}
          disabled={segment === null}
          aria-label={isCollapsed ? 'Expand chapter' : 'Collapse chapter'}
          className="shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronRight
            size={14}
            className={`transition-transform ${!isCollapsed ? 'rotate-90' : ''}`}
          />
        </button>
        {previousSegment !== null && (
          <button
            type="button"
            onClick={togglePreviousCollapse}
            aria-label={prevCollapsed ? 'Expand previous chapter' : 'Collapse previous chapter'}
            title={prevCollapsed ? 'Expand previous chapter' : 'Collapse previous chapter'}
            className="shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          >
            {prevCollapsed ? <ChevronsDown size={14} /> : <ChevronsUp size={14} />}
          </button>
        )}
        <div className="flex-1 truncate text-[12px]">
          {renameValue === null ? (
            label
          ) : (
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleRenameSubmit();
                if (e.key === 'Escape') setRenameValue(null);
              }}
              onBlur={() => void handleRenameSubmit()}
              className="w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-bg-base)] px-1 py-0.5 text-[12px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            />
          )}
        </div>
        <BannerButtonSlot
          segment={segment}
          hasSummary={hasSummary}
          isSummarising={isSummarising}
          isGenerating={isGenerating}
          onGenerate={() => void handleGenerateSummary()}
          onToggleUseSummary={handleToggleUseSummary}
        />
      </div>

      {/* Body: when the segment has a summary AND is collapsed, show the
       *  summary card. When expanded, the parent renders the bubbles between
       *  the chevron and the next banner (we render the inline editor only). */}
      {segment !== null && isCollapsed && hasSummary && (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-bg-base)] px-3 py-2 text-[14px] text-[var(--color-text-primary)]">
          <div className="whitespace-pre-wrap">{segment.summary}</div>
        </div>
      )}

      {/* D-24: collapsed with no summary → "summary needed" card. The whole
       *  card is a click-to-generate target (same as the header button). */}
      {segment !== null && isCollapsed && !hasSummary && (
        <button
          type="button"
          onClick={() => void handleGenerateSummary()}
          disabled={isGenerating}
          title={isGenerating && !isSummarising ? 'Generation already in progress' : undefined}
          className="flex w-full items-center justify-between border-t border-[var(--color-border)] bg-[var(--color-bg-base)] px-3 py-2 text-left text-[13px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span>{isSummarising ? 'Summarising…' : 'Summary needed'}</span>
          {!isSummarising && (
            <span className="text-[11px] text-[var(--color-text-muted)]">Click to generate</span>
          )}
        </button>
      )}

      {/* Inline summary editor — shown after `Edit summary` in the menu. */}
      {segment !== null && editingSummary !== null && (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-bg-base)] px-3 py-2">
          <textarea
            value={editingSummary}
            onChange={(e) => setEditingSummary(e.target.value)}
            className="min-h-[120px] w-full resize-y rounded-sm border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditingSummary(null)}
              className="rounded-sm border border-[var(--color-border)] px-2 py-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSaveSummaryEdit()}
              className="rounded-sm bg-[var(--color-accent)] px-2 py-1 text-[12px] text-white"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {/* Right-click menu (overlay; Doc 09 Dialog primitive deferred). */}
      {menuPos !== null && (
        <div
          ref={menuRef}
          role="menu"
          style={{ position: 'fixed', top: menuPos.y, left: menuPos.x, zIndex: 50 }}
          className="min-w-[200px] rounded-md border border-[var(--color-border)] bg-[var(--color-bg-base)] py-1 text-[12px] text-[var(--color-text-primary)] shadow-lg"
        >
          {segment !== null && !hasSummary && (
            <MenuItem onClick={() => void handleSummariseSegment(segment)} disabled={isGenerating}>
              Summarise this chapter
            </MenuItem>
          )}
          {segment !== null && hasSummary && (
            <MenuItem onClick={() => void handleSummariseSegment(segment)} disabled={isGenerating}>
              Re-summarise this chapter
            </MenuItem>
          )}
          {segment !== null && hasSummary && (
            <MenuItem onClick={() => handleEditSummary(segment)}>Edit summary</MenuItem>
          )}
          {previousSegment !== null && (
            <MenuItem
              onClick={() => {
                setMenuPos(null);
                togglePreviousCollapse();
              }}
            >
              {prevCollapsed ? 'Expand previous chapter' : 'Collapse previous chapter'}
            </MenuItem>
          )}
          {segment !== null && (
            <MenuItem
              onClick={() => {
                setMenuPos(null);
                toggleCollapse();
              }}
            >
              {isCollapsed ? 'Expand' : 'Collapse'}
            </MenuItem>
          )}
          <MenuItem
            onClick={() => {
              setMenuPos(null);
              setRenameValue(checkpoint.name);
            }}
          >
            Rename
          </MenuItem>
          {segment !== null && hasSummary && (
            <MenuItem onClick={() => void handleClearSummary()}>Clear summary</MenuItem>
          )}
          {!checkpoint.is_start && (
            <MenuItem onClick={() => void handleDeleteCheckpoint()}>Delete checkpoint</MenuItem>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  onClick,
  disabled = false,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="block w-full px-3 py-1.5 text-left hover:bg-[var(--color-bg-elevated)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function BannerButtonSlot({
  segment,
  hasSummary,
  isSummarising,
  isGenerating,
  onGenerate,
  onToggleUseSummary,
}: {
  segment: AccordionSegment | null;
  hasSummary: boolean;
  isSummarising: boolean;
  isGenerating: boolean;
  onGenerate: () => void;
  onToggleUseSummary: () => void;
}) {
  // Open segment → no button.
  if (segment === null) return null;

  if (isSummarising) {
    return (
      <Loader2
        size={14}
        className="shrink-0 animate-spin text-[var(--color-text-muted)]"
        aria-label="Summarising"
      />
    );
  }

  if (!hasSummary) {
    return (
      <button
        type="button"
        onClick={onGenerate}
        disabled={isGenerating}
        title={isGenerating ? 'Generation already in progress' : undefined}
        className="shrink-0 rounded-sm border border-[var(--color-border)] bg-[var(--color-bg-base)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        Generate summary
      </button>
    );
  }

  // Collapsed forces use_summary ON visually; toggle is hidden per Doc 16
  // §Banner state matrix row 1.
  if (segment.is_collapsed) return null;

  return (
    <button
      type="button"
      onClick={onToggleUseSummary}
      className={`shrink-0 rounded-sm border border-[var(--color-border)] px-2 py-0.5 text-[11px] ${
        segment.use_summary
          ? 'bg-[var(--color-accent)] text-white'
          : 'bg-[var(--color-bg-base)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
      }`}
      aria-pressed={segment.use_summary}
      title="Toggle summary substitution in API history"
    >
      Use summary
    </button>
  );
}
