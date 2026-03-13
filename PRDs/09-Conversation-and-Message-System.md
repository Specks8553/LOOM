# 09 — Conversation and Message System

## Purpose

This document specifies the full conversation model for LOOM: the DAG-based
message structure, the three-field user input model (Plot Direction, Background
Information, Modificators), streaming generation, branching, editing, stop
behaviour, safety handling, and the complete `messages` table schema.

> **Coding-agent note:** All message logic lives in `src-tauri/src/commands.rs`
> (send, edit, delete, regenerate) and `src-tauri/src/gemini.rs` (API call,
> stream parsing, request assembly). The frontend message state lives in
> `workspaceStore.messageMap: Map<string, ChatMessage>` and
> `workspaceStore.currentLeafId: string | null`. Branch reconstruction is
> performed server-side via SQLite Recursive CTE.

---

## 1. Message Data Model

### 1.1 `messages` Table

```sql
CREATE TABLE IF NOT EXISTS messages (
    id                  TEXT PRIMARY KEY,
    story_id            TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    parent_id           TEXT REFERENCES messages(id) ON DELETE SET NULL,
    role                TEXT NOT NULL CHECK(role IN ('user', 'model')),
    content_type        TEXT NOT NULL DEFAULT 'text'
                          CHECK(content_type IN ('json_user', 'text', 'blocks')),
    content             TEXT NOT NULL,
    token_count         INTEGER,
    model_name          TEXT,
    finish_reason       TEXT CHECK(finish_reason IN
                          ('STOP','MAX_TOKENS','SAFETY','ERROR', NULL)),
    created_at          TEXT NOT NULL,
    deleted_at          TEXT,
    user_feedback       TEXT,
    ghostwriter_history TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_messages_story
    ON messages(story_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_parent
    ON messages(parent_id);
```

### 1.2 Content Type Mapping

| role | content_type | content value |
|---|---|---|
| `"user"` | `"json_user"` | `{"plot_direction":…,"background_information":…,"modificators":[…]}` |
| `"model"` | `"text"` | Plain Markdown string |
| `"model"` | `"blocks"` | JSON array of `MessageBlock[]` (when inline images present) |

Never detect content type via prefix — always use `content_type` field.

### 1.3 `ChatMessage` TypeScript Interface

```ts
export interface UserContent {
  plot_direction: string;
  background_information: string;
  modificators: string[];
}

export interface ChatMessage {
  id: string;
  story_id: string;
  parent_id: string | null;
  role: "user" | "model";
  content_type: "json_user" | "text" | "blocks";
  content: string;
  token_count: number | null;
  model_name: string | null;
  finish_reason: "STOP" | "MAX_TOKENS" | "SAFETY" | "ERROR" | null;
  created_at: string;
  deleted_at: string | null;
  user_feedback: string | null;
  ghostwriter_history: GhostwriterEdit[];
}

export function parseMessageContent(msg: ChatMessage): string | UserContent | MessageBlock[] {
  switch (msg.content_type) {
    case "json_user": return JSON.parse(msg.content) as UserContent;
    case "blocks":    return JSON.parse(msg.content) as MessageBlock[];
    case "text":
    default:          return msg.content;
  }
}
```

### 1.4 `items` Table — Story Description Field

Stories have an optional description field for synopsis/notes:

```sql
ALTER TABLE items ADD COLUMN description TEXT NULL;
```

New Tauri command:
```rust
#[tauri::command]
pub async fn update_item_description(
    state: tauri::State<'_, AppState>,
    id: String,
    description: String,
) -> Result<(), LoomError>
```

Description is shown:
- As a tooltip on hover in the vault tree
- In the Control Pane below the story title (editable inline)
- In the `<NoStorySelected />` recent stories list

---

## 2. DAG Structure

### 2.1 Branch Model

Messages form a tree (DAG). Each message has one `parent_id` (or null for root).
Multiple children of the same parent are sibling branches.

`workspaceStore.currentLeafId` tracks the currently viewed leaf. The active branch
is the path from root → `currentLeafId` reconstructed via server-side Recursive CTE.

### 2.2 Branch Reconstruction (Server-Side)

`load_story_messages` performs branch reconstruction server-side:

**Active branch** (root → leaf, ordered):
```sql
WITH RECURSIVE branch AS (
  SELECT id, parent_id, role, content, content_type, token_count,
         model_name, finish_reason, created_at, user_feedback,
         ghostwriter_history, 0 AS depth
  FROM messages
  WHERE id = ?   -- currentLeafId
    AND deleted_at IS NULL
  UNION ALL
  SELECT m.id, m.parent_id, m.role, m.content, m.content_type,
         m.token_count, m.model_name, m.finish_reason, m.created_at,
         m.user_feedback, m.ghostwriter_history, b.depth + 1
  FROM messages m
  JOIN branch b ON m.id = b.parent_id
  WHERE m.deleted_at IS NULL
)
SELECT * FROM branch ORDER BY depth DESC;
```

**Sibling counts** (for `< N / M >` navigation):
```sql
SELECT parent_id, COUNT(*) AS sibling_count
FROM messages
WHERE story_id = ? AND deleted_at IS NULL AND parent_id IS NOT NULL
GROUP BY parent_id
HAVING sibling_count > 1;
```

### 2.3 Extended `load_story_messages` Return Type

To support Accordion and Checkpoints, `load_story_messages` returns an extended
payload:

```rust
pub struct StoryPayload {
    pub messages:          Vec<ChatMessage>,         // active branch, ordered root→leaf
    pub sibling_counts:    Vec<SiblingCount>,        // fork points with sibling counts
    pub checkpoints:       Vec<Checkpoint>,          // all checkpoints for this story
    pub accordion_segments: Vec<AccordionSegment>,   // all accordion segments
}
```

### 2.4 `currentLeafId` Persistence

Persisted in `story_settings` table: key `leaf_id`.
Loaded via `get_story_leaf_id(story_id)` on story open.

---

## 3. `story_settings` Table

```sql
CREATE TABLE IF NOT EXISTS story_settings (
    story_id    TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    key         TEXT NOT NULL,
    value       TEXT NOT NULL,
    PRIMARY KEY (story_id, key)
);

CREATE INDEX IF NOT EXISTS idx_story_settings_story
    ON story_settings(story_id);
```

Keys stored here:
| Key | Type | Purpose |
|---|---|---|
| `leaf_id` | TEXT | Active branch leaf message ID |
| `context_doc_ids` | JSON array | Attached context doc IDs |
| `img_gen_enabled` | `"true"/"false"` | Image generation toggle |

---

## 4. Three-Field Input Model

### 4.1 Fields

| Field | Required | Clear on Send | Purpose |
|---|---|---|---|
| `plot_direction` | ✓ Always | ✓ Yes | Tells the AI where the story goes next |
| `background_information` | Optional | ✓ Yes | Facts the AI needs but must NOT appear in prose |
| `modificators` | Optional | ✓ Yes | Tone/style tags influencing how the AI writes |

**All three fields are cleared after Send.** Background information is no longer
persistent between sends — it must be re-entered if still relevant.

### 4.2 Gemini Request Assembly

```rust
pub fn build_user_turn_text(content: &UserContent) -> String {
    let mut parts = vec![];
    parts.push(format!("[PLOT DIRECTION]\n{}", content.plot_direction.trim()));
    if !content.background_information.trim().is_empty() {
        parts.push(format!(
            "[BACKGROUND INFORMATION — NOT FOR THE READER]\n{}",
            content.background_information.trim()
        ));
    }
    if !content.modificators.is_empty() {
        parts.push(format!(
            "[MODIFICATORS]\n{}",
            content.modificators.join(" · ")
        ));
    }
    parts.join("\n\n")
}
```

The assembled string is the `text` part of the user turn sent to Gemini.
The raw `UserContent` JSON is stored in `messages.content`.

### 4.3 Feedback Injection into History

When assembling history for a `send_message` request, feedback is injected
directly into the model message content. For each model message that has
`user_feedback` (non-null, non-empty), the feedback is appended to the
model's content before it is included in the history:

```rust
pub fn build_history_message_with_feedback(msg: &ChatMessage) -> String {
    let mut content = msg.content.clone();
    if let Some(feedback) = &msg.user_feedback {
        if !feedback.trim().is_empty() {
            content.push_str(&format!(
                "\n\n[WRITER FEEDBACK]\n{}",
                feedback.trim()
            ));
        }
    }
    content
}
```

This means the AI always sees its prior output together with the writer's
annotations, inline at the exact point they apply.

---

## 5. Send Flow (Streaming)

### 5.1 Overview

```
User hits Send
  │
  ├─ 1. Validate: plot_direction non-empty
  ├─ 2. check_rate_limit("text") → can_proceed?
  │       No → show rate limit banner, abort
  │
  ├─ 3. Optimistic UI:
  │       a. Insert user ChatMessage into messageMap (temp UUID)
  │       b. Insert empty model ChatMessage into messageMap (streaming placeholder)
  │       c. Set isGenerating = true
  │       d. Clear ALL input fields (plot_direction, background_information, modificators)
  │
  ├─ 4. Call send_message(story_id, leaf_id, user_content)
  │       Backend handles all history assembly:
  │       - Reconstructs branch from root → leaf
  │       - Applies feedback injection to model messages
  │       - Applies Accordion Fake-Pair substitution for collapsed segments
  │       - Loads context doc content/URIs
  │       - Assembles complete Gemini request
  │
  ├─ 5. Stream tokens → update model bubble progressively
  │       (via Tauri event "stream_chunk")
  │
  ├─ 6. Stream ends → final ChatMessage returned
  │       a. Replace temp IDs with real DB IDs
  │       b. Set isGenerating = false
  │       c. Call record_usage("text", token_count)
  │       d. Call get_telemetry() → refresh telemetry + token counter
  │       e. Update currentLeafId to new model message id
  │       f. Save leaf_id to story_settings
  │
  └─ 7. Handle finish_reason
```

### 5.2 `send_message` Tauri Command

**History is assembled entirely server-side.** The frontend sends only the
story ID, current leaf ID, and user content. The backend reconstructs the
full branch, applies Accordion substitution (Fake-Pairs), injects feedback
into model messages, and assembles the complete Gemini API request.

```rust
#[tauri::command]
pub async fn send_message(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    story_id: String,
    leaf_id: String,              // current branch leaf (backend reconstructs from here)
    user_content: UserContent,
) -> Result<ChatMessage, LoomError>
```

**Backend responsibilities on `send_message`:**
1. Reconstruct active branch (root → leaf) via Recursive CTE
2. For each model message with `user_feedback`: append as `[WRITER FEEDBACK]` tag
3. For collapsed Accordion segments: substitute with Fake-Pairs (see `18-Accordion.md §6`)
4. Load context doc content/URIs from `story_settings`
5. Read `system_instructions` from `settings` table
6. Assemble Gemini API request with full history + system instructions + context docs
7. Stream response via Tauri events

Streaming via Tauri events:
```rust
app.emit("stream_chunk", StreamChunk { message_id: &temp_model_id, delta: &token_text }).ok();
app.emit("stream_done",  StreamDone  { message_id: &final_model_id }).ok();
```

### 5.3 Loading Indicator

While `isGenerating === true` and bubble content is empty (before first token):
three animated dots (`animate-bounce` at 0ms, 150ms, 300ms delays).

---

## 6. Stop Generation

1. Frontend calls `cancel_generation()`.
2. Rust drops the stream (HTTP abort).
3. Partial content saved with `finish_reason = "ERROR"`.
4. `isGenerating = false`.
5. Amber `⚠` icon on bubble with tooltip *"Generation was stopped — response may be incomplete."*

---

## 7. Regenerate

Available on the last AI message bubble (`currentLeafId === message.id`) via
`lucide-react RefreshCw` in the action row on hover.

1. Creates new branch: calls `send_message` with same `parent_id` as current model message.
2. Uses same `UserContent` from the parent user message.
3. New model message created as sibling of current.
4. `currentLeafId` updates to new message.
5. `< N / M >` navigation shows both as siblings.

If the regenerated message is inside a summarised Accordion segment:
LOOM shows a toast: *"Regenerated content is inside a summarised segment. Regenerate summary?"*
with `[Regenerate Summary]` action button.

---

## 8. Edit User Message

### 8.1 Enter Edit Mode

User clicks `lucide-react Pencil` on a user message bubble action row.

1. Bubble transforms: `plot_direction` becomes editable textarea, pills expand to full fields.
2. `[Cancel]` and `[Send Edit]` buttons appear.
3. Temp branch created in `messageMap` (optimistic).

### 8.2 Confirm Edit — Branching Behaviour

Editing a user message always triggers a **new AI generation** with the edited
content. The behaviour depends on the position of the edited message:

**Case A — Editing the last user message (current leaf's parent):**
1. Edited `UserContent` saved as new user message (sibling of original).
2. New AI generation proceeds from the new user message.
3. `currentLeafId` updates to the new model message.
4. The original user+AI pair remains intact and navigable via `< N / M >`.
5. No descendant destruction — this is the leaf, there are no descendants.

**Case B — Editing a non-last user message (has descendants):**
1. A **new branch** is created starting from the edited message's parent.
2. Edited `UserContent` saved as new user message (sibling of original).
3. New AI generation proceeds from the new user message.
4. The new branch terminates at this new user+AI pair — **all deeper descendants
   are NOT copied to the new branch**. The new branch's leaf is the freshly
   generated AI response.
5. `currentLeafId` updates to the new model message (new branch leaf).
6. The original branch (with all its descendants) remains fully intact.

In both cases, the edit creates a **sibling branch at the fork point**, and the
AI always generates a fresh response based on the edited user content.

### 8.3 Abort Edit

1. Temp branch destroyed.
2. `currentLeafId` reverts to previous leaf.
3. Bubble returns to display state.

---

## 9. User Message Bubble Display

### 9.1 Plot Direction (Always Visible)

Full text always rendered in bubble body. Never truncated or collapsed.

### 9.2 Background Information Pill

Shown if `background_information` non-empty. Amber tint chip, expandable.
(Full spec in `02-Design-System.md §5.3`.)

### 9.3 Modificators Pill

Shown if `modificators` non-empty. Accent-tint chip, expandable.
(Full spec in `02-Design-System.md §5.3`.)

---

## 10. AI Message Bubble Display

### 10.1 Standard Display

```
┌──────────────────────────────────────────────────────────┐
│ AI  ·  2:04 PM  ·  312 tok  ·  gemini-2.5-flash         │
│                                                           │
│ Her hands trembled as she broke the seal...              │
│                                                           │
│ [✦ Ghostwriter]  [◎ Feedback]  [⟳]  [🗑]                 │
└──────────────────────────────────────────────────────────┘
```

- Role label: `AI` · timestamp · token count · model name (from `model_name` field)
- Action row on hover (below bubble): Ghostwriter · Feedback · Revert (if ghostwriter_history) · Delete

### 10.2 Feedback Display

When `user_feedback` is non-empty, rendered below bubble content:
```
[◎ Feedback]  ← click to expand/collapse
▼
┌─────────────────────────────────────────────┐
│ Pacing felt rushed. Slow down this moment.  │
└─────────────────────────────────────────────┘
```
Editable inline. Saves on blur via `update_message_feedback(id, feedback)`.

### 10.3 Branch Navigation

When a message has siblings, shown inside the bubble header:
```
AI  ·  2:04 PM  ·  312 tok     < 2 / 3 >
```

---

## 11. Safety Filter Handling

When `finish_reason === "SAFETY"`:

```
┌──────────────────────────────────────────────────────────┐
│ AI  ·  2:04 PM                                [⚠ Safety] │
│                                                           │
│  Response blocked by Gemini safety filters.              │
│  Try rephrasing your plot direction.                      │
└──────────────────────────────────────────────────────────┘
```

- Warning background: `rgba(244,63,94,0.08)`
- Border: `1px solid rgba(244,63,94,0.25)`
- Saved and visible in branch. No automatic retry.

---

## 12. Context Window and Token Estimation

Full history of the current branch is sent with every request. With Accordion,
collapsed segments are replaced by Fake-Pairs. See `18-Accordion.md` for
the history assembly logic.

### 12.1 Token Estimation (Pre-Send)

The Theater token counter must display an **estimate** before the API call
returns actual token counts. LOOM uses a simple character-based approximation:

```ts
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
```

This `chars / 4` heuristic is applied to:
- All message content in the current branch (after Accordion substitution)
- System instructions
- Context doc content (for inline docs; File API docs excluded from estimate)

**After** each API response, the actual `usageMetadata.totalTokenCount` from
Gemini replaces the estimate for that response's token count. The Theater
counter is re-calculated mixing actual counts (for messages with server-reported
values) and estimates (for messages without).

### 12.2 Token Counter Display

Token counter in Theater toolbar shows:
- `~18,400 / 128,000 tokens` — normal
- `~6,400 tokens sent  (3 segments collapsed, ~12,000 saved)` — with Accordion active

---

## 13. Tauri Command Reference

| Command | Parameters | Returns |
|---|---|---|
| `send_message` | `story_id, leaf_id, user_content` | `ChatMessage` |
| `cancel_generation` | — | `()` |
| `load_story_messages` | `story_id: String` | `StoryPayload` |
| `delete_message` | `id: String` | `()` |
| `update_message_content` | `id: String, content: String` | `()` |
| `update_message_feedback` | `id: String, feedback: String` | `()` |
| `save_ghostwriter_edit` | `id: String, history: String` | `()` |
| `get_story_leaf_id` | `story_id: String` | `Option<String>` |
| `set_story_leaf_id` | `story_id: String, leaf_id: String` | `()` |
| `update_item_description` | `id: String, description: String` | `()` |
