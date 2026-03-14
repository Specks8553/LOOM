import { useState, useRef, useEffect, useCallback } from "react";
import {
  BookOpen,
  Folder,
  FolderOpen,
  FileText,
  Image,
  ChevronRight,
  ChevronDown,
  Trash2,
} from "lucide-react";
import type { VaultItemMeta } from "../../lib/types";
import { useVaultStore } from "../../stores/vaultStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { vaultRenameItem, vaultSoftDelete, vaultListItems } from "../../lib/tauriApi";

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
  const setActiveStoryId = useWorkspaceStore((s) => s.setActiveStoryId);

  const isRenaming = pendingRename === item.id;
  const [renameValue, setRenameValue] = useState(item.name);
  const [isHovered, setIsHovered] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Focus input when entering rename mode
  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  // Reset rename value when pendingRename changes
  useEffect(() => {
    if (isRenaming) setRenameValue(item.name);
  }, [isRenaming, item.name]);

  const confirmRename = useCallback(async () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== item.name) {
      try {
        await vaultRenameItem(item.id, trimmed);
        const items = await vaultListItems();
        setItems(items);
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

  const handleClick = useCallback(() => {
    if (isRenaming) return;
    if (item.item_type === "Folder") {
      toggleExpanded(item.id);
    } else if (item.item_type === "Story") {
      setActiveStoryId(item.id);
    }
  }, [isRenaming, item.item_type, item.id, toggleExpanded, setActiveStoryId]);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setPendingRename(item.id);
    },
    [item.id, setPendingRename],
  );

  const handleDelete = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await vaultSoftDelete(item.id);
        const items = await vaultListItems();
        setItems(items);
      } catch (e) {
        console.error("Failed to delete item:", e);
      }
    },
    [item.id, setItems],
  );

  const isFolder = item.item_type === "Folder";

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

  return (
    <>
      <div
        className="flex items-center cursor-pointer select-none transition-colors duration-100"
        style={{
          height: "28px",
          paddingLeft: `${depth * 16 + 8}px`,
          paddingRight: "8px",
          fontSize: "13px",
          fontFamily: "var(--font-sans)",
          color: "var(--color-text-primary)",
          backgroundColor: isHovered ? "var(--color-bg-hover)" : "transparent",
        }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
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

        {/* Delete button on hover */}
        {isHovered && !isRenaming && (
          <button
            onClick={handleDelete}
            className="flex items-center justify-center shrink-0 transition-colors duration-100"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "2px",
              color: "var(--color-text-muted)",
              marginLeft: "4px",
            }}
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* Children (expanded folder contents) */}
      {isFolder && (isExpanded || isFiltering) && children}
    </>
  );
}
