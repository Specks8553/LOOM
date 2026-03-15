import { useCallback } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";

interface BulkDeleteConfirmProps {
  itemNames: string[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function BulkDeleteConfirm({ itemNames, onConfirm, onCancel }: BulkDeleteConfirmProps) {
  const dialogRef = useFocusTrap(true);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    },
    [onCancel],
  );

  const displayNames = itemNames.slice(0, 10);
  const remaining = itemNames.length - displayNames.length;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.5)", zIndex: 300 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={dialogRef}
        className="flex flex-col gap-3"
        style={{
          width: "320px",
          backgroundColor: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
          borderRadius: "8px",
          padding: "16px",
        }}
      >
        <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary)" }}>
          Delete {itemNames.length} item{itemNames.length === 1 ? "" : "s"}?
        </p>

        <ul style={{ margin: 0, paddingLeft: "16px" }}>
          {displayNames.map((name, i) => (
            <li
              key={i}
              style={{
                fontSize: "13px",
                color: "var(--color-text-secondary)",
                lineHeight: 1.6,
              }}
            >
              {name}
            </li>
          ))}
          {remaining > 0 && (
            <li style={{ fontSize: "13px", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
              and {remaining} more
            </li>
          )}
        </ul>

        <p style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
          This will move them to Trash.
        </p>

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            style={{
              background: "none",
              border: "1px solid var(--color-border)",
              borderRadius: "4px",
              padding: "6px 12px",
              fontSize: "13px",
              fontFamily: "var(--font-sans)",
              color: "var(--color-text-primary)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              background: "var(--color-error)",
              border: "none",
              borderRadius: "4px",
              padding: "6px 12px",
              fontSize: "13px",
              fontFamily: "var(--font-sans)",
              color: "#fff",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
