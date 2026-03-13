import { useEffect, useCallback } from "react";
import { Lock, ChevronDown } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { useAuthStore } from "../../stores/authStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useVaultStore } from "../../stores/vaultStore";
import { WorldPickerModal } from "../modals/WorldPickerModal";
import { lockVault, listWorlds, vaultListItems } from "../../lib/tauriApi";

/**
 * Placeholder Workspace — Phase 2 / 4A.
 * Shows a top bar with world name + Lock button and a centered message.
 * Will be replaced with the full 3-pane layout in Phase 5.
 */
export function Workspace() {
  const setAppPhase = useUiStore((s) => s.setAppPhase);
  const setWorldPickerOpen = useUiStore((s) => s.setWorldPickerOpen);
  const activeWorldId = useVaultStore((s) => s.activeWorldId);
  const worlds = useVaultStore((s) => s.worlds);
  const setWorlds = useVaultStore((s) => s.setWorlds);
  const setItems = useVaultStore((s) => s.setItems);
  const setActiveWorldId = useVaultStore((s) => s.setActiveWorldId);

  const activeWorld = worlds.find((w) => w.id === activeWorldId);

  // Load worlds + items on mount
  useEffect(() => {
    const load = async () => {
      try {
        const w = await listWorlds();
        setWorlds(w);
        if (w.length > 0) {
          const currentId = activeWorldId ?? w[0].id;
          setActiveWorldId(currentId);
          const items = await vaultListItems();
          setItems(items);
        }
      } catch (e) {
        console.error("Failed to load worlds on mount:", e);
      }
    };
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLock = useCallback(async () => {
    try {
      await lockVault();
    } catch (e) {
      console.error("Failed to lock vault:", e);
    }

    // Clear all workspace state per Doc 11 §7
    useWorkspaceStore.getState().clearWorkspace();
    useVaultStore.getState().clearVault();
    useAuthStore.getState().reset();
    setAppPhase("locked");
  }, [setAppPhase]);

  // Listen for Ctrl+L lock event from App.tsx
  useEffect(() => {
    const listener = () => handleLock();
    window.addEventListener("loom:lock", listener);
    return () => window.removeEventListener("loom:lock", listener);
  }, [handleLock]);

  return (
    <div className="flex flex-col h-full w-full" style={{ backgroundColor: "var(--color-bg-base)" }}>
      {/* Top Bar */}
      <div
        className="flex items-center justify-between px-4 shrink-0"
        style={{
          height: "40px",
          borderBottom: "1px solid var(--color-border)",
          backgroundColor: "var(--color-bg-pane)",
        }}
      >
        <button
          onClick={() => setWorldPickerOpen(true)}
          className="flex items-center gap-1.5 transition-colors duration-150"
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: "4px 8px",
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
        <button
          onClick={handleLock}
          className="flex items-center gap-1.5 transition-colors duration-150"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--color-text-muted)",
            cursor: "pointer",
            padding: "4px 8px",
            borderRadius: "4px",
            fontSize: "12px",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--color-text-primary)";
            e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--color-text-muted)";
            e.currentTarget.style.backgroundColor = "transparent";
          }}
          title="Lock (Ctrl+L)"
        >
          <Lock size={14} />
          Lock
        </button>
      </div>

      {/* Placeholder Content */}
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <p
            style={{
              fontSize: "16px",
              color: "var(--color-text-secondary)",
              fontWeight: 500,
            }}
          >
            {activeWorld?.name ?? "Workspace"}
          </p>
          <p
            style={{
              fontSize: "13px",
              color: "var(--color-text-muted)",
            }}
          >
            Unlocked successfully. Full layout coming in Phase 5.
          </p>
        </div>
      </div>

      <WorldPickerModal />
    </div>
  );
}
