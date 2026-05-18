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

interface Hsl {
  h: number;
  s: number;
  l: number;
}

/** RGB (0–255) → HSL (h 0–360, s/l 0–100). */
function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

/** HSL (h 0–360, s/l 0–100) → RGB (0–255). */
function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hn = h / 360;
  const sn = s / 100;
  const ln = l / 100;
  if (sn === 0) {
    const v = ln * 255;
    return { r: v, g: v, b: v };
  }
  const hue = (p: number, q: number, t: number): number => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };
  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  return {
    r: hue(p, q, hn + 1 / 3) * 255,
    g: hue(p, q, hn) * 255,
    b: hue(p, q, hn - 1 / 3) * 255,
  };
}

/** `--color-bg-base` channels — the surface accent-subtle is blended onto (Doc 08). */
const BG_BASE: Rgb = { r: 16, g: 15, b: 12 };

/** Sage — the default accent and the ultimate derivation fallback (Doc 08). */
export const DEFAULT_ACCENT = '#6b9f78';

/**
 * A feature/accent colour and its derived variants — Doc 08 §Accent Color
 * System: hover = HSL lightness −10; text = saturation ×0.8, lightness +35;
 * subtle = 8% alpha blend of the colour on `--color-bg-base`, flattened to a
 * solid hex.
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
  // Final fallback is Sage (#6b9f78) as literal channels — DEFAULT_ACCENT.
  const rgb = parseHex(base) ?? parseHex(fallback) ?? { r: 107, g: 159, b: 120 };
  const hsl = rgbToHsl(rgb);
  const hover = hslToRgb({ h: hsl.h, s: hsl.s, l: Math.max(0, hsl.l - 10) });
  const text = hslToRgb({
    h: hsl.h,
    s: Math.min(100, hsl.s * 0.8),
    l: Math.min(95, hsl.l + 35),
  });
  const a = 0.08;
  const subtle: Rgb = {
    r: rgb.r * a + BG_BASE.r * (1 - a),
    g: rgb.g * a + BG_BASE.g * (1 - a),
    b: rgb.b * a + BG_BASE.b * (1 - a),
  };
  return {
    base: toHex(rgb),
    hover: toHex(hover),
    subtle: toHex(subtle),
    text: toHex(text),
  };
}

/** Map a `body_font` setting value to a concrete CSS font-family stack. */
export function bodyFontStack(value: string): string {
  const v = value.trim().toLowerCase();
  if (v === '' || v === 'serif') return "'Source Serif 4', Georgia, serif";
  if (v === 'sans' || v === 'sans-serif') return "'Plus Jakarta Sans', system-ui, sans-serif";
  if (v === 'mono' || v === 'monospace') return "'Source Code Pro', 'Consolas', monospace";
  // Anything else is treated as an explicit stack the writer supplied.
  return value;
}

/**
 * Build a `ThemeSnapshot` from the resolved settings cascade. Empty feature
 * colours track the accent; empty bubble colours fall back to neutral
 * defaults; feedback defaults to its own stable amber (Doc 20 §Theme System).
 */
export function snapshotFromResolved(r: ResolvedSettings): ThemeSnapshot {
  const accent = r.accent_color || DEFAULT_ACCENT;
  return {
    accent,
    ghostwriter: r.ghostwriter_color || accent,
    accordion: r.accordion_color || accent,
    checkpoint: r.checkpoint_color || accent,
    feedback: r.feedback_color || '#f59e0b',
    bubbleUser: r.bubble_user_color || triad(accent, accent).subtle,
    bubbleAi: r.bubble_ai_color || '#1d1b16',
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

  const accent = triad(snapshot.accent, DEFAULT_ACCENT);
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
