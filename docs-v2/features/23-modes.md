# 23 — Modes

> **Status:** Complete
> **Last updated:** 2026-05-18 — Switcher re-entry (owner decision): clicking the Handover/Consulting tab now **re-enters the newest session of that kind when it sits at the current story tail** (no story messages written since it was created) instead of always creating a new one. A new session is created only when there is fresh story material since the last session. §Switcher behaviour table and the paragraph below it updated; §Handover / §Consulting Create lines amended. Session banners gained a hover action row + right-click popover for Rename / Delete (visual; Doc 27).
> **Earlier:** 2026-05-17 — Designfiles reconciliation (Phase 12 prep): the mode switcher is now positioned at the **bottom** of the Theater, directly above the input area (owner decision; visual treatment in Doc 27). §Mode UI Mapping row relabelled from "Top bar" to "Mode switcher". Switcher *behaviour* is unchanged.
> **Earlier:** 2026-05-03 — pre-implementation audit resolution: `active_session_id` persistence committed — added to `story_state` known keys (Doc 03); re-opening a story in a session-mode restores the session if it still exists, else falls back silently to story mode (CD-9 / Q7).
> **Earlier:** 2026-04-29 — first full design pass; cross-cutting switcher behaviour, story-mode parity, handover spec (multi-turn, manual seed-doc workflow), consulting spec (multi-session, per-session cache, snapshot-driven re-entry), unified banner pattern across handover / consulting / accordion
> **Scope:** The Modes system — story / handover / consulting. Persona, conversation type, cache topology, session lifecycle, Theater partition rendering, and how the writer moves between them.

The Modes system is a v2.0 architectural concept introduced by D-05. The same writer in the same story can switch between three different relationships with the AI without leaving the story. Each mode has its own persona (system instruction), its own conversation shape (input fields, history scoping, cache topology), and its own visual treatment in the Theater.

This doc owns *behaviour*. Visual treatment of bubbles, partitions, and banners lives in Doc 27 (Theater Composition).

---

## The Three Modes

| Mode | AI persona | Input shape | History scope | Cache | Output |
|---|---|---|---|---|---|
| **Story** | Author — outputs only story prose, never breaks character | 4 fields (Doc 15) | Linear story timeline | Story cache (Doc 22) | Story prose continuation |
| **Handover** | Analyst — structured report on what's been written | 1 free-text field | Per-session, multi-turn within session; story messages read-only context | None (uncached) | Structured report; manual seed for next chapter |
| **Consulting** | Editor / consultant — meta discussion *about* the story | 1 free-text field | Per-session, multi-turn within session; story-up-to-entry-point as read-only context | Per-session cache (Doc 22) | Conversation, not actionable |

All three modes share: the same Theater pane, the same Status section, the same Cancel affordance, the same rate limiter, the same generation parameters, the same model, the same source-doc attachment set.

---

## Mode Switching

### Switcher UI

A horizontal tab strip at the top of the Theater pane, immediately above the message scroll surface. Three tabs: **Story · Handover · Consulting**. The active mode's tab is highlighted.

When a handover or consulting session is currently active (the user is mid-conversation in it), the active tab additionally shows the session name — e.g. `Consulting · Consulting 2`. This makes it explicit which session a re-entry is in, and visually distinguishes the "currently driving" session from any others present in the Theater as banners.

Visual values are owned by Doc 27.

### Switcher behaviour: clicking a tab

| Click target | When | Result |
|---|---|---|
| Story tab | Any time | Activates story mode. Input area shows the four story fields. Active session (if any) is exited (its cache is dropped). |
| Handover tab | Handover session already active | No-op (you're already there). |
| Handover tab | Not active; the newest handover session sits at the current story tail (no story messages written since it was created) | **Re-enters that session** — expands its partition and activates it. No new session is created. |
| Handover tab | Not active; no handover session exists, or the newest one's entry point is behind the current story tail | **Creates a new handover session at the current story position.** Banner appears inline, expanded by default. Input area shows the single handover field. |
| Consulting tab | Consulting session already active | No-op. |
| Consulting tab | Not active; the newest consulting session sits at the current story tail (no story messages written since it was created) | **Re-enters that session** — expands its partition and activates it; its cache is rebuilt from `entry_snapshot` (Doc 22). No new session is created. |
| Consulting tab | Not active; no consulting session exists, or the newest one's entry point is behind the current story tail | **Creates a new consulting session at the current story position.** Banner appears, expanded. Cache creation begins (brief "Preparing session…" status if it takes more than ~250 ms). |

**The switcher re-enters an existing session only when nothing new has been written.** The rule: a Handover/Consulting tab click compares the newest session of that kind against the story tail — if the session was created at the message that is *still* the last story message (`entry_message_id` equals the current tail), clicking the tab re-enters it rather than spawning a duplicate. Once story messages have been written since, the tab creates a new session — there is fresh material to hand over or consult about. Re-entry is also available any time via banner click (see §Banners below). This keeps the common case ("I just want to reopen what I was just doing") a single click, without accumulating empty duplicate sessions.

### What persists across a switch

- **Theater scroll position.** There is one Theater scroll surface; all messages, partitions, and banners are visible regardless of active mode. A switch changes input + cache + active session, not what's rendered.
- **Story cache.** Continues to live (TTL not refreshed during non-story modes; may expire if absent long enough — Doc 22 handles transparent rebuild).
- **Story draft.** Persisted in `story_state.draft`; loaded back when story mode is reactivated.
- **Per-session state.** Each handover or consulting session has its own row; banners stay in the Theater forever (until the session is deleted).
- **Status section.** Global; continues to show the in-flight generation regardless of which mode triggered it.
- **Cancel affordance.** Global; cancels the in-flight generation regardless of active mode.
- **Token meter.** Computed against the *active* mode's would-be request.

### What resets across a switch

- **Input fields.** The input area always loads the active mode's draft (story = `story_state.draft`; handover = the active handover session's draft; consulting = nothing — consulting drafts are not stored).
- **Aux slots.** Aux is story-mode only. In handover and consulting the aux slot UI is hidden (and any active aux slot is not injected). On return to story mode, aux state is unchanged.

### Switching during generation / streaming

Mode switching is allowed at any time, including mid-stream. The streaming response continues in the background — chunks still arrive, are persisted to the originating mode's message, and `message_complete` fires normally. The user may switch away and return; the message will be there.

**Send is blocked while `isGenerating` is true** (Doc 15 §Bubble Lifecycle), regardless of which mode the user is in. The Send button is disabled in any mode while a generation is in flight — there is no danger of overlapping requests.

Cancel is available in any mode while `isGenerating`; cancelling cancels the in-flight generation regardless of which mode triggered it.

---

## Story Mode

Story mode is the default and matches the v1.0 conversation engine, fully specified in Doc 15. This section enumerates only what's mode-specific.

### Behaviour

- Input: four fields (`plot_direction`, `background_information`, `modificators`, `constraints`).
- History assembly: linear, all `kind = 'story'` messages for this story, with feedback injected on model turns and Accordion substitution.
- SI: `story_si` (resolved from cascade).
- Aux slots: optional, prepended to the live user turn outside the cache (Doc 15 §Aux Slot Injection).
- Cache: story cache (Doc 22). SI + docs + history-to-date.

### Bubbles

User and model bubbles, alternating, in chronological order. Visual treatment is owned by Doc 27.

### Mode-specific control-pane sections

Story mode displays the full standard right pane: Settings, Context Documents, Cache, Status. Doc 10 owns layout; this section just notes the mapping.

---

## Handover Mode

### Purpose

Generate a structured report that captures everything important from what has been written so far. The writer uses it as a "more detailed Accordion" — material to seed the next chapter, support a continuation in a new story, or hand off to another writer.

### Persona

The model is briefed as an analyst: read the story, produce a structured report on plot, characters, world, themes, threads. Specifics live in `handover_si` (resolved from cascade), which the user can edit in Settings.

### Input shape

A single free-text field. Required to send (cannot send empty). The field is the writer's instruction to the analyst — what to focus on, what depth, any specific aspect to emphasise. Examples:
- `"Focus on the political tensions in the second act."`
- `"Comprehensive — character motivations, unresolved threads, world details."`
- `"Just the main plot beats, terse."`

There is no plot/background/modificators/constraints split. Aux slots are not active in handover.

### Multi-turn within a session

Handover is multi-turn. After the initial report, the writer can iterate: `"Expand the character section."` `"Less terse on the world details."` Each turn is a normal user → model exchange inside the session. Prior turns within the session are part of the session's history for the next turn.

### Session lifecycle

- **Create:** clicking the Handover tab in the switcher creates a new session at the current story position — *unless* the newest handover session already sits at the story tail, in which case the tab re-enters that session instead (see §Switcher behaviour).
- **Send:** each send is a multi-turn request — `handover_si` + currently-attached docs + story-kind history up to `entry_message_id` + this session's prior turns + the new user turn.
- **Exit:** switching to story mode or starting a different session (consulting tab, or starting a different handover via deletion-then-recreate). The session row remains; the banner stays in the Theater forever.
- **Re-entry:** click the banner → expand → "Enter" button (or right-click → "Enter…"). On re-entry, the session's input area appears and further turns are appended.
- **Multiple sessions per story:** allowed. Each is independent. Default name is `"Handover N"` (1-based, monotonic per story per kind).

### Cache

None. Each turn assembles inline:

```
handover_si  +  docs  +  story_kind_history_up_to_entry  +  this_session_prior_turns  +  new_user_turn
```

The full prefix is uploaded every turn. The token cost is real — handover should not be over-used on enormous stories. The token meter shows the count and warns approaching `context_token_limit`.

### Theater rendering

Sending the first turn of a handover session creates a collapsible **handover partition** in the Theater at the session's position. Visual treatment (border, header bar, internal layout) is owned by Doc 27. Behavioural rules:

- The partition opens expanded by default after creation.
- Messages within the partition are rendered as user/model bubbles in the same style as story bubbles, but visually framed inside the partition (different background tint, distinct border).
- Collapsing the partition replaces the expanded content with a banner: `Handover N · M messages`.
- Old handover partitions (other sessions on the same story, started earlier or later) are also visible in the Theater at their own positions, each with its own collapse state.

### Excluded from story history

Handover messages have `kind = 'handover'` and `session_id = <handover_session_id>`. They are excluded from story-mode history assembly (Doc 15 §History Assembly). Story sends never see handover content.

### Included in export

Handover messages are in the export bundle (Doc 21). They are not part of the prose, but writers will want them as deliverables when they hand off a project.

### Manual seed-doc workflow (v2.0)

A handover output is intended to seed the next chapter or be saved as a reference document. **In v2.0 this is a manual copy-paste flow.** The writer:

1. Reads the analyst's response in the partition.
2. Selects the text and copies it.
3. Creates a new SourceDocument in the vault and pastes.
4. (Optionally) attaches that doc to the story's context, or uses it as the seed for a new story.

> **Future enhancement (post-v2.0):** an explicit "Save as source doc" action on the handover output that creates the SourceDocument vault item in one step, optionally pre-attaching it. Tracked as a future refinement; not in v2.0 scope.

### What handover does **not** have

- No aux slots (story-only feature).
- No per-turn modificators / constraints / background fields.
- No cache.
- No snapshot for re-entry. Handover re-entry simply appends to existing session messages; the prefix is reassembled inline from current state every turn. (If story messages are deleted or edited between turns, the next turn's prefix changes accordingly. This is acceptable — handover is short-lived and explicit.)

---

## Consulting Mode

### Purpose

A meta discussion *about* the story. The writer can ask: what's working in the writing style, what doesn't, ideas for a subplot, character arcs, plot holes, world-consistency questions. The AI plays the role of an editor or consultant. Output is reflection, not story prose.

### Persona

`consulting_si` (resolved from cascade) tells the AI it is consulting on the story, not writing it. User-editable in Settings.

### Input shape

A single free-text field. Required to send. Writer types whatever they want to discuss. No plot/background/modificators/constraints. Aux slots not active.

### Multi-turn within a session

Yes. A consulting session is a sustained conversation. Prior turns within the session are part of context for subsequent turns.

### Session lifecycle

- **Create:** clicking the Consulting tab creates a new session at the current story position — *unless* the newest consulting session already sits at the story tail, in which case the tab re-enters that session instead (see §Switcher behaviour). On create, a consulting cache is immediately created (Doc 22 §Consulting-session cache).
- **Send:** each turn = `consulting_si` (cached) + docs (cached) + story-up-to-entry (cached) + this session's prior turns (uncached, sent as `contents`) + new user turn (uncached).
- **Exit:** switching to story or another mode. The cache is dropped (best-effort `DELETE` to Gemini, fields nulled on the session row). The session row and its messages remain.
- **Re-entry:** banner click → expand → "Enter" button (or right-click → "Enter…"). Re-entry rebuilds the cache from `entry_snapshot` (Doc 22 §Session Snapshot). If the snapshot diverges from current state (deleted source docs, edited story messages), a non-blocking warning toast surfaces.
- **Multiple sessions per story:** allowed and expected. Each session is **self-contained** — sessions never see each other's history or cache. Default name `"Consulting N"`.

### Cache

Per session, with the consulting SI baked in. The story cache continues to live during a consulting session but is not refreshed by consulting sends and is not used by them. See Doc 22 for full cache lifecycle, snapshot semantics, and stale-trigger rules.

### Theater rendering

Sending the first turn of a consulting session creates a collapsible **consulting partition** at the session's position. When collapsed: a banner `Consulting N · M messages` (where N is the session's name, M is the live message count). When expanded: the banner persists at the top of the partition, and all consulting messages render inside a framed region beneath it (visual frame owned by Doc 27).

### Re-entry: greying and smart scroll

When the user re-enters an old consulting session whose entry point is mid-story (story messages exist after the entry), the post-entry story messages are **greyed out** in the Theater while the session is active. They are still visible (writers want orientation) but visually marked as not-in-context-for-this-session.

The greyed messages are **not** part of the consulting session's history or cache — the cache prefix is rebuilt from snapshot at the entry point.

When the user sends a new turn during re-entry, the consulting partition grows (the new exchange is appended inside the partition's frame). Smart-scroll behaviour:

- If auto-follow is engaged: the partition's growth pushes the post-entry story messages downward; the scroll surface follows the bottom of the new exchange.
- If the user has manually scrolled up: auto-follow is paused (per Doc 15 §Theater Scrolling); the floating "↓ New content" button appears.
- Re-engaging auto-follow scrolls to the most recent consulting message, not the bottom of the Theater (the Theater "bottom" is now ambiguous with a re-entered session in the middle — auto-follow tracks the *active* output).

### Excluded from story history

Consulting messages have `kind = 'consulting'` and `session_id = <consulting_session_id>`. They are excluded from story-mode history assembly. Story sends never see consulting content.

### Included in export

Yes. Consulting sessions are in the export bundle (Doc 21), grouped by session.

### What consulting does **not** have

- No aux slots.
- No drafts (consulting input is not auto-saved; closing the app or switching modes mid-typing loses the unsent text). This is a deliberate simplification — consulting is a conversational meta-space, not a long-form input area.
- No actionability — a consulting response cannot be "applied to the last paragraph." The writer interprets what they read and acts manually.
- No cross-session shared context — Consulting 1 and Consulting 2 are independent.

---

## Banners (collapsible partitions)

The collapsible-banner UI pattern is shared across **handover sessions, consulting sessions, and accordion segments** (Doc 16). Behavioural specification lives here; visual specification lives in Doc 27.

### Visual structure

Three states, common across all banner kinds:

1. **Collapsed banner.** A single-row strip showing kind, name, and summary information.
   - Handover: `Handover N · M messages`
   - Consulting: `Consulting N · M messages`
   - Accordion: `<segment name> · <token count>` (Doc 16 owns the exact format)
2. **Expanded view.** The banner remains at the top of the expanded region. Beneath it: the partition's content (messages, summary text, etc.), framed by a visible border that scopes the content to the partition.
3. **Bottom action row** (when expanded, applies to handover / consulting; not accordion). Contains the "Enter" button (when the session is not currently active) or "Exit" button (when active).

### Affordances

- **Click banner (when collapsed):** expands. No mode entry occurs — the user is just viewing.
- **Click banner (when expanded):** collapses.
- **"Enter" button (handover / consulting, when expanded):** activates the session — input area becomes the session's input, mode switcher tab updates to highlight the active session, the relevant cache is created or rebuilt.
- **Right-click banner:** context menu.
   - For handover / consulting: `Enter session`, `Rename`, `Delete session`.
   - "Enter session" is the one-step entry — expands the partition AND activates the session in one click.
   - For accordion: per Doc 16 (`Toggle collapse`, `Re-summarise`, `Edit summary`, `Delete checkpoint`).
- **"Exit" button (when the session is currently active):** returns the user to story mode; the session's cache is dropped (consulting); banner remains.

### Renaming

Handover and consulting session names are renameable via the right-click menu (or by double-clicking the name in the banner — implementation detail in Doc 27). Accordion segment names follow Doc 16's checkpoint rename flow.

The numeric default (`Consulting N`, `Handover N`) is preserved on rename of *other* sessions — defaults are stable and monotonic per story per kind.

### Deletion

Right-click banner → `Delete session` → confirmation modal. On confirm: the session row, all its messages, and any cache are deleted. The banner disappears from the Theater.

The cascade rules from Doc 15 §Cascading Deletion do **not** apply to handover/consulting messages — they have no checkpoints or accordion segments to cascade to. Deleting a handover or consulting session does not affect the story timeline.

### Position

Banners and partitions live in the Theater at the position they were created — for sessions, that is "after the story message that was the most recent at session-creation time" (i.e. immediately after the message named by `entry_message_id`, or at the very top if `entry_message_id IS NULL`). They never move. Editing or deleting story messages near the entry point can leave a session "orphaned" (its entry message is gone); the session still renders at its original chronological position relative to remaining messages.

---

## Mode UI Mapping

| Surface | Story | Handover | Consulting |
|---|---|---|---|
| Mode switcher (bottom, above input area) | Segmented pill row (3 segments); active session name shown when applicable | same | same |
| Theater (scroll surface) | Story messages, banners for sessions and accordion | same — scroll surface is unified | same |
| Input area | Four fields | One field | One field |
| Aux slot UI | Visible | Hidden | Hidden |
| Right pane: Settings | Visible | Visible | Visible |
| Right pane: Context Documents | Visible (detach via `×`; attach via vault paperclip / right-click — Doc 18) | Visible (detach available but doesn't affect the in-flight session — entry snapshot is authoritative) | Visible (same) |
| Right pane: Cache section | Story cache row | Story cache row (no handover row) | Story cache row + active consulting session row |
| Right pane: Status | Always visible | Always visible | Always visible |
| Send button | Story-mode preconditions | Handover preconditions (input non-empty, session exists or click to create) | Consulting preconditions |

Detailed layout in Doc 10. Per-section visuals in Doc 27.

---

## Data Requirements

- `messages` (Doc 03) — `kind` enum, `session_id` foreign key.
- `conversation_sessions` (Doc 03) — session rows for handover and consulting; cache fields populated only for consulting.
- `story_state.active_mode` (Doc 03) — persisted per story so re-opening a story restores the last active mode.
- `cache_state` (Doc 03) — story cache; one row per story.
- `app_settings` / `settings` — `story_si`, `handover_si`, `consulting_si` (each cascade-resolved).

---

## Backend API (`commands/modes.rs`)

```
list_sessions(story_id: String) -> Result<Vec<ConversationSession>>
  // All sessions for the story, ordered by created_at.

start_handover_session(story_id: String) -> Result<String>
  // Creates a new handover session at the current story tail. Returns session id.
  // Captures entry_message_id from the most recent story-kind message.

start_consulting_session(story_id: String) -> Result<String>
  // Creates a new consulting session, captures entry_snapshot, and creates the
  // consulting cache. Returns session id.

enter_session(session_id: String) -> Result<()>
  // For consulting: rebuilds cache from entry_snapshot if not currently alive.
  // For handover: no-op cache-wise; just marks UI state.
  // Idempotent if already active.

exit_session(session_id: String) -> Result<()>
  // For consulting: best-effort DELETE of cache, nulls cache fields.
  // For handover: no-op cache-wise.
  // Idempotent.

send_session_message(session_id: String, text: String) -> Result<String>
  // Sends a turn to a handover or consulting session. Returns user message id.
  // Streaming via session_message_chunk / session_message_complete events.

cancel_session_generation(session_id: String) -> Result<()>
  // Cancels in-flight generation for this session.

rename_session(session_id: String, name: String) -> Result<()>
delete_session(session_id: String) -> Result<()>
  // Cascades: messages with this session_id, plus best-effort cache DELETE for
  // consulting sessions.

set_session_collapsed(session_id: String, collapsed: bool) -> Result<()>
  // Persists banner expand/collapse state for re-render across reloads.
```

Story-mode messaging is owned by `commands/conversation.rs` (Doc 15) — `send_message`, `edit_user_message`, etc. The session commands above are an additional surface, not a replacement.

### Events

| Event | Payload | When |
|---|---|---|
| `session_created` | `{ session_id, story_id, kind }` | After successful start of a session |
| `session_message_chunk` | `{ session_id, chunk: string }` | Per Gemini SSE chunk during session generation |
| `session_message_complete` | `{ session_id, message_id, finish_reason, token_count }` | Session generation finished |
| `session_generation_cancelled` | `{ session_id }` | Session-cancel or pre-flight failure |
| `session_generation_failed` | `{ session_id, error_kind, error_detail }` | HTTP error / backend panic / stream interruption |
| `session_state_changed` | `{ session_id, status }` | Rename, collapse change, deletion, cache state update |

The `session_*` events parallel the story-mode `message_*` events (Doc 15) so the frontend can use the same handling shape.

### Errors

| Variant | When |
|---|---|
| `LoomError::Validation` | Vault locked, story not active, session not found, generation in flight, empty input |
| `LoomError::RateLimited` | RPM/TPM/RPD exceeded |
| `LoomError::ApiError` | Gemini 4xx/5xx, malformed response |
| `LoomError::Database` | DB write failure |
| `LoomError::NotFound` | Stale session_id or message_id |
| `LoomError::CacheCreate` | Consulting cache creation failed (toast warning; session is still created and falls back to inline assembly) |

---

## Frontend State (`modeStore`)

```typescript
interface ModeStore {
  // Active mode for the open story.
  activeMode: 'story' | 'handover' | 'consulting';
  // The session currently being driven (input area writes to it). Null means
  // story mode (story has no concept of an active session).
  activeSessionId: string | null;
  // All sessions for the active story, used to render banners and the
  // mode-switcher's active-session label.
  sessions: ConversationSession[];

  // actions
  loadSessions(storyId: string): Promise<void>;
  setMode(mode: AppMode): Promise<void>;          // delegates to start_* commands when needed
  startNewSession(kind: SessionKind): Promise<string>;
  enterSession(sessionId: string): Promise<void>; // expands partition + activates
  exitSession(): Promise<void>;                   // returns to story
  renameSession(sessionId: string, name: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  setSessionCollapsed(sessionId: string, collapsed: boolean): Promise<void>;
  clear(): void;                                   // story switch / lock
}
```

Streaming chunks for session generation update the in-memory tail message of the active session via the `session_message_chunk` listener (registered in a session-events hook). On `session_message_complete` the session's message list reloads the final message to capture `token_count` and `finish_reason`.

The store reads `sessions` to render banners in the Theater. Per-session message lists live in `workspaceStore` alongside story messages (`workspaceStore.messages` includes all kinds for the active story; the Theater renderer groups them by `session_id`).

---

## Edge Cases and Error Handling

| Scenario | Behaviour |
|---|---|
| Switch from story to consulting mid-stream | Allowed. Story stream continues in the background. Consulting tab activated but Send blocked (`isGenerating`). User can read existing consulting banners but cannot start a new session until story stream completes (cache creation requires a non-busy backend path — pre-flight rejects with Validation). |
| Switch consulting → story while a session generation is in-flight | Allowed. Session stream continues. Story Send blocked until session stream completes. Status section continues to show the session generation. |
| Deleting an in-flight session | Pre-flight rejects with Validation. User must cancel first. |
| Story hard-deleted (vault permanent delete) | All sessions for that story cascade-deleted (`ON DELETE CASCADE`); their caches are best-effort `DELETE`'d. |
| Session re-entered after the entry-point story message was hard-deleted | Snapshot lookup logs divergence; cache is rebuilt from the non-missing pieces; warning toast surfaces. |
| Source doc deleted between session creation and re-entry | Same — divergence logged, cache rebuilt without the missing doc, warning toast. |
| `consulting_si` edited between session creation and re-entry | Snapshot uses the captured SI (immutable). The current `consulting_si` value is irrelevant for re-entry. |
| Two consulting sessions exist; switching between them | Each switch = exit current (drop its cache) + enter target (rebuild from its snapshot). Each switch is one cache-create round-trip. |
| Mode switcher clicked rapidly (double-click on Consulting tab) | First click creates session A. Second click is a no-op (consulting active). User must explicitly exit and re-click to create session B. |
| App close mid-session-stream | Same as Doc 15 §Edge Cases for story streams: backend cancels via Drop on AppState; partial AI message is not persisted. |
| Vault lock mid-session-stream | Same as story; session stream is preserved-or-discarded by the same rules. Cache fields persist on the session row and are restored on unlock. |
| Re-opening a story | `story_state.active_mode` and `story_state.active_session_id` are read (Doc 03). If `active_mode` is a session mode and the named session still exists, the workspace lands in that mode with the session's banner highlighted as the active session — but the session is **not** automatically re-entered (no automatic cache create). The user clicks the banner's `Enter` button to start re-entry (which then rebuilds the consulting cache from `entry_snapshot` per Doc 22). If the named session was deleted between sessions, fallback is silent: `active_mode` resets to `story`, `active_session_id` is cleared. |

---

## Out of Scope (v2.0)

- **Auto-promotion of handover output to a SourceDocument.** Manual copy-paste in v2.0; flagged as a future enhancement.
- **Cross-session context sharing in consulting.** Each session is self-contained.
- **Programmatic actions from consulting** (e.g. "apply this suggestion to the last paragraph"). Consulting is read-only reflection.
- **Modes other than story / handover / consulting.** Adding a fourth mode is structurally additive (per the "additive modes" rule from D-05) but not in v2.0 scope.
- **Per-session generation parameter overrides.** All sessions inherit the world's resolved gen params.
- **Branching within a session.** Sessions are linear, like the story timeline.
- **Searching across sessions.** Out of scope for v2.0; future search work would index `messages` filtered by `session_id`.

---

## Cross-References

- **Doc 03** — `messages.kind`, `messages.session_id`, `conversation_sessions`, `cache_state`.
- **Doc 06** — `modeStore` shape; cross-store reads with `workspaceStore`.
- **Doc 07** — Full IPC contracts; this doc populates the `modes` section.
- **Doc 10** — Three-pane layout; mode-switcher position; mode layout variations table.
- **Doc 15** — Conversation Engine; story-mode behaviour; cancellation taxonomy; cached-message edit/delete rule referenced from §Cached-message Edit/Delete Protection in Doc 22.
- **Doc 16** — Accordion banners share the partition pattern.
- **Doc 21** — Export includes handover and consulting sessions.
- **Doc 22** — Story cache and session cache lifecycle, snapshot, stale triggers.
- **Doc 27** — Theater Composition: visual treatment of bubbles, partitions, banners.
