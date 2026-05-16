// Theme application (Doc 20 §Theme System / §applyTheme Contract).
//
// `applyTheme` is the single place that writes theme-related CSS custom
// properties to `:root`. One function, one call site (the App-root effect in
// App.tsx), one subscription — this is the v2.0 fix for v1.0's drift between
// `applyAccentColor`, `applyBodyFont`, `applyBubbleColors`, `applyFeatureColors`.
//
// Derivation of the `-hover` / `-subtle` / `-text` variants from a single hex
// input lives here so the rule is defined exactly once.

import type { ResolvedSettings } from '@/lib/types';

/** Resolved theme colours fed to `applyTheme`. Doc 20 §applyTheme Contract. */
export interface ThemeSnapshot {
  accent: string;
  ghostwriter: string;
  accordion: string;
  checkpoint: string;
  feedback: string;
  bubbleUser: string;
  bubbleAi: string;
  /** A CSS `font-family` stack — drives `--font-theater-body`. */
  bodyFont: string;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse `#rgb` / `#rrggbb`. Returns null for anything else. */
function parseHex(hex: string): Rgb | null {
  const m = hex.trim().match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return null;
  let body = m[1];
  if (body.length === 3) {
    body = body
      .split('')
      .map((c) => c + c)
      .join('');
  }
  return {
    r: Number.parseInt(body.slice(0, 2), 16),
    g: Number.parseInt(body.slice(2, 4), 16),
    b: Number.parseInt(body.slice(4, 6), 16),
  };
}

const clamp = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

function toHex({ r, g, b }: Rgb): string {
  const h = (n: number) => clamp(n).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Move every channel toward white (`amount > 0`) or black (`amount < 0`). */
function shade(rgb: Rgb, amount: number): Rgb {
  const target = amount >= 0 ? 255 : 0;
  const t = Math.abs(amount);
  return {
    r: rgb.r + (target - rgb.r) * t,
    g: rgb.g + (target - rgb.g) * t,
    b: rgb.b + (target - rgb.b) * t,
  };
}

function rgba(rgb: Rgb, alpha: number): string {
  return `rgba(${clamp(rgb.r)}, ${clamp(rgb.g)}, ${clamp(rgb.b)}, ${alpha})`;
}

/**
 * A feature/accent colour and its derived variants. Mirrors v1.0's
 * `applyAccentColor` derivation, kept in one place (Doc 20 §applyTheme).
 */
function triad(
  base: string,
  fallback: string,
): {
  base: string;
  hover: string;
  subtle: string;
  text: string;
} {
  const rgb = parseHex(base) ?? parseHex(fallback) ?? { r: 124, g: 58, b: 237 };
  return {
    base: toHex(rgb),
    hover: toHex(shade(rgb, 0.14)),
    subtle: rgba(rgb, 0.1),
    text: toHex(shade(rgb, 0.45)),
  };
}

/** Map a `body_font` setting value to a concrete CSS font-family stack. */
export function bodyFontStack(value: string): string {
  const v = value.trim().toLowerCase();
  if (v === '' || v === 'serif') return "Georgia, 'Times New Roman', ui-serif, serif";
  if (v === 'sans' || v === 'sans-serif') return 'ui-sans-serif, system-ui, sans-serif';
  if (v === 'mono' || v === 'monospace') return "ui-monospace, 'SF Mono', Menlo, monospace";
  // Anything else is treated as an explicit stack the writer supplied.
  return value;
}

/**
 * Build a `ThemeSnapshot` from the resolved settings cascade. Empty feature
 * colours track the accent; empty bubble colours fall back to neutral
 * defaults; feedback defaults to its own stable amber (Doc 20 §Theme System).
 */
export function snapshotFromResolved(r: ResolvedSettings): ThemeSnapshot {
  const accent = r.accent_color || '#7c3aed';
  return {
    accent,
    ghostwriter: r.ghostwriter_color || accent,
    accordion: r.accordion_color || accent,
    checkpoint: r.checkpoint_color || accent,
    feedback: r.feedback_color || '#f59e0b',
    bubbleUser: r.bubble_user_color || triad(accent, accent).subtle,
    bubbleAi: r.bubble_ai_color || '#141414',
    bodyFont: bodyFontStack(r.body_font),
  };
}

/**
 * Write every theme-related CSS variable to `:root`. Safe to call on every
 * settings change — it only sets inline custom properties.
 */
export function applyTheme(snapshot: ThemeSnapshot): void {
  const root = document.documentElement;
  const set = (name: string, value: string) => root.style.setProperty(name, value);

  const accent = triad(snapshot.accent, '#7c3aed');
  set('--color-accent', accent.base);
  set('--color-accent-hover', accent.hover);
  set('--color-accent-subtle', accent.subtle);
  set('--color-accent-text', accent.text);

  const gw = triad(snapshot.ghostwriter, snapshot.accent);
  set('--color-ghostwriter', gw.base);
  set('--color-ghostwriter-hover', gw.hover);
  set('--color-ghostwriter-subtle', gw.subtle);
  set('--color-ghostwriter-diff', gw.base);

  const acc = triad(snapshot.accordion, snapshot.accent);
  set('--color-accordion', acc.base);
  set('--color-accordion-hover', acc.hover);
  set('--color-accordion-subtle', acc.subtle);

  set('--color-checkpoint', triad(snapshot.checkpoint, snapshot.accent).base);

  const fb = triad(snapshot.feedback, '#f59e0b');
  set('--color-feedback', fb.base);
  set('--color-feedback-hover', fb.hover);
  set('--color-feedback-subtle', fb.subtle);

  set('--bubble-user-bg', snapshot.bubbleUser);
  set('--bubble-ai-bg', snapshot.bubbleAi);

  set('--font-theater-body', snapshot.bodyFont);

  // shadcn primitives track the accent (Doc 20 §applyTheme).
  set('--primary', accent.base);
  set('--ring', accent.base);
}
