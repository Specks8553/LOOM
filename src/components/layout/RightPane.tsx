import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";

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
