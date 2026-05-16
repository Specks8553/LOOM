import { useEffect, useRef, useState } from 'react';

import { useCachedMessageGuard } from '@/hooks/useCachedMessageGuard';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { ChatMessage } from '@/lib/types';

/**
 * Doc 28 §Affordance. The per-bubble feedback strip — the sole feedback
 * affordance in v2.0. Renders nothing when feedback is empty and the editor
 * is closed; a single-line preview when feedback is non-empty; an inline
 * editor when this bubble's edit is open.
 *
 * The textarea value is local component state (Doc 28 §Frontend State) —
 * only the *fact* of editing lives on `workspaceStore.feedbackEditingMessageId`.
 */
export function FeedbackStrip({ message }: { message: ChatMessage }) {
  const editingId = useWorkspaceStore((s) => s.feedbackEditingMessageId);
  const beginEdit = useWorkspaceStore((s) => s.beginFeedbackEdit);
  const cancelEdit = useWorkspaceStore((s) => s.cancelFeedbackEdit);
  const commitEdit = useWorkspaceStore((s) => s.commitFeedbackEdit);

  const { modal: cachedModal, guard } = useCachedMessageGuard();

  const saved = message.user_feedback ?? '';
  const isEditing = editingId === message.id;

  const [value, setValue] = useState(saved);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Seed the textarea with the last-saved value each time the editor opens.
  useEffect(() => {
    if (isEditing) {
      setValue(message.user_feedback ?? '');
      textareaRef.current?.focus();
    }
  }, [isEditing, message.user_feedback]);

  async function handleApply() {
    const ok = await guard(message, 'edit');
    if (!ok) return;
    try {
      await commitEdit(message.id, value.trim());
    } catch (e) {
      console.error('update_feedback failed', e);
      void import('sonner').then(({ toast }) => {
        toast.error("Couldn't save feedback — try again.");
      });
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      // Doc 11 Escape Chain slot 5 — cancel the edit, let no other slot fire.
      e.stopPropagation();
      e.preventDefault();
      cancelEdit();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void handleApply();
    }
  }

  if (isEditing) {
    return (
      <div className="mt-1 w-full">
        <div className="rounded-md border border-[--color-border] bg-[--color-bg-soft] p-2">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            placeholder="Note for the AI about this response…"
            className="max-h-[140px] w-full resize-none rounded-sm border border-[--color-border] bg-[--color-bg] p-2 text-[12px] text-[--color-text-primary] outline-none focus:border-[--color-feedback]"
          />
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[10px] text-[--color-text-muted]">
              Injected into AI context for future messages.
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => cancelEdit()}
                className="rounded-sm border border-[--color-border] px-2 py-0.5 text-[11px] text-[--color-text-muted] hover:text-[--color-text-primary]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleApply()}
                className="rounded-sm bg-[--color-accent] px-2 py-0.5 text-[11px] font-medium text-white"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
        {cachedModal}
      </div>
    );
  }

  if (saved.length === 0) return null;

  return (
    <button
      type="button"
      onClick={() => beginEdit(message.id)}
      title="Click to edit feedback"
      className="mt-1 block w-full cursor-text truncate border-l-2 border-[--color-feedback] bg-[--color-feedback-subtle] py-1 pl-2 pr-3 text-left text-[12px] text-[--color-text-muted] hover:text-[--color-text-primary]"
    >
      {saved}
    </button>
  );
}
