import { useEffect, useCallback } from "react";
import { useUiStore } from "../../stores/uiStore";
import { useAuthStore } from "../../stores/authStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useVaultStore } from "../../stores/vaultStore";
import { WorldPickerModal } from "../modals/WorldPickerModal";
import { LeftPane } from "./LeftPane";
import { lockVault, listWorlds, vaultListItems } from "../../lib/tauriApi";

export function Workspace() {
  const setAppPhase = useUiStore((s) => s.setAppPhase);
  const activeWorldId = useVaultStore((s) => s.activeWorldId);
  const setWorlds = useVaultStore((s) => s.setWorlds);
  const setItems = useVaultStore((s) => s.setItems);
  const setActiveWorldId = useVaultStore((s) => s.setActiveWorldId);

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
    <div className="flex h-full w-full" style={{ backgroundColor: "var(--color-bg-base)" }}>
      {/* Navigator */}
      <LeftPane onLock={handleLock} />

      {/* Main content area — placeholder until Phase 5 */}
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <p
            style={{
              fontSize: "16px",
              color: "var(--color-text-secondary)",
              fontWeight: 500,
            }}
          >
            Select a story to begin writing
          </p>
          <p
            style={{
              fontSize: "13px",
              color: "var(--color-text-muted)",
            }}
          >
            Choose a story from the navigator, or create a new one.
          </p>
        </div>
      </div>

      <WorldPickerModal />
    </div>
  );
}
