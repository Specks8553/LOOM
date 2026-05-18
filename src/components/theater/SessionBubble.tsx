import { GhostwriterBubble } from '@/components/theater/GhostwriterBubble';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { ChatMessage } from '@/lib/types';

interface SessionBubbleProps {
  message: ChatMessage;
  /** True if this is the in-flight model placeholder for an active session
   *  send (drives the streaming caret + suppresses the action row). */
  streaming?: boolean;
}

/** Doc 17 §Revert — count accepted edits stored in `ghostwriter_history`. */
function ghostwriterHistoryLength(historyJson: string): number {
  try {
    const parsed: unknown = JSON.parse(historyJson);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Doc 27 §Session bubbles. Handover and consulting both use a single
 * free-text field on input and render as plain prose. Visual frame comes
 * from the surrounding `SessionPartition`, not from per-bubble styling.
 *
 * Ghostwriter (Doc 17) is available on session AI bubbles — the action row
 * exposes it (and Revert when prior edits exist); the bubble delegates to
 * `GhostwriterBubble` while in mode. Session-message edit/regenerate remains
 * out of scope (Doc 23's session edit path lands in a later pass).
 */
export function SessionBubble({ message, streaming = false }: SessionBubbleProps) {
  const ghostwriterActiveId = useWorkspaceStore((s) => s.ghostwriter?.activeMessageId ?? null);
  const enterGhostwriter = useWorkspaceStore((s) => s.enterGhostwriter);
  const revertGhostwriter = useWorkspaceStore((s) => s.revertGhostwriter);
  const isGenerating = useWorkspaceStore((s) => s.isGenerating);

  const isUser = message.role === 'user';
  const showThinkingHint = streaming && message.content.length === 0;

  if (ghostwriterActiveId === message.id) {
    return <GhostwriterBubble message={message} compact />;
  }

  const isBlocks = message.content_type === 'blocks';
  const historyLen = ghostwriterHistoryLength(message.ghostwriter_history);
  const showActions = !isUser && !streaming;

  function handleGhostwriter() {
    const cur = useWorkspaceStore.getState().ghostwriter;
    if (cur !== null && cur.activeMessageId !== message.id && cur.phase === 'reviewing') {
      if (!window.confirm('Discard pending Ghostwriter changes?')) return;
    }
    enterGhostwriter(message.id);
  }

  return (
    <div className="group relative mx-auto w-full max-w-[80%] py-2">
      <div
        className={`rounded-md border border-[var(--color-border)] p-3 text-[14px] leading-relaxed ${
          isUser
            ? 'bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]'
            : 'bg-[var(--color-bg-base)] text-[var(--color-text-primary)]'
        }`}
      >
        {showThinkingHint ? (
          <span className="text-[var(--color-text-muted)]">…</span>
        ) : (
          <div className="whitespace-pre-wrap">{message.content}</div>
        )}
        {streaming && message.content.length > 0 && (
          <span
            aria-hidden
            className="ml-0.5 inline-block h-[1em] w-[2px] animate-pulse align-middle bg-[var(--color-accent)]"
          />
        )}
      </div>
      {showActions && (
        <div className="pointer-events-none absolute -top-1 right-0 flex gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
          {!isBlocks && (
            <SessionActionButton onClick={handleGhostwriter}>✦ Ghostwriter</SessionActionButton>
          )}
          {historyLen > 0 && (
            <SessionActionButton
              disabled={isGenerating}
              onClick={() => void revertGhostwriter(message.id)}
            >
              Revert
            </SessionActionButton>
          )}
        </div>
      )}
    </div>
  );
}

function SessionActionButton({
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
      onClick={onClick}
      disabled={disabled}
      className="rounded-sm border border-[var(--color-border)] bg-[var(--color-bg-base)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** Helper for the partition body to render in-order user/model bubbles
 *  with the in-flight streaming marker applied to the matching id. */
export function SessionBubbleList({ messages }: { messages: ChatMessage[] }) {
  const currentModelMessageId = useWorkspaceStore((s) => s.currentModelMessageId);
  const isGenerating = useWorkspaceStore((s) => s.isGenerating);
  return (
    <>
      {messages.map((m) => (
        <SessionBubble
          key={m.id}
          message={m}
          streaming={isGenerating && m.id === currentModelMessageId}
        />
      ))}
    </>
  );
}
