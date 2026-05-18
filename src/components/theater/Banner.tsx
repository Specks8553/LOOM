import { ChevronRight } from 'lucide-react';
import { type ReactNode } from 'react';

interface BannerProps {
  /** Banner label — e.g. "Consulting 2 · 14 messages" or "Chapter 3 · 7 tok saved". */
  label: string;
  expanded: boolean;
  onToggle: () => void;
  /** Optional: emphasis bar on the left edge — used for the active session
   *  (Doc 27 §Active session emphasis). */
  active?: boolean;
  /** Optional: opens the right-click context menu (rename, enter, delete).
   *  Phase 4 uses native `contextmenu` on the row; the dots icon is
   *  cosmetic for now. */
  onContextMenu?: (e: React.MouseEvent) => void;
  /** Slot for the bottom action row (Enter/Exit). Only rendered when
   *  expanded. */
  bottomActions?: ReactNode;
  /** Body content (the framed partition body). Only rendered when expanded. */
  children?: ReactNode;
}

/**
 * Doc 27 §Banners. Collapsible banner used for handover, consulting, and
 * (Phase 7) accordion segments. The visual frame and the active-session
 * accent bar live here; per-kind behaviour lives at the call sites.
 *
 * Visual tokens are ⚠️ provisional pending Doc 08's full token set.
 */
export function Banner({
  label,
  expanded,
  onToggle,
  active = false,
  onContextMenu,
  bottomActions,
  children,
}: BannerProps) {
  return (
    <div
      className={`my-2 overflow-hidden rounded-md border border-[--color-border] bg-[--color-bg-elevated] ${
        active ? 'border-l-2 border-l-[--color-accent]' : ''
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        onContextMenu={onContextMenu}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[--color-bg-hover]"
      >
        <ChevronRight
          size={14}
          aria-hidden
          className={`shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        <span className="flex-1 truncate text-[12px] font-medium text-[--color-text-primary]">
          {label}
        </span>
      </button>

      {expanded && (
        <>
          <div className="border-t border-[--color-border] bg-[--color-bg-base] px-3 py-2">
            {children}
          </div>
          {bottomActions !== undefined && (
            <div className="flex items-center justify-end gap-2 border-t border-[--color-border] px-3 py-2">
              {bottomActions}
            </div>
          )}
        </>
      )}
    </div>
  );
}
