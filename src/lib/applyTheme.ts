/**
 * Runtime theme application — Doc 02 §2.2, §2.4, §2.5, §3.2, §13.
 *
 * All functions manipulate CSS custom properties on document.documentElement
 * so changes take effect immediately without re-renders.
 */

// ─── Color Utilities ──────────────────────────────────────────────────────────

/** Parse hex (#rrggbb) to [r, g, b] */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

/** Convert [r, g, b] to #rrggbb */
function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("")
  );
}

/** Convert RGB to HSL, returns [h (0-360), s (0-1), l (0-1)] */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

/** Convert HSL to RGB */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

/** Darken a hex color by a percentage (0-100) */
function darken(hex: string, percent: number): string {
  const [h, s, l] = rgbToHsl(...hexToRgb(hex));
  const newL = Math.max(0, l - percent / 100);
  const [r, g, b] = hslToRgb(h, s, newL);
  return rgbToHex(r, g, b);
}

/** Lighten a hex color by a percentage (0-100) */
function lighten(hex: string, percent: number): string {
  const [h, s, l] = rgbToHsl(...hexToRgb(hex));
  const newL = Math.min(1, l + percent / 100);
  const [r, g, b] = hslToRgb(h, s, newL);
  return rgbToHex(r, g, b);
}

/** Create an alpha overlay of a color on dark background (#0d0d0d) */
function subtleOverlay(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  const bg = 13; // #0d0d0d
  return rgbToHex(
    Math.round(bg + (r - bg) * alpha),
    Math.round(bg + (g - bg) * alpha),
    Math.round(bg + (b - bg) * alpha),
  );
}

// ─── Theme Application Functions ──────────────────────────────────────────────

const root = () => document.documentElement.style;

/**
 * Apply accent color and compute derived variants — Doc 02 §2.2.
 * Sets: --color-accent, --color-accent-hover, --color-accent-subtle, --color-accent-text
 * Also updates shadcn/ui --primary and --ring.
 */
export function applyAccentColor(hex: string): void {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;

  const s = root();
  s.setProperty("--color-accent", hex);
  s.setProperty("--color-accent-hover", darken(hex, 10));
  s.setProperty("--color-accent-subtle", subtleOverlay(hex, 0.08));
  s.setProperty("--color-accent-text", lighten(hex, 35));

  // Update shadcn/ui CSS variables (space-separated RGB)
  const [r, g, b] = hexToRgb(hex);
  s.setProperty("--primary", `${r} ${g} ${b}`);
  s.setProperty("--ring", `${r} ${g} ${b}`);
}

/**
 * Apply body font for Theater prose — Doc 02 §3.2.
 * Sets: --font-theater-body
 */
export function applyBodyFont(font: "serif" | "sans" | "mono"): void {
  const s = root();
  switch (font) {
    case "serif":
      s.setProperty("--font-theater-body", "var(--font-serif)");
      break;
    case "sans":
      s.setProperty("--font-theater-body", "var(--font-sans)");
      break;
    case "mono":
      s.setProperty("--font-theater-body", "var(--font-mono)");
      break;
  }
}

/**
 * Apply message bubble colors — Doc 02 §2.5.
 * null/empty userColor = track accent (use --color-accent-subtle).
 */
export function applyBubbleColors(
  userColor: string | null,
  aiColor: string,
): void {
  const s = root();
  if (userColor && /^#[0-9a-fA-F]{6}$/.test(userColor)) {
    s.setProperty("--bubble-user-bg", userColor);
  } else {
    s.setProperty("--bubble-user-bg", "var(--color-accent-subtle)");
  }
  if (/^#[0-9a-fA-F]{6}$/.test(aiColor)) {
    s.setProperty("--bubble-ai-bg", aiColor);
  }
}

/**
 * Apply feature colors — Doc 02 §2.4.
 * null/empty = track current accent color.
 */
export function applyFeatureColors(colors: {
  ghostwriterFrame: string | null;
  ghostwriterDiff: string | null;
  checkpoint: string | null;
  accordion: string | null;
}): void {
  const s = root();
  const setOrTrack = (prop: string, val: string | null) => {
    if (val && /^#[0-9a-fA-F]{6}$/.test(val)) {
      s.setProperty(prop, val);
    } else {
      s.setProperty(prop, "var(--color-accent)");
    }
  };
  setOrTrack("--color-ghostwriter-frame", colors.ghostwriterFrame);
  setOrTrack("--color-ghostwriter-diff", colors.ghostwriterDiff);
  setOrTrack("--color-checkpoint", colors.checkpoint);
  setOrTrack("--color-accordion", colors.accordion);
}

/**
 * Apply all theme settings from a settings map — Doc 02 §13.
 * Called on workspace mount and on world switch.
 */
export function applyAllTheme(settings: Record<string, string>): void {
  applyAccentColor(settings.accent_color ?? "#7c3aed");
  applyBodyFont((settings.body_font ?? "serif") as "serif" | "sans" | "mono");
  applyBubbleColors(
    settings.bubble_user_color || null,
    settings.bubble_ai_color ?? "#1a1a1a",
  );
  applyFeatureColors({
    ghostwriterFrame: settings.ghostwriter_frame_color || null,
    ghostwriterDiff: settings.ghostwriter_diff_color || null,
    checkpoint: settings.checkpoint_color || null,
    accordion: settings.accordion_color || null,
  });
}
