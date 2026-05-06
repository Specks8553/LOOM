# 17 — Ghostwriter

> **Status:** Complete
> **Last updated:** 2026-05-03 — pre-implementation audit resolution: `GhostwriterEdit` interface confirmed canonical (Doc 03 updated to match — HB-1); Ghostwriter token references switched to triad pattern `--color-ghostwriter` / `-hover` / `-subtle` / `-diff` (CD-2); world setting key renamed `ghostwriter_color` (Doc 03 — CD-2).
> **Earlier:** 2026-04-29 — first full design pass; mode-first activation retained from v1 (selection-first replaced); surgical-stitching request protocol adopted from `project_ghostwriter_fix.md`; non-streaming generation; in-place edit only on non-latest messages (no branching); available across all three modes; per-bubble floating panel pinned to the bubble's viewport range; `blocks` content-type support deferred to v2.1
> **Scope:** Targeted AI revision of selected passages within an AI message. The writer enters Ghostwriter mode on a model bubble, selects a passage, types an instruction, and reviews a word-level diff before accepting or rejecting. Accepted edits are persisted in `messages.ghostwriter_history` and can be reverted.

Ghostwriter is the writer's wordsmith. It is **not** for replotting, regenerating, or extending — it is for the surgical revision of one passage in one AI message. The unselected portion of the message is preserved verbatim by construction (the model never sees it being rewritten); only the selected span is sent for revision and stitched back at the original character offsets.

This doc owns: the mode-first activation flow, the floating panel UI, the request protocol (surgical stitching), the diff display, the accept / reject / revert flows, the `messages.ghostwriter_history` lifecycle, and Ghostwriter's behaviour across all three modes. It does **not** own the AI bubble's general structure (Doc 15 / Doc 27), the cached-message edit protection modal (Doc 22), or the accordion-segment-stale rule on accept (Doc 16).

---

## Where Ghostwriter is Available

| Surface | Available |
|---|---|
| Story-mode AI bubbles | ✅ |
| Handover-session AI bubbles | ✅ |
| Consulting-session AI bubbles | ✅ |
| User bubbles (any mode) | ❌ |
| Bubbles with `content_type = 'blocks'` (interleaved text + images) | ❌ — deferred to v2.1, see §Out of Scope |

The mode-agnostic availability lets the writer apply the same wordsmithing pass everywhere prose lands. Costs are minimal — the only mode-aware piece is history assembly (see §Request Assembly).

---

## Mode-First Activation

Ghostwriter is **always entered explicitly** before text is selected. This is intentional:
- Plain-text rendering can be flipped on at mode entry (required for offset accuracy when content has markdown).
- Text selection in read-state bubbles remains standard browser selection (copy, search, etc.) — Ghostwriter does not intercept it.

### Entry points

1. **Action row** — every AI bubble's hover action row exposes a `✦ Ghostwriter` button (first action). Click → enter mode on this bubble.
2. **Right-click context menu** — right-click an AI bubble → `Ghostwriter…`. Same effect.

The `✦` glyph (U+2736) is reserved across LOOM as the AI-revision marker. It is not a `lucide-react` icon.

### One-bubble-at-a-time

Only one bubble can be in Ghostwriter mode at a time. Entering mode on a second bubble while another is active:
- If the first has **no diff yet** (still in selection / instruction / generating phase) — the first exits silently with no confirmation.
- If the first has **a diff pending review** — confirmation modal: `"Discard pending Ghostwriter changes?"` `[Cancel]` / `[Discard]`. Cancel keeps the first bubble in mode; Discard exits the first and enters the second.

### What enter does

- Sets `workspaceStore.ghostwriter.activeMessageId = <message id>`.
- Renders the bubble with a pulsing accent frame (`outline 2px solid var(--color-ghostwriter)`, `outline-offset 3px`, opacity-only pulse 1500 ms ease-in-out infinite — Doc 11 transition catalogue).
- Switches the bubble's content rendering from Markdown to **plain text**: `**bold**` shows literally as `**bold**`, headings render as `# Heading`, code fences are visible. This is required for character-offset accuracy against the stored `content` string.
- Mounts the floating panel pinned to the bubble (see §Floating Panel).

---

## Floating Panel

The Ghostwriter UI is a panel that floats **to the right of the active AI bubble** in the Theater's right gutter (the space between the bubble's right edge and the right pane). It does **not** overlay the right pane — the right pane stays visible and interactive.

### Vertical clamping

The panel sticks to the viewport while the bubble is on screen, but is bounded by the bubble's vertical extent:

- `panel.top ≥ bubble.top` (the panel never floats above where the bubble starts).
- `panel.bottom ≤ bubble.bottom` (the panel never extends below where the bubble ends).
- Within those bounds, the panel hugs the viewport top with a small padding so it stays visible during scroll.

Concretely:
```
panel.top = clamp(viewport.top + 16px, bubble.top, max(bubble.top, bubble.bottom - panel.height))
```

When the bubble is short (panel height > bubble height), the panel renders aligned to the bubble's top edge and may be clipped at the bubble's bottom — it does not grow to overlap subsequent bubbles. ⚠️ Visual phase may revisit: alternative is a smaller condensed panel for short bubbles.

### Off-screen behaviour

- Bubble scrolls fully above the viewport: panel disappears with the bubble. Mode is still active; scrolling back reveals the panel.
- Bubble scrolls fully below the viewport: same — panel disappears.

Mode is **not** automatically exited by scroll; only explicit cancel / accept / reject / Escape exits it.

### Panel dimensions

- Width: `~300 px` ⚠️ provisional. Owned by visual design phase.
- Height: content-driven (instruction textarea ~60 px + buttons + diff-state controls). Min ~140 px.
- Right margin from the right pane: `~16 px` ⚠️ provisional.

### Panel states

The panel renders one of three states based on `workspaceStore.ghostwriter.phase`:

| Phase | Trigger | Panel content |
|---|---|---|
| `selecting` | Just entered mode; no selection or selection too short | Header `✦ Ghostwriter`, hint `"Select at least one word in the message…"`, disabled instruction textarea, disabled `Generate ✦` |
| `composing` | Selection ≥ 1 word | Header `✦ Ghostwriter`, instruction textarea (autofocus on transition into this phase), `[Cancel]` + `[Generate ✦]` (enabled when textarea non-empty) |
| `generating` | Generate clicked, awaiting response | Header `✦ Ghostwriter — Generating…`, instruction textarea disabled, `[Cancel]` (calls `cancel_ghostwriter_generation`), no `Generate ✦` |
| `reviewing` | Response arrived, diff calculated | Header `✦ Ghostwriter — Review changes`, hint `"Changed sections are highlighted."`, `[Reject]` + `[Accept ✓]` |

The panel is the **only** Ghostwriter UI surface — there is no inline toolbar inside the bubble, no popover anchored to the selection, no header bar above the bubble.

---

## Selection

While the bubble is in Ghostwriter mode (`activeMessageId` is set):

- Standard browser selection works inside the bubble (`mousedown` + drag, `Shift+Click`, double-click word, triple-click line).
- The selection is captured by a `selectionchange` listener scoped to the active bubble. Selections elsewhere on the page are ignored.
- The selected text is highlighted with `--color-ghostwriter-subtle` to make it visually distinct from the regular browser selection-blue.
- LOOM tracks:
  ```ts
  interface GhostwriterSelection {
    startOffset: number;   // character offset in messages.content
    endOffset:   number;
    selectedText: string;
  }
  ```
- Offsets are computed against the **plain-text** rendering (which is identical to `messages.content` since no Markdown post-processing happened).

### Selection constraints

- Must be entirely within the active bubble. A selection that crosses out of the bubble is treated as if it ended at the bubble boundary.
- Must be at least **one word** — defined as containing at least one non-whitespace character bounded by whitespace or content boundaries. If the selection contains only whitespace, the panel stays in `selecting` phase.
- Programmatic selections (e.g. `Ctrl+A` within the bubble) are accepted.

### Phase transitions

- `selecting → composing` — selection becomes valid (≥ 1 word).
- `composing → selecting` — selection cleared or shrunk below 1 word.
- `composing → generating` — `Generate ✦` clicked.
- `generating → reviewing` — backend returns; diff calculated.
- `generating → selecting` — `Cancel` clicked mid-generation (the selection is preserved; the writer can re-edit instruction and try again).
- `reviewing → exit` — `Accept ✓` or `Reject` clicked, or Escape pressed (with confirmation).
- Any phase → exit — Escape (with confirmation if `reviewing`).

---

## Request Assembly

Ghostwriter sends a separate API call from `send_message`. The protocol is **surgical stitching**: the model receives the full original AI message split into three tagged sections, rewrites only the middle section, and the frontend stitches the response into the original at the recorded character offsets.

### System instruction

The runtime value is read from `app_settings.prompt_ghostwriter` (Developer-only setting per Doc 03 §settings cascade; restorable to default). Default text:

```
You are a ghostwriter assisting a writer with targeted revisions to story text.

You will receive a revision request containing three tagged sections:

<context_before>: The full text preceding the selection within the same response.
                  Do NOT include this in your output.
<selected_passage>: The text to revise. This is the ONLY part you rewrite.
<context_after>: The full text following the selection within the same response.
                 Do NOT include this in your output.

Rules:
1. Rewrite ONLY the selected passage according to the writer's instruction.
2. Match the tone, voice, and style of the surrounding context.
3. Preserve paragraph structure unless the instruction explicitly asks to change it.
4. Return ONLY the revised passage — no tags, no preamble, no commentary, no surrounding text.
```

### History

The conversation history sent with the request includes **everything up to and including the AI message being edited**. This is critical — the model needs the broader narrative context (prior story, attached docs, characters) to produce a revision that matches voice and continuity.

History assembly is mode-aware:

| Mode of the edited message | History |
|---|---|
| Story | All story-kind messages with `created_at ≤ edited_message.created_at`, with the same accordion / feedback / fake-pair substitutions as a regular `send_message` call (Doc 15) |
| Handover | Story-history-to-`entry_message_id` (per Doc 23) + this session's messages up to and including the edited one |
| Consulting | Same as handover, with the consulting-session SI |

Source documents (Doc 18) are included in the prefix exactly as they would be for a regular send in that mode.

### User turn (the last turn in the request)

The Ghostwriter call appends one final user turn after the history:

```
<context_before>{everything in the AI message before selection.startOffset}</context_before>
<selected_passage>{messages.content.slice(selection.startOffset, selection.endOffset)}</selected_passage>
<context_after>{everything in the AI message after selection.endOffset}</context_after>
Instruction: {writer's instruction string}
```

The model sees its own prior message via the history's tail (the model turn for the edited message). The tag block in the user turn is the splice context — the model knows *where in that message* the writer wants surgery.

### Response

The model returns **only the rewritten passage** — no tags, no preamble. The frontend stitches:

```ts
const newContent =
  original.slice(0, selection.startOffset) +
  response.trim() +
  original.slice(selection.endOffset);
```

If the model defies instructions and includes tag wrappers, the frontend strips a leading `<selected_passage>` and trailing `</selected_passage>` defensively before stitching.

### Generation parameters

Ghostwriter calls use the same world-overridable `gen_*` parameters (Doc 03 §settings cascade) as story turns. v2.0 does **not** introduce a separate `gen_ghostwriter_*` cascade — the writer's chosen voice/temperature for story prose is the right starting point for in-place revision. Future work may revisit if writers report a need.

### Non-streaming

Ghostwriter responses do not stream. The full response arrives in one chunk and the diff is calculated on completion. Reasoning:
- Stitched responses are typically a paragraph or less; streaming gain is marginal.
- A flickering diff visual during streaming is more distracting than helpful.
- Cancellation is trivial without a stream subscription to tear down.

### Rate limiting

Ghostwriter shares the `'text'` rate-limit window with story / session generations. The pre-flight `check_rate_limit('text')` runs identically (Doc 22 §Rate Limiting). Hitting the limit raises a toast and aborts the generation; the panel returns to `composing` with the instruction preserved.

### `isGenerating` global lock

`workspaceStore.isGenerating` (Doc 15) goes `true` for the duration of a Ghostwriter call, blocking story / session sends and all other generations (accordion summarise, etc.). Symmetrically, attempting to enter Ghostwriter mode while another generation is in flight is allowed (the writer can prepare instruction and selection) but `Generate ✦` is greyed with tooltip `"Generation already in progress"` until the other generation completes or is cancelled.

---

## Diff Display

Once the response is stitched, the bubble re-renders in plain-text mode (still inside Ghostwriter mode) with **word-level changed regions highlighted**.

### Algorithm

Word-level Longest Common Subsequence (LCS) diff between `original` and `newContent`. Word boundaries are whitespace + punctuation. The diff produces an array of spans:

```ts
type DiffSpan =
  | { kind: 'unchanged'; text: string }
  | { kind: 'changed'; text: string };
```

Implementation: client-side, using a small LCS routine. ⚠️ Library choice (`diff`, `diff-match-patch`, custom) deferred to implementation phase.

### Visual

- **Unchanged spans** render as normal plain text (still no Markdown — the bubble is in Ghostwriter mode until the writer accepts or rejects).
- **Changed spans** render with `--color-ghostwriter-diff` background at ~30 % opacity and a subtle 1 px underline `--color-ghostwriter-diff`. ⚠️ Exact treatment owned by visual design phase.

The original content is no longer shown in the bubble — only the new content with diff markers. The writer reads the new prose with their eye drawn to the changes.

### Panel state

The panel switches to `reviewing`:
```
✦ Ghostwriter — Review changes
Changed sections are highlighted.

[Reject]                                [Accept ✓]
```

---

## Accept Flow

`Accept ✓` is the writer's commitment. With branching gone, the rule is **in-place edit only**:

1. Frontend assembles a `GhostwriterEditRecord`:
   ```ts
   interface GhostwriterEdit {
     edited_at: string;        // ISO 8601
     original_content: string; // content before this edit
     new_content: string;      // content after this edit
     instruction: string;      // the instruction used
     selected_text: string;    // the passage that was targeted
   }
   ```
2. **Cached-message protection (Doc 22):** if the edited message is at or before the cache's `last_cached_message_id`, a confirmation modal appears: `"This message is in the cached prefix. Editing will invalidate the cache."` `[Cancel]` / `[Edit anyway]`. Dismissal proceeds and marks the cache stale; cancel returns to `reviewing`.
3. Frontend calls `save_ghostwriter_edit(message_id, new_content, edit_record)`.
4. Backend (single transaction):
   - Reads current `ghostwriter_history` JSON.
   - Appends the edit record.
   - Updates `messages.content = new_content`.
   - Updates `messages.ghostwriter_history = updated_json`.
5. **Accordion-stale rule (Doc 16):** if the edited message is inside a collapsed accordion segment, the segment is marked `is_stale = 1` silently. No toast; the banner's `⚠` badge surfaces it.
6. **Cache-stale rule (Doc 22):** if the message is in either cache's range (story or active consulting), the relevant cache is marked stale. `cache_state_changed` emitted.
7. Frontend exits Ghostwriter mode: pulse frame removed, plain-text rendering swapped back to Markdown, panel unmounted.
8. `[Revert]` button becomes visible in the action row (see §Revert).

### Subsequent messages are not touched

If the edited message has descendants (N+1, N+2, …), they remain unchanged. The writer is responsible for noticing if the rewrite has created downstream inconsistency. If so, the writer can:
- Use Doc 15 `delete_from(N+1)` to discard descendants and regenerate.
- Use Ghostwriter on subsequent messages to align them.
- Manually edit user messages (Doc 15 `edit_user_message`) and let the model re-generate.

This decision is deliberate — Ghostwriter is a wordsmithing pass, not a replot. Truncate-and-replace is what `edit_user_message` is for.

---

## Reject Flow

`Reject` discards the diff:
1. Bubble re-renders the original `messages.content` (no DB write — content was never persisted).
2. Plain-text rendering remains active; the panel returns to `composing` with the original instruction and selection preserved (the writer can adjust and re-Generate).

Reject does **not** exit Ghostwriter mode. To exit entirely, the writer presses Escape (which respects the §Escape Chain) or the panel's `Cancel` (in `composing`).

---

## Revert (Per-Message Edit History)

Every accepted Ghostwriter edit appends to `messages.ghostwriter_history`. When this array is non-empty, the bubble's action row shows a `[Revert]` button (`lucide-react RotateCcw`, 14 px, `--color-text-muted`).

Click `[Revert]`:
- Reads the **last** entry from `ghostwriter_history`.
- Calls `save_ghostwriter_edit(id, last_entry.original_content, updated_history)` where `updated_history` is the array minus its last element.
- Backend updates content + truncated history in one transaction.
- Bubble re-renders with the restored content.

No confirmation modal. Revert is reversible by re-applying Ghostwriter (the writer's instruction and selection are not preserved across revert / re-accept).

### Cached-message protection on revert

Revert mutates `messages.content`, so the same Doc 22 protection applies — confirmation modal if the message is in the cached prefix.

### Accordion-stale rule on revert

Same as accept — segment marked stale silently if the message is in a collapsed segment.

### Multiple edits

The writer can ghostwrite the same message multiple times. Each accept appends a new history entry. Revert always restores to the **most recent** prior version, popping one entry per click. After all entries are popped, the message returns to its original AI-generated content and `ghostwriter_history = []`. The `[Revert]` button hides.

### History persistence

`ghostwriter_history` is part of the message row — it survives world close, app restart, and is included in story exports (Doc 21 owns the export shape).

---

## Cancel Flow

`Cancel` in the panel:

- **In `composing`** — exits Ghostwriter mode. No DB write, no API call.
- **In `generating`** — calls `cancel_ghostwriter_generation` to abort the in-flight request, returns the panel to `selecting` (preserving the typed instruction in case the writer wants to try again). Silent — no toast.

### Escape Chain

Per Doc 11 §Escape, Ghostwriter sits at priority 3 (above editor unsaved-changes guard). Escape semantics by phase:

| Phase | Escape behaviour |
|---|---|
| `selecting` | Exit Ghostwriter mode. No confirmation. |
| `composing` | Exit Ghostwriter mode. Instruction and selection are discarded. No confirmation (low cost — the writer can re-enter). |
| `generating` | Cancel the request (same as panel `Cancel`); exit mode. Silent. |
| `reviewing` | Confirmation modal: `"Discard pending Ghostwriter changes?"` `[Cancel]` / `[Discard]`. Discard exits mode without persisting. |

### Navigating away

If the writer clicks a different story or item in the Navigator, opens a doc, switches modes, or locks the vault while Ghostwriter mode is active:
- `selecting` / `composing` — exit silently.
- `generating` — cancel + exit silently.
- `reviewing` — same `Discard pending Ghostwriter changes?` modal blocks the navigation until the writer chooses.

Vault lock during `generating` follows Doc 13 §Lock — pending generation is cancelled, mode exited, then keys zeroed.

---

## Backend API

All commands live in `commands/ghostwriter.rs`.

### `send_ghostwriter_request`

```rust
#[tauri::command]
pub async fn send_ghostwriter_request(
    state: State<'_, AppState>,
    message_id: String,         // the AI message being edited
    selection_start: usize,     // character offset (UTF-16 code units, matching JS)
    selection_end: usize,
    instruction: String,        // writer's instruction
) -> Result<GhostwriterResponse, LoomError>

pub struct GhostwriterResponse {
    pub revised_passage: String,  // model's output, ready for stitching
    pub token_count: u32,
}
```

**Preconditions:** vault unlocked; story active; `message_id` resolves to a model message in this story; `selection_end > selection_start`; both offsets within `messages.content` length; `instruction` non-empty after trim; rate limit allows; no other generation in flight.

**Behaviour:**
1. Reads the message and validates offsets.
2. Slices `original_content` into `before / selected / after`.
3. Assembles history per the message's `kind` (story / handover / consulting).
4. Composes the request (SI = `prompt_ghostwriter`; final user turn = the tag block + instruction).
5. Calls Gemini non-streaming.
6. Returns `revised_passage` and token count.
7. Records usage on the `'text'` rate limiter.

**Errors:** `Validation` (offset out of range, selection empty, instruction empty), `RateLimited`, `ApiError`, `NotFound`, `Database`.

### `cancel_ghostwriter_generation`

```rust
#[tauri::command]
pub async fn cancel_ghostwriter_generation(
    state: State<'_, AppState>,
) -> Result<(), LoomError>
```

Idempotent. Aborts the in-flight request via the same cancellation infrastructure as `send_message` (`AbortHandle` / `CancellationToken` per Doc 15 §Cancellation Taxonomy). Silent (no event emitted; the awaiting frontend treats the dropped request as a cancellation).

### `save_ghostwriter_edit`

```rust
#[tauri::command]
pub async fn save_ghostwriter_edit(
    state: State<'_, AppState>,
    message_id: String,
    new_content: String,
    history_entry: GhostwriterEditRecord,
) -> Result<(), LoomError>
```

**Preconditions:** vault unlocked; story active; message exists; cached-message protection has been observed at the call site (frontend has shown the modal if applicable; backend does not double-check).

**Behaviour (single transaction):**
1. Reads current `ghostwriter_history`.
2. Appends `history_entry`.
3. Updates `messages.content = new_content`.
4. Updates `messages.ghostwriter_history = updated_json`.
5. Marks containing accordion segment stale (Doc 16) if applicable.
6. Marks cache stale (Doc 22) if the message is in a cached prefix; emits `cache_state_changed`.

**Errors:** `Validation`, `NotFound`, `Database`.

### `revert_ghostwriter_edit`

```rust
#[tauri::command]
pub async fn revert_ghostwriter_edit(
    state: State<'_, AppState>,
    message_id: String,
) -> Result<RevertResult, LoomError>

pub struct RevertResult {
    pub restored_content: String,
    pub remaining_history_len: usize,
}
```

**Preconditions:** vault unlocked; message exists; `ghostwriter_history` is non-empty; cached-message protection observed at call site.

**Behaviour (single transaction):**
1. Pops the last entry from `ghostwriter_history`.
2. Restores `messages.content = popped.original_content`.
3. Updates `messages.ghostwriter_history = truncated_json`.
4. Marks containing accordion segment stale (Doc 16) if applicable.
5. Marks cache stale if applicable; emits `cache_state_changed`.

Returns the restored content and the new history length so the frontend can re-render and update the `[Revert]` button visibility.

**Errors:** `Validation` (history empty), `NotFound`, `Database`.

---

## Frontend State (`workspaceStore`)

Ghostwriter state lives on `workspaceStore`, not a separate store. Per pattern consistency with accordion (Doc 16) — story-scoped, message-scoped, no cross-story persistence.

```typescript
interface WorkspaceStore {
  // ...existing fields...

  ghostwriter: {
    activeMessageId: string | null;          // the bubble in mode; null = no mode
    phase: 'selecting' | 'composing' | 'generating' | 'reviewing';
    selection: GhostwriterSelection | null;  // current selection in active bubble
    instruction: string;                     // textarea value
    diff: DiffSpan[] | null;                 // populated in `reviewing`
    pendingNewContent: string | null;        // the stitched result, awaiting accept/reject
  } | null;

  // Actions
  enterGhostwriter: (messageId: string) => Promise<void>;  // shows discard modal if needed
  exitGhostwriter: () => void;
  setGhostwriterSelection: (sel: GhostwriterSelection | null) => void;
  setGhostwriterInstruction: (text: string) => void;
  generateGhostwriter: () => Promise<void>;       // calls send_ghostwriter_request; transitions to reviewing
  cancelGhostwriterGeneration: () => Promise<void>;
  acceptGhostwriter: () => Promise<void>;         // calls save_ghostwriter_edit
  rejectGhostwriter: () => void;                  // returns to composing, preserves instruction
  revertGhostwriter: (messageId: string) => Promise<void>;  // calls revert_ghostwriter_edit
}
```

The `ghostwriter` field is `null` when no mode is active (the panel and frame are not rendered).

---

## Accordion Interaction (cross-reference)

Owned by Doc 16 §Accordion + Ghostwriter Interaction. Recap for completeness:
- The bubble must be visible to be ghostwritten — the writer expands the accordion segment first if it's collapsed.
- On accept (or revert), the containing segment is marked `is_stale = 1` silently. The banner's `⚠` badge is the only indicator; no toast.

---

## Cache Interaction (cross-reference)

Owned by Doc 22 §Cached-message Edit/Delete Protection. Recap:
- Accept / revert that touches a cached message → confirmation modal at the frontend (`"This message is in the cached prefix…"`).
- Cancel returns to `reviewing` (or aborts revert).
- Edit anyway proceeds; cache marked stale; `cache_state_changed` emitted.

---

## Edge Cases and Error Handling

| Scenario | Behaviour |
|---|---|
| Selection extends across the bubble boundary | Treated as if it ended at the bubble boundary (`selectionchange` clamps to the active bubble's text node range). |
| Selection is whitespace only | Phase stays `selecting`; `Generate ✦` disabled. |
| Selection contains `<context_before>` / `<selected_passage>` / `<context_after>` literal text | Sent as-is; the model is instructed to ignore tags in the input it produces. The frontend's defensive strip (§Request Assembly) removes any wrapper the model echoes. |
| Model returns empty string | Stitch produces `before + after` (the selection is deleted). Diff renders the deletion as a changed span (the deleted words). Writer accepts or rejects normally. |
| Model returns a response longer than the original | Stitched normally — the bubble grows. |
| Model defies instructions and returns the full message | Stripped where possible, otherwise stitched as-is (the writer reviews the diff and rejects if wrong). |
| Generation fails (HTTP / network / API error) | Toast `"Couldn't generate revision — <reason>"`; panel returns to `composing` with instruction preserved. Rate limit not consumed (mirrors `send_message` behaviour). |
| Generation cancelled mid-flight | Silent. Panel returns to `selecting`. |
| Vault lock during `generating` | Generation cancelled, mode exited, keys zeroed (Doc 13). |
| World switch during `generating` | Same — cancelled then switched. |
| Story switch during `reviewing` | Confirmation modal `"Discard pending Ghostwriter changes?"`. |
| Editor opens (Doc 18) during Ghostwriter mode | Modal blocks if `reviewing`; otherwise silent exit. |
| Bubble that's been ghostwritten is then deleted via `delete_exchange` / `delete_from` | History is gone with the message (cascade). The Revert path is no longer available — there's nothing to revert to. |
| Accordion segment containing the bubble is deleted | Same — message gone, history gone. |
| Concurrent ghostwriter on a different bubble | Blocked by one-bubble-at-a-time rule; entering elsewhere shows the discard modal if `reviewing`, otherwise silent exit. |
| Selection within a `blocks`-content message | Action-row button hidden; right-click entry disabled with tooltip `"Ghostwriter on mixed text/image messages is coming in v2.1"`. |
| Selection across UTF-16 surrogate pairs | Offsets must align to code-unit boundaries; the frontend uses the standard JS `Selection` API which already enforces this. The Rust side accepts `usize` offsets in UTF-16 code units to match. |
| Markdown in original | Plain-text rendering shows raw markdown; selection offsets map directly to `messages.content`. |

---

## Out of Scope

- **`content_type = 'blocks'` support** — interleaved text + image messages. PATCH-16 from v1 captured the design (text-only concatenation for selection, image blocks preserved by index, history stores `previous_text_blocks`); deferred to v2.1 alongside image generation (Doc 19, blocked on TODO Q1/Q2). The action row hides the Ghostwriter button on blocks messages.
- **Streaming Ghostwriter responses** — non-streaming chosen for v2.0; revisit if writers report perceived latency on long passage rewrites.
- **Branching on accept** — gone with branching as a whole. v1's "Edit a non-latest message → create a new branch" is replaced by in-place-only edits.
- **Undo stack across all ghostwriter operations** — `[Revert]` is per-message, popping one entry at a time. Multi-message undo is the v2.1 operation log (`docs-v2/future/undo-redo.md`).
- **Side-by-side diff view** — v2.0 ships inline highlighted-new only.
- **Per-mode `prompt_ghostwriter` overrides** — single global prompt; Developer-editable.
- **Separate `gen_ghostwriter_*` cascade** — Ghostwriter uses world-resolved `gen_*` parameters. Future enhancement if writers report tuning needs.
- **Ghostwriter on user messages** — user messages are the writer's authored input; they're already directly editable via `edit_user_message` (Doc 15).
- **Selection of multiple non-contiguous spans in one pass** — single contiguous selection only.
- **Auto-suggest instructions** ("Make this more vivid", "Tighten this paragraph") — future enhancement; v2.0 is freeform textarea only.

---

## Cross-References

- **Doc 03** — `messages.ghostwriter_history` JSON column; canonical `GhostwriterEdit` interface; `prompt_ghostwriter` Developer-only setting; `ghostwriter_color` setting key (drives `--color-ghostwriter` and derived tokens).
- **Doc 06** — `workspaceStore.ghostwriter` field and actions.
- **Doc 07** — `commands/ghostwriter.rs` command domain.
- **Doc 11** — Escape chain (Ghostwriter at priority 3); animation catalogue (pulse).
- **Doc 13** — Vault lock cancels in-flight Ghostwriter generation.
- **Doc 14** — Story switch / world switch / item delete behaviour during Ghostwriter mode.
- **Doc 15** — `update_message_content` is the underlying write path (Ghostwriter writes via the same column); `isGenerating` global lock; cancellation taxonomy.
- **Doc 16** — Accordion + Ghostwriter interaction (silent stale on accept / revert).
- **Doc 18** — DocEditor open during Ghostwriter mode (silent exit unless `reviewing`).
- **Doc 22** — Cached-message edit protection on accept and revert; cache stale rules.
- **Doc 23** — Mode availability (story / handover / consulting); per-mode history assembly.
- **Doc 27** — AI bubble region container; floating panel sits in the right gutter.
