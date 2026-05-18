import { useEffect, useState } from 'react';

import { useWorkspaceStore } from '@/stores/workspaceStore';

/**
 * Doc 23 §Handover input shape + §Consulting input shape.
 *
 * Single free-text field. Required to send (Send disabled until non-empty).
 * Handover drafts are session-local in v2.0; consulting drafts are explicitly
 * not persisted (Doc 23 §What consulting does not have — "closing the app or
 * switching modes mid-typing loses the unsent text").
 *
 * Send swaps to Cancel during `isGenerating`. Ctrl/Cmd+Enter submits.
 */
interface Props {
  sessionId: string;
  /** Label on the Send button — defaults to 'Send'. */
  submitLabel?: string;
  /** Placeholder text — varies by mode (Doc 23 calls out the framing). */
  placeholder?: string;
}

export function SessionInputArea({ sessionId, submitLabel, placeholder }: Props) {
  const isGenerating = useWorkspaceStore((s) => s.isGenerating);
  const sendSession = useWorkspaceStore((s) => s.sendSession);
  const cancel = useWorkspaceStore((s) => s.cancel);

  const [text, setText] = useState('');

  // Discard the local buffer if the active session changes (switching
  // between two handover sessions, for example).
  useEffect(() => {
    setText('');
  }, [sessionId]);

  const canSubmit = text.trim().length > 0;

  function handleSubmit() {
    if (!canSubmit || isGenerating) return;
    const payload = text;
    setText('');
    void sendSession(sessionId, payload);
  }

  function handleCancel() {
    if (isGenerating) void cancel();
  }

  return (
    <div className="flex flex-col gap-2 bg-[--color-bg-elevated] px-3 pb-3 pt-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        placeholder={placeholder}
        rows={3}
        className="w-full resize-y rounded-sm border border-[--color-border] bg-[--color-bg-base] p-2 text-[14px] text-[--color-text-primary] outline-none focus:border-[--color-accent]"
      />
      <div className="flex items-center justify-end gap-2">
        {isGenerating ? (
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-sm border border-[--color-border] bg-[--color-bg-base] px-3 py-1 text-[12px] text-[--color-text-primary] hover:border-[--color-accent]"
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="rounded-sm bg-[--color-accent] px-3 py-1 text-[12px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitLabel ?? 'Send'}
          </button>
        )}
      </div>
    </div>
  );
}
