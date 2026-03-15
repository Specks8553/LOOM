import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getSiblings } from "../../lib/tauriApi";

interface SiblingNavProps {
  storyId: string;
  messageId: string;
  parentId: string | null;
  onNavigate: (siblingId: string) => void;
}

/**
 * `< N / M >` sibling navigation — Doc 09 §10.3.
 * Shown in bubble header when a message has siblings at the same fork point.
 */
export function SiblingNav({
  storyId,
  messageId,
  parentId,
  onNavigate,
}: SiblingNavProps) {
  const [siblings, setSiblings] = useState<string[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getSiblings(storyId, parentId, messageId).then(([ids, idx]) => {
      if (cancelled) return;
      setSiblings(ids);
      setCurrentIdx(idx);
    });
    return () => {
      cancelled = true;
    };
  }, [storyId, parentId, messageId]);

  const handlePrev = useCallback(() => {
    if (currentIdx > 0) onNavigate(siblings[currentIdx - 1]);
  }, [currentIdx, siblings, onNavigate]);

  const handleNext = useCallback(() => {
    if (currentIdx < siblings.length - 1) onNavigate(siblings[currentIdx + 1]);
  }, [currentIdx, siblings, onNavigate]);

  if (siblings.length < 2) return null;

  const btnStyle: React.CSSProperties = {
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: "0 2px",
    color: "var(--color-text-muted)",
    display: "flex",
    alignItems: "center",
  };

  const disabledStyle: React.CSSProperties = {
    ...btnStyle,
    opacity: 0.3,
    cursor: "default",
  };

  return (
    <span
      className="inline-flex items-center gap-0.5"
      style={{
        fontSize: "11px",
        fontFamily: "var(--font-sans)",
        color: "var(--color-text-muted)",
        marginLeft: "auto",
      }}
    >
      <button
        onClick={handlePrev}
        disabled={currentIdx === 0}
        style={currentIdx === 0 ? disabledStyle : btnStyle}
        title="Previous sibling"
      >
        <ChevronLeft size={12} />
      </button>
      <span>
        {currentIdx + 1} / {siblings.length}
      </span>
      <button
        onClick={handleNext}
        disabled={currentIdx === siblings.length - 1}
        style={currentIdx === siblings.length - 1 ? disabledStyle : btnStyle}
        title="Next sibling"
      >
        <ChevronRight size={12} />
      </button>
    </span>
  );
}
