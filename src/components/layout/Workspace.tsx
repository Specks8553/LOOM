import { useState, useEffect, useCallback } from "react";
import { useUiStore } from "../../stores/uiStore";
import { useAuthStore } from "../../stores/authStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useVaultStore } from "../../stores/vaultStore";
import { WorldPickerModal } from "../modals/WorldPickerModal";
import { LeftPane } from "./LeftPane";
import { TrashView } from "../theater/TrashView";
import { lockVault, listWorlds, vaultListItems } from "../../lib/tauriApi";

export function Workspace() {
  const setAppPhase = useUiStore((s) => s.setAppPhase);
  const activeWorldId = useVaultStore((s) => s.activeWorldId);
  const showingTrash = useVaultStore((s) => s.showingTrash);
  const setWorlds = useVaultStore((s) => s.setWorlds);
  const setItems = useVaultStore((s) => s.setItems);
  const setActiveWorldId = useVaultStore((s) => s.setActiveWorldId);
  const isGenerating = useWorkspaceStore((s) => s.isGenerating);

  const [showLockConfirm, setShowLockConfirm] = useState(false);

  // Load worlds + items on mount
  // NOTE: Do NOT call switchWorld here — unlock_vault already opens the DB
  // connection for the active world. Calling switchWorld would close and reopen
  // the connection, creating a race condition window where active_conn is None.
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

  const performLock = useCallback(async () => {
    setShowLockConfirm(false);
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

  const handleLock = useCallback(async () => {
    if (isGenerating) {
      setShowLockConfirm(true);
      return;
    }
    await performLock();
  }, [isGenerating, performLock]);

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

      {/* Theater area */}
      {showingTrash ? (
        <TrashView />
      ) : (
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
      )}

      <WorldPickerModal />

      {/* Lock-during-generation confirmation */}
      {showLockConfirm && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.5)", zIndex: 300 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowLockConfirm(false);
          }}
        >
          <div
            className="flex flex-col gap-3"
            style={{
              width: "400px",
              backgroundColor: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              borderRadius: "8px",
              padding: "24px",
            }}
          >
            <p style={{ fontSize: "15px", fontWeight: 600, color: "var(--color-text-primary)" }}>
              AI generation in progress
            </p>
            <p style={{ fontSize: "13px", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
              Locking will cancel the current generation. Continue?
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setShowLockConfirm(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: "6px 14px",
                  fontSize: "13px",
                  color: "var(--color-text-secondary)",
                  cursor: "pointer",
                  borderRadius: "6px",
                }}
              >
                Cancel
              </button>
              <button
                onClick={performLock}
                style={{
                  backgroundColor: "var(--color-accent)",
                  color: "var(--color-text-on-accent)",
                  border: "none",
                  borderRadius: "6px",
                  padding: "6px 14px",
                  fontSize: "13px",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Lock Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
