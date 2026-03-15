import { useCallback, useRef } from "react";

interface PaneDividerProps {
  /** Current width of the pane being resized */
  currentWidth: number;
  /** Min width constraint */
  min: number;
  /** Max width constraint */
  max: number;
  /** Called with new width during drag */
  onResize: (width: number) => void;
  /** Called when drag ends — persist final width */
  onResizeEnd?: () => void;
  /** Which side of the divider the pane is on */
  side: "left" | "right";
}

export function PaneDivider({
  currentWidth,
  min,
  max,
  onResize,
  onResizeEnd,
  side,
}: PaneDividerProps) {
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;
      startWidthRef.current = currentWidth;

      const onMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startXRef.current;
        const newWidth =
          side === "left"
            ? startWidthRef.current + delta
            : startWidthRef.current - delta;
        onResize(Math.round(Math.min(max, Math.max(min, newWidth))));
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        onResizeEnd?.();
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [currentWidth, min, max, onResize, onResizeEnd, side],
  );

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        width: "1px",
        backgroundColor: "var(--color-border)",
        cursor: "col-resize",
        position: "relative",
        flexShrink: 0,
      }}
    >
      {/* Invisible hit area */}
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: "-3px",
          width: "7px",
          cursor: "col-resize",
        }}
      />
    </div>
  );
}
