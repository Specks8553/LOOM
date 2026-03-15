import { useEffect, useRef } from "react";

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onClose]);

  // Viewport edge detection
  const adjustedPos = { x, y };
  if (typeof window !== "undefined") {
    const menuWidth = 180;
    const menuHeight = items.length * 28 + 8;
    if (x + menuWidth > window.innerWidth) adjustedPos.x = x - menuWidth;
    if (y + menuHeight > window.innerHeight) adjustedPos.y = y - menuHeight;
    if (adjustedPos.x < 0) adjustedPos.x = 4;
    if (adjustedPos.y < 0) adjustedPos.y = 4;
  }

  return (
    <div
      ref={menuRef}
      className="flex flex-col"
      style={{
        position: "fixed",
        left: adjustedPos.x,
        top: adjustedPos.y,
        zIndex: 200,
        backgroundColor: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
        borderRadius: "6px",
        padding: "4px 0",
        minWidth: "160px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
      }}
    >
      {items.map((item, i) => (
        <div key={i}>
          {item.separator && (
            <div
              style={{
                height: "1px",
                backgroundColor: "var(--color-border-subtle)",
                margin: "4px 0",
              }}
            />
          )}
          <button
            onClick={() => {
              if (!item.disabled) {
                item.onClick();
                onClose();
              }
            }}
            disabled={item.disabled}
            className="flex items-center gap-2 w-full transition-colors duration-100"
            style={{
              height: "28px",
              padding: "0 12px",
              background: "none",
              border: "none",
              cursor: item.disabled ? "default" : "pointer",
              fontSize: "13px",
              fontFamily: "var(--font-sans)",
              color: item.disabled
                ? "var(--color-text-muted)"
                : item.danger
                  ? "var(--color-error)"
                  : "var(--color-text-primary)",
              opacity: item.disabled ? 0.5 : 1,
              textAlign: "left",
            }}
            onMouseEnter={(e) => {
              if (!item.disabled) {
                e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            {item.icon && (
              <span className="flex items-center" style={{ width: "16px" }}>
                {item.icon}
              </span>
            )}
            {item.label}
          </button>
        </div>
      ))}
    </div>
  );
}
