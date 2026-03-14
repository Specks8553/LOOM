import { Plus, ChevronDown, Lock } from "lucide-react";
import { useVaultStore } from "../../stores/vaultStore";
import { useUiStore } from "../../stores/uiStore";
import { FilterInput } from "../navigator/FilterInput";
import { VaultTree } from "../navigator/VaultTree";
import { CreateNewDialog } from "../navigator/CreateNewDialog";

interface LeftPaneProps {
  onLock: () => void;
}

export function LeftPane({ onLock }: LeftPaneProps) {
  const activeWorldId = useVaultStore((s) => s.activeWorldId);
  const worlds = useVaultStore((s) => s.worlds);
  const setCreateNewOpen = useVaultStore((s) => s.setCreateNewOpen);
  const setWorldPickerOpen = useUiStore((s) => s.setWorldPickerOpen);

  const activeWorld = worlds.find((w) => w.id === activeWorldId);

  return (
    <div
      className="flex flex-col h-full shrink-0"
      style={{
        width: "260px",
        backgroundColor: "var(--color-bg-pane)",
        borderRight: "1px solid var(--color-border)",
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

      {/* Filter */}
      <div className="pt-2">
        <FilterInput />
      </div>

      {/* Tree */}
      <VaultTree onCreateClick={() => setCreateNewOpen(true)} />

      {/* Create dialog */}
      <CreateNewDialog />
    </div>
  );
}
