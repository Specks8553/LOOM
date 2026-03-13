# 16 — Ghostwriter

## Purpose

Ghostwriter is LOOM's targeted AI revision tool. It allows the writer to select
a specific passage within an AI-generated message, provide an instruction (what
to change and how), and receive a rewritten version of the full message — with
only the selected portion changed. The result is shown as a diff before the
writer decides to accept or reject it.

> **Coding-agent note:** Ghostwriter state is managed in `ghostwriterStore.ts`.
> The API request is made via `send_ghostwriter_request` Tauri command, separate
> from the normal `send_message` flow. Rate limiting applies identically.
> Ghostwriter history is persisted in `messages.ghostwriter_history` (JSON array).

---

## 1. Trigger

Ghostwriter is available exclusively on **AI (model) message bubbles**.
It is not available on user message bubbles.

### 1.1 Access Points

- **Action row:** `✦ Ghostwriter` button (first action in the hover row below any AI bubble)
- **Right-click context menu** on an AI bubble → `Ghostwriter…`

Both triggers use the same flow: **Mode-first** — the bubble enters Ghostwriter
Mode before the user selects text.

---

## 2. Ghostwriter Mode

### 2.1 Entering Ghostwriter Mode

When the user clicks `✦ Ghostwriter`:

1. The AI bubble **enters Ghostwriter Mode**:
   - Accent-color frame (`--color-ghostwriter-frame`) appears around the bubble
   - Markdown rendering is paused — content is rendered as **plain text** (no bold,
     italic, headings) to allow precise text selection
   - A Ghostwriter toolbar appears below the bubble frame

2. The toolbar:

```
┌──────────────────────────────────────────────────────────────────────┐
│  ✦ Ghostwriter Mode                                                  │
│  Select text in the passage above, then describe what to change.     │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ Make the pacing slower. Add sensory details about the rain.    │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  [Cancel]                                    [Generate ✦]            │
└──────────────────────────────────────────────────────────────────────┘
```

- **Instruction textarea:** `<textarea>`, `min-height: 60px`, placeholder:
  *"Describe what to change about the selected text…"*
- `[Generate ✦]` is **disabled** until:
  - Text is selected in the bubble (selection non-empty)
  - Instruction field is non-empty
- `[Cancel]`: exits Ghostwriter Mode, no changes made

### 2.2 Text Selection

The user selects text directly in the plain-text-rendered bubble using standard
browser selection (`mousedown` + drag or `Shift+Click`).

Selected text is highlighted with `--color-ghostwriter-diff` at reduced opacity
to indicate the selection region.

LOOM tracks:
```ts
interface GhostwriterSelection {
  startOffset: number;  // character offset in full message content
  endOffset:   number;
  selectedText: string;
}
```

Character offsets are calculated from the plain-text content (not rendered HTML).

### 2.3 Multiple Bubbles

Only one bubble can be in Ghostwriter Mode at a time. Entering Ghostwriter Mode
on a second bubble automatically exits the first (with discard — no confirmation
if the first had no diff yet).

---

## 3. API Request

### 3.1 What is Sent to Gemini

Ghostwriter sends a **separate API request** from normal story generation.
The request is assembled as follows:

**History included:** Only the messages up to (and including) the **user message**
that immediately precedes the AI message being edited (Message N-1). The original
AI message being edited is NOT included in history.

**System instruction for Ghostwriter:**

The following is the **default** text. It is editable in Settings → Developer →
AI Prompt Templates (setting key: `prompt_ghostwriter`). The runtime value is
always read from the `settings` table.

```
You are assisting a writer with targeted revisions to AI-generated story text.

The writer has selected a specific passage and provided an instruction.
Your task:
1. Rewrite ONLY the marked passage according to the instruction.
2. The rest of the message must remain word-for-word identical.
3. Return the COMPLETE message with the revision applied.
4. Do not add commentary, preamble, or explanation — return only the full revised message text.

Selected passage:
<<<SELECTED>>>
{selected_text}
<<<END>>>

Writer's instruction:
{instruction}

Original message (return this in full with only the selected passage changed):
{original_message_content}
```

This instruction is sent as the **system prompt** for the Ghostwriter request,
separate from the world's normal system instructions.

### 3.2 Rate Limiting

Before `send_ghostwriter_request`:
1. Call `check_rate_limit("text")` — same as normal send
2. If `can_proceed: false` → show rate limit banner, abort Ghostwriter generation

After `send_ghostwriter_request` completes:
1. Call `record_usage("text", token_count)`
2. Call `telemetryStore.refresh()`

### 3.3 `send_ghostwriter_request` Tauri Command

```rust
#[tauri::command]
pub async fn send_ghostwriter_request(
    state: tauri::State<'_, AppState>,
    message_id: String,        // the AI message being edited
    selected_text: String,     // the passage selected by the user
    instruction: String,       // the writer's instruction
    original_content: String,  // full current message content
    story_id: String,          // for history reconstruction (server-side)
    leaf_id: String,           // current branch leaf
) -> Result<GhostwriterResult, LoomError>

pub struct GhostwriterResult {
    pub new_content: String,      // full revised message
    pub token_count: u32,
}
```

**History assembly:** The backend reconstructs history server-side (same as
`send_message`). Only messages up to (and including) the user message that
immediately precedes the AI message being edited (N-1) are included. The
original AI message being edited is NOT included in history.

### 3.4 Generation Behaviour

Ghostwriter responses are **not streamed**. The response is returned as a
complete string once generation finishes.

During generation:
- **`workspaceStore.isGenerating = true`** — this blocks normal story sends
  and triggers lock/switch confirmations
- `ghostwriterStore.isGenerating = true` — additional flag for Ghostwriter-specific UI
- `[Generate ✦]` button replaced by spinner + *"Generating…"* label
- `[Cancel]` calls `cancel_ghostwriter_generation()` (aborts request)

On completion or cancellation:
- `workspaceStore.isGenerating = false`
- `ghostwriterStore.isGenerating = false`

---

## 4. Diff Display

### 4.1 Diff Calculation

Once the response arrives, LOOM calculates a text diff between the original
message content and the new content using a character-level or word-level diff
algorithm (e.g., `diff-match-patch` ported to Rust or calculated client-side).

Changed passages are identified as `{ type: "changed" | "unchanged", text: string }` spans.

### 4.2 Visual Diff in Bubble

The bubble renders the diff:
- **Unchanged spans:** normal text
- **Changed spans:** highlighted with `--color-ghostwriter-diff` at 30% opacity,
  with a subtle `1px solid var(--color-ghostwriter-diff)` underline
- The original plain text is no longer visible (only the new content is shown,
  with changed regions highlighted)

```
Her hands trembled as she [broke] the [seal, the wax
crumbling like old bone under her fingers]. Three letters
in her dead brother's hand stared back at her.
       ↑ changed span highlighted    ↑ also changed
```

### 4.3 Accept/Reject Toolbar (Diff State)

Toolbar updates after diff is available:

```
┌──────────────────────────────────────────────────────────────────────┐
│  ✦ Ghostwriter — Review changes                                      │
│  Changed sections are highlighted.                                   │
│                                                                       │
│  [Reject]                            [Accept changes ✓]             │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 5. Accept Flow

### 5.1 Case A: Editing the Latest Message (Same-Branch)

When the message being edited `id === workspaceStore.currentLeafId`:

1. Call `save_ghostwriter_edit(message_id, new_content, ghostwriter_edit_record)`
2. Backend: updates `messages.content = new_content` in-place
3. Backend: appends edit record to `messages.ghostwriter_history`
4. Frontend: removes Ghostwriter frame, restores Markdown rendering
5. Bubble content updates to `new_content`
6. `[Revert]` button becomes visible in action row

### 5.2 Case B: Editing a Non-Latest Message (New Branch)

When the message being edited is not the current leaf (it has descendants):

Accept dialog:

```
Create a new branch?
  Accepting this change will create a new branch from this point.
  The original continues on its branch.

                    [Cancel]   [Accept and Branch]
```

On `[Accept and Branch]`:
1. Create new user message as sibling of the message's parent user message
   (same `UserContent`)
2. Create new model message child with `new_content`
3. Call `save_ghostwriter_edit(new_message_id, new_content, edit_record)`
4. `currentLeafId` updates to the new model message
5. Ghostwriter frame removed

---

## 6. Reject / Cancel Flow

### 6.1 Reject (After Diff Shown)

User clicks `[Reject]` after diff is shown:

1. Bubble reverts to original content
2. Ghostwriter frame removed
3. If a new branch was created (Case B): branch and its messages are deleted
4. No DB changes

### 6.2 Cancel (Before Generation)

User clicks `[Cancel]` before clicking `[Generate]`:
- Ghostwriter Mode exited
- No API call made, no changes

### 6.3 Cancel During Generation

User clicks `[Cancel]` while generating:
- `cancel_ghostwriter_generation()` called
- Ghostwriter Mode exited
- No changes

### 6.4 Escape Key

If Ghostwriter Mode is active (Priority 4 in Escape chain):
- If diff is shown: show *"Discard Ghostwriter changes?"* confirmation (see `03-Empty-States-and-Edge-Case-UI.md §11`)
- If diff not shown (selection phase): exit without confirmation

### 6.5 Navigation Away

If the user clicks a different story or item in the Navigator while
Ghostwriter Mode is active:
- Treated as Escape (§6.4)
- If new branch was created: branch destroyed on discard

---

## 7. Ghostwriter History and Revert

### 7.1 `ghostwriter_history` Column

```sql
-- In messages table:
ghostwriter_history TEXT NOT NULL DEFAULT '[]'
-- JSON array of GhostwriterEdit objects
```

```ts
interface GhostwriterEdit {
  edited_at:        string;  // ISO timestamp
  original_content: string;  // content before this edit
  new_content:      string;  // content after this edit
  instruction:      string;  // the instruction used
  selected_text:    string;  // the passage that was targeted
}
```

Each accepted Ghostwriter edit appends one record to this array.
Multiple edits on the same message are all preserved.

### 7.2 Revert Button

When `ghostwriter_history` is non-empty, a `[Revert]` button (`lucide-react RotateCcw`,
`14px`) appears in the action row of the bubble.

Clicking `[Revert]`:
- Reverts to the **most recent prior version** (pops last entry from `ghostwriter_history`)
- If only one entry: reverts to original content, `ghostwriter_history = []`
- Calls `save_ghostwriter_edit(id, reverted_content, updated_history)`
- No confirmation required for revert

Revert is available only for the **current** version of the message.
It is not a full undo stack — it always reverts to the previous version.

---

## 8. `save_ghostwriter_edit` Tauri Command

```rust
#[tauri::command]
pub async fn save_ghostwriter_edit(
    state: tauri::State<'_, AppState>,
    message_id: String,
    new_content: String,
    history_entry: GhostwriterEditRecord,  // serialized edit record
) -> Result<(), LoomError>
```

Backend:
1. Reads current `ghostwriter_history` JSON from DB
2. Appends `history_entry`
3. Updates `messages.content = new_content`
4. Updates `messages.ghostwriter_history = updated_json`
5. Single transaction

---

## 9. Accordion Interaction

If the message being edited is inside a **collapsed Accordion segment**
(i.e., the segment has a summary and `is_collapsed = 1`), accepting the
Ghostwriter edit triggers a toast:

*"This message is inside a summarised chapter. Regenerate summary?"*
`[Regenerate Summary]` — calls Accordion's summarise command for that segment.
`[Dismiss]` — summary retained but is now stale (stale indicator shown on segment card).

---

## 10. `ghostwriterStore` (Zustand)

```ts
interface GhostwriterStore {
  activeMsgId:    string | null;
  selection:      GhostwriterSelection | null;
  instruction:    string;
  isGenerating:   boolean;
  pendingDiff:    GhostwriterDiff | null;  // null until diff calculated
  // Actions
  enter:          (msgId: string) => void;
  exit:           () => void;
  setSelection:   (sel: GhostwriterSelection) => void;
  setInstruction: (text: string) => void;
  setDiff:        (diff: GhostwriterDiff) => void;
  accept:         () => Promise<void>;
  reject:         () => void;
}
```

`activeMsgId` drives the accent frame on the bubble. Only one message can have
`activeMsgId` set at a time.

---

## 11. UI Details

### 11.1 Ghostwriter Button Label

`✦ Ghostwriter` — the `✦` (sparkle) character (`U+2736`) is used as the
Ghostwriter icon prefix throughout (not a lucide-react icon). This provides
a distinct visual identity for AI-assisted revision actions.

### 11.2 Plain-Text Mode During Selection

When in Ghostwriter Mode, the bubble content is rendered without Markdown
processing. This means:
- `**bold**` shows as `**bold**`
- `# Heading` shows as `# Heading`
- Code blocks show as raw text

This is intentional — it allows precise character-level text selection
matching the stored string content.

### 11.3 Bubble Frame During Active Mode

```css
.bubble-ghostwriter-active {
  outline: 2px solid var(--color-ghostwriter-frame);
  outline-offset: 3px;
  border-radius: 10px;  /* slightly larger than bubble radius to wrap it */
  animation: ghostwriter-pulse 2s ease-in-out infinite;
}

@keyframes ghostwriter-pulse {
  0%, 100% { outline-opacity: 1; }
  50%       { outline-opacity: 0.6; }
}
```

The pulse is subtle (opacity only, no size change) to signal active mode
without being distracting.
