# 11 — Interaction Patterns

> **Status:** Complete — keyboard shortcuts still deferred (see IMPL-NOTES.md).
> **Last updated:** 2026-05-04 — Feedback design pass (D-17): full Escape Chain rewrite (CD-6 closed); Settings full-surface entry added at priority 2 (Doc 20); Feedback edit state added at priority 5 (Doc 28); Ghostwriter `reviewing`-phase nuance noted; stale "Feedback panel expanded" reference removed.
> **Earlier:** 2026-05-03 — pre-implementation audit resolution: removed the DocEditor "Discard unsaved changes?" entry from the Escape Chain and the corresponding row from the Confirmation Dialogs table — Doc 18 specifies debounced auto-save with `flushDocSave()` on close/lock/world-switch, so there are no unsaved changes to guard (HB-3).
> **Earlier:** 2026-04-29 — Doc 17 design pass: Text-selection-Ghostwriter-trigger section reworded for mode-first activation (Doc 11 previously said selection-first, which conflicted with Doc 17's mode-first model)
> **Earlier:** 2026-04-26

All interaction conventions in one place. When a behavior isn't specified in a feature doc, the answer is here.

---

## Escape Chain

Escape is handled by a single function evaluated in priority order. The first handler that applies consumes the event — lower-priority handlers do not fire.

```
1. Modal open (Dialog)
     → close modal; restore focus to trigger

2. Settings full-surface open (Doc 20)
     → close Settings (← Back-equivalent); restore previous mode

3. Mode session active and end-confirmation pending (Doc 23)
     → resolve confirmation (close it; do not exit the session)

4. Ghostwriter active on a bubble (Doc 17)
     → in `selecting` / `generating` phases: cancel mode immediately
     → in `reviewing` phase: open confirmation modal (Doc 17 §Phase-sensitive Escape) — that modal is then consumed by priority 1 on the next Escape

5. Feedback edit open on a bubble (Doc 28)
     → cancel edit (discard in-progress textarea value, restore strip to last-saved state, no save). No "discard changes?" modal.

6. DocEditor open with focus (Doc 18)
     → blur the editor (no save modal — auto-save covers persistence; explicit close is a click on `← Back`)

7. Reader View active (Doc 21 — deferred to v2.0.x but slot reserved)
     → exit Reader View

8. (no-op)
```

**Implementation:** A single `keydown` listener at the document level, registered in `App.tsx`. Each feature sets a flag or exposes a handler that this function checks in order. No feature registers its own Escape listener independently — all Escape handling is centralised here.

**Reading the chain:** lower number wins. Slots that are not currently occupied (no modal, no Settings, etc.) fall through to the next. Slot 5 (Feedback edit) reads `workspaceStore.feedbackEditingMessageId !== null` to decide whether to fire. Slot 4 (Ghostwriter) reads `ghostwriterStore.phase`. Slot 2 (Settings) reads `uiStore.settingsOpen`. Slot 3 (Mode session end-confirm) reads `modeStore.endConfirmationOpen`.

**Modes and Escape:** Modes (`story`, `handover`, `consulting`) are persistent workspace state — Escape does not exit a mode. Mode switching is always an explicit user action (mode switcher UI).

---

## Focus Management

### Focus trap

Used in: all Dialog (modal) overlays, Lightbox.

When a modal opens:
1. Focus moves to the first focusable element inside the modal
2. Tab/Shift+Tab cycles only within the modal
3. On close, focus returns to the element that triggered the modal

Implemented via `useFocusTrap.ts`. All Dialog components use this hook — it is not optional.

### Focus restoration

When a context menu, popover, or tooltip closes, focus returns to the element that opened it. This is handled by shadcn/ui's built-in behavior for Popover and Tooltip. ContextMenu (custom) restores focus manually on close.

### Tab order

Tab follows DOM order. Interactive elements that are visually hidden or disabled must have `tabIndex={-1}` or `aria-disabled`. No `tabIndex` values above 0 in component code.

---

## Keyboard Shortcuts

> **Status:** Deferred — shortcut list and registration pattern to be defined in a later session. See IMPL-NOTES.md.

A stub section is reserved here. When defined, shortcuts will be documented in the format:

```
| Shortcut | Scope | Action |
|---|---|---|
| Ctrl+Enter | InputArea focused | Send message |
| ...        | ...              | ... |
```

Scope levels: Global (anywhere in workspace), Pane-specific, Component-specific.

---

## Hover Behavior

**Standard transition:** `150ms ease` on color and background changes. Applied via Tailwind `transition-colors duration-150`.

**Extended transition:** `300ms ease` for larger layout shifts (pane expand/collapse, drawer open/close).

No hover effects on: disabled elements, elements during loading/generating state.

**Hover color pattern:**
```
default  →  --color-bg-hover     (background)
active   →  --color-bg-active    (background, pressed state)
```

Text color on hover: `--color-text-primary` (if currently muted), no change (if already primary).

---

## Context Menus

### Trigger rules
- Right-click on vault tree items (stories, folders, docs, images)
- Right-click on message bubbles (AI and user)
- Right-click on checkpoint markers
- No context menu on: pane backgrounds, disabled elements, input fields

### Standard item shape

```
[Icon 14px]  Label text                    ← standard item
────────────────────────────────────────   ← separator (between groups)
[Icon 14px]  Destructive action            ← destructive item (--color-error text)
```

Items are grouped by function, separated by a `--color-border-subtle` 1px line. Group order: primary actions → secondary actions → destructive actions.

### Destructive items
Destructive context menu items (Delete, Permanently Delete) use `--color-error` for the label text. They do not require a separate confirmation from the menu itself — confirmation (if needed) is shown after selection.

### Behavior
- Opens at cursor position, flips if near viewport edge (see Doc 09 ContextMenu)
- Only one context menu open at a time — opening a new one closes any existing one
- Closes on: item click, click outside, Escape key
- Escape from context menu does NOT propagate to the Escape chain

---

## Drag and Drop

Used in: vault tree (reorder items, move into folders).

### Drag initiation
- Mouse down + move on a draggable vault item
- Drag handle is the item row itself (no separate handle icon)
- Minimum drag distance before initiation: 4px (prevents accidental drags on clicks)

### Visual feedback during drag

| Element | Visual |
|---|---|
| Dragged item | Ghosted at 50% opacity, follows cursor |
| Valid drop target (folder) | `--color-accent-subtle` background, `--color-accent` border |
| Valid drop position (between items) | 2px `--color-accent` insertion line |
| Invalid drop target | No highlight, cursor `not-allowed` |

### Drop behavior
- Drop on folder → move item inside folder
- Drop between items → reorder within current parent
- Drop on root → move item to vault root
- Drop on itself or current position → no-op
- Escape during drag → cancel drag, return item to original position

### Multi-select drag
If multiple items are selected and the user drags one of them, all selected items move together. Count badge shown on the ghost: `Moving 3 items`.

---

## Selection Patterns

### Single select (vault tree)
Click on an item → select it, deselect previous. Opens the item in the Theater or DocEditor.

### Multi-select (vault tree)
- `Ctrl+Click` / `Cmd+Click` → add/remove item from selection
- `Shift+Click` → range select from last selected to clicked item
- Clicking empty space in the Navigator → deselect all
- Multi-select activates the BulkActionBar (replaces Navigator header)

### Text selection inside AI bubbles
Outside Ghostwriter mode, text selection in an AI bubble is **standard browser selection** (copy, search, etc.) — LOOM does not intercept it. To revise a passage, the writer enters Ghostwriter mode first via the bubble's action row `✦ Ghostwriter` button or right-click → Ghostwriter; only **inside** Ghostwriter mode does the bubble's selection drive the Ghostwriter target passage. See Doc 17 §Mode-First Activation.

Inside Ghostwriter mode the selection must be:
- At least 1 word
- Entirely within the active bubble (selections crossing the bubble boundary are clamped)

Clicking outside the bubble or pressing Escape — see Escape Chain above — cancels Ghostwriter mode (with confirmation if a diff is pending review).

---

## Confirmation Dialogs

### When required
| Action | Confirmation required |
|---|---|
| Soft delete (vault item → trash) | No — undo toast shown instead |
| Permanent delete (from trash) | Yes |
| Bulk permanent delete | Yes — count shown ("Delete 3 items permanently?") |
| Lock during generation | Yes — "Generation in progress. Lock anyway?" |
| World switch during generation | Yes — "Generation in progress. Switch worlds?" |
| Password change | Yes — requires current password input |

### When not required
Single-step reversible actions (attach/detach doc, rename, move, soft delete) do not require confirmation. They show an undo toast instead where applicable.

### Dialog pattern
Confirmation dialogs use the shadcn Dialog component. Structure:
```
Title       — short imperative ("Delete permanently?")
Body        — one sentence explaining the consequence
[Cancel]  [Confirm]   — Cancel is always left/secondary, Confirm is right/primary
```

Destructive confirm button uses `--color-error` background, not accent. Cancel always closes without action.

---

## Loading States

### Global generation (AI response)
- Send button changes to Cancel (Stop icon)
- LoadingDots appear in the streaming AiBubble
- `workspaceStore.isGenerating = true`
- All other Send/Generate buttons disabled

### Async operations (non-generation)
Short operations (<300ms): no loading state shown.
Longer operations (>300ms): spinner inline at the action site (button or list item). No full-screen blocking overlay except for initial vault unlock.

### Skeleton states
Used when content is loading into a list for the first time (vault tree on world open). Skeleton items match the approximate height and shape of real items, using `--color-bg-elevated` as the base with a subtle shimmer.

---

## Animation Conventions

| Type | Duration | Easing | Example |
|---|---|---|---|
| Color / background | 150ms | ease | Hover states, active states |
| Fade in (overlay) | 150ms | ease | Context menu, tooltip, modal backdrop |
| Scale + fade (popover) | 150ms | ease | Context menu open (0.96 → 1.0) |
| Slide (drawer/pane) | 200ms | ease | Right pane collapse/expand |
| Pulse (generation) | 1500ms | ease-in-out infinite | Ghostwriter active outline |
| Stagger (dots) | 600ms | ease | LoadingDots sequence |

**No transitions on:** app phase changes (onboarding → locked → workspace), world switches, story switches. These are state replacements, not animations.

**Reduced motion:** Not yet implemented. Flagged for a future accessibility pass.
