import { useCallback, useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  separator?: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

/* ------------------------------------------------------------------ */
/*  useContextMenu hook                                                */
/* ------------------------------------------------------------------ */

export function useContextMenu() {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const showContextMenu = useCallback(
    (e: React.MouseEvent, items: MenuItem[]) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, items });
    },
    [],
  );

  const hideContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  return { contextMenu, showContextMenu, hideContextMenu } as const;
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const menuStyle: React.CSSProperties = {
  position: "fixed",
  zIndex: 9999,
  minWidth: 160,
  padding: 4,
  borderRadius: 6,
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border)",
  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
  fontFamily: "var(--font-sans)",
  fontSize: 12,
  color: "var(--color-text-primary)",
  animation: "contextMenuFadeIn 150ms ease",
};

const itemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 12px",
  borderRadius: 4,
  cursor: "pointer",
  userSelect: "none",
  transition: "background 120ms ease",
  background: "transparent",
  border: "none",
  width: "100%",
  fontFamily: "inherit",
  fontSize: "inherit",
  color: "inherit",
  textAlign: "left",
};

const itemHoverStyle: React.CSSProperties = {
  background: "var(--color-bg-hover)",
};

const itemDisabledStyle: React.CSSProperties = {
  opacity: 0.4,
  cursor: "default",
};

const separatorStyle: React.CSSProperties = {
  height: 1,
  background: "var(--color-border-subtle)",
  margin: "4px 0",
};

/* ------------------------------------------------------------------ */
/*  Keyframe injection (once)                                          */
/* ------------------------------------------------------------------ */

let keyframesInjected = false;

function injectKeyframes() {
  if (keyframesInjected) return;
  keyframesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    @keyframes contextMenuFadeIn {
      from { opacity: 0; transform: scale(0.96); }
      to   { opacity: 1; transform: scale(1); }
    }
  `;
  document.head.appendChild(style);
}

/* ------------------------------------------------------------------ */
/*  ContextMenu component                                              */
/* ------------------------------------------------------------------ */

interface ContextMenuProps {
  menu: ContextMenuState;
  onClose: () => void;
}

export function ContextMenu({ menu, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>({
    left: menu.x,
    top: menu.y,
  });

  /* Inject keyframes on first mount */
  useEffect(() => {
    injectKeyframes();
  }, []);

  /* Position adjustment: flip if near edge */
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = menu.x;
    let top = menu.y;

    if (left + rect.width > vw) {
      left = menu.x - rect.width;
    }
    if (top + rect.height > vh) {
      top = menu.y - rect.height;
    }

    /* Clamp to viewport */
    left = Math.max(0, left);
    top = Math.max(0, top);

    setPosition({ left, top });
  }, [menu.x, menu.y]);

  /* Close on click outside */
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose]);

  /* Close on Escape */
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      style={{ ...menuStyle, left: position.left, top: position.top }}
      role="menu"
    >
      {menu.items.map((item, index) => {
        if (item.separator) {
          return <div key={`sep-${index}`} style={separatorStyle} role="separator" />;
        }

        const Icon = item.icon;
        const isHovered = hoveredIndex === index && !item.disabled;

        return (
          <button
            key={`${item.label}-${index}`}
            role="menuitem"
            aria-disabled={item.disabled ?? false}
            style={{
              ...itemStyle,
              ...(isHovered ? itemHoverStyle : {}),
              ...(item.disabled ? itemDisabledStyle : {}),
            }}
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
            onClick={() => {
              if (item.disabled) return;
              item.onClick();
              onClose();
            }}
          >
            {Icon && <Icon size={14} style={{ flexShrink: 0 }} />}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
