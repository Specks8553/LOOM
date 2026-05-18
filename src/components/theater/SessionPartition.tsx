import { useEffect, useRef, useState } from 'react';

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
 * body. The banner carries a hover action row (Rename / Delete) and a
 * right-click popover (Enter or Exit · Rename · Delete); the Enter/Exit
 * affordance also lives in the expanded bottom row.
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

  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(session.name);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Dismiss the right-click popover on outside-click or Escape.
  useEffect(() => {
    if (menuPos === null) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuPos(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuPos(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuPos]);

  function handleToggle() {
    void setSessionCollapsed(session.id, expanded).catch((e) =>
      console.error('set_session_collapsed failed', e),
    );
  }

  function handleEnter() {
    // One-step entry: expand the partition, then activate the session.
    if (session.is_collapsed) {
      void setSessionCollapsed(session.id, false).catch((e) =>
        console.error('set_session_collapsed failed', e),
      );
    }
    void enterSession(session).catch((e) => console.error('enter_session failed', e));
  }

  function handleExit() {
    void exitSession().catch((e) => console.error('exit_session failed', e));
  }

  function startRename() {
    setMenuPos(null);
    setNameDraft(session.name);
    setRenaming(true);
  }

  function commitRename() {
    const next = nameDraft.trim();
    setRenaming(false);
    if (next.length === 0 || next === session.name) return;
    void renameSession(session.id, next).catch((e) => console.error('rename_session failed', e));
  }

  function handleDelete() {
    setMenuPos(null);
    if (!window.confirm(`Delete session "${session.name}"?\nThis cannot be undone.`)) return;
    void deleteSession(session.id).catch((e) => console.error('delete_session failed', e));
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setMenuPos({ x: e.clientX, y: e.clientY });
  }

  // Inline rename — replaces the banner with a compact editor row.
  if (renaming) {
    return (
      <div className="my-2 flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2">
        <input
          autoFocus
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitRename();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setRenaming(false);
            }
          }}
          className="min-w-0 flex-1 rounded-sm border border-[var(--color-border)] bg-[var(--color-bg-base)] px-2 py-1 text-[12px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
        />
        <button
          type="button"
          onClick={() => setRenaming(false)}
          className="rounded-sm border border-[var(--color-border)] px-3 py-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={commitRename}
          className="rounded-sm bg-[var(--color-accent)] px-3 py-1 text-[11px] font-medium text-[var(--color-text-on-accent)]"
        >
          Save
        </button>
      </div>
    );
  }

  const label = `${capitalise(session.kind)} · ${session.name} · ${messages.length} message${
    messages.length === 1 ? '' : 's'
  }`;

  return (
    <>
      <Banner
        label={label}
        expanded={expanded}
        active={isActive}
        onToggle={handleToggle}
        onContextMenu={handleContextMenu}
        headerActions={
          <div className="pointer-events-none flex gap-0.5 opacity-0 transition-opacity duration-150 group-hover/banner:pointer-events-auto group-hover/banner:opacity-100">
            <SessionActionButton onClick={startRename}>Rename</SessionActionButton>
            <SessionActionButton destructive onClick={handleDelete}>
              Delete
            </SessionActionButton>
          </div>
        }
        bottomActions={
          isActive ? (
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
              className="rounded-sm bg-[var(--color-accent)] px-3 py-1 text-[11px] font-medium text-[var(--color-text-on-accent)]"
            >
              Enter
            </button>
          )
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
      {menuPos !== null && (
        <div
          ref={menuRef}
          role="menu"
          style={{ position: 'fixed', top: menuPos.y, left: menuPos.x, zIndex: 50 }}
          className="min-w-[170px] rounded-md border border-[var(--color-border)] bg-[var(--color-bg-base)] py-1 text-[12px] text-[var(--color-text-primary)] shadow-lg"
        >
          {isActive ? (
            <MenuItem
              onClick={() => {
                setMenuPos(null);
                handleExit();
              }}
            >
              Exit session
            </MenuItem>
          ) : (
            <MenuItem
              onClick={() => {
                setMenuPos(null);
                handleEnter();
              }}
            >
              Enter session
            </MenuItem>
          )}
          <MenuItem onClick={startRename}>Rename…</MenuItem>
          <MenuItem destructive onClick={handleDelete}>
            Delete session
          </MenuItem>
        </div>
      )}
    </>
  );
}

function SessionActionButton({
  children,
  onClick,
  destructive = false,
}: {
  children: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[4px] px-2 py-[3px] text-[11px] text-[var(--color-text-muted)] transition-colors duration-150 ${
        destructive ? 'hover:text-[var(--color-error)]' : 'hover:text-[var(--color-accent-text)]'
      }`}
    >
      {children}
    </button>
  );
}

function MenuItem({
  children,
  onClick,
  destructive = false,
}: {
  children: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`block w-full px-3 py-1.5 text-left hover:bg-[var(--color-bg-elevated)] ${
        destructive ? 'text-[var(--color-error)]' : ''
      }`}
    >
      {children}
    </button>
  );
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}
