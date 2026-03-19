import { useCallback } from "react";
import { Loader2 } from "lucide-react";
import { useGhostwriterStore } from "../../stores/ghostwriterStore";

/**
 * Ghostwriter toolbar — Doc 16 §2.3 / §2.6.
 * Appears below the active AI bubble in Ghostwriter mode.
 * Two phases: selection (instruction + generate) and review (accept/reject).
 */
export function GhostwriterToolbar({
  onGenerate,
  onAccept,
  onReject,
  onCancel,
}: {
  onGenerate: () => void;
  onAccept: () => void;
  onReject: () => void;
  onCancel: () => void;
}) {
  const phase = useGhostwriterStore((s) => s.phase);
  const selection = useGhostwriterStore((s) => s.selection);
  const instruction = useGhostwriterStore((s) => s.instruction);
  const setInstruction = useGhostwriterStore((s) => s.setInstruction);
  const isGenerating = useGhostwriterStore((s) => s.isGenerating);

  const canGenerate =
    selection !== null &&
    selection.selectedText.length > 0 &&
    instruction.trim().length > 0 &&
    !isGenerating;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && e.ctrlKey && canGenerate) {
        e.preventDefault();
        onGenerate();
      }
    },
    [canGenerate, onGenerate],
  );

  if (phase === "reviewing") {
    return (
      <div
        style={{
          maxWidth: "80%",
          marginTop: "6px",
          padding: "10px 14px",
          backgroundColor: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
          borderRadius: "8px",
        }}
      >
        <div className="flex items-center gap-2" style={{ marginBottom: "6px" }}>
          <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-accent)" }}>
            ✦ Ghostwriter — Review changes
          </span>
        </div>
        <p style={{ fontSize: "11px", color: "var(--color-text-muted)", marginBottom: "10px" }}>
          Changed sections are highlighted.
        </p>
        <div className="flex items-center justify-between">
          <button
            onClick={onReject}
            style={{
              background: "none",
              border: "1px solid var(--color-border)",
              borderRadius: "6px",
              padding: "5px 14px",
              fontSize: "12px",
              fontFamily: "var(--font-sans)",
              fontWeight: 500,
              color: "var(--color-text-secondary)",
              cursor: "pointer",
            }}
          >
            Reject
          </button>
          <button
            onClick={onAccept}
            style={{
              background: "var(--color-accent)",
              border: "none",
              borderRadius: "6px",
              padding: "5px 14px",
              fontSize: "12px",
              fontFamily: "var(--font-sans)",
              fontWeight: 500,
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Accept changes ✓
          </button>
        </div>
      </div>
    );
  }

  // Selection / generating phase
  return (
    <div
      style={{
        maxWidth: "80%",
        marginTop: "6px",
        padding: "10px 14px",
        backgroundColor: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
        borderRadius: "8px",
      }}
    >
      <div className="flex items-center gap-2" style={{ marginBottom: "6px" }}>
        <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-accent)" }}>
          ✦ Ghostwriter Mode
        </span>
      </div>
      <p style={{ fontSize: "11px", color: "var(--color-text-muted)", marginBottom: "8px" }}>
        {selection
          ? `Selected ${selection.selectedText.length} chars. Describe what to change.`
          : "Select text in the passage above, then describe what to change."}
      </p>
      <textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe what to change about the selected text..."
        disabled={isGenerating}
        style={{
          width: "100%",
          minHeight: "60px",
          resize: "vertical",
          background: "var(--color-bg-base)",
          border: "1px solid var(--color-border)",
          borderRadius: "6px",
          padding: "8px 10px",
          fontSize: "13px",
          fontFamily: "var(--font-sans)",
          color: "var(--color-text-primary)",
          lineHeight: 1.5,
          outline: "none",
          opacity: isGenerating ? 0.6 : 1,
        }}
      />
      <div className="flex items-center justify-between" style={{ marginTop: "8px" }}>
        <button
          onClick={onCancel}
          style={{
            background: "none",
            border: "1px solid var(--color-border)",
            borderRadius: "6px",
            padding: "5px 14px",
            fontSize: "12px",
            fontFamily: "var(--font-sans)",
            fontWeight: 500,
            color: "var(--color-text-secondary)",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          onClick={onGenerate}
          disabled={!canGenerate}
          className="flex items-center gap-1.5"
          style={{
            background: canGenerate ? "var(--color-accent)" : "var(--color-bg-active)",
            border: "none",
            borderRadius: "6px",
            padding: "5px 14px",
            fontSize: "12px",
            fontFamily: "var(--font-sans)",
            fontWeight: 500,
            color: canGenerate ? "#fff" : "var(--color-text-muted)",
            cursor: canGenerate ? "pointer" : "not-allowed",
            opacity: canGenerate ? 1 : 0.6,
          }}
        >
          {isGenerating ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Generating...
            </>
          ) : (
            "Generate ✦"
          )}
        </button>
      </div>
    </div>
  );
}
