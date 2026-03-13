# 02 — Design System

## Purpose

This document defines the visual language for LOOM. It covers the color palette,
typography, spacing, component conventions, and theming architecture. All UI
decisions made here supersede shadcn/ui defaults.

> **Coding-agent note:** All CSS variables live in `src/styles/globals.css`.
> The accent color is configurable per-world via `settings` table key `accent_color`.
> It is also cached in `world_meta.json` for use in the World Picker (see
> `08-Vault-and-World-Management.md §7`). All theme values are applied at runtime
> by writing CSS custom properties on `document.documentElement`.

---

## 1. Overall Aesthetic

LOOM's visual language is **dark editorial** — expressive but disciplined. It feels
like a creative tool built for serious writers: confident use of dark backgrounds,
generous typographic hierarchy, and restrained accent color. UI chrome is minimal;
the writing and conversation content are always the visual focus.

Reference points: Craft dark mode, Bear dark mode, early Linear.

---

## 2. Color Palette

### 2.1 Base Neutrals (Fixed)

```css
:root {
  --color-bg-base:        #0d0d0d;
  --color-bg-pane:        #111111;
  --color-bg-theater:     #0a0a0a;
  --color-bg-elevated:    #1a1a1a;
  --color-bg-hover:       #222222;
  --color-bg-active:      #2a2a2a;

  --color-border:         #2a2a2a;
  --color-border-subtle:  #1f1f1f;

  --color-text-primary:   #e8e8e8;
  --color-text-secondary: #888888;
  --color-text-muted:     #555555;
  --color-text-inverse:   #0d0d0d;
}
```

### 2.2 Accent Color (User-Configurable, Per-World)

Default accent is **violet**. Configured in Settings → Appearance per world.
Applied at runtime via `applyAccentColor()`. Also cached in `world_meta.json`
for use in the World Picker without opening each world's DB.

```css
:root {
  --color-accent:         #7c3aed;
  --color-accent-hover:   #6d28d9;
  --color-accent-subtle:  #1e1033;
  --color-accent-text:    #c4b5fd;
}
```

The accent color is a **free hex input** — any valid `#RRGGBB` is accepted.
LOOM computes `--color-accent-hover` (darken 10%), `--color-accent-subtle`
(very dark tint at 8% opacity over `--color-bg-base`), and `--color-accent-text`
(lightened for readability on dark backgrounds) from the chosen hex at runtime.

#### 2.2.1 Runtime Computation (`src/lib/applyTheme.ts`)

```ts
export function applyAccentColor(hex: string) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
  const r = document.documentElement;
  r.style.setProperty("--color-accent",        hex);
  r.style.setProperty("--color-accent-hover",  darkenHex(hex, 0.10));
  r.style.setProperty("--color-accent-subtle", hexWithAlpha(hex, 0.08));
  r.style.setProperty("--color-accent-text",   lightenHex(hex, 0.35));
  // Also recompute all accent-derived feature colors that track accent
  applyFeatureColors();
}
```

Helper functions `darkenHex`, `lightenHex`, `hexWithAlpha` are utilities in
`src/lib/colorUtils.ts`.

### 2.3 Semantic Colors (Fixed)

```css
:root {
  --color-success:    #10b981;
  --color-warning:    #f59e0b;
  --color-error:      #f43f5e;
  --color-feedback:   #f59e0b;
}
```

### 2.4 Feature Colors (User-Configurable, Default = Accent)

These colors default to the current accent color but can be individually
overridden in Settings → Appearance. All stored as settings keys (see
`05-Settings-Modal.md §3`).

```css
:root {
  /* Default values — all track accent unless overridden */
  --color-ghostwriter-frame:  var(--color-accent);
  --color-ghostwriter-diff:   var(--color-accent);
  --color-checkpoint:         var(--color-accent);
  --color-accordion:          var(--color-accent);
}
```

Runtime application (`src/lib/applyTheme.ts`):

```ts
export function applyFeatureColors(settings: FeatureColorSettings) {
  const r = document.documentElement;
  const set = (varName: string, value: string | null) => {
    r.style.setProperty(varName, value ?? "var(--color-accent)");
  };
  set("--color-ghostwriter-frame", settings.ghostwriterFrameColor);
  set("--color-ghostwriter-diff",  settings.ghostwriterDiffColor);
  set("--color-checkpoint",        settings.checkpointColor);
  set("--color-accordion",         settings.accordionColor);
}
```

Called after `applyAccentColor()` so that `null` values correctly inherit
the newly applied accent.

### 2.5 Message Bubble Colors (User-Configurable)

```css
:root {
  --bubble-user-bg: var(--color-accent-subtle);  /* tracks accent by default */
  --bubble-ai-bg:   #1a1a1a;
}
```

Setting keys: `bubble_user_color` (`string | null`), `bubble_ai_color` (`string`).
When `bubble_user_color` is `null`, tracks accent-subtle automatically.

### 2.6 shadcn/ui CSS Variable Overrides

```css
@layer base {
  :root {
    --background:          10 10 10;
    --foreground:          232 232 232;
    --card:                26 26 26;
    --card-foreground:     232 232 232;
    --popover:             26 26 26;
    --popover-foreground:  232 232 232;
    --primary:             124 58 237;
    --primary-foreground:  13 13 13;
    --secondary:           34 34 34;
    --secondary-foreground:232 232 232;
    --muted:               34 34 34;
    --muted-foreground:    136 136 136;
    --accent:              42 42 42;
    --accent-foreground:   232 232 232;
    --destructive:         244 63 94;
    --destructive-foreground: 13 13 13;
    --border:              42 42 42;
    --input:               34 34 34;
    --ring:                124 58 237;
    --radius:              0.375rem;
  }
}
```

`--primary` and `--ring` are overridden at runtime by `applyAccentColor()`.

---

## 3. Typography

### 3.1 Font Stack

```css
:root {
  --font-sans:  "Inter", system-ui, -apple-system, sans-serif;
  --font-serif: "Lora", "Georgia", serif;
  --font-mono:  "JetBrains Mono", "Fira Code", "Consolas", monospace;
}
```

**Font loading (bundled locally — no CDN dependency):**

All fonts are bundled as woff2 files in the Tauri asset bundle for
offline-first operation and privacy. No external network requests are made
for fonts.

```
src/assets/fonts/
  Inter-Regular.woff2
  Inter-Medium.woff2
  Inter-SemiBold.woff2
  Lora-Regular.woff2
  Lora-Medium.woff2
  Lora-Italic.woff2
  JetBrainsMono-Regular.woff2
  JetBrainsMono-Medium.woff2
```

```css
/* src/styles/fonts.css */
@font-face {
  font-family: "Inter";
  src: url("../assets/fonts/Inter-Regular.woff2") format("woff2");
  font-weight: 400; font-style: normal; font-display: swap;
}
@font-face {
  font-family: "Inter";
  src: url("../assets/fonts/Inter-Medium.woff2") format("woff2");
  font-weight: 500; font-style: normal; font-display: swap;
}
@font-face {
  font-family: "Inter";
  src: url("../assets/fonts/Inter-SemiBold.woff2") format("woff2");
  font-weight: 600; font-style: normal; font-display: swap;
}
@font-face {
  font-family: "Lora";
  src: url("../assets/fonts/Lora-Regular.woff2") format("woff2");
  font-weight: 400; font-style: normal; font-display: swap;
}
@font-face {
  font-family: "Lora";
  src: url("../assets/fonts/Lora-Medium.woff2") format("woff2");
  font-weight: 500; font-style: normal; font-display: swap;
}
@font-face {
  font-family: "Lora";
  src: url("../assets/fonts/Lora-Italic.woff2") format("woff2");
  font-weight: 400; font-style: italic; font-display: swap;
}
@font-face {
  font-family: "JetBrains Mono";
  src: url("../assets/fonts/JetBrainsMono-Regular.woff2") format("woff2");
  font-weight: 400; font-style: normal; font-display: swap;
}
@font-face {
  font-family: "JetBrains Mono";
  src: url("../assets/fonts/JetBrainsMono-Medium.woff2") format("woff2");
  font-weight: 500; font-style: normal; font-display: swap;
}
```

Import in `src/styles/globals.css`:
```css
@import "./fonts.css";
```

### 3.2 Theater Body Font (User-Configurable)

Default: **Lora** (serif). Setting key: `body_font`.

| Name | Value | Feel |
|---|---|---|
| Lora *(default)* | `"serif"` | Literary, manuscript |
| Inter | `"sans"` | Clean, modern |
| JetBrains Mono | `"mono"` | Raw, focused |

```ts
export function applyBodyFont(font: "serif" | "sans" | "mono") {
  const map = { serif: "var(--font-serif)", sans: "var(--font-sans)", mono: "var(--font-mono)" };
  document.documentElement.style.setProperty("--font-theater-body", map[font]);
}
```

### 3.3 Type Scale

| Role | Size | Weight | Font | Color |
|---|---|---|---|---|
| Pane section headers | `11px` | 500 | Inter, uppercase | `--color-text-muted` |
| Theater prose (bubbles) | `15px` | 400 | `--font-theater-body` | `--color-text-primary` |
| UI body text | `13px` | 400 | Inter | `--color-text-secondary` |
| Input fields | `14px` | 400 | Inter | `--color-text-primary` |
| Bubble role label | `11px` | 500 | Inter, uppercase | `--color-text-muted` |
| Token / timestamp badge | `11px` | 400 | Inter | `--color-text-muted` |
| Modal heading | `16px` | 600 | Inter | `--color-text-primary` |
| Toast message | `13px` | 400 | Inter | `--color-text-primary` |
| Code blocks (in bubbles) | `13px` | 400 | `--font-mono` | `--color-text-primary` |

---

## 4. Spacing and Layout

### 4.1 Pane Widths (Resizable)

| Pane | Default | Min | Max | Persisted |
|---|---|---|---|---|
| Navigator (LeftPane) | `260px` | `200px` | `360px` | `localStorage` key `left_pane_width` |
| Theater (CenterPane) | `flex-1` | — | — | — |
| Control Pane (RightPane) | `280px` | `240px` | `400px` | `localStorage` key `right_pane_width` |
| Branch Map Drawer | `400px` | `300px` | `70vw` | `localStorage` key `branch_map_width` |

Pane separators are `1px` hairline flex dividers (`--color-border`) that act as
drag handles. Cursor changes to `col-resize` on hover.

```tsx
// Workspace.tsx
<div className="flex h-screen w-screen overflow-hidden">
  <LeftPane style={{ width: leftPaneWidth }} />
  <PaneDivider onDrag={setLeftPaneWidth} min={200} max={360} />
  <CenterPane className="flex-1" />
  <PaneDivider onDrag={setRightPaneWidth} min={240} max={400} />
  <RightPane style={{ width: rightPaneCollapsed ? 0 : rightPaneWidth }} />
</div>
```

### 4.2 Internal Spacing

| Zone | Value |
|---|---|
| Pane horizontal padding | `12px` |
| Pane vertical padding | `8px` |
| Section header margin-top | `8px` |
| Vault tree item padding | `6px` vertical, `8px` horizontal |
| Message bubble padding | `12px` |
| Message bubble gap | `8px` |
| Input area padding | `12px` |
| Input area field gap | `6px` |
| Modal content padding | `20px` |
| Tag chip padding | `3px` vertical, `8px` horizontal |

---

## 5. Message Bubbles (Theater)

### 5.1 Layout

- **User messages:** right-aligned, `--bubble-user-bg` background
- **AI messages:** left-aligned, `--bubble-ai-bg` background
- Both: `max-width: 80%`, `border-radius: 8px`

### 5.2 Action Row

- Visible on hover: `opacity-0 group-hover:opacity-100 transition-opacity duration-120`
- Rendered **below** the bubble
- Icons: lucide-react, `16px`, `--color-text-muted` → `--color-text-primary` on hover
- Order (user bubble): Edit · Delete
- Order (AI bubble): Ghostwriter · Feedback · Delete · Revert (if `ghostwriter_history` non-empty)

### 5.3 User Message Pills

**Background Information Pill** (shown if `background_information` non-empty):
- Background: `rgba(245,158,11,0.12)`, Border: `1px solid rgba(245,158,11,0.25)`
- Border-radius: `12px`, Padding: `3px 8px`
- Icon: `lucide-react Brain`, `12px`, `--color-warning`
- Text: `11px`, Inter 500, `--color-warning`, label: `"Background"`
- Click to expand: shows full text with left border in `--color-warning`

**Modificators Pill** (shown if `modificators` non-empty):
- Background: `rgba(<accent-rgb>, 0.12)`, Border: `1px solid rgba(<accent-rgb>, 0.25)`
- Border-radius: `12px`, Padding: `3px 8px`
- Icon: `lucide-react Palette`, `12px`, `--color-accent-text`
- Text: `11px`, Inter 500, `--color-accent-text`
- Tags joined with `·`, truncated at 32 chars + ellipsis
- Click to expand: individual tag chips

Pill row layout:
```css
.message-pill-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
```

### 5.4 Ghostwriter Active State

When a message has an active Ghostwriter session:
```css
.bubble-ghostwriter-active {
  outline: 2px solid var(--color-ghostwriter-frame);
  outline-offset: 2px;
  border-radius: 8px;
}
```

Diff highlights (accepted changes shown temporarily):
```css
.ghostwriter-diff-highlight {
  background: rgba(var(--color-ghostwriter-diff-rgb), 0.25);
  border-radius: 2px;
  transition: background 500ms ease;
}
```

### 5.5 Checkpoint Divider (Theater)

Checkpoints appear as elegant horizontal dividers between messages:

```
┄┄┄┄┄┄┄┄┄┄┄┄ ⌗  Kapitel 2  ┄┄┄┄┄┄┄┄┄┄┄┄
```

```css
.checkpoint-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 16px 0;
  color: var(--color-checkpoint);
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  cursor: pointer;
}
.checkpoint-divider::before,
.checkpoint-divider::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--color-checkpoint);
  opacity: 0.4;
}
```

Clicking the divider opens a context menu: Rename · Summarize previous segment · Delete.

---

## 6. Input Area (Theater Bottom)

### 6.1 Layout

```
┌────────────────────────────────────────────────────────┐
│  Plot Direction                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │ She opens the letter...                          │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  [▼ Background]  [▼ Modificators]                      │
│                                                        │
│  Saved presets: [dark horror ×] [slow burn ×] [+]      │
│                                              [Send ▶]  │
└────────────────────────────────────────────────────────┘
```

- **Plot Direction:** Always visible, primary textarea, `min-height: 80px`, auto-grow
- **Background / Modificators:** Collapsed by default, expand via toggle buttons
- **Modificator Presets:** Quick-select chips above Modificators field (when presets exist)
- **Send button:** Accent background, `lucide-react Send`, `14px`
- **Stop button:** Shown instead of Send during generation — `lucide-react Square`, amber

### 6.2 Token Counter (Theater Toolbar)

Displayed in the Theater toolbar (above message list):

```
~18,400 / 128,000 tokens
```

- Updated after each response
- Color: `--color-text-muted` at normal usage; `--color-warning` at > 80%; `--color-error` at > 95%
- With collapsed Accordion segments: `~6,400 tokens sent  (3 segments collapsed, ~12,000 saved)`
- Token limit configurable in Settings → Dev (`context_token_limit`, default `128000`)

---

## 7. Feedback Box (AI Bubble)

When an AI message has `user_feedback` set:

```css
.feedback-box {
  margin-top: 8px;
  padding: 8px 10px;
  border-left: 2px solid var(--color-feedback);
  background: rgba(245, 158, 11, 0.06);
  border-radius: 0 4px 4px 0;
  font-size: 12px;
  color: var(--color-text-secondary);
}
```

Expand/collapse animation: `max-height 200ms ease, opacity 150ms ease`.

---

## 8. Accordion Summary Card (Theater)

When an Accordion segment is collapsed:

```
┌─────────────────────────────────────────────────────────┐
│  ⌗  Kapitel 1  ·  14 messages  ·  [▼ expand]            │
│  ─────────────────────────────────────────────────────  │
│  Summary text...                                        │
└─────────────────────────────────────────────────────────┘
```

```css
.accordion-summary-card {
  border-left: 3px solid var(--color-accordion);
  background: rgba(var(--color-accordion-rgb), 0.06);
  border-radius: 0 8px 8px 0;
  padding: 12px 16px;
  margin: 8px 0;
}
.accordion-summary-header {
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-accordion);
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
.accordion-summary-text {
  font-size: 14px;
  font-family: var(--font-theater-body);
  color: var(--color-text-secondary);
  font-style: italic;
  line-height: 1.6;
}
```

---

## 9. World Card (`<WorldCard />`)

Card dimensions: `~270px × 140px`, `border-radius: 8px`, `overflow: hidden`.

**With background image:**
```css
.world-card-overlay {
  background: linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.65) 100%);
}
```

**Without background image:**
```css
.world-card-no-image {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
}
```

**Active world card:** `outline: 2px solid <world-accent-color>; outline-offset: -2px`
(uses the world's own accent color, read from `world_meta.json`).

**Hover:** `filter: brightness(1.1); transition: filter 150ms ease`

**Text (bottom-left, 12px padding):**
- World name: `15px`, Inter 600, `#ffffff`, text-shadow
- Tags + story count: `11px`, `rgba(255,255,255,0.70)`

---

## 10. Telemetry Bar

```css
.telemetry-bar { height: 4px; border-radius: 2px; background: var(--color-bg-active); }
.telemetry-fill { height: 100%; border-radius: 2px; transition: width 300ms ease; }
.telemetry-fill[data-usage="low"]    { background: #10b981; }
.telemetry-fill[data-usage="medium"] { background: #f59e0b; }
.telemetry-fill[data-usage="high"]   { background: #f43f5e; }
```

---

## 11. Rate Limit Indicator (Collapsed Control Pane)

When Control Pane is collapsed (`rightPaneCollapsed === true`), a small
status dot appears on the collapse toggle button:

```css
.rate-limit-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  position: absolute;
  top: 4px;
  right: 4px;
}
.rate-limit-dot[data-status="ok"]     { background: #10b981; }
.rate-limit-dot[data-status="warn"]   { background: #f59e0b; }
.rate-limit-dot[data-status="danger"] { background: #f43f5e; }
```

`data-status` is set based on the highest usage level across RPM/TPM/RPD.
Hidden when all usage is below 60%.

---

## 12. Toast / Notification System

Use shadcn/ui **Sonner**:
```tsx
<Toaster position="bottom-right" theme="dark" richColors />
```

| Trigger | Type | Copy |
|---|---|---|
| Item soft-deleted | default + Undo | *"Moved to Trash."* |
| Branch deleted | default + Undo | *"Branch deleted."* |
| World exported | success | *"World exported successfully."* |
| World imported | success | *"World imported."* |
| Vault locked | default | *"LOOM locked."* |
| API error | error | Error string from backend |
| Rate limited | warning | *"Rate limit reached. Try again in Xs."* |
| Checkpoint orphaned + removed | warning | *"A checkpoint lost its anchor and was removed."* |
| Summary regeneration suggested | default + action | *"Regenerated content is inside a summarised segment. Regenerate summary?"* |
| Auto-lock warning (60s) | warning | *"LOOM will lock in 60 seconds."* |

---

## 13. Theme Application on Workspace Mount

```ts
// src/components/layout/Workspace.tsx
useEffect(() => {
  async function applyTheme() {
    const settings = await invoke<Record<string,string>>("get_settings_all");
    applyAccentColor(settings.accent_color ?? "#7c3aed");
    applyBodyFont((settings.body_font ?? "serif") as "serif" | "sans" | "mono");
    applyBubbleColors(settings.bubble_user_color || null, settings.bubble_ai_color ?? "#1a1a1a");
    applyFeatureColors({
      ghostwriterFrameColor: settings.ghostwriter_frame_color || null,
      ghostwriterDiffColor:  settings.ghostwriter_diff_color  || null,
      checkpointColor:       settings.checkpoint_color        || null,
      accordionColor:        settings.accordion_color         || null,
    });
  }
  applyTheme();
}, [activeWorldId]);
```

Re-runs on `activeWorldId` change so each world has independent theme settings.
