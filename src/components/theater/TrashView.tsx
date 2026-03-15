import { useState, useEffect, useCallback } from "react";
import { BookOpen, Folder, FileText, Image, RotateCcw, Trash2, ArrowLeft } from "lucide-react";
import { useVaultStore } from "../../stores/vaultStore";
import {
  vaultListTrash,
  vaultListItems,
  vaultRestoreItem,
  vaultPurgeItem,
} from "../../lib/tauriApi";
import { formatRelativeTime } from "../../lib/timeUtils";
import { EmptyTrash } from "../empty/EmptyTrash";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import type { VaultItemMeta } from "../../lib/types";

function ItemIcon({ type }: { type: VaultItemMeta["item_type"] }) {
  const style = { color: "var(--color-text-muted)" };
  switch (type) {
    case "Story":
      return <BookOpen size={16} style={style} />;
    case "Folder":
      return <Folder size={16} style={style} />;
    case "SourceDocument":
      return <FileText size={16} style={style} />;
    case "Image":
      return <Image size={16} style={style} />;
  }
}

export function TrashView() {
  const trashItems = useVaultStore((s) => s.trashItems);
  const setTrashItems = useVaultStore((s) => s.setTrashItems);
  const setItems = useVaultStore((s) => s.setItems);
  const setShowingTrash = useVaultStore((s) => s.setShowingTrash);

  const [showEmptyConfirm, setShowEmptyConfirm] = useState(false);
  const confirmRef = useFocusTrap(showEmptyConfirm);

  // Load trash items on mount
  useEffect(() => {
    const load = async () => {
      try {
        const items = await vaultListTrash();
        setTrashItems(items);
      } catch (e) {
        console.error("Failed to load trash:", e);
      }
    };
    load();
  }, [setTrashItems]);

  const handleRestore = useCallback(
    async (id: string) => {
      try {
        await vaultRestoreItem(id);
        const [refreshedItems, refreshedTrash] = await Promise.all([
          vaultListItems(),
          vaultListTrash(),
        ]);
        setItems(refreshedItems);
        setTrashItems(refreshedTrash);
      } catch (e) {
        console.error("Failed to restore item:", e);
      }
    },
    [setItems, setTrashItems],
  );

  const handleEmptyTrash = useCallback(async () => {
    try {
      for (const item of trashItems) {
        await vaultPurgeItem(item.id);
      }
      setTrashItems([]);
    } catch (e) {
      console.error("Failed to empty trash:", e);
    }
    setShowEmptyConfirm(false);
  }, [trashItems, setTrashItems]);

  if (trashItems.length === 0) {
    return (
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 shrink-0"
          style={{
            height: "48px",
            borderBottom: "1px solid var(--color-border-subtle)",
          }}
        >
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowingTrash(false)}
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
              title="Back to Vault"
            >
              <ArrowLeft size={16} />
            </button>
            <span style={{ fontSize: "16px", fontWeight: 600, color: "var(--color-text-primary)" }}>
              Trash
            </span>
          </div>
        </div>
        <EmptyTrash />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 shrink-0"
        style={{
          height: "48px",
          borderBottom: "1px solid var(--color-border-subtle)",
        }}
      >
        <span style={{ fontSize: "16px", fontWeight: 600, color: "var(--color-text-primary)" }}>
          Trash
        </span>
        <button
          onClick={() => setShowEmptyConfirm(true)}
          className="flex items-center gap-1.5 transition-colors duration-150"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "4px 8px",
            borderRadius: "4px",
            fontSize: "12px",
            fontFamily: "var(--font-sans)",
            color: "var(--color-error)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
          }}
        >
          <Trash2 size={12} />
          Empty Trash
        </button>
      </div>

      {/* Item list */}
      <div className="flex-1 overflow-y-auto px-6 py-2">
        {trashItems.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 transition-colors duration-100"
            style={{
              height: "40px",
              padding: "0 8px",
              borderRadius: "4px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            <ItemIcon type={item.item_type} />
            <span
              className="flex-1 min-w-0 truncate"
              style={{ fontSize: "13px", color: "var(--color-text-primary)" }}
            >
              {item.name}
            </span>
            <span
              style={{
                fontSize: "12px",
                color: "var(--color-text-muted)",
                whiteSpace: "nowrap",
              }}
            >
              {item.deleted_at ? `Deleted ${formatRelativeTime(item.deleted_at)}` : ""}
            </span>
            <button
              onClick={() => handleRestore(item.id)}
              className="flex items-center gap-1 shrink-0 transition-colors duration-150"
              style={{
                background: "none",
                border: "1px solid var(--color-border)",
                borderRadius: "4px",
                padding: "3px 8px",
                fontSize: "12px",
                fontFamily: "var(--font-sans)",
                color: "var(--color-text-primary)",
                cursor: "pointer",
              }}
            >
              <RotateCcw size={12} />
              Restore
            </button>
          </div>
        ))}
      </div>

      {/* Empty Trash confirmation */}
      {showEmptyConfirm && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.5)", zIndex: 300 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowEmptyConfirm(false);
          }}
        >
          <div
            ref={confirmRef}
            className="flex flex-col gap-3"
            style={{
              width: "320px",
              backgroundColor: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              borderRadius: "8px",
              padding: "16px",
            }}
          >
            <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary)" }}>
              Permanently delete all {trashItems.length} item{trashItems.length === 1 ? "" : "s"}?
            </p>
            <p style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
              This cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setShowEmptyConfirm(false)}
                style={{
                  background: "none",
                  border: "1px solid var(--color-border)",
                  borderRadius: "4px",
                  padding: "6px 12px",
                  fontSize: "13px",
                  fontFamily: "var(--font-sans)",
                  color: "var(--color-text-primary)",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleEmptyTrash}
                style={{
                  background: "var(--color-error)",
                  border: "none",
                  borderRadius: "4px",
                  padding: "6px 12px",
                  fontSize: "13px",
                  fontFamily: "var(--font-sans)",
                  color: "#fff",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Delete All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
