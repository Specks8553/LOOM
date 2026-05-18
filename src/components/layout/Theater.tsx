import { type ReactNode } from 'react';

interface TheaterProps {
  children: ReactNode;
}

/** Doc 10 §Three-Pane Shell. Center pane — flex-1, takes remaining space. */
export function Theater({ children }: TheaterProps) {
  return (
    <section className="flex h-full flex-1 flex-col overflow-hidden bg-[var(--color-bg-theater)]">
      {children}
    </section>
  );
}
