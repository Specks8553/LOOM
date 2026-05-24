# 09 — Component Library

> **Status:** Complete — visual values finalized per the Designfiles visual design pass
> **Last updated:** 2026-05-19 — Context-menu contents pass (D-22): §ContextMenu API updated — `MenuItem` gains a `destructive?` flag (`--color-error` label); `useContextMenu` documented as a consumer hook of the workspace-root `ContextMenuProvider` (which owns the single menu instance) rather than a local-state hook.
> **Earlier:** 2026-05-17 — Designfiles reconciliation (Phase 12 prep): visual values verified against `docs-v2/design/Designfiles/Phase 0D - Components.html`. ⚠️ markers cleared (popover shadow confirmed); `LoadingDots` animation timing corrected to the Phase 0D spec (1.2s pulse cycle, 0.2s stagger). Token references inherit Doc 08's warm palette automatically — no per-component value changes needed. Stale `applyAccentColor()` → `applyTheme()`.
> **Earlier:** 2026-05-03 — pre-implementation audit resolution: Slider use case updated (`gen_*` parameter sliders in Settings → Gemini); stale "output length" reference removed from Select use case (CD-4).
> **Earlier:** 2026-04-26

Documents two things: the shadcn/ui components used in v2.0 (their behavioral role and LOOM visual override contract), and the custom shared components in `src/components/shared/`. Feature-specific components are documented in their feature docs. Layout components are in Doc 10.

**Note:** v1.0 had no shadcn/ui installed — all components were custom. v2.0 introduces shadcn/ui as the behavioral layer for primitives that require ARIA compliance and keyboard navigation. Visual treatment remains fully LOOM-controlled via the token system.

---

## shadcn/ui — Role and Override Contract

shadcn/ui is used **for behavior only**: focus management, ARIA roles, keyboard navigation, portal rendering. Every visual default from shadcn is overridden via CSS variables from Doc 08. No shadcn color, radius, or spacing value reaches the user without passing through the token system.

### Override pattern

shadcn components read from their own CSS variable set (`--background`, `--foreground`, `--primary`, etc.). These are kept in sync with LOOM's tokens in `globals.css` and updated at runtime by `applyTheme()`. The shadcn visual layer is effectively invisible — it emits markup, LOOM styles it.

```tsx
// ✅ correct — token-driven, no visual defaults from shadcn slip through
<Dialog>
  <DialogContent className="bg-[--color-bg-elevated] border-[--color-border]">
    ...
  </DialogContent>
</Dialog>

// ❌ wrong — shadcn default classes reach the user
<DialogContent>
  ...
</DialogContent>
```

---

## shadcn/ui Components in Use

### Dialog

**Behavioral role:** Modal overlay with focus trap, Escape to close, portal rendering.
**Used for:** SettingsModal, WorldPickerModal, confirmation dialogs.

| Element | Tokens |
|---|---|
| Overlay | `bg-black/60` (fixed — no token needed) |
| Content panel | `--color-bg-elevated`, `--color-border`, `--radius-card` |
| Title | `--color-text-primary`, 15px / 500 |
| Description | `--color-text-secondary`, 13px |

**States:** open, closed (animated 150ms).
**Notes:** Content does not unmount on close by default. If a dialog contains state that should reset, use a `key` prop or reset in `onOpenChange`.

---

### Tooltip

**Behavioral role:** Accessible hover label with delay and portal rendering.
**Used for:** Icon button labels throughout the app.

| Element | Tokens |
|---|---|
| Content | `--color-bg-elevated`, `--color-border`, `--color-text-primary` |
| Font | 12px / 400, `--font-sans` |

**States:** hidden, visible (150ms fade).
**Notes:** Delay before show: 500ms. No delay on close.

---

### Select

**Behavioral role:** Accessible dropdown with keyboard navigation and search.
**Used for:** AI model selection, body font selection, mode SI slot picker.

| Element | Tokens |
|---|---|
| Trigger | `--color-bg-elevated`, `--color-border`, `--color-text-primary`, `--radius-input` |
| Trigger hover | `--color-bg-hover` |
| Content panel | `--color-bg-elevated`, `--color-border` |
| Item | `--color-text-primary`, 13px |
| Item hover | `--color-bg-hover` |
| Item selected | `--color-accent-subtle`, `--color-accent-text` |

**States:** closed, open, item-hover, item-selected, disabled.

---

### Slider

**Behavioral role:** Accessible range input with keyboard control (arrow keys, Home, End).
**Used for:** Generation parameter sliders in Settings → Gemini (`gen_temperature`, `gen_top_p`, `gen_top_k`, `gen_max_output_tokens`); auto-lock timer in Settings → General; cache TTL slider; rate-limit ceilings.

| Element | Tokens |
|---|---|
| Track | `--color-bg-active` |
| Range (filled) | `--color-accent` |
| Thumb | `--color-accent`, `--color-bg-base` (border) |
| Thumb focus ring | `--color-accent` at 40% |

**States:** default, hover (thumb scale 1.1), focus, dragging, disabled.

---

### Switch

**Behavioral role:** Accessible boolean toggle with keyboard activation.
**Used for:** System instruction slot toggles, settings on/off states.

| Element | Tokens |
|---|---|
| Track (off) | `--color-bg-active` |
| Track (on) | `--color-accent` |
| Thumb | `--color-text-on-accent` (white) |

**States:** off, on, disabled. Transition: 150ms.

---

### Checkbox

**Behavioral role:** Accessible checkbox with keyboard activation.
**Used for:** Multi-select in vault (if applicable), settings checkboxes.

| Element | Tokens |
|---|---|
| Box (unchecked) | `--color-border`, `--color-bg-elevated` |
| Box (checked) | `--color-accent` fill, white checkmark |
| Focus ring | `--color-accent` at 40% |

**States:** unchecked, checked, indeterminate, disabled.

---

### Popover

**Behavioral role:** Accessible floating panel anchored to a trigger, with focus management and click-outside close.
**Used for:** Color picker in settings, any anchored overlay not suitable for a tooltip.

| Element | Tokens |
|---|---|
| Content | `--color-bg-elevated`, `--color-border`, `--radius-card` |
| Shadow | `0 8px 24px rgba(0,0,0,0.5)` |

**States:** closed, open (150ms fade + slight translate).

---

## Custom Shared Components

Defined in `src/components/shared/`. Fully props-driven — no store reads. If a shared component needs store data, the caller passes it as a prop.

---

### ContextMenu

**Source:** `src/components/shared/ContextMenu.tsx` (custom — stays custom in v2.0)
**Reason custom:** Requires viewport edge detection, flip behavior, and Escape chain integration not provided by shadcn DropdownMenu.

**Anatomy:**
```
ContextMenu (fixed, portal)
  └── MenuItem[] (button)
        ├── Icon? (lucide, 14px)
        └── Label (string)
      Separator (hr) between groups
```

**Variants:** Standard item, disabled item, destructive item, separator.

**States:**
| State | Visual |
|---|---|
| Default | `--color-bg-elevated` background, `--color-border` border |
| Item hover | `--color-bg-hover` background |
| Item disabled | 40% opacity, `cursor: default` |
| Item destructive | `--color-error` label text (Doc 11 §Destructive items) |

**Token references:** `--color-bg-elevated`, `--color-border`, `--color-text-primary`, `--color-bg-hover`, `--color-border-subtle`, `--font-sans`.

**Behavior:**
- Opens at cursor position, flips if near viewport edge
- Closes on click outside, Escape key, or item selection
- Escape is captured at capture phase (priority in Escape chain — see Doc 11)
- Animation: fade + scale from 0.96 → 1.0, 150ms

**API:**
```typescript
interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean; // label renders in --color-error (Doc 11 §Destructive items)
  separator?: boolean;   // renders a separator instead of an item
}

// ContextMenuProvider — mounted once at the workspace root. It owns the single
// menu instance and its open/close state, so only one menu is ever open at a
// time (Doc 11 §Context Menus).
// useContextMenu() — consumer hook; returns the trigger API:
const { showContextMenu, hideContextMenu } = useContextMenu();
// showContextMenu(e: React.MouseEvent, items: MenuItem[]) — call on onContextMenu.
//   A no-op when items is empty (suppresses the menu entirely).
```

**v2.0 fix:** Replace inline `React.CSSProperties` objects with Tailwind classes referencing tokens.

---

### TagInput

**Source:** `src/components/shared/TagInput.tsx` (custom)
**Used for:** Style modificator tags in InputArea, world tags in WorldPicker.

**Anatomy:**
```
TagInput (container div)
  ├── Tag[] (span)
  │     ├── Label (text)
  │     └── RemoveButton (X icon, 10px)
  └── Input (text input, flex-grow)
```

**States:**
| State | Visual |
|---|---|
| Container default | `--color-bg-pane` background, accent-tinted border |
| Container focus-within | accent border at full opacity |
| Tag | `--color-accent-subtle` background, `--color-accent-text` text |
| Tag remove hover | remove icon opacity 1.0 (from 0.6) |
| Input | transparent background, `--color-text-primary` |

**Token references:** `--color-bg-pane`, `--color-accent-subtle`, `--color-accent-text`, `--color-text-primary`, `--font-sans`.

**Behavior:**
- Type comma → commits tag from current input
- Enter → commits tag
- Backspace on empty input → removes last tag
- Click container → focuses input
- Duplicate tags silently ignored

**v2.0 fix:** Remove hardcoded `rgba(124,58,237,...)` values — replace with `--color-accent-subtle` and `--color-accent-text` token references.

**API:**
```typescript
interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  fontSize?: number;   // defaults to 13
}
```

---

### LoadingDots

**Source:** `src/components/theater/LoadingDots.tsx` → move to `src/components/shared/` in v2.0
**Used for:** AI generation in-progress indicator inside AiBubble.

**Anatomy:**
```
LoadingDots (span)
  └── 3 × Dot (span, animated)
```

**States:** single animated state — three dots pulsing in sequence.
**Token references:** `--color-text-muted`.
**Animation:** `dot-pulse` — opacity pulse, 1.2s ease-in-out cycle, 0.2s stagger between dots (per `Designfiles/Phase 0D`). Dot size 5–6px, `--radius-sm` (3px).

---

### InlineImage

**Source:** `src/components/shared/InlineImage.tsx` (custom)
**Used for:** Rendering images within message blocks (inside AiBubble and UserBubble).

**Anatomy:**
```
InlineImage (figure)
  ├── img (the image)
  └── figcaption? (optional caption)
```

**States:** loading (skeleton), loaded, error (broken image placeholder).
**Token references:** `--color-bg-elevated`, `--color-border`, `--color-text-muted`.
**Behavior:** Click opens Lightbox. Max width 100% of bubble. Maintains aspect ratio.

---

### Lightbox

**Source:** `src/components/shared/Lightbox.tsx` (custom)
**Used for:** Full-screen image viewing triggered by clicking an InlineImage.

**Anatomy:**
```
Lightbox (fixed overlay)
  ├── Backdrop (click to close)
  ├── Image (centered, max 90vw × 90vh)
  └── CloseButton (X, top-right)
```

**States:** closed, open (150ms fade).
**Token references:** `--color-text-on-accent` (close button).
**Behavior:**
- Opens on InlineImage click
- Closes on backdrop click, CloseButton click, or Escape key
- Focus trapped while open
- Escape follows the chain defined in Doc 11

---

### ErrorBoundary

**Source:** `src/components/ErrorBoundary.tsx` → move to `src/components/shared/` in v2.0
**Used for:** Wraps the root app to catch unexpected React render errors.

**Anatomy:**
```
ErrorBoundary (class component — required by React)
  └── fallback UI on error:
        ├── Error message (--color-error)
        └── Reload button
```

**Notes:** Does not handle Tauri command errors — those are handled per-call in `tauriApi/`. Catches only synchronous render errors. Display rules per Doc 12.

---

## cn() Utility

All conditional class merging uses `cn()` — a thin wrapper around `clsx` + `tailwind-merge`. Available from `src/lib/utils.ts`.

```typescript
import { cn } from '@/lib/utils';

// ✅ correct
<div className={cn('base-class', isActive && 'active-class', className)} />

// ❌ wrong — string concatenation causes class conflicts
<div className={`base-class ${isActive ? 'active-class' : ''} ${className}`} />
```

Raw string concatenation for class names is a bug — it causes Tailwind class conflicts that silently break styles.
