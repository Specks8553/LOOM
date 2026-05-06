# 08 — Design Tokens

> **Status:** Complete — values provisional, marked for visual design pass
> **Last updated:** 2026-05-04 — Feedback design pass (D-17): `--color-feedback` promoted from a single Semantic token to a triad (`--color-feedback`, `-hover`, `-subtle`) under Feature Colors. Default hex `#f59e0b` (matches `--color-warning` but independent — see Doc 28 §Visual Tokens); world-overridable via `feedback_color` (Doc 03). `applyTheme(snapshot)` snapshot now carries `feedback`.
> **Earlier:** 2026-05-03 — pre-implementation audit resolution: Ghostwriter token names switched to triad pattern (`--color-ghostwriter`, `-hover`, `-subtle`, `-diff`), mirroring accent (CD-2); five-function Runtime Theme API replaced by single `applyTheme(snapshot)` (CD-1, owned by Doc 20); `--color-checkpoint` retention note removed (CD-3 — Doc 16 banners use it).
> **Earlier:** 2026-04-26

The single source of all design values. Any value not defined here does not exist as a design value. Components reference tokens only — no hex codes, no hardcoded pixel sizes, no raw Tailwind color utilities in component files.

**Provisional values** are carried forward from v1.0 and marked ⚠️. They are correct enough to build with and will be refined in a visual design pass without touching component code.

---

## Enforcement Rule

```css
/* ✅ correct */
color: var(--color-text-primary);
background: var(--color-bg-elevated);

/* ❌ wrong — hardcoded value in component */
color: #e8e8e8;
background: #1a1a1a;

/* ❌ wrong — raw Tailwind color class */
className="text-gray-200 bg-neutral-800"

/* ✅ correct — Tailwind referencing a token */
className="text-[--color-text-primary] bg-[--color-bg-elevated]"
```

---

## Color Tokens

### Background

| Token | Value | Use |
|---|---|---|
| `--color-bg-base` | `#0d0d0d` | App-level background; outermost layer |
| `--color-bg-pane` | `#111111` | Left and right pane backgrounds |
| `--color-bg-theater` | `#0a0a0a` | Theater (center pane) background — slightly darker than base |
| `--color-bg-elevated` | `#1a1a1a` ⚠️ | Cards, dropdowns, AI bubbles — one step above pane |
| `--color-bg-hover` | `#222222` ⚠️ | Hover state background for interactive items |
| `--color-bg-active` | `#2a2a2a` ⚠️ | Active/selected state background |

### Border

| Token | Value | Use |
|---|---|---|
| `--color-border` | `#2a2a2a` ⚠️ | Standard dividers, pane edges, input outlines |
| `--color-border-subtle` | `#1f1f1f` ⚠️ | Low-emphasis dividers, code block borders |

### Text

| Token | Value | Use |
|---|---|---|
| `--color-text-primary` | `#e8e8e8` | Main content text |
| `--color-text-secondary` | `#888888` ⚠️ | Supporting text, metadata, descriptions |
| `--color-text-muted` | `#555555` ⚠️ | Pane section headers (11px uppercase), placeholder text |
| `--color-text-inverse` | `#0d0d0d` | Text on light/accent backgrounds |
| `--color-text-on-accent` | `#ffffff` | Text placed directly on `--color-accent` |

### Accent (User-Configurable — Runtime)

These are set at runtime by `applyAccentColor()`. The CSS file defines defaults; every world overrides them on mount.

| Token | Default | Derived how |
|---|---|---|
| `--color-accent` | `#7c3aed` | Raw value from world settings |
| `--color-accent-hover` | computed | Darkened 10% in HSL lightness |
| `--color-accent-subtle` | computed | 8% alpha overlay on `#0d0d0d` background |
| `--color-accent-text` | computed | Lightened 35% in HSL lightness — for text on dark background |

See **Accent Color System** section below for the derivation algorithm.

### Semantic (Fixed)

| Token | Value | Use |
|---|---|---|
| `--color-success` | `#10b981` | Success states, positive confirmations |
| `--color-warning` | `#f59e0b` | Warnings, rate limit proximity |
| `--color-error` | `#f43f5e` | Error states, destructive actions |

### Feature Colors (Default = Accent — Runtime)

Each feature color defaults to tracking `--color-accent` but can be independently overridden in world settings. Set at runtime by `applyFeatureColors()`.

Each feature colour follows the same triad as accent (`<feature>`, `-hover`, `-subtle`) plus any feature-specific roles. All tokens default to tracking `--color-accent` (and its derived states) and are written by `applyTheme()` (Doc 20).

| Token | Default | Use |
|---|---|---|
| `--color-ghostwriter` | `var(--color-accent)` | Ghostwriter feature colour — bubble pulse outline, button accents |
| `--color-ghostwriter-hover` | derived (darken 10%) | Hover state on Ghostwriter affordances |
| `--color-ghostwriter-subtle` | derived (8% alpha) | Selection highlight inside an active Ghostwriter bubble |
| `--color-ghostwriter-diff` | `var(--color-ghostwriter)` | Diff highlight + underline in Ghostwriter review (semantically distinct role from the feature accent — typically the same hue but with a heavier visual weight via opacity / underline) |
| `--color-accordion` | `var(--color-accent)` | Accordion segment card / banner accent |
| `--color-accordion-hover` | derived (darken 10%) | Accordion banner hover |
| `--color-accordion-subtle` | derived (8% alpha) | Accordion banner background tint |
| `--color-checkpoint` | `var(--color-accent)` | Checkpoint banner accent in Theater (Doc 16 / Doc 27) |
| `--color-feedback` | `#f59e0b` ⚠️ | Feedback annotation strip border + action-row icon when non-empty (Doc 28). Default does **not** track accent — feedback uses a stable amber by default, but the world override is independent and triad-derived like other features. |
| `--color-feedback-hover` | derived (darken 10%) | Hover state on the feedback strip and the action-row entry |
| `--color-feedback-subtle` | derived (~6% alpha) | Feedback strip background fill |

### Message Bubble Colors (Runtime)

| Token | Default | Derived from |
|---|---|---|
| `--bubble-user-bg` | `var(--color-accent-subtle)` | Tracks accent unless overridden in world settings |
| `--bubble-ai-bg` | `#1a1a1a` ⚠️ | Fixed default; overridable in world settings |

---

## Typography Tokens

### Font Families

Three font stacks, all bundled locally as woff2 — no CDN.

| Token | Stack | Use |
|---|---|---|
| `--font-sans` | `"Inter", system-ui, -apple-system, sans-serif` | All UI text |
| `--font-serif` | `"Lora", "Georgia", serif` | Theater prose body ⚠️ |
| `--font-mono` | `"JetBrains Mono", "Fira Code", "Consolas", monospace` | Code blocks, technical content |
| `--font-theater-body` | `var(--font-serif)` | Runtime-switchable; set by `applyBodyFont()` |

**Bundled weights:**
- Inter: 400, 500, 600
- Lora: 400, 400 italic, 500
- JetBrains Mono: 400, 500

### Type Scale

All sizes are fixed — no fluid/responsive scaling. Desktop only.

| Role | Size | Weight | Family | Notes |
|---|---|---|---|---|
| Section header | `11px` | 500 | sans | Uppercase, `letter-spacing: 0.08em`, `--color-text-muted` |
| UI body | `13px` | 400 | sans | Default body; set on `html` element |
| UI label | `13px` | 500 | sans | Form labels, button text |
| UI small | `12px` | 400 | sans | Timestamps, metadata, badges |
| Prose body | `15px` ⚠️ | 400 | serif | Theater AI bubble text |
| Prose heading h1 | `1.3em` | 600 | sans | In AI markdown output |
| Prose heading h2 | `1.15em` | 600 | sans | In AI markdown output |
| Prose heading h3 | `1em` | 600 | sans | In AI markdown output |
| Doc preview h1 | `24px` | 700 | sans | Source document preview |
| Doc preview h2 | `20px` | 600 | sans | Source document preview |
| Doc preview h3 | `16px` | 600 | sans | Source document preview |

### Line Heights

| Context | Value |
|---|---|
| Default UI | `1.5` (set on `html`) |
| Prose content | `1.7` ⚠️ — generous for long-form reading |
| Code blocks | `1.5` |

---

## Spacing

No custom spacing tokens defined — Tailwind's default spacing scale is used (`4px` base unit). Components should use Tailwind spacing utilities (`p-2`, `gap-4`, etc.) which resolve to multiples of 4px.

**Exception:** Where a value is not on the 4px grid, it must be defined here as a token, not hardcoded inline.

---

## Border Radius

| Token | Value | Use |
|---|---|---|
| `--radius` (shadcn) | `0.375rem` (6px) | shadcn/ui base radius |
| `--radius-bubble` | `10px` ⚠️ | Message bubble corners |
| `--radius-card` | `6px` ⚠️ | Cards, elevated surfaces |
| `--radius-input` | `4px` ⚠️ | Input fields |
| `--radius-sm` | `3px` ⚠️ | Badges, code spans |

---

## Scrollbar

Applied globally. Consistent across all scroll containers.

```css
::-webkit-scrollbar        { width: 6px; height: 6px; }
::-webkit-scrollbar-track  { background: transparent; }
::-webkit-scrollbar-thumb  { background: var(--color-border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--color-text-muted); }
```

---

## Selection

Text selection uses the accent color at 40% alpha:

```css
::selection {
  background: color-mix(in srgb, var(--color-accent) 40%, transparent);
  color: var(--color-text-primary);
}
```

---

## shadcn/ui Override Tokens

shadcn/ui components expect CSS variables in space-separated RGB format. These are maintained in parallel with LOOM's hex tokens. `applyAccentColor()` keeps `--primary` and `--ring` in sync with `--color-accent`.

| shadcn token | RGB value | Tracks |
|---|---|---|
| `--background` | `10 10 10` | `--color-bg-base` |
| `--foreground` | `232 232 232` | `--color-text-primary` |
| `--card` | `26 26 26` | `--color-bg-elevated` |
| `--card-foreground` | `232 232 232` | `--color-text-primary` |
| `--popover` | `26 26 26` | `--color-bg-elevated` |
| `--popover-foreground` | `232 232 232` | `--color-text-primary` |
| `--primary` | runtime | `--color-accent` (updated by `applyAccentColor`) |
| `--primary-foreground` | `13 13 13` | `--color-text-inverse` |
| `--secondary` | `34 34 34` | `--color-bg-hover` |
| `--secondary-foreground` | `232 232 232` | `--color-text-primary` |
| `--muted` | `34 34 34` | `--color-bg-hover` |
| `--muted-foreground` | `136 136 136` | `--color-text-secondary` |
| `--destructive` | `244 63 94` | `--color-error` |
| `--border` | `42 42 42` | `--color-border` |
| `--input` | `34 34 34` | `--color-bg-hover` |
| `--ring` | runtime | `--color-accent` (updated by `applyAccentColor`) |
| `--radius` | `0.375rem` | `--radius` |

---

## Accent Color System

The accent color is the only user-configurable color. One hex value per world; all variants are computed at runtime.

### Derivation algorithm (`applyAccentColor`)

```
input hex (#rrggbb)
  ├── --color-accent         = hex (raw)
  ├── --color-accent-hover   = darken(hex, 10%)    — HSL lightness −10
  ├── --color-accent-subtle  = overlay(hex, 8%)    — alpha blend on #0d0d0d at 8%
  └── --color-accent-text    = lighten(hex, 35%)   — HSL lightness +35
```

All four variables are set simultaneously on `document.documentElement.style`. Changes are immediate — no re-render required.

**Future refinement:** Add a minimum contrast ratio check when applying the accent, to warn or auto-correct accent choices that become unreadable against `--color-bg-theater`.

### Feature and bubble color fallback

Feature colors (`--color-ghostwriter-frame`, `--color-accordion`, etc.) default to `var(--color-accent)` and update automatically when the accent changes — unless the user has set an independent value in world settings. The same logic applies to `--bubble-user-bg`.

---

## Runtime Theme API

A single function — `applyTheme(snapshot: ThemeSnapshot)` — writes every theme-related CSS variable to `:root`. Lives in `src/lib/applyTheme.ts`. The snapshot type and trigger rules are owned by Doc 20 §`applyTheme()` Contract — the snapshot covers every world-overridable visual key (accent, body font, bubble colours, feature colours including checkpoint).

```ts
applyTheme(snapshot): void   // see Doc 20 for ThemeSnapshot shape and trigger sites
```

The previous five-function API (`applyAccentColor`, `applyBodyFont`, `applyBubbleColors`, `applyFeatureColors`, `applyAllTheme`) is consolidated. One call site, one subscription at App root, one source of derived-variable writes.

---

## Global CSS Classes

Defined in `globals.css`. These are the only cases where styling is applied via class rather than component-level token references.

### `.ai-message-content`
Markdown prose styles for AI bubble content. Uses `--font-serif` (via `--font-theater-body`), `--color-text-primary`, `--color-bg-hover`, `--color-border`, `--color-text-secondary`, `--color-accent-text`, `--font-mono`.

### `.doc-preview`
Markdown styles for source document preview. Uses `--font-sans`, `--color-text-primary`, `--color-bg-elevated`, `--font-mono`, `--color-text-secondary`, `--color-accent-text`, `--color-border`.

### `.bubble-ghostwriter-active`
Pulsing outline on an AI bubble when Ghostwriter is active. Uses `--color-ghostwriter`. Animation: `ghostwriter-pulse`, 1.5s ease-in-out infinite.

### `.ghostwriter-diff-changed`
Highlighted text in Ghostwriter diff view. Uses `--color-ghostwriter-diff` at 30% alpha background + underline.

### `.ghostwriter-selection`
Text selection highlight during Ghostwriter passage selection. Uses `--color-ghostwriter-subtle` background.
