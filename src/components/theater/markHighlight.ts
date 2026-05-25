import { useEffect } from 'react';

import type { ImportantMark } from '@/lib/types';
import type { RefObject } from 'react';

/**
 * Doc 30 §5 — in-place mark highlight via the CSS Custom Highlight API.
 *
 * No DOM mutation: we register `Range`s under the single `loom-mark` highlight
 * name and let `::highlight(loom-mark)` paint them (so React reconciliation and
 * `pre-wrap` rendering are untouched, mirroring the no-`<span>` approach Doc 29
 * adopts). One module-level registry aggregates ranges from every mounted
 * bubble keyed by message id; any change rebuilds the highlight.
 */

const HIGHLIGHT_NAME = 'loom-mark';
const byMessage = new Map<string, Range[]>();

function highlightSupported(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    'highlights' in CSS &&
    typeof (globalThis as { Highlight?: unknown }).Highlight === 'function'
  );
}

function rebuild(): void {
  if (!highlightSupported()) return;
  const all: Range[] = [];
  for (const ranges of byMessage.values()) all.push(...ranges);
  if (all.length === 0) {
    CSS.highlights.delete(HIGHLIGHT_NAME);
    return;
  }
  CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...all));
}

function setRanges(messageId: string, ranges: Range[]): void {
  if (ranges.length === 0) byMessage.delete(messageId);
  else byMessage.set(messageId, ranges);
  rebuild();
}

function clearRanges(messageId: string): void {
  if (byMessage.delete(messageId)) rebuild();
}

/** Re-find `quote` within one text node. Returns a range only for a single
 *  unambiguous occurrence (`null` for zero or multiple — dot-only fallback). */
function uniqueRangeInNode(node: Text, quote: string): Range | null {
  const first = node.data.indexOf(quote);
  if (first === -1) return null;
  if (node.data.indexOf(quote, first + quote.length) !== -1) return null;
  const range = document.createRange();
  range.setStart(node, first);
  range.setEnd(node, first + quote.length);
  return range;
}

/** AI bubble: the prose is a single text node, so build the range from the
 *  stored offsets and disambiguate duplicates (Doc 30 §5/§14). Offsets are a
 *  hint — validate they actually frame `quoted_text` (guards the char-count vs
 *  UTF-16 drift in `services/marks.rs::locate`) and re-find if they don't. */
function buildAiRange(container: HTMLElement, mark: ImportantMark): Range | null {
  const node = container.firstChild;
  if (!(node instanceof Text)) return null;
  const { char_start: start, char_end: end, quoted_text: quote } = mark;
  if (start !== null && end !== null && start >= 0 && end <= node.length && start < end) {
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    if (range.toString() === quote) return range;
  }
  return uniqueRangeInNode(node, quote);
}

/** User bubble: no single-string offset (fields render as multiple nodes).
 *  Best-effort re-find across the bubble's text nodes — a single unambiguous
 *  match is painted; zero or multiple matches fall back to dot-only. */
function buildUserRange(container: HTMLElement, quote: string): Range | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let match: Range | null = null;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const r = uniqueRangeInNode(node as Text, quote);
    if (r === null) continue;
    if (match !== null) return null; // ambiguous across nodes
    match = r;
  }
  return match;
}

/**
 * Paint a message's non-orphaned marks in place. Re-runs whenever the mark set
 * (ids, offsets, quotes) changes; clears the message's ranges on unmount.
 */
export function useMarkHighlight(
  messageId: string,
  ref: RefObject<HTMLElement | null>,
  marks: ImportantMark[],
  isAi: boolean,
): void {
  const active = marks.filter((m) => !m.is_orphaned);
  // Dependency key — effect reruns when any anchor or quote changes.
  const key = active.map((m) => `${m.id}:${m.char_start}:${m.char_end}:${m.quoted_text}`).join('|');

  useEffect(() => {
    const el = ref.current;
    if (el === null || !highlightSupported() || active.length === 0) {
      clearRanges(messageId);
      return () => clearRanges(messageId);
    }
    const ranges: Range[] = [];
    for (const m of active) {
      const r = isAi ? buildAiRange(el, m) : buildUserRange(el, m.quoted_text);
      if (r !== null) ranges.push(r);
    }
    setRanges(messageId, ranges);
    return () => clearRanges(messageId);
    // `active` is derived from `key`; listing `key` keeps the dep array stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId, key, isAi, ref]);
}
