import { BookOpen } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { AccordionBanner } from '@/components/theater/AccordionBanner';
import { InputArea } from '@/components/theater/InputArea';
import { ModeSwitcher } from '@/components/theater/ModeSwitcher';
import { SessionInputArea } from '@/components/theater/SessionInputArea';
import { SessionPartition } from '@/components/theater/SessionPartition';
import { StoryAIBubble } from '@/components/theater/StoryAIBubble';
import { StoryUserBubble } from '@/components/theater/StoryUserBubble';
import { useModeStore } from '@/stores/modeStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { AccordionSegment, ChatMessage, Checkpoint, ConversationSession } from '@/lib/types';

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
  const checkpoints = useWorkspaceStore((s) => s.checkpoints);
  const segments = useWorkspaceStore((s) => s.segments);
  const sessions = useModeStore((s) => s.sessions);
  const activeMode = useModeStore((s) => s.activeMode);
  const activeSessionId = useModeStore((s) => s.activeSessionId);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoFollow, setAutoFollow] = useState(true);

  const renderItems = useMemo(
    () => buildRenderItems(messages, sessions, checkpoints, segments),
    [messages, sessions, checkpoints, segments],
  );

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
              if (item.kind === 'session') {
                return (
                  <li key={`session-${item.session.id}`}>
                    <SessionPartition session={item.session} messages={item.messages} />
                  </li>
                );
              }
              return (
                <li key={`cp-${item.checkpoint.id}`}>
                  <AccordionBanner
                    checkpoint={item.checkpoint}
                    segment={item.segment}
                    previousSegment={item.previousSegment}
                    segmentMessageCount={item.segmentMessageCount}
                  />
                </li>
              );
            })}
          </ul>
        )}
        {!autoFollow && isGenerating && (
          <button
            type="button"
            onClick={jumpToBottom}
            className="sticky bottom-2 ml-auto block rounded-full border border-[--color-border] bg-[--color-bg-elevated] px-3 py-1 text-[12px] text-[--color-text-primary] shadow hover:border-[--color-accent]"
          >
            ↓ New content
          </button>
        )}
      </div>
      {activeStoryId !== null && (
        <>
          <ModeSwitcher storyId={activeStoryId} />
          {renderInput()}
        </>
      )}
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
    }
  | {
      kind: 'accordion';
      checkpoint: Checkpoint;
      segment: AccordionSegment | null;
      previousSegment: AccordionSegment | null;
      segmentMessageCount: number;
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
function buildRenderItems(
  messages: ChatMessage[],
  sessions: ConversationSession[],
  checkpoints: Checkpoint[],
  segments: AccordionSegment[],
): RenderItem[] {
  const storyMsgs = messages.filter((m) => m.kind === 'story');
  const messageById = new Map<string, ChatMessage>();
  for (const m of messages) messageById.set(m.id, m);

  // Anchor `created_at` for each checkpoint (start sentinel → "" so it sorts
  // before every real timestamp).
  const checkpointAnchorAt = new Map<string, string>();
  for (const cp of checkpoints) {
    if (cp.after_message_id === null) {
      checkpointAnchorAt.set(cp.id, '');
    } else {
      const anchor = messageById.get(cp.after_message_id);
      checkpointAnchorAt.set(cp.id, anchor !== undefined ? anchor.created_at : '');
    }
  }

  // For each closed segment compute (startAt, endAt] range and count.
  type SegRange = { seg: AccordionSegment; startAt: string; endAt: string };
  const segRanges: SegRange[] = [];
  for (const seg of segments) {
    const startAt = checkpointAnchorAt.get(seg.start_cp_id);
    const endAt = checkpointAnchorAt.get(seg.end_cp_id);
    if (startAt === undefined || endAt === undefined) continue;
    segRanges.push({ seg, startAt, endAt });
  }

  function containingSegment(msgCreatedAt: string): AccordionSegment | null {
    for (const r of segRanges) {
      if (r.startAt < msgCreatedAt && msgCreatedAt <= r.endAt) return r.seg;
    }
    return null;
  }

  // Drop messages whose containing closed segment is collapsed. Banner
  // replaces them with the summary card (Doc 16 §Banner state matrix row 1).
  const visibleStoryMsgs = storyMsgs.filter((m) => {
    const seg = containingSegment(m.created_at);
    return !(seg !== null && seg.is_collapsed);
  });

  const segmentMessageCounts = new Map<string, number>();
  for (const r of segRanges) {
    let n = 0;
    for (const m of storyMsgs) {
      if (r.startAt < m.created_at && m.created_at <= r.endAt) n += 1;
    }
    segmentMessageCounts.set(r.seg.id, n);
  }

  const items: RenderItem[] = visibleStoryMsgs.map((m) => ({
    kind: 'story',
    message: m,
    // Story messages sort at the "a" sub-position so partitions anchored at
    // the same message land below.
    sortKey: `${m.created_at}__a__${m.id}`,
  }));

  // Accordion banners — one per checkpoint. The start sentinel anchors at
  // "" (sorts to the top). User checkpoints anchor at their after-message
  // `created_at`, with a "c" sub-position so they fall below the anchor
  // message AND any session anchored at the same message.
  const segmentByStartCp = new Map<string, AccordionSegment>();
  const segmentByEndCp = new Map<string, AccordionSegment>();
  for (const seg of segments) {
    segmentByStartCp.set(seg.start_cp_id, seg);
    segmentByEndCp.set(seg.end_cp_id, seg);
  }
  for (const cp of checkpoints) {
    const anchorAt = checkpointAnchorAt.get(cp.id) ?? '';
    const segment = segmentByStartCp.get(cp.id) ?? null;
    const previousSegment = segmentByEndCp.get(cp.id) ?? null;
    let count = 0;
    if (segment !== null) {
      count = segmentMessageCounts.get(segment.id) ?? 0;
    } else {
      // Open segment — count messages strictly after this checkpoint.
      for (const m of storyMsgs) {
        if (anchorAt < m.created_at) count += 1;
      }
    }
    items.push({
      kind: 'accordion',
      checkpoint: cp,
      segment,
      previousSegment,
      segmentMessageCount: count,
      // Start sentinel sorts to the top via "" anchor.
      sortKey: cp.is_start ? '__a__sentinel' : `${anchorAt}__c__${cp.id}`,
    });
  }

  // Bucket session messages by session_id.
  const sessionMsgsBySession = new Map<string, ChatMessage[]>();
  for (const m of messages) {
    if (m.session_id === null) continue;
    const bucket = sessionMsgsBySession.get(m.session_id) ?? [];
    bucket.push(m);
    sessionMsgsBySession.set(m.session_id, bucket);
  }

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

/** Doc 12 §No Story Selected — empty-state template (icon + headline). */
function NoStorySelected() {
  return (
    <div className="grid h-full place-items-center">
      <div className="flex max-w-sm flex-col items-center gap-2.5 text-center">
        <BookOpen size={40} className="text-[--color-text-muted] opacity-50" aria-hidden />
        <p className="text-[15px] font-medium text-[--color-text-primary]">
          Select a story from the Navigator, or create one to begin.
        </p>
      </div>
    </div>
  );
}

/** Doc 12 §No Messages — no icon; the InputArea below is the action. */
function BeginYourStory() {
  return (
    <div className="grid h-full place-items-center">
      <div className="flex flex-col items-center gap-1.5 text-center">
        <p className="text-[15px] font-medium text-[--color-text-primary]">
          Your story begins here.
        </p>
        <p className="text-[13px] text-[--color-text-secondary]">
          Write a direction and press Send to start.
        </p>
      </div>
    </div>
  );
}
