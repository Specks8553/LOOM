import { useState } from "react";
import { PanelRightClose, PanelRightOpen, Key, Check, AlertTriangle } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { validateAndStoreApiKey, saveApiKeyToDb } from "../../lib/tauriApi";

export function RightPane() {
  const rightPaneCollapsed = useUiStore((s) => s.rightPaneCollapsed);
  const setRightPaneCollapsed = useUiStore((s) => s.setRightPaneCollapsed);
  const activeStoryId = useWorkspaceStore((s) => s.activeStoryId);

  return (
    <div
      className="flex flex-col h-full shrink-0 overflow-hidden"
      style={{
        backgroundColor: "var(--color-bg-pane)",
        borderLeft: rightPaneCollapsed ? "none" : "1px solid var(--color-border)",
        transition: "width 200ms ease",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 shrink-0"
        style={{
          height: "40px",
          borderBottom: "1px solid var(--color-border-subtle)",
        }}
      >
        <span
          style={{
            fontSize: "11px",
            fontWeight: 500,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--color-text-muted)",
          }}
        >
          Control Pane
        </span>
        <button
          onClick={() => setRightPaneCollapsed(!rightPaneCollapsed)}
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
          title={rightPaneCollapsed ? "Expand Control Pane" : "Collapse Control Pane"}
        >
          {rightPaneCollapsed ? (
            <PanelRightOpen size={14} />
          ) : (
            <PanelRightClose size={14} />
          )}
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {!activeStoryId ? (
          /* No story active — Doc 03 §3.2 */
          <div className="flex items-center justify-center h-full">
            <p
              style={{
                fontSize: "12px",
                color: "var(--color-text-muted)",
                textAlign: "center",
              }}
            >
              Open a story to see its details.
            </p>
          </div>
        ) : (
          /* Story active — placeholder sections */
          <div className="flex flex-col gap-4">
            <ApiKeySection />
            <Section title="Context Docs">
              <p style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                No documents attached.
              </p>
            </Section>
            <Section title="System Instructions">
              <p style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                Default system instructions active.
              </p>
            </Section>
            <Section title="Feedback">
              <p style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                No feedback on this branch.
              </p>
            </Section>
            <Section title="Telemetry">
              <p style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                No usage data yet.
              </p>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

/** Temporary API key input for testing streaming — will be replaced by Settings UI */
function ApiKeySection() {
  const [keyInput, setKeyInput] = useState("");
  const [status, setStatus] = useState<"idle" | "validating" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSave = async () => {
    if (!keyInput.trim()) return;
    setStatus("validating");
    setErrorMsg("");
    try {
      await validateAndStoreApiKey(keyInput.trim());
      await saveApiKeyToDb();
      setStatus("saved");
      setKeyInput("");
    } catch (e: unknown) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Section title="API Key">
      <div className="flex flex-col gap-2">
        <div className="flex gap-1.5">
          <input
            type="password"
            value={keyInput}
            onChange={(e) => { setKeyInput(e.target.value); setStatus("idle"); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
            placeholder="Gemini API key..."
            style={{
              flex: 1,
              background: "var(--color-bg-base)",
              border: "1px solid var(--color-border)",
              borderRadius: "4px",
              padding: "4px 8px",
              fontSize: "12px",
              fontFamily: "var(--font-mono)",
              color: "var(--color-text-primary)",
              outline: "none",
            }}
          />
          <button
            onClick={handleSave}
            disabled={status === "validating" || !keyInput.trim()}
            className="flex items-center justify-center shrink-0"
            style={{
              width: "28px",
              height: "28px",
              background: keyInput.trim() ? "var(--color-accent)" : "var(--color-bg-active)",
              border: "none",
              borderRadius: "4px",
              cursor: keyInput.trim() ? "pointer" : "not-allowed",
              color: "#fff",
              opacity: keyInput.trim() ? 1 : 0.5,
            }}
            title="Validate & save API key"
          >
            <Key size={12} />
          </button>
        </div>
        {status === "validating" && (
          <p style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
            Validating key...
          </p>
        )}
        {status === "saved" && (
          <p className="flex items-center gap-1" style={{ fontSize: "11px", color: "var(--color-success)" }}>
            <Check size={11} /> Key saved and active.
          </p>
        )}
        {status === "error" && (
          <p className="flex items-center gap-1" style={{ fontSize: "11px", color: "var(--color-error)" }}>
            <AlertTriangle size={11} /> {errorMsg || "Invalid key."}
          </p>
        )}
      </div>
    </Section>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3
        style={{
          fontSize: "11px",
          fontWeight: 500,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--color-text-muted)",
          marginBottom: "8px",
        }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}
