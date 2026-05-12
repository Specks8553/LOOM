import { useEffect, useState } from 'react';

import { useWorkspaceStore } from '@/stores/workspaceStore';

/**
 * Doc 15 §Status View. Right-pane section.
 *
 * v2.0 glyphs and copy are ⚠️ provisional (Doc 15 § Status View) — visual
 * design phase will tune. Phase 3 lands the structure and the live data
 * binding.
 */
export function StatusSection() {
  const status = useWorkspaceStore((s) => s.generationStatus);
  const activeStoryId = useWorkspaceStore((s) => s.activeStoryId);
  const tokenEstimate = useWorkspaceStore((s) => s.tokenEstimate);

  // Tick once a second while a timer is running so duration updates.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (status.kind !== 'thinking' && status.kind !== 'streaming') return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [status.kind]);

  if (activeStoryId === null) {
    return <Section>No story selected.</Section>;
  }

  switch (status.kind) {
    case 'idle': {
      const ready = tokenEstimate?.total ?? null;
      return (
        <Section glyph="●">{ready === null ? 'Idle' : `${formatTokens(ready)} tok ready`}</Section>
      );
    }
    case 'preparing':
      return (
        <Section glyph="◐">
          Preparing
          {tokenEstimate !== null && <> · {formatTokens(tokenEstimate.total)} tok ready</>}
        </Section>
      );
    case 'thinking': {
      const elapsed = ((Date.now() - status.startedAt) / 1000).toFixed(1);
      return <Section glyph="◔">Thinking · {elapsed}s</Section>;
    }
    case 'streaming': {
      const seconds = (Date.now() - status.startedAt) / 1000;
      const rate = seconds > 0 ? Math.round(status.tokenCount / seconds) : 0;
      return (
        <Section glyph="◓">
          Streaming · {formatTokens(status.tokenCount)} tok · {seconds.toFixed(1)}s · ~{rate} tok/s
        </Section>
      );
    }
    case 'complete': {
      const seconds = (status.durationMs / 1000).toFixed(1);
      return (
        <Section glyph="✓">
          Complete
          {status.tokenCount !== null && <> · {formatTokens(status.tokenCount)} tok</>}
          {' · '}
          {seconds}s
        </Section>
      );
    }
    case 'stopped':
      return <Section glyph="⚠">Stopped · {status.finishReason}</Section>;
  }
}

function formatTokens(n: number): string {
  return n.toLocaleString('en-US');
}

function Section({ glyph, children }: { glyph?: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-[--color-border] px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-wider text-[--color-text-muted]">
        Status
      </div>
      <div className="mt-1 flex items-center gap-2 text-[12px] text-[--color-text-primary]">
        {glyph !== undefined && <span aria-hidden>{glyph}</span>}
        <span>{children}</span>
      </div>
    </div>
  );
}
