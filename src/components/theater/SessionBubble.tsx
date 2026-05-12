import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { ChatMessage } from '@/lib/types';

interface SessionBubbleProps {
  message: ChatMessage;
  /** True if this is the in-flight model placeholder for an active session
   *  send (drives the streaming caret + suppresses the action row). */
  streaming?: boolean;
}

/**
 * Doc 27 §Session bubbles. Handover and consulting both use a single
 * free-text field on input and render as plain prose. Visual frame comes
 * from the surrounding `SessionPartition`, not from per-bubble styling.
 *
 * Edit/delete on session bubbles is out of scope for Phase 4 — Doc 23's
 * session-message edit/regenerate path lives on `commands/modes.rs` and is
 * structurally identical to story-mode but scoped to a session_id. Phase 4
 * ships read-only session bubbles; full affordances land alongside the
 * other refinements in a later pass.
 */
export function SessionBubble({ message, streaming = false }: SessionBubbleProps) {
  const isUser = message.role === 'user';
  const showThinkingHint = streaming && message.content.length === 0;

  return (
    <div className="mx-auto w-full max-w-[80%] py-2">
      <div
        className={`rounded-md border border-[--color-border] p-3 text-[14px] leading-relaxed ${
          isUser
            ? 'bg-[--color-bg-soft] text-[--color-text-primary]'
            : 'bg-[--color-bg] text-[--color-text-primary]'
        }`}
      >
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
      </div>
    </div>
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
