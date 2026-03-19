import { Bookmark } from "lucide-react";
import type { Checkpoint } from "../../lib/types";

interface CheckpointMarkerProps {
  checkpoint: Checkpoint;
  onContextMenu: (e: React.MouseEvent, cp: Checkpoint) => void;
  isRenaming?: boolean;
  renameValue?: string;
  onRenameChange?: (value: string) => void;
  onRenameSubmit?: () => void;
  onRenameCancel?: () => void;
}

export function CheckpointMarker({
  checkpoint,
  onContextMenu,
  isRenaming,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
}: CheckpointMarkerProps) {
  if (isRenaming) {
    return (
      <div className="flex items-center gap-1.5 py-1 px-2">
        <Bookmark
          size={12}
          style={{ color: "var(--color-checkpoint)", flexShrink: 0 }}
        />
        <input
          autoFocus
          className="flex-1 text-[11px] font-medium uppercase tracking-wider bg-transparent border-b px-1 py-0.5 outline-none"
          style={{
            color: "var(--color-checkpoint)",
            borderColor: "var(--color-accent)",
          }}
          value={renameValue ?? ""}
          onChange={(e) => onRenameChange?.(e.target.value)}
          onBlur={() => onRenameSubmit?.()}
          onKeyDown={(e) => {
            if (e.key === "Enter") onRenameSubmit?.();
            if (e.key === "Escape") onRenameCancel?.();
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-1.5 py-1 px-2 cursor-default select-none"
      onContextMenu={(e) => onContextMenu(e, checkpoint)}
    >
      <Bookmark
        size={12}
        style={{ color: "var(--color-checkpoint)", flexShrink: 0 }}
      />
      <span
        className="text-[11px] font-medium uppercase tracking-wider truncate"
        style={{ color: "var(--color-checkpoint)" }}
      >
        {checkpoint.name}
      </span>
    </div>
  );
}
