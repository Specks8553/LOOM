import { Bookmark, BookmarkX, Copy, Sparkles, StickyNote } from 'lucide-react';

import type { ImportantMark } from '@/lib/types';
import type { LucideIcon } from 'lucide-react';

/**
 * Doc 29 §6 + §8 — Selection Popup target + per-target action resolver.
 *
 * The resolver is a pure `(target, ctx) → SelectionAction[]`; no menu logic
 * lives inside the toolbar or the bubble components. Ghostwriter is the one
 * fixed action (AI bubbles only) — the rest of the list is deliberately open,
 * and additions are additive here.
 */

export type SelectionBubbleKind = 'story-ai' | 'session-ai' | 'story-user';

export interface SelectionTarget {
  /** `messages.id` of the bubble the selection lives in. */
  messageId: string;
  kind: SelectionBubbleKind;
  /** The selected text. For AI bubbles this is the offset-mapped slice. */
  text: string;
  /** Character offsets into `messages.content`. AI bubbles only — a story
   *  user bubble renders multiple fields, so no single-string mapping exists. */
  offsets: { start: number; end: number } | null;
  /** Selection bounding rect in viewport coordinates; recomputed on scroll. */
  rect: DOMRect;
}

export interface SelectionAction {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  /** Label renders in `--color-error` (mirrors `ContextMenu` `MenuItem`). */
  destructive?: boolean;
}

export interface SelectionMenuContext {
  isGenerating: boolean;
  ghostwriter: (target: SelectionTarget) => void;
  copy: (target: SelectionTarget) => void;
  /** Non-orphaned marks on the target's message (Doc 30 §3 gating). */
  marks: ImportantMark[];
  markImportant: (target: SelectionTarget) => void;
  unmark: (markId: string) => void;
  editMarkNote: (mark: ImportantMark) => void;
}

/**
 * Doc 30 §3 — the marks on this message that fully contain the selection.
 * AI bubbles compare by offset; user bubbles (no offsets) fall back to
 * verbatim containment of the selected text within a marked passage.
 */
function containingMarks(target: SelectionTarget, marks: ImportantMark[]): ImportantMark[] {
  const live = marks.filter((m) => !m.is_orphaned);
  if (target.offsets !== null) {
    const { start, end } = target.offsets;
    return live.filter(
      (m) =>
        m.char_start !== null && m.char_end !== null && m.char_start <= start && m.char_end >= end,
    );
  }
  return live.filter((m) => m.quoted_text.includes(target.text));
}

export function resolveSelectionActions(
  target: SelectionTarget,
  ctx: SelectionMenuContext,
): SelectionAction[] {
  const actions: SelectionAction[] = [];
  const isAi = target.kind === 'story-ai' || target.kind === 'session-ai';

  if (isAi) {
    actions.push({
      label: 'Ghostwriter',
      icon: Sparkles,
      // Doc 17 §Selection — needs offset-mapped text with ≥1 non-whitespace
      // character; mutating, so disabled while a generation is in flight.
      disabled: ctx.isGenerating || target.offsets === null || !/\S/u.test(target.text),
      onClick: () => ctx.ghostwriter(target),
    });
  }

  // Marks (Doc 30 §3) — story bubbles only; never on session bubbles.
  if (target.kind === 'story-ai' || target.kind === 'story-user') {
    const containing = containingMarks(target, ctx.marks);
    if (containing.length === 1) {
      const mark = containing[0];
      actions.push({ label: 'Unmark', icon: BookmarkX, onClick: () => ctx.unmark(mark.id) });
      actions.push({
        label: 'Edit note',
        icon: StickyNote,
        onClick: () => ctx.editMarkNote(mark),
      });
    } else if (containing.length === 0 && /\S/u.test(target.text)) {
      // Not inside an existing mark — offer to create one (overlaps allowed, §14).
      actions.push({
        label: 'Mark important',
        icon: Bookmark,
        onClick: () => ctx.markImportant(target),
      });
    }
  }

  actions.push({
    label: 'Copy',
    icon: Copy,
    onClick: () => ctx.copy(target),
  });

  return actions;
}
