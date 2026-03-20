import { useState } from "react";
import { ChevronDown, AlertTriangle, Bookmark } from "lucide-react";
import type { AccordionSegment, Checkpoint } from "../../lib/types";
import { useAccordionStore } from "../../stores/accordionStore";

interface AccordionSummaryCardProps {
  segment: AccordionSegment;
  checkpoint: Checkpoint | undefined; // the end checkpoint (segment heading)
  messageCount: number;
  storyId: string;
  leafId: string;
}

/**
 * Accordion Summary Card — Doc 18 §7.2.
 * Rendered in Theater when a segment is collapsed.
 * Shows checkpoint name, message count, summary text, and expand button.
 */
export function AccordionSummaryCard({
  segment,
  checkpoint,
  messageCount,
  storyId,
  leafId,
}: AccordionSummaryCardProps) {
  const expand = useAccordionStore((s) => s.expand);
  const summarise = useAccordionStore((s) => s.summarise);
  const [summarising, setSummarising] = useState(false);

  const handleExpand = () => expand(segment.id, storyId);

  const handleResummarise = async () => {
    setSummarising(true);
    await summarise(segment.id, storyId, leafId);
    setSummarising(false);
  };

  const cpName = checkpoint?.name ?? "Chapter";

  return (
    <div
      style={{
        margin: "8px 0",
        border: "1px solid var(--color-border)",
        borderRadius: "8px",
        backgroundColor: "var(--color-bg-elevated)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2"
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid var(--color-border-subtle)",
          fontSize: "12px",
          fontFamily: "var(--font-sans)",
          color: "var(--color-text-muted)",
        }}
      >
        <Bookmark size={13} style={{ color: "var(--color-accent)" }} />
        <span style={{ fontWeight: 600, color: "var(--color-text-secondary)" }}>
          {cpName}
        </span>
        <span>&middot;</span>
        <span>{messageCount} messages</span>

        {segment.is_stale && (
          <span
            className="flex items-center gap-1"
            style={{ color: "var(--color-warning)", cursor: "pointer" }}
            title="Content in this chapter has changed since the last summary. Click to regenerate."
            onClick={handleResummarise}
          >
            <AlertTriangle size={12} />
            <span style={{ fontSize: "11px" }}>outdated</span>
          </span>
        )}

        <span style={{ marginLeft: "auto" }}>
          <button
            onClick={handleExpand}
            className="flex items-center gap-1"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "11px",
              fontFamily: "var(--font-sans)",
              color: "var(--color-accent)",
              padding: "2px 4px",
              borderRadius: "4px",
            }}
          >
            <ChevronDown size={12} />
            expand
          </button>
        </span>
      </div>

      {/* Summary body */}
      <div
        style={{
          padding: "10px 14px",
          fontSize: "14px",
          fontFamily: "var(--font-theater-body)",
          color: "var(--color-text-secondary)",
          lineHeight: 1.65,
          whiteSpace: "pre-wrap",
        }}
      >
        {summarising ? (
          <span style={{ fontStyle: "italic", color: "var(--color-text-muted)" }}>
            Generating summary...
          </span>
        ) : (
          segment.summary ?? "No summary available."
        )}
      </div>
    </div>
  );
}
