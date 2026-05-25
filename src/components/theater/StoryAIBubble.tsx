import {
  Copy,
  Flag,
  MessageSquarePlus,
  Pencil,
  RotateCw,
  Sparkles,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

import { useContextMenu } from '@/components/shared/ContextMenu';
import { BubbleActionRow, StreamingDots } from '@/components/theater/BubbleActions';
import { FeedbackStrip } from '@/components/theater/FeedbackStrip';
import { GhostwriterBubble } from '@/components/theater/GhostwriterBubble';
import { MarkDot } from '@/components/theater/MarkDot';
import { useMarkHighlight } from '@/components/theater/markHighlight';
import { useCachedMessageGuard } from '@/hooks/useCachedMessageGuard';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { MenuItem } from '@/components/shared/ContextMenu';
import type { BubbleAction } from '@/components/theater/BubbleActions';
import type { ChatMessage } from '@/lib/types';

/** Doc 17 §Revert — count accepted edits stored in `ghostwriter_history`. */
function ghostwriterHistoryLength(historyJson: string): number {
  try {
    const parsed: unknown = JSON.parse(historyJson);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

interface StoryAIBubbleProps {
  message: ChatMessage;
  /** True if this bubble is the in-flight model placeholder receiving
   *  streaming chunks. Drives the streaming caret + suppresses the action
   *  row. */
  streaming?: boolean;
  /** True if this is the most-recent model message — enables the
   *  "Regenerate" affordance per Doc 15. */
  isLast?: boolean;
}

/**
 * Doc 27 §Story AI bubble. Plain prose rendered with `white-space: pre-wrap`
 * so streaming chunks land in their natural shape. Markdown rendering per
 * Doc 09 lands in a later phase.
 */
export function StoryAIBubble({ message, streaming = false, isLast = false }: StoryAIBubbleProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const isGenerating = useWorkspaceStore((s) => s.isGenerating);
  const updateModelContent = useWorkspaceStore((s) => s.updateModelContent);
  const regenerateLast = useWorkspaceStore((s) => s.regenerateLast);
  const deleteExchange = useWorkspaceStore((s) => s.deleteExchange);
  const createCheckpoint = useWorkspaceStore((s) => s.createCheckpoint);
  const checkpoints = useWorkspaceStore((s) => s.checkpoints);
  const ghostwriterActiveId = useWorkspaceStore((s) => s.ghostwriter?.activeMessageId ?? null);
  const enterGhostwriter = useWorkspaceStore((s) => s.enterGhostwriter);
  const revertGhostwriter = useWorkspaceStore((s) => s.revertGhostwriter);
  const beginFeedbackEdit = useWorkspaceStore((s) => s.beginFeedbackEdit);
  const cancelFeedbackEdit = useWorkspaceStore((s) => s.cancelFeedbackEdit);
  const allMarks = useWorkspaceStore((s) => s.marks);
  const marks = useMemo(
    () => allMarks.filter((m) => m.message_id === message.id),
    [allMarks, message.id],
  );
  const contentRef = useRef<HTMLDivElement>(null);

  const { modal: revertGuardModal, guard: revertGuard } = useCachedMessageGuard();

  const isGhostwriterActive = ghostwriterActiveId === message.id;
  const isBlocks = message.content_type === 'blocks';

  // Doc 30 §5 — paint this AI bubble's non-orphaned marks in place (offset-based).
  useMarkHighlight(message.id, contentRef, isBlocks ? [] : marks, true);
  const historyLen = ghostwriterHistoryLength(message.ghostwriter_history);
  const hasFeedback = (message.user_feedback ?? '').length > 0;

  const { showContextMenu } = useContextMenu();

  async function handleInsertCheckpoint() {
    // Suggest "Chapter N" where N = (existing non-start checkpoints) + 2.
    const userCpCount = checkpoints.filter((c) => !c.is_start).length;
    const suggestion = `Chapter ${userCpCount + 2}`;
    const name = window.prompt('New chapter name:', suggestion);
    if (name === null) return;
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    try {
      await createCheckpoint(message.id, trimmed);
    } catch (e) {
      console.error('createCheckpoint failed', e);
    }
  }

  async function handleEditSubmit() {
    setEditing(false);
    await updateModelContent(message.id, editValue);
  }

  async function handleRegenerate() {
    await regenerateLast();
  }

  async function handleDelete() {
    if (!window.confirm('Delete this exchange?\nThis cannot be undone in v2.0.')) return;
    await deleteExchange(message.id);
  }

  function handleGhostwriter() {
    // Doc 17 §One-bubble-at-a-time — switching off a bubble with a pending
    // diff under review needs an explicit discard confirmation.
    const cur = useWorkspaceStore.getState().ghostwriter;
    if (cur !== null && cur.activeMessageId !== message.id && cur.phase === 'reviewing') {
      if (!window.confirm('Discard pending Ghostwriter changes?')) return;
    }
    enterGhostwriter(message.id);
  }

  async function handleRevert() {
    const ok = await revertGuard(message, 'edit');
    if (!ok) return;
    await revertGhostwriter(message.id);
  }

  function handleFeedback() {
    // Toggle: a second click on a bubble already in feedback edit closes it.
    const editingId = useWorkspaceStore.getState().feedbackEditingMessageId;
    if (editingId === message.id) {
      cancelFeedbackEdit();
    } else {
      beginFeedbackEdit(message.id);
    }
  }

  // Streaming placeholder with empty content yet — show a subtle "thinking" hint.
  const showThinkingHint = streaming && message.content.length === 0;
  const showStoppedBadge =
    !streaming &&
    message.finish_reason !== null &&
    message.finish_reason !== 'STOP' &&
    message.finish_reason !== '';

  function handleCopy() {
    void navigator.clipboard.writeText(message.content);
  }

  function handleContextMenu(e: React.MouseEvent) {
    if (streaming || editing) return;
    showContextMenu(e, buildMenuItems());
  }

  if (isGhostwriterActive) {
    return <GhostwriterBubble message={message} />;
  }

  return (
    <div className="group w-full max-w-[80%] py-2" onContextMenu={handleContextMenu}>
      <div className="relative rounded-bubble border border-[var(--color-border-subtle)] bg-[var(--bubble-ai-bg)] px-5 py-4 font-theater-body text-[15px] leading-[1.7] text-[var(--color-text-primary)]">
        {editing ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="min-h-[120px] w-full resize-y rounded-sm border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2 text-[14px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-sm border border-[var(--color-border)] px-2 py-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleEditSubmit()}
                className="rounded-sm bg-[var(--color-accent)] px-2 py-1 text-[12px] text-white"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <>
            {!showThinkingHint && (
              <div
                ref={contentRef}
                data-loom-selectable={isBlocks ? undefined : message.id}
                data-loom-bubble-kind={isBlocks ? undefined : 'story-ai'}
                className="whitespace-pre-wrap"
              >
                {message.content}
              </div>
            )}
            {streaming && <StreamingDots />}
          </>
        )}
        {showStoppedBadge && (
          <div className="mt-2 text-[11px] uppercase tracking-wider text-[var(--color-text-muted)]">
            ⚠ Stopped · {message.finish_reason}
          </div>
        )}
        {!isBlocks && !streaming && !editing && <MarkDot marks={marks} />}
      </div>
      {!isBlocks && !streaming && <FeedbackStrip message={message} />}
      {!editing && !streaming && <BubbleActionRow align="left" actions={actionRow()} />}
      {revertGuardModal}
    </div>
  );

  /** Doc 27 §AI bubble — below-bubble hover action row. */
  function actionRow(): BubbleAction[] {
    const actions: BubbleAction[] = [];
    if (!isBlocks) {
      actions.push({ icon: '✦', label: 'Ghostwriter', onClick: handleGhostwriter });
      actions.push({
        icon: '◎',
        label: 'Feedback',
        active: hasFeedback,
        onClick: handleFeedback,
      });
    }
    if (historyLen > 0) {
      actions.push({
        icon: '↺',
        label: 'Revert',
        disabled: isGenerating,
        onClick: () => void handleRevert(),
      });
    }
    actions.push({
      icon: '✎',
      label: 'Edit',
      disabled: isGenerating,
      onClick: () => {
        setEditValue(message.content);
        setEditing(true);
      },
    });
    if (isLast) {
      actions.push({
        icon: '⟳',
        label: 'Regenerate',
        disabled: isGenerating,
        onClick: () => void handleRegenerate(),
      });
    }
    actions.push({
      icon: '×',
      label: 'Delete',
      destructive: true,
      disabled: isGenerating,
      onClick: () => void handleDelete(),
    });
    return actions;
  }

  /**
   * Doc 11 §Menu contents by target — the right-click superset. Shares every
   * handler with `actionRow()`; adds the menu-only actions (Insert checkpoint,
   * Copy text). `blocks` content drops Ghostwriter / Feedback.
   */
  function buildMenuItems(): MenuItem[] {
    const sep: MenuItem = { label: '', separator: true, onClick: () => {} };
    const items: MenuItem[] = [];
    if (!isBlocks) {
      items.push({ label: 'Ghostwriter…', icon: Sparkles, onClick: handleGhostwriter });
      items.push({
        label: hasFeedback ? 'Edit feedback' : 'Add feedback',
        icon: MessageSquarePlus,
        onClick: handleFeedback,
      });
      items.push(sep);
    }
    items.push({
      label: 'Edit',
      icon: Pencil,
      disabled: isGenerating,
      onClick: () => {
        setEditValue(message.content);
        setEditing(true);
      },
    });
    if (isLast) {
      items.push({
        label: 'Regenerate',
        icon: RotateCw,
        disabled: isGenerating,
        onClick: () => void handleRegenerate(),
      });
    }
    items.push({
      label: 'Insert checkpoint here',
      icon: Flag,
      disabled: isGenerating,
      onClick: () => void handleInsertCheckpoint(),
    });
    items.push({ label: 'Copy text', icon: Copy, onClick: handleCopy });
    if (historyLen > 0) {
      items.push(sep);
      items.push({
        label: 'Revert Ghostwriter',
        icon: Undo2,
        disabled: isGenerating,
        onClick: () => void handleRevert(),
      });
    }
    items.push(sep);
    items.push({
      label: 'Delete exchange',
      icon: Trash2,
      destructive: true,
      disabled: isGenerating,
      onClick: () => void handleDelete(),
    });
    return items;
  }
}
