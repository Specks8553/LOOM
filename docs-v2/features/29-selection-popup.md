# 29 — Selection Popup

> **Status:** Complete — implemented 2026-05-19 (`SelectionToolbar.tsx` + `selectionMenu.ts`; no formal phase assigned). **Mark actions (D-25) land in Phase 14.**
> **Last updated:** 2026-05-23 — D-25: the open action slot (§8) is filled — `Mark important` / `Unmark` / `Edit note` (Doc 30) become the first content actions beyond Ghostwriter, on `story-ai` and `story-user` targets. Implementation lands in Phase 14.
> **Earlier:** 2026-05-19 — first full design pass (D-23); observer-overlay model adopted (text selection is never intercepted); selection-first becomes a sanctioned Ghostwriter entry path alongside the existing mode-first paths; menu contents left deliberately open ("curveball" — owner to fill later).
> **Scope:** A floating toolbar that appears above a non-empty text selection made inside a story AI bubble, a session AI bubble, or a story user bubble. This doc owns the *mechanism* — selection observation, bubble registration, toolbar lifecycle, positioning, and the handoff into Ghostwriter. It does **not** own the toolbar's full action list (intentionally open — see §8), the Ghostwriter feature itself (Doc 17), the right-click context menu (Doc 11 §Context Menus, D-22), or bubble rendering (Doc 27).

The Selection Popup is a Perplexity-style floating toolbar: select a passage in a bubble, a small menu fades in above it. It is a **second** way to act on bubble text — the right-click context menu (D-22) acts on the *whole bubble*; the Selection Popup acts on a *passage*.

Its first concrete action is **Ghostwriter** — selecting a passage and clicking Ghostwriter in the popup feeds that passage straight into Ghostwriter mode. Beyond that, the action list is deliberately left open; this doc specs the surface so future actions are additive (§8).

---

## 1. Scope

| Surface | Popup |
|---|---|
| Story AI bubble — prose (`StoryAIBubble`) | ✅ — Ghostwriter + content actions |
| Session AI bubble — prose (`SessionBubble`, `role = 'model'`) | ✅ — Ghostwriter + content actions |
| Story user bubble (`StoryUserBubble`, rendered field stack) | ✅ — content actions only (no Ghostwriter) |
| Session user bubble | ❌ — no menu (consistent with Doc 11 §Menu contents) |
| Bubbles with `content_type = 'blocks'` | ❌ — deferred to v2.1 (consistent with Ghostwriter / Feedback) |
| The compose `InputArea` and all in-place edit `<textarea>`s | ❌ — editable text keeps the native browser menu (Doc 11 §Editable text) |
| Streaming bubble · bubble in Ghostwriter mode · bubble being edited in place | ❌ — see §3 (suppression is structural, not a runtime check) |

User bubbles get the popup but **not** the Ghostwriter action: Ghostwriter only revises AI messages, and a user bubble renders its content as several `<p>` across labelled fields rather than one prose string (§6).

---

## 2. The non-interception principle

The popup **observes** the browser's native selection; it never intercepts it. Drag-to-select, Shift+Arrow extension, Ctrl+C, and the browser's own find all keep working untouched. The toolbar is purely additive — it reads the selection the browser already made and renders an overlay near it.

Rejected approaches, and why each would be "interception":

| Approach | Why rejected |
|---|---|
| `user-select: none` + custom mouse-tracking selection | Reimplements selection; loses copy, find, accessibility |
| `preventDefault()` on the bubble's `mousedown` / `mouseup` | Kills the browser's native selection gesture |
| Wrapping the selected run in `<span>` elements | Mutates DOM React owns; breaks streaming `pre-wrap` text and reconciliation |

The **only** event handling in the whole feature is on the toolbar element itself: `onMouseDown` → `preventDefault()`. Without it, clicking a toolbar button would collapse the selection (a mousedown outside the selected range clears it). This preventDefault is on the toolbar, never on bubble text — the selection is preserved while the user picks an action.

---

## 3. Bubble registration & structural suppression

A bubble opts in by carrying a `data-loom-selectable="<messageId>"` attribute on its **rendered-prose wrapper** — and a `data-loom-bubble-kind` of `story-ai` | `session-ai` | `story-user`.

The observer (§4) resolves a selection's endpoints with `node.closest('[data-loom-selectable]')`. Because the attribute lives only on the rendered-prose wrapper:

- A **streaming** bubble renders a thinking placeholder / `StreamingDots`, not the prose wrapper → `closest()` returns null → no popup.
- A bubble **in Ghostwriter mode** renders `GhostwriterBubble` (a different component, which owns its own selection capture per Doc 17) → no `data-loom-selectable` → no popup.
- A bubble **being edited in place** renders a `<textarea>` → no `data-loom-selectable` → no popup.

Suppression therefore needs **no runtime `if` checks** — the attribute is simply absent from the subtrees where the popup must not appear. Adding the attribute is the only bubble-component change (§10).

---

## 4. Lifecycle

A single `<SelectionToolbar />` is mounted once at the workspace root (alongside `ContextMenuProvider` in `WorkspaceShell`). It is a **pure observer** — no provider, no context, nothing invokes it imperatively.

### Appear

1. A global `selectionchange` listener on `document`, debounced ~150 ms. (`selectionchange` — not `mouseup` — so keyboard Shift+Arrow selection is covered too.)
2. On settle, read `window.getSelection()`. Bail (hide) if: `rangeCount === 0`, `isCollapsed`, or `toString().trim()` is empty.
3. Resolve `anchorNode` **and** `focusNode`, each via `closest('[data-loom-selectable]')`. Bail if either is null.
4. If the two resolve to **different** bubbles (selection crosses a bubble boundary) → bail. (Suppress, do not clamp — simpler, and a cross-bubble passage is not a meaningful Ghostwriter target.)
5. Otherwise capture a `SelectionTarget` (§6) and show the toolbar.

### Reposition

While visible, a capture-phase `scroll` listener and a `resize` listener recompute the anchor rect from the still-live `Range` and move the toolbar. The toolbar is anchored to **text**, so it tracks the passage as the Theater scrolls — it does not dismiss on scroll (contrast: the right-click `ContextMenu`, which is cursor-anchored and dismisses on scroll).

If, on recompute, the selection has collapsed or the `Range` is no longer valid → hide.

### Dismiss

The toolbar hides on any of:

- **Deselect** — selection collapses or becomes empty/whitespace (caught by the §4 observer). Clicking outside the selection collapses it natively → this path also covers outside-click.
- **Escape** — a capture-phase `keydown` listener active only while the toolbar is visible. It calls `preventDefault()` + `stopPropagation()` and hides. It does **not** propagate to the Escape Chain (Doc 11) — identical to `ContextMenu`'s local Escape handling.
- **Right-click** — a `contextmenu` listener hides the toolbar so the right-click `ContextMenu` (D-22) owns the surface. The two menus are never visible at once.
- **Story / world / mode switch, lock** — the toolbar unmounts with the Theater; no special handling.

---

## 5. Positioning

Reuses `ContextMenu`'s viewport-margin flip logic (`VIEWPORT_MARGIN = 8`).

- Anchor: horizontally centred on the selection rect's centre; placed **above** the rect with an 8 px gap.
- **Flip below** if `rect.top − toolbarHeight − gap < VIEWPORT_MARGIN`.
- Clamp horizontally so the toolbar stays within `[VIEWPORT_MARGIN, innerWidth − VIEWPORT_MARGIN]`.
- Rendered via `createPortal` to `document.body`, `position: fixed`, `z-index` above bubbles and at/below the modal layer. Open animation: 150 ms scale-and-fade (`0.96 → 1.0`), matching Doc 11 §Animation Conventions.

---

## 6. The captured selection — `SelectionTarget`

```ts
interface SelectionTarget {
  messageId: string;
  kind: 'story-ai' | 'session-ai' | 'story-user';
  /** selection.toString() — the raw selected text. */
  text: string;
  /** Character offsets into messages.content. AI bubbles only; null for user bubbles. */
  offsets: { start: number; end: number } | null;
  /** Union bounding rect in viewport coordinates; recomputed on scroll/resize. */
  rect: DOMRect;
}
```

**Offset model.** Story and session AI prose renders as a **single text node** — `<div className="whitespace-pre-wrap">{message.content}</div>` — so a `Range`'s `startOffset` / `endOffset` on that node map 1:1 to `messages.content` character offsets. This is the same assumption `GhostwriterBubble` already relies on (Doc 17 §Selection). `offsets = { start: min(...), end: max(...) }`.

A story **user** bubble renders its content as multiple `<p>` across the Plot Direction / Background / Constraints fields — offsets do **not** map to a single string. User-bubble targets therefore carry `offsets: null` and only ever expose `text` (`selection.toString()`).

---

## 7. Ghostwriter handoff

Ghostwriter (Doc 17) now has **three** sanctioned entry paths. All converge on the same store state; the only difference is whether a passage is pre-seeded.

| Entry path | Effect |
|---|---|
| Action-row `✦ Ghostwriter` button | Enters mode; writer selects the passage afterwards (mode-first) |
| Right-click → `Ghostwriter…` | Enters mode; writer selects the passage afterwards (mode-first) |
| **Selection Popup → Ghostwriter** | Passage already selected; enters mode **pre-seeded** with it (selection-first) |

The popup action, on an AI-bubble target:

```ts
function ghostwriterFromSelection(t: SelectionTarget) {
  if (t.offsets === null) return;            // guarded — AI bubbles only
  enterGhostwriter(t.messageId);             // bubble re-renders as GhostwriterBubble
  setGhostwriterSelection({                  // moves phase 'selecting' → 'composing'
    startOffset: t.offsets.start,
    endOffset: t.offsets.end,
    selectedText: t.text,
  });
  hide();
}
```

Both calls are existing synchronous `workspaceStore` actions — **no store, IPC, or Rust signature change** (audited; see §10). The selection is handed off as **offset data**, not as a live DOM `Selection`. This is load-bearing: `enterGhostwriter` swaps the bubble for `GhostwriterBubble`, a fresh DOM node, which discards the native browser selection. Passing offsets survives that swap; passing a `Range` would not.

**Native selection collapses after handoff.** Once `GhostwriterBubble` mounts, the native selection is gone, so the browser's `::selection` highlight on the passage vanishes — even though Ghostwriter still holds it as `selection` state. To keep the passage *visibly* highlighted, the non-intrusive mechanism is the **CSS Custom Highlight API** (`new Highlight(range)` + `::highlight()`), which paints an arbitrary range with no DOM mutation. Doc 17 owns the in-mode highlight; this is flagged there as a cross-reference (§10) — the selection-first path is the case that makes it necessary.

---

## 8. Menu contents — deliberately open

The toolbar's full action list is **intentionally unspecified** in this pass. The mechanism above is the deliverable; contents are a later decision ("curveball").

What is fixed:

- **Ghostwriter** — on `story-ai` and `session-ai` targets only. Disabled when the selection is shorter than one word, or while `workspaceStore.isGenerating` is true. Hidden entirely on `story-user` targets.
- **Mark important / Unmark / Edit note** (D-25, Doc 30) — on `story-ai` and `story-user` targets (the two story-kind bubble kinds; **not** `session-ai`, since no v2.0 summary feature consumes session marks). `Mark important` when the selection isn't already inside a mark; `Unmark` / `Edit note` when it is. **Not** disabled by `isGenerating` (pure DB write). The action passes `SelectionTarget.{messageId, text, offsets}` to `add_mark` — offsets for AI targets, `null` for user targets (Doc 30 §3).
- Contents are **resolved per target** from `SelectionTarget.kind` and current state — the same per-click resolver pattern D-22 established for context menus. A pure `(target, state) → SelectionAction[]` function; no menu logic inside bubble components.
- Each action is a `SelectionAction { label, icon?, onClick, disabled?, destructive? }` — structurally the `MenuItem` shape from `ContextMenu.tsx`, so the two surfaces can share rendering primitives if useful.

Further actions (e.g. copy passage, define, comment) drop in as additional resolver entries with no change to §2–§7.

---

## 9. Edge cases

| Case | Behaviour |
|---|---|
| Selection crosses two bubbles | Suppressed (no popup) — §4 step 4 |
| Whitespace-only / empty selection | No popup — §4 step 2 |
| Selection shorter than one word | Popup shows; Ghostwriter action disabled |
| Selection while `isGenerating` | Popup shows; Ghostwriter action disabled (mutating); future read-only actions stay enabled |
| Streaming / in-Ghostwriter / in-edit bubble | No popup — structural, §3 |
| Right-click on an active selection | Toolbar hides; right-click `ContextMenu` opens instead — §4 |
| Selection inside the compose box or an edit `<textarea>` | No popup; native browser menu — §1 |
| Multi-select | N/A — multi-select is a Navigator concept (Doc 11); bubbles are not multi-selectable |

---

## 10. Interface impact

**Frontend-only. No schema, IPC, or Rust change.** Audited 2026-05-19.

| Area | Change |
|---|---|
| New | `src/components/shared/SelectionToolbar.tsx` — the singleton observer-overlay component |
| New | A per-target resolver (`selectionMenu.ts` or equivalent) — `(target, state) → SelectionAction[]` |
| `WorkspaceShell` | Mount `<SelectionToolbar />` once at the workspace root |
| `StoryAIBubble`, `SessionBubble`, `StoryUserBubble` | Add `data-loom-selectable` + `data-loom-bubble-kind` to the rendered-prose wrapper only |
| `workspaceStore` | **No change** — `enterGhostwriter` + `setGhostwriterSelection` already cover the handoff |
| Doc 11 | §"Text selection inside AI bubbles" rewritten — selection-first is now sanctioned |
| Doc 17 | Cross-ref: the popup-seeded path leaves no native selection; the in-mode passage highlight should use the CSS Custom Highlight API |
| Doc 27 | Bubble note: bubbles carry `data-loom-selectable` on their prose wrapper |
| Doc 30 (Phase 14) | Resolver gains `Mark important` / `Unmark` / `Edit note` on `story-ai` + `story-user` targets; handoff is offset data to `add_mark` (per Doc 30 §3) |

---

## Out of scope (v2.0)

- The full toolbar action list beyond Ghostwriter — §8.
- The popup on `content_type = 'blocks'` bubbles — v2.1, with Ghostwriter/Feedback.
- The popup inside the compose `InputArea` or edit `<textarea>`s — native browser menu stands.
- Touch / pen selection affordances — desktop pointer + keyboard only in v2.0.
