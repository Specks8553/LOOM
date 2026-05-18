/**
 * Doc 27 §Story user bubble / §Story AI bubble — the shared hover action row.
 *
 * Per `Designfiles/Phase 2 - Theater.html`: a borderless icon+label row that
 * sits below the bubble in normal flow and fades in on parent-`group` hover.
 * User bubbles align it right; AI bubbles align it left.
 */

export interface BubbleAction {
  /** Glyph rendered before the label. */
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Destructive actions tint to `--color-error` on hover. */
  destructive?: boolean;
  /** Highlights the entry with the feedback colour (Doc 28). */
  active?: boolean;
}

export function BubbleActionRow({
  align,
  actions,
}: {
  align: 'left' | 'right';
  actions: BubbleAction[];
}) {
  return (
    <div
      className={`pointer-events-none flex gap-0.5 pt-1 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 ${
        align === 'right' ? 'justify-end pr-1' : 'pl-1'
      }`}
    >
      {actions.map((a) => (
        <BubbleActionButton key={a.label} {...a} />
      ))}
    </div>
  );
}

function BubbleActionButton({
  icon,
  label,
  onClick,
  disabled = false,
  destructive = false,
  active = false,
}: BubbleAction) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-[3px] rounded-[4px] px-2 py-[3px] text-[11px] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
        active ? 'text-[var(--color-feedback)]' : 'text-[var(--color-text-muted)]'
      } ${
        destructive
          ? 'enabled:hover:text-[var(--color-error)]'
          : 'enabled:hover:text-[var(--color-accent-text)]'
      }`}
    >
      <span aria-hidden className="text-[12px] leading-none">
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

/**
 * Doc 27 §AI bubble — the `dot-pulse` streaming indicator (Doc 09 §LoadingDots).
 * Three 5px dots, staggered 0.2s.
 */
export function StreamingDots() {
  return (
    <div className="mt-3.5 flex items-center gap-1.5" aria-label="Generating">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-[5px] w-[5px] rounded-full bg-[var(--color-text-muted)]"
          style={{ animation: `dot-pulse 1.2s ease-in-out ${i * 0.2}s infinite` }}
        />
      ))}
    </div>
  );
}
