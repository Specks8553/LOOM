import { useState, useCallback, useEffect } from "react";
import { Brain, Palette, Pencil, ShieldAlert, Paperclip, X } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { parseUserContent } from "../../lib/types";
import { SiblingNav } from "./SiblingNav";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { sendMessage, deleteMessageCmd, vaultGetAssetPath } from "../../lib/tauriApi";
import { TagInput } from "../shared/TagInput";
import InlineImage from "../shared/InlineImage";
import type { ChatMessage, UserContent } from "../../lib/types";

interface UserBubbleProps {
  message: ChatMessage;
  isLast: boolean;
  hasSiblings: boolean;
  onNavigateSibling: (siblingId: string) => void;
  onReloadBranch: (newLeafId?: string) => Promise<void>;
  storyId: string;
}

/**
 * User message bubble — Doc 09 §9 / Doc 02 §5.1–§5.3.
 * Right-aligned, accent-subtle background.
 * Shows plot direction always; pills for background info and modificators.
 * Action row on hover: Edit.
 * Edit mode: inline editing with Send Edit / Cancel — Doc 09 §8.
 */
export function UserBubble({
  message,
  isLast: _isLast,
  hasSiblings,
  onNavigateSibling,
  onReloadBranch,
  storyId,
}: UserBubbleProps) {
  const uc = parseUserContent(message.content);
  const [bgExpanded, setBgExpanded] = useState(false);
  const [modExpanded, setModExpanded] = useState(false);
  const [constraintsExpanded, setConstraintsExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);

  // Edit state
  const [editPlot, setEditPlot] = useState(uc.plot_direction);
  const [editBg, setEditBg] = useState(uc.background_information);
  const [editModTags, setEditModTags] = useState<string[]>(uc.modificators);
  const [editConstraints, setEditConstraints] = useState(uc.constraints ?? "");
  const [editImageBlocks, setEditImageBlocks] = useState(uc.image_blocks ?? []);

  const isGenerating = useWorkspaceStore((s) => s.isGenerating);

  // Resolve image block absolute paths
  const [imgAbsPaths, setImgAbsPaths] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!uc.image_blocks || uc.image_blocks.length === 0) return;
    for (const block of uc.image_blocks) {
      if (!imgAbsPaths[block.item_id]) {
        vaultGetAssetPath(block.item_id)
          .then((p) => setImgAbsPaths((prev) => ({ ...prev, [block.item_id]: p })))
          .catch(() => {});
      }
    }
  }, [uc.image_blocks]);

  const handleStartEdit = useCallback(() => {
    setEditPlot(uc.plot_direction);
    setEditBg(uc.background_information);
    setEditModTags([...uc.modificators]);
    setEditConstraints(uc.constraints ?? "");
    setEditImageBlocks([...(uc.image_blocks ?? [])]);
    setEditing(true);
  }, [uc]);

  const handleCancelEdit = useCallback(() => {
    setEditing(false);
  }, []);

  // ─── Send Edit — Doc 09 §8.2 ─────────────────────────────────────────
  const handleSendEdit = useCallback(async () => {
    if (editPlot.trim() === "" || isGenerating) return;
    const store = useWorkspaceStore.getState();

    const editedContent: UserContent = {
      plot_direction: editPlot.trim(),
      background_information: editBg.trim(),
      modificators: editModTags,
      constraints: editConstraints.trim(),
      output_length: null,
      image_blocks: editImageBlocks.length > 0 ? editImageBlocks : undefined,
    };

    setEditing(false);

    // Check if we can overwrite instead of branching:
    // If this user message's AI child is the last message with no siblings,
    // delete the old pair and immediately replace with streaming placeholder.
    const msgs = store.messages;
    const myIdx = msgs.findIndex((m) => m.id === message.id);
    const aiChild = myIdx >= 0 && myIdx < msgs.length - 1 ? msgs[myIdx + 1] : null;
    const aiChildIsLast = aiChild != null && myIdx + 1 === msgs.length - 1;
    let overwriting = false;
    if (aiChildIsLast && aiChild && !hasSiblings) {
      try {
        await deleteMessageCmd(storyId, aiChild.id);
        overwriting = true;
      } catch {
        // If delete fails, fall through to normal branching behavior
      }
    }

    const tempModelId = `temp-model-${Date.now()}`;
    const now = new Date().toISOString();

    // If overwriting, strip only the old AI child from the displayed messages.
    // Keep the user message visible so the user can see their input while streaming.
    const baseMsgs = overwriting
      ? msgs.filter((m) => m.id !== aiChild!.id)
      : msgs;

    store.setMessages([
      ...baseMsgs,
      {
        id: tempModelId,
        story_id: storyId,
        parent_id: message.id,
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

    try {
      // send_message inserts a NEW user message with parent = message.parent_id
      // (sibling of the current user message), then generates AI response.
      const result = await sendMessage(
        storyId,
        message.parent_id, // parent of the edited user msg = grandparent
        editedContent,
        tempModelId,
      );

      store.setIsGenerating(false);
      store.setStreamingMsgId(null);
      await onReloadBranch(result.model_msg.id);
    } catch (e) {
      console.error("Edit send failed:", e);
      toast.error(`Edit failed: ${e}`);
      store.setIsGenerating(false);
      store.setStreamingMsgId(null);
      await onReloadBranch();
    }
  }, [
    editPlot,
    editBg,
    editModTags,
    editConstraints,
    editImageBlocks,
    storyId,
    message.id,
    message.parent_id,
    isGenerating,
    hasSiblings,
    onReloadBranch,
  ]);

  // ─── Edit mode render ──────────────────────────────────────────────────
  if (editing) {
    return (
      <div className="flex justify-end" style={{ padding: "4px 0" }}>
        <div
          style={{
            maxWidth: "80%",
            width: "100%",
            backgroundColor: "var(--color-accent-subtle)",
            borderRadius: "8px",
            padding: "12px 14px",
            border: "1px solid var(--color-accent)",
          }}
        >
          <textarea
            value={editPlot}
            onChange={(e) => setEditPlot(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleSendEdit();
              }
            }}
            style={{
              width: "100%",
              minHeight: "60px",
              resize: "vertical",
              background: "var(--color-bg-pane)",
              border: "1px solid var(--color-border)",
              borderRadius: "6px",
              padding: "8px 10px",
              fontSize: "14px",
              fontFamily: "var(--font-theater-body)",
              color: "var(--color-text-primary)",
              lineHeight: 1.5,
              outline: "none",
            }}
          />
          {/* Background */}
          <textarea
            value={editBg}
            onChange={(e) => setEditBg(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleSendEdit();
              }
            }}
            placeholder="Background information..."
            style={{
              width: "100%",
              minHeight: "40px",
              resize: "vertical",
              marginTop: "6px",
              background: "var(--color-bg-pane)",
              border: "1px solid rgba(245,158,11,0.3)",
              borderRadius: "6px",
              padding: "6px 8px",
              fontSize: "12px",
              fontFamily: "var(--font-sans)",
              color: "var(--color-text-primary)",
              lineHeight: 1.4,
              outline: "none",
            }}
          />
          {/* Modificators */}
          <div style={{ marginTop: "6px" }}>
            <TagInput
              tags={editModTags}
              onChange={setEditModTags}
              placeholder="Type a tag, press comma to add..."
              fontSize={12}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleSendEdit();
                }
              }}
              style={{ padding: "3px 6px", minHeight: "30px" }}
            />
          </div>
          {/* Constraints */}
          <textarea
            value={editConstraints}
            onChange={(e) => setEditConstraints(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleSendEdit();
              }
            }}
            placeholder="What the AI must NOT write..."
            style={{
              width: "100%",
              minHeight: "40px",
              resize: "vertical",
              marginTop: "6px",
              background: "var(--color-bg-pane)",
              border: "1px solid rgba(244,63,94,0.3)",
              borderRadius: "6px",
              padding: "6px 8px",
              fontSize: "12px",
              fontFamily: "var(--font-sans)",
              color: "var(--color-text-primary)",
              lineHeight: 1.4,
              outline: "none",
            }}
          />
          {/* Image block chips (removable in edit mode) */}
          {editImageBlocks.length > 0 && (
            <div className="flex flex-wrap gap-1" style={{ marginTop: "6px" }}>
              {editImageBlocks.map((block) => {
                const absPath = imgAbsPaths[block.item_id];
                return (
                  <div
                    key={block.item_id}
                    className="flex items-center gap-1"
                    style={{
                      padding: "2px 6px 2px 2px",
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
                        style={{ width: 18, height: 18, objectFit: "cover", borderRadius: 2 }}
                      />
                    ) : null}
                    <button
                      onClick={() => setEditImageBlocks((prev) => prev.filter((b) => b.item_id !== block.item_id))}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", padding: 0, display: "flex" }}
                      title="Remove image"
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {/* Buttons */}
          <div
            className="flex items-center justify-end gap-2"
            style={{ marginTop: "8px" }}
          >
            <button
              onClick={handleCancelEdit}
              style={{
                background: "none",
                border: "1px solid var(--color-border)",
                borderRadius: "6px",
                padding: "4px 12px",
                cursor: "pointer",
                fontSize: "12px",
                fontFamily: "var(--font-sans)",
                color: "var(--color-text-secondary)",
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSendEdit}
              disabled={editPlot.trim() === ""}
              style={{
                background:
                  editPlot.trim() === ""
                    ? "var(--color-bg-active)"
                    : "var(--color-accent)",
                border: "none",
                borderRadius: "6px",
                padding: "4px 12px",
                cursor:
                  editPlot.trim() === "" ? "not-allowed" : "pointer",
                fontSize: "12px",
                fontFamily: "var(--font-sans)",
                fontWeight: 500,
                color: editPlot.trim() === "" ? "var(--color-text-muted)" : "#fff",
              }}
            >
              Send Edit
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Display mode render ────────────────────────────────────────────────
  return (
    <div
      className="group flex flex-col items-end"
      style={{ padding: "4px 0" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        style={{
          maxWidth: "80%",
          backgroundColor: "var(--color-accent-subtle)",
          borderRadius: "8px",
          padding: "12px 14px",
        }}
      >
        {/* Sibling nav in header if applicable */}
        {hasSiblings && (
          <div
            className="flex items-center"
            style={{
              fontSize: "11px",
              fontFamily: "var(--font-sans)",
              color: "var(--color-text-muted)",
              marginBottom: "4px",
            }}
          >
            <SiblingNav
              storyId={storyId}
              messageId={message.id}
              parentId={message.parent_id}
              onNavigate={onNavigateSibling}
            />
          </div>
        )}

        {/* Plot direction — always visible */}
        <p
          style={{
            fontSize: "14px",
            fontFamily: "var(--font-theater-body)",
            color: "var(--color-text-primary)",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            margin: 0,
          }}
        >
          {uc.plot_direction}
        </p>

        {/* Inline images — Doc 19 PATCH */}
        {uc.image_blocks && uc.image_blocks.length > 0 && (
          <div className="flex flex-wrap gap-2" style={{ marginTop: "8px" }}>
            {uc.image_blocks.map((block) => {
              const absPath = imgAbsPaths[block.item_id];
              return absPath ? (
                <InlineImage key={block.item_id} assetPath={absPath} />
              ) : null;
            })}
          </div>
        )}

        {/* Pills row */}
        {(uc.background_information.trim() || uc.modificators.length > 0 || (uc.constraints ?? "").trim() || (uc.context_doc_names && uc.context_doc_names.length > 0)) && (
          <div
            className="flex flex-wrap gap-1.5"
            style={{ marginTop: "8px" }}
          >
            {/* Background Information pill */}
            {uc.background_information.trim() && (
              <div>
                <button
                  onClick={() => setBgExpanded(!bgExpanded)}
                  className="flex items-center gap-1 transition-opacity duration-150"
                  style={{
                    background: "rgba(245,158,11,0.12)",
                    border: "1px solid rgba(245,158,11,0.25)",
                    borderRadius: "12px",
                    padding: "3px 8px",
                    cursor: "pointer",
                    fontSize: "11px",
                    fontFamily: "var(--font-sans)",
                    fontWeight: 500,
                    color: "var(--color-warning)",
                  }}
                >
                  <Brain size={12} />
                  Background
                </button>
                {bgExpanded && (
                  <div
                    style={{
                      marginTop: "6px",
                      borderLeft: "2px solid var(--color-warning)",
                      paddingLeft: "8px",
                      fontSize: "12px",
                      fontFamily: "var(--font-sans)",
                      color: "var(--color-text-secondary)",
                      lineHeight: 1.5,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {uc.background_information}
                  </div>
                )}
              </div>
            )}

            {/* Modificators pill */}
            {uc.modificators.length > 0 && (
              <div>
                <button
                  onClick={() => setModExpanded(!modExpanded)}
                  className="flex items-center gap-1 transition-opacity duration-150"
                  style={{
                    background: "rgba(124,58,237,0.12)",
                    border: "1px solid rgba(124,58,237,0.25)",
                    borderRadius: "12px",
                    padding: "3px 8px",
                    cursor: "pointer",
                    fontSize: "11px",
                    fontFamily: "var(--font-sans)",
                    fontWeight: 500,
                    color: "var(--color-accent-text)",
                  }}
                >
                  <Palette size={12} />
                  {truncateModificators(uc.modificators)}
                </button>
                {modExpanded && (
                  <div
                    className="flex flex-wrap gap-1"
                    style={{ marginTop: "6px" }}
                  >
                    {uc.modificators.map((mod, i) => (
                      <span
                        key={i}
                        style={{
                          background: "rgba(124,58,237,0.12)",
                          border: "1px solid rgba(124,58,237,0.25)",
                          borderRadius: "8px",
                          padding: "2px 6px",
                          fontSize: "11px",
                          fontFamily: "var(--font-sans)",
                          color: "var(--color-accent-text)",
                        }}
                      >
                        {mod}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Constraints pill */}
            {(uc.constraints ?? "").trim() && (
              <div>
                <button
                  onClick={() => setConstraintsExpanded(!constraintsExpanded)}
                  className="flex items-center gap-1 transition-opacity duration-150"
                  style={{
                    background: "rgba(244,63,94,0.12)",
                    border: "1px solid rgba(244,63,94,0.25)",
                    borderRadius: "12px",
                    padding: "3px 8px",
                    cursor: "pointer",
                    fontSize: "11px",
                    fontFamily: "var(--font-sans)",
                    fontWeight: 500,
                    color: "#f43f5e",
                  }}
                >
                  <ShieldAlert size={12} />
                  Constraints
                </button>
                {constraintsExpanded && (
                  <div
                    style={{
                      marginTop: "6px",
                      borderLeft: "2px solid #f43f5e",
                      paddingLeft: "8px",
                      fontSize: "12px",
                      fontFamily: "var(--font-sans)",
                      color: "var(--color-text-secondary)",
                      lineHeight: 1.5,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {uc.constraints}
                  </div>
                )}
              </div>
            )}

            {/* Context doc tags */}
            {uc.context_doc_names && uc.context_doc_names.length > 0 && (
              uc.context_doc_names.map((name, i) => {
                const maxLen = 18;
                const truncated = name.length > maxLen ? name.slice(0, maxLen) + "…" : name;
                return (
                  <span
                    key={i}
                    className="flex items-center gap-1"
                    title={name}
                    style={{
                      background: "rgba(59,130,246,0.1)",
                      border: "1px solid rgba(59,130,246,0.25)",
                      borderRadius: "12px",
                      padding: "3px 8px",
                      fontSize: "11px",
                      fontFamily: "var(--font-sans)",
                      fontWeight: 500,
                      color: "rgb(59,130,246)",
                    }}
                  >
                    <Paperclip size={10} />
                    {truncated}
                  </span>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Action row — visible on hover, below bubble — Doc 02 §5.2 */}
      {!isGenerating && !editing && (
        <div
          className="flex items-center gap-2"
          style={{
            padding: "4px 4px 0 0",
            opacity: hovered ? 1 : 0,
            pointerEvents: hovered ? "auto" : "none",
            transition: "opacity 120ms ease",
          }}
        >
          <button
            onClick={handleStartEdit}
            title="Edit"
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
            <Pencil size={16} />
            Edit
          </button>
        </div>
      )}
    </div>
  );
}

/** Truncate modificators to 32 chars with ellipsis — Doc 02 §5.3. */
function truncateModificators(mods: string[]): string {
  const joined = mods.join(" · ");
  if (joined.length <= 32) return joined;
  return joined.slice(0, 29) + "...";
}
