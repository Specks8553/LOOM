import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { Bookmark, FileText, Minimize2, Maximize2 } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useVaultStore } from "../../stores/vaultStore";
import { useAccordionStore } from "../../stores/accordionStore";
import {
  getStoryLeafId,
  loadBranchMap,
  loadStoryMessages,
  navigateToSibling,
  setStoryLeafId,
} from "../../lib/tauriApi";
import { UserBubble } from "./UserBubble";
import { AiBubble } from "./AiBubble";
import { AccordionSummaryCard } from "./AccordionSummaryCard";
import { InputArea } from "./InputArea";
import { EmptyStory } from "../empty/EmptyStory";
import { ContextMenu, useContextMenu } from "../shared/ContextMenu";
import type { AccordionSegment, Checkpoint, StreamChunk, StreamDone } from "../../lib/types";

/**
 * Theater: message display + input area.
 * Doc 09 §5, Doc 02 §5–§6.
 *
 * Renders the active branch of the conversation as bubbles,
 * with a three-field input area at the bottom.
 */
export function Theater() {
  const activeStoryId = useWorkspaceStore((s) => s.activeStoryId);
  const currentLeafId = useWorkspaceStore((s) => s.currentLeafId);
  const messages = useWorkspaceStore((s) => s.messages);
  const streamingMsgId = useWorkspaceStore((s) => s.streamingMsgId);
  const isGenerating = useWorkspaceStore((s) => s.isGenerating);
  const siblingCounts = useWorkspaceStore((s) => s.siblingCounts);
  const setMessages = useWorkspaceStore((s) => s.setMessages);
  const setSiblingCounts = useWorkspaceStore((s) => s.setSiblingCounts);
  const setCurrentLeafId = useWorkspaceStore((s) => s.setCurrentLeafId);
  const appendStreamDelta = useWorkspaceStore((s) => s.appendStreamDelta);
  const finalizeStream = useWorkspaceStore((s) => s.finalizeStream);

  const items = useVaultStore((s) => s.items);
  const storyItem = items.find((i) => i.id === activeStoryId);

  const accordionSegments = useAccordionStore((s) => s.segments);
  const accordionLoad = useAccordionStore((s) => s.load);
  const accordionClear = useAccordionStore((s) => s.clear);
  const accordionSummarise = useAccordionStore((s) => s.summarise);
  const accordionCollapse = useAccordionStore((s) => s.collapse);
  const accordionExpand = useAccordionStore((s) => s.expand);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);

  // Load messages when story changes
  const loadMessages = useCallback(async () => {
    if (!activeStoryId) return;
    try {
      const leafId = await getStoryLeafId(activeStoryId);
      if (!leafId) {
        setMessages([]);
        setSiblingCounts([]);
        setCurrentLeafId(null);
        return;
      }
      const payload = await loadStoryMessages(activeStoryId, leafId);
      setMessages(payload.messages);
      setSiblingCounts(payload.sibling_counts);
      setCurrentLeafId(leafId);
    } catch (e) {
      console.error("Failed to load story messages:", e);
      setMessages([]);
      setSiblingCounts([]);
      setCurrentLeafId(null);
    }
  }, [activeStoryId, setMessages, setSiblingCounts, setCurrentLeafId]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // Load checkpoints + accordion segments for Theater dividers
  useEffect(() => {
    if (!activeStoryId || !currentLeafId) {
      setCheckpoints([]);
      accordionClear();
      return;
    }
    loadBranchMap(activeStoryId).then((data) => {
      setCheckpoints(data.checkpoints);
    }).catch(() => {
      setCheckpoints([]);
    });
    accordionLoad(activeStoryId);
  }, [activeStoryId, currentLeafId, accordionLoad, accordionClear]);

  // Refresh checkpoints + segments when branch map updates
  useEffect(() => {
    if (!activeStoryId) return;
    const unlisten = listen<string>("branch_map_updated", (event) => {
      if (event.payload === activeStoryId && currentLeafId) {
        loadBranchMap(activeStoryId).then((data) => {
          setCheckpoints(data.checkpoints);
        }).catch(() => {});
        accordionLoad(activeStoryId);
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, [activeStoryId, currentLeafId, accordionLoad]);

  // Reload the current branch (used after delete, regenerate, edit)
  const reloadBranch = useCallback(
    async (newLeafId?: string) => {
      if (!activeStoryId) return;
      const leafId = newLeafId ?? (await getStoryLeafId(activeStoryId));
      if (!leafId) {
        setMessages([]);
        setSiblingCounts([]);
        setCurrentLeafId(null);
        return;
      }
      const payload = await loadStoryMessages(activeStoryId, leafId);
      setMessages(payload.messages);
      setSiblingCounts(payload.sibling_counts);
      setCurrentLeafId(leafId);
    },
    [activeStoryId, setMessages, setSiblingCounts, setCurrentLeafId],
  );

  // Navigate to a sibling branch — Doc 09 §2.2
  const handleNavigateSibling = useCallback(
    async (siblingId: string) => {
      if (!activeStoryId) return;
      try {
        setShouldAutoScroll(false);
        const payload = await navigateToSibling(activeStoryId, siblingId);
        setMessages(payload.messages);
        setSiblingCounts(payload.sibling_counts);
        // The new leaf is the last message
        const newLeaf = payload.messages[payload.messages.length - 1];
        if (newLeaf) setCurrentLeafId(newLeaf.id);
      } catch (e) {
        console.error("Failed to navigate sibling:", e);
      }
    },
    [activeStoryId, setMessages, setSiblingCounts, setCurrentLeafId],
  );

  // Listen for streaming events.
  // Use a cancelled flag to prevent listener registration after cleanup
  // (React StrictMode remounts effects, and async listen() can resolve after unmount).
  useEffect(() => {
    let cancelled = false;
    let unlistenChunk: (() => void) | null = null;
    let unlistenDone: (() => void) | null = null;

    const setup = async () => {
      const chunkUn = await listen<StreamChunk>("stream_chunk", (event) => {
        if (!cancelled) {
          appendStreamDelta(event.payload.message_id, event.payload.delta);
        }
      });
      if (cancelled) { chunkUn(); return; }
      unlistenChunk = chunkUn;

      const doneUn = await listen<StreamDone>("stream_done", (event) => {
        if (!cancelled) {
          finalizeStream(event.payload.message_id, event.payload.model_msg);
        }
      });
      if (cancelled) { doneUn(); return; }
      unlistenDone = doneUn;
    };

    setup();

    return () => {
      cancelled = true;
      unlistenChunk?.();
      unlistenDone?.();
    };
  }, [appendStreamDelta, finalizeStream]);

  // Persist leaf_id on every change — Doc 09 §2.4
  useEffect(() => {
    if (activeStoryId && currentLeafId) {
      setStoryLeafId(activeStoryId, currentLeafId).catch((e) =>
        console.error("Failed to persist leaf_id:", e),
      );
    }
  }, [activeStoryId, currentLeafId]);

  // Listen for scroll-to-message events from feedback overlay — Doc 10 §6.3
  useEffect(() => {
    const handler = (e: Event) => {
      const { messageId } = (e as CustomEvent).detail;
      const el = document.getElementById(`msg-${messageId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        // Brief highlight
        el.style.outline = "2px solid var(--color-accent)";
        el.style.borderRadius = "8px";
        setTimeout(() => {
          el.style.outline = "";
          el.style.borderRadius = "";
        }, 1500);
      }
    };
    window.addEventListener("loom:scroll-to-message", handler);
    return () => window.removeEventListener("loom:scroll-to-message", handler);
  }, []);

  // Auto-scroll to bottom on new messages or streaming — skip on branch navigation
  useEffect(() => {
    if (!shouldAutoScroll) {
      setShouldAutoScroll(true);
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build a lookup for sibling counts: parent_id → count
  const siblingCountMap = new Map<string, number>();
  for (const sc of siblingCounts) {
    siblingCountMap.set(sc.parent_id, sc.count);
  }

  // Build checkpoint lookup: after_message_id → checkpoint
  const checkpointAfterMap = new Map<string, Checkpoint>();
  for (const cp of checkpoints) {
    if (cp.after_message_id) {
      checkpointAfterMap.set(cp.after_message_id, cp);
    }
  }
  // Start checkpoint (after_message_id is null)
  const startCheckpoint = checkpoints.find((cp) => cp.is_start);

  // Build collapsed segment ranges: message index → segment
  // A segment spans from (start_cp.after_message_id + 1) to (end_cp.after_message_id) inclusive
  const { collapsedMsgMap, segmentMsgCounts } = useMemo(() => {
    const map = new Map<number, AccordionSegment>();
    const counts = new Map<string, number>();

    if (checkpoints.length === 0 || accordionSegments.length === 0) {
      return { collapsedMsgMap: map, segmentMsgCounts: counts };
    }

    // Position map: message_id → index
    const pos = new Map<string, number>();
    messages.forEach((m, i) => pos.set(m.id, i));

    for (const seg of accordionSegments) {
      if (!seg.is_collapsed || !seg.summary) continue;
      // Check branch_leaf_id: if set, only applies to that branch
      if (seg.branch_leaf_id && seg.branch_leaf_id !== currentLeafId) continue;

      const startCp = checkpoints.find((c) => c.id === seg.start_cp_id);
      const endCp = checkpoints.find((c) => c.id === seg.end_cp_id);
      if (!startCp || !endCp) continue;

      // Determine start position
      let startPos: number;
      if (startCp.after_message_id) {
        const p = pos.get(startCp.after_message_id);
        if (p === undefined) continue;
        startPos = p + 1; // segment starts AFTER this message
      } else {
        startPos = 0; // start checkpoint → from beginning
      }

      // Determine end position
      if (!endCp.after_message_id) continue;
      const endPos = pos.get(endCp.after_message_id);
      if (endPos === undefined) continue;

      let msgCount = 0;
      for (let i = startPos; i <= endPos; i++) {
        map.set(i, seg);
        msgCount++;
      }
      counts.set(seg.id, msgCount);
    }

    return { collapsedMsgMap: map, segmentMsgCounts: counts };
  }, [messages, checkpoints, accordionSegments, currentLeafId]);

  // Token estimation accounting for collapsed segments — Doc 09 §12.1
  const estimatedTokens = messages.reduce((sum, m, idx) => {
    const seg = collapsedMsgMap.get(idx);
    if (seg) {
      // For collapsed messages, only count the summary tokens once (on first msg of segment)
      const startCp = checkpoints.find((c) => c.id === seg.start_cp_id);
      const firstIdx = startCp?.after_message_id
        ? (messages.findIndex((mm) => mm.id === startCp.after_message_id) + 1)
        : 0;
      if (idx === firstIdx && seg.summary) {
        return sum + Math.ceil(seg.summary.length / 4);
      }
      return sum; // skip other messages in collapsed segment
    }
    if (m.token_count != null) return sum + m.token_count;
    return sum + Math.ceil(m.content.length / 4);
  }, 0);

  if (!activeStoryId) return null;

  const lastMsgIdx = messages.length - 1;
  // Track which segments have already rendered their summary card
  const renderedSegments = new Set<string>();

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-4 shrink-0"
        style={{
          height: "36px",
          borderBottom: "1px solid var(--color-border-subtle)",
        }}
      >
        <span
          style={{
            fontSize: "13px",
            fontFamily: "var(--font-sans)",
            fontWeight: 600,
            color: "var(--color-text-primary)",
          }}
        >
          {storyItem?.name ?? "Story"}
        </span>
        {messages.length > 0 && (
          <span
            style={{
              fontSize: "11px",
              fontFamily: "var(--font-sans)",
              color:
                estimatedTokens > 121600
                  ? "var(--color-error)"
                  : estimatedTokens > 102400
                    ? "var(--color-warning)"
                    : "var(--color-text-muted)",
            }}
          >
            ~{estimatedTokens.toLocaleString()} / 128,000 tokens
          </span>
        )}
      </div>

      {/* Message area */}
      {messages.length === 0 && !isGenerating ? (
        <div className="flex-1 overflow-hidden">
          <EmptyStory />
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto"
          style={{ padding: "16px 24px" }}
        >
          {/* Start checkpoint divider */}
          {startCheckpoint && messages.length > 0 && (
            <TheaterCheckpointDivider
              checkpoint={startCheckpoint}
              segments={accordionSegments}
              storyId={activeStoryId}
              leafId={currentLeafId}
              onSummarise={accordionSummarise}
              onCollapse={accordionCollapse}
              onExpand={accordionExpand}
            />
          )}
          {messages.map((msg, idx) => {
            const isLast = idx === lastMsgIdx;
            const parentKey = msg.parent_id ?? "__root__";
            const hasSiblings = (siblingCountMap.get(parentKey) ?? 0) > 1;
            const cpAfter = checkpointAfterMap.get(msg.id);

            // Check if this message is inside a collapsed segment
            const collapsedSeg = collapsedMsgMap.get(idx);
            if (collapsedSeg) {
              if (renderedSegments.has(collapsedSeg.id)) {
                // Already rendered the summary card for this segment — skip
                return null;
              }
              // First message of collapsed segment — render the summary card
              renderedSegments.add(collapsedSeg.id);
              const endCp = checkpoints.find((c) => c.id === collapsedSeg.end_cp_id);
              return (
                <div key={`accordion-${collapsedSeg.id}`}>
                  <AccordionSummaryCard
                    segment={collapsedSeg}
                    checkpoint={endCp}
                    messageCount={segmentMsgCounts.get(collapsedSeg.id) ?? 0}
                    storyId={activeStoryId}
                    leafId={currentLeafId ?? ""}
                  />
                  {/* Show the end checkpoint divider after the card */}
                  {endCp && (
                    <TheaterCheckpointDivider
                      checkpoint={endCp}
                      segments={accordionSegments}
                      storyId={activeStoryId}
                      leafId={currentLeafId}
                      onSummarise={accordionSummarise}
                      onCollapse={accordionCollapse}
                      onExpand={accordionExpand}
                    />
                  )}
                </div>
              );
            }

            if (msg.role === "user") {
              return (
                <div key={msg.id} id={`msg-${msg.id}`}>
                  <UserBubble
                    message={msg}
                    isLast={isLast}
                    hasSiblings={hasSiblings}
                    onNavigateSibling={handleNavigateSibling}
                    onReloadBranch={reloadBranch}
                    storyId={activeStoryId}
                  />
                  {cpAfter && (
                    <TheaterCheckpointDivider
                      checkpoint={cpAfter}
                      segments={accordionSegments}
                      storyId={activeStoryId}
                      leafId={currentLeafId}
                      onSummarise={accordionSummarise}
                      onCollapse={accordionCollapse}
                      onExpand={accordionExpand}
                    />
                  )}
                </div>
              );
            }
            return (
              <div key={msg.id} id={`msg-${msg.id}`}>
              <AiBubble
                message={msg}
                isStreaming={msg.id === streamingMsgId}
                isLast={isLast}
                hasSiblings={hasSiblings}
                onNavigateSibling={handleNavigateSibling}
                onReloadBranch={reloadBranch}
                storyId={activeStoryId}
              />
              {cpAfter && (
                <TheaterCheckpointDivider
                  checkpoint={cpAfter}
                  segments={accordionSegments}
                  storyId={activeStoryId}
                  leafId={currentLeafId}
                  onSummarise={accordionSummarise}
                  onCollapse={accordionCollapse}
                  onExpand={accordionExpand}
                />
              )}
              </div>
            );
          })}
        </div>
      )}

      {/* Input area */}
      <InputArea />
    </div>
  );
}

interface CheckpointDividerProps {
  checkpoint: Checkpoint;
  segments: AccordionSegment[];
  storyId: string;
  leafId: string | null;
  onSummarise: (segmentId: string, storyId: string, leafId: string) => Promise<void>;
  onCollapse: (segmentId: string, storyId: string) => Promise<void>;
  onExpand: (segmentId: string, storyId: string) => Promise<void>;
}

function TheaterCheckpointDivider({
  checkpoint,
  segments,
  storyId,
  leafId,
  onSummarise,
  onCollapse,
  onExpand,
}: CheckpointDividerProps) {
  const { contextMenu, showContextMenu, hideContextMenu } = useContextMenu();

  // Find the segment that ends at this checkpoint (the "previous chapter")
  const prevSegment = segments.find((s) => s.end_cp_id === checkpoint.id);

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!prevSegment || !leafId) return;
    const items = [];

    if (!prevSegment.summary || prevSegment.is_stale) {
      items.push({
        label: "Summarise previous chapter",
        icon: FileText,
        onClick: () => onSummarise(prevSegment.id, storyId, leafId),
      });
    }

    if (prevSegment.is_collapsed) {
      items.push({
        label: "Expand chapter",
        icon: Maximize2,
        onClick: () => onExpand(prevSegment.id, storyId),
      });
    } else if (prevSegment.summary) {
      items.push({
        label: "Collapse chapter",
        icon: Minimize2,
        onClick: () => onCollapse(prevSegment.id, storyId),
      });
    }

    if (items.length > 0) {
      showContextMenu(e, items);
    }
  };

  return (
    <>
      <div
        className="flex items-center gap-3 my-4 px-2 select-none"
        style={{ cursor: prevSegment ? "context-menu" : undefined }}
        onContextMenu={handleContextMenu}
      >
        <div className="flex-1 h-px" style={{ background: "var(--color-checkpoint)" }} />
        <div className="flex items-center gap-1.5">
          <Bookmark size={12} style={{ color: "var(--color-checkpoint)" }} />
          <span
            className="text-[11px] font-medium uppercase tracking-wider"
            style={{ color: "var(--color-checkpoint)" }}
          >
            {checkpoint.name}
          </span>
        </div>
        <div className="flex-1 h-px" style={{ background: "var(--color-checkpoint)" }} />
      </div>
      {contextMenu && <ContextMenu menu={contextMenu} onClose={hideContextMenu} />}
    </>
  );
}
