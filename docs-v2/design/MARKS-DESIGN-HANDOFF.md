# Design Handoff — Marks ("Mark as Important")

> **For:** the design team. **From:** the D-25 design session (2026-05-23).
> **Source of truth:** [Doc 30 — Marks](../features/30-marks.md) (behaviour), [Doc 03](../foundation/03-data-model.md) (data), [Doc 27](27-theater-composition.md) (where it sits in the Theater), [Doc 08](08-design-tokens.md) (`--color-mark` triad).
> **Status:** Design-only — no code yet. This session produced the spec; visuals are open. Everything tagged ⚠️ below is a decision for you.

## What the feature is, in one breath

The writer selects a passage inside a story bubble and **marks it important**. From then on, any AI that *summarises* the story (Accordion chapter summaries, Handover, Consulting) is told to preserve that passage. Marks never affect normal story generation — they're a "survive the compression" flag. This is the only thing this session designed; the changelog below is its complete user-facing surface.

---

## New user-facing surfaces (everything you need to lay out)

### 1. Selection Popup action — "✦ Mark important"

- **Where:** the existing floating Selection Popup (the toolbar that appears over a text selection in a bubble — Doc 29). It already ships with **Ghostwriter** as its only action; **Mark important** is the second.
- **Appears on:** story AI bubbles **and** story user bubbles. (Not session bubbles.)
- **States of the action:**
  - `✦ Mark important` — when the selection isn't already inside a mark.
  - `Unmark` — when the selection is exactly/inside an existing mark.
  - `Edit note` — when the selection is inside an existing mark (opens the note editor, see #4).
- **Not** disabled during generation (unlike Ghostwriter) — it's a lightweight action.
- ⚠️ **Design:** icon for the action; how it sits beside Ghostwriter in the toolbar; the active/disabled treatments.

### 2. The mark indicator — a dot

- **What:** a small **dot at the bottom-right corner** of any story bubble that has ≥1 mark. Colour `--color-mark`.
- **Two states:**
  - **Normal** — the bubble has valid marks. Dot in `--color-mark`.
  - **Warning** — one or more of the bubble's marks is *orphaned* (the marked passage was edited away; see #5). Dot switches to a **warning tone** (not `--color-mark`).
- ⚠️ **Design:** dot size/placement (must not collide with the existing feedback strip or hover action row below AI bubbles); normal vs warning visual; does it animate in?

### 3. The dot's hover popover

- **Trigger:** hover the dot.
- **Content:** a list of the bubble's marked passages — truncated `quoted_text`, each with its optional note. Per-row affordances: **Edit note**, **Remove**.
- **Warning rows:** orphaned marks show a ⚠ with copy like *"the marked passage changed — re-mark or remove."*
- ⚠️ **Design:** popover styling, max width, truncation, how many rows before scroll, the warning-row treatment, the per-row controls. Provisional copy in Doc 30 §4 — refine.

### 4. Optional note on a mark

- A mark can carry a short **note** (e.g. *"pays off in the finale — keep"*). The note is shown in the hover popover and is fed to the summary AI alongside the quote.
- **Editor:** opened via the popup's `Edit note` action or the popover row's Edit-note control.
- ⚠️ **Design:** the note input — inline in the popover? a small editor like the feedback textarea (Doc 28)? Apply/Cancel affordances; empty-note state.

### 5. In-place highlight of marked passages

- Marked passages are **painted in the bubble** (persistent highlight, background `--color-mark-subtle`), using the same no-DOM-mutation tech as Ghostwriter's highlight.
- **AI bubbles:** exact (offset-based).
- **User bubbles:** best-effort — if the passage can't be located unambiguously, that mark shows **dot-only** (no highlight). Acceptable.
- Orphaned marks are **not** highlighted (only the dot warns).
- ⚠️ **Design:** highlight fill alpha; how it coexists with the live text-selection colour and with Ghostwriter's frame; overlapping marks (allowed) treatment.

### 6. New theme colour — `--color-mark`

- A new world-overridable feature colour, like `--color-feedback` / `--color-ghostwriter` / `--color-accordion`. Drives the dot and the highlight. New triad: `--color-mark` / `-hover` / `-subtle`.
- Surfaces in **Settings → Features** as `mark_color` (alongside the other feature-colour pickers).
- **Hard constraint:** it must read as clearly distinct from **feedback-amber (`#f59e0b`)** and **warning-red**, because the *same dot* uses the warning tone when a mark is orphaned. It does **not** track the accent.
- ⚠️ **Design owns the final hex.** Current `#ec4899` (rose) is a placeholder chosen only to satisfy the constraint.

---

## Behaviours that change existing surfaces (FYI, low design surface)

- **Selection Popup (Doc 29):** gains the actions above. Otherwise unchanged.
- **Accordion banners (Doc 16/27):** no new banner UI — but adding/removing a mark inside a summarised chapter marks that chapter **stale** (existing `⚠` stale badge fires). No new visual to design; just be aware the stale badge can now be triggered by marking.
- **No change** to normal story sending, the input area, the cache UI, or session bubbles.

---

## States & edge cases worth a visual

| State | What the writer sees |
|---|---|
| Bubble with 1 mark | One dot, one highlighted passage |
| Bubble with several marks | One dot; popover lists all; multiple highlights (may overlap) |
| Mark with a note | Popover row shows the note under the quote |
| Orphaned mark (passage edited away) | Dot → warning tone; popover row → ⚠ + "re-mark or remove"; no highlight |
| User-bubble mark that can't be located | Dot only, no highlight (silent fallback) |
| Empty / no marks | No dot, nothing painted |

---

## Open design decisions (the ⚠️ list, collected)

1. Final `mark_color` hex (constraint: ≠ feedback-amber, ≠ warning-red).
2. Mark dot — size, exact corner placement, normal vs warning treatment, collision-avoidance with the feedback strip + action row.
3. Hover popover — styling, row layout, truncation, scroll, warning-row treatment, per-row controls.
4. Note editor — inline vs textarea; Apply/Cancel; placement.
5. In-place highlight — fill alpha; interaction with selection colour and Ghostwriter frame; overlapping-mark treatment.
6. Selection Popup — `Mark important` icon and its placement next to Ghostwriter.
7. Copy — popover labels, warning message, note placeholder (Doc 30 has provisional strings).

---

*Anything here that's behavioural rather than visual, raise against Doc 30 — it's the spec and will be amended if a visual decision forces a behavioural one.*
