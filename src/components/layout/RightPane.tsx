import { useState, useEffect, useCallback, useRef } from "react";
import {
  PanelRightClose,
  GitFork,
  HelpCircle,
  MessageSquare,
  X,
  ChevronUp,
  ChevronDown,
} from "lucide-react";

import { useUiStore } from "../../stores/uiStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useVaultStore } from "../../stores/vaultStore";
import { useSettingsStore } from "../../stores/settingsStore";
import {
  vaultRenameItem,
  updateItemDescription,
  getBranchInfo,
  getStorySettings,
  detachContextDoc,
  updateMessageFeedback,
  getTelemetry,
} from "../../lib/tauriApi";
import type { TelemetryCounters } from "../../lib/types";

export function RightPane() {
  const setRightPaneCollapsed = useUiStore((s) => s.setRightPaneCollapsed);
  const activeStoryId = useWorkspaceStore((s) => s.activeStoryId);

  return (
    <div
      className="flex flex-col h-full shrink-0 overflow-hidden"
      style={{
        backgroundColor: "var(--color-bg-pane)",
        borderLeft: "1px solid var(--color-border)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 shrink-0"
        style={{
          height: "40px",
          borderBottom: "1px solid var(--color-border-subtle)",
        }}
      >
        <span
          style={{
            fontSize: "11px",
            fontWeight: 500,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--color-text-muted)",
          }}
        >
          Control Pane
        </span>
        <button
          onClick={() => setRightPaneCollapsed(true)}
          className="flex items-center justify-center transition-colors duration-150"
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            width: "24px",
            height: "24px",
            borderRadius: "4px",
            color: "var(--color-text-muted)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
            e.currentTarget.style.color = "var(--color-text-primary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
            e.currentTarget.style.color = "var(--color-text-muted)";
          }}
          title="Collapse Control Pane"
        >
          <PanelRightClose size={14} />
        </button>
      </div>

      {/* Body */}
      {!activeStoryId ? (
        <div className="flex-1 flex items-center justify-center px-3">
          <p
            style={{
              fontSize: "12px",
              color: "var(--color-text-muted)",
              textAlign: "center",
            }}
          >
            Open a story to see its details.
          </p>
        </div>
      ) : (
        <StoryControlPane storyId={activeStoryId} />
      )}
    </div>
  );
}

// ─── Story Control Pane (active story) ──────────────────────────────────────

function StoryControlPane({ storyId }: { storyId: string }) {
  const messages = useWorkspaceStore((s) => s.messages);
  const attachedDocIds = useWorkspaceStore((s) => s.attachedDocIds);
  const setAttachedDocIds = useWorkspaceStore((s) => s.setAttachedDocIds);
  const removeAttachedDocId = useWorkspaceStore((s) => s.removeAttachedDocId);
  const items = useVaultStore((s) => s.items);
  const setItems = useVaultStore((s) => s.setItems);
  const storyItem = items.find((i) => i.id === storyId);

  const [branchCount, setBranchCount] = useState(0);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // Load branch info
  useEffect(() => {
    getBranchInfo(storyId)
      .then(([bc, _tm]) => {
        setBranchCount(bc);
      })
      .catch(() => {
        setBranchCount(0);
      });
  }, [storyId, messages.length]);

  // Compute metadata from current messages
  const msgCount = messages.length;
  const wordCount = messages
    .filter((m) => m.role === "model")
    .reduce((sum, m) => sum + Math.round(m.content.length / 5), 0);

  // Load attached context doc IDs on story open
  useEffect(() => {
    getStorySettings(storyId)
      .then((settings) => {
        const raw = settings["context_doc_ids"];
        if (raw) {
          try {
            setAttachedDocIds(JSON.parse(raw));
          } catch {
            setAttachedDocIds([]);
          }
        } else {
          setAttachedDocIds([]);
        }
      })
      .catch(() => setAttachedDocIds([]));
  }, [storyId, setAttachedDocIds]);

  const handleDetachDoc = useCallback(
    (docId: string) => {
      // Optimistic: update UI immediately
      removeAttachedDocId(docId);
      detachContextDoc(storyId, docId).catch((err) => {
        console.error("Detach backend call failed (UI already updated):", err);
      });
    },
    [storyId, removeAttachedDocId],
  );

  // Depth: message pairs in current branch
  const depth = Math.floor(messages.length / 2);

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ position: "relative" }}>
      <div className="flex-1 overflow-y-auto">
        {/* §2: Story Title + Branch Info */}
        <div style={{ padding: "16px 14px 10px 14px" }}>
          <StoryTitle
            storyId={storyId}
            name={storyItem?.name ?? "Untitled"}
            items={items}
            setItems={setItems}
          />
          <div
            style={{
              fontSize: "11px",
              color: "var(--color-text-muted)",
              marginTop: "4px",
            }}
          >
            {branchCount > 0 && (
              <span>
                {branchCount} branch{branchCount !== 1 ? "es" : ""} &middot; depth {depth}
              </span>
            )}
          </div>
        </div>

        {/* §2.3: Story Description */}
        <StoryDescription
          storyId={storyId}
          description={storyItem?.description ?? null}
          items={items}
          setItems={setItems}
        />

        {/* Divider */}
        <hr style={{ border: "none", borderTop: "1px solid var(--color-border-subtle)", margin: "0 14px" }} />

        {/* §3: Metadata Strip */}
        <div
          style={{
            fontSize: "12px",
            color: "var(--color-text-muted)",
            padding: "10px 14px 12px 14px",
          }}
        >
          {msgCount} messages &middot; ~{wordCount.toLocaleString()} words
          {attachedDocIds.length > 0 && (
            <span> &middot; {attachedDocIds.length} doc{attachedDocIds.length !== 1 ? "s" : ""} attached</span>
          )}
        </div>

        {/* Divider */}
        <hr style={{ border: "none", borderTop: "1px solid var(--color-border-subtle)", margin: "0 14px" }} />

        {/* §4: Context Docs */}
        <ContextDocsSection
          storyId={storyId}
          attachedDocIds={attachedDocIds}
          onDetach={handleDetachDoc}
        />

        {/* Divider */}
        <hr style={{ border: "none", borderTop: "1px solid var(--color-border-subtle)", margin: "0 14px" }} />

        {/* §5: System Instructions */}
        <SystemInstructionsSection />

        {/* §6: Feedback Toggle */}
        <FeedbackToggle
          storyId={storyId}
          messages={messages}
          isOpen={feedbackOpen}
          onToggle={() => setFeedbackOpen(!feedbackOpen)}
        />
      </div>

      {/* §7: Telemetry Bars — placeholder pinned to bottom */}
      <TelemetrySection />

      {/* §6.2: Feedback Overlay — slides over content */}
      {feedbackOpen && (
        <FeedbackOverlay
          storyId={storyId}
          messages={messages}
          onClose={() => setFeedbackOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Story Title (inline rename) — Doc 10 §2 ───────────────────────────────

function StoryTitle({
  storyId,
  name,
  items,
  setItems,
}: {
  storyId: string;
  name: string;
  items: import("../../lib/types").VaultItemMeta[];
  setItems: (items: import("../../lib/types").VaultItemMeta[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const setBranchMapOpen = useUiStore((s) => s.setBranchMapOpen);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commitRename = useCallback(async () => {
    setEditing(false);
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === name) {
      setEditValue(name);
      return;
    }
    try {
      await vaultRenameItem(storyId, trimmed);
      setItems(items.map((i) => (i.id === storyId ? { ...i, name: trimmed } : i)));
    } catch {
      setEditValue(name);
    }
  }, [editValue, name, storyId, items, setItems]);

  return (
    <div className="flex items-center gap-2">
      {editing ? (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") {
              setEditValue(name);
              setEditing(false);
            }
          }}
          style={{
            flex: 1,
            fontSize: "14px",
            fontWeight: 600,
            fontFamily: "var(--font-sans)",
            color: "var(--color-text-primary)",
            background: "var(--color-bg-base)",
            border: "1px solid var(--color-border)",
            borderRadius: "4px",
            padding: "2px 6px",
            outline: "none",
          }}
        />
      ) : (
        <span
          onClick={() => {
            setEditValue(name);
            setEditing(true);
          }}
          style={{
            flex: 1,
            fontSize: "14px",
            fontWeight: 600,
            fontFamily: "var(--font-sans)",
            color: "var(--color-text-primary)",
            cursor: "text",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title="Click to rename"
        >
          {name}
        </span>
      )}
      <button
        onClick={() => {
          setBranchMapOpen(true);
        }}
        className="flex items-center justify-center shrink-0 transition-colors duration-150"
        style={{
          background: "transparent",
          border: "none",
          cursor: "pointer",
          width: "24px",
          height: "24px",
          borderRadius: "4px",
          color: "var(--color-text-muted)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--color-text-primary)";
          e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--color-text-muted)";
          e.currentTarget.style.backgroundColor = "transparent";
        }}
        title="Branch Map (Ctrl+M)"
      >
        <GitFork size={14} />
      </button>
    </div>
  );
}

// ─── Story Description — Doc 10 §2.3 ───────────────────────────────────────

function StoryDescription({
  storyId,
  description,
  items,
  setItems,
}: {
  storyId: string;
  description: string | null;
  items: import("../../lib/types").VaultItemMeta[];
  setItems: (items: import("../../lib/types").VaultItemMeta[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(description ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setEditValue(description ?? "");
  }, [description]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      autoGrow(textareaRef.current);
    }
  }, [editing]);

  const commitDescription = useCallback(async () => {
    setEditing(false);
    const trimmed = editValue.trim();
    if (trimmed === (description ?? "")) return;
    try {
      await updateItemDescription(storyId, trimmed);
      setItems(items.map((i) => (i.id === storyId ? { ...i, description: trimmed || null } : i)));
    } catch {
      setEditValue(description ?? "");
    }
  }, [editValue, description, storyId, items, setItems]);

  if (!editing && !description) {
    return (
      <div
        style={{ padding: "0 14px 10px 14px", cursor: "pointer" }}
        onClick={() => setEditing(true)}
      >
        <span style={{ fontSize: "12px", fontStyle: "italic", color: "var(--color-text-muted)" }}>
          Add a description...
        </span>
      </div>
    );
  }

  if (editing) {
    return (
      <div style={{ padding: "0 14px 10px 14px" }}>
        <textarea
          ref={textareaRef}
          value={editValue}
          onChange={(e) => {
            setEditValue(e.target.value);
            autoGrow(e.target);
          }}
          onBlur={commitDescription}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setEditValue(description ?? "");
              setEditing(false);
            }
          }}
          style={{
            width: "100%",
            fontSize: "12px",
            fontStyle: "italic",
            fontFamily: "var(--font-sans)",
            color: "var(--color-text-secondary)",
            background: "var(--color-bg-base)",
            border: "1px solid var(--color-border)",
            borderRadius: "4px",
            padding: "6px 8px",
            outline: "none",
            resize: "none",
            minHeight: "40px",
            lineHeight: 1.5,
          }}
        />
      </div>
    );
  }

  return (
    <div
      style={{ padding: "0 14px 10px 14px", cursor: "pointer" }}
      onClick={() => setEditing(true)}
    >
      <span style={{ fontSize: "12px", fontStyle: "italic", color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
        {description}
      </span>
    </div>
  );
}

function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

// ─── Context Docs — Doc 10 §4 ──────────────────────────────────────────────

function ContextDocsSection({
  attachedDocIds,
  onDetach,
}: {
  storyId: string;
  attachedDocIds: string[];
  onDetach: (docId: string) => void;
}) {
  const items = useVaultStore((s) => s.items);
  const openDoc = useWorkspaceStore((s) => s.openDoc);

  const handleOpenDoc = useCallback(async (docId: string) => {
    try {
      const { vaultGetItem } = await import("../../lib/tauriApi");
      const fullItem = await vaultGetItem(docId);
      openDoc(docId, fullItem.content, fullItem.name, fullItem.item_subtype, fullItem.item_type);
    } catch (e) {
      console.error("Failed to open doc:", e);
    }
  }, [openDoc]);

  const attachedDocs = attachedDocIds
    .map((id) => items.find((i) => i.id === id))
    .filter(Boolean) as import("../../lib/types").VaultItemMeta[];

  return (
    <div style={{ padding: "12px 14px" }}>
      <div className="flex items-center justify-between" style={{ marginBottom: "8px" }}>
        <SectionHeader>Context Docs</SectionHeader>
        <button
          title="Source documents attached here are sent to the AI with every message as context."
          className="flex items-center justify-center"
          style={{
            background: "transparent",
            border: "none",
            cursor: "help",
            color: "var(--color-text-muted)",
            width: "16px",
            height: "16px",
          }}
        >
          <HelpCircle size={12} />
        </button>
      </div>

      {attachedDocs.length === 0 ? (
        <p
          style={{
            fontSize: "12px",
            color: "var(--color-text-muted)",
            textAlign: "center",
            padding: "12px 0",
          }}
        >
          No documents attached.
          <br />
          <span style={{ fontSize: "11px" }}>
            Attach source documents via the navigator.
          </span>
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {attachedDocs.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center gap-2"
              style={{
                backgroundColor: "var(--color-bg-elevated)",
                border: "1px solid var(--color-border)",
                borderRadius: "6px",
                padding: "6px 8px",
              }}
            >
              <span
                onClick={() => handleOpenDoc(doc.id)}
                style={{ fontSize: "12px", color: "var(--color-text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}
                title="Open in editor"
              >
                {doc.name}
              </span>
              {doc.item_subtype && (
                <span style={{ fontSize: "11px", fontStyle: "italic", color: "var(--color-text-muted)", flexShrink: 0 }}>
                  {doc.item_subtype}
                </span>
              )}
              <button
                onClick={() => onDetach(doc.id)}
                className="flex items-center justify-center shrink-0 transition-colors duration-150"
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--color-text-muted)",
                  width: "16px",
                  height: "16px",
                  borderRadius: "2px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-text-primary)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-text-muted)")}
                title="Detach document"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── System Instructions — Doc 10 §5 ───────────────────────────────────────

function SystemInstructionsSection() {
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const activeSlot = useSettingsStore((s) => s.get("active_si_slot", "1"));
  const si1Content = useSettingsStore((s) => s.get("system_instructions", ""));
  const si2Content = useSettingsStore((s) => s.get("system_instructions_2", ""));
  const si1Name = useSettingsStore((s) => s.get("si_slot_1_name", "SI 1"));
  const si2Name = useSettingsStore((s) => s.get("si_slot_2_name", "SI 2"));

  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("ctrl_sysinstr_collapsed") === "true",
  );

  const currentKey = activeSlot === "2" ? "system_instructions_2" : "system_instructions";
  const currentContent = activeSlot === "2" ? si2Content : si1Content;
  const [localValue, setLocalValue] = useState(currentContent);
  const [editingName, setEditingName] = useState(false);

  useEffect(() => {
    setLocalValue(currentContent);
  }, [currentContent, activeSlot]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("ctrl_sysinstr_collapsed", String(next));
  };

  const handleBlur = useCallback(async () => {
    if (localValue !== currentContent) {
      await updateSetting(currentKey, localValue);
    }
  }, [localValue, currentContent, currentKey, updateSetting]);

  const handleSlotToggle = useCallback(async () => {
    const newSlot = activeSlot === "1" ? "2" : "1";
    await updateSetting("active_si_slot", newSlot);
  }, [activeSlot, updateSetting]);

  const currentName = activeSlot === "2" ? si2Name : si1Name;
  const nameKey = activeSlot === "2" ? "si_slot_2_name" : "si_slot_1_name";

  return (
    <div style={{ padding: "12px 14px" }}>
      <div className="flex items-center justify-between" style={{ marginBottom: collapsed ? "0" : "8px" }}>
        <div className="flex items-center gap-2">
          <SectionHeader>System Instructions</SectionHeader>
          {/* SI slot pill toggle */}
          <div
            style={{
              display: "inline-flex",
              borderRadius: "10px",
              border: "1px solid var(--color-border)",
              overflow: "hidden",
              fontSize: "9px",
              fontFamily: "var(--font-mono)",
              fontWeight: 600,
              letterSpacing: "0.04em",
              cursor: "pointer",
            }}
          >
            <button
              onClick={() => { if (activeSlot !== "1") handleSlotToggle(); }}
              style={{
                background: activeSlot === "1" ? "var(--color-accent)" : "var(--color-bg-active)",
                color: activeSlot === "1" ? "var(--color-text-on-accent)" : "var(--color-text-muted)",
                border: "none",
                padding: "2px 8px",
                cursor: "pointer",
                maxWidth: "70px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                transition: "background 150ms ease, color 150ms ease",
              }}
              title={si1Name}
            >
              {si1Name}
            </button>
            <button
              onClick={() => { if (activeSlot !== "2") handleSlotToggle(); }}
              style={{
                background: activeSlot === "2" ? "var(--color-accent)" : "var(--color-bg-active)",
                color: activeSlot === "2" ? "var(--color-text-on-accent)" : "var(--color-text-muted)",
                border: "none",
                borderLeft: "1px solid var(--color-border)",
                padding: "2px 8px",
                cursor: "pointer",
                maxWidth: "70px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                transition: "background 150ms ease, color 150ms ease",
              }}
              title={si2Name}
            >
              {si2Name}
            </button>
          </div>
        </div>
        <button
          onClick={toggleCollapsed}
          className="flex items-center justify-center"
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--color-text-muted)",
            width: "16px",
            height: "16px",
          }}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </button>
      </div>

      {!collapsed && (
        <>
          {/* Editable slot name */}
          <div className="flex items-center gap-1" style={{ marginBottom: "4px" }}>
            {editingName ? (
              <input
                autoFocus
                defaultValue={currentName}
                onBlur={async (e) => {
                  const name = e.target.value.trim() || (activeSlot === "1" ? "SI 1" : "SI 2");
                  await updateSetting(nameKey, name);
                  setEditingName(false);
                }}
                onKeyDown={async (e) => {
                  if (e.key === "Enter") {
                    (e.target as HTMLInputElement).blur();
                  } else if (e.key === "Escape") {
                    setEditingName(false);
                  }
                }}
                style={{
                  fontSize: "11px",
                  fontFamily: "var(--font-sans)",
                  color: "var(--color-text-primary)",
                  background: "var(--color-bg-base)",
                  border: "1px solid var(--color-accent)",
                  borderRadius: "3px",
                  padding: "1px 4px",
                  outline: "none",
                  width: "100px",
                }}
              />
            ) : (
              <span
                onClick={() => setEditingName(true)}
                style={{
                  fontSize: "11px",
                  fontFamily: "var(--font-sans)",
                  color: "var(--color-text-muted)",
                  cursor: "pointer",
                }}
                title="Click to rename"
              >
                {currentName}
              </span>
            )}
          </div>

          <textarea
            value={localValue}
            onChange={(e) => {
              setLocalValue(e.target.value);
              autoGrow(e.target);
            }}
            onBlur={handleBlur}
            placeholder="You are a master storyteller..."
            style={{
              width: "100%",
              fontSize: "12px",
              fontFamily: "var(--font-sans)",
              color: "var(--color-text-secondary)",
              background: "var(--color-bg-base)",
              border: "1px solid var(--color-border)",
              borderRadius: "6px",
              padding: "8px 10px",
              outline: "none",
              resize: "none",
              minHeight: "80px",
              lineHeight: 1.5,
            }}
          />
          <p style={{ fontSize: "11px", color: "var(--color-text-muted)", marginTop: "4px" }}>
            Active slot applied to every AI request.
          </p>
        </>
      )}
    </div>
  );
}

// ─── Feedback Toggle — Doc 10 §6.1 ─────────────────────────────────────────

function FeedbackToggle({
  messages,
  isOpen,
  onToggle,
}: {
  storyId: string;
  messages: import("../../lib/types").ChatMessage[];
  isOpen: boolean;
  onToggle: () => void;
}) {
  const feedbackCount = messages.filter(
    (m) => m.role === "model" && m.user_feedback && m.user_feedback.trim().length > 0,
  ).length;

  return (
    <div style={{ padding: "8px 14px 12px 14px" }}>
      <button
        onClick={onToggle}
        className="flex items-center gap-2 transition-colors duration-150"
        style={{
          background: isOpen ? "var(--color-bg-active)" : "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
          borderRadius: "6px",
          padding: "8px 12px",
          cursor: "pointer",
          width: "100%",
          fontSize: "12px",
          fontFamily: "var(--font-sans)",
          color: "var(--color-text-secondary)",
        }}
        onMouseEnter={(e) => {
          if (!isOpen) e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
        }}
        onMouseLeave={(e) => {
          if (!isOpen) e.currentTarget.style.backgroundColor = "var(--color-bg-elevated)";
        }}
      >
        <MessageSquare size={13} />
        <span>Feedback</span>
        {feedbackCount > 0 && (
          <span
            style={{
              backgroundColor: "var(--color-accent)",
              color: "var(--color-text-on-accent)",
              borderRadius: "10px",
              padding: "1px 6px",
              fontSize: "10px",
              fontWeight: 600,
              marginLeft: "auto",
            }}
          >
            {feedbackCount}
          </span>
        )}
      </button>
    </div>
  );
}

// ─── Feedback Overlay — Doc 10 §6.2–§6.4 ───────────────────────────────────

function FeedbackOverlay({
  messages,
  onClose,
}: {
  storyId: string;
  messages: import("../../lib/types").ChatMessage[];
  onClose: () => void;
}) {
  const feedbackMsgs = messages.filter((m) => m.role === "model" && m.user_feedback);
  const [visible, setVisible] = useState(false);

  // Trigger slide-in on mount
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        bottom: "60px", // above telemetry
        background: "var(--color-bg-base)",
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        transform: visible ? "translateX(0)" : "translateX(100%)",
        transition: "transform 200ms ease",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 shrink-0"
        style={{
          height: "36px",
          borderBottom: "1px solid var(--color-border-subtle)",
        }}
      >
        <span style={{ fontSize: "11px", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-text-muted)" }}>
          Feedback
        </span>
        <button
          onClick={onClose}
          className="flex items-center justify-center"
          style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--color-text-muted)", width: "20px", height: "20px", borderRadius: "4px" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-text-primary)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-text-muted)")}
        >
          <X size={14} />
        </button>
      </div>

      {/* Feedback list */}
      <div className="flex-1 overflow-y-auto" style={{ padding: "8px 12px" }}>
        {feedbackMsgs.length === 0 ? (
          <p style={{ fontSize: "12px", color: "var(--color-text-muted)", textAlign: "center", padding: "24px 0" }}>
            No feedback notes yet.
            <br />
            <span style={{ fontSize: "11px" }}>
              Add feedback via the speech bubble icon on any AI message.
            </span>
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {feedbackMsgs.map((msg) => (
              <FeedbackEntry key={msg.id} message={msg} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FeedbackEntry({ message }: { message: import("../../lib/types").ChatMessage }) {
  const [value, setValue] = useState(message.user_feedback ?? "");

  const handleBlur = useCallback(async () => {
    const trimmed = value.trim();
    if (trimmed !== (message.user_feedback ?? "")) {
      await updateMessageFeedback(message.id, trimmed);
      // Update in workspace store
      const store = useWorkspaceStore.getState();
      store.setMessages(
        store.messages.map((m) =>
          m.id === message.id ? { ...m, user_feedback: trimmed || null } : m,
        ),
      );
    }
  }, [value, message.id, message.user_feedback]);

  const excerpt = message.content.slice(0, 60) + (message.content.length > 60 ? "..." : "");

  const hasFeedback = value.trim().length > 0;

  return (
    <div
      style={{
        backgroundColor: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
        borderRadius: "6px",
        padding: "8px 10px",
      }}
    >
      <p
        style={{
          fontSize: "11px",
          fontStyle: "italic",
          color: "var(--color-text-muted)",
          marginBottom: "6px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={message.content.slice(0, 200)}
      >
        "{excerpt}"
      </p>
      <button
        onClick={() => {
          window.dispatchEvent(
            new CustomEvent("loom:scroll-to-message", { detail: { messageId: message.id } }),
          );
        }}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: "10px",
          fontFamily: "var(--font-sans)",
          color: "var(--color-accent)",
          padding: 0,
          marginBottom: "4px",
        }}
      >
        {"→ Go to msg"}
      </button>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        placeholder="Add feedback..."
        style={{
          width: "100%",
          fontSize: "12px",
          fontFamily: "var(--font-sans)",
          color: hasFeedback ? "var(--color-text-primary)" : "var(--color-text-muted)",
          background: "var(--color-bg-base)",
          border: "1px solid var(--color-border)",
          borderRadius: "4px",
          padding: "6px 8px",
          outline: "none",
          resize: "none",
          minHeight: "36px",
          lineHeight: 1.4,
        }}
      />
    </div>
  );
}

// ─── Telemetry — Doc 10 §7 ──────────────────────────────────────────────────

function TelemetrySection() {
  const [counters, setCounters] = useState<TelemetryCounters | null>(null);
  const isGenerating = useWorkspaceStore((s) => s.isGenerating);

  useEffect(() => {
    let mounted = true;

    const refresh = () => {
      getTelemetry()
        .then((c) => { if (mounted) setCounters(c); })
        .catch(() => {});
    };

    refresh();
    // Poll every 5s, or immediately after generation finishes
    const interval = setInterval(refresh, 5000);
    return () => { mounted = false; clearInterval(interval); };
  }, [isGenerating]);

  const rpm = counters?.rpm_limit ?? 10;
  const tpm = counters?.tpm_limit ?? 250000;
  const rpd = counters?.rpd_limit ?? 1500;

  return (
    <div
      className="shrink-0"
      style={{
        borderTop: "1px solid var(--color-border-subtle)",
        padding: "12px 14px",
      }}
    >
      <SectionHeader>Usage</SectionHeader>
      <div style={{ marginTop: "8px" }}>
        <TelemetryBar label="RPM" used={counters?.req_count_min ?? 0} limit={rpm} />
        <TelemetryBar label="TPM" used={counters?.token_count_min ?? 0} limit={tpm} />
        <TelemetryBar label="RPD" used={counters?.req_count_day ?? 0} limit={rpd} />
      </div>
    </div>
  );
}

function TelemetryBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? (used / limit) * 100 : 0;
  const color =
    pct > 80 ? "var(--color-error)" : pct > 60 ? "var(--color-warning)" : "#10b981";

  return (
    <div className="flex items-center gap-2" style={{ marginBottom: "4px" }}>
      <span style={{ fontSize: "10px", fontFamily: "var(--font-mono)", color: "var(--color-text-muted)", width: "28px" }}>
        {label}
      </span>
      <div style={{ flex: 1, height: "4px", backgroundColor: "var(--color-bg-active)", borderRadius: "2px" }}>
        <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", backgroundColor: color, borderRadius: "2px", transition: "width 200ms ease" }} />
      </div>
      <span style={{ fontSize: "10px", fontFamily: "var(--font-mono)", color: "var(--color-text-muted)", minWidth: "60px", textAlign: "right" }}>
        {used.toLocaleString()} / {limit.toLocaleString()}
      </span>
    </div>
  );
}

// ─── Shared ─────────────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: "10px",
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--color-text-muted)",
      }}
    >
      {children}
    </span>
  );
}
