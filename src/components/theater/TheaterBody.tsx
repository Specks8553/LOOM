import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { InputArea } from '@/components/theater/InputArea';
import { ModeSwitcher } from '@/components/theater/ModeSwitcher';
import { SessionInputArea } from '@/components/theater/SessionInputArea';
import { SessionPartition } from '@/components/theater/SessionPartition';
import { StoryAIBubble } from '@/components/theater/StoryAIBubble';
import { StoryUserBubble } from '@/components/theater/StoryUserBubble';
import { useModeStore } from '@/stores/modeStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { ChatMessage, ConversationSession } from '@/lib/types';

const NEAR_BOTTOM_PX = 32;

/**
 * Doc 27 §Scroll surface + Doc 15 §Theater Scrolling + Doc 23 §Banners.
 *
 * Story messages render inline; session messages render inside their
 * `SessionPartition` anchored at `entry_message_id`'s position (or at the
 * top of the timeline when the entry is null / missing).
 *
 * Scroll rules implemented (Doc 15):
 *   1. On story open: scroll to bottom.
 *   2. On user-bubble appearance after Send: scroll to bottom (auto-follow).
 *   3. Auto-follow during streaming.
 *   4. User scrolls up → pause auto-follow + show "↓ New content" button;
 *      re-engages within NEAR_BOTTOM_PX of the bottom.
 */
export function TheaterBody() {
  const activeStoryId = useWorkspaceStore((s) => s.activeStoryId);
  const messages = useWorkspaceStore((s) => s.messages);
  const isGenerating = useWorkspaceStore((s) => s.isGenerating);
  const currentModelMessageId = useWorkspaceStore((s) => s.currentModelMessageId);
  const sessions = useModeStore((s) => s.sessions);
  const activeMode = useModeStore((s) => s.activeMode);
  const activeSessionId = useModeStore((s) => s.activeSessionId);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoFollow, setAutoFollow] = useState(true);

  const renderItems = useMemo(() => buildRenderItems(messages, sessions), [messages, sessions]);

  // Rule 1: scroll-to-bottom on story open.
  useLayoutEffect(() => {
    if (activeStoryId === null) return;
    const el = scrollRef.current;
    if (el === null) return;
    el.scrollTop = el.scrollHeight;
    setAutoFollow(true);
  }, [activeStoryId]);

  // Rules 2 + 3: auto-follow during streaming. Coalesced via rAF to avoid
  // per-chunk scroll thrash (Doc 15).
  useEffect(() => {
    if (!autoFollow) return;
    const el = scrollRef.current;
    if (el === null) return;
    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [autoFollow, messages]);

  // Rule 4: pause auto-follow when the user scrolls up; re-engage within
  // NEAR_BOTTOM_PX of the bottom.
  function handleScroll() {
    const el = scrollRef.current;
    if (el === null) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom <= NEAR_BOTTOM_PX;
    if (nearBottom !== autoFollow) setAutoFollow(nearBottom);
  }

  function jumpToBottom() {
    const el = scrollRef.current;
    if (el === null) return;
    el.scrollTop = el.scrollHeight;
    setAutoFollow(true);
  }

  const lastStoryModelId = lastStoryModelMessageId(messages);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {activeStoryId !== null && <ModeSwitcher storyId={activeStoryId} />}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="relative flex-1 overflow-y-auto px-4 py-3"
      >
        {activeStoryId === null ? (
          <NoStorySelected />
        ) : renderItems.length === 0 ? (
          <BeginYourStory />
        ) : (
          <ul role="list" className="flex flex-col">
            {renderItems.map((item) => {
              if (item.kind === 'story') {
                const m = item.message;
                return (
                  <li key={m.id}>
                    {m.role === 'user' ? (
                      <StoryUserBubble message={m} />
                    ) : (
                      <StoryAIBubble
                        message={m}
                        streaming={isGenerating && m.id === currentModelMessageId}
                        isLast={m.id === lastStoryModelId}
                      />
                    )}
                  </li>
                );
              }
              return (
                <li key={`session-${item.session.id}`}>
                  <SessionPartition session={item.session} messages={item.messages} />
                </li>
              );
            })}
          </ul>
        )}
        {!autoFollow && isGenerating && (
          <button
            type="button"
            onClick={jumpToBottom}
            className="sticky bottom-2 ml-auto block rounded-full border border-[--color-border] bg-[--color-bg-soft] px-3 py-1 text-[12px] text-[--color-text-primary] shadow hover:border-[--color-accent]"
          >
            ↓ New content
          </button>
        )}
      </div>
      {activeStoryId !== null && renderInput()}
    </div>
  );

  function renderInput() {
    if (activeMode === 'story' || activeSessionId === null) {
      return <InputArea />;
    }
    // Doc 23 §Handover input shape / §Consulting input shape.
    const placeholder =
      activeMode === 'handover'
        ? 'What should the analyst focus on?'
        : 'Anything about the story you want to discuss…';
    return <SessionInputArea sessionId={activeSessionId} placeholder={placeholder} />;
  }
}

// --- Render-item construction ----------------------------------------------

type RenderItem =
  | { kind: 'story'; message: ChatMessage; sortKey: string }
  | {
      kind: 'session';
      session: ConversationSession;
      messages: ChatMessage[];
      sortKey: string;
    };

/**
 * Build the interleaved render list:
 *   - Story-kind messages render inline.
 *   - Session partitions render once each, anchored at their
 *     `entry_message_id`'s `created_at` (immediately *after* the anchor
 *     message — Doc 23 §Position). If the anchor message is missing or
 *     null, the session anchors at its own `created_at` so banners survive
 *     anchor-message hard-deletes (Doc 23 §Position fallback).
 *
 * Sort key is a concatenation of `created_at` and a sub-position so a
 * session anchored at message X always appears *after* message X.
 */
function buildRenderItems(messages: ChatMessage[], sessions: ConversationSession[]): RenderItem[] {
  const storyMsgs = messages.filter((m) => m.kind === 'story');
  const items: RenderItem[] = storyMsgs.map((m) => ({
    kind: 'story',
    message: m,
    // Story messages sort at the "a" sub-position so partitions anchored at
    // the same message land below.
    sortKey: `${m.created_at}__a__${m.id}`,
  }));

  // Bucket session messages by session_id.
  const sessionMsgsBySession = new Map<string, ChatMessage[]>();
  for (const m of messages) {
    if (m.session_id === null) continue;
    const bucket = sessionMsgsBySession.get(m.session_id) ?? [];
    bucket.push(m);
    sessionMsgsBySession.set(m.session_id, bucket);
  }

  const messageById = new Map<string, ChatMessage>();
  for (const m of messages) messageById.set(m.id, m);

  for (const session of sessions) {
    const anchorMsg =
      session.entry_message_id !== null
        ? (messageById.get(session.entry_message_id) ?? null)
        : null;
    const anchorTime = anchorMsg !== null ? anchorMsg.created_at : session.created_at;
    items.push({
      kind: 'session',
      session,
      messages: sessionMsgsBySession.get(session.id) ?? [],
      // "b" sub-position so a session anchored at message X lands after X.
      sortKey: `${anchorTime}__b__${session.id}`,
    });
  }

  items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  return items;
}

function lastStoryModelMessageId(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.kind === 'story' && m.role === 'model') return m.id;
  }
  return null;
}

function NoStorySelected() {
  return (
    <div className="grid h-full place-items-center text-center text-sm text-[--color-text-muted]">
      <p>Select a story from the Navigator, or create one to begin.</p>
    </div>
  );
}

function BeginYourStory() {
  return (
    <div className="grid h-full place-items-center text-center text-sm text-[--color-text-muted]">
      <p>Begin your story.</p>
    </div>
  );
}
