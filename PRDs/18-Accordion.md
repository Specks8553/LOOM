# 18 — Accordion (Context Window Management)

## Purpose

Accordion is LOOM's context window management system. It allows writers to
compress earlier chapters of a story into AI-generated summaries, which
replace the original messages in the API history — reducing token consumption
while preserving narrative context. The writer controls when to summarise,
what gets collapsed, and can expand segments at any time to read the full text.

> **Coding-agent note:** Accordion state is stored in the `accordion_segments`
> and `checkpoints` tables. The collapsed state is branch-specific for
> fork-spanning segments. History assembly for `send_message` and
> `send_ghostwriter_request` must apply Accordion substitution before sending.
> The Accordion API call uses a separate `summarise_segment` Tauri command.
> Rate limiting applies identically.

---

## 1. Core Concepts

### 1.1 Segments

A **segment** is the sequence of messages between two consecutive checkpoints:
- **Segment = [Checkpoint A → messages → Checkpoint B]**
- Checkpoint B is the "end" of the segment and acts as its heading
- Checkpoint A is the "start" (shared as the end of the previous segment)

Messages belong to exactly one segment determined by their position between
checkpoints in the message tree.

### 1.2 The Fake-Pair

When a segment is collapsed, its messages are replaced in the API history
by a single **Fake-Pair** — a synthetic user+model exchange that carries the
summary:

```
User:  "Fasse das Kapitel zusammen: Handlungen,
        Charakter- und Weltzustände am Ende des Kapitels."

Model: [AI-generated summary of the segment]
```

The Fake-Pair is **never** stored in the `messages` table and is **never**
shown in the Theater. It exists only as a runtime substitution in history
assembly.

### 1.3 Trigger

Accordion is **user-triggered only**. LOOM never auto-summarises.

Trigger point: click a **checkpoint divider** in the Theater → context menu →
*"Summarise previous chapter"*

This summarises the segment that ends at this checkpoint (the segment between
the previous checkpoint and this one).

---

## 2. Database Schema

### 2.1 `accordion_segments` Table

> **Schema reference:** The definitive schema for `accordion_segments` is in
> §11 of this document. The schema below is removed to avoid divergence.
> See §11 for the complete table definition including the `is_stale` column.

### 2.2 `branch_leaf_id` and Fork-Spanning Segments

When a segment **does not span a fork** (all messages in the segment belong to
a single branch path), `branch_leaf_id = NULL`. One row covers all branches
because all branches share the same segment content.

When a segment **spans a fork** (some messages in the segment have siblings),
the collapsed state becomes branch-specific:
- `branch_leaf_id` is set to the leaf ID of the branch this row applies to
- Each branch that diverges inside the segment has its own row
- When summarising a fork-spanning segment, LOOM prompts:
  *"This chapter spans a branch fork. Apply the same summary to all branches,
  or summarise separately for each branch?"*
  - **All branches:** one `branch_leaf_id = NULL` row (shared summary)
  - **Separately:** one row per branch leaf

### 2.3 `checkpoints` Table (Reference)

Full schema in `17-Branch-Map.md §7.1`.

---

## 3. Segment Lifecycle

### 3.1 Segment Creation

Segments are created when a checkpoint is created. `create_checkpoint` backend:

```rust
// After inserting the new checkpoint:
// 1. Find the previous checkpoint in this story (by message order)
// 2. Create accordion_segment row:
//    start_cp_id = previous_checkpoint.id
//    end_cp_id   = new_checkpoint.id
//    summary     = NULL
//    is_collapsed = 0
//    branch_leaf_id = NULL
```

On **story creation**, the Start Checkpoint is created automatically.
No segment exists yet until a second checkpoint is added.

### 3.2 Checkpoint Deletion → Segment Merge

When a non-Start checkpoint is deleted (see `17-Branch-Map.md §7.4`):

```
Before:   Segment A [CP1 → CP2]   +   Segment B [CP2 → CP3]
After:    Segment C [CP1 → CP3]
```

- New segment: `start_cp_id = A.start_cp_id`, `end_cp_id = B.end_cp_id`
- Both A and B deleted
- Merged segment: `summary = NULL`, `is_collapsed = 0` (user must re-summarise)

---

## 4. Summarisation Flow

### 4.1 Trigger

User clicks a **checkpoint divider** in the Theater → *"Summarise previous chapter"*
(or same option in Branch Map right-click on checkpoint).

### 4.2 Pre-Summarisation Checks

Before calling `summarise_segment`:
1. `check_rate_limit("text")` — if blocked, show rate limit banner, abort
2. If segment already has a summary (`summary IS NOT NULL`): show confirmation:
   *"This chapter already has a summary. Replace it?"*
   `[Cancel]` / `[Regenerate Summary]`

### 4.3 API Request

```rust
#[tauri::command]
pub async fn summarise_segment(
    state: tauri::State<'_, AppState>,
    segment_id: String,
    story_id: String,
    leaf_id: String,    // current branch leaf (determines which messages to include)
) -> Result<String, LoomError>
// Returns the generated summary text
```

**History sent to Gemini:** Only the messages within the segment (from `start_cp_id`
message to `end_cp_id` message, following the branch path determined by `leaf_id`).

**System instruction for summarisation:**

The following is the **default** text. It is editable in Settings → Developer →
AI Prompt Templates (setting key: `prompt_accordion_summarise`).

```
Summarise the following story chapter.
Capture: all plot events, the state of each character at the end of the chapter,
and the state of the world/setting at the end of the chapter.
Write in past tense, third person. Be specific — the summary must be sufficient
for the AI to continue the story without reading the original messages.
Do not add commentary or meta-text — output only the summary.
```

**Fake-Pair User message (injected into history when segment is collapsed):**

The following is the **default** text. It is editable in Settings → Developer →
AI Prompt Templates (setting key: `prompt_accordion_fake_user`).

```
Summarize this chapter: actions, character states, and world state at the end
of the chapter.
```

**Rate limiting:** `record_usage("text", token_count)` called after summarisation.
`telemetryStore.refresh()` called after.

### 4.4 Result

1. Summary text returned from Gemini (blocking response — no streaming)
2. Stored in `accordion_segments.summary`
3. `accordion_segments.summarised_at = now()`
4. Segment is **not** automatically collapsed — user must explicitly collapse
5. Toast: *"Summary generated. Collapse the chapter to use it in context."*
   with `[Collapse Now]` action button

---

## 5. Collapse / Expand

### 5.1 Collapse

A segment can only be collapsed if it has a summary (`summary IS NOT NULL`).

**Via Theater checkpoint divider context menu:**
*"Collapse chapter"*

**Via Accordion summary card** (when segment is expanded but has summary):
*"Collapse"* button inside the card

On collapse:
1. `UPDATE accordion_segments SET is_collapsed = 1 WHERE id = ?`
2. Theater re-renders: messages in segment replaced by Accordion summary card
3. Token counter updates (shows token savings)

### 5.2 Expand

**Via Accordion summary card** `[▼ expand]` button.

On expand:
1. `UPDATE accordion_segments SET is_collapsed = 0 WHERE id = ?`
2. Theater re-renders: full message bubbles restored

Expanding does NOT delete the summary. The summary is retained for re-collapsing.

### 5.3 Collapse State is Branch-Specific for Fork-Spanning Segments

For segments with `branch_leaf_id` set: the collapsed state of the row only
affects the branch matching `branch_leaf_id`. Other branches have their own rows.

For segments with `branch_leaf_id = NULL`: collapsed state applies to all branches
that share this segment (i.e., all branches that haven't diverged within it).

---

## 6. History Assembly

This is the critical runtime logic. The backend applies Accordion substitution
during history assembly for **every** `send_message` and
`send_ghostwriter_request` call. The frontend does not participate in
history assembly — it sends only `(story_id, leaf_id, user_content)`.

### 6.1 `build_history_with_accordion` (Rust)

```rust
pub fn build_history_with_accordion(
    branch_messages: &[ChatMessage],   // ordered root → current leaf
    segments: &[AccordionSegment],     // all segments for this story
    checkpoints: &[Checkpoint],        // all checkpoints for this story
    current_leaf_id: &str,
    settings: &HashMap<String, String>, // world settings (for editable prompt)
) -> Vec<HistoryMessage> {
    let fake_user_prompt = settings
        .get("prompt_accordion_fake_user")
        .cloned()
        .unwrap_or_else(|| ACCORDION_FAKE_USER_PROMPT_DEFAULT.to_string());

    let mut result = vec![];

    for msg in branch_messages {
        // Check if this message is inside a collapsed segment
        let collapsed_segment = find_collapsed_segment_for_msg(
            msg, segments, checkpoints, current_leaf_id
        );

        if let Some(seg) = collapsed_segment {
            // Check if we've already injected the fake-pair for this segment
            if !result.iter().any(|h| h.segment_id == Some(seg.id.clone())) {
                // Inject fake-pair for this segment
                result.push(HistoryMessage {
                    role:       "user".into(),
                    text:       fake_user_prompt.clone(),
                    segment_id: Some(seg.id.clone()),
                });
                result.push(HistoryMessage {
                    role:       "model".into(),
                    text:       seg.summary.clone().unwrap_or_default(),
                    segment_id: Some(seg.id.clone()),
                });
            }
            // Skip this message — it's covered by the fake-pair
            continue;
        }

        // Normal message — include with feedback if present
        result.push(build_history_message_with_feedback(msg));
    }

    result
}
```

The `ACCORDION_FAKE_USER_PROMPT_DEFAULT` constant (used when setting is absent):
```rust
const ACCORDION_FAKE_USER_PROMPT_DEFAULT: &str =
    "Summarize this chapter: actions, character states, \
     and world state at the end of the chapter.";
```

### 6.2 Token Counting with Accordion

The Theater token counter (F-01) shows two values when Accordion is active:

```
~6,400 tokens sent  (3 segments collapsed, ~12,000 saved)
```

Calculation:
- **Tokens sent:** Sum of token counts of messages in current history
  (after Accordion substitution, using segment summary token estimates)
- **Tokens saved:** Sum of token counts of messages inside collapsed segments
  minus the estimated fake-pair token count
- For collapsed segments without individual message token counts:
  estimate from `summary.length / 4` (chars to tokens approximation)

---

## 7. Theater Rendering

### 7.1 Normal Segment (Expanded or No Summary)

Messages render as normal bubbles. Checkpoint divider appears between segments.

### 7.2 Collapsed Segment (Summary Card)

When `is_collapsed = 1`, the messages in the segment are replaced by the
Accordion Summary Card:

```
┌─────────────────────────────────────────────────────────┐
│  ⌗  Kapitel 1  ·  14 messages  ·  [▼ expand]            │
│  ─────────────────────────────────────────────────────  │
│  Elara arrived at the tower during a storm. She          │
│  found the letter in her brother's handwriting.          │
│  At the chapter's end, she has entered the tower         │
│  and the letter is in her coat pocket.                   │
└─────────────────────────────────────────────────────────┘
```

- Full visual spec: `02-Design-System.md §8`
- **Header:** checkpoint name (segment's `end_cp_id.name`) + message count + expand button
- **Body:** summary text, rendered as prose (not Markdown)
- Click `[▼ expand]` → expands in-place, summary card replaced by full bubbles

### 7.3 Stale Summary Indicator

A summary becomes **stale** when:
- A message inside the summarised segment is edited via Ghostwriter
- A message inside the summarised segment is regenerated

When stale, the summary card shows:

```
⌗  Kapitel 1  ·  14 messages  ·  [▼ expand]   ⚠ Summary may be outdated
```

The `⚠` warning with `--color-warning` color. Hover tooltip: *"Content in this
chapter has changed since the last summary. Click to regenerate."* Clicking the
warning → triggers re-summarisation flow.

Stale state tracked in `accordion_segments.is_stale INTEGER NOT NULL DEFAULT 0`
(add this column to schema above).

---

## 8. Accordion + Ghostwriter Interaction

When a Ghostwriter edit is accepted inside a collapsed segment:
1. Toast: *"This message is inside a summarised chapter. Regenerate summary?"*
   `[Regenerate Summary]` / `[Dismiss]`
2. On `[Regenerate Summary]`: calls `summarise_segment` for that segment
3. On `[Dismiss]`: segment marked stale

When a Ghostwriter edit creates a new branch from within a collapsed segment:
- The new branch gets **cloned checkpoints** for all checkpoints between the
  fork point and the end of the branch
- Accordion segments for the cloned checkpoints are also created (with `summary = NULL`)
- The original branch's collapsed state is unaffected

---

## 9. Accordion + Branch Checkpoints: Cloning on Branch Create

When any operation creates a new branch (Ghostwriter accept, user message edit),
checkpoints that lie **on the shared path** (root to the fork point) are shared
and do not need cloning.

Checkpoints that lie **after the fork point** on the original branch must be
**cloned** for the new branch:

```rust
pub fn clone_checkpoints_for_new_branch(
    original_branch_checkpoints: &[Checkpoint],
    fork_message_id: &str,     // model message where the branch splits
    new_branch_messages: &[ChatMessage],
    story_id: &str,
) -> Vec<Checkpoint>
// Returns newly created checkpoint rows for insertion
```

Each cloned checkpoint:
- New `id` (UUID)
- Same `name`
- `after_message_id` remapped to the corresponding new branch message
- `is_start = 0`

Accordion segments for the cloned checkpoints are created with `summary = NULL`.
The user must re-summarise if needed.

---

## 10. Accordion + Message Deletion

When a message inside a summarised segment is **deleted** (soft delete):
- Segment is marked stale (no warning toast needed — deletion is intentional)

When a message is **permanently purged**:
- Segment remains but `is_stale = 1`
- No automatic re-summarisation

---

## 11. `accordion_segments` Full Schema (Definitive)

```sql
CREATE TABLE IF NOT EXISTS accordion_segments (
    id              TEXT PRIMARY KEY,
    story_id        TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    start_cp_id     TEXT NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
    end_cp_id       TEXT NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
    summary         TEXT,
    is_collapsed    INTEGER NOT NULL DEFAULT 0,
    is_stale        INTEGER NOT NULL DEFAULT 0,
    branch_leaf_id  TEXT,
    summarised_at   TEXT,
    created_at      TEXT NOT NULL,
    modified_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_accordion_story   ON accordion_segments(story_id);
CREATE INDEX IF NOT EXISTS idx_accordion_end_cp  ON accordion_segments(end_cp_id);
CREATE INDEX IF NOT EXISTS idx_accordion_branch  ON accordion_segments(branch_leaf_id);
```

---

## 12. `accordionStore` (Zustand)

```ts
interface AccordionStore {
  // Loaded as part of StoryPayload from load_story_messages
  segments: AccordionSegment[];
  // Actions
  collapse:  (segmentId: string) => Promise<void>;
  expand:    (segmentId: string) => Promise<void>;
  summarise: (segmentId: string, storyId: string, leafId: string) => Promise<void>;
  refresh:   (storyId: string) => Promise<void>;
}
```

---

## 13. Tauri Command Reference

| Command | Parameters | Returns |
|---|---|---|
| `summarise_segment` | `segment_id, story_id, leaf_id` | `String` (summary text) |
| `set_segment_collapsed` | `segment_id: String, collapsed: bool` | `()` |
| `get_accordion_segments` | `story_id: String` | `Vec<AccordionSegment>` |
| `create_checkpoint` | `story_id, after_message_id?, name` | `Checkpoint` |
| `rename_checkpoint` | `id: String, name: String` | `()` |
| `delete_checkpoint` | `id: String` | `()` |
