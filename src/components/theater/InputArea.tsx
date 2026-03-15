import { useState, useCallback, useRef, useEffect } from "react";
import { Send, Square, ChevronDown, ChevronRight } from "lucide-react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { sendMessage, cancelGeneration } from "../../lib/tauriApi";
import type { UserContent, ChatMessage } from "../../lib/types";

/**
 * Three-field input area — Doc 09 §4.1 / Doc 02 §6.1.
 * Plot Direction always visible; Background & Modificators collapsible.
 */
export function InputArea() {
  const activeStoryId = useWorkspaceStore((s) => s.activeStoryId);
  const currentLeafId = useWorkspaceStore((s) => s.currentLeafId);
  const isGenerating = useWorkspaceStore((s) => s.isGenerating);
  const setIsGenerating = useWorkspaceStore((s) => s.setIsGenerating);
  const setStreamingMsgId = useWorkspaceStore((s) => s.setStreamingMsgId);
  const addOptimisticMessages = useWorkspaceStore((s) => s.addOptimisticMessages);
  const finalizeStream = useWorkspaceStore((s) => s.finalizeStream);
  const setCurrentLeafId = useWorkspaceStore((s) => s.setCurrentLeafId);

  const [plotDirection, setPlotDirection] = useState("");
  const [backgroundInfo, setBackgroundInfo] = useState("");
  const [modificators, setModificators] = useState("");
  const [bgExpanded, setBgExpanded] = useState(false);
  const [modExpanded, setModExpanded] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.max(80, el.scrollHeight) + "px";
  }, [plotDirection]);

  const handleSend = useCallback(async () => {
    if (!activeStoryId || plotDirection.trim() === "" || isGenerating) return;

    const userContent: UserContent = {
      plot_direction: plotDirection.trim(),
      background_information: backgroundInfo.trim(),
      modificators: modificators
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    };

    // Clear fields immediately — Doc 09 §4.1
    setPlotDirection("");
    setBackgroundInfo("");
    setModificators("");
    setBgExpanded(false);
    setModExpanded(false);

    // Optimistic UI: create placeholder messages
    const tempUserId = `temp-user-${Date.now()}`;
    const tempModelId = `temp-model-${Date.now()}`;
    const now = new Date().toISOString();

    const optimisticUser: ChatMessage = {
      id: tempUserId,
      story_id: activeStoryId,
      parent_id: currentLeafId,
      role: "user",
      content_type: "json_user",
      content: JSON.stringify(userContent),
      token_count: null,
      model_name: null,
      finish_reason: null,
      created_at: now,
      deleted_at: null,
      user_feedback: null,
      ghostwriter_history: "[]",
    };

    const optimisticModel: ChatMessage = {
      id: tempModelId,
      story_id: activeStoryId,
      parent_id: tempUserId,
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
    };

    addOptimisticMessages(optimisticUser, optimisticModel);
    setIsGenerating(true);
    setStreamingMsgId(tempModelId);

    try {
      const result = await sendMessage(
        activeStoryId,
        currentLeafId,
        userContent,
      );
      // Replace temp messages with real ones
      finalizeStream(tempModelId, result.model_msg);
      setCurrentLeafId(result.model_msg.id);
    } catch (e) {
      console.error("Send failed:", e);
      setIsGenerating(false);
      setStreamingMsgId(null);
    }
  }, [
    activeStoryId,
    currentLeafId,
    plotDirection,
    backgroundInfo,
    modificators,
    isGenerating,
    addOptimisticMessages,
    setIsGenerating,
    setStreamingMsgId,
    finalizeStream,
    setCurrentLeafId,
  ]);

  const handleStop = useCallback(async () => {
    try {
      await cancelGeneration();
    } catch (e) {
      console.error("Cancel failed:", e);
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && e.ctrlKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const canSend = plotDirection.trim().length > 0 && !isGenerating;

  return (
    <div
      style={{
        borderTop: "1px solid var(--color-border-subtle)",
        backgroundColor: "var(--color-bg-theater)",
        padding: "12px 16px",
      }}
    >
      {/* Plot Direction */}
      <label
        style={{
          fontSize: "11px",
          fontFamily: "var(--font-sans)",
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--color-text-muted)",
          display: "block",
          marginBottom: "4px",
        }}
      >
        Plot Direction
      </label>
      <textarea
        ref={textareaRef}
        value={plotDirection}
        onChange={(e) => setPlotDirection(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Tell the AI where the story goes next..."
        style={{
          width: "100%",
          minHeight: "80px",
          maxHeight: "200px",
          resize: "none",
          background: "var(--color-bg-pane)",
          border: "1px solid var(--color-border)",
          borderRadius: "6px",
          padding: "10px 12px",
          fontSize: "14px",
          fontFamily: "var(--font-theater-body)",
          color: "var(--color-text-primary)",
          lineHeight: 1.5,
          outline: "none",
        }}
      />

      {/* Toggles row */}
      <div className="flex items-center gap-2" style={{ marginTop: "8px" }}>
        {/* Background toggle */}
        <button
          onClick={() => setBgExpanded(!bgExpanded)}
          className="flex items-center gap-1 transition-colors duration-150"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: "12px",
            fontFamily: "var(--font-sans)",
            color: "var(--color-text-muted)",
            padding: "2px 4px",
            borderRadius: "4px",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--color-text-primary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--color-text-muted)";
          }}
        >
          {bgExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Background
        </button>

        {/* Modificators toggle */}
        <button
          onClick={() => setModExpanded(!modExpanded)}
          className="flex items-center gap-1 transition-colors duration-150"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: "12px",
            fontFamily: "var(--font-sans)",
            color: "var(--color-text-muted)",
            padding: "2px 4px",
            borderRadius: "4px",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--color-text-primary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--color-text-muted)";
          }}
        >
          {modExpanded ? (
            <ChevronDown size={12} />
          ) : (
            <ChevronRight size={12} />
          )}
          Modificators
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Send / Stop button */}
        {isGenerating ? (
          <button
            onClick={handleStop}
            className="flex items-center gap-1.5 transition-colors duration-150"
            style={{
              background: "var(--color-warning)",
              border: "none",
              borderRadius: "6px",
              padding: "6px 14px",
              cursor: "pointer",
              fontSize: "13px",
              fontFamily: "var(--font-sans)",
              fontWeight: 500,
              color: "#fff",
            }}
          >
            <Square size={14} />
            Stop
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!canSend}
            className="flex items-center gap-1.5 transition-colors duration-150"
            style={{
              background: canSend
                ? "var(--color-accent)"
                : "var(--color-bg-active)",
              border: "none",
              borderRadius: "6px",
              padding: "6px 14px",
              cursor: canSend ? "pointer" : "not-allowed",
              fontSize: "13px",
              fontFamily: "var(--font-sans)",
              fontWeight: 500,
              color: canSend ? "#fff" : "var(--color-text-muted)",
              opacity: canSend ? 1 : 0.6,
            }}
          >
            <Send size={14} />
            Send
          </button>
        )}
      </div>

      {/* Background Information field */}
      {bgExpanded && (
        <div style={{ marginTop: "8px" }}>
          <textarea
            value={backgroundInfo}
            onChange={(e) => setBackgroundInfo(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Facts the AI needs but must NOT appear in the prose..."
            style={{
              width: "100%",
              minHeight: "60px",
              resize: "vertical",
              background: "var(--color-bg-pane)",
              border: "1px solid rgba(245,158,11,0.3)",
              borderRadius: "6px",
              padding: "8px 10px",
              fontSize: "13px",
              fontFamily: "var(--font-sans)",
              color: "var(--color-text-primary)",
              lineHeight: 1.5,
              outline: "none",
            }}
          />
        </div>
      )}

      {/* Modificators field */}
      {modExpanded && (
        <div style={{ marginTop: "8px" }}>
          <input
            type="text"
            value={modificators}
            onChange={(e) => setModificators(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Comma-separated tags: dark, slow burn, poetic..."
            style={{
              width: "100%",
              background: "var(--color-bg-pane)",
              border: "1px solid rgba(124,58,237,0.3)",
              borderRadius: "6px",
              padding: "8px 10px",
              fontSize: "13px",
              fontFamily: "var(--font-sans)",
              color: "var(--color-text-primary)",
              outline: "none",
            }}
          />
        </div>
      )}
    </div>
  );
}
