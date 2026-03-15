import { useState, useEffect, useCallback, useRef } from "react";
import { useUiStore } from "../../stores/uiStore";
import { useAuthStore } from "../../stores/authStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useVaultStore } from "../../stores/vaultStore";
import { WorldPickerModal } from "../modals/WorldPickerModal";
import { LeftPane } from "./LeftPane";
import { PaneDivider } from "./PaneDivider";
import { RightPane } from "./RightPane";
import { NoStorySelected } from "../empty/NoStorySelected";
import { Theater } from "../theater/Theater";
import { initViewportWatcher } from "../../lib/viewportWatcher";
import { PanelRightOpen } from "lucide-react";
import { lockVault, listWorlds, vaultListItems } from "../../lib/tauriApi";

// localStorage keys
const LS_LEFT_WIDTH = "left_pane_width";
const LS_RIGHT_WIDTH = "right_pane_width";

// Defaults and constraints
const LEFT_DEFAULT = 260;
const LEFT_MIN = 200;
const LEFT_MAX = 360;
const RIGHT_DEFAULT = 280;
const RIGHT_MIN = 240;
const RIGHT_MAX = 400;

function readWidth(key: string, fallback: number): number {
  const stored = localStorage.getItem(key);
  if (stored) {
    const n = parseInt(stored, 10);
    if (!isNaN(n)) return n;
  }
  return fallback;
}

export function Workspace() {
  const setAppPhase = useUiStore((s) => s.setAppPhase);
  const rightPaneCollapsed = useUiStore((s) => s.rightPaneCollapsed);
  const activeWorldId = useVaultStore((s) => s.activeWorldId);
  const setWorlds = useVaultStore((s) => s.setWorlds);
  const setItems = useVaultStore((s) => s.setItems);
  const setActiveWorldId = useVaultStore((s) => s.setActiveWorldId);
  const activeStoryId = useWorkspaceStore((s) => s.activeStoryId);
  const isGenerating = useWorkspaceStore((s) => s.isGenerating);

  const [leftWidth, setLeftWidth] = useState(() => readWidth(LS_LEFT_WIDTH, LEFT_DEFAULT));
  const [rightWidth, setRightWidth] = useState(() => readWidth(LS_RIGHT_WIDTH, RIGHT_DEFAULT));
  const [showLockConfirm, setShowLockConfirm] = useState(false);

  // Persist widths on resize end
  const persistLeftWidth = useCallback(() => {
    localStorage.setItem(LS_LEFT_WIDTH, String(leftWidth));
  }, [leftWidth]);
  const persistRightWidth = useCallback(() => {
    localStorage.setItem(LS_RIGHT_WIDTH, String(rightWidth));
  }, [rightWidth]);

  // Track latest widths for persist callbacks
  const leftWidthRef = useRef(leftWidth);
  leftWidthRef.current = leftWidth;
  const rightWidthRef = useRef(rightWidth);
  rightWidthRef.current = rightWidth;

  // Viewport watcher
  useEffect(() => {
    return initViewportWatcher();
  }, []);

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

  // Determine theater content
  const renderTheater = () => {
    if (activeStoryId) return <Theater />;
    return <NoStorySelected />;
  };

  return (
    <div className="flex h-full w-full" style={{ backgroundColor: "var(--color-bg-base)" }}>
      {/* Navigator */}
      <LeftPane onLock={handleLock} style={{ width: `${leftWidth}px` }} />

      {/* Left divider */}
      <PaneDivider
        currentWidth={leftWidth}
        min={LEFT_MIN}
        max={LEFT_MAX}
        onResize={setLeftWidth}
        onResizeEnd={persistLeftWidth}
        side="left"
      />

      {/* Theater */}
      <div
        className="flex-1 flex flex-col overflow-hidden"
        style={{ backgroundColor: "var(--color-bg-theater)" }}
      >
        {renderTheater()}
      </div>

      {/* Right divider — only when pane is expanded */}
      {!rightPaneCollapsed && (
        <PaneDivider
          currentWidth={rightWidth}
          min={RIGHT_MIN}
          max={RIGHT_MAX}
          onResize={setRightWidth}
          onResizeEnd={persistRightWidth}
          side="right"
        />
      )}

      {/* Control Pane — collapsed shows thin toggle bar, expanded shows full pane */}
      {rightPaneCollapsed ? (
        <CollapsedPaneToggle />
      ) : (
        <div
          style={{
            width: `${rightWidth}px`,
            flexShrink: 0,
          }}
        >
          <RightPane />
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

/** Thin vertical bar shown when Control Pane is collapsed */
function CollapsedPaneToggle() {
  const setRightPaneCollapsed = useUiStore((s) => s.setRightPaneCollapsed);

  return (
    <div
      className="flex flex-col items-center shrink-0"
      style={{
        width: "32px",
        backgroundColor: "var(--color-bg-pane)",
        borderLeft: "1px solid var(--color-border)",
      }}
    >
      <button
        onClick={() => setRightPaneCollapsed(false)}
        className="flex items-center justify-center transition-colors duration-150"
        style={{
          background: "transparent",
          border: "none",
          cursor: "pointer",
          width: "24px",
          height: "24px",
          borderRadius: "4px",
          color: "var(--color-text-muted)",
          marginTop: "8px",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
          e.currentTarget.style.color = "var(--color-text-primary)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
          e.currentTarget.style.color = "var(--color-text-muted)";
        }}
        title="Expand Control Pane"
      >
        <PanelRightOpen size={14} />
      </button>
    </div>
  );
}
