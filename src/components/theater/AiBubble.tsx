import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { AlertTriangle, RefreshCw, Trash2, MessageSquare, RotateCcw, Map as MapIcon, Bookmark } from "lucide-react";
import { toast } from "sonner";
import { marked } from "marked";
import { formatShortTime } from "../../lib/timeUtils";
import { LoadingDots } from "./LoadingDots";
import { SiblingNav } from "./SiblingNav";
import { GhostwriterToolbar } from "./GhostwriterToolbar";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useGhostwriterStore } from "../../stores/ghostwriterStore";
import type { GhostwriterEdit, DiffSpan } from "../../stores/ghostwriterStore";
import { useContextMenu, ContextMenu } from "../shared/ContextMenu";
import type { MenuItem } from "../shared/ContextMenu";
import {
  sendMessage,
  getMessage,
  deleteMessageCmd,
  undeleteMessage,
  setStoryLeafId,
  updateMessageFeedback,
  sendGhostwriterRequest,
  saveGhostwriterEdit,
} from "../../lib/tauriApi";
import { useUiStore } from "../../stores/uiStore";
import { useBranchMapStore } from "../../stores/branchMapStore";
import { createCheckpointCmd } from "../../lib/tauriApi";
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
 * AI message bubble — Doc 09 §10 / Doc 02 §5.1 / Doc 16 (Ghostwriter).
 * Left-aligned, dark background. Renders Markdown content.
 * Supports Ghostwriter mode: plain-text rendering, selection tracking, diff display.
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
  const currentLeafId = useWorkspaceStore((s) => s.currentLeafId);
  const [hovered, setHovered] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const { contextMenu, showContextMenu, hideContextMenu } = useContextMenu();
  const [feedbackValue, setFeedbackValue] = useState(message.user_feedback ?? "");
  const feedbackRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Ghostwriter store
  const gwActiveMsgId = useGhostwriterStore((s) => s.activeMsgId);
  const gwPhase = useGhostwriterStore((s) => s.phase);
  const gwSelection = useGhostwriterStore((s) => s.selection);
  const gwPendingDiff = useGhostwriterStore((s) => s.pendingDiff);
  const gwEnter = useGhostwriterStore((s) => s.enter);
  const gwExit = useGhostwriterStore((s) => s.exit);
  const gwSetSelection = useGhostwriterStore((s) => s.setSelection);
  const gwStartGeneration = useGhostwriterStore((s) => s.startGeneration);
  const gwSetDiff = useGhostwriterStore((s) => s.setDiff);
  const gwStopGeneration = useGhostwriterStore((s) => s.stopGeneration);
  const gwInstruction = useGhostwriterStore((s) => s.instruction);
  const gwOriginalContent = useGhostwriterStore((s) => s.originalContent);

  const isGhostwriterActive = gwActiveMsgId === message.id;
  const hasFeedback = (message.user_feedback ?? "").trim().length > 0;

  // Parse ghostwriter history
  const ghostwriterHistory: GhostwriterEdit[] = useMemo(() => {
    try {
      return JSON.parse(message.ghostwriter_history || "[]");
    } catch {
      return [];
    }
  }, [message.ghostwriter_history]);
  const hasGhostwriterHistory = ghostwriterHistory.length > 0;

  useEffect(() => {
    if (feedbackOpen && feedbackRef.current) {
      feedbackRef.current.focus();
    }
  }, [feedbackOpen]);

  const handleFeedbackBlur = useCallback(async () => {
    const trimmed = feedbackValue.trim();
    if (trimmed !== (message.user_feedback ?? "")) {
      await updateMessageFeedback(message.id, trimmed);
      const store = useWorkspaceStore.getState();
      store.setMessages(
        store.messages.map((m) =>
          m.id === message.id ? { ...m, user_feedback: trimmed || null } : m,
        ),
      );
    }
  }, [feedbackValue, message.id, message.user_feedback]);

  const renderedHtml = useMemo(() => {
    if (!message.content) return "";
    return marked.parse(message.content) as string;
  }, [message.content]);

  // ─── Text selection tracking (Ghostwriter) ──────────────────────────
  const handleMouseUp = useCallback(() => {
    if (!isGhostwriterActive || gwPhase !== "selecting") return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !contentRef.current) return;

    const range = sel.getRangeAt(0);
    if (!contentRef.current.contains(range.commonAncestorContainer)) return;

    // Calculate offsets relative to the plain-text content
    const fullText = message.content;
    const selectedText = sel.toString();

    // Find the selected text within the message content
    const startIdx = fullText.indexOf(selectedText);
    if (startIdx === -1) {
      // Fallback: use the range's text content offset
      gwSetSelection({
        startOffset: 0,
        endOffset: selectedText.length,
        selectedText,
      });
      return;
    }

    gwSetSelection({
      startOffset: startIdx,
      endOffset: startIdx + selectedText.length,
      selectedText,
    });
  }, [isGhostwriterActive, gwPhase, message.content, gwSetSelection]);

  // ─── Ghostwriter: Enter mode ──────────────────────────────────────────
  const handleEnterGhostwriter = useCallback(() => {
    if (isGenerating) return;
    gwEnter(message.id, message.content);
  }, [message.id, message.content, isGenerating, gwEnter]);

  // ─── Ghostwriter: Generate ────────────────────────────────────────────
  const handleGhostwriterGenerate = useCallback(async () => {
    if (!gwSelection || !gwInstruction.trim()) return;

    gwStartGeneration();
    useWorkspaceStore.getState().setIsGenerating(true);

    try {
      const result = await sendGhostwriterRequest(
        message.id,
        gwSelection.selectedText,
        gwInstruction,
        gwOriginalContent,
        storyId,
        currentLeafId ?? message.id,
      );

      // Calculate word-level diff
      const diff = computeWordDiff(gwOriginalContent, result.new_content);
      gwSetDiff({ spans: diff, newContent: result.new_content });
    } catch (e) {
      console.error("Ghostwriter generation failed:", e);
      toast.error(`Ghostwriter failed: ${e}`);
      gwStopGeneration();
    } finally {
      useWorkspaceStore.getState().setIsGenerating(false);
    }
  }, [gwSelection, gwInstruction, gwOriginalContent, gwStartGeneration, gwSetDiff, gwStopGeneration, message.id, storyId, currentLeafId]);

  // ─── Ghostwriter: Accept ──────────────────────────────────────────────
  const handleGhostwriterAccept = useCallback(async () => {
    if (!gwPendingDiff) return;

    const newContent = gwPendingDiff.newContent;
    const isCurrentLeaf = message.id === currentLeafId;

    if (!isCurrentLeaf) {
      // Case B: editing non-latest message — confirm new branch
      const confirmed = window.confirm(
        "Accepting this change will create a new branch from this point. The original continues on its branch.\n\nCreate a new branch?",
      );
      if (!confirmed) return;
    }

    // Build edit record
    const editRecord: GhostwriterEdit = {
      edited_at: new Date().toISOString(),
      original_content: gwOriginalContent,
      new_content: newContent,
      instruction: gwInstruction,
      selected_text: gwSelection?.selectedText ?? "",
    };

    try {
      await saveGhostwriterEdit(message.id, newContent, editRecord);

      // Update message in store
      const store = useWorkspaceStore.getState();
      const updatedHistory = [...ghostwriterHistory, editRecord];
      store.setMessages(
        store.messages.map((m) =>
          m.id === message.id
            ? { ...m, content: newContent, ghostwriter_history: JSON.stringify(updatedHistory) }
            : m,
        ),
      );

      gwExit();
      toast.success("Ghostwriter changes applied.");
    } catch (e) {
      console.error("Ghostwriter accept failed:", e);
      toast.error(`Failed to save changes: ${e}`);
    }
  }, [gwPendingDiff, gwOriginalContent, gwInstruction, gwSelection, message.id, currentLeafId, ghostwriterHistory, gwExit]);

  // ─── Ghostwriter: Reject ──────────────────────────────────────────────
  const handleGhostwriterReject = useCallback(() => {
    gwExit();
  }, [gwExit]);

  // ─── Ghostwriter: Cancel ──────────────────────────────────────────────
  const handleGhostwriterCancel = useCallback(() => {
    gwExit();
  }, [gwExit]);

  // ─── Ghostwriter: Revert ──────────────────────────────────────────────
  const handleRevert = useCallback(async () => {
    if (ghostwriterHistory.length === 0) return;

    const lastEdit = ghostwriterHistory[ghostwriterHistory.length - 1];
    const revertedContent = lastEdit.original_content;
    const newHistory = ghostwriterHistory.slice(0, -1);

    try {
      // Build a "revert" edit record (we save the reverted state)
      await saveGhostwriterEdit(
        message.id,
        revertedContent,
        // We pass a placeholder edit record; the backend just needs to update content + history
        {
          edited_at: new Date().toISOString(),
          original_content: message.content,
          new_content: revertedContent,
          instruction: "[revert]",
          selected_text: "",
        },
      );

      // For a revert, we actually want to SET the history to newHistory, not append.
      // The save_ghostwriter_edit command appends, so we need a different approach.
      // Instead, we'll update the content and manually set the history.
      // This requires the backend to support overwriting history, or we handle it differently.
      // For now, use the existing save command which appends — we'll fix this to be a direct update.
      const store = useWorkspaceStore.getState();
      store.setMessages(
        store.messages.map((m) =>
          m.id === message.id
            ? { ...m, content: revertedContent, ghostwriter_history: JSON.stringify(newHistory) }
            : m,
        ),
      );
      toast.success("Reverted to previous version.");
    } catch (e) {
      console.error("Revert failed:", e);
      toast.error(`Revert failed: ${e}`);
    }
  }, [message.id, message.content, ghostwriterHistory]);

  // ─── Regenerate — Doc 09 §7 ──────────────────────────────────────────
  const handleRegenerate = useCallback(async () => {
    if (!message.parent_id || isGenerating) return;
    const store = useWorkspaceStore.getState();
    try {
      const userMsg = await getMessage(message.parent_id);
      const userContent: UserContent = JSON.parse(userMsg.content);

      if (isLast && !hasSiblings) {
        await deleteMessageCmd(storyId, message.id);
      }

      const tempModelId = `temp-model-${Date.now()}`;
      const now = new Date().toISOString();

      const msgsUpToParent = store.messages.filter((m) => m.id !== message.id);
      store.setMessages([
        ...msgsUpToParent,
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

      const result = await sendMessage(
        storyId,
        userMsg.parent_id,
        userContent,
        tempModelId,
      );

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
  }, [message.parent_id, message.id, storyId, isGenerating, isLast, hasSiblings, onReloadBranch]);

  // ─── Delete — Doc 09 §7.4 ────────────────────────────────────────────
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
              await undeleteMessage(storyId, deletedIds);
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

  // ─── Render: Safety bubble ────────────────────────────────────────────
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

  // ─── Render: Content (normal, plain-text for GW mode, or diff) ────────
  const renderContent = () => {
    if (showLoading) return <LoadingDots />;

    // Ghostwriter reviewing phase: show diff
    if (isGhostwriterActive && gwPhase === "reviewing" && gwPendingDiff) {
      return (
        <div
          ref={contentRef}
          style={{
            fontSize: "15px",
            fontFamily: "var(--font-theater-body)",
            color: "var(--color-text-primary)",
            lineHeight: 1.7,
            whiteSpace: "pre-wrap",
          }}
        >
          {gwPendingDiff.spans.map((span, i) => (
            <span
              key={i}
              className={span.type === "changed" ? "ghostwriter-diff-changed" : undefined}
            >
              {span.text}
            </span>
          ))}
        </div>
      );
    }

    // Ghostwriter selecting/generating phase: plain text (no markdown)
    if (isGhostwriterActive && (gwPhase === "selecting" || gwPhase === "generating")) {
      return (
        <div
          ref={contentRef}
          onMouseUp={handleMouseUp}
          style={{
            fontSize: "15px",
            fontFamily: "var(--font-theater-body)",
            color: "var(--color-text-primary)",
            lineHeight: 1.7,
            whiteSpace: "pre-wrap",
            cursor: "text",
            userSelect: "text",
          }}
        >
          {message.content}
        </div>
      );
    }

    // Normal: rendered markdown
    return (
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
    );
  };

  return (
    <div
      className="group flex flex-col items-start"
      style={{ padding: "4px 0" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className={isGhostwriterActive ? "bubble-ghostwriter-active" : undefined}
        style={{
          maxWidth: "80%",
          backgroundColor: "var(--color-bg-elevated)",
          borderRadius: "8px",
          padding: "12px 14px",
        }}
        onContextMenu={(e) => {
          if (isGhostwriterActive) return; // No context menu in GW mode
          const items: MenuItem[] = [
            { label: "Feedback", icon: MessageSquare, onClick: () => setFeedbackOpen(!feedbackOpen) },
            { label: "Ghostwriter...", icon: RefreshCw, onClick: handleEnterGhostwriter, disabled: isGenerating },
            { label: "Regenerate", icon: RefreshCw, onClick: handleRegenerate, disabled: !isLast || isGenerating },
            { label: "Delete", icon: Trash2, onClick: handleDelete, disabled: !isLast || isGenerating },
            { label: "", icon: undefined, onClick: () => {}, separator: true },
            {
              label: "Show in Branch Map",
              icon: MapIcon,
              onClick: () => {
                useUiStore.getState().setBranchMapOpen(true);
                useBranchMapStore.getState().setScrollTo(message.id);
              },
            },
            {
              label: "Add Checkpoint Here",
              icon: Bookmark,
              onClick: async () => {
                try {
                  await createCheckpointCmd(storyId, message.id, "Checkpoint");
                  toast("Checkpoint created");
                } catch (err) {
                  toast.error(`Failed to create checkpoint: ${err}`);
                }
              },
            },
          ];
          showContextMenu(e, items);
        }}
      >
        {/* Header */}
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
        {renderContent()}
      </div>

      {/* Ghostwriter toolbar (below bubble frame) */}
      {isGhostwriterActive && (
        <GhostwriterToolbar
          onGenerate={handleGhostwriterGenerate}
          onAccept={handleGhostwriterAccept}
          onReject={handleGhostwriterReject}
          onCancel={handleGhostwriterCancel}
        />
      )}

      {/* Action row — visible on hover, below bubble */}
      {!isStreaming && !isGenerating && !isGhostwriterActive && (
        <div
          className="flex items-center gap-2"
          style={{
            padding: "4px 0 0 4px",
            opacity: hovered ? 1 : 0,
            pointerEvents: hovered ? "auto" : "none",
            transition: "opacity 120ms ease",
          }}
        >
          {isLast && (
            <>
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
            </>
          )}
          <ActionButton
            label="✦ Ghostwriter"
            onClick={handleEnterGhostwriter}
          />
          <ActionButton
            icon={<MessageSquare size={16} style={hasFeedback ? { color: "var(--color-accent)" } : undefined} />}
            label="Feedback"
            onClick={() => setFeedbackOpen(!feedbackOpen)}
          />
          {hasGhostwriterHistory && (
            <ActionButton
              icon={<RotateCcw size={16} />}
              label="Revert"
              onClick={handleRevert}
            />
          )}
        </div>
      )}

      {/* Feedback box */}
      {feedbackOpen && (
        <div
          style={{
            maxWidth: "80%",
            marginTop: "4px",
            padding: "8px 10px",
            backgroundColor: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border)",
            borderRadius: "6px",
          }}
        >
          <textarea
            ref={feedbackRef}
            value={feedbackValue}
            onChange={(e) => setFeedbackValue(e.target.value)}
            onBlur={handleFeedbackBlur}
            placeholder="Add feedback for this response..."
            style={{
              width: "100%",
              fontSize: "12px",
              fontFamily: "var(--font-sans)",
              color: "var(--color-text-primary)",
              background: "var(--color-bg-base)",
              border: "1px solid var(--color-border)",
              borderRadius: "4px",
              padding: "6px 8px",
              outline: "none",
              resize: "none",
              minHeight: "40px",
              lineHeight: 1.4,
            }}
          />
          <p style={{ fontSize: "10px", color: "var(--color-text-muted)", marginTop: "4px" }}>
            Feedback is injected into AI context for future messages.
          </p>
        </div>
      )}

      {contextMenu && <ContextMenu menu={contextMenu} onClose={hideContextMenu} />}
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
}: {
  icon?: React.ReactNode;
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

// ─── Word-level diff — Doc 16 §4.1 ──────────────────────────────────────────

function computeWordDiff(oldText: string, newText: string): DiffSpan[] {
  const oldWords = tokenize(oldText);
  const newWords = tokenize(newText);

  // Simple LCS-based word diff
  const lcs = longestCommonSubsequence(oldWords, newWords);
  const spans: DiffSpan[] = [];

  let ni = 0;
  let li = 0;

  while (ni < newWords.length) {
    if (li < lcs.length && newWords[ni] === lcs[li]) {
      // This word is unchanged
      if (spans.length > 0 && spans[spans.length - 1].type === "unchanged") {
        spans[spans.length - 1].text += newWords[ni];
      } else {
        spans.push({ type: "unchanged", text: newWords[ni] });
      }
      li++;
    } else {
      // This word is new/changed
      if (spans.length > 0 && spans[spans.length - 1].type === "changed") {
        spans[spans.length - 1].text += newWords[ni];
      } else {
        spans.push({ type: "changed", text: newWords[ni] });
      }
    }
    ni++;
  }

  return spans;
}

/** Split text into tokens preserving whitespace. */
function tokenize(text: string): string[] {
  // Split on word boundaries but keep whitespace attached to the following word
  const tokens: string[] = [];
  const regex = /(\s*\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    tokens.push(match[1]);
  }
  return tokens;
}

/** Compute LCS of two string arrays (words). */
function longestCommonSubsequence(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;

  // Use space-optimized approach for large texts
  if (m > 5000 || n > 5000) {
    // Fallback: simple greedy match for very large texts
    return greedyLCS(a, b);
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find LCS
  const result: string[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return result;
}

/** Greedy LCS for very large texts — O(n) approximate. */
function greedyLCS(a: string[], b: string[]): string[] {
  const result: string[] = [];
  let j = 0;
  for (let i = 0; i < a.length && j < b.length; i++) {
    if (a[i] === b[j]) {
      result.push(a[i]);
      j++;
    }
  }
  return result;
}
