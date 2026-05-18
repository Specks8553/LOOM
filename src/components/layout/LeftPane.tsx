import { type ReactNode } from 'react';

interface LeftPaneProps {
  width: number;
  children: ReactNode;
}

/** Doc 10 §Three-Pane Shell. Fixed-width left pane (Navigator host). */
export function LeftPane({ width, children }: LeftPaneProps) {
  return (
    <aside
      className="flex h-full shrink-0 flex-col overflow-hidden bg-[var(--color-bg-pane)]"
      style={{ width }}
    >
      {children}
    </aside>
  );
}
