# 30 — Marks (Mark as Important)

> **Status:** Implemented (Phase 14, 2026-05-24) — backend + frontend landed; runtime `/phase-verify` pending.
> **Last updated:** 2026-05-24 — §7 reconciled to the implemented mechanism: the preserve-clause is appended to the resolved summary SI at request-build time when marks are present (override-safe, zero-cost when no marks), not baked into the baseline prompt constants. Canonical clause wording updated to match `MARKS_PRESERVE_CLAUSE`.
> **Earlier:** 2026-05-23 — first full design pass (D-25). Sub-span "mark as important" annotations on story user/model bubbles; surfaced to summary AIs only (accordion, handover, future) as a per-message preserve-this manifest; dot indicator + in-place highlight; orphan-and-warn on host-message mutation; new `important_marks` table + `mark_color`.
> **Scope:** The writer's "mark as important" annotation on a *passage* inside a story bubble, and the mechanism that hands those passages to every summary AI with an instruction to preserve them. This doc owns the feature end-to-end: the create action, the storage contract (defined in Doc 03), the indicator, the in-place highlight, the summary-handoff format, the system-instruction clauses, and the orphan lifecycle. It does **not** own the data shape (Doc 03 §`important_marks`), the Selection Popup mechanism it plugs into (Doc 29), the accordion stale-trigger framework (Doc 16), the cache rules (Doc 22), or design-token values (Doc 08).

A mark is the writer saying *"whatever else gets compressed, keep this."* The writer selects a passage inside a story bubble — a line of dialogue, a plot fact, a name, a promise the story makes — and marks it important. From then on, every AI that **summarises** the story (accordion chapter summaries, handover synthesis, and any future summary feature) is handed the marked passages verbatim with an instruction to preserve them faithfully.

Marks are a **summary-time** signal only. They never enter a normal story or session generation — the model writing the next chapter does not see marks, and the story cache is never affected by marking. This keeps the feature cheap (zero cache churn) and tightly scoped: marks exist to survive compression, nothing else.

The entry point already exists. Doc 29's Selection Popup is a floating toolbar over a text selection whose action list was deliberately left open; **Mark important** is its first content action beyond Ghostwriter.

---

## 1. Scope

| Surface | Mark action | In-place highlight | Indicator dot |
|---|---|---|---|
| Story AI bubble (`kind='story'`, `role='model'`) | ✅ | ✅ offset-based (single text node) | ✅ |
| Story user bubble (`kind='story'`, `role='user'`) | ✅ | ⚠️ best-effort re-find (multi-field render) | ✅ |
| Session AI / user bubbles (handover, consulting) | ❌ | — | — |
| Bubbles with `content_type='blocks'` (v2.1) | ❌ | — | — |
| Compose `InputArea` / edit `<textarea>`s | ❌ | — | — |

**Why story bubbles only.** Marks exist to survive *story* compression. Accordion compresses story-kind messages; handover synthesises off story-kind messages and their feedback (Doc 03 §"Feedback's load-bearing role"). Session bubbles are short-lived and per-occasion — there is no summary feature that consumes them, so a mark on a session bubble would have nothing to feed. (If a future feature summarises sessions, marks extend to them additively — a new `kind` in the resolver, no structural change.)

**Both roles, unlike Feedback.** Feedback (Doc 28) is model-bubble-only because it is commentary *back to* the model. A mark is a *preserve-this* flag on content the writer cares about — and the writer's own input (a plot fact they wrote in `plot_direction`, a constraint) is just as worth preserving through compression as the model's prose. So marks apply to user bubbles too. The cost is the offset asymmetry in §5.

---

## 2. What a mark is

Storage is defined in **Doc 03 §`important_marks`** — this section states the contract, not the DDL.

A mark records:
- **`quoted_text`** — the verbatim selected passage. This is the **source of truth**: it is what the summary AI receives, and what the in-place highlight re-finds. Offsets are a convenience, never authoritative.
- **`note`** — an optional one-line writer annotation (e.g. *"pays off in the finale — keep"*). Rendered into the handoff manifest and shown in the indicator hover.
- **`char_start` / `char_end`** — character offsets into the host message's `content`. Present for AI bubbles (whose prose is a single text node, so a selection's offsets map 1:1 to `content` — the same assumption Ghostwriter and the Selection Popup already rely on, Doc 29 §6). **NULL for user bubbles** (rendered as multiple `<p>` across labelled fields — no single-string offset exists) and for orphaned marks.
- **`is_orphaned`** — set when the host message's content changes out from under the mark (§8).

The design choice that makes everything else simple: **`quoted_text` is authoritative, offsets are a hint.** Offsets break the instant the host text changes; the verbatim quote does not. So nothing load-bearing depends on offsets surviving an edit.

---

## 3. Creating a mark — the Selection Popup action

Marks are created through the Doc 29 Selection Popup. The popup already fires over a non-empty selection inside a story AI or story user bubble and resolves its actions from `(target, state) → SelectionAction[]`. Marks add one resolver entry:

| Action | Shown when | Behaviour |
|---|---|---|
| **✦ Mark important** | selection length ≥ 1 word, and the selection does **not** already fall entirely inside an existing mark | `add_mark(message_id, quoted_text, char_start?, char_end?)` then dismiss the popup |
| **Unmark** | the selection falls entirely inside exactly one existing mark | `remove_mark(mark_id)` then dismiss |
| **Edit note** | the selection falls inside exactly one existing mark | opens the note editor for that mark (§4) |

Offsets are taken from `SelectionTarget.offsets` (AI bubbles → `{start,end}`; user bubbles → `null`, so the mark stores `quoted_text` only). `quoted_text` is `SelectionTarget.text`. No new selection machinery — the popup, its observer, and its positioning are entirely Doc 29's.

`Mark important` is **not** gated by `isGenerating` — it is a pure DB write, no model call, safe to do mid-generation (contrast Ghostwriter, which is gated). Marking is allowed on any non-streaming story bubble (a streaming bubble has no `data-loom-selectable` wrapper, so the popup can't appear there anyway — Doc 29 §3).

---

## 4. The indicator — the dot

Every story bubble that has at least one mark renders a small **dot at its bottom-right corner**, in `--color-mark`. The dot is the uniform indicator across both roles (it sidesteps the user/AI highlight asymmetry — the dot works the same whether or not the passage can be highlighted in place).

**Hover** the dot → a popover listing that bubble's marks:

```
┌────────────────────────────────────────────┐
│ Marked important (2)                        │
│ • "The locket was her mother's, not her…"  │
│ • "He never learned to swim."              │
│   note: pays off in the finale — keep      │
└────────────────────────────────────────────┘
```

Each row shows the `quoted_text` (truncated) and its `note` if present. Rows offer **Edit note** and **Remove** affordances. The popover is the place to manage marks without re-selecting text in the bubble.

**Warning state.** When a bubble has one or more **orphaned** marks (§8), the dot switches to a warning treatment (warning tone, not `--color-mark`) and the hover popover flags them:

```
┌────────────────────────────────────────────┐
│ Marked important (1) · ⚠ 1 needs attention │
│ ⚠ "He never learned to swim." — the marked │
│   passage changed. Re-mark or remove.      │
└────────────────────────────────────────────┘
```

The warning persists until the writer re-marks the passage (a fresh, valid mark) or removes the orphaned one. This is the "indicator that something was marked here" + "warnings" surface, and the reason orphaned marks are kept rather than silently dropped (§8).

---

## 5. In-place highlight

Marked passages are painted in their bubble using the **CSS Custom Highlight API** (`new Highlight(range)` + `::highlight()`), the same no-DOM-mutation mechanism Doc 29 §7 / Doc 17 adopt for Ghostwriter. No `<span>` wrapping — the highlight does not fight React's reconciliation or break `pre-wrap` rendering.

- **Story AI bubbles** — the prose is one text node; build a `Range` from the stored `char_start` / `char_end` and paint. Clean and exact.
- **Story user bubbles** — no single-string offset (`char_start`/`char_end` are NULL). Highlight is **best-effort re-find**: search the rendered field text nodes for `quoted_text`; if exactly one match is found, paint it; if zero or ambiguous (multiple) matches, that mark falls back to **dot-only** (no highlight). Acceptable because marks orphan on edit anyway, and the dot still surfaces the mark.

The highlight uses `--color-mark-subtle` as its painted background so it reads as a persistent annotation distinct from the live `::selection` colour and from Ghostwriter's frame.

Orphaned marks are **not** highlighted (their passage no longer exists in the content) — they show only via the dot's warning state.

---

## 6. Delivery to summary AIs — the per-message manifest

This is the "hand the marked elements cleanly to the AIs" mechanism. It rides the existing history-assembly rail in `services/history.rs`, alongside feedback.

When a summary AI's request is assembled, each rendered message that has **non-orphaned** marks gets a `[MARKED IMPORTANT]` block appended after its content (and after any `[WRITER FEEDBACK]` block):

```
She turned the locket over. The locket was her mother's, not her sister's.
The metal was cold against her palm.

[MARKED IMPORTANT — PRESERVE FAITHFULLY]
- "The locket was her mother's, not her sister's."
- "He never learned to swim." (note: pays off in the finale — keep)
```

The mechanism is a single helper:

```rust
/// Render the `[MARKED IMPORTANT]` block for one message, or "" if it has no
/// non-orphaned marks. Mirrors `append_feedback` — pure string append, no model
/// call. Reused by every summary path.
pub(crate) fn render_marks(marks: &[ImportantMark]) -> String
```

called from **both** the user and model arms of `render_message_into` (so marks on user bubbles and AI bubbles are both delivered). The block is appended after `append_feedback` so the order within a model message is: content, then feedback, then marks.

### Where it applies

| Summary path | Marks delivered? |
|---|---|
| Accordion summarisation (`summarise_segment`) | ✅ — marks on the segment's messages are appended as the segment is rendered for the summarise call (Doc 16 §Summarisation Flow step 4 builds `contents` via `render_message_into`) |
| Handover synthesis | ✅ — handover renders story-up-to-entry via `render_message_into` (Doc 23) |
| Consulting | ✅ where it renders story history via `render_message_into`. Per Doc 22, a consulting session's prefix is frozen at entry via `entry_snapshot`; marks that exist at entry are baked into that rendered prefix. Marks added *after* entry do not retroactively change a re-entered session's frozen prefix (consistent with how post-entry accordion changes are frozen — Doc 16 §Accordion + Modes). |
| **Normal story send** | ❌ — never. Marks are summary-only. |
| **Normal session send** (the conversational turns, not synthesis) | ❌ |

### Why per-message (not a consolidated checklist or inline markers)

Three formats were considered (D-25):
- **Per-message manifest (chosen):** appends one block to each marked message, reusing the `append_feedback` rail. Keeps each marked passage local to its message (context preserved), scales to long handover inputs, and works identically for both roles. Smallest possible change to the assembly pipeline.
- *Per-segment consolidated checklist* — one block at the end of the whole rendered chapter. Cleaner single "handoff list" but loses which message each came from and doesn't fit the streaming append rail.
- *Inline markers* (`⟦IMPORTANT⟧…⟦/IMPORTANT⟧`) — pollutes prose mid-sentence and is the most fragile to render.

---

## 7. System-instruction clauses

The manifest is inert unless the summary AI is told to honour it. The clause is **appended to the resolved summary-persona system instruction at request-build time, only when the request actually carries at least one non-orphaned mark** — it is not baked into the baseline prompt constants. This is the implemented mechanism (`history.rs::append_marks_clause`, gated on `MarksLookup::is_empty()`), and it applies to all three summary personas whose SIs flow through history assembly:

- `prompt_accordion_summarise`
- `prompt_handover_seed`
- `prompt_consulting_seed`

Clause (canonical wording — owned here; the `MARKS_PRESERVE_CLAUSE` constant in `services/history.rs` is the implementation of this string):

> Some passages below appear under a "[MARKED IMPORTANT — PRESERVE FAITHFULLY]" heading. The writer flagged them as essential: preserve their substance — facts, names, commitments, and distinctive wording — in your output. If a note accompanies a marked passage, treat it as guidance on why it matters.

**Why dynamic append rather than editing the baseline constants (the earlier design).** The summary baselines currently ship empty (only `prompt_ghostwriter` carries a real baseline), and the clause is inert noise on every summary call that has no marks. Appending at build time (a) costs zero tokens when no passage is marked, and (b) is *override-safe* — a writer who has customised `prompt_accordion_summarise` still gets the clause, because it is concatenated onto whatever SI the cascade resolves, not embedded in a baseline they may have replaced. The trade-off the earlier design accepted (baked into the constant, lost on override — same contract as the Doc 16 fake-pair format) is therefore avoided entirely.

The manifest's `[MARKED IMPORTANT — PRESERVE FAITHFULLY]` heading string is the contract between §6 and the clause — it is `MARKS_HEADING` in `services/history.rs`, sits adjacent to `MARKS_PRESERVE_CLAUSE`, and must change with it.

---

## 8. Orphaning — when the host message changes

Marks anchor to verbatim text, and LOOM mutates message content (Ghostwriter accept rewrites a bubble; model-message edit; user-message edit). When a marked message's content changes:

1. For each of that message's marks, check whether `quoted_text` still occurs in the new content.
2. If it **no longer occurs** → set `is_orphaned = 1`, NULL its `char_start` / `char_end`.
3. If it still occurs → the mark stays valid; refresh `char_start` / `char_end` to the new position (AI bubbles only).

An orphaned mark:
- is **excluded** from the summary handoff manifest (§6) — it no longer reflects current content, so instructing the AI to preserve it would be wrong;
- is **not** highlighted (§5);
- flips the bubble's dot to the **warning** state with a hover explanation (§4);
- survives until the writer **re-marks** the passage (creating a fresh valid mark) or **removes** it.

This is the deliberate reconciliation of two requirements (D-25): *"the old record may be dropped, the writer re-marks"* (Q4) and *"the dot shows warnings"* (Q7). A silent hard-drop would leave nothing to warn about; orphan-and-warn preserves the writer's importance signal long enough for them to notice and act, while immediately removing its effect on summaries.

**Truncation vs in-place edit.** The two mutation classes differ:
- **Truncate-and-replace** (story user-message edit + regenerate, regenerate-last): downstream messages are *hard-deleted*; their marks vanish via `ON DELETE CASCADE` (Doc 03). No orphaning — the messages are gone.
- **In-place mutation** (Ghostwriter accept, model-message edit, user-message edit without regenerate): the row survives with new content; its marks are evaluated per the rule above (orphaned or re-anchored).

---

## 9. Interactions

### Accordion (Doc 16)

Adding, removing, or orphaning a mark inside a **closed** accordion segment marks that segment **stale** — its summary no longer reflects the current importance signal, so it should be regenerated to honour (or stop honouring) the mark. This is a new entry in Doc 16 §Stale Triggers.

Note the overlap: orphaning is *caused by* a content edit inside the segment, and content edits inside a closed segment already stale it (Doc 16). So the orphaning case is already covered transitively. The genuinely new triggers are **add-mark** and **remove-mark** without any content edit — those must stale the containing closed segment explicitly.

Marks do **not** trigger cache-stale on the story cache, because marks never enter a story send (§6) — the cached prefix's content is byte-identical with or without marks. (A summary regeneration triggered by mark-staling *can* in turn stale the cache, but that's the existing summary→cache rule, not a new mark→cache rule.)

### Cache (Doc 22)

No new cache triggers. Marks are summary-only; they are not part of any cached prefix. Consulting snapshots freeze marks-at-entry as part of the rendered prefix (§6) — no live mark mutation re-stales a frozen consulting cache.

### Ghostwriter (Doc 17)

Ghostwriter accept rewrites a model bubble's `content` in place → its marks are re-evaluated per §8 (re-anchored if `quoted_text` survives the rewrite, orphaned if not). Because Ghostwriter does surgical stitching (only the selected passage changes), a mark *outside* the rewritten passage re-anchors cleanly; a mark *on* the rewritten passage typically orphans. The Selection Popup is structurally suppressed while a bubble is in Ghostwriter mode (Doc 29 §3), so marks can't be created mid-Ghostwriter — they're created before or after.

### Feedback (Doc 28)

Independent and complementary. Feedback is whole-message commentary back to the model; a mark is a sub-span preserve-this flag for summaries. They render in distinct surfaces (feedback strip below the bubble vs. mark dot at the corner + in-line highlight) and use distinct colours (`--color-feedback` vs `--color-mark`). Both are appended to a model message at assembly time, in order: content → feedback → marks.

---

## 10. Backend API (`commands/marks.rs`)

```
list_marks(story_id: String) -> Result<Vec<ImportantMark>>
  // All marks for a story (both roles, including orphaned). Loaded alongside
  // messages on story open.

add_mark(message_id: String, quoted_text: String,
         char_start: Option<i64>, char_end: Option<i64>,
         note: Option<String>) -> Result<ImportantMark>
  // Validates: message exists and is kind='story'; quoted_text non-empty.
  // Stales the containing closed accordion segment if any.
  // Emits marks_changed.

remove_mark(mark_id: String) -> Result<()>
  // Stales the containing closed segment if any. Emits marks_changed.

update_mark_note(mark_id: String, note: Option<String>) -> Result<()>
  // Note edit only. Not a stale trigger by itself? — it IS: the note rides the
  // manifest, so a note change inside a closed segment stales it. Emits marks_changed.
```

Re-anchoring / orphaning (§8) is **not** a separate command — it is performed by the existing content-mutation commands (`update_message_content`, `edit_user_message`, Ghostwriter accept, regenerate) as part of their transaction. Those commands gain a "re-evaluate this message's marks" step. Cascade-on-delete is pure SQLite (`ON DELETE CASCADE`).

**Defence-in-depth:** `add_mark` rejects a non-story message with `LoomError::Validation` even though the UI only offers the action on story bubbles (mirrors `update_feedback`, Doc 28 §Backend API).

### Events

| Event | Payload | When |
|---|---|---|
| `marks_changed` | `{ story_id, message_id? }` | add / remove / note-edit / orphan / re-anchor |

The frontend's `workspaceStore` listens and re-fetches `list_marks` (or targets the one message when `message_id` is present). Re-anchoring/orphaning fired from a content-mutation command emits `marks_changed` in addition to that command's own events.

### Errors

| Variant | When |
|---|---|
| `LoomError::Validation` | empty `quoted_text`; non-story message; vault locked / no active story |
| `LoomError::NotFound` | unknown `mark_id` or `message_id` |
| `LoomError::Database` | DB failure |

---

## 11. Frontend state

Marks are story-scoped and load with messages — they belong on `workspaceStore`, not a new store (same reasoning as accordion in D-12 and feedback in D-17).

```typescript
interface WorkspaceStore {
  // ...existing fields...
  marks: ImportantMark[];                          // all marks for the active story

  addMark(messageId: string, quotedText: string,
          offsets: { start: number; end: number } | null,
          note?: string): Promise<void>;
  removeMark(markId: string): Promise<void>;
  updateMarkNote(markId: string, note: string | null): Promise<void>;
}
```

`loadStory` fetches `list_marks` alongside messages, drafts, and accordion state; `clear` resets `marks`. The `marks_changed` listener lives in the workspace events hook. Per-bubble rendering selects its marks with `marks.filter(m => m.message_id === id)` — the dot, the hover popover, and the highlight all read from this.

The mark-note editor's in-progress text is local component state (only the *fact* of which mark is being edited need be shared, if at all) — same minimise-store-traffic pattern as Doc 28's feedback textarea.

---

## 12. Visual tokens

One new triad, following the Feedback / Ghostwriter / Accordion / Checkpoint pattern (Doc 08, Doc 20).

| Token | Default ⚠️ | Where used |
|---|---|---|
| `--color-mark` | `#ec4899` | The indicator dot; could tint the Selection Popup "Mark important" action |
| `--color-mark-hover` | derived | Dot / popover hover states |
| `--color-mark-subtle` | derived | The in-place highlight background fill |

Driven by the `mark_color` setting (Doc 03), computed at runtime by `applyTheme(snapshot)` (Doc 20) — the snapshot carries `mark` alongside `feedback`, `ghostwriter`, `accordion`, `checkpoint`, etc. Hover/subtle variants derive from the base hex by the same accent-triad pipeline.

**Design constraint (for the visual phase):** `--color-mark` must read as visually distinct from `--color-feedback` (amber) and from `--color-warning` (red), because the *same dot* renders a warning state when a mark is orphaned (§4). `#ec4899` (rose) is a provisional placeholder chosen to satisfy this; the visual design phase sets the final value. Does **not** track the accent.

---

## 13. Interface impact

| Area | Change |
|---|---|
| Doc 03 | **Done (D-25):** `important_marks` table; `mark_color` app-setting + world override; `ImportantMark` interface; `mark_color` on `ResolvedSettings`; field-level invariant |
| Doc 29 | Add **Mark important / Unmark / Edit note** to the Selection Popup action resolver (the "open" action slot) |
| Doc 27 | Bubble structure: the bottom-right **mark dot** + hover popover; the in-place mark highlight on AI bubbles (CSS Custom Highlight API) |
| Doc 16 | New stale triggers: add-mark / remove-mark / note-edit / orphan inside a closed segment |
| Doc 08 | New `--color-mark` triad token list |
| Doc 20 | `applyTheme(snapshot)` carries `mark`; Settings → Features row for `mark_color`; the SI-clause is appended at request-build time (§7), not stored on the baselines |
| Doc 07 | New `commands/marks.rs` domain (4 commands) + `marks_changed` event |
| Doc 06 | `workspaceStore.marks` + 3 actions; `loadStory` fetch; `marks_changed` listener |
| Doc 17 | Cross-ref: Ghostwriter accept re-evaluates the message's marks (re-anchor / orphan) |
| New | `commands/marks.rs`, `db/marks.rs`, the `render_marks` helper in `services/history.rs`, the SI-baseline clause in `services/` constants |

These land in **Phase 14** (IMPLEMENTATION-PLAN). The schema half (Doc 03) is already amended; the rest is applied with the code in that phase.

---

## 14. Edge cases

| Case | Behaviour |
|---|---|
| Selection overlaps an existing mark partially | `Mark important` still offered; creates a second, overlapping mark. Both appear in the manifest and as (overlapping) highlights. No merge in v2.0. |
| Selection is exactly an existing mark | Resolver offers `Unmark` / `Edit note` instead of `Mark important` (§3). |
| Mark the entire bubble's text | Allowed — a mark whose span is the whole content. Degenerate but valid. |
| Same `quoted_text` appears twice in an AI bubble | Offsets disambiguate which instance is marked (AI bubbles store offsets). |
| Same `quoted_text` twice in a user bubble | No offsets — the re-find highlight is ambiguous → that mark is dot-only (§5). The manifest still carries the verbatim quote once. |
| Host message deleted (truncate or explicit) | Marks cascade-deleted (`ON DELETE CASCADE`). Dot vanishes with the bubble. |
| Ghostwriter rewrites the marked passage | Mark orphans (§8); dot warns; writer re-marks the new wording or removes. |
| Mark added while a summary is mid-generation | The in-flight summary used the prefix as it was at request build; the new mark applies to the *next* summary. Adding a mark stales the segment, so the writer is prompted to re-summarise. |
| Orphaned mark, writer never acts | Stays orphaned indefinitely; excluded from all handoffs; dot stays in warning state. Harmless. |
| `quoted_text` with newlines / markdown | Stored and emitted verbatim; the manifest quotes it as-is. The summary AI sees raw characters. |
| Very long marked passage | No client cap; counts toward the summary call's input tokens like any rendered content. ⚠️ may add a soft cap in the visual phase. |

---

## 15. Out of scope (v2.0)

- **Marks on session bubbles** (handover / consulting). No summary feature consumes them today; additive later.
- **Marks on `content_type='blocks'` bubbles** — deferred with Ghostwriter/Feedback to v2.1.
- **Marks influencing normal story/session generation.** Summary-only by design. Making the main story model weight marked text is a separate, cache-affecting feature.
- **Merging overlapping marks** — overlaps are allowed and kept distinct.
- **A cross-bubble "all marks in this story" panel** — the dots + hover are the v2.0 surface. (Analogous to Doc 28 dropping the feedback overlay.) Could return via a Settings toggle later; data layer needs no change.
- **Mark categories / colours per mark** — one `mark_color` for all marks in v2.0.
- **Re-anchoring an orphaned mark automatically** — the writer re-marks manually. No fuzzy re-match.
- **Marks in export** (Doc 21) — export is deferred to v2.0.x; whether marks annotate the exported text is that doc's call.

---

## Cross-References

| Doc | What it owns |
|---|---|
| Doc 03 (Data Model) | `important_marks` table; `ImportantMark`; `mark_color` key; `ResolvedSettings.mark_color` |
| Doc 06 (Frontend Architecture) | `workspaceStore.marks` field + actions |
| Doc 07 (IPC Contracts) | `commands/marks.rs` signatures; `marks_changed` event |
| Doc 08 (Design Tokens) | `--color-mark` triad |
| Doc 16 (Context Compression) | Accordion summarise consumes the manifest; mark-set change stales a closed segment |
| Doc 17 (Ghostwriter) | Accept re-evaluates the message's marks (re-anchor / orphan) |
| Doc 20 (Settings and Themes) | `applyTheme` carries `mark`; `mark_color` override; SI-clause on summary baselines |
| Doc 22 (Context Caching) | No new triggers; consulting snapshot freezes marks-at-entry in the rendered prefix |
| Doc 23 (Modes) | Handover / consulting synthesis render story history (and thus the manifest) via `render_message_into` |
| Doc 27 (Theater Composition) | Mark dot + hover popover placement; in-place highlight on the AI bubble |
| Doc 28 (Feedback) | Sibling annotation; distinct surface and colour; assembly order content → feedback → marks |
| Doc 29 (Selection Popup) | The create surface — `Mark important` is a resolver action |
