import { useEffect, useState } from 'react';

import { GhostwriterPanel } from '@/components/theater/GhostwriterPanel';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { ChatMessage } from '@/lib/types';

interface GhostwriterBubbleProps {
  message: ChatMessage;
  /** Session bubbles render prose at 14px; story bubbles at 15px. */
  compact?: boolean;
}

/**
 * Doc 17 §Floating Panel + §Selection + §Diff Display. Renders the AI bubble
 * while it is in Ghostwriter mode: a pulsing accent frame, plain-text content
 * with feature-coloured selection, and — once a revision is under review —
 * the word-level diff. Used by both `StoryAIBubble` and `SessionBubble`.
 */
export function GhostwriterBubble({ message, compact = false }: GhostwriterBubbleProps) {
  const gw = useWorkspaceStore((s) => s.ghostwriter);
  const setSelection = useWorkspaceStore((s) => s.setGhostwriterSelection);

  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);

  const phase = gw?.phase ?? null;
  const captureActive = phase === 'selecting' || phase === 'composing';

  // Doc 17 §Selection — capture the in-bubble selection. The content is a
  // single text node, so range offsets map directly to `messages.content`
  // character offsets. Selections outside the bubble are ignored so the
  // stored selection survives the writer clicking into the panel textarea.
  useEffect(() => {
    if (!captureActive || contentEl === null) return;

    function onSelectionChange() {
      const node = contentEl?.firstChild;
      if (!(node instanceof Text)) return;
      const sel = window.getSelection();
      if (sel === null || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const within = range.startContainer === node && range.endContainer === node;
      if (!within) {
        // A collapsed click inside the bubble clears the selection; a
        // selection elsewhere on the page leaves the stored one untouched.
        if (contentEl?.contains(sel.anchorNode) === true && sel.isCollapsed) {
          setSelection(null);
        }
        return;
      }
      if (sel.isCollapsed) {
        setSelection(null);
        return;
      }
      const start = Math.min(range.startOffset, range.endOffset);
      const end = Math.max(range.startOffset, range.endOffset);
      setSelection({
        startOffset: start,
        endOffset: end,
        selectedText: node.data.slice(start, end),
      });
    }

    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [captureActive, contentEl, setSelection]);

  if (gw === null) return null;

  const proseSize = compact ? 'text-[14px]' : 'text-[15px]';

  return (
    <div className="group relative mx-auto w-full max-w-[80%] py-2">
      <div
        ref={setContainerEl}
        className={`gw-active-frame rounded-md border border-[--color-border] bg-[--color-bg-base] p-3 leading-relaxed text-[--color-text-primary] ${proseSize}`}
      >
        {gw.phase === 'reviewing' && gw.diff !== null ? (
          <div className="whitespace-pre-wrap">
            {gw.diff.map((span, i) =>
              span.kind === 'changed' ? (
                <span key={i} className="gw-diff-changed">
                  {span.text}
                </span>
              ) : (
                <span key={i}>{span.text}</span>
              ),
            )}
          </div>
        ) : (
          <div ref={setContentEl} className="gw-selectable whitespace-pre-wrap">
            {message.content}
          </div>
        )}
      </div>
      <GhostwriterPanel bubbleEl={containerEl} />
    </div>
  );
}
