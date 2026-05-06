# 28 — Feedback

> **Status:** Complete
> **Last updated:** 2026-05-04 — first full design pass; per-bubble inline strip is the sole affordance (v1's right-pane Feedback Overlay dropped); always-visible single-line preview when non-empty, click to enter inline edit; explicit Apply + Cancel buttons (no auto-save on blur); `--color-feedback` triad introduced; Doc 11 Escape Chain priority 5; mode-gated to story bubbles only.
> **Scope:** The writer's persistent annotation on individual AI (model) messages in story mode. Feedback is shown inline below the bubble, edited in place, and consumed by Story-mode history assembly (injected on the model message it annotates) and Handover synthesis (Doc 23). This doc owns the affordance — the bubble strip, the edit interaction, the action-row entry, the visual treatment, and the keyboard / Escape-chain behaviour. It does **not** own the data field (Doc 03), the history-injection mechanic (Doc 15 §Feedback), the cached-message confirmation modal (Doc 22), or the accordion-stale rule (Doc 16).

Feedback is the writer's running commentary to the AI: *"this pacing felt rushed"*, *"more of the brother, less of the dog"*, *"keep this one — it's the voice I want"*. It persists indefinitely, attached to one specific AI message, and is appended to that message's content as `[WRITER FEEDBACK]\n…` on every future generation that includes the message in history. It is also a primary input to Handover synthesis (Doc 23). Feedback is the only surface in LOOM where the writer can speak *back* to the model about a specific past response without forking, deleting, or regenerating.

In v1.0 there were two affordances: a per-bubble inline box and a Control-Pane "Feedback Overlay" listing every feedback note in the active branch. v2.0 keeps only the inline affordance — the overlay is dropped (D-17 Q1). The overlay's loss is not tragic: feedback shows on the bubble itself, in story flow, and the writer scrolls.

---

## Where Feedback is Available

| Surface | Available |
|---|---|
| Story-mode AI bubbles (`kind = 'story'`, `role = 'model'`) | ✅ |
| Handover-session AI bubbles (`kind = 'handover'`) | ❌ |
| Consulting-session AI bubbles (`kind = 'consulting'`) | ❌ |
| User bubbles (any mode) | ❌ |
| Bubbles with `content_type = 'blocks'` (v2.1) | ❌ — deferred to v2.1; the strip and action are hidden |

Feedback is collected only on story-mode AI bubbles. Handover and consulting are session-bound and per-occasion; their value is in the session output, not in long-tail annotation. Doc 03 §"Feedback's load-bearing role" already documents this constraint; this doc carries the UI consequence.

---

## Affordance — The Inline Strip

Two states, in this order of priority on the bubble:

### When `user_feedback` is empty

No strip is rendered. The hover action row exposes a `Feedback` entry (icon: `lucide-react MessageSquare`, label: "Feedback"). Clicking it opens the strip directly into edit mode with an empty textarea.

### When `user_feedback` is non-empty

A compact strip is rendered immediately below the bubble (above the action row), always visible:

```
┌─────────────────────────────────────────────────────────┐
│  AI bubble content here…                                │
└─────────────────────────────────────────────────────────┘
  ▌ Pacing felt rushed in the second paragraph. Slow it…   ⚠️
  ─── action row on hover ───
```

- **Left border:** 2px `--color-feedback`.
- **Background:** `--color-feedback-subtle` (the `-subtle` triad value, ~6% alpha of the accent).
- **Text:** single line, truncated at the strip's right edge with ellipsis. Font: 12px, `--font-sans`, `--color-text-secondary`.
- **Click target:** the entire strip. Click → edit mode.
- **Cursor:** `text` over the preview text, `pointer` over the surrounding strip area, signalling "click to edit."
- **Width:** matches the bubble's max-width (Doc 27 §AI Bubble — 80% of Theater width).

The hover action row's `Feedback` entry is also present in this state. Clicking it has the same effect as clicking the strip — toggle into edit mode. The icon in the action row is tinted `--color-feedback` when feedback is non-empty (default tone otherwise) so the writer can spot annotated bubbles while scanning.

### Edit mode

Clicking the strip (or the action-row entry) replaces the strip with an inline editor:

```
  ╭──────────────────────────────────────────────────────╮
  │ Pacing felt rushed in the second paragraph. Slow it │
  │ down — give us the brother's reaction before the    │
  │ door slams.                                         │
  ╰──────────────────────────────────────────────────────╯
   Injected into AI context for future messages.
                                          [Cancel] [Apply]
```

- **Container:** padded box, 1px `--color-border`, 6px radius, `--color-bg-elevated` background.
- **Textarea:** `--font-sans`, 12px, `--color-text-primary`, no resize handle, `min-height: 40px`, auto-grows up to ~6 lines then scrolls.
- **Hint line:** 10px, `--color-text-muted`, fixed copy: *"Injected into AI context for future messages."* ⚠️ provisional.
- **Buttons:** `[Cancel]` (text button, secondary) and `[Apply]` (primary — `--color-accent` background, 11px). Right-aligned.
- **Saved confirmation:** on Apply success, the hint line briefly switches to *"Feedback saved"* in `--color-accent`, then the strip collapses back to display mode after ~1.2s. Saved value is now the strip's preview.

Only one feedback strip can be in edit mode at a time across the entire Theater. Opening edit mode on a second bubble auto-cancels the first (no implicit save — the first edit's unsaved value is discarded). This matches Doc 11's "one editor at a time" pattern.

---

## Save Semantics

**Explicit Apply only.** No auto-save on blur. The writer can type, scroll away, scroll back, and the in-progress text remains intact until they click Apply, click Cancel, press Esc, or open another bubble's feedback strip.

| Trigger | Effect |
|---|---|
| Apply button | `update_feedback(messageId, value.trim())` — empty string clears. Strip collapses to display mode (or is removed if cleared). |
| `Ctrl+Enter` / `Cmd+Enter` while focused in textarea | Same as Apply. |
| Cancel button | Discard in-progress edit. Restore strip to last-saved state (or remove strip if `user_feedback` was empty). |
| `Esc` while focused in textarea | Same as Cancel. (Doc 11 Escape Chain — see below.) |
| Open another bubble's feedback strip | Implicit Cancel on the first; no save. |
| Bubble disappears (deletion, world switch, lock) | Implicit Cancel; no save. The discarded value is **not** persisted. |

The "no auto-save on blur" rule is deliberate. Feedback influences every future generation that includes this message in history; an accidental commit during composition (writer ALT-tabs, clicks elsewhere to look something up, comes back) is a worse failure mode than a lost draft. Drafts of feedback are short-lived by design — the writer either commits the thought or abandons it.

There is no "discard changes?" confirmation modal. Feedback notes are short enough that the cost of an accidental Cancel is bounded; surfacing a modal here is more friction than the protection is worth.

---

## Action Row Entry

Every story-mode AI bubble's hover action row includes:

```
[ ✦ Ghostwriter ]  [ ◎ Feedback ]  [ ⟳ Revert ]  [ 🗑 Delete ]
```

(Per Doc 27 §AI Bubble; `Revert` only renders when `ghostwriter_history` is non-empty.)

The `Feedback` entry (icon: `MessageSquare`, label: "Feedback"):

- Default tone (`--color-text-muted` → `--color-text-primary` on hover) when `user_feedback` is empty.
- Tinted `--color-feedback` when `user_feedback` is non-empty.
- Click → toggle the inline strip into edit mode (or close edit mode if already open on this bubble).

The action row is hidden entirely on handover / consulting bubbles (no Feedback entry to hide separately).

---

## Mode-Gating and Co-Existence

### With Ghostwriter

While Ghostwriter is active on a bubble (any of `selecting`, `generating`, `reviewing` per Doc 17), the Feedback strip and action-row entry are hidden on that bubble. Reasoning: Ghostwriter swaps the bubble's content rendering to plain-text and overlays its frame; competing edit affordances on the same bubble would be visually noisy and semantically confused. Feedback returns when Ghostwriter exits.

A bubble's feedback **value** is preserved across a Ghostwriter cycle — it is data on the message, not state on the affordance. After Ghostwriter accept, the strip re-appears with the existing feedback unchanged. Doc 17's surgical-stitching protocol does not interact with `user_feedback` (the model is not asked to revise feedback; only the selected passage in `content` is replaced).

### With handover / consulting

The strip and action-row entry never render on handover / consulting bubbles (per the §Where table). A handover/consulting `messages` row has `kind != 'story'`; the bubble component branches on `kind` and omits the entire feedback surface.

### With cached-message protection (Doc 22)

A feedback edit is a stale-mutating operation on the message. If the message is at or before `cache_state.last_cached_message_id`, the cached-message confirmation modal (Doc 22 §Cached-message Edit/Delete Protection) intercepts the Apply action. On confirm, `update_feedback` proceeds and the cache is marked stale. On dismiss, the strip stays in edit mode with the writer's value untouched.

### With accordion segments (Doc 16)

If the message is inside a closed accordion segment, applying a feedback edit marks the segment stale (Doc 16 §Stale Triggers). Same trigger set as `update_message_content`.

---

## Multi-Bubble Discovery (out of scope)

v2.0 has no UI for "show me every bubble with feedback" or "list all feedback in this branch." The dropped Control-Pane Feedback Overlay (D-17 Q1) was the v1 surface for this; v2.0 considers it redundant given the always-visible strip. Reading the story scrolls past every annotation in branch order.

If a writer needs a cross-branch view of accumulated commentary, that is the job of Handover synthesis (Doc 23) — handover input is exactly "the writer's feedback distilled into a starting prompt for a fresh story."

This decision is reversible. If post-prototype telemetry or feedback shows writers needing the cross-branch view, a Settings → Story-tools-tab toggle resurrects the overlay. The data layer is unchanged either way.

---

## Visual Tokens

This doc introduces one new triad, following the Ghostwriter / Accordion / Checkpoint pattern.

| Token | Default ⚠️ | Where used |
|---|---|---|
| `--color-feedback` | `#f59e0b` | Strip left border; action-row icon when non-empty; "Feedback saved" momentary text optionally substituted with `--color-accent` per the saved-confirmation copy |
| `--color-feedback-hover` | `#fbbf24` | Hover state on the strip and action-row entry |
| `--color-feedback-subtle` | `rgba(245, 158, 11, 0.06)` | Strip background fill |

The default hex matches `--color-warning`, but the token is independent so writers can theme feedback distinctly per Doc 20 — *e.g.* a writer who relies on warnings for rate-limit copy and wants feedback to read as a softer, more "annotative" colour can override only `feedback_color` without disturbing `--color-warning`.

The triad is computed at runtime by `applyTheme(snapshot)` (Doc 20 §`applyTheme()` Contract) — the snapshot now carries `feedback` alongside `accent`, `ghostwriter`, `accordion`, `checkpoint`, `bubbleUser`, `bubbleAi`, `bodyFont`. Hover and subtle variants are derived from the base hex by the same accent-triad pipeline.

---

## Data Requirements

No schema delta. The field `messages.user_feedback TEXT` (Doc 03 §`messages`, line 110) already exists; v1.0 carries it forward unchanged.

One new app-settings key (per Doc 20 §World-overridable visual settings):

| Key | Type | Default ⚠️ | Scope | Notes |
|---|---|---|---|---|
| `feedback_color` | TEXT (hex) | `#f59e0b` | App + World (overridable) | Drives the `--color-feedback` triad via `applyTheme` |

Empty string semantics: `update_feedback(message_id, "")` clears the field to NULL. The strip and the action-row tint disappear; the action-row entry remains in default tone.

---

## Backend API

`update_feedback` is already specified by Doc 07 (`commands/conversation.rs`, line 118) and referenced by Doc 15 §Feedback. This doc adds no new commands.

| Command | Parameters | Returns | Errors |
|---|---|---|---|
| `update_feedback` | `message_id: String`, `feedback: String` | `()` | `LoomError::NotFound` if no such message; `LoomError::Validation` if the message is not story-kind (defence-in-depth — the UI hides the affordance, but the command refuses regardless) |

**Preconditions enforced server-side:**

1. The message exists and is `kind = 'story'`, `role = 'model'`. Reject otherwise.
2. If the message is at or before `cache_state.last_cached_message_id` for its story, the caller (the frontend) is expected to have cleared the cached-message confirmation modal first. The backend does not re-prompt; it marks the cache stale per Doc 22 stale-trigger rules.
3. If the message is inside a closed accordion segment, the backend marks the segment stale per Doc 16 §Stale Triggers.

`update_feedback` writes the field, recomputes any cache/segment stale flags, and returns. No event is emitted specifically for feedback — the frontend updates its local message list optimistically (the field is already in the loaded `ChatMessage`). Cache and segment stale events (`cache_state_changed`, `accordion_state_changed`) fire from their respective triggers.

---

## Frontend State

One new field on `workspaceStore`:

```ts
interface WorkspaceStore {
  // ...existing fields per Doc 06
  feedbackEditingMessageId: string | null;  // NEW
}
```

The field is observable so the Escape chain (Doc 11) and other features can read it. Setter actions:

```ts
beginFeedbackEdit(messageId: string): void;
  // If another bubble's edit is open, implicit cancel (discard).
  // Set feedbackEditingMessageId = messageId.

cancelFeedbackEdit(): void;
  // Clear feedbackEditingMessageId; the per-bubble component
  // resets its in-progress textarea value to the last-saved feedback.

commitFeedbackEdit(messageId: string, value: string): Promise<void>;
  // Calls update_feedback (with cached-message confirmation modal upstream
  // if applicable). On success, clears feedbackEditingMessageId.
```

The in-progress textarea **value** lives as local component state inside `<AiBubble>` — only the *fact* that this bubble is in edit mode is global. This minimises store traffic and avoids per-keystroke updates leaking through Zustand.

No new store. The `workspaceStore` already owns `isGenerating`, `activeStoryId`, `activeMode`, and other one-thing-at-a-time UI flags; this is consistent.

---

## Escape Chain (Doc 11)

The Escape chain priority is updated as part of CD-6 resolution. Final v2.0 priority order, lowest number wins:

1. Modal open → close modal
2. Settings full-surface open → `← Back`-equivalent (close Settings, restore previous mode)
3. Mode session active and end-confirmation pending → resolve confirmation
4. Ghostwriter active → cancel mode (Doc 17 §Phase-sensitive Escape)
5. **Feedback edit open → cancel edit (this doc)**
6. Editor (DocEditor) open with focus → blur (no save modal — Doc 18 spec'd auto-save)
7. Reader View open → exit (Doc 21 stub — deferred but reserved)
8. (no-op)

Feedback's slot at priority 5 is below Ghostwriter (4) so a writer in Ghostwriter `reviewing` phase who happens to also have a feedback edit open elsewhere — which can't actually happen, since opening Ghostwriter on the bubble forces feedback closed, and feedback is gated on story bubbles only — would still cancel Ghostwriter first. The slot is above editor-clean (6) so Esc inside the feedback textarea cancels the edit rather than blurring the underlying editor. Doc 11 §Escape Chain owns the canonical text; this section states the contract.

---

## Edge Cases and Error Handling

| Case | Behaviour |
|---|---|
| Apply with empty/whitespace value when feedback was previously non-empty | Treated as **clear** — `update_feedback(id, "")`. Strip is removed; action-row tint resets. |
| Apply with empty/whitespace value when feedback was already empty | No-op. The strip is closed; nothing is sent to backend. |
| Network / IPC failure on Apply | Toast: *"Couldn't save feedback — try again."* Strip stays in edit mode with the writer's value preserved. ⚠️ provisional copy. |
| Cached-message confirmation dismissed | Strip stays in edit mode, value preserved, no write. Equivalent to a Cancel that the writer didn't trigger themselves. |
| Bubble deleted while its feedback is in edit mode | Implicit cancel; no save; the message and its feedback row vanish together. |
| World switch / lock while feedback is in edit mode | `flushFeedback()` is **not** called — there is no auto-save. The in-progress edit is discarded. (Symmetric with Doc 18's `flushDocSave()` on lock, except that pattern saves; feedback discards.) |
| Two bubbles' action-row Feedback buttons clicked in rapid succession | Second click closes the first edit (implicit cancel) and opens the second. |
| Feedback value with markdown / code-fences / line breaks | Treated as plain text. The strip's preview escapes nothing visually — the truncated single line shows raw characters; the textarea preserves linebreaks. The model sees the raw value verbatim under the `[WRITER FEEDBACK]\n` tag. |
| Feedback length | No client-side cap. Practical limits: the textarea grows to ~6 lines visible then scrolls; backend writes the field as-is; tokens are counted by `get_token_count` for context budget warnings (the user_feedback gets folded into the model message's tokens at history assembly time). ⚠️ may add a soft cap during visual phase. |

---

## Out of Scope

- **Feedback list view across all bubbles in branch.** Dropped from v2.0 (D-17 Q1). v2.1 may resurrect via a Settings → Story-tools toggle that reveals a Control-Pane overlay; data layer needs no change.
- **Feedback on user bubbles.** v1 didn't have it; v2 doesn't either. The model already sees the user content verbatim — no commentary surface needed.
- **Feedback on handover / consulting bubbles.** Sessions are short-lived; feedback's value is in long-tail story annotation. If session messages need annotation in v2.1, that's a separate design.
- **Feedback on `'blocks'` (interleaved text + image) AI messages.** v2.0 doesn't render `'blocks'` in story mode (Doc 19); v2.1 adds it alongside image generation, and the feedback affordance will need to decide where the strip attaches — below the whole bubble or per-block. Deferred.
- **Markdown rendering inside the strip preview.** The truncated single-line preview is plain text. Multi-line formatted preview was considered and dropped — the strip is meant to be a glance-and-scan affordance, not a render surface.
- **Feedback diff / history.** Editing feedback overwrites the previous value. There is no `feedback_history` JSON column (unlike `ghostwriter_history`). v2.1 may add one if writers want to "see what I wrote before"; not in scope here.
- **Auto-save on blur.** Explicitly rejected (D-17 Q5). Feedback is too load-bearing for accidental commits to be acceptable.

---

## Cross-References

| Doc | What it owns |
|---|---|
| Doc 03 (Data Model) | The `messages.user_feedback` field; `feedback_color` app-settings key |
| Doc 06 (Frontend Architecture) | `workspaceStore.feedbackEditingMessageId` field |
| Doc 07 (IPC Contracts) | The `update_feedback` command signature |
| Doc 08 (Design Tokens) | `--color-feedback` triad token list |
| Doc 11 (Interaction Patterns) | Escape Chain priority 5 — Feedback edit cancel |
| Doc 15 (Conversation Engine) | History-injection mechanic (`[WRITER FEEDBACK]\n…`); the `update_feedback` store wrapper |
| Doc 16 (Context Compression) | Feedback edit on a closed-segment message marks the segment stale |
| Doc 17 (Ghostwriter) | When Ghostwriter is active on a bubble, this doc's affordance is hidden |
| Doc 20 (Settings and Themes) | `applyTheme(snapshot)` carries `feedback` in the snapshot; per-world override of `feedback_color` |
| Doc 22 (Context Caching) | Feedback edit on a cached message routes through the cached-message confirmation modal and marks the cache stale |
| Doc 23 (Modes) | Handover synthesis consumes accumulated feedback off story messages as a primary input |
| Doc 27 (Theater Composition) | The strip's placement below the AI bubble; bubble structure |
