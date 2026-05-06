# 10 — Layout and Navigation

> **Status:** Complete
> **Last updated:** 2026-05-03 — pre-implementation audit resolution: Theater Content Switching now lists Settings as a full workspace surface; `<ImageViewer />` collapsed into `<DocEditor />` per Doc 18 (image source documents share the editor with a lightbox layout) (CD-5).
> **Earlier:** 2026-04-29 — Doc 23 design pass: mode switcher confirmed in Theater top bar; mode-switch scroll behaviour corrected to "scroll persists" (single shared Theater scroll); mode layout variations table updated to reflect handover / consulting specs
> **Earlier:** 2026-04-26 — initial layout pass

Three-pane structure, pane sizing rules, resize behavior, collapse, persistence, and how modes affect layout.

---

## Window Constraints

| Property | Value |
|---|---|
| Minimum width | 1100px (enforced in `tauri.conf.json`) |
| Minimum height | 700px (enforced in `tauri.conf.json`) |
| Target platforms | Desktop only — no touch, no mobile |

The minimum window size is enforced at the OS level by Tauri. The frontend does not need to handle sub-minimum sizes.

---

## Three-Pane Shell

```
┌────────────────────────────────────────────────────────────┐
│  LeftPane         │  Theater (Center)        │  RightPane  │
│  (Navigator)   div│  flex-1                  │div          │
│  fixed width      │  overflow-hidden         │  fixed width│
│  200–360px        │                          │  240–400px  │
└────────────────────────────────────────────────────────────┘
```

The shell is a full-height `flex` row (`h-full w-full`). Center pane takes all remaining space (`flex-1`). Left and right panes are fixed-width with `flexShrink: 0`.

**Background colors:**
| Pane | Token |
|---|---|
| Left | `--color-bg-pane` |
| Center | `--color-bg-theater` |
| Right | `--color-bg-pane` |
| App root | `--color-bg-base` |

---

## Pane Sizing Rules

### Left Pane (Navigator)

| Property | Value |
|---|---|
| Default width | 260px |
| Minimum width | 200px |
| Maximum width | 360px |
| localStorage key | `left_pane_width` |

### Right Pane (Control)

| Property | Value |
|---|---|
| Default width | 280px |
| Minimum width | 240px |
| Maximum width | 400px |
| localStorage key | `right_pane_width` |
| Collapsed width | 32px (toggle bar only) |

### Center Pane (Theater)

Takes all remaining horizontal space via `flex-1`. No fixed width, no min/max (the window minimum of 1100px provides the effective floor).

---

## PaneDivider

A 1px visual line with a 7px invisible hit area centered on it. Dragging resizes the adjacent pane.

```
         │◄─7px hit area─►│
         │    1px line     │
```

**Behavior:**
- `mousedown` on hit area begins drag
- During drag: `cursor: col-resize`, `userSelect: none` on `document.body`
- `mousemove` computes new width, clamped to `[min, max]`
- `mouseup` ends drag, calls `onResizeEnd` to persist width to localStorage
- Left divider: `delta = clientX - startX` (dragging right expands left pane)
- Right divider: `delta = startX - clientX` (dragging left expands right pane)

**Visual:**
| Element | Value |
|---|---|
| Line | 1px, `--color-border` |
| Cursor | `col-resize` |

---

## Right Pane Collapse

The right pane can be manually collapsed to a 32px toggle bar. There is no automatic collapse.

### Expanded state
Full-width pane (240–400px). Normal content rendered.

### Collapsed state
32px bar, `--color-bg-pane` background, `1px solid --color-border` left border.
Contains one button: expand icon (`PanelRightOpen`, 14px, `--color-text-muted`).

**Toggle:**
- Collapse: button inside RightPane header (to be defined in feature doc)
- Expand: the expand button in the collapsed toggle bar
- State: `appStore.rightPaneCollapsed: boolean`

**Divider:** Right PaneDivider is not rendered when the right pane is collapsed — the 32px toggle bar has its own border.

---

## Persistence

Pane widths are persisted to localStorage on drag end (`onResizeEnd`). They are read on mount with a fallback to the default value.

```typescript
const LEFT_DEFAULT  = 260;
const RIGHT_DEFAULT = 280;

function readWidth(key: string, fallback: number): number {
  const stored = localStorage.getItem(key);
  const n = parseInt(stored ?? '', 10);
  return isNaN(n) ? fallback : n;
}
```

Right pane collapsed state is persisted in `appStore` and survives workspace re-mounts but not app restarts. *(Restart persistence is a future refinement.)*

---

## Theater Content Switching

The center + right pane region renders different content depending on workspace state. Priority order (highest first):

```
appStore.settingsOpen = true            →  <Settings />        (full workspace surface; mode switcher + right pane hidden)
activeDocId set                         →  <DocEditor />       (full workspace surface; image vs. text layout chosen internally per Doc 18)
activeStoryId set                       →  <Theater />          (mode switcher + right pane visible)
neither set                             →  <NoStorySelected />  (empty state)
```

**Full-surface views** (Settings, DocEditor) take the entire workspace region — Navigator stays visible, but the mode switcher and right pane are hidden. `← Back` returns to the previous mode. This pattern is locked in D-13 (DocEditor) and D-16 (Settings); both follow the same shape.

**Image source documents** (`item_type = 'Image'`) open in `<DocEditor />`, which renders an internal lightbox + caption layout per Doc 18 §Layout — image source documents. There is no separate `<ImageViewer />` component in v2.0.

This switching logic lives in `Workspace.tsx`. The center pane div is always present — only its child changes.

---

## Mode Layout Variations

Modes (`story`, `handover`, `consulting`) change what the input area, mode switcher, and right-pane sections render. The three-pane shell is identical across all modes; the Theater scroll surface is shared and renders all message kinds and partitions regardless of active mode.

The mode switcher is a horizontal tab strip at the top of the Theater pane (above the scroll surface). Three tabs: **Story · Handover · Consulting**. The active session name (when applicable) appears as a sub-label on the active tab. Visual treatment is owned by Doc 27 (Theater Composition).

| Mode | Input area | Theater scroll surface | Right pane |
|---|---|---|---|
| `story` | Four fields (plot / background / modificators / constraints), aux slot UI visible | Story bubbles + all session banners + accordion banners | Settings · Context Documents · Cache (story + active consulting if any) · Status |
| `handover` | One free-text field, aux slot UI hidden | Same shared scroll surface; active handover partition is visually emphasised | Same right pane (no handover-specific section in v2.0) |
| `consulting` | One free-text field, aux slot UI hidden | Same shared scroll surface; active consulting partition emphasised; post-entry story messages greyed during re-entry | Same right pane (active consulting cache appears in the Cache section) |

Mode-specific content is defined in Doc 23 (Modes). Bubble, banner, and partition rendering rules are in Doc 27. The layout shell has no mode-specific logic — the input area and mode switcher subscribe to `modeStore.activeMode` and re-render their internals.

---

## Scrolling Rules

Each pane manages its own scroll independently. The outer shell (`h-full`, `overflow: hidden`) never scrolls.

| Pane | Scroll container |
|---|---|
| Left (Navigator) | VaultTree inner container |
| Center (Theater) | Message list container |
| Right (Control) | RightPane inner container |

Scroll positions are not persisted across sessions. On story switch, the Theater scrolls to the bottom (most recent message). On **mode switch**, scroll position **persists** — the Theater is one shared scroll surface across all three modes, and a switch only changes the input area and the mode switcher's active tab.

---

## Viewport Watcher

A lightweight utility (`src/lib/viewportWatcher.ts`) reads `window.innerWidth` and `window.innerHeight` on resize and writes to `appStore.viewport`. Components that need to respond to window size changes read from the store rather than attaching their own resize listeners.

Initialised once in `Workspace.tsx` on mount, cleaned up on unmount.
