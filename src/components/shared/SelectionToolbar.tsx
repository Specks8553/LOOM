import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { resolveSelectionActions } from '@/components/shared/selectionMenu';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import type {
  SelectionAction,
  SelectionBubbleKind,
  SelectionTarget,
} from '@/components/shared/selectionMenu';
import type { ImportantMark } from '@/lib/types';

/**
 * Doc 29 — Selection Popup.
 *
 * A single observer-overlay mounted once at the workspace root. It watches the
 * browser's native selection (never intercepts it) and renders a floating
 * toolbar above a non-empty selection made inside a registered bubble. The
 * only event handling on the toolbar itself is `onMouseDown→preventDefault()`,
 * which keeps the native selection alive while a button is clicked (Doc 29 §2).
 */

const DEBOUNCE_MS = 150;
const VIEWPORT_MARGIN = 8;
const GAP = 8;

const BUBBLE_KINDS: readonly SelectionBubbleKind[] = ['story-ai', 'session-ai', 'story-user'];

function resolveBubble(node: Node | null): HTMLElement | null {
  if (node === null) return null;
  const el = node instanceof Element ? node : node.parentElement;
  return el?.closest<HTMLElement>('[data-loom-selectable]') ?? null;
}

/** Read the live native selection and resolve it to a `SelectionTarget`, or
 *  `null` when there is nothing actionable (collapsed, empty, outside a
 *  bubble, or crossing a bubble boundary — Doc 29 §4). */
function evaluateSelection(): SelectionTarget | null {
  const sel = window.getSelection();
  if (sel === null || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const raw = sel.toString();
  if (raw.trim().length === 0) return null;

  const anchorBubble = resolveBubble(sel.anchorNode);
  const focusBubble = resolveBubble(sel.focusNode);
  // Both endpoints must resolve to the same bubble — cross-bubble is suppressed.
  if (anchorBubble === null || anchorBubble !== focusBubble) return null;

  const messageId = anchorBubble.dataset.loomSelectable;
  const kindRaw = anchorBubble.dataset.loomBubbleKind;
  if (messageId === undefined || messageId.length === 0) return null;
  if (kindRaw === undefined || !BUBBLE_KINDS.includes(kindRaw as SelectionBubbleKind)) return null;
  const kind = kindRaw as SelectionBubbleKind;

  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;

  // AI prose renders as a single text node — range offsets map 1:1 to
  // `messages.content` (Doc 29 §6). A story user bubble renders multiple
  // fields, so it carries no offsets and exposes only the raw text.
  let offsets: { start: number; end: number } | null = null;
  let text = raw;
  if (kind === 'story-ai' || kind === 'session-ai') {
    const textNode = anchorBubble.firstChild;
    if (
      textNode instanceof Text &&
      range.startContainer === textNode &&
      range.endContainer === textNode
    ) {
      const start = Math.min(range.startOffset, range.endOffset);
      const end = Math.max(range.startOffset, range.endOffset);
      offsets = { start, end };
      text = textNode.data.slice(start, end);
    }
  }

  return { messageId, kind, text, offsets, rect };
}

/** Doc 29 §7 — selection-first Ghostwriter entry. The selection is handed off
 *  as offset *data*, not a live `Range`, so it survives the bubble
 *  re-rendering as `GhostwriterBubble`. */
function ghostwriterFromSelection(target: SelectionTarget): void {
  if (target.offsets === null) return;
  const store = useWorkspaceStore.getState();
  const cur = store.ghostwriter;
  // Doc 17 §One-bubble-at-a-time — switching off a bubble with a pending diff
  // under review needs an explicit discard confirmation.
  if (cur !== null && cur.activeMessageId !== target.messageId && cur.phase === 'reviewing') {
    if (!window.confirm('Discard pending Ghostwriter changes?')) return;
  }
  store.enterGhostwriter(target.messageId);
  store.setGhostwriterSelection({
    startOffset: target.offsets.start,
    endOffset: target.offsets.end,
    selectedText: target.text,
  });
}

/** Doc 30 §3 — create a mark from the live selection, then dismiss. Not gated
 *  by `isGenerating` (a pure DB write). User bubbles carry no offsets. */
function markFromSelection(target: SelectionTarget): void {
  void useWorkspaceStore.getState().addMark(target.messageId, target.text, target.offsets);
}

export function SelectionToolbar() {
  const [target, setTarget] = useState<SelectionTarget | null>(null);
  const targetRef = useRef<SelectionTarget | null>(null);
  targetRef.current = target;
  const isGenerating = useWorkspaceStore((s) => s.isGenerating);
  const marks = useWorkspaceStore((s) => s.marks);

  // Observe the native selection — debounced so mid-drag noise settles.
  useEffect(() => {
    let handle: number | null = null;
    function onSelectionChange() {
      if (handle !== null) window.clearTimeout(handle);
      handle = window.setTimeout(() => {
        setTarget(evaluateSelection());
      }, DEBOUNCE_MS);
    }
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      if (handle !== null) window.clearTimeout(handle);
    };
  }, []);

  // Reposition on scroll/resize (the toolbar is anchored to text); dismiss on
  // right-click (the context menu wins) and on Escape (captured — does not
  // propagate to the Escape Chain). Listeners stay mounted and read
  // `targetRef` so they act only while the toolbar is visible.
  useEffect(() => {
    function reposition() {
      if (targetRef.current === null) return;
      const next = evaluateSelection();
      if (next === null) {
        setTarget(null);
        return;
      }
      setTarget((prev) => (prev === null ? null : { ...prev, rect: next.rect }));
    }
    function onContextMenu() {
      if (targetRef.current !== null) setTarget(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (targetRef.current !== null && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setTarget(null);
      }
    }
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);

  if (target === null) return null;

  const targetMarks: ImportantMark[] = marks.filter((m) => m.message_id === target.messageId);

  const actions = resolveSelectionActions(target, {
    isGenerating,
    ghostwriter: (t) => {
      ghostwriterFromSelection(t);
      setTarget(null);
    },
    copy: (t) => {
      void navigator.clipboard.writeText(t.text);
      setTarget(null);
    },
    marks: targetMarks,
    markImportant: (t) => {
      markFromSelection(t);
      setTarget(null);
    },
    unmark: (markId) => {
      void useWorkspaceStore.getState().removeMark(markId);
      setTarget(null);
    },
    editMarkNote: (mark) => {
      const next = window.prompt('Note for this mark:', mark.note ?? '');
      setTarget(null);
      if (next === null) return;
      const trimmed = next.trim();
      void useWorkspaceStore
        .getState()
        .updateMarkNote(mark.id, trimmed.length === 0 ? null : trimmed);
    },
  });
  if (actions.length === 0) return null;

  return <SelectionToolbarView target={target} actions={actions} />;
}

function SelectionToolbarView({
  target,
  actions,
}: {
  target: SelectionTarget;
  actions: SelectionAction[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  // Measure, then anchor above the selection — flip below near the top edge,
  // clamp to the viewport (mirrors `ContextMenu` viewport-margin logic).
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const { width, height } = el.getBoundingClientRect();
    const { rect } = target;
    let x = rect.left + rect.width / 2 - width / 2;
    let y = rect.top - height - GAP;
    if (y < VIEWPORT_MARGIN) y = rect.bottom + GAP;
    x = Math.min(Math.max(VIEWPORT_MARGIN, x), window.innerWidth - width - VIEWPORT_MARGIN);
    y = Math.min(Math.max(VIEWPORT_MARGIN, y), window.innerHeight - height - VIEWPORT_MARGIN);
    setPos({ x, y });
  }, [target]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      // Doc 29 §2 — the one piece of event handling: preventDefault keeps the
      // native selection alive while a toolbar button is clicked.
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        top: pos?.y ?? target.rect.top,
        left: pos?.x ?? target.rect.left,
      }}
      className={`z-[55] flex items-center gap-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-0.5 font-sans text-[12px] shadow-lg transition-[opacity,transform] duration-150 ease-out ${
        pos === null ? 'scale-[0.96] opacity-0' : 'scale-100 opacity-100'
      }`}
    >
      {actions.map((action, i) => (
        <button
          key={i}
          type="button"
          role="menuitem"
          disabled={action.disabled}
          onClick={action.onClick}
          className={`flex items-center gap-1.5 rounded-[4px] px-2 py-1 transition-colors duration-150 disabled:cursor-default disabled:opacity-40 enabled:hover:bg-[var(--color-bg-hover)] ${
            action.destructive === true
              ? 'text-[var(--color-error)]'
              : 'text-[var(--color-text-primary)]'
          }`}
        >
          {action.icon !== undefined && <action.icon size={13} aria-hidden className="shrink-0" />}
          <span className="whitespace-nowrap">{action.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
