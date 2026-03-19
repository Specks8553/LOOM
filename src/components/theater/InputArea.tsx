import { useState, useCallback, useRef, useEffect } from "react";
import { Send, Square, ChevronDown, ChevronRight, AlertTriangle, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useVaultStore } from "../../stores/vaultStore";
import { sendMessage, cancelGeneration, checkRateLimit, detachContextDoc, vaultGetItem } from "../../lib/tauriApi";
import { TagInput } from "../shared/TagInput";
import type { UserContent, ChatMessage, RateLimitStatus } from "../../lib/types";

/**
 * Three-field input area — Doc 09 §4.1 / Doc 02 §6.1.
 * Plot Direction always visible; Background, Modificators & Constraints collapsible.
 */
export function InputArea() {
  const activeStoryId = useWorkspaceStore((s) => s.activeStoryId);
  const currentLeafId = useWorkspaceStore((s) => s.currentLeafId);
  const isGenerating = useWorkspaceStore((s) => s.isGenerating);
  const setIsGenerating = useWorkspaceStore((s) => s.setIsGenerating);
  const setStreamingMsgId = useWorkspaceStore((s) => s.setStreamingMsgId);
  const addOptimisticMessages = useWorkspaceStore((s) => s.addOptimisticMessages);
  const finalizeStream = useWorkspaceStore((s) => s.finalizeStream);
  const removeMessages = useWorkspaceStore((s) => s.removeMessages);
  const setCurrentLeafId = useWorkspaceStore((s) => s.setCurrentLeafId);
  const attachedDocIds = useWorkspaceStore((s) => s.attachedDocIds);
  const removeAttachedDocId = useWorkspaceStore((s) => s.removeAttachedDocId);
  const openDoc = useWorkspaceStore((s) => s.openDoc);
  const items = useVaultStore((s) => s.items);

  const [plotDirection, setPlotDirection] = useState("");
  const [backgroundInfo, setBackgroundInfo] = useState("");
  const [modTags, setModTags] = useState<string[]>([]);
  const [constraints, setConstraints] = useState("");
  const [extrasExpanded, setExtrasExpanded] = useState(false);
  const [outputLength, setOutputLength] = useState(0);
  const [rateLimitStatus, setRateLimitStatus] = useState<RateLimitStatus | null>(null);

  const plotRef = useRef<HTMLTextAreaElement>(null);
  const bgRef = useRef<HTMLTextAreaElement>(null);
  const modRef = useRef<HTMLInputElement>(null);
  const constraintsRef = useRef<HTMLTextAreaElement>(null);

  // Check rate limit status periodically and after generation
  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      checkRateLimit()
        .then((s) => { if (mounted) setRateLimitStatus(s); })
        .catch(() => {});
    };
    refresh();
    const interval = setInterval(refresh, 10000);
    return () => { mounted = false; clearInterval(interval); };
  }, [isGenerating]);

  // Auto-resize plot direction textarea
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.max(80, el.scrollHeight) + "px";
  }, [plotDirection]);

  const handleSend = useCallback(async () => {
    if (!activeStoryId || plotDirection.trim() === "" || isGenerating) return;

    // Capture context doc names at send time for display in bubbles
    const docNames = attachedDocIds
      .map((id) => items.find((i) => i.id === id)?.name)
      .filter((n): n is string => !!n);

    const userContent: UserContent = {
      plot_direction: plotDirection.trim(),
      background_information: backgroundInfo.trim(),
      modificators: modTags,
      constraints: constraints.trim(),
      output_length: outputLength === 0 ? null : outputLength,
      context_doc_names: docNames.length > 0 ? docNames : undefined,
    };

    // Save current values for restore on failure
    const savedPlot = plotDirection;
    const savedBg = backgroundInfo;
    const savedMods = modTags;
    const savedConstraints = constraints;

    // Clear field values — Doc 09 §4.1
    // Do NOT collapse extrasExpanded; persist across sends
    setPlotDirection("");
    setBackgroundInfo("");
    setModTags([]);
    setConstraints("");

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
        tempModelId,
      );
      // Replace temp messages with real ones
      finalizeStream(tempModelId, result.model_msg);
      setCurrentLeafId(result.model_msg.id);
    } catch (e) {
      console.error("Send failed:", e);
      toast.error(`Send failed: ${e}`);
      // Remove optimistic messages on failure
      removeMessages([tempUserId, tempModelId]);
      setIsGenerating(false);
      setStreamingMsgId(null);
      // Restore input fields so user doesn't lose their work
      setPlotDirection(savedPlot);
      setBackgroundInfo(savedBg);
      setModTags(savedMods);
      setConstraints(savedConstraints);
      if (!extrasExpanded && (savedBg || savedMods.length > 0 || savedConstraints)) {
        setExtrasExpanded(true);
      }
    }
  }, [
    activeStoryId,
    currentLeafId,
    plotDirection,
    backgroundInfo,
    modTags,
    constraints,
    outputLength,
    isGenerating,
    extrasExpanded,
    addOptimisticMessages,
    removeMessages,
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

  // Tab cycling between input fields: Plot -> Background -> Modificators -> Constraints
  const fieldRefs = [plotRef, bgRef, modRef, constraintsRef];

  const handleFieldKeyDown = useCallback(
    (e: React.KeyboardEvent, fieldIndex: number) => {
      // Ctrl+Enter to send from any field
      if (e.key === "Enter" && e.ctrlKey) {
        e.preventDefault();
        handleSend();
        return;
      }

      if (e.key !== "Tab") return;

      // Only cycle when extras are expanded (otherwise only plot direction is visible)
      if (!extrasExpanded) return;

      const maxIndex = fieldRefs.length - 1;

      if (e.shiftKey) {
        // Shift+Tab: go backwards
        if (fieldIndex > 0) {
          e.preventDefault();
          fieldRefs[fieldIndex - 1].current?.focus();
        }
        // If at first field, let default Tab behavior happen (leave input area)
      } else {
        // Tab: go forwards
        if (fieldIndex < maxIndex) {
          e.preventDefault();
          fieldRefs[fieldIndex + 1].current?.focus();
        }
        // If at last field, let default Tab behavior happen
      }
    },
    [extrasExpanded, handleSend],
  );

  const rateLimited = rateLimitStatus !== null && !rateLimitStatus.can_proceed;
  const canSend = plotDirection.trim().length > 0 && !isGenerating && !rateLimited;

  const lengthLabel = outputLength === 0 ? "Auto" : `~${outputLength}w`;

  return (
    <div
      style={{
        borderTop: "1px solid var(--color-border-subtle)",
        backgroundColor: "var(--color-bg-theater)",
        padding: "12px 16px",
      }}
    >
      {/* Rate limit banner */}
      {rateLimited && (
        <div
          className="flex items-center gap-2"
          style={{
            padding: "8px 12px",
            marginBottom: "8px",
            borderRadius: "6px",
            fontSize: "12px",
            fontFamily: "var(--font-sans)",
            color: "var(--color-warning)",
            backgroundColor: "rgba(245,158,11,0.1)",
            border: "1px solid rgba(245,158,11,0.25)",
          }}
        >
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          <span>{rateLimitStatus?.reason ?? "Rate limit exceeded."}</span>
        </div>
      )}

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
        ref={plotRef}
        value={plotDirection}
        onChange={(e) => setPlotDirection(e.target.value)}
        onKeyDown={(e) => handleFieldKeyDown(e, 0)}
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

      {/* Attached context docs as tags */}
      {attachedDocIds.length > 0 && (
        <div className="flex flex-wrap gap-1" style={{ marginTop: "6px" }}>
          {attachedDocIds.map((docId) => {
            const docItem = items.find((i) => i.id === docId);
            const name = docItem?.name ?? "Document";
            return (
              <ContextDocTag
                key={docId}
                docId={docId}
                name={name}
                storyId={activeStoryId!}
                onDetach={() => {
                  if (activeStoryId) {
                    // Optimistic: update UI immediately
                    removeAttachedDocId(docId);
                    detachContextDoc(activeStoryId, docId).catch(() => {});
                  }
                }}
                onOpen={async () => {
                  try {
                    const fullItem = await vaultGetItem(docId);
                    openDoc(docId, fullItem.content, fullItem.name, fullItem.item_subtype, fullItem.item_type);
                  } catch (e) {
                    console.error("Failed to open doc:", e);
                  }
                }}
              />
            );
          })}
        </div>
      )}

      {/* Action row: Length slider + Send/Stop */}
      <div className="flex items-center gap-2" style={{ marginTop: "8px" }}>
        {/* Length slider (compact) */}
        <span
          style={{
            fontSize: "10px",
            fontFamily: "var(--font-mono)",
            color: "var(--color-text-muted)",
            whiteSpace: "nowrap",
            minWidth: "42px",
            textAlign: "right",
          }}
        >
          {lengthLabel}
        </span>
        <input
          type="range"
          min={0}
          max={2000}
          step={100}
          value={outputLength}
          onChange={(e) => {
            let v = Number(e.target.value);
            if (v > 0 && v < 200) v = 200;
            setOutputLength(v);
          }}
          style={{
            width: "100px",
            height: "4px",
            appearance: "none",
            WebkitAppearance: "none",
            background: `linear-gradient(to right, var(--color-accent) ${(outputLength / 2000) * 100}%, var(--color-border) ${(outputLength / 2000) * 100}%)`,
            borderRadius: "2px",
            outline: "none",
            cursor: "pointer",
            accentColor: "var(--color-accent)",
          }}
        />
        <style>{`
          input[type="range"]::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: var(--color-accent);
            cursor: pointer;
            border: none;
          }
          input[type="range"]::-moz-range-thumb {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: var(--color-accent);
            cursor: pointer;
            border: none;
          }
        `}</style>

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

      {/* Additional Input toggle */}
      <button
        onClick={() => setExtrasExpanded(!extrasExpanded)}
        className="flex items-center gap-1 transition-colors duration-150"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: "12px",
          fontFamily: "var(--font-sans)",
          color: "var(--color-text-muted)",
          padding: "2px 4px",
          marginTop: "4px",
          borderRadius: "4px",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--color-text-primary)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--color-text-muted)";
        }}
      >
        {extrasExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Additional Input
      </button>

      {/* Expanded additional fields: Background, Modificators, Constraints */}
      {extrasExpanded && (
        <>
          {/* Background Information field */}
          <div style={{ marginTop: "8px" }}>
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
              Background
            </label>
            <textarea
              ref={bgRef}
              value={backgroundInfo}
              onChange={(e) => setBackgroundInfo(e.target.value)}
              onKeyDown={(e) => handleFieldKeyDown(e, 1)}
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

          {/* Modificators field */}
          <div style={{ marginTop: "8px" }}>
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
              Modificators
            </label>
            <TagInput
              tags={modTags}
              onChange={setModTags}
              inputRef={modRef}
              placeholder="Type a tag, press comma to add..."
              onKeyDown={(e) => handleFieldKeyDown(e, 2)}
            />
          </div>

          {/* Constraints field */}
          <div style={{ marginTop: "8px" }}>
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
              Constraints
            </label>
            <textarea
              ref={constraintsRef}
              value={constraints}
              onChange={(e) => setConstraints(e.target.value)}
              onKeyDown={(e) => handleFieldKeyDown(e, 3)}
              placeholder="What the AI must NOT write..."
              style={{
                width: "100%",
                minHeight: "60px",
                resize: "vertical",
                background: "var(--color-bg-pane)",
                border: "1px solid rgba(244,63,94,0.3)",
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
        </>
      )}
    </div>
  );
}

/** Truncated context doc tag with hover tooltip and detach button. */
function ContextDocTag({
  name,
  onDetach,
  onOpen,
}: {
  docId: string;
  name: string;
  storyId: string;
  onDetach: () => void;
  onOpen: () => void;
}) {
  const maxLen = 18;
  const truncated = name.length > maxLen ? name.slice(0, maxLen) + "…" : name;

  return (
    <span
      className="flex items-center gap-1"
      style={{
        background: "rgba(59,130,246,0.1)",
        border: "1px solid rgba(59,130,246,0.25)",
        borderRadius: "4px",
        padding: "2px 6px",
        fontSize: "11px",
        fontFamily: "var(--font-sans)",
        color: "var(--color-text-secondary)",
        cursor: "pointer",
      }}
      title={name}
    >
      <Paperclip size={10} style={{ flexShrink: 0 }} />
      <span onClick={onOpen}>{truncated}</span>
      <button
        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); onDetach(); }}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "0 2px",
          color: "var(--color-text-muted)",
          display: "flex",
          alignItems: "center",
        }}
        title="Detach"
      >
        <X size={10} />
      </button>
    </span>
  );
}
