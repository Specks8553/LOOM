import { useState, useCallback } from "react";
import { useVaultStore } from "../../stores/vaultStore";
import { vaultSoftDelete, vaultMoveItem, vaultListItems } from "../../lib/tauriApi";
import { FolderPicker } from "./FolderPicker";
import { BulkDeleteConfirm } from "./BulkDeleteConfirm";

export function BulkActionBar() {
  const selectedItems = useVaultStore((s) => s.selectedItems);
  const items = useVaultStore((s) => s.items);
  const setItems = useVaultStore((s) => s.setItems);
  const clearSelection = useVaultStore((s) => s.clearSelection);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [folderPicker, setFolderPicker] = useState<{ x: number; y: number } | null>(null);

  const selectedCount = selectedItems.size;
  const selectedNames = items
    .filter((i) => selectedItems.has(i.id))
    .map((i) => i.name);

  const handleBulkDelete = useCallback(async () => {
    try {
      for (const id of selectedItems) {
        await vaultSoftDelete(id);
      }
      const refreshed = await vaultListItems();
      setItems(refreshed);
      clearSelection();
    } catch (e) {
      console.error("Failed to bulk delete:", e);
    }
    setShowDeleteConfirm(false);
  }, [selectedItems, setItems, clearSelection]);

  const handleBulkMove = useCallback(
    async (folderId: string | null) => {
      try {
        const siblings = items.filter((i) => i.parent_id === folderId && !selectedItems.has(i.id));
        let nextOrder = siblings.reduce((max, i) => Math.max(max, i.sort_order), -1) + 1;

        for (const id of selectedItems) {
          await vaultMoveItem(id, folderId, nextOrder);
          nextOrder++;
        }
        const refreshed = await vaultListItems();
        setItems(refreshed);
        clearSelection();
      } catch (e) {
        console.error("Failed to bulk move:", e);
      }
      setFolderPicker(null);
    },
    [selectedItems, items, setItems, clearSelection],
  );

  const handleMoveClick = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setFolderPicker({ x: rect.left, y: rect.top - 8 });
  }, []);

  if (selectedCount < 2) return null;

  return (
    <>
      <div
        className="flex items-center justify-between px-3 shrink-0"
        style={{
          height: "40px",
          backgroundColor: "var(--color-bg-elevated)",
          borderTop: "1px solid var(--color-border)",
        }}
      >
        <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
          {selectedCount} items selected
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleMoveClick}
            style={{
              background: "none",
              border: "1px solid var(--color-border)",
              borderRadius: "4px",
              padding: "3px 8px",
              fontSize: "12px",
              fontFamily: "var(--font-sans)",
              color: "var(--color-text-primary)",
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            Move
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            style={{
              background: "none",
              border: "1px solid var(--color-border)",
              borderRadius: "4px",
              padding: "3px 8px",
              fontSize: "12px",
              fontFamily: "var(--font-sans)",
              color: "var(--color-error)",
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {folderPicker && (
        <FolderPicker
          anchorX={folderPicker.x}
          anchorY={folderPicker.y}
          excludeIds={selectedItems}
          onSelect={handleBulkMove}
          onClose={() => setFolderPicker(null)}
        />
      )}

      {showDeleteConfirm && (
        <BulkDeleteConfirm
          itemNames={selectedNames}
          onConfirm={handleBulkDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </>
  );
}
