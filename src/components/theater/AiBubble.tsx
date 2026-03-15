import { useMemo, useState, useCallback } from "react";
import { AlertTriangle, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { marked } from "marked";
import { formatShortTime } from "../../lib/timeUtils";
import { LoadingDots } from "./LoadingDots";
import { SiblingNav } from "./SiblingNav";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import {
  sendMessage,
  getMessage,
  deleteMessageCmd,
  undeleteMessage,
  setStoryLeafId,
} from "../../lib/tauriApi";
import type { ChatMessage, UserContent } from "../../lib/types";

interface AiBubbleProps {
  message: ChatMessage;
  isStreaming: boolean;
  isLast: boolean;
  hasSiblings: boolean;
  onNavigateSibling: (siblingId: string) => void;
  onReloadBranch: (newLeafId?: string) => Promise<void>;
  storyId: string;
}

marked.setOptions({ breaks: true, gfm: true });

/**
 * AI message bubble — Doc 09 §10 / Doc 02 §5.1.
 * Left-aligned, dark background. Renders Markdown content.
 * Action row on hover: Regenerate (last only), Delete (last only).
 * Shows sibling navigation when hasSiblings.
 */
export function AiBubble({
  message,
  isStreaming,
  isLast,
  hasSiblings,
  onNavigateSibling,
  onReloadBranch,
  storyId,
}: AiBubbleProps) {
  const isSafety = message.finish_reason === "SAFETY";
  const isError = message.finish_reason === "ERROR";
  const showLoading = isStreaming && !message.content;
  const isGenerating = useWorkspaceStore((s) => s.isGenerating);
  const [hovered, setHovered] = useState(false);

  const renderedHtml = useMemo(() => {
    if (!message.content) return "";
    return marked.parse(message.content) as string;
  }, [message.content]);

  // ─── Regenerate — Doc 09 §7 ──────────────────────────────────────────
  const handleRegenerate = useCallback(async () => {
    if (!message.parent_id || isGenerating) return;
    const store = useWorkspaceStore.getState();
    try {
      // Get the parent user message to extract its UserContent
      const userMsg = await getMessage(message.parent_id);
      const userContent: UserContent = JSON.parse(userMsg.content);

      const tempModelId = `temp-model-${Date.now()}`;
      const now = new Date().toISOString();

      // Optimistic: add streaming model placeholder to current messages
      store.setMessages([
        ...store.messages,
        {
          id: tempModelId,
          story_id: storyId,
          parent_id: message.parent_id,
          role: "model",
          content_type: "text",
          content: "",
          token_count: null,
          model_name: null,
          finish_reason: null,
          created_at: now,
          deleted_at: null,
          user_feedback: null,
          ghostwriter_history: "[]",
        },
      ]);
      store.setIsGenerating(true);
      store.setStreamingMsgId(tempModelId);

      // Send uses the same user content, with leaf = user msg's parent
      const result = await sendMessage(
        storyId,
        userMsg.parent_id,
        userContent,
        tempModelId,
      );

      // Reload the full branch from the new model message
      store.setIsGenerating(false);
      store.setStreamingMsgId(null);
      await onReloadBranch(result.model_msg.id);
    } catch (e) {
      console.error("Regenerate failed:", e);
      toast.error(`Regenerate failed: ${e}`);
      store.setIsGenerating(false);
      store.setStreamingMsgId(null);
      await onReloadBranch();
    }
  }, [message.parent_id, storyId, isGenerating, onReloadBranch]);

  // ─── Delete — Doc 09 §7.4 (soft delete with undo toast) ─────────────
  const handleDelete = useCallback(async () => {
    if (isGenerating) return;
    try {
      const deletedModelId = message.id;
      const deletedUserId = message.parent_id;
      const newLeafId = await deleteMessageCmd(storyId, message.id);

      const deletedIds = [deletedModelId];
      if (deletedUserId) deletedIds.push(deletedUserId);

      if (newLeafId) {
        await onReloadBranch(newLeafId);
      } else {
        const store = useWorkspaceStore.getState();
        store.setMessages([]);
        store.setSiblingCounts([]);
        store.setCurrentLeafId(null);
      }

      toast("Message deleted", {
        duration: 5000,
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await undeleteMessage(deletedIds);
              await setStoryLeafId(storyId, deletedModelId);
              await onReloadBranch(deletedModelId);
            } catch (err) {
              console.error("Undo delete failed:", err);
              toast.error(`Undo failed: ${err}`);
            }
          },
        },
      });
    } catch (e) {
      console.error("Delete failed:", e);
      toast.error(`Delete failed: ${e}`);
    }
  }, [message.id, message.parent_id, storyId, isGenerating, onReloadBranch]);

  // Safety filter bubble — Doc 09 §11
  if (isSafety) {
    return (
      <div className="flex justify-start" style={{ padding: "4px 0" }}>
        <div
          style={{
            maxWidth: "80%",
            background: "rgba(244,63,94,0.08)",
            border: "1px solid rgba(244,63,94,0.25)",
            borderRadius: "8px",
            padding: "12px 14px",
          }}
        >
          <div
            className="flex items-center gap-2"
            style={{
              fontSize: "11px",
              fontFamily: "var(--font-sans)",
              color: "var(--color-text-muted)",
              marginBottom: "8px",
            }}
          >
            <span>AI</span>
            <span>&middot;</span>
            <span>{formatShortTime(message.created_at)}</span>
            <span
              className="flex items-center gap-1"
              style={{ color: "var(--color-error)", marginLeft: "auto" }}
            >
              <AlertTriangle size={12} />
              Safety
            </span>
          </div>
          <p
            style={{
              fontSize: "14px",
              fontFamily: "var(--font-theater-body)",
              color: "var(--color-text-secondary)",
              margin: 0,
              lineHeight: 1.6,
            }}
          >
            Response blocked by Gemini safety filters.
            <br />
            Try rephrasing your plot direction.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="group flex flex-col items-start"
      style={{ padding: "4px 0" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        style={{
          maxWidth: "80%",
          backgroundColor: "var(--color-bg-elevated)",
          borderRadius: "8px",
          padding: "12px 14px",
        }}
      >
        {/* Header: AI · time · tokens · model · sibling nav */}
        <div
          className="flex items-center gap-1.5 flex-wrap"
          style={{
            fontSize: "11px",
            fontFamily: "var(--font-sans)",
            color: "var(--color-text-muted)",
            marginBottom: "8px",
          }}
        >
          <span style={{ fontWeight: 600 }}>AI</span>
          <span>&middot;</span>
          <span>{formatShortTime(message.created_at)}</span>
          {message.token_count != null && (
            <>
              <span>&middot;</span>
              <span>{message.token_count} tok</span>
            </>
          )}
          {message.model_name && (
            <>
              <span>&middot;</span>
              <span>{message.model_name}</span>
            </>
          )}
          {isError && (
            <span
              className="flex items-center gap-1"
              style={{ color: "var(--color-warning)" }}
              title="Generation was stopped — response may be incomplete."
            >
              <AlertTriangle size={12} />
            </span>
          )}
          {hasSiblings && (
            <SiblingNav
              storyId={storyId}
              messageId={message.id}
              parentId={message.parent_id}
              onNavigate={onNavigateSibling}
            />
          )}
        </div>

        {/* Content */}
        {showLoading ? (
          <LoadingDots />
        ) : (
          <div
            className="ai-message-content"
            style={{
              fontSize: "15px",
              fontFamily: "var(--font-theater-body)",
              color: "var(--color-text-primary)",
              lineHeight: 1.7,
            }}
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        )}
      </div>

      {/* Action row — visible on hover, below bubble — Doc 02 §5.2 */}
      {isLast && !isStreaming && hovered && !isGenerating && (
        <div
          className="flex items-center gap-2"
          style={{
            padding: "4px 0 0 4px",
            transition: "opacity 120ms ease",
          }}
        >
          <ActionButton
            icon={<RefreshCw size={16} />}
            label="Regenerate"
            onClick={handleRegenerate}
          />
          <ActionButton
            icon={<Trash2 size={16} />}
            label="Delete"
            onClick={handleDelete}
          />
        </div>
      )}
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="flex items-center gap-1 transition-colors duration-150"
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: "2px 6px",
        borderRadius: "4px",
        fontSize: "11px",
        fontFamily: "var(--font-sans)",
        color: "var(--color-text-muted)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "var(--color-text-primary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--color-text-muted)";
      }}
    >
      {icon}
      {label}
    </button>
  );
}
