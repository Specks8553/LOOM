import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Bookmark, Trash2, Type, Map as MapIcon, Scissors } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";

import { useUiStore } from "../../stores/uiStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useVaultStore } from "../../stores/vaultStore";
import { useBranchMapStore } from "../../stores/branchMapStore";
import { BranchMapTree } from "./BranchMapTree";
import { CheckpointMarker } from "./CheckpointMarker";
import {
  createCheckpointCmd,
  renameCheckpointCmd,
  deleteCheckpointCmd,
  deleteBranchFrom,
  loadStoryMessages,
  setStoryLeafId,
  undeleteMessage,
} from "../../lib/tauriApi";
import { ContextMenu, useContextMenu } from "../shared/ContextMenu";
import type { BranchMapNode as NodeType, Checkpoint } from "../../lib/types";

const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 300;
const LS_KEY = "branch_map_width";

export function BranchMapDrawer() {
  const isOpen = useUiStore((s) => s.branchMapOpen);
  const close = useUiStore((s) => s.setBranchMapOpen);
  const activeStoryId = useWorkspaceStore((s) => s.activeStoryId);
  const isGenerating = useWorkspaceStore((s) => s.isGenerating);
  const data = useBranchMapStore((s) => s.data);
  const isLoading = useBranchMapStore((s) => s.isLoading);
  const load = useBranchMapStore((s) => s.load);
  const clear = useBranchMapStore((s) => s.clear);
  const scrollToId = useBranchMapStore((s) => s.scrollToId);
  const setScrollTo = useBranchMapStore((s) => s.setScrollTo);

  const { contextMenu, showContextMenu, hideContextMenu } = useContextMenu();

  // ─── Width + resize ─────────────────────────────────────────────────────
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem(LS_KEY);
    return saved ? Math.max(MIN_WIDTH, parseInt(saved, 10)) : DEFAULT_WIDTH;
  });
  const isResizing = useRef(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    const startX = e.clientX;
    const startWidth = width;

    const onMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = startX - ev.clientX;
      const maxW = window.innerWidth * 0.7;
      const newW = Math.min(maxW, Math.max(MIN_WIDTH, startWidth + delta));
      setWidth(newW);
    };

    const onUp = () => {
      isResizing.current = false;
      setWidth((w) => {
        localStorage.setItem(LS_KEY, String(w));
        return w;
      });
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [width]);

  // ─── Load data on open ──────────────────────────────────────────────────
  useEffect(() => {
    if (isOpen && activeStoryId) {
      load(activeStoryId);
    } else if (!isOpen) {
      clear();
    }
  }, [isOpen, activeStoryId, load, clear]);

  // ─── Live updates via Tauri event ───────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const unlisten = listen<string>("branch_map_updated", (event) => {
      if (activeStoryId && event.payload === activeStoryId) {
        load(activeStoryId);
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, [isOpen, activeStoryId, load]);

  // ─── Scroll to node ─────────────────────────────────────────────────────
  useEffect(() => {
    if (scrollToId && drawerRef.current) {
      const el = drawerRef.current.querySelector(`[data-node-id="${scrollToId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2");
        setTimeout(() => el.classList.remove("ring-2"), 1500);
      }
      setScrollTo(null);
    }
  }, [scrollToId, data, setScrollTo]);

  // ─── Inline rename state ────────────────────────────────────────────────
  const [renamingCp, setRenamingCp] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // ─── Inline checkpoint create state ─────────────────────────────────────
  const [creatingAfter, setCreatingAfter] = useState<string | null>(null);
  const [createName, setCreateName] = useState("Checkpoint");

  // ─── Stats ──────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!data) return { branches: 0, forks: 0, depth: 0 };
    const forkNodes = data.nodes.filter((n) => {
      const childCount = data.edges.filter((e) => e.parent_model_msg_id === n.model_msg_id).length;
      return childCount > 1;
    });
    return {
      branches: forkNodes.reduce((sum, n) => {
        return sum + data.edges.filter((e) => e.parent_model_msg_id === n.model_msg_id).length;
      }, Math.min(1, data.nodes.length)),
      forks: forkNodes.length,
      depth: data.nodes.length, // simplified — total node count
    };
  }, [data]);

  // ─── Story name ─────────────────────────────────────────────────────────
  const storyName = useVaultStore((s) => {
    const item = s.items.find((i) => i.id === activeStoryId);
    return item?.name ?? "Untitled";
  });

  // ─── Node click: switch branch ──────────────────────────────────────────
  const handleNodeClick = useCallback(async (node: NodeType) => {
    if (!activeStoryId || node.is_current_leaf) return;
    try {
      await setStoryLeafId(activeStoryId, node.model_msg_id);
      const payload = await loadStoryMessages(activeStoryId, node.model_msg_id);
      const store = useWorkspaceStore.getState();
      store.setMessages(payload.messages);
      store.setSiblingCounts(payload.sibling_counts);
      store.setCurrentLeafId(node.model_msg_id);
      // Reload map to update active highlight
      load(activeStoryId);
    } catch (err) {
      toast.error(`Failed to switch branch: ${err}`);
    }
  }, [activeStoryId, load]);

  // ─── Node context menu ──────────────────────────────────────────────────
  const handleNodeContextMenu = useCallback((e: React.MouseEvent, node: NodeType) => {
    showContextMenu(e, [
      {
        label: "Add Checkpoint",
        icon: Bookmark,
        onClick: () => {
          setCreatingAfter(node.model_msg_id);
          setCreateName("Checkpoint");
          hideContextMenu();
        },
      },
      {
        label: "Delete branch from here",
        icon: Trash2,
        onClick: async () => {
          hideContextMenu();
          if (!activeStoryId) return;
          try {
            const result = await deleteBranchFrom(activeStoryId, node.model_msg_id);
            const store = useWorkspaceStore.getState();
            if (result.new_leaf_id) {
              const payload = await loadStoryMessages(activeStoryId, result.new_leaf_id);
              store.setMessages(payload.messages);
              store.setSiblingCounts(payload.sibling_counts);
              store.setCurrentLeafId(result.new_leaf_id);
            } else {
              store.setMessages([]);
              store.setSiblingCounts([]);
              store.setCurrentLeafId(null);
            }
            toast("Branch deleted", {
              duration: 5000,
              action: {
                label: "Undo",
                onClick: async () => {
                  try {
                    await undeleteMessage(activeStoryId, result.deleted_ids);
                    await setStoryLeafId(activeStoryId, node.model_msg_id);
                    const payload = await loadStoryMessages(activeStoryId, node.model_msg_id);
                    store.setMessages(payload.messages);
                    store.setSiblingCounts(payload.sibling_counts);
                    store.setCurrentLeafId(node.model_msg_id);
                  } catch (undoErr) {
                    toast.error(`Undo failed: ${undoErr}`);
                  }
                },
              },
            });
          } catch (err) {
            toast.error(`Delete failed: ${err}`);
          }
        },
      },
    ]);
  }, [activeStoryId, showContextMenu, hideContextMenu]);

  // ─── Checkpoint context menu ────────────────────────────────────────────
  const handleCheckpointContextMenu = useCallback((e: React.MouseEvent, cp: Checkpoint) => {
    const items = [
      {
        label: "Rename",
        icon: Type,
        onClick: () => {
          setRenamingCp(cp.id);
          setRenameValue(cp.name);
          hideContextMenu();
        },
      },
      {
        label: "Summarise previous chapter",
        icon: Scissors,
        disabled: true,
        onClick: () => {
          toast("Accordion summaries coming in Phase 14");
          hideContextMenu();
        },
      },
    ];

    if (!cp.is_start) {
      items.push({
        label: "Delete",
        icon: Trash2,
        disabled: false,
        onClick: async () => {
          hideContextMenu();
          if (!activeStoryId) return;
          try {
            await deleteCheckpointCmd(activeStoryId, cp.id);
            toast(`Checkpoint "${cp.name}" deleted`);
          } catch (err) {
            toast.error(`Delete failed: ${err}`);
          }
        },
      });
    }

    showContextMenu(e, items);
  }, [activeStoryId, showContextMenu, hideContextMenu]);

  // ─── Create checkpoint submit ───────────────────────────────────────────
  const handleCreateCheckpoint = useCallback(async () => {
    if (!activeStoryId || !creatingAfter) return;
    try {
      await createCheckpointCmd(activeStoryId, creatingAfter, createName || "Checkpoint");
      setCreatingAfter(null);
      toast(`Checkpoint "${createName}" created`);
      load(activeStoryId);
    } catch (err) {
      toast.error(`Create failed: ${err}`);
    }
  }, [activeStoryId, creatingAfter, createName, load]);

  // ─── Rename checkpoint submit ───────────────────────────────────────────
  const handleRenameSubmit = useCallback(async () => {
    if (!renamingCp) return;
    try {
      await renameCheckpointCmd(renamingCp, renameValue || "Checkpoint");
      setRenamingCp(null);
      if (activeStoryId) load(activeStoryId);
    } catch (err) {
      toast.error(`Rename failed: ${err}`);
    }
  }, [renamingCp, renameValue, activeStoryId, load]);

  // ─── Expand collapsed nodes ───────────────────────────────────────────
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set());

  const handleCollapsedClick = useCallback((nodeIds: string[]) => {
    setExpandedNodeIds((prev) => {
      const next = new Set(prev);
      for (const id of nodeIds) next.add(id);
      return next;
    });
  }, []);

  // Reset expanded state when data changes (new branch loaded)
  useEffect(() => {
    setExpandedNodeIds(new Set());
  }, [activeStoryId]);

  if (!isOpen) return null;

  return (
    <>
      <div
        ref={drawerRef}
        className="fixed right-0 top-0 h-screen flex flex-col"
        style={{
          width: `${width}px`,
          zIndex: 30,
          background: "var(--color-bg-base)",
          borderLeft: "1px solid var(--color-border)",
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 220ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        {/* Resize handle */}
        <div
          className="absolute left-0 top-0 h-full w-1 cursor-ew-resize hover:bg-[var(--color-accent)] transition-colors z-10"
          style={{ opacity: 0.3 }}
          onMouseDown={handleResizeStart}
        />

        {/* Header */}
        <div
          className="flex-none px-4 py-3"
          style={{ borderBottom: "1px solid var(--color-border)" }}
        >
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <MapIcon size={14} style={{ color: "var(--color-text-muted)" }} />
              <span
                className="text-[11px] font-medium uppercase tracking-wider"
                style={{ color: "var(--color-text-muted)" }}
              >
                Branch Map
              </span>
            </div>
            <button
              onClick={() => close(false)}
              className="p-1 rounded hover:bg-[var(--color-bg-active)] transition-colors"
              title="Close (Ctrl+M)"
            >
              <X size={14} style={{ color: "var(--color-text-muted)" }} />
            </button>
          </div>
          <div
            className="text-[14px] font-semibold truncate"
            style={{ color: "var(--color-text-primary)" }}
          >
            {storyName}
          </div>
          <div
            className="text-[11px] mt-0.5"
            style={{ color: "var(--color-text-muted)" }}
          >
            Branches: {stats.branches} &middot; Forks: {stats.forks} &middot; Depth: {stats.depth}
          </div>
        </div>

        {/* Tree content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {isLoading ? (
            <div className="px-4 py-8 text-center text-[13px]" style={{ color: "var(--color-text-muted)" }}>
              Loading...
            </div>
          ) : data ? (
            <>
              {/* Start checkpoint */}
              {data.checkpoints
                .filter((cp) => cp.is_start)
                .map((cp) => (
                  <div key={cp.id} className="px-3 pt-3">
                    {renamingCp === cp.id ? (
                      <input
                        autoFocus
                        className="w-full text-[11px] font-medium uppercase tracking-wider bg-transparent border-b px-1 py-0.5 outline-none"
                        style={{
                          color: "var(--color-checkpoint)",
                          borderColor: "var(--color-accent)",
                        }}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={handleRenameSubmit}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRenameSubmit();
                          if (e.key === "Escape") setRenamingCp(null);
                        }}
                      />
                    ) : (
                      <CheckpointMarker
                        checkpoint={cp}
                        onContextMenu={handleCheckpointContextMenu}
                      />
                    )}
                  </div>
                ))}

              <BranchMapTree
                data={data}
                isGenerating={isGenerating}
                onNodeClick={handleNodeClick}
                onNodeContextMenu={handleNodeContextMenu}
                onCheckpointContextMenu={handleCheckpointContextMenu}
                renamingCpId={renamingCp}
                renameValue={renameValue}
                onRenameChange={setRenameValue}
                onRenameSubmit={handleRenameSubmit}
                onRenameCancel={() => setRenamingCp(null)}
                onCollapsedClick={handleCollapsedClick}
                expandedNodeIds={expandedNodeIds}
              />
            </>
          ) : null}
        </div>

        {/* Inline checkpoint creation */}
        {creatingAfter && (
          <div
            className="flex-none px-4 py-3 flex items-center gap-2"
            style={{ borderTop: "1px solid var(--color-border)" }}
          >
            <Bookmark size={14} style={{ color: "var(--color-checkpoint)" }} />
            <input
              autoFocus
              className="flex-1 text-[13px] bg-transparent border-b outline-none"
              style={{
                color: "var(--color-text-primary)",
                borderColor: "var(--color-accent)",
              }}
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateCheckpoint();
                if (e.key === "Escape") setCreatingAfter(null);
              }}
              placeholder="Checkpoint name..."
            />
            <button
              onClick={handleCreateCheckpoint}
              className="text-[11px] px-2 py-1 rounded"
              style={{
                background: "var(--color-accent)",
                color: "var(--color-accent-text)",
              }}
            >
              Create
            </button>
          </div>
        )}
      </div>

      {contextMenu && (
        <ContextMenu menu={contextMenu} onClose={hideContextMenu} />
      )}
    </>
  );
}
