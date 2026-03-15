import { useEffect, useRef, useMemo } from "react";
import { Folder, Home } from "lucide-react";
import { useVaultStore } from "../../stores/vaultStore";
import type { VaultItemMeta } from "../../lib/types";

interface FolderPickerProps {
  anchorX: number;
  anchorY: number;
  excludeIds: Set<string>;
  onSelect: (folderId: string | null) => void;
  onClose: () => void;
}

interface FolderEntry {
  item: VaultItemMeta;
  depth: number;
}

export function FolderPicker({ anchorX, anchorY, excludeIds, onSelect, onClose }: FolderPickerProps) {
  const items = useVaultStore((s) => s.items);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Build flat list of folders with depth, excluding items in excludeIds and their descendants
  const folders = useMemo(() => {
    const childrenMap = new Map<string | null, VaultItemMeta[]>();
    for (const item of items) {
      if (item.item_type !== "Folder") continue;
      const key = item.parent_id;
      const list = childrenMap.get(key);
      if (list) list.push(item);
      else childrenMap.set(key, [item]);
    }

    // Collect IDs to exclude (the items themselves + all descendants)
    const allExcluded = new Set(excludeIds);
    function markDescendants(parentId: string) {
      const children = childrenMap.get(parentId) ?? [];
      for (const child of children) {
        allExcluded.add(child.id);
        markDescendants(child.id);
      }
    }
    for (const id of excludeIds) {
      markDescendants(id);
    }

    const result: FolderEntry[] = [];
    function walk(parentId: string | null, depth: number) {
      const children = childrenMap.get(parentId) ?? [];
      children.sort((a, b) => a.sort_order - b.sort_order);
      for (const child of children) {
        if (allExcluded.has(child.id)) continue;
        result.push({ item: child, depth });
        walk(child.id, depth + 1);
      }
    }
    walk(null, 0);
    return result;
  }, [items, excludeIds]);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onClose]);

  // Viewport-aware positioning
  const pos = { x: anchorX, y: anchorY };
  if (typeof window !== "undefined") {
    const width = 200;
    const height = (folders.length + 1) * 28 + 8;
    if (pos.x + width > window.innerWidth) pos.x = anchorX - width;
    if (pos.y + height > window.innerHeight) pos.y = anchorY - height;
    if (pos.x < 0) pos.x = 4;
    if (pos.y < 0) pos.y = 4;
  }

  const rowStyle = {
    height: "28px",
    padding: "0 12px",
    background: "none",
    border: "none",
    cursor: "pointer" as const,
    fontSize: "13px",
    fontFamily: "var(--font-sans)",
    color: "var(--color-text-primary)",
    textAlign: "left" as const,
    width: "100%",
  };

  return (
    <div
      ref={pickerRef}
      className="flex flex-col overflow-y-auto"
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        zIndex: 210,
        backgroundColor: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
        borderRadius: "6px",
        padding: "4px 0",
        minWidth: "180px",
        maxHeight: "240px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
      }}
    >
      {/* Root option */}
      <button
        className="flex items-center gap-2 transition-colors duration-100"
        style={rowStyle}
        onClick={() => {
          onSelect(null);
          onClose();
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
        }}
      >
        <Home size={14} style={{ color: "var(--color-text-muted)" }} />
        Root
      </button>

      {folders.map(({ item, depth }) => (
        <button
          key={item.id}
          className="flex items-center gap-2 transition-colors duration-100"
          style={{
            ...rowStyle,
            paddingLeft: `${12 + depth * 16}px`,
          }}
          onClick={() => {
            onSelect(item.id);
            onClose();
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
          }}
        >
          <Folder size={14} style={{ color: "var(--color-text-muted)" }} />
          <span className="truncate">{item.name}</span>
        </button>
      ))}
    </div>
  );
}
