import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { type ReactNode } from 'react';

import { useAppStore } from '@/stores/appStore';

interface RightPaneProps {
  width: number;
  children: ReactNode;
}

/**
 * Doc 10 §Three-Pane Shell + §Right Pane Collapse. Manually collapsible to a
 * 32px toggle bar. Collapse button (`PanelRightClose`) lives in the expanded
 * header; expand button (`PanelRightOpen`) sits in the collapsed bar.
 */
export function RightPane({ width, children }: RightPaneProps) {
  const collapsed = useAppStore((s) => s.rightPaneCollapsed);
  const toggle = useAppStore((s) => s.toggleRightPane);

  if (collapsed) {
    return (
      <aside
        className="flex h-full w-8 shrink-0 flex-col items-center border-l border-[var(--color-border)] bg-[var(--color-bg-pane)] py-2"
        aria-label="Right pane (collapsed)"
      >
        <button
          type="button"
          onClick={toggle}
          aria-label="Expand right pane"
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
        >
          <PanelRightOpen size={14} aria-hidden />
        </button>
      </aside>
    );
  }

  return (
    <aside
      className="flex h-full shrink-0 flex-col overflow-hidden bg-[var(--color-bg-pane)]"
      style={{ width }}
    >
      <header className="flex h-9 shrink-0 items-center justify-end px-2">
        <button
          type="button"
          onClick={toggle}
          aria-label="Collapse right pane"
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
        >
          <PanelRightClose size={14} aria-hidden />
        </button>
      </header>
      <div className="flex flex-1 flex-col overflow-hidden">{children}</div>
    </aside>
  );
}
