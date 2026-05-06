# 15 — Conversation Engine

> **Status:** Complete
> **Last updated:** 2026-05-04 — Feedback design pass (D-17): §Feedback now points at Doc 28 for the affordance ("Doc 11 owns the affordance" → "Doc 28 owns the affordance"); narrowed scope note that the field is collected on story-kind model messages only.
> **Earlier:** 2026-04-29 — Doc 16 design pass: `isGenerating` documented as the single global flag covering story turns, session turns, **and** accordion summarisation
> **Earlier:** 2026-04-29 — Doc 23 design pass: cached-message edit/delete protection cross-referenced; session-message edit/regenerate behaviour distinguished from story-message behaviour
> **Earlier:** 2026-04-28 — initial draft from Doc 15 design session

The core mechanic of LOOM: how the writer's input becomes a Gemini request, how the response streams back, how messages are edited and deleted, and how the engine stays out of the writer's way.

This doc is the spine of v2.0. Modes (Doc 23) layer on top by varying the persona and conversation type; Context Caching (Doc 22) and Accordion (Doc 16) optimise the request assembly. Everything in those docs assumes the engine described here.

---

## Decided: No Branching (D-05)

Messages form a **linear list** — no DAG, no `parent_id`, no Recursive CTE. Editing a user message truncates everything after it and regenerates from there. This is the single largest simplification over v1.0; it eliminates sibling navigation, the Branch Map, fork-spanning Accordion, and most of v1.0's history-assembly complexity in one stroke.

---

## Overview

The writer types into a four-field input area, presses Send, and watches a streamed prose response appear. Behind the scenes:

1. The frontend sends `(story_id, draft)` to the backend.
2. The backend assembles the full Gemini request — system instruction, history with feedback, attached source documents, current user turn, optional aux slot, generation parameters.
3. The backend opens an SSE stream to Gemini, emits `message_chunk` events to the frontend per chunk, persists the final message, and emits `message_complete`.
4. The frontend renders chunks into the AI bubble as they arrive.

The frontend never assembles history. The Rust backend is the only thing that knows the full request shape.

---

## Message Model

The story is a chronological list of `messages` rows ordered by `created_at`. Each user turn is followed by exactly one model turn (an "exchange"). Soft-deleted messages (`deleted_at IS NOT NULL`) are excluded from history assembly and Theater rendering — but in v2.0 deletion is immediate hard-delete, so `deleted_at` is reserved for v2.1.

### Content types

The `messages.content_type` discriminator decides how `content` is parsed:

| `content_type` | When | Parse as |
|---|---|---|
| `json_user` | User turns | JSON-serialised `UserContent` (see Doc 03) |
| `text` | Model turns | Plain prose (Markdown-rendered in Theater) |
| `blocks` | Reserved for media | JSON `MessageBlock[]` — deferred to Doc 19 |

In v2.0, all live messages are `json_user` (user) or `text` (model). The `blocks` form is reserved for the media work in Doc 19.

### Story-only history

`messages.kind = 'handover'` rows live on the timeline for display and export, but **are skipped during story-mode history assembly**. Doc 23 owns the handover model.

---

## User Input Fields

Four fields. The first is required to send; the rest are optional decorations on the request.

### Plot Direction (required)

The primary instruction for this turn. What the writer wants to happen, what the model should write next. Shown as the largest input field. Send button is enabled iff this field is non-empty (after trim).

### Background Information

Context the model should know but that the reader should not see directly. Useful for hidden character motivations, off-page world details, "the model should know X but not explicitly write it."

### Modificators

A list of short style/tone words or phrases that inform how the model writes the next turn (e.g. `noir`, `tight pacing`, `present tense`). Stored as `string[]` on `UserContent`.

**Input behaviour.** Free-text entry with comma-as-delimiter — typing `,` (or pasting comma-separated text) closes the current tag and starts a new one. Each closed tag renders as a chip. `Backspace` at the start of the input field deletes the chip immediately to its left; `Delete` at the end of the input field removes the chip to its right. No suggestions, no autocomplete, no recall.

**No persistence beyond the turn.** There is no modificator catalogue, no recent-tags list, no Settings home. Tags exist only in (a) the in-flight draft (auto-saved per §Drafts) and (b) sent message history (§History Assembly). Each new turn starts with an empty modificator list.

*Not represented in Doc 20 (Settings) — modificators have no app- or world-level configuration surface.*

### Constraints

Per-turn directives the model must obey but that should never appear in the output prose. Example: "no dialogue this turn," or "keep this scene under 300 words." Different from Modificators (per-turn style tags, no persistence) and from Aux slots (persistent guidance) — Constraints are one-shot, scene-specific.

> **No output-length field.** The v1.0 output-length preset (`short / medium / long / very_long`) is removed in v2.0. Writers who want to nudge length use Constraints (`"write a long scene"`) or set an aux slot with length guidance. Generation parameters (Doc 20 → Settings → Gemini) include `gen_max_output_tokens`, which is the upper bound but not a request-time directive.

### Drafts

The four fields are auto-saved (debounced ~1 s after last keystroke) to `story_state.draft`. Drafts:

- Are story-scoped (each story has its own draft).
- Survive vault lock and app close (they live in the encrypted DB).
- Are loaded when the story is opened.
- Are cleared on successful send (`finish_reason = STOP`).
- Are cleared by the writer manually if they choose ("Clear" affordance — Doc 11 detail).

The lock command awaits any pending debounced draft write before zeroing keys, so no draft is lost on lock.

---

## Sending a Message

### Frontend → Backend flow

The frontend calls `send_message(story_id, draft)`. The `draft` is a `UserContent` value. Everything else — model name, system instruction, attached docs, aux slot content, generation parameters — is read by the backend from settings cascade and `story_state`.

The backend:

1. Validates preconditions (vault unlocked, story exists, no generation in flight, rate limit not exceeded).
2. Persists the user message (`messages` row, `content_type = 'json_user'`, content = JSON-serialised draft).
3. Resolves the settings cascade: model name, generation parameters, mode SI, aux slot content, attached context docs.
4. Loads the full message history for this story (chronological, excluding `kind = 'handover'`).
5. Assembles the request body.
6. Opens an SSE stream to Gemini, emitting `message_chunk` events as chunks arrive.
7. On `finish_reason`, persists the model message (`content_type = 'text'`, accumulated content, token count, finish reason) and emits `message_complete`.
8. Marks any active context cache stale-or-not depending on what changed (Doc 22 owns this).
9. Clears `story_state.draft` (when `finish_reason = STOP`).

### History Assembly (server-side only)

This is the load-bearing wall from CLAUDE.md §Architecture rule 1: **the frontend never touches history.** The backend reconstructs the linear message list, injects feedback into model messages, substitutes Accordion segments with their fake-pair (Doc 16), and assembles the complete Gemini API request.

The assembled history is the chronological list of all `messages` for this story where:

- `deleted_at IS NULL` (always — reserved for v2.1)
- `kind = 'story'` (handover messages are excluded)

Ordered by `created_at`.

For each historical message:

- **User turns:** `content_type = 'json_user'` content is parsed back into `UserContent`, then re-rendered as the same bracketed text format used at send time (`[PLOT DIRECTION]\n…\n\n[BACKGROUND INFORMATION — NOT FOR THE READER]\n…\n\n[MODIFICATORS]\n…\n\n[CONSTRAINTS — DO NOT INCLUDE IN OUTPUT]\n…`). Past constraints stay in history — they describe what the writer wanted at that historical point, and the model already complied (or didn't); preserving them keeps the record honest.
- **Model turns:** if `user_feedback` is non-empty, append `\n\n[WRITER FEEDBACK]\n<feedback>` to the content. Feedback persists indefinitely; it influences every future generation that includes this message in history.

### Aux Slot Injection

The active aux slot (per `story_state.active_aux_slot`, content from settings cascade) is **prepended to the current user turn**, with an explicit delimiter so the model sees a clean boundary:

```
[AUX — ALWAYS APPLY]
<aux content>

[USER]
[PLOT DIRECTION]
...
[BACKGROUND INFORMATION — NOT FOR THE READER]
...
[MODIFICATORS]
...
[CONSTRAINTS — DO NOT INCLUDE IN OUTPUT]
...
```

Aux is **not stored in the message row**. Only the user's `UserContent` is persisted. On the next turn, history assembly reads the bare user content from DB; the active aux slot (which may have been switched in the meantime) is freshly prepended to the new turn.

This trades token cost (aux is paid for every turn) for adherence (aux is at the most recent position) and cache stability (switching slots does not invalidate the cached prefix because aux lives outside it). See Doc 22 for the cacheable-prefix definition.

### Gemini Streaming

The backend uses the Gemini `streamGenerateContent` SSE endpoint. Each chunk emitted by Gemini is forwarded immediately as a `message_chunk` Tauri event — **no buffering** (writers experience streamed prose as fluid only when chunks arrive at their natural cadence). On the final chunk Gemini supplies a `finishReason`; the backend persists the message and emits `message_complete`.

Cancellation is handled via a `tokio_util::CancellationToken` registered on `AppState` for the duration of the request. Cancelling the token aborts the SSE read and closes the HTTP connection (avoiding the v1.0 issue where dropping the reqwest stream did not actually cancel the connection).

### Token Counting

`get_token_count(story_id, draft) -> TokenEstimate` pre-flights a token count for the input area meter. The backend assembles the same request that `send_message` would (history + docs + user turn + aux + system instruction) and calls Gemini's `countTokens` endpoint. Returns:

```typescript
interface TokenEstimate {
  history_tokens: number;
  doc_tokens: number;
  user_turn_tokens: number;
  total: number;
}
```

The frontend debounces calls (≈500 ms after last keystroke). The estimate is shown in the Status section (right pane) and in the collapsed Status bar.

> **Open UI placement:** the exact location and visual treatment of the token meter is a TODO for the visual design phase. See `TODO.md`.

---

## Bubble Lifecycle

The Theater renders messages as bubbles. Their appearance and persistence rules:

| Phase | User bubble | AI bubble | Notes |
|---|---|---|---|
| Send clicked, message persisted | **Appears immediately** (optimistic) | — | Local DB write before HTTP |
| Pre-flight pass + HTTP request opened | shown | — | "Preparing" / "Thinking" in Status |
| First chunk received | shown | **Appears** (empty, fills as chunks arrive) | Trigger |
| Streaming continues | shown | growing | Auto-follow scroll engaged |
| `finish_reason = STOP` | shown | shown (final) | Success — draft cleared |
| `finish_reason = MAX_TOKENS` / `SAFETY` / `RECITATION` | shown | shown (preserved partial) | Friendly inline note + "show details" |
| HTTP error / backend panic / pre-flight fail | **deleted** | never appeared | Friendly toast + "view full error"; draft restored from in-memory state |
| Stream interruption mid-flight (connection drop) | shown | shown (preserved partial) | Same friendly inline note pattern; draft cleared (already sent) |
| User stop button | **deleted** | **deleted** | Silent; draft restored |

Implementation invariant: **input bubble is optimistic and may be retracted on pre-flight failure; output bubble is lazy and only appears once the first chunk arrives. Once the output bubble exists, it is never retracted by any termination path other than user-cancel.**

---

## Cancellation Taxonomy

| Trigger | Bubbles | Draft | UI feedback |
|---|---|---|---|
| User stop button | Delete both | Restore | Silent |
| Pre-flight fail (rate limit / no API key / validation) | Never created | Keep (untouched) | Toast (warning or error) |
| HTTP error (network, Gemini 4xx/5xx) | Delete user bubble; AI bubble never appeared | Restore | Friendly toast + "view full error" |
| Stream interruption mid-flight (connection drop) | Both preserved (partial AI) | Cleared | Friendly inline note + "show details" |
| `finish_reason = STOP` | Both kept | Cleared | None |
| `finish_reason = MAX_TOKENS` | Both kept (preserved partial) | Cleared | Friendly inline: "Reached max output length" + show details |
| `finish_reason = SAFETY` | Both kept (preserved partial) | Cleared | Friendly inline: "Stopped by safety filter" + show details |
| `finish_reason = RECITATION` | Both kept (preserved partial) | Cleared | Same pattern |
| Backend panic / IPC failure | Delete user bubble | Restore | Toast (error) |
| Vault locked mid-stream | Both preserved (partial AI) | Persisted to `story_state.draft` already | None — lock screen takes over |
| Story switch attempt mid-stream | (blocked) | (blocked) | Confirmation modal: "Generation in progress. Cancel and switch?" |
| Mode switch attempt mid-stream | (blocked) | (blocked) | Same modal pattern (Doc 23 owns copy) |

The "view full error" / "show details" affordance opens a small modal with the raw error message or finishReason code, for writers who want to dig in. Default copy is friendly and short.

---

## Editing a Message

### Edit user message — truncate-and-replace

The writer edits a user bubble (right-click → Edit, or Doc 11 keyboard shortcut). The input area appears in-place over the bubble, pre-populated with the message's parsed `UserContent`. On commit:

1. Update the user message's `content` in DB (new `UserContent` JSON).
2. **Hard-delete every message with `created_at >` this message's `created_at`** for this story (one transaction). This includes any anchored checkpoints and any segments whose range includes the deleted messages — see §Cascading Deletion below.
3. Trigger a new generation as if Send had been pressed for the edited turn.

The whole edit-and-regenerate is one atomic operation. There is **no undo for v2.0** (see `docs-v2/future/undo-redo.md`); v2.1 will replace the hard-delete with an `edit_user` operation log entry that captures `prev_content`, the truncated set, and the newly-generated message.

Edit on the user bubble is only allowed when no generation is in flight.

**Cached-message protection:** if the message being edited (or any message in the to-be-truncated set) falls inside the active story cache's prefix (`messages.created_at <= cache_state.last_cached_message_id`'s `created_at`), the edit is gated by a confirmation modal — Doc 22 §Cached-message Edit/Delete Protection. Dismissal proceeds and marks the cache stale; the next send rebuilds.

### Edit model message — in-place

The writer edits an AI bubble directly (separate command — `update_message_content`). On commit:

1. Update the model message's `content` in DB.
2. No truncation, no regeneration. History downstream stays.

This is the path Ghostwriter uses to write back its edits (Doc 17). In v2.0 this path is also non-undoable; future iterations could surface the per-message `ghostwriter_history` JSON as edit history.

**Cached-message protection:** the same rule applies — editing a model message inside the cached prefix is gated by the Doc 22 confirmation modal and marks the cache stale on dismissal. Ghostwriter accept on a cached model message goes through the same gate.

---

### Session-message edits (handover / consulting)

Editing a user message inside a handover or consulting session truncates only within that `session_id`, not the story timeline. Story messages are never affected by session-mode edits, regardless of their position. Cascading deletion (checkpoints, accordion segments) does not apply — sessions have no checkpoints or segments.

For consulting sessions, the cached-message protection rule applies against the session's cache prefix (the messages baked into the session's snapshot) rather than the story cache. Handover sessions are uncached and have no protection gate.

The session-message edit and regenerate paths live on `commands/modes.rs` (Doc 23), not in this doc. The behaviour is structurally identical to story edit/regenerate but scoped to a `session_id`.

---

## Regenerating the Last Response

`regenerate_last_response(story_id)`. Hard-deletes the most recent model message and re-fires the request from the existing user turn. Same cascade rules as edit — the message and any dependent rows are removed in one transaction.

Used by the writer to ask "give me a different version of this." Without branching, regeneration replaces — there is no history of past regenerations. Writers wanting to compare versions copy text manually.

Allowed only when no generation is in flight and the most recent message is a model message (not a hanging user turn from a failed/cancelled generation).

---

## Cascading Deletion (Story Integrity)

Whenever a message is hard-deleted (writer-initiated delete, edit-truncate, or regenerate), dependent rows are deleted in the same transaction:

- **Checkpoints** anchored to a deleted message (`checkpoints.after_message_id IN deleted_ids`) — deleted.
- **Accordion segments** that reference any deleted checkpoint as `start_cp_id` or `end_cp_id` — deleted.
- **Accordion segments** whose range contains a deleted message (between their start and end checkpoints in chronological order) — deleted.

Cascade rule rationale: a checkpoint is conceptually attached to a specific message; if the message is gone, the checkpoint can't anchor to anything coherent. A segment summarises a specific range of messages; if part of the range is gone, the summary is no longer accurate.

These rules apply identically when v2.1 introduces soft-delete via the operation log; the difference is reversibility, not the cascade set.

---

## Deletion (writer-initiated)

The writer deletes via right-click on a message → "Delete exchange" or "Delete from here on."

- **Delete exchange:** removes the user/model pair containing the targeted message. If the targeted message is an orphan user turn from a failed/cancelled generation, it is removed alone.
- **Delete from here on:** removes the targeted exchange and every exchange after it in chronological order.

Both go through a confirmation modal:

```
"Delete N exchange(s)?
This cannot be undone in v2.0."
[Cancel]  [Delete]
```

The "this cannot be undone" copy is intentional — writers should know v2.0 has no recovery. v2.1 will replace this with reversible soft-delete (the modal copy will change at that point).

**Cached-message protection:** when any message in the deletion set falls inside the active story cache's prefix, the standard delete confirmation is preceded by the Doc 22 cached-message modal (or the two are combined into one modal — implementation detail). On dismissal, the cache is marked stale and deletion proceeds.

Allowed only when no generation is in flight.

---

## Feedback

Per Doc 03, every story-mode model message has a `user_feedback` field. The writer adds feedback via the bubble's inline strip + action-row entry (Doc 28 owns the affordance — strip below the bubble, click-to-edit, explicit Apply / Cancel, no auto-save on blur). Feedback:

- Persists indefinitely until cleared by the writer or the message is deleted.
- Is appended to the model message's content during history assembly (`\n\n[WRITER FEEDBACK]\n<feedback>`), so the model sees it on every future turn that includes this message.
- Is also a primary input for Handover synthesis (Doc 23) — accumulated feedback is the writer's running commentary on the story.

`update_feedback(message_id, feedback)` writes the field. Empty string clears it.

---

## Rate Limiting

Three counters, app-scoped, configured in app settings:

- `rate_limit_rpm` — requests per minute (default 10)
- `rate_limit_tpm` — tokens per minute (default 250 000)
- `rate_limit_rpd` — requests per day (default 1 500)

Stored in `telemetry` table per provider (`text` for the conversation engine). Checked **before** sending. If any limit is hit:

- The pre-flight fails with `LoomError::RateLimited`.
- Toast: `"Rate limit reached. Resets in <duration>."`
- The user message bubble (which was optimistically rendered) is retracted.
- Draft is preserved (writer can retry once the limit resets).

The Settings → Gemini tab includes a "Reset rate limiter" affordance for development (Doc 20).

---

## Generation Parameters

Configured in **Settings → Gemini** (Doc 20). World-overridable. Defaults are ⚠️ provisional and may be tuned in the visual/UX design phase:

| Key | Default | Notes |
|---|---|---|
| `gen_temperature` | `1.0` | Gemini default for 2.5-flash |
| `gen_top_p` | `0.95` | |
| `gen_top_k` | `40` | |
| `gen_max_output_tokens` | `8192` | Upper bound; not a length directive to the model |

The cascade `world settings → app_settings → hardcoded fallback` resolves before the request is built. No per-message override in v2.0.

---

## Markdown Rendering

Model output is plain text but is rendered as Markdown in the Theater. The supported subset and visual treatment is owned by Doc 09 (Component Library). The conversation engine itself does not interpret Markdown; it stores the raw stream from Gemini in `messages.content`.

---

## Drafts (recap)

Per `story_state.draft`. Auto-saved debounced ~1 s. Cleared on successful send. Loaded on story open. Story-scoped — each story has its own draft.

---

## Status View (Right Pane)

A `<ControlPaneSection>` at the bottom of the right pane. Always visible when a story is open; collapsible.

### States

| State | Trigger | Visual (expanded) |
|---|---|---|
| Idle | No generation in flight, no input typed | `● Idle · Last turn: 1,247 tok · 23s ago` |
| Idle — typing | Writer is typing in input area | `● 8,420 tok ready` (live token count from `get_token_count`) |
| Preparing | Send clicked, request being built | `◐ Preparing · 10,872 tok ready` |
| Thinking | HTTP 200 received, no chunks yet | `◔ Thinking · 1.8s` (counter ticks) |
| Streaming | First chunk received | `◓ Streaming · 412 tok · 4.3s · ~85 tok/s` |
| Complete | `finish_reason = STOP` (3 s, then collapses to Idle) | `✓ Complete · 412 tok · 6.1s` |
| Stopped | Any non-STOP finish | `⚠ Stopped · MAX_TOKENS · [Show details]` |

### Collapsed bar contents

- Idle and empty input: `Idle · last 1,247 tok`
- Idle, typing: `8,420 tok` (live)
- Preparing / Thinking: `Generating…`
- Streaming: `Streaming…`
- Stopped: `⚠ Stopped`

### Position

Bottom of the right pane. The right pane is a flexbox column of `<ControlPaneSection>` components; reordering is a single-line JSX change. A future user-customisable order is possible via a config array but is not in scope for v2.0.

> **Glyph and copy details (`●◐◓◔✓⚠` and the wording above) are ⚠️ provisional. The visual design pass will tune them.**

> **Cache-state visualisation:** Status shows only a binary glyph (`✓` cache active / `—` no cache) to avoid duplicating the dedicated Cache section, which owns TTL, doc snapshots, and create/delete affordances. See Doc 22.

---

## Theater Scrolling

Five rules, in priority order:

1. **On story open:** scroll-to-bottom. Every time. Writers expect to see the latest content.
2. **On user-bubble appearance (post-Send):** auto-scroll to reveal the new bubble. Auto-follow then engages.
3. **Auto-follow during streaming:** as the AI bubble grows, the scroll position is pinned to the bottom. Smooth-scroll, throttled via `requestAnimationFrame` (do not call `scrollIntoView` per chunk — coalesce).
4. **User scrolls up during streaming:** auto-follow pauses immediately. A floating "↓ New content" button appears at the bottom-right of the Theater. Clicking it smooth-scrolls to bottom and re-engages auto-follow. Auto-follow also re-engages automatically once the writer scrolls back to within **32 px** of the bottom.
5. **Edit on a user or AI bubble:** scroll position is frozen at the moment the edit starts. Implementation: capture `scrollTop` when edit mode activates; restore it after the in-place editor mounts (which may add toolbar height etc.).

### Additional cases

- **Edit commit that triggers regeneration:** the freeze ends. Normal streaming auto-follow engages.
- **Soft-delete or restoration of an off-screen exchange (v2.1):** anchor scroll to the message at the top of the current viewport. The DOM shifts; the visible anchor stays fixed.
- **Window / pane resize during streaming:** if auto-follow engaged, stay pinned to bottom. If paused, pin scroll to the previously-visible top message via a stable anchor.
- **Accordion segment collapse / expand:** anchor to the first checkpoint at or above the current viewport — that header stays in place. Detail in Doc 16.
- **Keyboard navigation (PageUp / PageDown / arrow scroll):** counts as user-initiated scroll → pauses auto-follow until back at bottom.

Out of scope for v2.0: programmatic jump from search/find features.

---

## Backend API (`commands/conversation.rs`)

Full signatures, populating Doc 07.

```
load_messages(story_id: String) -> Result<Vec<ChatMessage>>
  // Returns all live messages for the story, chronological.

send_message(story_id: String, draft: UserContent) -> Result<String>
  // Returns the new user_message_id immediately (synchronous DB write).
  // Streaming proceeds asynchronously; frontend listens for message_chunk
  // and message_complete events.

cancel_generation(story_id: String) -> Result<()>
  // Cancels the in-flight generation for this story (if any).
  // Idempotent — no error if nothing is in flight.

edit_user_message(message_id: String, new_content: UserContent) -> Result<()>
  // Updates the user message, hard-deletes everything after with cascade,
  // then triggers a new generation. Caller listens for the same
  // message_chunk / message_complete events as send_message.

update_message_content(message_id: String, new_text: String) -> Result<()>
  // In-place edit of a model message. No truncation, no regeneration.

regenerate_last_response(story_id: String) -> Result<()>
  // Hard-deletes the last model message with cascade, re-fires generation.

delete_exchange(message_id: String) -> Result<()>
  // Hard-deletes the user/model pair containing message_id, with cascade.
  // For an orphan user turn, deletes that turn alone.

delete_from(message_id: String) -> Result<()>
  // Hard-deletes the exchange containing message_id and every exchange after,
  // with cascade.

update_feedback(message_id: String, feedback: String) -> Result<()>
  // Empty string clears.

get_token_count(story_id: String, draft: UserContent) -> Result<TokenEstimate>
  // Pre-flight token estimate using Gemini countTokens.

get_draft(story_id: String) -> Result<Option<InputDraft>>
save_draft(story_id: String, draft: InputDraft) -> Result<()>
clear_draft(story_id: String) -> Result<()>
  // Persisted-draft accessors. Frontend debounces save_draft (~1s).
```

### Events

| Event | Payload | When |
|---|---|---|
| `message_chunk` | `{ story_id, chunk: string }` | Per Gemini SSE chunk |
| `message_complete` | `{ story_id, message_id, finish_reason, token_count }` | Generation finished (any finish reason that preserves messages) |
| `generation_cancelled` | `{ story_id }` | User-cancel or pre-flight failure that retracted the user bubble |
| `generation_failed` | `{ story_id, error_kind, error_detail }` | HTTP error, backend panic, stream interruption |

`generation_failed` is new compared to v1.0 — it lets the frontend distinguish "user cancelled" (silent) from "something broke" (toast + view-full-error).

### Errors

| Variant | When |
|---|---|
| `LoomError::Validation` | Vault locked, no story active, plot_direction empty, generation already in flight, regenerate-without-model-tail |
| `LoomError::RateLimited` | RPM / TPM / RPD exceeded |
| `LoomError::ApiError` | Gemini 4xx / 5xx, malformed response |
| `LoomError::Database` | DB write failure |
| `LoomError::NotFound` | Stale message_id / story_id |

---

## Frontend State (`workspaceStore`)

```typescript
interface WorkspaceStore {
  activeStoryId: string | null;
  messages: ChatMessage[];                       // sorted by created_at
  draft: InputDraft;                             // mirrors story_state.draft
  isGenerating: boolean;
  generationStatus:
    | { kind: 'idle' }
    | { kind: 'preparing' }
    | { kind: 'thinking'; startedAt: number }
    | { kind: 'streaming'; startedAt: number; tokenCount: number }
    | { kind: 'complete'; finishReason: FinishReason; tokenCount: number; durationMs: number }
    | { kind: 'stopped'; finishReason: FinishReason; detail: string };
  scrollState: {
    autoFollow: boolean;
    pausedReason: 'user_scroll' | 'edit' | null;
  };
  tokenEstimate: TokenEstimate | null;

  // Actions
  loadStory(storyId: string): Promise<void>;     // load_messages + get_draft
  setDraftField(field: keyof InputDraft, value: string | string[]): void;
                                                  // schedules debounced save_draft
  send(): Promise<void>;                         // calls send_message
  cancel(): Promise<void>;                       // calls cancel_generation
  editUser(messageId: string, content: UserContent): Promise<void>;
  updateModelContent(messageId: string, text: string): Promise<void>;
  regenerateLast(): Promise<void>;
  deleteExchange(messageId: string): Promise<void>;
  deleteFrom(messageId: string): Promise<void>;
  updateFeedback(messageId: string, feedback: string): Promise<void>;

  pauseAutoFollow(reason: 'user_scroll' | 'edit'): void;
  resumeAutoFollow(): void;

  clear(): void;                                 // story switch / vault lock
}
```

Streaming chunks update the in-memory tail message via the `message_chunk` listener (registered in `useWorkspaceEvents`). On `message_complete` the store reloads the message to capture the final `token_count` and `finish_reason`. On `generation_failed` the optimistic user message is removed and the draft is restored.

---

## Edge Cases and Error Handling

| Scenario | Behaviour |
|---|---|
| Send with empty `plot_direction` | Send button disabled; pre-flight rejects if somehow invoked |
| Send while another generation is in flight | Pre-flight rejects with `LoomError::Validation`; UI gates this via `isGenerating` |
| Summarise while another generation is in flight | `isGenerating` is the **single global flag** for any model call — story turn, session turn, *and* accordion summarise (Doc 16). Pre-flight rejects symmetrically; UI gates via per-banner button greying with tooltip `"Generation already in progress"` |
| Edit while generation in flight | Edit UI disabled; backend rejects |
| Delete while generation in flight | Delete UI disabled; backend rejects |
| Regenerate when last message is a user turn | Backend rejects with `LoomError::Validation` |
| `countTokens` failure during draft typing | Token meter shows `—`; no toast (silent) |
| Rate limit hit on send | Optimistic user bubble retracted; draft preserved; toast with reset time |
| Gemini stream emits `finishReason = OTHER` | Treated as `RECITATION`-equivalent: preserve partial, friendly inline note, show details |
| Vault lock with debounced save pending | Lock command awaits the pending save before zeroing keys |
| Story switch with debounced save pending | Switch awaits pending save; new story's draft loaded fresh |
| App close mid-stream | Backend cancels via Drop on AppState; partial AI message is **not** persisted (no `message_complete` fired) |
| Two messages with identical `created_at` | Tie-broken by `id` ascending (UUIDs are unique; deterministic order) |

---

## Out of Scope

Deferred from v2.0:

- **Undo / redo for any operation** — see `docs-v2/future/undo-redo.md`. v2.1 work.
- **Message-level Trash view** — messages are not first-class citizens of the global vault Trash.
- **Image attachments per turn** — `attached_image_ids` was dropped from `UserContent`. Image and media handling is Doc 19.
- **Output-length presets** — removed entirely. Length cues live in Constraints or aux slots.
- **Per-message generation parameter overrides** — global only via Settings → Gemini.
- **Programmatic scroll-to-message** (e.g. from a hypothetical search feature).
- **In-flight `update_message_content` undo** — F4; future enhancement.
- **Multi-turn batching / queued sends** — one in-flight generation at a time.

---

## Cross-References

- **Doc 03** — `messages`, `story_state`, `app_settings`, `settings` schemas; `UserContent` and `InputDraft` interfaces.
- **Doc 06** — `workspaceStore` shape; `useWorkspaceEvents` hook.
- **Doc 07** — Full IPC contracts; this doc populates the `conversation` section.
- **Doc 09** — Markdown rendering rules in the AI bubble.
- **Doc 10** — Right-pane layout, `<ControlPaneSection>` ordering.
- **Doc 11** — Right-click and keyboard affordances on bubbles.
- **Doc 12** — Toast / inline-error copy.
- **Doc 16** — Accordion segment substitution during history assembly.
- **Doc 17** — Ghostwriter writes via `update_message_content`.
- **Doc 22** — Context Caching: cacheable prefix definition; staleness rules; cached prefix vs. aux slot placement.
- **Doc 23** — Mode-specific request shape; handover-message exclusion from history; consulting-mode parallel conversation.
- **`docs-v2/future/undo-redo.md`** — v2.1 reversibility design.
