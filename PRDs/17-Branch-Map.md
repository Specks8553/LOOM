# 17 — Branch Map

## Purpose

The Branch Map is a visual overview of the conversation's full branching structure —
a navigable tree showing all message branches, checkpoints, forks, and their
relationships. It allows the writer to understand the narrative tree at a glance,
switch between branches, manage checkpoints, and trigger Accordion summaries.

> **Coding-agent note:** The Branch Map is a floating drawer rendered to the right
> of the Theater, sliding over the Control Pane. It is driven by `branchMapStore.ts`.
> Map data is loaded from `load_branch_map(story_id)` Tauri command. Live updates
> are emitted via Tauri events after message creates, edits, and deletions.

---

## 1. Access

### 1.1 Open Triggers

| Trigger | Notes |
|---|---|
| `Ctrl+M` | Global keyboard shortcut |
| `[🗺]` button in Control Pane header | Next to story title |
| Right-click AI bubble → *"Show in Branch Map"* | Opens map and scrolls to that node |

### 1.2 Close Triggers

- `Ctrl+M` (toggle)
- `Escape` (Priority 2 in Escape chain)
- `[✕]` button on drawer

---

## 2. Drawer Layout

### 2.1 Dimensions

- **Position:** Fixed, right side, slides over the Control Pane (z-index above it)
- **Default width:** `400px`
- **Min width:** `300px`
- **Max width:** `70vw`
- **Height:** Full viewport height
- **Resize:** Drag-to-resize via left edge drag handle
- **Width persistence:** `localStorage` key `branch_map_width`

### 2.2 Drawer Animation

```css
.branch-map-drawer {
  position: fixed;
  right: 0;
  top: 0;
  height: 100vh;
  transform: translateX(100%);
  transition: transform 220ms cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 30;
}
.branch-map-drawer[data-open="true"] {
  transform: translateX(0);
}
```

### 2.3 Drawer Header

```
┌──────────────────────────────────────────────────────────┐
│  Branch Map                                    [✕]       │
│  The Glass Architect                                     │
│  Branches: 4  ·  Forks: 2  ·  Depth: 14                │
├──────────────────────────────────────────────────────────┤
│  [map content]                                           │
└──────────────────────────────────────────────────────────┘
```

- Story name: `14px`, Inter 600
- Stats: branches count, fork count, current leaf depth — `11px`, `--color-text-muted`

---

## 3. Visual Model

### 3.1 Tree Type: Abstracted Node Tree

The Branch Map renders an **abstracted tree** where:

- Each **node** represents one message-pair (User + AI = 1 node)
- **Straight sequences** (no forks) are collapsed to a labelled line
- Forks produce visible branching

```
[Start ⌗]
    │
── 3 msgs ──
    │
   [M4] ◈ Checkpoint: "Act I"
    │
   ├─── [M5a] (active branch) ──── [M6a] ● ← current leaf
   │
   └─── [M5b] ── [M6b] ── [M7b]
```

Legend:
- `●` current leaf (active branch tip)
- `◈` checkpoint marker
- `── N msgs ──` collapsed straight sequence
- `├` / `└` fork point

### 3.2 Collapsed Sequences

A "straight sequence" is a chain of message-pairs with no fork points
(each parent has exactly one child). These are collapsed to a single line label:

```
── 8 msgs ──
```

- Gray, `11px`, Inter 400, `--color-text-muted`
- Straight sequences are **not** expandable in the map
  (they can be navigated in the Theater)

### 3.3 Accordion-Collapsed Sequences

When a segment has been Accordion-summarised, its collapsed line uses the
`--color-accordion` color instead of gray and includes a summary icon:

```
≡ ⌗ Kapitel 1 · 14 msgs · summarised
```

- Colored with `--color-accordion`
- Click opens expansion (shows the Accordion summary text inline in map)
- Label includes checkpoint name + message count + "summarised" badge

### 3.4 Auto-Collapse Behaviour

On Branch Map open:
- All branches **except** the active branch from last fork to current leaf
  are auto-collapsed (shown as compressed lines)
- The active branch from root to current leaf is always fully expanded

User can manually expand any collapsed branch by clicking it.

### 3.5 Two Collapse Classes

| Class | Visual | Expandable |
|---|---|---|
| Visual collapse | Gray dashed line | No |
| Accordion collapse | Colored solid line + label | Yes (shows summary) |

---

## 4. Node Anatomy

Each visible node (at a fork point or leaf, not collapsed):

```
┌──────────────────────────────────────┐
│  [Edit ✎]  M7a                 312t  │   ← role icon, ID, tokens
│  "She recognised the handwri…"       │   ← AI content excerpt
│  2026-03-07 17:04  ●                 │   ← timestamp, active dot
└──────────────────────────────────────┘
```

- Width: fills drawer width minus `24px` padding
- `border-radius: 6px`
- Background: `--color-bg-elevated` (inactive), `--color-bg-active` (current leaf)
- Border: `1px solid --color-border` (inactive), `1px solid --color-accent` (current leaf)

### 4.1 Node Hover Tooltip

On node hover (300ms delay):

```
┌────────────────────────────────────────────┐
│  "She recognised the handwriting before    │
│  she could stop herself…"                  │
│                                             │
│  2026-03-07 17:04                          │
│  312 tokens                                │
│  ⌗ Act I  ← checkpoint name if applicable │
│  [✎ Ghostwriter edit]  ← origin icons      │
└────────────────────────────────────────────┘
```

**Origin icons** (max 2 per node, shown in tooltip and on node):
- User-turn: `lucide-react Pencil` if the user message was edited (not original)
- AI-turn (priority order): `✦` if Ghostwriter-modified · `lucide-react RefreshCw` if regenerated · nothing otherwise

---

## 5. Checkpoint Rendering in Map

### 5.1 Visual

Checkpoints appear **between** nodes (not as nodes themselves):

```
    │
   [M4]
    │
  ⌗ Act I     ← checkpoint marker
    │
   [M5]
```

- `lucide-react Bookmark` icon + name
- Color: `--color-checkpoint`
- `11px`, Inter 500

The Start Checkpoint appears at the very top of the map (before M1):

```
  ⌗ Start
    │
   [M1]
```

### 5.2 Checkpoint Context Menu (Right-Click in Map)

- **Rename** → inline name input
- **Summarise previous chapter** → triggers Accordion summary for the segment
  ending at this checkpoint
- **Delete** → confirmation → `delete_checkpoint(id)` (see §7.3)
  *(Not available on Start checkpoint)*

---

## 6. Branch Switching

### 6.1 Click to Switch

Clicking any node:
1. Sets `workspaceStore.currentLeafId` to that node's model message ID
2. Saves to `story_settings.leaf_id`
3. Theater scrolls to show the active branch (root → new leaf)
4. Branch Map updates to show new active path highlighted
5. `< N / M >` navigation in Theater updates

### 6.2 "Show in Branch Map" (From Theater)

Right-click on a Theater bubble → *"Show in Branch Map"*:
1. Opens Branch Map (if not open)
2. Scrolls map to the node corresponding to that message
3. Node briefly highlighted with a `ring` animation

---

## 7. Checkpoint Management

### 7.1 Checkpoint Data Model

```sql
CREATE TABLE IF NOT EXISTS checkpoints (
    id               TEXT PRIMARY KEY,
    story_id         TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    after_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
    -- NULL = story start checkpoint (before M1)
    name             TEXT NOT NULL DEFAULT 'Checkpoint',
    is_start         INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL,
    modified_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_story
    ON checkpoints(story_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_after_msg
    ON checkpoints(after_message_id);
```

`ON DELETE SET NULL` on `after_message_id`: if a message is permanently purged,
the checkpoint becomes orphaned (`after_message_id = NULL` with `is_start = 0`).
Orphaned checkpoints are detected on story load and auto-deleted with a warning toast.

### 7.2 Start Checkpoint

Every story gets an auto-created Start Checkpoint when the story is first created:
- `after_message_id = NULL`
- `is_start = 1`
- `name = "Start"`
- **Renameable:** Yes
- **Deletable:** No

### 7.3 Creating Checkpoints

**Via Branch Map:** Right-click on a node → *"Add Checkpoint"*:
- Checkpoint placed `after_message_id = node.model_message_id`
- Name prompt (inline input in map, default: *"Checkpoint"*)
- Calls `create_checkpoint(story_id, after_message_id, name)`

**Via Theater:** Right-click on a bubble → *"Add Checkpoint Here"*
- Same flow as above

**Checkpoint Positions:**
Checkpoints sit **after** an AI output bubble, between that bubble and
the next user input — visually as a divider line in the Theater.

### 7.4 Deleting Checkpoints

Deleting a checkpoint (non-Start):
1. Confirmation: *"Delete checkpoint '{name}'? The adjacent Accordion segments will be merged."*
2. Calls `delete_checkpoint(id)`
3. Backend: `DELETE FROM checkpoints WHERE id = ?`
4. Backend: Merge the two adjacent Accordion segments (if they exist):
   - New segment: `start_cp_id = deleted_segment_A.start_cp_id`,
     `end_cp_id = deleted_segment_B.end_cp_id`
   - Both old segment summaries discarded — user must re-summarise
   - New segment `summary = NULL`, `is_collapsed = 0`

### 7.5 Renaming Checkpoints

Inline rename in Branch Map or via Theater checkpoint divider context menu.
Calls `rename_checkpoint(id, new_name)`.

### 7.6 Orphaned Checkpoint Cleanup

Orphaned checkpoints are checkpoints whose `after_message_id` no longer points
to an existing, non-purged message.

**Important:** Orphan detection runs only against **permanently purged** messages
(`DELETE` from DB), not soft-deleted messages (`deleted_at IS NOT NULL`). This
prevents premature cleanup when a user soft-deletes a branch and then undoes the
delete within the 5-second undo window.

On `load_story_messages`, backend queries:
```sql
SELECT cp.id FROM checkpoints cp
WHERE cp.story_id = ?
  AND cp.after_message_id IS NOT NULL
  AND cp.is_start = 0
  AND NOT EXISTS (
    SELECT 1 FROM messages m WHERE m.id = cp.after_message_id
  );
```

This query finds checkpoints whose referenced message has been **permanently
deleted** from the `messages` table (not just soft-deleted). Any results:
delete them, emit a warning that will show as a toast:
*"A checkpoint lost its anchor and was removed."*

---

## 8. Branch Deletion

### 8.1 Delete Node from Branch Map

Right-click on a node → *"Delete branch from here"*

**Deletion behaviour depends on node position:**

**Case A — Leaf node (no children):**
- Only that single node pair (user + model messages) deleted
- Parent's `currentLeafId` changes to parent node
- Toast: *"Branch deleted."* with `[Undo]` (soft delete, 5s window)

**Case B — Middle node (has children / descendants):**
- The node and all its descendants deleted
- Auto-switch: LOOM looks for the last active leaf of a sibling branch
  (from `story_settings.leaf_id` of siblings)
- If sibling exists: switch to sibling's leaf
- If no sibling: Theater shows parent node as current leaf (user continues from there)
- Toast: *"Branch deleted."* with `[Undo]`

**Deletion is soft** (sets `deleted_at`). Undo within 5 seconds restores.
Permanent purge available in Trash.

### 8.2 Checkpoints on Deleted Branches

Checkpoints whose `after_message_id` points to a deleted (soft) message are
preserved — they are not orphaned until permanent purge.

---

## 9. Branch Map Live Updates

The Branch Map updates reactively when:
- A new message is sent (`send_message` completes)
- A message is deleted or restored
- A checkpoint is created, renamed, or deleted
- An Accordion segment state changes
- Ghostwriter creates a new branch

Tauri events emitted by backend:
```
branch_map_updated  { story_id: String }
```

Frontend: when `branch_map_updated` received and Branch Map is open,
calls `load_branch_map(story_id)` and re-renders.

Active leaf pulses subtly during generation:
```css
.node-active-generating {
  border-color: var(--color-accent);
  animation: node-pulse 1.5s ease-in-out infinite;
}
@keyframes node-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.6; }
}
```

---

## 10. `load_branch_map` Tauri Command

```rust
#[tauri::command]
pub async fn load_branch_map(
    state: tauri::State<'_, AppState>,
    story_id: String,
) -> Result<BranchMapData, LoomError>

pub struct BranchMapData {
    pub nodes:       Vec<BranchMapNode>,       // all non-deleted message pairs
    pub edges:       Vec<BranchMapEdge>,       // parent-child relationships
    pub checkpoints: Vec<Checkpoint>,          // all checkpoints for story
    pub accordion_segments: Vec<AccordionSegment>,
    pub current_leaf_id: String,
}

pub struct BranchMapNode {
    pub user_msg_id:    String,
    pub model_msg_id:   String,
    pub excerpt:        String,        // first 60 chars of model content
    pub token_count:    Option<u32>,
    pub created_at:     String,
    pub is_current_leaf: bool,
    pub user_was_edited: bool,         // origin icon: user-turn edit
    pub model_origin:   ModelOrigin,   // Normal | Ghostwriter | Regenerated
}

pub enum ModelOrigin { Normal, Ghostwriter, Regenerated }

pub struct BranchMapEdge {
    pub parent_model_msg_id: String,
    pub child_user_msg_id:   String,
}
```

---

## 11. `branchMapStore` (Zustand)

```ts
interface BranchMapStore {
  data:         BranchMapData | null;
  isLoading:    boolean;
  scrollToId:   string | null;   // node to scroll to after open

  load:         (storyId: string) => Promise<void>;
  setScrollTo:  (id: string | null) => void;
}
```

---

## 12. Full Command Reference

| Command | Parameters | Returns |
|---|---|---|
| `load_branch_map` | `story_id: String` | `BranchMapData` |
| `create_checkpoint` | `story_id, after_message_id?, name` | `Checkpoint` |
| `rename_checkpoint` | `id: String, name: String` | `()` |
| `delete_checkpoint` | `id: String` | `()` |
| `delete_branch_from` | `model_msg_id: String` | `BranchDeletionResult` |
