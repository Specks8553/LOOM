import { Banner } from '@/components/theater/Banner';
import { SessionBubbleList } from '@/components/theater/SessionBubble';
import { useModeStore } from '@/stores/modeStore';

import type { ChatMessage, ConversationSession } from '@/lib/types';

interface SessionPartitionProps {
  session: ConversationSession;
  messages: ChatMessage[];
}

/**
 * Doc 23 §Banners + Doc 27 §Partitions. Wraps a session's banner + framed
 * body. Click expands/collapses; the Enter/Exit affordance lives in the
 * bottom action row. Re-entry into an existing session is exclusively via
 * the banner Enter button (Doc 23 §Switcher behaviour).
 */
export function SessionPartition({ session, messages }: SessionPartitionProps) {
  const activeSessionId = useModeStore((s) => s.activeSessionId);
  const setSessionCollapsed = useModeStore((s) => s.setSessionCollapsed);
  const enterSession = useModeStore((s) => s.enterSession);
  const exitSession = useModeStore((s) => s.exitSession);
  const renameSession = useModeStore((s) => s.renameSession);
  const deleteSession = useModeStore((s) => s.deleteSession);

  const expanded = !session.is_collapsed;
  const isActive = activeSessionId === session.id;

  function handleToggle() {
    void setSessionCollapsed(session.id, expanded).catch((e) =>
      console.error('set_session_collapsed failed', e),
    );
  }

  function handleEnter() {
    void enterSession(session).catch((e) => console.error('enter_session failed', e));
  }

  function handleExit() {
    void exitSession().catch((e) => console.error('exit_session failed', e));
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    // Phase 4 minimal context menu — full popover lands with the visual
    // design pass (Phase 12).
    const action = window.prompt(
      `Session "${session.name}". Type: "rename", "enter", "delete", or cancel.`,
      '',
    );
    if (action === null) return;
    const trimmed = action.trim().toLowerCase();
    if (trimmed === 'rename') {
      const next = window.prompt('New session name', session.name);
      if (next === null) return;
      const t = next.trim();
      if (t.length === 0) return;
      void renameSession(session.id, t).catch((err) => console.error('rename_session failed', err));
    } else if (trimmed === 'enter') {
      handleEnter();
    } else if (trimmed === 'delete') {
      if (!window.confirm(`Delete session "${session.name}"? This cannot be undone.`)) {
        return;
      }
      void deleteSession(session.id).catch((err) => console.error('delete_session failed', err));
    }
  }

  const label = `${capitalise(session.kind)} · ${session.name} · ${messages.length} message${
    messages.length === 1 ? '' : 's'
  }`;

  return (
    <Banner
      label={label}
      expanded={expanded}
      active={isActive}
      onToggle={handleToggle}
      onContextMenu={handleContextMenu}
      bottomActions={
        <>
          {isActive ? (
            <button
              type="button"
              onClick={handleExit}
              className="rounded-sm border border-[var(--color-border)] px-3 py-1 text-[11px] text-[var(--color-text-primary)] hover:border-[var(--color-accent)]"
            >
              Exit
            </button>
          ) : (
            <button
              type="button"
              onClick={handleEnter}
              className="rounded-sm bg-[var(--color-accent)] px-3 py-1 text-[11px] font-medium text-white"
            >
              Enter
            </button>
          )}
        </>
      }
    >
      {messages.length === 0 ? (
        <p className="py-2 text-center text-[12px] text-[var(--color-text-muted)]">
          No messages yet.
        </p>
      ) : (
        <SessionBubbleList messages={messages} />
      )}
    </Banner>
  );
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}
