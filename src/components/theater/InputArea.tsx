import { useState, useCallback, useRef, useEffect } from "react";
import { Send, Square, ChevronDown, ChevronRight, AlertTriangle, Paperclip, X, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useVaultStore } from "../../stores/vaultStore";
import { sendMessage, cancelGeneration, checkRateLimit, detachContextDoc, vaultGetItem, vaultGetAssetPath } from "../../lib/tauriApi";
import { TagInput } from "../shared/TagInput";
import type { UserContent, ChatMessage, RateLimitStatus, ImageBlock } from "../../lib/types";

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
  const [imageBlocks, setImageBlocks] = useState<ImageBlock[]>([]);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [imageThumbPaths, setImageThumbPaths] = useState<Record<string, string>>({});

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

  // Resolve absolute paths for image block thumbnails
  useEffect(() => {
    for (const block of imageBlocks) {
      if (!imageThumbPaths[block.item_id]) {
        vaultGetAssetPath(block.item_id)
          .then((absPath) => {
            setImageThumbPaths((prev) => ({ ...prev, [block.item_id]: absPath }));
          })
          .catch(() => {});
      }
    }
  }, [imageBlocks]);

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
      image_blocks: imageBlocks.length > 0 ? imageBlocks : undefined,
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
    setImageBlocks([]);

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

      {/* Image block chips */}
      {imageBlocks.length > 0 && (
        <div className="flex flex-wrap gap-1" style={{ marginTop: "6px" }}>
          {imageBlocks.map((block) => {
            const absPath = imageThumbPaths[block.item_id];
            const itemMeta = items.find((i) => i.id === block.item_id);
            return (
              <div
                key={block.item_id}
                className="flex items-center gap-1.5"
                style={{
                  padding: "3px 6px 3px 3px",
                  borderRadius: "4px",
                  backgroundColor: "var(--color-bg-hover)",
                  border: "1px solid var(--color-border-subtle)",
                  fontSize: "11px",
                  color: "var(--color-text-secondary)",
                }}
              >
                {absPath ? (
                  <img
                    src={convertFileSrc(absPath)}
                    alt=""
                    style={{ width: 20, height: 20, objectFit: "cover", borderRadius: 2 }}
                  />
                ) : (
                  <ImageIcon size={14} style={{ color: "var(--color-text-muted)" }} />
                )}
                <span className="truncate" style={{ maxWidth: 100 }}>{itemMeta?.name ?? "Image"}</span>
                <button
                  onClick={() => setImageBlocks((prev) => prev.filter((b) => b.item_id !== block.item_id))}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", padding: 0, display: "flex" }}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Action row: Length slider + Image button + Send/Stop */}
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

        {/* Image attach button */}
        <button
          onClick={() => setShowImagePicker(true)}
          title="Attach images"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: imageBlocks.length > 0 ? "var(--color-accent)" : "var(--color-text-muted)",
            padding: "4px",
            display: "flex",
            alignItems: "center",
            borderRadius: "4px",
            transition: "color 150ms ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--color-text-primary)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = imageBlocks.length > 0 ? "var(--color-accent)" : "var(--color-text-muted)"; }}
        >
          <ImageIcon size={16} />
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

      {/* Image picker modal */}
      {showImagePicker && (
        <ImagePickerModal
          selectedIds={imageBlocks.map((b) => b.item_id)}
          onConfirm={(blocks) => {
            setImageBlocks(blocks);
            setShowImagePicker(false);
          }}
          onClose={() => setShowImagePicker(false)}
        />
      )}
    </div>
  );
}

/** Modal grid for picking Image vault items to attach inline. */
function ImagePickerModal({
  selectedIds,
  onConfirm,
  onClose,
}: {
  selectedIds: string[];
  onConfirm: (blocks: ImageBlock[]) => void;
  onClose: () => void;
}) {
  const items = useVaultStore((s) => s.items);
  const imageItems = items.filter((i) => i.item_type === "Image" && !i.deleted_at);

  const [selected, setSelected] = useState<Set<string>>(new Set(selectedIds));
  const [thumbPaths, setThumbPaths] = useState<Record<string, string>>({});

  useEffect(() => {
    for (const item of imageItems) {
      if (!thumbPaths[item.id]) {
        vaultGetAssetPath(item.id)
          .then((p) => setThumbPaths((prev) => ({ ...prev, [item.id]: p })))
          .catch(() => {});
      }
    }
  }, [imageItems.length]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirm = () => {
    const blocks: ImageBlock[] = imageItems
      .filter((i) => selected.has(i.id) && i.asset_path)
      .map((i) => ({ item_id: i.id, asset_path: i.asset_path! }));
    onConfirm(blocks);
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.5)", zIndex: 200 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
    >
      <div
        className="flex flex-col"
        style={{
          width: 480,
          maxHeight: "70vh",
          backgroundColor: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
          borderRadius: "8px",
          overflow: "hidden",
        }}
      >
        <div
          className="flex items-center justify-between px-4 shrink-0"
          style={{ height: 40, borderBottom: "1px solid var(--color-border-subtle)" }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-primary)" }}>
            Attach Images
          </span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", display: "flex", padding: 4 }}
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-3">
          {imageItems.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--color-text-muted)", textAlign: "center", padding: 24 }}>
              No images in vault. Upload images via Navigator first.
            </p>
          ) : (
            <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))" }}>
              {imageItems.map((item) => {
                const absPath = thumbPaths[item.id];
                const isSelected = selected.has(item.id);
                return (
                  <button
                    key={item.id}
                    onClick={() => toggle(item.id)}
                    className="flex flex-col items-center gap-1"
                    style={{
                      padding: 6,
                      borderRadius: 6,
                      border: isSelected ? "2px solid var(--color-accent)" : "2px solid transparent",
                      backgroundColor: isSelected ? "var(--color-bg-active)" : "var(--color-bg-hover)",
                      cursor: "pointer",
                      transition: "border-color 150ms ease",
                    }}
                  >
                    {absPath ? (
                      <img
                        src={convertFileSrc(absPath)}
                        alt={item.name}
                        style={{ width: "100%", height: 70, objectFit: "cover", borderRadius: 4 }}
                      />
                    ) : (
                      <div
                        className="flex items-center justify-center"
                        style={{ width: "100%", height: 70, backgroundColor: "var(--color-bg-pane)", borderRadius: 4 }}
                      >
                        <ImageIcon size={24} style={{ color: "var(--color-text-muted)", opacity: 0.4 }} />
                      </div>
                    )}
                    <span
                      className="truncate w-full text-center"
                      style={{ fontSize: 10, color: "var(--color-text-secondary)" }}
                    >
                      {item.name}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div
          className="flex items-center justify-end gap-2 px-4 shrink-0"
          style={{ height: 44, borderTop: "1px solid var(--color-border-subtle)" }}
        >
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", padding: "6px 14px",
              fontSize: 13, color: "var(--color-text-secondary)", cursor: "pointer", borderRadius: 6,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            style={{
              backgroundColor: "var(--color-accent)", color: "var(--color-text-on-accent)",
              border: "none", borderRadius: 6, padding: "6px 14px",
              fontSize: 13, fontWeight: 500, cursor: "pointer",
            }}
          >
            Attach {selected.size > 0 ? `(${selected.size})` : ""}
          </button>
        </div>
      </div>
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
