import { useCallback, useEffect, useRef } from 'react';

interface PaneDividerProps {
  /** Which side the divider belongs to. Determines drag-direction sign. */
  side: 'left' | 'right';
  /** Current width of the adjacent pane (px). */
  width: number;
  /** Minimum allowed pane width (px). */
  min: number;
  /** Maximum allowed pane width (px). */
  max: number;
  /** Called continuously while dragging with the new clamped width. */
  onResize: (width: number) => void;
  /** Called once on mouseup with the final width — caller persists it. */
  onResizeEnd: (width: number) => void;
}

/**
 * 1px visual line with a 7px invisible hit area centered on it (Doc 10
 * §PaneDivider). Drag to resize the adjacent pane within `[min, max]`.
 */
export function PaneDivider({ side, width, min, max, onResize, onResizeEnd }: PaneDividerProps) {
  const startX = useRef(0);
  const startW = useRef(0);
  const dragging = useRef(false);
  const finalW = useRef(width);

  // Keep finalW in sync with the controlled `width` prop so the second drag
  // doesn't snap back to the value at component mount.
  useEffect(() => {
    finalW.current = width;
  }, [width]);

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging.current) return;
      const deltaRaw = e.clientX - startX.current;
      // Left divider: dragging right grows the left pane (delta positive).
      // Right divider: dragging left grows the right pane (delta inverted).
      const delta = side === 'left' ? deltaRaw : -deltaRaw;
      const next = Math.max(min, Math.min(max, startW.current + delta));
      finalW.current = next;
      onResize(next);
    },
    [side, min, max, onResize],
  );

  const onMouseUp = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    onResizeEnd(finalW.current);
  }, [onMouseMove, onResizeEnd]);

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onMouseDown={onMouseDown}
      className="group relative h-full w-[7px] shrink-0 cursor-col-resize"
    >
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[--color-border]" />
    </div>
  );
}
