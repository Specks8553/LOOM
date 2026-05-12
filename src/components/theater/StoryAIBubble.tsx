import { useState } from 'react';

import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { ChatMessage } from '@/lib/types';

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

  // Streaming placeholder with empty content yet — show a subtle "thinking" hint.
  const showThinkingHint = streaming && message.content.length === 0;
  const showStoppedBadge =
    !streaming &&
    message.finish_reason !== null &&
    message.finish_reason !== 'STOP' &&
    message.finish_reason !== '';

  return (
    <div className="group relative mx-auto w-full max-w-[80%] py-2">
      <div className="rounded-md border border-[--color-border] bg-[--color-bg] p-3 text-[15px] leading-relaxed text-[--color-text-primary]">
        {editing ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="min-h-[120px] w-full resize-y rounded-sm border border-[--color-border] bg-[--color-bg-soft] p-2 text-[14px] text-[--color-text-primary] outline-none focus:border-[--color-accent]"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-sm border border-[--color-border] px-2 py-1 text-[12px] text-[--color-text-muted] hover:text-[--color-text-primary]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleEditSubmit()}
                className="rounded-sm bg-[--color-accent] px-2 py-1 text-[12px] text-white"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <>
            {showThinkingHint ? (
              <span className="text-[--color-text-muted]">…</span>
            ) : (
              <div className="whitespace-pre-wrap">{message.content}</div>
            )}
            {streaming && message.content.length > 0 && (
              <span
                aria-hidden
                className="ml-0.5 inline-block h-[1em] w-[2px] animate-pulse align-middle bg-[--color-accent]"
              />
            )}
          </>
        )}
        {showStoppedBadge && (
          <div className="mt-2 text-[11px] uppercase tracking-wider text-[--color-text-muted]">
            ⚠ Stopped · {message.finish_reason}
          </div>
        )}
      </div>
      {!editing && !streaming && (
        <div className="pointer-events-none absolute -top-1 right-0 flex gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
          <ActionButton
            disabled={isGenerating}
            onClick={() => {
              setEditValue(message.content);
              setEditing(true);
            }}
          >
            Edit
          </ActionButton>
          {isLast && (
            <ActionButton disabled={isGenerating} onClick={() => void handleRegenerate()}>
              Regenerate
            </ActionButton>
          )}
          <ActionButton disabled={isGenerating} onClick={() => void handleDelete()}>
            Delete
          </ActionButton>
        </div>
      )}
    </div>
  );
}

function ActionButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-sm border border-[--color-border] bg-[--color-bg] px-2 py-0.5 text-[11px] text-[--color-text-muted] hover:text-[--color-text-primary] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}
