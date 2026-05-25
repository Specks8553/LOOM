# 16 — Context Compression (Accordion)

> **Status:** Complete
> **Last updated:** 2026-05-23 — D-25 (Marks): §Stale Marking gains a trigger — adding / removing / note-editing a "mark as important" (Doc 30) inside a closed segment marks it stale (the summary no longer reflects the importance signal). Marks also ride the summarise call: the segment's messages are rendered with their `[MARKED IMPORTANT — PRESERVE FAITHFULLY]` manifest (via `render_message_into`), and `prompt_accordion_summarise` gains a preserve-clause. Lands in Phase 14.
> **Earlier:** 2026-05-23 — D-24 collapse/summary addendum: collapse no longer requires a summary (collapse-without-summary is a pure visual fold — full bubbles still sent, zero token/cache impact); collapsed-but-unsummarised segments show a "summary needed" card that is itself a click-to-generate trigger; new per-banner **Collapse previous** control (additive to the chevron) lets the writer fold the chapter above without scrolling to its banner; summarising is **downward-only** — the "Summarise previous chapter" / "Re-summarise previous chapter" right-click actions are removed (a chapter is always summarised from the banner that owns it).
> **Earlier:** 2026-04-29 — first full design pass; checkpoints become banners (one banner per checkpoint); inverted naming ("name what comes next"); `is_collapsed` and `use_summary` decoupled; per-banner button-slot state machine; v1 fake-pair injection retained
> **Scope:** Compressing earlier chapters of a story into AI-generated summaries that replace the original messages in API history — reducing token consumption while preserving narrative context. The writer controls when to summarise, what gets collapsed, and can expand any segment to read the full text.

Accordion is LOOM's context-window-management feature. With branching removed in v2.0 the model is materially simpler than v1's: segments are linear, never fork-spanning, and a single `use_summary` flag on each segment drives history assembly. Banners are unified with the partition pattern from Doc 27.

---

## Core Concepts

### Checkpoint

A named position marker on the story timeline. Anchored to a specific story-kind message via `checkpoints.after_message_id`, with one exception: the **start sentinel**, which is auto-created on story creation, has `is_start = 1`, `after_message_id = NULL`, and represents "before any messages exist."

Checkpoints are user-named. **Naming convention is inverted from v1**: a checkpoint names the chapter that *begins* at this point, not the one that just ended. The start sentinel defaults to `"Chapter 1"` (renameable, never deletable).

### Segment

The run of messages between two consecutive checkpoints. A segment row in `accordion_segments` carries `(start_cp_id, end_cp_id)` and owns:
- The summary text
- The `is_collapsed` flag (UI state)
- The `use_summary` flag (API substitution decision)
- The `is_stale` flag (content-drift warning)
- Timestamps

A segment exists only when both endpoints exist. The "open segment" — the one that begins at the most recent checkpoint and runs to the story tail — has no row in `accordion_segments`. It comes into existence the moment a new checkpoint is created behind it.

### Fake-pair

When history assembly substitutes a segment, it does so with a synthetic user/model exchange:

```
User:  <prompt_accordion_fake_user — Developer-overridable>
Model: <accordion_segments.summary>
```

This pair is **never persisted** and **never rendered in the Theater**. It is reconstructed at request-build time only. The role-alternating shape matches what Gemini's API expects from `contents`.

The user prompt comes from `app_settings.prompt_accordion_fake_user` (Doc 03 — Developer-only, Restore-Default semantics). The model "answer" is the stored `accordion_segments.summary`.

### Trigger

User-triggered only. LOOM never auto-summarises and never auto-collapses.

---

## Banners

Every checkpoint renders as a banner in the Theater. The banner pattern is shared with handover/consulting partitions (Doc 27 — same chevron, click-to-toggle, right-click menu). Differences specific to accordion:

- **No "Enter" button** — accordion isn't a session.
- **A button slot** in the banner header that runs a state machine (see below).
- **Two collapse states** are surfaced in the banner — UI collapse (chevron) and summary-substitution (button-slot toggle).

### Banner button slot — state machine

The banner's header carries one button whose appearance and behaviour depend on the segment's state. (The "segment" associated with a banner = the segment that **starts** at this checkpoint, owing to inverted naming.)

| Segment state | Button | Click |
|---|---|---|
| No segment yet (open segment — most recent checkpoint) | None / disabled | — |
| `summary IS NULL`, segment closed (collapsed **or** expanded) | "Generate summary" | Calls `summarise_segment` |
| Generation in flight for this segment | Animated loading indicator | Cancels generation |
| Generation in flight elsewhere | "Generate summary" greyed; tooltip `"Generation already in progress"` | — |
| `summary IS NOT NULL`, `is_collapsed = 0` | "Use summary" toggle, default ON | Edits `use_summary` |
| `summary IS NOT NULL`, `is_collapsed = 1` | Toggle hidden (forced-on by collapse) | — |
| `is_stale = 1` (any of the above) | Plus a `⚠` badge | Right-click → re-summarise |

When a segment is **collapsed with no summary** (`is_collapsed = 1`, `summary IS NULL`), the body renders a "summary needed" card (see §Banner state matrix) and the button slot still offers "Generate summary". The "summary needed" card is **itself a click-to-generate target** — clicking it fires `summarise_segment`, the same as the header button — so the writer can summarise without first locating the header control. (This does not violate "never auto-summarise": generation is still an explicit click.)

The chevron is independent and toggles `is_collapsed`. It's always present — collapse no longer requires a summary (D-24).

### Collapse-previous control

Each banner additionally carries a **Collapse previous** control that folds the chapter *ending* at this checkpoint (the segment immediately above, owned by the previous checkpoint's banner). It is purely a remote control for that segment's `is_collapsed` — equivalent to clicking the previous banner's chevron, but reachable without scrolling up to it.

Its purpose is the summarise workflow: parked at the story tail, the writer clicks **Collapse previous** on the open-segment banner; the just-finished chapter folds to a single row, its owning banner snaps into view directly above, and the "summary needed" card (or "Generate summary" button) there is one click from generating. Summarising is always done *from the banner that owns the chapter* — never backward — which is why the old "Summarise previous chapter" right-click shortcuts are removed (see §Banner right-click menu).

Availability:
- **Hidden on the start sentinel** (no chapter above it).
- **Present and active on the open-segment banner** even though that banner's own chevron and button slot are inert (the open segment has no row) — this is the primary entry point for the workflow.
- There is no "collapse next" control; folding the chapter *below* a banner is what that banner's own chevron already does.

### Banner state matrix (`is_collapsed` × `summary` × `use_summary`)

| `is_collapsed` | `summary` | `use_summary` | Theater | API History |
|---|---|---|---|---|
| 1 | present | * | Summary card (bubbles hidden) | Fake-pair |
| 1 | NULL | * | **"Summary needed" card** (bubbles hidden) | **Full bubbles** |
| 0 | present | 1 | Expanded; bubbles visible; toggle ON | Fake-pair |
| 0 | present | 0 | Expanded; bubbles visible; toggle OFF | Full bubbles |
| 0 | NULL | * | Expanded; bubbles visible; "Generate summary" button | Full bubbles |

The two fields are stored independently; the OR-rule lives in history assembly and is **unchanged** by D-24:

```rust
let use_fake_pair = (segment.is_collapsed || segment.use_summary)
                 && segment.summary.is_some();
```

If `summary IS NULL`, fake-pair is impossible — so a **collapsed-but-unsummarised** segment still sends its full bubbles to the API. Collapse without a summary is therefore a **pure visual fold**: it declutters the Theater but saves no tokens and never touches the cache (the existing "chevron is UI-only" rule, see §Accordion + Cache Interaction, holds — and is now obviously correct, since collapse-no-summary changes nothing in the request). The Theater shows a "summary needed" card in place of the summary, signalling "folded, but still costing full context"; the button slot offers "Generate summary".

The only change from the prior design is the removal of the old guard: collapsing **no longer requires a summary** (D-24). The formula above is untouched.

### Banner naming

Each banner displays the name of the checkpoint it sits at. For the start sentinel that's `"Chapter 1"` by default. The name represents the chapter *starting* at this checkpoint.

Right-click → `Rename` opens an inline editor on the banner.

### Banner right-click menu

| Action | Availability |
|---|---|
| `Summarise this chapter` | When the segment starting here is closed (a later checkpoint exists) and has no summary |
| `Re-summarise this chapter` | When the segment starting here is closed and has a summary |
| `Edit summary` | When the segment starting here has a summary |
| `Collapse previous chapter` / `Expand previous chapter` | When this is not the start sentinel — mirrors the **Collapse previous** header control; folds/unfolds the segment **ending** at this checkpoint |
| `Collapse` / `Expand` | Mirrors the chevron; folds/unfolds the segment starting here (available regardless of summary state — D-24) |
| `Rename` | Always (renames this checkpoint) |
| `Delete checkpoint` | Available except on the start sentinel — triggers segment merge |

**Summarising is downward-only.** A banner only ever summarises the chapter that *starts* at it (the chapter rendered below it). There is no "summarise the chapter above" action — the old "Summarise previous chapter" / "Re-summarise previous chapter" shortcuts are removed (D-24). The replacement for the "I just finished a chapter, summarise it" flow is the **Collapse previous** control: from the open-segment banner at the story tail, fold the chapter above; its owning banner then sits directly above with its "summary needed" card (click-to-generate) or "Generate summary" button in reach. This trades the prior one-click shortcut for a single consistent rule (summary belongs to the owning banner) plus a declutter side-effect.

### Token impact display

Banner tail shows:
- Closed segment with summary collapsed: `Chapter 2 · 1,247 tok saved`
- Closed segment with summary, expanded: `Chapter 2 · ~12 messages`
- Closed segment collapsed with **no** summary: `Chapter 2 · ~12 messages · summary needed` (folded but still sending full content — no tokens saved)
- Open segment (most recent banner): `Chapter 5 · 8 messages so far`
- Stale: any of the above + `⚠`

Exact display values and visual treatment are ⚠️ provisional (Doc 27 / visual design phase).

---

## Segment Lifecycle

### Story creation

Auto-create the start sentinel. `is_start = 1`, `after_message_id = NULL`, `name = "Chapter 1"`. No `accordion_segments` row exists yet — the start sentinel's segment is open.

### User creates a checkpoint

Right-click an AI bubble → `Insert checkpoint here`. The user is prompted for a name (default suggestion: `"Chapter <N>"` where N is one more than the existing user-named chapter count). The checkpoint is created with `after_message_id = <that bubble's id>`.

If a previous checkpoint exists (always true except in the very-first-checkpoint case where only the start sentinel exists), an `accordion_segments` row is created:
- `start_cp_id = previous_checkpoint.id`
- `end_cp_id = new_checkpoint.id`
- `summary = NULL`, `is_collapsed = 0`, `use_summary = 1`, `is_stale = 0`

The segment that was open behind the previous tip of the story is now closed (this row represents it). A new open segment begins at the new checkpoint — it has no row.

### Inserting a checkpoint inside an existing closed segment

The user can right-click any AI bubble; if that bubble lies inside a closed segment (between two existing checkpoints), creating a new checkpoint splits the segment. The old `accordion_segments` row is deleted; two new rows are created with `summary = NULL`, `is_collapsed = 0`, `use_summary = 1`.

The old segment's summary is **lost**. (If the user wants to preserve it, they can `Edit summary` on one of the new segments first or decline the split — but there's no automatic preservation.)

If the old segment was collapsed and inside the cached prefix → cache marked stale.

Inserting a checkpoint inside a *collapsed* segment is theoretically possible but practically rare: the user would have to expand the segment first (the bubbles aren't accessible while collapsed). No special handling — the standard split rules apply once the user expands.

### Renaming a checkpoint

`UPDATE checkpoints SET name = ?` on the row. No segment changes. Not a stale trigger.

### Deleting a checkpoint (user-initiated)

Right-click → `Delete checkpoint` → confirmation modal:

```
Delete checkpoint "Chapter 2"?
Surrounding chapters will be merged.
This cannot be undone in v2.0.
[Cancel]  [Delete]
```

On confirm:
1. Find segments referencing this checkpoint as boundary (at most two: one `end_cp_id = this`, one `start_cp_id = this`).
2. Create a merged segment: `start_cp_id = previous segment's start_cp_id`, `end_cp_id = next segment's end_cp_id`, `summary = NULL`, `is_collapsed = 0`, `use_summary = 1`.
3. Delete the two old segment rows and the checkpoint row, all in one transaction.
4. If either old segment was collapsed and inside the cached prefix → cache stale.

The start sentinel cannot be deleted (`is_start = 1` is protected; the menu item is disabled).

### Cascading deletion (from message hard-delete)

Per Doc 15 §Cascading Deletion. When a message is hard-deleted:
- Checkpoints anchored to a deleted message are deleted.
- Segments referencing any deleted checkpoint as `start_cp_id` or `end_cp_id` are **deleted** (not merged).
- Segments whose range contains a deleted message (between their two checkpoints in chronological order) are deleted.

This rule is intentionally more aggressive than user-initiated checkpoint delete — message-delete cascade is a destructive action and the writer is already accepting structural disruption. Story integrity beats summary preservation here.

If any deleted segment was collapsed and inside the cached prefix → cache stale (the cached message warning from Doc 22 has already fired by the time deletion proceeds).

### Empty segments

A segment can become empty if all messages between its two checkpoints are hard-deleted but the checkpoints themselves survive (the deletion cascade only removes a checkpoint if its anchor message is deleted; if the deleted messages are entirely inside the segment range, the checkpoints remain).

Empty segments are allowed but **`Generate summary` is disabled** — the banner shows the segment's zero-message count, and right-click summarise actions are greyed.

The user can re-populate the segment (write more messages between the checkpoints — though in practice messages are only appended at the story tail), or delete one of the bracketing checkpoints to merge it away.

---

## Summarisation Flow

### Trigger

User clicks the banner's "Generate summary" button, clicks the "summary needed" card on a collapsed-unsummarised banner, or right-clicks → `Summarise this chapter`. The relevant segment is identified by `segment_id`.

### Pre-flight

1. Vault unlocked, story active.
2. `isGenerating = false` (no other generation in flight). If true: button greyed, tooltip `"Generation already in progress"`. Right-click action also blocked with the same tooltip.
3. Rate limiter check (`text` provider). If blocked: toast with reset time; abort.
4. Segment is closed (`end_cp_id` resolves to an existing checkpoint) and non-empty (`messages` rows exist between the endpoints). If not: action wasn't offered in the first place; pre-flight is paranoid.

### Request

```rust
#[tauri::command]
pub async fn summarise_segment(
    state: tauri::State<'_, AppState>,
    segment_id: String,
) -> Result<String, LoomError>
```

The backend:
1. Resolves the segment's start_cp and end_cp.
2. Loads all `kind = 'story'` messages between them, chronologically.
3. Resolves the cascade: `prompt_accordion_summarise` (Developer-overridable system instruction) and `gen_summarise_*` parameters (`temperature`, `top_p`, `top_k`, `max_output_tokens`).
4. Builds a Gemini request:
   - `system_instruction`: resolved `prompt_accordion_summarise`
   - `contents`: the segment's messages, rendered the same way as story history assembly (user turns as bracketed text, model turns with feedback appended)
   - `generationConfig`: the `gen_summarise_*` params
5. Calls Gemini's non-streaming `generateContent`. Sets `isGenerating = true` for the duration.
6. On success: writes `summary`, `summarised_at = now()`, clears `is_stale`, leaves `is_collapsed` and `use_summary` untouched (the user explicitly toggles those next).
7. Records token usage via the rate limiter.
8. Emits `accordion_state_changed` for the segment.

Streaming is not used. Summaries are short enough that a blocking response is fine and matches v1 behaviour.

### Cancellation

Clicking the loading indicator on the banner cancels the in-flight summarise via the same `CancellationToken` mechanism as story sends (Doc 15 §Cancellation Taxonomy). Silent cancellation — no toast. The segment's state reverts to whatever it was before the click.

### Failure

| Cause | Behaviour |
|---|---|
| HTTP error (4xx/5xx) | Toast `Couldn't generate summary. <error>` with "Show details" affordance |
| Rate limit hit | Pre-flight rejected; toast with reset time |
| Stream interruption / network drop | Same as HTTP error |
| Backend panic / IPC failure | Toast (error) |
| User cancel | Silent |

The segment's `summary` field is left at its previous value (NULL if first generation; previous summary if re-summarising). `is_stale` is unchanged.

### After summarisation

**No auto-collapse.** The summary is written; the user explicitly clicks the chevron (or right-click → `Collapse`) to collapse the segment when ready. v1's "Summary generated" toast is removed in v2 (writers prefer fewer toasts; the banner's button-slot transition from loading indicator to "Use summary" toggle is sufficient signal).

The "Use summary" toggle defaults to ON. If the user wants to leave the chapter expanded but skip fake-pair injection (the "(0,0)" matrix cell), they explicitly toggle it OFF.

### Generation Parameters

Summarisation has its own gen params, separate from conversation params, since fact-extraction generally wants lower temperature and shorter output:

| Key | Default | Notes |
|---|---|---|
| `gen_summarise_temperature` | `0.3` | Lower than conversation default (1.0) for less-creative output |
| `gen_summarise_top_p` | `0.95` | |
| `gen_summarise_top_k` | `40` | |
| `gen_summarise_max_output_tokens` | `2048` | Summaries are shorter than story output |

⚠️ Provisional defaults — verify empirically. World-overridable; same cascade as conversation params (`world settings → app_settings → hardcoded fallback`).

---

## History Assembly (Server-Side Substitution)

The backend's `services/history.rs` applies Accordion substitution during every story-mode and consulting-mode request build. Handover sends do not see Accordion substitution because handover is uncached and uses the raw story history directly — though logically the same algorithm could apply; v2.0 keeps handover assembly raw to maintain "writer wrote the analyst can see all of it" semantics.

### Algorithm (v2)

```rust
pub fn build_history_with_accordion(
    branch_messages: &[ChatMessage],   // chronological story-kind messages
    segments: &[AccordionSegment],     // all segments for this story
    checkpoints: &[Checkpoint],        // all checkpoints for this story
    settings: &ResolvedSettings,
) -> Vec<HistoryMessage> {
    let fake_user_prompt = settings.resolved("prompt_accordion_fake_user");

    let mut result = Vec::new();
    let mut injected_segments: HashSet<String> = HashSet::new();

    for msg in branch_messages {
        let segment = find_segment_for_message(msg, segments, checkpoints);

        let should_inject = match segment {
            Some(seg) if seg.summary.is_some()
                      && (seg.is_collapsed || seg.use_summary)
                      && !injected_segments.contains(&seg.id) =>
            {
                injected_segments.insert(seg.id.clone());
                true
            }
            _ => false,
        };

        if let Some(seg) = segment {
            if (seg.is_collapsed || seg.use_summary) && seg.summary.is_some() {
                if should_inject {
                    // Inject the fake-pair once per segment
                    result.push(HistoryMessage {
                        role: "user".into(),
                        text: fake_user_prompt.clone(),
                        segment_id: Some(seg.id.clone()),
                    });
                    result.push(HistoryMessage {
                        role: "model".into(),
                        text: seg.summary.clone().unwrap(),
                        segment_id: Some(seg.id.clone()),
                    });
                }
                // Skip this message — covered by the fake-pair
                continue;
            }
        }

        // Normal message — include with feedback if present (model turns only)
        result.push(build_history_message_with_feedback(msg));
    }

    result
}
```

`find_segment_for_message` walks `checkpoints` ordered by anchor `created_at` and locates the segment whose range contains the message. Returns `None` if the message is in the open segment (no row exists).

### Token counting with Accordion

`get_token_count` (Doc 15) builds the same assembled body and calls Gemini's `countTokens`. Returned `TokenEstimate` is post-substitution — i.e. the meter shows what's actually being sent. The Status section (Doc 15 §Status View) and the per-banner display together expose where the savings are coming from:

```
Status (right pane):  ~6,400 tok ready
                      Accordion: 3 chapters using summaries · ~12,000 tok saved
```

⚠️ Visual treatment provisional.

---

## Stale Marking

A segment is `is_stale = 1` whenever its underlying content drifts from what its summary describes. Triggers (all scoped to the segment whose range contains the changed message):

| Trigger | Source |
|---|---|
| Edit a user message inside the segment | Doc 15 §Editing |
| Edit a model message inside the segment | Doc 15 §Editing |
| Regenerate the last response, when the regenerated message is inside the segment | Doc 15 §Regenerating |
| Hard-delete a message inside the segment (without cascading the whole segment away) | Doc 15 §Deletion |
| Ghostwriter accept on a model message inside the segment | Doc 17 |
| Update feedback on a model message inside the segment | Doc 15 §Feedback |
| Add / remove / note-edit a mark on a message inside the segment | Doc 30 §Interactions — the manifest fed to a re-summary changed. (Orphaning a mark needs no separate trigger: it is caused by a content edit, which already stales the segment.) |
| Inserting a new checkpoint inside the segment | Doc 16 §Inserting a checkpoint inside an existing closed segment — note: this *splits* the segment rather than marking it stale; the new segments are born clean (no summary) |

A re-summarisation clears `is_stale` (writes a fresh summary). A manual `Edit summary` also clears `is_stale` — the user has just curated the summary themselves and implicitly accepted the current content as a baseline.

Stale segments still contribute to history assembly normally — they aren't excluded. The `⚠` badge is informational. If the writer wants the model to see fresh content, they re-summarise or toggle `use_summary` off.

---

## Accordion + Cache Interaction

Doc 22 owns the cache-stale rules in general; this section enumerates the accordion-specific triggers and ties them to the cached-message protection rule.

| Operation | Cache impact |
|---|---|
| Generate first summary | Cache stale **iff** the segment's range overlaps the cached prefix and `use_summary = 1` (default) — the prefix's substituted content is now different |
| Re-summarise existing summary | Same — cache stale iff segment is in cached prefix and `(is_collapsed OR use_summary)` |
| Manual `Edit summary` | Same |
| Toggle `use_summary` (either direction) | Cache stale iff the segment's range overlaps the cached prefix |
| Toggle `is_collapsed` (chevron) | UI-only — does NOT mark cache stale by itself, because `use_summary` is independent and unchanged |
| Create checkpoint that splits a segment in cached prefix | Cache stale iff the original segment was substituted (had `summary` and `is_collapsed OR use_summary`) |
| User-initiated `Delete checkpoint` (segment merge) | Cache stale iff either old segment was substituted in cached prefix |
| Cascade-from-message-delete (segments dropped) | Cache stale via the message-edit/delete protection rule (Doc 22) — already covered |
| Rename checkpoint | Not a stale trigger (display only) |

**Cached-message edit/delete confirmation** (Doc 22 §Cached-message Edit/Delete Protection) applies when **any** of the above operations would invalidate the cache. The dismissal proceeds, marks cache stale, and the next send rebuilds. Accordion ops feed this gate the same way story edit/delete does.

This closes TODO §O3 — fake-pair substitution is retained in v2; cache contents are deterministic given the segment state at build time.

---

## Accordion + Modes Interaction

| Mode | Accordion behaviour |
|---|---|
| Story | Full participation. Story sends use the substituted history. The cache prefix carries fake-pairs for substituted segments. |
| Handover | Substitution still applies — handover sends use the same `build_history_with_accordion` path against story-kind messages. Token cost is the only thing that differs from story sends (handover is uncached). |
| Consulting | Substitution applies at session creation: the entry snapshot captures the accordion state at that moment. Re-entry rebuilds the cache prefix using the **snapshot's** accordion state, not the current state — see Doc 22 §Session Snapshot. After re-entry, future toggles to story-mode accordion state (collapse/expand/summarise/etc.) do **not** affect this consulting session's cache (its prefix was frozen at session start). |

---

## Accordion + Ghostwriter Interaction

Per Doc 17, Ghostwriter edits a model bubble in-place and writes back via `update_message_content`. When the bubble is inside a collapsed segment, the user has expanded the banner first (otherwise the bubble isn't visible). Editing proceeds normally; on accept:

1. The model message's content is updated in DB.
2. The containing segment is marked `is_stale = 1`. (No toast — the banner's `⚠` badge is sufficient signal. v1's toast is removed in v2.)
3. If the segment overlaps the cached prefix and `(is_collapsed OR use_summary)`, cache marked stale via the cached-message edit/delete rule.

The user can then re-summarise via the banner button or right-click menu.

---

## User Flows

### Create checkpoint

1. Right-click an AI bubble → `Insert checkpoint here`.
2. Inline name input appears at that position; default suggestion `Chapter <N>`.
3. Confirm with Enter; cancel with Esc.
4. Banner appears at the message's position. If a previous checkpoint exists, the closing segment is created (with `summary = NULL`).

### Summarise a chapter

1. Click the "Generate summary" button on the banner of the chapter to summarise (or right-click → `Summarise this chapter`).
2. Button switches to animated loading indicator.
3. On success, button switches to "Use summary" toggle (default ON). Banner is unchanged otherwise (segment is **not** auto-collapsed). `is_stale = 0`.
4. To use less context now, click the chevron to collapse the segment. Bubbles disappear; banner shows summary card.

### Re-summarise a stale chapter

1. Right-click the banner → `Re-summarise this chapter`.
2. Button switches to loading indicator. Existing summary stays visible (if banner was collapsed) until the new one arrives.
3. On success, summary is replaced; `is_stale = 0`.

### Edit a summary by hand

1. Right-click → `Edit summary`. Inline editor opens with the current summary text.
2. User edits, confirms with Cmd/Ctrl+Enter or Save button; cancels with Esc.
3. On save: `summary` updated, `summarised_at = now()`, `is_stale = 0`. Cache stale rules apply.

### Toggle "Use summary" without collapsing

1. With segment expanded (chevron showing bubbles), click the "Use summary" toggle.
2. Toggle flips; cache may be marked stale.
3. Subsequent sends use the chosen path.

### Collapse / expand without changing API behaviour

1. Click the chevron — `is_collapsed` flips.
2. Theater re-renders (bubbles ↔ summary card, or ↔ "summary needed" card when no summary exists).
3. **No** cache change (because `use_summary` is independent and unchanged; and a collapse-without-summary changes nothing in the request). Subsequent sends behave identically.

### Fold a finished chapter and summarise it (the primary summarise workflow)

1. The writer is parked at the story tail (the open-segment banner).
2. Click **Collapse previous** on that banner. The chapter above (the just-finished one) folds; `is_collapsed = 1` on the segment that ends at this checkpoint.
3. That chapter's owning banner is now directly above, compact, showing a "summary needed" card.
4. Click the "summary needed" card (or the banner's "Generate summary" button) → `summarise_segment` fires.
5. On success the card becomes a real summary card; the segment is **not** auto-collapsed-with-summary beyond the fold already applied, and `use_summary` defaults ON, so the next send substitutes the fake-pair. (Folding earlier saved nothing; summarising is what actually reduces tokens.)

### Delete a checkpoint

1. Right-click → `Delete checkpoint`. Confirmation modal.
2. On confirm: surrounding segments merge into one with `summary = NULL`. The merged banner takes the previous segment's start checkpoint as its position and name.

---

## Backend API (`commands/accordion.rs`)

```
get_accordion_state(story_id: String)
    -> Result<AccordionState>
  // Returns checkpoints + segments for this story.

create_checkpoint(story_id: String, after_message_id: String, name: String)
    -> Result<Checkpoint>
  // Inserts a new checkpoint and creates / splits segments accordingly.
  // Emits accordion_state_changed.

rename_checkpoint(checkpoint_id: String, name: String) -> Result<()>

delete_checkpoint(checkpoint_id: String) -> Result<()>
  // Forbidden if is_start = 1. Merges surrounding segments. Cascades cache
  // stale via the cached-message edit/delete rule (Doc 22).

summarise_segment(segment_id: String) -> Result<String>
  // Non-streaming Gemini call. Returns the summary text (also persisted).
  // Emits accordion_state_changed on success or failure.
  // Cancellable via cancel_generation (the same global cancel mechanism
  // used by story sends — see Doc 15).

update_segment_summary(segment_id: String, summary: String) -> Result<()>
  // Manual edit. Sets is_stale = 0, summarised_at = now().

set_segment_collapsed(segment_id: String, collapsed: bool) -> Result<()>
  // UI-only state. Does NOT mark cache stale. Valid regardless of summary
  // presence (D-24): collapsing a segment with summary IS NULL renders the
  // "summary needed" card and leaves the API request unchanged (full bubbles).
  // The "Collapse previous" banner control calls this on the segment ending at
  // the clicked checkpoint; no separate command is needed.

set_segment_use_summary(segment_id: String, use_summary: bool) -> Result<()>
  // Marks cache stale if the segment is in the cached prefix.

clear_segment_summary(segment_id: String) -> Result<()>
  // Clears summary, summarised_at, is_stale. Resets is_collapsed = 0,
  // use_summary = 1. Cache stale if segment was substituted in cached prefix.
```

`cancel_generation` (Doc 15) cancels whatever generation is in flight — story turn, session turn, or summarise. There is no separate `cancel_summarise`.

### Events

| Event | Payload | When |
|---|---|---|
| `accordion_state_changed` | `{ story_id, segment_id?, checkpoint_id? }` | Any of: checkpoint create/rename/delete, segment summary write/clear/edit, collapse/use_summary toggle, stale flag change |

The frontend's `workspaceStore` listens and re-fetches `get_accordion_state` to re-render banners. The payload's optional IDs let the listener target a specific banner instead of full re-render when desired (optimisation).

### Errors

| Variant | When |
|---|---|
| `LoomError::Validation` | Vault locked, story not active, segment empty (summarise), generation in flight |
| `LoomError::RateLimited` | Rate limit hit during summarise |
| `LoomError::ApiError` | Gemini 4xx/5xx during summarise |
| `LoomError::Database` | DB failure |
| `LoomError::NotFound` | Stale checkpoint_id or segment_id |
| `LoomError::ProtectedSentinel` | Attempt to delete the start sentinel |

---

## Frontend State

Per Q11 (this design session): merged into `workspaceStore`, not a separate store. Segments and checkpoints are story-scoped and load alongside messages.

```typescript
interface WorkspaceStore {
  // ...existing fields...
  checkpoints: Checkpoint[];                  // ordered by anchor created_at; start sentinel first
  segments: AccordionSegment[];               // closed segments only; open segment has no row

  // actions
  createCheckpoint(afterMessageId: string, name: string): Promise<void>;
  renameCheckpoint(id: string, name: string): Promise<void>;
  deleteCheckpoint(id: string): Promise<void>;
  summariseSegment(segmentId: string): Promise<void>;
  updateSegmentSummary(segmentId: string, summary: string): Promise<void>;
  clearSegmentSummary(segmentId: string): Promise<void>;
  setSegmentCollapsed(segmentId: string, collapsed: boolean): Promise<void>;
  setSegmentUseSummary(segmentId: string, useSummary: boolean): Promise<void>;
}
```

`loadStory` is extended to fetch `get_accordion_state` alongside messages and drafts; `clear` resets these arrays.

Listener for `accordion_state_changed` lives in the workspace events hook; on payload it re-fetches the affected items (or the whole `accordion_state` if the payload lacks specifics).

---

## Edge Cases and Error Handling

| Scenario | Behaviour |
|---|---|
| User creates a checkpoint at the very tail of the story (after the most recent AI bubble) | Closes the previous open segment; creates a new (immediately-empty) open segment behind the new checkpoint. Banner appears at the tail. |
| Two checkpoints created back-to-back with no messages between | The first segment (between them) is empty. `Generate summary` disabled on the first banner. Allowed; the user can add messages later. |
| Cascade-from-delete leaves a story with no checkpoints except the start sentinel | All segments dropped; back to a one-checkpoint story. Existing summaries lost. |
| User toggles `use_summary` off on every segment | History assembly returns to fully raw; cache rebuilds the next send with the full prefix. |
| User clicks "Generate summary" twice rapidly | Second click no-ops if the first set `isGenerating = true` (button is now the loading indicator). |
| Summarise call returns extremely short / empty text | Stored as-is. Banner shows the summary; user can manually edit if dissatisfied. |
| Summarise call returns text exceeding `gen_summarise_max_output_tokens` (Gemini truncated) | Stored as truncated text. `finish_reason = MAX_TOKENS` is logged but not surfaced as an error. ⚠️ Open: visual treatment for truncated summaries (banner badge?) — defer to design phase. |
| `prompt_accordion_summarise` was edited to invalid content by the user | Gemini may produce odd output. Settings → Developer has Restore Default; user is responsible. |
| App close mid-summarise | Backend cancels via Drop on AppState. Summary not persisted. |
| Vault lock mid-summarise | Same as story stream: lock awaits / cancels generation. |
| Two consecutive collapsed segments | Stack vertically; history assembly injects two fake-pairs in order. Standard rendering. |

---

## Out of Scope

- **Auto-summarisation** — never. Always user-triggered.
- **Auto-collapse on summarise success** — never. Always a separate explicit step.
- **Cross-segment summary stitching** — segments are independent; summaries don't reference each other.
- **Segment-of-segments / hierarchical accordion** — flat structure only. v2.1 may revisit.
- **Per-segment generation parameter overrides** — the gen_summarise_* keys apply globally.
- **Restoring old summaries when a segment is split** — old summary is lost; user re-summarises.
- **Searching summaries** — out of scope for v2.0.
- **Read-aloud / TTS of summaries** — Doc 21 / Doc 19 territory.
- **Visual treatment of truncated summaries** — defer to visual design phase.

---

## Cross-References

- **Doc 03** — `accordion_segments`, `checkpoints` schemas; `gen_summarise_*` settings keys; `prompt_accordion_*` developer settings.
- **Doc 06** — `workspaceStore` extension for segments and checkpoints.
- **Doc 07** — IPC contracts: `commands/accordion.rs` and the `accordion_state_changed` event.
- **Doc 11** — Right-click menus on AI bubbles, checkpoint banners.
- **Doc 15** — One-in-flight `isGenerating` rule (covers summarise); cascading deletion; feedback as a stale trigger.
- **Doc 17** — Ghostwriter accept marks containing segment stale.
- **Doc 22** — Cache stale-trigger rules; cached-message edit/delete protection; consulting session snapshot freezes accordion state at session creation.
- **Doc 23** — Mode interaction: handover and story sends use Accordion substitution; consulting uses snapshot-frozen accordion state.
- **Doc 27** — Banner visuals (chevron, button slot, name, token-impact display, `⚠` stale badge).
- **Doc 30** — Marks. The summarise call renders each message with its `[MARKED IMPORTANT]` manifest; mark-set changes inside a closed segment are a stale trigger.
