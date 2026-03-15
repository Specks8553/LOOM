import { useCallback } from "react";
import { Plus, ChevronDown, Lock, Trash2 } from "lucide-react";
import { useVaultStore } from "../../stores/vaultStore";
import { useUiStore } from "../../stores/uiStore";
import { vaultListTrash } from "../../lib/tauriApi";
import { FilterInput } from "../navigator/FilterInput";
import { VaultTree } from "../navigator/VaultTree";
import { CreateNewDialog } from "../navigator/CreateNewDialog";
import { BulkActionBar } from "../navigator/BulkActionBar";
import { TrashView } from "../theater/TrashView";

interface LeftPaneProps {
  onLock: () => void;
  style?: React.CSSProperties;
}

export function LeftPane({ onLock, style }: LeftPaneProps) {
  const activeWorldId = useVaultStore((s) => s.activeWorldId);
  const worlds = useVaultStore((s) => s.worlds);
  const setCreateNewOpen = useVaultStore((s) => s.setCreateNewOpen);
  const showingTrash = useVaultStore((s) => s.showingTrash);
  const setShowingTrash = useVaultStore((s) => s.setShowingTrash);
  const setTrashItems = useVaultStore((s) => s.setTrashItems);
  const trashItems = useVaultStore((s) => s.trashItems);
  const selectedItems = useVaultStore((s) => s.selectedItems);
  const clearSelection = useVaultStore((s) => s.clearSelection);
  const setWorldPickerOpen = useUiStore((s) => s.setWorldPickerOpen);

  const activeWorld = worlds.find((w) => w.id === activeWorldId);

  const handleTrashClick = useCallback(async () => {
    if (showingTrash) {
      // Toggle off
      setShowingTrash(false);
      return;
    }
    clearSelection();
    setShowingTrash(true);
    try {
      const items = await vaultListTrash();
      setTrashItems(items);
    } catch (e) {
      console.error("Failed to load trash:", e);
    }
  }, [showingTrash, clearSelection, setShowingTrash, setTrashItems]);

  return (
    <div
      className="flex flex-col h-full shrink-0"
      style={{
        width: "260px",
        backgroundColor: "var(--color-bg-pane)",
        borderRight: "1px solid var(--color-border)",
        ...style,
      }}
    >
      {/* Header: world name + create button */}
      <div
        className="flex items-center justify-between px-3 shrink-0"
        style={{
          height: "40px",
          borderBottom: "1px solid var(--color-border-subtle)",
        }}
      >
        <button
          onClick={() => setWorldPickerOpen(true)}
          className="flex items-center gap-1.5 transition-colors duration-150"
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: "4px 6px",
            borderRadius: "4px",
            fontSize: "12px",
            fontWeight: 600,
            color: "var(--color-text-primary)",
            letterSpacing: "0.04em",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
          }}
          title="Switch World"
        >
          {activeWorld?.name ?? "LOOM"}
          <ChevronDown size={12} style={{ color: "var(--color-text-muted)" }} />
        </button>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setCreateNewOpen(true)}
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
            title="Create New"
          >
            <Plus size={16} />
          </button>

          <button
            onClick={onLock}
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
            title="Lock (Ctrl+L)"
          >
            <Lock size={14} />
          </button>
        </div>
      </div>

      {/* Content area: vault tree or trash list */}
      {showingTrash ? (
        <TrashView />
      ) : (
        <>
          {/* Filter */}
          <div className="pt-2">
            <FilterInput />
          </div>

          {/* Tree */}
          <VaultTree onCreateClick={() => setCreateNewOpen(true)} />

          {/* Bulk action bar (conditional) */}
          {selectedItems.size >= 2 && <BulkActionBar />}
        </>
      )}

      {/* Trash entry */}
      <button
        onClick={handleTrashClick}
        className="flex items-center gap-2 px-3 shrink-0 transition-colors duration-150"
        style={{
          height: "36px",
          background: showingTrash ? "var(--color-accent-subtle)" : "transparent",
          border: "none",
          borderTop: "1px solid var(--color-border-subtle)",
          cursor: "pointer",
          fontSize: "13px",
          fontFamily: "var(--font-sans)",
          color: showingTrash ? "var(--color-text-primary)" : "var(--color-text-muted)",
          textAlign: "left",
          width: "100%",
        }}
        onMouseEnter={(e) => {
          if (!showingTrash) {
            e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
          }
        }}
        onMouseLeave={(e) => {
          if (!showingTrash) {
            e.currentTarget.style.backgroundColor = "transparent";
          }
        }}
      >
        <Trash2 size={14} />
        <span className="flex-1">Trash</span>
        {trashItems.length > 0 && (
          <span
            style={{
              fontSize: "11px",
              color: "var(--color-text-muted)",
              backgroundColor: "var(--color-bg-hover)",
              borderRadius: "8px",
              padding: "1px 6px",
              minWidth: "18px",
              textAlign: "center",
            }}
          >
            {trashItems.length}
          </span>
        )}
      </button>

      {/* Create dialog */}
      <CreateNewDialog />
    </div>
  );
}
