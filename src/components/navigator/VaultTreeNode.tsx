import { useState, useRef, useEffect, useCallback, useContext } from "react";
import {
  BookOpen,
  Folder,
  FolderOpen,
  FileText,
  Image,
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  Pencil,
  Trash2,
  FolderInput,
  ExternalLink,
  Paperclip,
} from "lucide-react";
import type { VaultItemMeta } from "../../lib/types";
import { useVaultStore } from "../../stores/vaultStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import {
  vaultRenameItem,
  vaultSoftDelete,
  vaultMoveItem,
  vaultListItems,
  vaultUpdateSortOrder,
  vaultGetItem,
  attachContextDoc,
  detachContextDoc,
} from "../../lib/tauriApi";
import { ContextMenu } from "./ContextMenu";
import type { ContextMenuItem } from "./ContextMenu";
import { FolderPicker } from "./FolderPicker";
import { VaultTreeContext, getDraggedItemIds, setDraggedItemIds } from "./VaultTree";

type DropPosition = "above" | "below" | "inside" | null;

interface VaultTreeNodeProps {
  item: VaultItemMeta;
  depth: number;
  isExpanded: boolean;
  isFiltering: boolean;
  children?: React.ReactNode;
}

export function VaultTreeNode({
  item,
  depth,
  isExpanded,
  isFiltering,
  children,
}: VaultTreeNodeProps) {
  const toggleExpanded = useVaultStore((s) => s.toggleExpanded);
  const pendingRename = useVaultStore((s) => s.pendingRename);
  const setPendingRename = useVaultStore((s) => s.setPendingRename);
  const setItems = useVaultStore((s) => s.setItems);
  const selectedItems = useVaultStore((s) => s.selectedItems);
  const toggleSelected = useVaultStore((s) => s.toggleSelected);
  const clearSelection = useVaultStore((s) => s.clearSelection);
  const setLastSelectedId = useVaultStore((s) => s.setLastSelectedId);
  const lastSelectedId = useVaultStore((s) => s.lastSelectedId);
  const selectRange = useVaultStore((s) => s.selectRange);
  const setShowingTrash = useVaultStore((s) => s.setShowingTrash);
  const items = useVaultStore((s) => s.items);
  const setActiveStoryId = useWorkspaceStore((s) => s.setActiveStoryId);
  const activeStoryId = useWorkspaceStore((s) => s.activeStoryId);
  const attachedDocIds = useWorkspaceStore((s) => s.attachedDocIds);
  const addAttachedDocId = useWorkspaceStore((s) => s.addAttachedDocId);
  const removeAttachedDocId = useWorkspaceStore((s) => s.removeAttachedDocId);
  const openDoc = useWorkspaceStore((s) => s.openDoc);

  const { flatOrder } = useContext(VaultTreeContext);

  // Open a source document or image in the editor
  const handleOpenDoc = useCallback(async () => {
    try {
      const fullItem = await vaultGetItem(item.id);
      openDoc(item.id, fullItem.content, fullItem.name, fullItem.item_subtype, fullItem.item_type);
    } catch (e) {
      console.error("Failed to open document:", e);
    }
  }, [item.id, openDoc]);

  const isAttachable =
    (item.item_type === "SourceDocument" || item.item_type === "Image") && !!activeStoryId;
  const isAttached = isAttachable && attachedDocIds.includes(item.id);

  const handleToggleAttach = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      e.nativeEvent.stopImmediatePropagation();
      if (!activeStoryId) return;
      if (isAttached) {
        removeAttachedDocId(item.id);
        detachContextDoc(activeStoryId, item.id).catch(() => {});
      } else {
        addAttachedDocId(item.id);
        attachContextDoc(activeStoryId, item.id).catch(() => {});
      }
    },
    [activeStoryId, item.id, isAttached, addAttachedDocId, removeAttachedDocId],
  );

  const isRenaming = pendingRename === item.id;
  const isSelected = selectedItems.has(item.id);
  const [renameValue, setRenameValue] = useState(item.name);
  const [isHovered, setIsHovered] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [folderPicker, setFolderPicker] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dropPosition, setDropPosition] = useState<DropPosition>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  const isFolder = item.item_type === "Folder";

  // Focus input when entering rename mode
  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  useEffect(() => {
    if (isRenaming) setRenameValue(item.name);
  }, [isRenaming, item.name]);

  // ─── Rename ──────────────────────────────────────────────────────────────────

  const confirmRename = useCallback(async () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== item.name) {
      try {
        await vaultRenameItem(item.id, trimmed);
        const refreshed = await vaultListItems();
        setItems(refreshed);
      } catch (e) {
        console.error("Failed to rename item:", e);
      }
    }
    setPendingRename(null);
  }, [renameValue, item.name, item.id, setItems, setPendingRename]);

  const cancelRename = useCallback(() => {
    setPendingRename(null);
  }, [setPendingRename]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        confirmRename();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancelRename();
      }
    },
    [confirmRename, cancelRename],
  );

  // ─── Click Handling (multi-select aware) ─────────────────────────────────────

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (isRenaming) return;

      // Ignore clicks that originated on a button (paperclip, ellipsis, etc.)
      if ((e.target as HTMLElement).closest("button")) return;

      const isCtrl = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;

      if (isCtrl) {
        toggleSelected(item.id);
        setLastSelectedId(item.id);
        return;
      }

      if (isShift && lastSelectedId) {
        selectRange(lastSelectedId, item.id, flatOrder);
        return;
      }

      // Plain click: clear selection, perform normal action
      clearSelection();
      setShowingTrash(false);

      if (isFolder) {
        toggleExpanded(item.id);
      } else if (item.item_type === "Story") {
        setActiveStoryId(item.id);
      } else if (item.item_type === "SourceDocument" || item.item_type === "Image") {
        handleOpenDoc();
      }
    },
    [
      isRenaming, isFolder, item.id, item.item_type,
      toggleSelected, setLastSelectedId, lastSelectedId,
      selectRange, flatOrder, clearSelection, setShowingTrash,
      toggleExpanded, setActiveStoryId,
    ],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      // Double-click always enters rename mode
      setPendingRename(item.id);
    },
    [item.id, setPendingRename],
  );

  // ─── Context Menu ────────────────────────────────────────────────────────────

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY });
    },
    [],
  );

  const handleEllipsisClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      setContextMenu({ x: rect.right, y: rect.bottom });
    },
    [],
  );

  const handleDelete = useCallback(async () => {
    try {
      await vaultSoftDelete(item.id);
      // If this doc was attached as context, remove it from the attached list
      if (attachedDocIds.includes(item.id)) {
        removeAttachedDocId(item.id);
      }
      const refreshed = await vaultListItems();
      setItems(refreshed);
    } catch (e) {
      console.error("Failed to delete item:", e);
    }
  }, [item.id, setItems, attachedDocIds, removeAttachedDocId]);

  const handleMoveToFolder = useCallback(
    async (folderId: string | null) => {
      try {
        const siblings = items.filter((i) => i.parent_id === folderId && i.id !== item.id);
        const maxOrder = siblings.reduce((max, i) => Math.max(max, i.sort_order), -1);
        await vaultMoveItem(item.id, folderId, maxOrder + 1);
        const refreshed = await vaultListItems();
        setItems(refreshed);
      } catch (e) {
        console.error("Failed to move item:", e);
      }
      setFolderPicker(null);
    },
    [item.id, items, setItems],
  );

  const getContextMenuItems = useCallback((): ContextMenuItem[] => {
    const menuItems: ContextMenuItem[] = [];

    if (item.item_type === "Story") {
      menuItems.push({
        label: "Open",
        icon: <ExternalLink size={14} />,
        onClick: () => setActiveStoryId(item.id),
      });
    }

    if (item.item_type === "SourceDocument" || item.item_type === "Image") {
      menuItems.push({
        label: "Open",
        icon: <ExternalLink size={14} />,
        onClick: handleOpenDoc,
      });
    }

    menuItems.push({
      label: "Rename",
      icon: <Pencil size={14} />,
      onClick: () => setPendingRename(item.id),
    });

    menuItems.push({
      label: "Move to Folder",
      icon: <FolderInput size={14} />,
      onClick: () => {
        if (contextMenu) {
          setFolderPicker({ x: contextMenu.x, y: contextMenu.y });
        }
      },
    });

    menuItems.push({
      label: "Delete",
      icon: <Trash2 size={14} />,
      onClick: handleDelete,
      danger: true,
      separator: true,
    });

    return menuItems;
  }, [item.id, item.item_type, contextMenu, setActiveStoryId, setPendingRename, handleDelete]);

  // ─── Drag and Drop ───────────────────────────────────────────────────────────

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.stopPropagation();
      setIsDragging(true);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", item.id);

      if (isSelected && selectedItems.size > 1) {
        setDraggedItemIds(Array.from(selectedItems));
      } else {
        setDraggedItemIds([item.id]);
      }
    },
    [item.id, isSelected, selectedItems],
  );

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    setDraggedItemIds([]);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";

      if (!rowRef.current) return;
      const rect = rowRef.current.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const height = rect.height;

      if (isFolder) {
        if (y < height * 0.25) setDropPosition("above");
        else if (y > height * 0.75) setDropPosition("below");
        else setDropPosition("inside");
      } else {
        if (y < height * 0.5) setDropPosition("above");
        else setDropPosition("below");
      }
    },
    [isFolder],
  );

  const handleDragLeave = useCallback(() => {
    setDropPosition(null);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = dropPosition;
      setDropPosition(null);

      const dragIds = getDraggedItemIds();
      if (dragIds.length === 0 || dragIds.includes(item.id)) return;
      if (!pos) return;

      try {
        const targetParentId = pos === "inside" ? item.id : item.parent_id;
        const siblings = items
          .filter((i) => i.parent_id === targetParentId && !dragIds.includes(i.id))
          .sort((a, b) => a.sort_order - b.sort_order);

        let newSortOrder: number;

        if (pos === "inside") {
          newSortOrder = siblings.length > 0
            ? siblings[siblings.length - 1].sort_order + 1
            : 0;
        } else {
          const targetIdx = siblings.findIndex((s) => s.id === item.id);

          if (pos === "above") {
            if (targetIdx <= 0) {
              newSortOrder = siblings.length > 0 ? siblings[0].sort_order - 1 : 0;
            } else {
              const prev = siblings[targetIdx - 1].sort_order;
              const curr = siblings[targetIdx].sort_order;
              if (curr - prev <= 1) {
                const reordered: [string, number][] = siblings.map((s, i) => [s.id, i * 100]);
                await vaultUpdateSortOrder(reordered);
                newSortOrder = targetIdx * 100 - 50;
              } else {
                newSortOrder = Math.floor((prev + curr) / 2);
              }
            }
          } else {
            if (targetIdx >= siblings.length - 1) {
              newSortOrder = siblings.length > 0
                ? siblings[siblings.length - 1].sort_order + 1
                : 0;
            } else {
              const curr = siblings[targetIdx].sort_order;
              const next = siblings[targetIdx + 1].sort_order;
              if (next - curr <= 1) {
                const reordered: [string, number][] = siblings.map((s, i) => [s.id, i * 100]);
                await vaultUpdateSortOrder(reordered);
                newSortOrder = (targetIdx + 1) * 100 - 50;
              } else {
                newSortOrder = Math.floor((curr + next) / 2);
              }
            }
          }
        }

        for (let i = 0; i < dragIds.length; i++) {
          await vaultMoveItem(dragIds[i], targetParentId, newSortOrder + i);
        }

        const refreshed = await vaultListItems();
        setItems(refreshed);
        clearSelection();
      } catch (err) {
        console.error("Failed to drop item:", err);
      }
    },
    [item.id, item.parent_id, dropPosition, items, setItems, clearSelection],
  );

  // ─── Icon ────────────────────────────────────────────────────────────────────

  const getIcon = () => {
    switch (item.item_type) {
      case "Story":
        return <BookOpen size={14} />;
      case "Folder":
        return isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />;
      case "SourceDocument":
        return <FileText size={14} />;
      case "Image":
        return <Image size={14} />;
    }
  };

  const getBgColor = () => {
    if (dropPosition === "inside") return "var(--color-accent-subtle)";
    if (isSelected) return "var(--color-accent-subtle)";
    if (isHovered) return "var(--color-bg-hover)";
    return "transparent";
  };

  return (
    <>
      {/* Drop indicator: above */}
      {dropPosition === "above" && (
        <div
          style={{
            height: "2px",
            backgroundColor: "var(--color-accent)",
            marginLeft: `${depth * 16 + 8}px`,
            marginRight: "8px",
          }}
        />
      )}

      <div
        ref={rowRef}
        className="flex items-center cursor-pointer select-none transition-colors duration-100"
        style={{
          height: "28px",
          paddingLeft: `${depth * 16 + 8}px`,
          paddingRight: "8px",
          fontSize: "13px",
          fontFamily: "var(--font-sans)",
          color: "var(--color-text-primary)",
          backgroundColor: getBgColor(),
          opacity: isDragging ? 0.5 : 1,
        }}
        draggable={!isRenaming}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Chevron for folders */}
        <span
          className="flex items-center justify-center shrink-0"
          style={{ width: "16px", height: "16px", color: "var(--color-text-muted)" }}
        >
          {isFolder &&
            (isExpanded || isFiltering ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
        </span>

        {/* Icon */}
        <span
          className="flex items-center justify-center shrink-0 mr-1.5"
          style={{ color: "var(--color-text-muted)" }}
        >
          {getIcon()}
        </span>

        {/* Name or rename input */}
        {isRenaming ? (
          <input
            ref={renameInputRef}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={confirmRename}
            className="flex-1 min-w-0"
            style={{
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-accent)",
              borderRadius: "2px",
              outline: "none",
              fontSize: "13px",
              fontFamily: "var(--font-sans)",
              color: "var(--color-text-primary)",
              padding: "0 4px",
              height: "20px",
            }}
          />
        ) : (
          <span className="flex-1 min-w-0 truncate">{item.name}</span>
        )}

        {/* Paperclip attach/detach for SourceDocument/Image */}
        {isAttachable && (isHovered || isAttached) && !isRenaming && (
          <button
            draggable={false}
            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
            onClick={handleToggleAttach}
            className="flex items-center justify-center shrink-0 transition-colors duration-100"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "2px",
              color: isAttached ? "var(--color-accent)" : "var(--color-text-muted)",
              marginLeft: "4px",
            }}
            title={isAttached ? "Detach from story" : "Attach to story as context"}
          >
            <Paperclip size={13} />
          </button>
        )}

        {/* Ellipsis button on hover */}
        {isHovered && !isRenaming && (
          <button
            draggable={false}
            onMouseDown={(e) => { e.stopPropagation(); }}
            onClick={handleEllipsisClick}
            className="flex items-center justify-center shrink-0 transition-colors duration-100"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "2px",
              color: "var(--color-text-muted)",
              marginLeft: "4px",
            }}
            title="Actions"
          >
            <MoreHorizontal size={14} />
          </button>
        )}
      </div>

      {/* Drop indicator: below */}
      {dropPosition === "below" && (
        <div
          style={{
            height: "2px",
            backgroundColor: "var(--color-accent)",
            marginLeft: `${depth * 16 + 8}px`,
            marginRight: "8px",
          }}
        />
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getContextMenuItems()}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Folder picker for Move action */}
      {folderPicker && (
        <FolderPicker
          anchorX={folderPicker.x}
          anchorY={folderPicker.y}
          excludeIds={new Set([item.id])}
          onSelect={handleMoveToFolder}
          onClose={() => setFolderPicker(null)}
        />
      )}

      {/* Children (expanded folder contents) */}
      {isFolder && (isExpanded || isFiltering) && children}
    </>
  );
}
