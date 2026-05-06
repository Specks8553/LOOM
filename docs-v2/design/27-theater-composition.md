# 27 — Theater Composition

> **Status:** Complete (skeleton + structural rules; visual values ⚠️ provisional, owned by the visual design phase)
> **Last updated:** 2026-05-04 — Feedback design pass (D-17): AI bubble feedback rendering replaced — locked as a compact single-line preview strip below the bubble with `--color-feedback` left border, click-to-edit; cross-reference table now points at Doc 28; "Edit / regenerate / delete / feedback / cancel" entry under Doc 15 narrowed to remove `feedback` (now owned by Doc 28).
> **Earlier:** 2026-04-29 — Doc 17 design pass: Ghostwriter floating-panel placement documented (right gutter, viewport-clamped to bubble extent); plain-text rendering swap noted on the AI bubble section
> **Earlier:** 2026-04-29 — Doc 16 design pass: accordion banner detail filled in (button-slot state machine, chevron, name pattern, token-impact display, stale badge, "previous chapter" right-click affordance)
> **Earlier:** 2026-04-29 — initial pass alongside Doc 23 (Modes); structural rules for bubbles, partitions, banners; cross-mode unification of the banner pattern
> **Scope:** What the Theater pane renders, in what order, and how the moving parts (bubbles, partitions, banners, indicators) compose. This doc owns the *structural* and *behavioural* rules. Token-level visual values (colours, exact pixels, typography) are ⚠️ provisional and owned by the visual design phase.

The Theater is the centre pane of the workspace shell (Doc 10). It is one continuous scroll surface. All story messages, all session partitions (handover, consulting), and all accordion partitions for the active story are rendered together in chronological order. There is no per-mode Theater — modes change input and cache, not what is visible.

This doc consolidates Theater rendering rules so that Doc 15 (story bubbles), Doc 16 (accordion partitions), Doc 17 (Ghostwriter highlights), and Doc 23 (handover / consulting partitions) have one common reference for shared structure. Per-feature visual specifics (e.g. Ghostwriter's highlight treatment) stay in their feature docs.

---

## Theater Regions

The Theater pane is a vertical stack of three regions:

```
┌──────────────────────────────────────────────────────┐
│  Top bar — Mode switcher                             │  ~40px
├──────────────────────────────────────────────────────┤
│                                                      │
│  Scroll surface — bubbles, banners, partitions       │  flex-1
│                                                      │
├──────────────────────────────────────────────────────┤
│  Input area — mode-specific shape                    │  auto-height, capped
└──────────────────────────────────────────────────────┘
```

The Status section (Doc 15) lives in the right pane, not in the Theater. The Theater never owns generation status display — it owns content.

### Top bar — mode switcher

A horizontal tab strip immediately above the scroll surface. Three tabs: **Story · Handover · Consulting**.

- Active tab is highlighted with the accent colour underline (token: `--color-accent`).
- When a session is active in handover or consulting, the active tab additionally shows the session name: `Consulting · Consulting 2`. The label is single-line, truncated with ellipsis if it overflows.
- Click behaviour: per Doc 23 §Switcher behaviour. Story tab activates story; Handover/Consulting tabs **always create a new session** at the current scroll-surface tail.

Visual values (height, font, spacing, divider treatment) are ⚠️ provisional.

### Scroll surface

The full-flex middle region. Vertically scrollable. Renders, in chronological order:

1. Story-kind messages (user / model bubbles)
2. Banners and partitions for handover and consulting sessions, anchored at their `entry_message_id` position
3. Banners and partitions for accordion segments, at their checkpoint positions

All three render inside the same scroll container so a single user gesture moves through everything.

Scrolling rules are owned by Doc 15 §Theater Scrolling. Smart scroll on session-partition expansion is detailed in §Smart Scroll on Partition Expand below.

### Input area

The component that composes the writer's next message. Its internal shape depends on the active mode (Doc 23):

- Story: four fields (Doc 15 §User Input Fields).
- Handover: one field.
- Consulting: one field.

Aux slot UI is visible only when story is active. The Send button is a single component shared across modes; its enabled state depends on `isGenerating` and the active mode's input validity.

The input area is not a fixed height — it grows with content up to a cap (visual cap value provisional), then scrolls internally.

---

## Bubbles

A bubble is the rendered form of a single `messages` row. Two roles, two visual treatments.

### Story user bubble

Renders a `messages` row with `role = 'user'` and `kind = 'story'`. The content is `json_user` — parsed back into the four-field `UserContent` shape and rendered as a labelled stack:

- `[PLOT DIRECTION]` — body
- `[BACKGROUND INFORMATION — NOT FOR THE READER]` — body, dimmed
- `[MODIFICATORS]` — chip row
- `[CONSTRAINTS — DO NOT INCLUDE IN OUTPUT]` — body, dimmed

Empty fields are omitted from the rendered bubble (no empty section headers). Only `plot_direction` is required to send, so the other three may be absent.

Bubble background, alignment, and padding are ⚠️ provisional.

### Story AI bubble

Renders a `messages` row with `role = 'model'` and `kind = 'story'`. Content is plain text rendered as Markdown (subset owned by Doc 09).

Feedback (`user_feedback`), when present, is rendered as a compact single-line preview strip attached directly below the bubble (above the action row), with a 2px `--color-feedback` left border and `--color-feedback-subtle` background fill. The strip is click-to-edit — clicking replaces it with an inline textarea + Cancel / Apply buttons. When `user_feedback` is empty, no strip is rendered; the writer enters edit mode via the bubble's hover action row "Feedback" entry. Doc 28 owns the affordance fully — this section only states the visual placement contract.

Ghostwriter highlights are owned by Doc 17 — the AI bubble exposes a region container that Ghostwriter overlays its accent frame onto. While in Ghostwriter mode the bubble's content rendering is swapped from Markdown to plain text (so character offsets map directly to `messages.content`); the swap is local to the active bubble.

The Ghostwriter floating panel sits in the **Theater's right gutter** (the space between the active bubble's right edge and the right pane's left edge). It does not overlay the right pane. The panel is vertically pinned to the bubble's viewport range — its top never rises above the bubble's top, its bottom never drops below the bubble's bottom — and within that range it tracks the viewport so it remains visible while the bubble is on screen. Width `~300 px` ⚠️ provisional. See Doc 17 §Floating Panel for the full spec.

### Session bubbles (handover / consulting)

Same role distinction (user / model). Content is plain text. Visually framed inside their session partition (next section), not rendered standalone in the scroll surface.

Visual treatment differs from story bubbles only by the partition framing — the bubble shape itself is the same, allowing writers to read across modes without learning a new bubble grammar. ⚠️ Provisional: confirm this in visual design — there may be reason to differentiate further.

---

## Banners

The collapsible banner is a shared component used by **handover sessions, consulting sessions, and accordion segments**. Behavioural specification is owned by Doc 23 §Banners; this section captures the visual structure.

### Anatomy

```
┌──────────────────────────────────────────────┐
│  ▸  Consulting 2 · 14 messages          ⋯   │   ← banner row (collapsed state)
└──────────────────────────────────────────────┘
```

```
┌──────────────────────────────────────────────┐
│  ▾  Consulting 2 · 14 messages          ⋯   │   ← banner row (expanded — chevron rotates)
├──────────────────────────────────────────────┤
│                                              │
│  user bubble                                 │
│  model bubble                                │   ← partition body (framed)
│  …                                           │
│                                              │
├──────────────────────────────────────────────┤
│                          [ Enter ]  [ Exit ] │   ← bottom action row
└──────────────────────────────────────────────┘
```

### Variants

| Banner kind | Header label format | Bottom action row | Header button slot |
|---|---|---|---|
| Consulting | `Consulting N · M messages` | `[ Enter ]` / `[ Exit ]` | none |
| Handover | `Handover N · M messages` | same | none |
| Accordion (Doc 16) | `<chapter name> · <token impact>` | none | state-machine button (see below) |

Accordion banners differ from session banners in two ways:
- **No bottom action row** — accordion has no "enter" semantics; the chevron + button + right-click menu cover all operations.
- **A button slot in the header** that runs a state machine driven by the segment's state (see §Accordion Button Slot below).

### Header components

| Element | Detail |
|---|---|
| Chevron (`▸ / ▾`) | Rotates on collapse / expand |
| Name | Renameable (handover / consulting); read-only (accordion — owned by checkpoint name) |
| Meta | Live-updated (message count for sessions; token count for accordion) |
| Right-side button (`⋯`) | Opens the banner's context menu — same set as right-click |

### Affordances

| Action | Result |
|---|---|
| Click anywhere on banner row | Toggle collapse / expand |
| `[ Enter ]` button (expanded view) | Activate session (handover / consulting only) |
| `[ Exit ]` button (expanded view, when active) | Deactivate session, return to story mode |
| Right-click (or `⋯`) | Context menu: `Enter session` (handover / consulting; one-step entry — expands AND activates), `Rename`, `Delete session` |

The banner row's left and right edges align with the scroll-surface content area's left and right edges. Vertical padding ⚠️ provisional.

### Visual frame (expanded partition body)

A 1px border with a tinted background distinguishes the partition body from the surrounding story timeline. The colour token differs per banner kind — a future tokenisation pass will define `--color-partition-handover`, `--color-partition-consulting`, `--color-partition-accordion`. Until then the design uses the accent / subtle / surface tokens with per-kind tinting. ⚠️ All values provisional.

The frame's purpose is to make it unambiguous that content inside the partition is not part of the story timeline and is scoped to a different conversation.

### Active session emphasis

When a session is currently active (the user is driving it from the input area), its banner additionally has an accent-coloured left edge bar (`--color-accent`) running the height of the entire expanded partition. This makes "which session am I in" unambiguous when scrolling through multiple sessions.

---

## Partitions

A partition is the expanded form of a banner. It has three flavours; behavioural rules are owned by their feature docs.

### Handover partition

Owned by Doc 23. Inside the frame: ordered handover-session messages (user / model alternation) with the same bubble shape as story bubbles. The partition is collapsible to a banner.

### Consulting partition

Owned by Doc 23. Same shape as handover. Differs only in banner colour and header label.

### Accordion partition

Owned by Doc 16. The accordion banner sits at every checkpoint position. The banner represents the chapter that **starts** at this checkpoint (inverted from v1 — `name what comes next`).

Inside the partition (when expanded by chevron click):
- If the segment has no summary: the constituent message bubbles render normally (just like the surrounding story timeline, but bracketed by this banner above and the next checkpoint's banner below).
- If the segment has a summary: same — constituent bubbles. The summary lives behind the scenes; whether it's used in the API is governed by the `Use summary` toggle in the header.

Inside the partition (when collapsed by chevron click):
- The summary card replaces the bubbles: a framed body containing the stored summary text rendered as plain prose (not Markdown — `summary` is the author's narrative voice for the chapter, not formatted content). Collapse requires a summary; the chevron is disabled when `summary IS NULL`.

The two collapse states (`is_collapsed` for UI; `use_summary` for API) are exposed separately:
- **Chevron** drives `is_collapsed`.
- **Button slot in the header** drives `use_summary` — and runs the broader state machine described below.

#### Accordion Button Slot

The accordion banner's header carries a single button whose appearance and behaviour depend on the segment's state:

| Segment state | Button rendering | Click behaviour |
|---|---|---|
| Open segment (most-recent checkpoint, no `end_cp` yet) | None / hidden | — |
| Closed segment, `summary IS NULL` | Label `"Generate summary"` | Calls `summarise_segment` |
| Generating for this segment | Animated loading indicator | Cancels generation (silent) |
| Generating elsewhere | `"Generate summary"` greyed; tooltip `"Generation already in progress"` | — |
| `summary IS NOT NULL`, `is_collapsed = 0` | `"Use summary"` toggle, default ON | Edits `use_summary` |
| `summary IS NOT NULL`, `is_collapsed = 1` | Hidden (collapse forces fake-pair regardless) | — |
| Stale (`is_stale = 1`) on top of any of the above | Adds a `⚠` badge on the button | Right-click banner → `Re-summarise this chapter` |

The chevron is always present (when summary state allows); it's not part of this state machine.

#### Accordion banner naming

Default name = the checkpoint's `name`, which the user typed when creating it (or `"Chapter <N>"` suggestion). The start sentinel defaults to `"Chapter 1"`. Renaming via right-click → `Rename` opens an inline editor on the banner.

#### Accordion banner right-click menu

Per Doc 16:

| Action | Availability |
|---|---|
| `Summarise this chapter` | Closed segment with no summary |
| `Re-summarise this chapter` | Closed segment with summary |
| `Edit summary` | Segment with summary |
| `Summarise previous chapter` | Not on the start sentinel; summarises the chapter ending at this checkpoint (a discoverability shortcut for the most-recent-checkpoint case where "this chapter" is open and disabled) |
| `Re-summarise previous chapter` | Same as above, when previous segment has summary |
| `Collapse` / `Expand` | Mirrors chevron; available when segment has summary |
| `Rename` | Always |
| `Delete checkpoint` | Not on the start sentinel — triggers segment merge per Doc 16 |

#### Accordion stale badge

When `is_stale = 1`, a `⚠` badge appears on the button slot (and on the collapsed summary card's header strip). Tooltip on the badge: `"Content has changed since the last summary."` Re-summarising or manually editing the summary clears the badge.

#### Accordion token-impact label

The header's tail shows token information (⚠️ exact format provisional, owned by visual design phase):

- Closed segment, summary used: `· N tok saved`
- Closed segment, summary not used: `· ~M messages`
- Open segment (most-recent banner): `· M messages so far`

---

## Greying (consulting re-entry)

When a consulting session is re-entered with story messages after its entry point, those post-entry story messages are visually greyed out for the duration of the re-entered session. The implementation:

- Bubble opacity reduced to a ⚠️ provisional value (e.g. 0.4).
- A thin left-edge bar (`--color-text-muted`) runs the height of each greyed message group.
- A subtle banner above the first greyed message: `Hidden during this consulting session — exit to view`.

Greyed messages remain mounted (not unmounted) so the scroll position stays stable. They are not interactive — right-click context menus on greyed bubbles are disabled.

When the user exits the session, opacity returns to normal and the banner disappears.

---

## Smart Scroll on Partition Expand

When a session partition expands (banner click while collapsed) or grows (a new turn arrives in the active session), the scroll surface follows the rules in Doc 15 §Theater Scrolling, with the following session-specific adjustments:

- **Auto-follow during session generation** tracks the *active session's* output, not the absolute bottom of the Theater. If the active session has post-session story messages below it, those messages are pushed downward by the partition's growth, but the scroll surface follows the new content inside the partition, not the bottom.
- **"↓ New content" button** appears when auto-follow is paused. Clicking it scrolls to the most recent message in the active output context (story, when in story mode; the active session's most recent message, when in a session).
- **Banner click expansion** preserves the banner's vertical position on screen. The expanded body grows downward; the user does not have their scroll yanked when expanding a banner mid-Theater. (Implementation: capture the banner's `getBoundingClientRect().top` before the expand transition; restore it after.)
- **Banner click collapse** preserves the banner's vertical position similarly.

These scroll rules apply to handover and consulting partitions identically. Accordion partition expand/collapse is owned by Doc 16, but uses the same banner-position-preservation pattern.

---

## Empty States

The Theater renders an empty state when there are no messages in the active story:

- **No story selected.** Shell-level empty state — `<NoStorySelected />` per Doc 10. Owned by Doc 12.
- **Story selected, no messages.** A centred prompt: `Begin your story.` ⚠️ Provisional copy. Owned by Doc 12.
- **Story selected, messages exist, all greyed by an active consulting re-entry.** Active session's partition is visible at its entry position; nothing else is in focus. No additional empty state.

---

## Token / Cost Indicators

Per-bubble token counts: not displayed by default in v2.0. The Status section (Doc 15) shows the live total. ⚠️ Future enhancement: an inline token count under each AI bubble's metadata strip; left out of v2.0 to avoid clutter.

Cache-membership indicator: per the cached-message edit/delete protection rule (Doc 22), bubbles inside the cached prefix are eligible for the warning modal on edit/delete. v2.0 does **not** mark cached-vs-uncached visually on the bubble itself — the warning is the only signal. ⚠️ Open: the visual design phase may revisit this; a small marker on cached bubbles could surface the protection more proactively without being noisy.

---

## Interaction Affordances (cross-reference)

| Source | What |
|---|---|
| Doc 11 | Right-click menus on story bubbles, keyboard shortcuts |
| Doc 15 | Edit / regenerate / delete / cancel |
| Doc 16 | Accordion segment operations |
| Doc 17 | Ghostwriter selection, highlight, accept/reject |
| Doc 23 | Mode switcher, banner / partition operations |
| Doc 28 | Feedback strip + inline edit on AI bubbles |

This doc does not duplicate those — it ensures their visual surfaces compose cleanly inside the Theater regions defined above.

---

## Out of Scope

- Token-level visual values (specific hex, exact pixel sizes, font weights). Owned by Doc 08 and the visual design phase.
- Animation specifications (transition durations, easing curves). The visual design phase will tune.
- Mobile / touch layouts — desktop-only per Doc 10.
- Programmatic scroll-to-message (e.g. from a search feature). Out of scope for v2.0; future work.
- Per-bubble token-count display. Future enhancement.
- Visual marker for cached-vs-uncached bubbles. Open for visual design phase.

---

## Cross-References

- **Doc 08** — Design Tokens. Source of truth for colour, typography, spacing values.
- **Doc 09** — Component Library. Bubble component, Markdown rendering, common UI primitives.
- **Doc 10** — Layout and Navigation. Three-pane shell; mode switcher position.
- **Doc 11** — Interaction Patterns. Right-click menus and keyboard shortcuts on bubbles.
- **Doc 12** — Empty States. No-story-selected and no-messages prompts.
- **Doc 15** — Conversation Engine. Story bubble lifecycle, scroll rules, status section.
- **Doc 16** — Context Compression. Accordion segments and their banner usage.
- **Doc 17** — Ghostwriter. Highlight overlays on AI bubbles.
- **Doc 22** — Context Caching. Cached-message protection rule.
- **Doc 23** — Modes. Banner and partition behaviour spec.
