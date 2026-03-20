# 04 — Reader View and Export

## Purpose

This document specifies LOOM's Reader View mode, the Markdown export flow,
and the Full Branch JSON export (Dev tool). Reader View provides a distraction-free,
manuscript-like rendering of the active branch. Export converts the active branch
to a clean Markdown file or structured JSON.

> **Coding-agent note:** Reader View is a conditional rendering mode on the Theater
> component. `workspaceStore.viewMode: "standard" | "reader"`. Toggle via `Ctrl+R`
> or a button in the Theater toolbar. Export is triggered from the Theater toolbar
> (Markdown) or Settings → Developer (JSON).

---

## 1. View Modes

The Theater operates in two modes:

| Mode | Key | Description |
|---|---|---|
| `"standard"` | — | Normal conversation UI with input area |
| `"reader"` | `Ctrl+R` | Distraction-free manuscript view |

There is no "Raw" mode. `viewMode` is in-memory only (not persisted).

### 1.1 Mode Toggle

**Theater toolbar** (above message list):

```
[ Reader View ]                            ~18,400 / 128,000 tokens
```

- Button: `lucide-react BookOpen`, `14px`. Label: *"Reader View"*
- Active state: filled/highlighted background
- `Ctrl+R` toggles from anywhere in workspace (not suppressed in inputs)

---

## 2. Reader View

### 2.1 What Changes

When `viewMode === "reader"`:

| Element | Behaviour |
|---|---|
| Input area (Plot Direction, Background, Modificators) | Hidden |
| Control Pane | Auto-collapsed |
| Navigator | Auto-collapsed |
| Message bubbles | AI messages only rendered (user messages hidden) |
| Theater padding | Increased to `60px` horizontal |
| Bubble max-width | `720px`, centered |
| Font size | `16px` (instead of `15px`) |
| Line height | `1.8` (instead of `1.6`) |
| Action rows | Hidden |
| Branch navigation (`< N / M >`) | Hidden |
| Token counter | Hidden |

Navigator and Control Pane re-open when exiting Reader View only if they
were open before entering (state stored in `prevPaneState` on enter).

### 2.2 Exit Triggers

- `Ctrl+R` (toggle)
- `Escape` (Escape priority chain: Reader View is priority 7)
- Clicking the `[ Standard View ]` button that replaces the Reader View button

### 2.3 Accordion in Reader View

Collapsed Accordion segments render their summary card in Reader View, just as
in Standard View. Segment summaries provide natural chapter breaks in the
manuscript-like layout.

### 2.4 Checkpoint Dividers in Reader View

Checkpoint dividers are visible in Reader View, providing natural chapter
headings. They are non-interactive (no context menu) in Reader View.

---

## 3. Markdown Export

### 3.1 Trigger

`lucide-react Download` button in Theater toolbar, visible in standard view:

```
[ ↓ Export ]   [ Reader View ]         ~18,400 / 128,000 tokens
```

Available only when a story is open and has messages.

### 3.2 Export Flow

1. Call `export_story_markdown(story_id, leaf_id)` Tauri command.
2. Backend assembles Markdown from active branch (root → leaf), model messages only.
3. If `export_folder_path` setting is configured: save automatically there.
   Else: `tauri-plugin-dialog: save()` dialog for user to choose location.
4. Success: toast *"Exported."* with *"Open folder"* action that opens the export
   folder in the system file manager.
5. Filename: `<story_name>_<YYYYMMDD>.md`

### 3.3 Export Format

```markdown
# The Glass Architect

*Exported from LOOM · Mirrorlands · 2026-03-07*

---

Her hands trembled as she broke the seal. The envelope was old,
the wax brittle beneath her fingers…

---

She recognised the handwriting before she could stop herself.
Three letters in her dead brother's hand…

---
```

- Story name as H1
- Metadata line (italic): world name + export date
- Horizontal rule between each model message
- AI message content only (user messages excluded)
- Accordion-collapsed segments: summary text included (not expanded)
- Markdown rendered as-is (no additional processing)

---

## 4. Full Branch JSON Export (Developer Tool)

### 4.1 Trigger

Settings → Developer → `[ ↓ Export Full Branch JSON ]`.
Available only when a story is currently open.

### 4.2 Export Schema

```json
{
  "export_version":  1,
  "loom_version":    "0.1.0",
  "story_name":      "The Glass Architect",
  "world_name":      "Mirrorlands",
  "exported_at":     "2026-03-07T17:00:00Z",
  "branch_depth":    14,
  "branch": [
    {
      "turn": 1,
      "user": {
        "plot_direction":        "She opens the letter…",
        "background_information":"The letter was from her dead brother.",
        "modificators":          ["dark horror"]
      },
      "model": {
        "content":       "The envelope crinkled…",
        "model_name":    "gemini-2.5-flash-preview",
        "token_count":   312,
        "finish_reason": "STOP",
        "feedback":      "Pacing felt rushed here.",
        "feedback_in_context": true
      }
    }
  ]
}
```

**`feedback_in_context`:** `true` when `user_feedback` is non-null and was
therefore injected into the AI history context for subsequent requests.
This makes the export self-documenting about what the AI actually received.

### 4.3 Tauri Command

```rust
#[tauri::command]
pub async fn export_full_branch_json(
    state: tauri::State<'_, AppState>,
    story_id: String,
    leaf_id: String,
) -> Result<String, LoomError>
// Returns JSON string; frontend saves via tauri-plugin-dialog save()
```

Output filename: `<story_name>_branch_<YYYYMMDD>.json`

---

## 5. Tauri Command Reference

| Command | Parameters | Returns |
|---|---|---|
| `export_story_markdown` | `story_id: String, leaf_id: String` | `String` (markdown text) |
| `export_full_branch_json` | `story_id: String, leaf_id: String` | `String` (JSON text) |