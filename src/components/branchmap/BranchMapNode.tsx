import { useState, useCallback, useRef } from "react";
import { Pencil, Sparkles, RefreshCw } from "lucide-react";
import type { BranchMapNode as NodeType } from "../../lib/types";

interface BranchMapNodeProps {
  node: NodeType;
  isGenerating: boolean;
  onClick: (node: NodeType) => void;
  onContextMenu: (e: React.MouseEvent, node: NodeType) => void;
}

export function BranchMapNodeCard({
  node,
  isGenerating,
  onClick,
  onContextMenu,
}: BranchMapNodeProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleMouseEnter = useCallback(() => {
    tooltipTimer.current = setTimeout(() => setShowTooltip(true), 300);
  }, []);

  const handleMouseLeave = useCallback(() => {
    clearTimeout(tooltipTimer.current);
    setShowTooltip(false);
  }, []);

  const isActive = node.is_current_leaf;
  const isPulsing = isActive && isGenerating;

  return (
    <div
      className="relative"
      data-node-id={node.model_msg_id}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div
        onClick={() => onClick(node)}
        onContextMenu={(e) => onContextMenu(e, node)}
        className="rounded-md px-3 py-2 cursor-pointer transition-colors duration-150"
        style={{
          background: isActive
            ? "var(--color-bg-active)"
            : "var(--color-bg-elevated)",
          border: `1px solid ${isActive ? "var(--color-accent)" : "var(--color-border)"}`,
          animation: isPulsing
            ? "node-pulse 1.5s ease-in-out infinite"
            : undefined,
        }}
      >
        {/* Header: origin icons + tokens */}
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-1">
            {node.user_was_edited && (
              <Pencil size={10} style={{ color: "var(--color-text-muted)" }} />
            )}
            {node.model_origin === "Ghostwriter" && (
              <Sparkles size={10} style={{ color: "var(--color-accent)" }} />
            )}
            {node.model_origin === "Regenerated" && (
              <RefreshCw size={10} style={{ color: "var(--color-text-muted)" }} />
            )}
          </div>
          {node.token_count != null && (
            <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
              {node.token_count}t
            </span>
          )}
        </div>

        {/* Excerpt */}
        <p
          className="text-[12px] leading-tight line-clamp-2"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {node.excerpt || "(empty)"}
        </p>

        {/* Footer: timestamp + active dot */}
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
            {formatTime(node.created_at)}
          </span>
          {isActive && (
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: "var(--color-accent)" }}
            />
          )}
        </div>
      </div>

      {/* Hover tooltip */}
      {showTooltip && (
        <div
          className="absolute z-50 left-full ml-2 top-0 rounded-md px-3 py-2 text-[11px] max-w-[260px] shadow-lg pointer-events-none"
          style={{
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-secondary)",
          }}
        >
          <p className="mb-1 leading-snug">{node.excerpt}</p>
          <div className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
            <div>{new Date(node.created_at).toLocaleString()}</div>
            {node.token_count != null && <div>{node.token_count} tokens</div>}
            {node.model_origin !== "Normal" && (
              <div className="mt-0.5">
                {node.model_origin === "Ghostwriter" && "Ghostwriter edit"}
                {node.model_origin === "Regenerated" && "Regenerated"}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      " " +
      d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}
