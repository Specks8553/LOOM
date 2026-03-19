import { useState, useEffect, useRef } from "react";
import { X, Plus, Loader2, ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { useVaultStore } from "../../stores/vaultStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { WorldMeta } from "../../lib/types";
import {
  listWorlds,
  createWorld,
  switchWorld,
  deleteWorld,
  restoreWorldCmd,
  purgeWorld,
  listDeletedWorlds,
  vaultListItems,
} from "../../lib/tauriApi";

// ─── Delete Confirmation Dialog ───────────────────────────────────────────────

function DeleteConfirmDialog({
  worldName,
  onConfirm,
  onCancel,
}: {
  worldName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-[60]"
      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
    >
      <div
        style={{
          width: "420px",
          backgroundColor: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
          borderRadius: "8px",
          padding: "24px",
        }}
      >
        <h3 style={{ fontSize: "15px", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "12px" }}>
          Delete "{worldName}"?
        </h3>
        <p style={{ fontSize: "13px", color: "var(--color-text-muted)", marginBottom: "12px", lineHeight: 1.5 }}>
          Type the world name to confirm. This world will be moved to Trash.
        </p>
        <input
          ref={inputRef}
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && typed === worldName) onConfirm(); }}
          placeholder={worldName}
          className="w-full outline-none mb-3"
          style={{
            backgroundColor: "var(--color-bg-hover)",
            border: "1px solid var(--color-border)",
            borderRadius: "6px",
            padding: "8px 12px",
            fontSize: "13px",
            color: "var(--color-text-primary)",
          }}
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            style={{
              background: "transparent",
              border: "none",
              padding: "6px 14px",
              fontSize: "13px",
              color: "var(--color-text-secondary)",
              cursor: "pointer",
              borderRadius: "6px",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={typed !== worldName}
            style={{
              backgroundColor: typed === worldName ? "var(--color-error)" : "var(--color-bg-active)",
              color: typed === worldName ? "#fff" : "var(--color-text-muted)",
              border: "none",
              borderRadius: "6px",
              padding: "6px 14px",
              fontSize: "13px",
              fontWeight: 500,
              cursor: typed === worldName ? "pointer" : "not-allowed",
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── World Card ───────────────────────────────────────────────────────────────

function WorldCard({
  world,
  isActive,
  onClick,
  onDelete,
}: {
  world: WorldMeta;
  isActive: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="relative group transition-colors duration-150"
      style={{
        width: "100%",
        height: "140px",
        backgroundColor: "var(--color-bg-hover)",
        borderRadius: "8px",
        padding: "16px",
        cursor: "pointer",
        outline: isActive ? `2px solid ${world.accent_color}` : "1px solid var(--color-border)",
        outlineOffset: isActive ? "-2px" : "-1px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        gap: "4px",
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.outline = "1px solid var(--color-text-muted)";
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.outline = "1px solid var(--color-border)";
      }}
    >
      {/* Delete button (hover) */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
        style={{
          background: "transparent",
          border: "none",
          color: "var(--color-text-muted)",
          cursor: "pointer",
          padding: "4px",
        }}
        title="Delete world"
      >
        <Trash2 size={14} />
      </button>

      <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--color-text-primary)" }}>
        {world.name}
      </span>
      {world.tags.length > 0 && (
        <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
          {world.tags.join(" · ")}
        </span>
      )}
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

export function WorldPickerModal() {
  const open = useUiStore((s) => s.worldPickerOpen);
  const setOpen = useUiStore((s) => s.setWorldPickerOpen);
  const activeWorldId = useVaultStore((s) => s.activeWorldId);
  const setActiveWorldId = useVaultStore((s) => s.setActiveWorldId);
  const setItems = useVaultStore((s) => s.setItems);
  const setWorlds = useVaultStore((s) => s.setWorlds);

  const isGenerating = useWorkspaceStore((s) => s.isGenerating);

  const [worlds, setLocalWorlds] = useState<WorldMeta[]>([]);
  const [deletedWorlds, setDeletedWorlds] = useState<WorldMeta[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newWorldName, setNewWorldName] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WorldMeta | null>(null);
  const [switchPendingId, setSwitchPendingId] = useState<string | null>(null);
  const newNameRef = useRef<HTMLInputElement>(null);

  // Load worlds when modal opens
  useEffect(() => {
    if (!open) return;
    loadWorlds();
  }, [open]);

  useEffect(() => {
    if (showNewForm) newNameRef.current?.focus();
  }, [showNewForm]);

  const loadWorlds = async () => {
    try {
      const [active, deleted] = await Promise.all([listWorlds(), listDeletedWorlds()]);
      setLocalWorlds(active);
      setDeletedWorlds(deleted);
      setWorlds(active);
    } catch (e) {
      console.error("Failed to load worlds:", e);
    }
  };

  const handleSwitch = async (worldId: string) => {
    if (worldId === activeWorldId) {
      setOpen(false);
      return;
    }
    // Confirm if AI generation is in progress
    if (isGenerating) {
      setSwitchPendingId(worldId);
      return;
    }
    await performSwitch(worldId);
  };

  const performSwitch = async (worldId: string) => {
    try {
      await switchWorld(worldId);
      // Clear workspace state so Theater doesn't show stale content
      useWorkspaceStore.getState().clearWorkspace();
      setActiveWorldId(worldId);
      const items = await vaultListItems();
      setItems(items);
      setSwitchPendingId(null);
      setOpen(false);
    } catch (e) {
      console.error("Failed to switch world:", e);
    }
  };

  const handleCreate = async () => {
    if (newWorldName.trim().length < 2 || creating) return;
    setCreating(true);
    try {
      await createWorld(newWorldName.trim());
      // Clear workspace state so Theater doesn't show stale content from previous world
      useWorkspaceStore.getState().clearWorkspace();
      setNewWorldName("");
      setShowNewForm(false);
      await loadWorlds();
    } catch (e) {
      console.error("Failed to create world:", e);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (world: WorldMeta) => {
    try {
      await deleteWorld(world.id);
      // If deleted the active world, switch to first remaining
      if (world.id === activeWorldId) {
        const remaining = worlds.filter((w) => w.id !== world.id);
        if (remaining.length > 0) {
          await handleSwitch(remaining[0].id);
        }
      }
      await loadWorlds();
    } catch (e) {
      console.error("Failed to delete world:", e);
    }
    setDeleteTarget(null);
  };

  const handleRestore = async (worldId: string) => {
    try {
      await restoreWorldCmd(worldId);
      await loadWorlds();
    } catch (e) {
      console.error("Failed to restore world:", e);
    }
  };

  const handlePurge = async (worldId: string) => {
    try {
      await purgeWorld(worldId);
      await loadWorlds();
    } catch (e) {
      console.error("Failed to purge world:", e);
    }
  };

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (switchPendingId) {
          setSwitchPendingId(null);
        } else if (deleteTarget) {
          setDeleteTarget(null);
        } else {
          setOpen(false);
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, deleteTarget, switchPendingId, setOpen]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50"
        style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        onClick={() => setOpen(false)}
      />

      {/* Modal */}
      <div
        className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{
          width: "600px",
          maxHeight: "70vh",
          backgroundColor: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
          borderRadius: "8px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 shrink-0"
          style={{
            height: "48px",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary)" }}>
            Worlds
          </span>
          <button
            onClick={() => setOpen(false)}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--color-text-muted)",
              cursor: "pointer",
              padding: "4px",
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5" style={{ minHeight: 0 }}>
          {/* World cards grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "16px",
            }}
          >
            {worlds.map((w) => (
              <WorldCard
                key={w.id}
                world={w}
                isActive={w.id === activeWorldId}
                onClick={() => handleSwitch(w.id)}
                onDelete={() => setDeleteTarget(w)}
              />
            ))}

            {/* New World card */}
            {showNewForm ? (
              <div
                style={{
                  height: "140px",
                  backgroundColor: "var(--color-bg-hover)",
                  borderRadius: "8px",
                  padding: "16px",
                  border: "1px solid var(--color-border)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  gap: "8px",
                }}
              >
                <input
                  ref={newNameRef}
                  type="text"
                  value={newWorldName}
                  onChange={(e) => setNewWorldName(e.target.value.slice(0, 80))}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setShowNewForm(false); }}
                  placeholder="World name"
                  className="w-full outline-none"
                  style={{
                    backgroundColor: "var(--color-bg-elevated)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "4px",
                    padding: "6px 10px",
                    fontSize: "13px",
                    color: "var(--color-text-primary)",
                  }}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowNewForm(false)}
                    style={{
                      background: "transparent",
                      border: "none",
                      fontSize: "12px",
                      color: "var(--color-text-muted)",
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={newWorldName.trim().length < 2 || creating}
                    className="flex items-center gap-1"
                    style={{
                      backgroundColor: newWorldName.trim().length < 2 || creating ? "var(--color-bg-active)" : "var(--color-accent)",
                      color: newWorldName.trim().length < 2 || creating ? "var(--color-text-muted)" : "var(--color-text-on-accent)",
                      border: "none",
                      borderRadius: "4px",
                      padding: "4px 12px",
                      fontSize: "12px",
                      fontWeight: 500,
                      cursor: newWorldName.trim().length < 2 || creating ? "not-allowed" : "pointer",
                    }}
                  >
                    {creating && <Loader2 size={12} className="animate-spin" />}
                    Create
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => setShowNewForm(true)}
                className="flex items-center justify-center gap-2 transition-colors duration-150"
                style={{
                  height: "140px",
                  backgroundColor: "var(--color-bg-hover)",
                  borderRadius: "8px",
                  border: "1px dashed var(--color-border)",
                  cursor: "pointer",
                  color: "var(--color-text-muted)",
                  fontSize: "13px",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--color-text-muted)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
              >
                <Plus size={16} />
                New World
              </div>
            )}
          </div>

          {/* Trash section */}
          {deletedWorlds.length > 0 && (
            <div className="mt-6">
              <button
                onClick={() => setShowTrash(!showTrash)}
                className="flex items-center gap-1 mb-3"
                style={{
                  background: "transparent",
                  border: "none",
                  fontSize: "11px",
                  color: "var(--color-text-muted)",
                  cursor: "pointer",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  fontWeight: 500,
                }}
              >
                {showTrash ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Trash ({deletedWorlds.length})
              </button>

              {showTrash && (
                <div className="flex flex-col gap-2">
                  {deletedWorlds.map((w) => (
                    <div
                      key={w.id}
                      className="flex items-center justify-between"
                      style={{
                        backgroundColor: "var(--color-bg-hover)",
                        borderRadius: "6px",
                        padding: "10px 14px",
                        border: "1px solid var(--color-border-subtle)",
                      }}
                    >
                      <span style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
                        {w.name}
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleRestore(w.id)}
                          style={{
                            background: "transparent",
                            border: "1px solid var(--color-border)",
                            borderRadius: "4px",
                            padding: "3px 10px",
                            fontSize: "11px",
                            color: "var(--color-text-secondary)",
                            cursor: "pointer",
                          }}
                        >
                          Restore
                        </button>
                        <button
                          onClick={() => handlePurge(w.id)}
                          style={{
                            background: "transparent",
                            border: "1px solid var(--color-error)",
                            borderRadius: "4px",
                            padding: "3px 10px",
                            fontSize: "11px",
                            color: "var(--color-error)",
                            cursor: "pointer",
                          }}
                        >
                          Delete Permanently
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation dialog */}
      {deleteTarget && (
        <DeleteConfirmDialog
          worldName={deleteTarget.name}
          onConfirm={() => handleDelete(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Switch-during-generation confirmation */}
      {switchPendingId && (
        <div
          className="fixed inset-0 flex items-center justify-center z-[60]"
          style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
        >
          <div
            style={{
              width: "400px",
              backgroundColor: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              borderRadius: "8px",
              padding: "24px",
            }}
          >
            <h3 style={{ fontSize: "15px", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "12px" }}>
              AI generation in progress
            </h3>
            <p style={{ fontSize: "13px", color: "var(--color-text-muted)", marginBottom: "16px", lineHeight: 1.5 }}>
              Switching worlds will cancel the current generation. Continue?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setSwitchPendingId(null)}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: "6px 14px",
                  fontSize: "13px",
                  color: "var(--color-text-secondary)",
                  cursor: "pointer",
                  borderRadius: "6px",
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => performSwitch(switchPendingId)}
                style={{
                  backgroundColor: "var(--color-accent)",
                  color: "var(--color-text-on-accent)",
                  border: "none",
                  borderRadius: "6px",
                  padding: "6px 14px",
                  fontSize: "13px",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Switch Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
