import { useState, useCallback } from "react";
import { Brain, Palette, Pencil } from "lucide-react";
import { toast } from "sonner";
import { parseUserContent } from "../../lib/types";
import { SiblingNav } from "./SiblingNav";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { sendMessage } from "../../lib/tauriApi";
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
  hasSiblings,
  onNavigateSibling,
  onReloadBranch,
  storyId,
}: UserBubbleProps) {
  const uc = parseUserContent(message.content);
  const [bgExpanded, setBgExpanded] = useState(false);
  const [modExpanded, setModExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);

  // Edit state
  const [editPlot, setEditPlot] = useState(uc.plot_direction);
  const [editBg, setEditBg] = useState(uc.background_information);
  const [editMods, setEditMods] = useState(uc.modificators.join(", "));

  const isGenerating = useWorkspaceStore((s) => s.isGenerating);

  const handleStartEdit = useCallback(() => {
    setEditPlot(uc.plot_direction);
    setEditBg(uc.background_information);
    setEditMods(uc.modificators.join(", "));
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
      modificators: editMods
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    };

    setEditing(false);

    const tempModelId = `temp-model-${Date.now()}`;
    const now = new Date().toISOString();

    // Optimistic model placeholder
    store.setMessages([
      ...store.messages,
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
      // Both Case A and Case B: create new user msg as sibling, then AI generates.
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
    editMods,
    storyId,
    message.id,
    message.parent_id,
    isGenerating,
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
          <input
            type="text"
            value={editMods}
            onChange={(e) => setEditMods(e.target.value)}
            placeholder="Modificators (comma-separated)..."
            style={{
              width: "100%",
              marginTop: "6px",
              background: "var(--color-bg-pane)",
              border: "1px solid rgba(124,58,237,0.3)",
              borderRadius: "6px",
              padding: "6px 8px",
              fontSize: "12px",
              fontFamily: "var(--font-sans)",
              color: "var(--color-text-primary)",
              outline: "none",
            }}
          />
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

        {/* Pills row */}
        {(uc.background_information.trim() || uc.modificators.length > 0) && (
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
          </div>
        )}
      </div>

      {/* Action row — visible on hover, below bubble — Doc 02 §5.2 */}
      {hovered && !isGenerating && !editing && (
        <div
          className="flex items-center gap-2"
          style={{
            padding: "4px 4px 0 0",
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
