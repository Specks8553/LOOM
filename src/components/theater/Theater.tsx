import { useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useVaultStore } from "../../stores/vaultStore";
import { getStoryLeafId, loadStoryMessages } from "../../lib/tauriApi";
import { UserBubble } from "./UserBubble";
import { AiBubble } from "./AiBubble";
import { InputArea } from "./InputArea";
import { EmptyStory } from "../empty/EmptyStory";
import type { StreamChunk, StreamDone } from "../../lib/types";

/**
 * Theater: message display + input area.
 * Doc 09 §5, Doc 02 §5–§6.
 *
 * Renders the active branch of the conversation as bubbles,
 * with a three-field input area at the bottom.
 */
export function Theater() {
  const activeStoryId = useWorkspaceStore((s) => s.activeStoryId);
  const messages = useWorkspaceStore((s) => s.messages);
  const streamingMsgId = useWorkspaceStore((s) => s.streamingMsgId);
  const isGenerating = useWorkspaceStore((s) => s.isGenerating);
  const setMessages = useWorkspaceStore((s) => s.setMessages);
  const setSiblingCounts = useWorkspaceStore((s) => s.setSiblingCounts);
  const setCurrentLeafId = useWorkspaceStore((s) => s.setCurrentLeafId);
  const appendStreamDelta = useWorkspaceStore((s) => s.appendStreamDelta);
  const finalizeStream = useWorkspaceStore((s) => s.finalizeStream);
  const setIsGenerating = useWorkspaceStore((s) => s.setIsGenerating);
  const setStreamingMsgId = useWorkspaceStore((s) => s.setStreamingMsgId);

  const items = useVaultStore((s) => s.items);
  const storyItem = items.find((i) => i.id === activeStoryId);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Load messages when story changes
  const loadMessages = useCallback(async () => {
    if (!activeStoryId) return;
    try {
      const leafId = await getStoryLeafId(activeStoryId);
      if (!leafId) {
        // No messages yet
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

  // Listen for streaming events
  useEffect(() => {
    let unlistenChunk: (() => void) | null = null;
    let unlistenDone: (() => void) | null = null;

    const setup = async () => {
      unlistenChunk = await listen<StreamChunk>("stream_chunk", (event) => {
        appendStreamDelta(event.payload.message_id, event.payload.delta);
      });

      unlistenDone = await listen<StreamDone>("stream_done", (event) => {
        finalizeStream(event.payload.message_id, event.payload.model_msg);
      });
    };

    setup();

    return () => {
      unlistenChunk?.();
      unlistenDone?.();
    };
  }, [appendStreamDelta, finalizeStream, setIsGenerating, setStreamingMsgId]);

  // Auto-scroll to bottom on new messages or streaming content
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Token estimation (chars / 4) — Doc 09 §12.1
  const estimatedTokens = messages.reduce((sum, m) => {
    if (m.token_count != null) return sum + m.token_count;
    return sum + Math.ceil(m.content.length / 4);
  }, 0);

  if (!activeStoryId) return null;

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
          {messages.map((msg) => {
            if (msg.role === "user") {
              return <UserBubble key={msg.id} message={msg} />;
            }
            return (
              <AiBubble
                key={msg.id}
                message={msg}
                isStreaming={msg.id === streamingMsgId}
              />
            );
          })}
        </div>
      )}

      {/* Input area */}
      <InputArea />
    </div>
  );
}
