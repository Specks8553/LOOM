import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useCachedMessageGuard } from '@/hooks/useCachedMessageGuard';
import { useWorkspaceStore } from '@/stores/workspaceStore';

const PANEL_WIDTH = 300;
const VIEWPORT_PADDING = 16;
const GUTTER = 16;

interface PanelPosition {
  top: number;
  left: number;
  /** False when the active bubble has scrolled fully out of view. */
  visible: boolean;
}

/**
 * Doc 17 §Floating Panel. The Ghostwriter UI — a panel pinned to the right of
 * the active AI bubble. Renders one of four phase states. Positioned `fixed`
 * via a portal so it tracks the viewport and is unaffected by the Theater's
 * scroll container.
 */
export function GhostwriterPanel({ bubbleEl }: { bubbleEl: HTMLElement | null }) {
  const gw = useWorkspaceStore((s) => s.ghostwriter);
  const messages = useWorkspaceStore((s) => s.messages);
  const isGenerating = useWorkspaceStore((s) => s.isGenerating);
  const setInstruction = useWorkspaceStore((s) => s.setGhostwriterInstruction);
  const generate = useWorkspaceStore((s) => s.generateGhostwriter);
  const cancelGen = useWorkspaceStore((s) => s.cancelGhostwriterGeneration);
  const accept = useWorkspaceStore((s) => s.acceptGhostwriter);
  const reject = useWorkspaceStore((s) => s.rejectGhostwriter);
  const exit = useWorkspaceStore((s) => s.exitGhostwriter);

  const { modal: cachedModal, guard } = useCachedMessageGuard();

  const panelRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [pos, setPos] = useState<PanelPosition | null>(null);

  const phase = gw?.phase ?? null;

  // --- Position tracking (Doc 17 §Vertical clamping) ---
  useEffect(() => {
    if (bubbleEl === null) return;
    let raf = 0;
    const recompute = () => {
      const b = bubbleEl.getBoundingClientRect();
      const panelH = panelRef.current?.offsetHeight ?? 160;
      const offscreen = b.bottom < 0 || b.top > window.innerHeight;
      const top = Math.min(Math.max(VIEWPORT_PADDING, b.top), Math.max(b.top, b.bottom - panelH));
      let left = b.right + GUTTER;
      if (left + PANEL_WIDTH > window.innerWidth - 8) {
        left = window.innerWidth - PANEL_WIDTH - 8;
      }
      setPos({ top, left, visible: !offscreen });
    };
    const onScrollResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(recompute);
    };
    recompute();
    window.addEventListener('scroll', onScrollResize, { capture: true, passive: true });
    window.addEventListener('resize', onScrollResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScrollResize, { capture: true });
      window.removeEventListener('resize', onScrollResize);
    };
  }, [bubbleEl, phase]);

  // --- Escape chain (Doc 17 §Escape Chain) ---
  useEffect(() => {
    if (gw === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      if (gw.phase === 'generating') {
        void cancelGen();
        exit();
      } else if (gw.phase === 'reviewing') {
        if (window.confirm('Discard pending Ghostwriter changes?')) exit();
      } else {
        exit();
      }
    };
    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true });
  }, [gw, cancelGen, exit]);

  // Autofocus the instruction textarea when the panel enters `composing`.
  useEffect(() => {
    if (phase === 'composing') textareaRef.current?.focus();
  }, [phase]);

  if (gw === null) return null;

  const instructionReady = gw.instruction.trim().length > 0;

  async function handleAccept() {
    if (gw === null) return;
    const msg = messages.find((m) => m.id === gw.activeMessageId);
    if (msg !== undefined) {
      const ok = await guard(msg, 'edit');
      if (!ok) return;
    }
    await accept();
  }

  function handleCancel() {
    if (gw === null) return;
    if (gw.phase === 'generating') {
      void cancelGen();
    } else {
      exit();
    }
  }

  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Ghostwriter"
      style={{
        position: 'fixed',
        top: pos?.top ?? VIEWPORT_PADDING,
        left: pos?.left ?? 0,
        width: PANEL_WIDTH,
        visibility: pos !== null && pos.visible ? 'visible' : 'hidden',
        zIndex: 40,
      }}
      className="flex flex-col gap-2 rounded-md border border-[--color-ghostwriter] bg-[--color-bg-base] p-3 shadow-lg"
    >
      <header className="text-[11px] font-medium uppercase tracking-[0.08em] text-[--color-ghostwriter]">
        {headerText(gw.phase)}
      </header>

      {gw.phase === 'reviewing' ? (
        <p className="text-[12px] leading-relaxed text-[--color-text-muted]">
          Changed sections are highlighted.
        </p>
      ) : (
        <>
          {gw.phase === 'selecting' && (
            <p className="text-[12px] leading-relaxed text-[--color-text-muted]">
              Select at least one word in the message…
            </p>
          )}
          <textarea
            ref={textareaRef}
            value={gw.instruction}
            onChange={(e) => setInstruction(e.target.value)}
            disabled={gw.phase !== 'composing'}
            placeholder="How should this passage change?"
            className="min-h-[60px] w-full resize-y rounded-sm border border-[--color-border] bg-[--color-bg-elevated] p-2 text-[13px] text-[--color-text-primary] outline-none focus:border-[--color-ghostwriter] disabled:opacity-50"
          />
        </>
      )}

      <div className="flex justify-end gap-2">
        {gw.phase === 'reviewing' ? (
          <>
            <button
              type="button"
              onClick={() => reject()}
              className="rounded-sm border border-[--color-border] px-2 py-1 text-[12px] text-[--color-text-muted] hover:text-[--color-text-primary]"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={() => void handleAccept()}
              className="rounded-sm bg-[--color-ghostwriter] px-2 py-1 text-[12px] font-medium text-[--color-bg-base] hover:bg-[--color-ghostwriter-hover]"
            >
              Accept ✓
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-sm border border-[--color-border] px-2 py-1 text-[12px] text-[--color-text-muted] hover:text-[--color-text-primary]"
            >
              Cancel
            </button>
            {gw.phase !== 'generating' && (
              <button
                type="button"
                onClick={() => void generate()}
                disabled={gw.phase !== 'composing' || !instructionReady || isGenerating}
                title={isGenerating ? 'Generation already in progress' : undefined}
                className="rounded-sm bg-[--color-ghostwriter] px-2 py-1 text-[12px] font-medium text-[--color-bg-base] hover:bg-[--color-ghostwriter-hover] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Generate ✦
              </button>
            )}
          </>
        )}
      </div>

      {cachedModal}
    </div>
  );

  return createPortal(panel, document.body);
}

function headerText(phase: 'selecting' | 'composing' | 'generating' | 'reviewing'): string {
  switch (phase) {
    case 'generating':
      return '✦ Ghostwriter — Generating…';
    case 'reviewing':
      return '✦ Ghostwriter — Review changes';
    default:
      return '✦ Ghostwriter';
  }
}
