# 10 — Control Pane

## Purpose

This document specifies the right-side Control Pane in the LOOM workspace.
The Control Pane provides story-level context controls, context document
management, system instructions, a feedback overlay, and telemetry bars.

> **Coding-agent note:** The Control Pane is `src/components/RightPane.tsx`.
> Its state lives in `controlPaneStore` (Zustand). The feedback overlay is
> `src/components/overlays/FeedbackOverlay.tsx`. Context doc attachment state
> is persisted per-story in the `story_settings` table.

---

## 1. Layout and Collapse

### 1.1 Dimensions

- Default width: `280px` (resizable via pane divider, see `02-Design-System.md §4.1`)
- Collapsed width: `0px` (fully hidden, border also hidden)
- Collapse toggle: `lucide-react PanelRightClose` / `PanelRightOpen` button
  anchored to the left edge of the pane, vertically centered
- Collapse state persisted: `localStorage` key `right_pane_collapsed`
- Collapse transition: `width 200ms ease`, `opacity 150ms ease`

### 1.2 Collapse Toggle — Rate Limit Indicator Dot

When the Control Pane is collapsed, a small status dot appears on the
collapse toggle button to keep rate limit visibility at all times:

```css
.rate-limit-dot {
  width: 6px; height: 6px; border-radius: 50%;
  position: absolute; top: 4px; right: 4px;
}
.rate-limit-dot[data-status="ok"]     { background: #10b981; }
.rate-limit-dot[data-status="warn"]   { background: #f59e0b; }
.rate-limit-dot[data-status="danger"] { background: #f43f5e; }
```

`data-status` logic:
- `"ok"`: all of RPM, TPM, RPD < 60% usage — dot hidden entirely
- `"warn"`: any metric 60–80% — amber dot visible
- `"danger"`: any metric > 80% — red dot visible

### 1.3 Auto-Collapse at Narrow Viewport

When `window.innerWidth < 1200px`: auto-collapse (set `rightPaneCollapsed = true`).
Does not auto-re-open when window widens — user must manually reopen.

### 1.4 Section Order (Top to Bottom)

```
┌─────────────────────────────────┐
│  Story Title + Branch Info  [🗺]  │  §2
│  ─────────────────────────────  │
│  Description (if set)           │  §2.3
│  ─────────────────────────────  │
│  Metadata Strip                 │  §3
│  ─────────────────────────────  │
│  Context Docs                   │  §4
│  ─────────────────────────────  │
│  System Instructions            │  §5  (collapsible)
│                                 │
│  [Feedback ▾] toggle            │  §6  (opens overlay)
│                                 │
│  ─────────────────────────────  │
│  Telemetry Bars                 │  §7  (pinned to bottom)
└─────────────────────────────────┘
```

---

## 2. Story Title + Branch Info

```
┌─────────────────────────────────┐
│  The Glass Architect        [🗺] │  ← story name + branch map button
│  Branch 2 of 3  ·  depth 14    │
└─────────────────────────────────┘
```

- **Story name:** `14px`, Inter 600, `--color-text-primary`. Click → inline rename
  (`Enter` confirms, `Escape` cancels, calls `vault_rename_item`).
- **Branch Map button:** `lucide-react GitFork` icon, `14px`, right-aligned.
  Opens/closes the Branch Map drawer. Tooltip: *"Branch Map (Ctrl+M)"*.
- **Branch info:** `11px`, `--color-text-muted`
  - `Branch N of M` — current branch / total branches at deepest fork
  - `depth N` — message pairs in current branch
- Padding: `16px 14px 10px 14px`

### 2.3 Story Description

If the story has a non-empty `description` field, shown below branch info:

```
  The story of Elara Voss and the glass...
```

`12px`, italic, `--color-text-secondary`. Click → inline edit (textarea).
Saves on blur via `update_item_description(id, value)`.

---

## 3. Metadata Strip

```
18 messages  ·  ~2,400 words  ·  3 docs attached
```

- `12px`, Inter 400, `--color-text-muted`
- **Message count:** non-deleted messages in current branch
- **Word count:** `~Math.round(totalChars / 5)` words from model messages
- **Docs attached:** count of currently attached context docs. Hidden if 0.
- Padding: `0 14px 12px 14px`

---

## 4. Context Docs

*(Previously called "Handover Docs" — renamed to "Context Docs" throughout.)*

### 4.1 Section Header

```
CONTEXT DOCS                     [?]
```

- `10px`, Inter 600, uppercase, letter-spacing `0.08em`, `--color-text-muted`
- `[?]` tooltip: *"Source documents attached here are sent to the AI with every
  message as context. They are not shown in the story output."*

### 4.2 Attached Docs List

```
📄 character_profile  ·  Elara Voss     [✕]
📄 world_building     ·  The Fold        [✕]
```

- Icon: template-defined icon (`16px`, `--color-text-muted`)
- Subtype label: `11px`, italic, `--color-text-muted`
- Doc name: `12px`, Inter 500, `--color-text-primary`
- `[✕]` remove button: `lucide-react X`, `12px`, visible on hover
  Calls `detach_context_doc(story_id, doc_id)`. Does not delete doc from vault.
- Chip background: `--color-bg-elevated`, border: `1px solid --color-border`,
  border-radius: `6px`, padding: `6px 8px`

### 4.3 Empty State

```
No documents attached.
Attach source documents via the 📎 icon in the vault tree.
```

`12px`, `--color-text-muted`, centered, padding `12px 14px`.

### 4.4 Attaching via Paperclip Icon

Every Source Document in the Navigator has a `lucide-react Paperclip` icon
(`13px`) on hover, to the left of the `[⋯]` menu button.

- Not attached → `attach_context_doc(story_id, doc_id)` → chip appears, icon turns accent
- Currently attached → `detach_context_doc(story_id, doc_id)` → chip removed

State derived from `controlPaneStore.attachedDocIds: Set<string>`.

### 4.5 Persistence

Attached doc IDs persisted per-story in `story_settings` table, key `context_doc_ids`
(JSON array). Loaded on story open via `get_context_docs(story_id)`.

### 4.6 Vault Deletion Integrity

When a Source Document is **soft-deleted**:
1. Removed from `controlPaneStore.attachedDocIds` for any story that had it attached
2. Placed in **"Previously Attached"** subsection in vault Trash
3. Attachment history preserved in `attachment_history` table

When permanently purged:
- `attachment_history` records marked `doc_purged = true`, retained for provenance

### 4.7 `attachment_history` Table

```sql
CREATE TABLE IF NOT EXISTS attachment_history (
    id          TEXT PRIMARY KEY,
    story_id    TEXT NOT NULL,
    doc_id      TEXT NOT NULL,
    doc_name    TEXT NOT NULL,
    attached_at TEXT NOT NULL,
    detached_at TEXT,
    doc_purged  INTEGER NOT NULL DEFAULT 0
);
```

---

## 5. System Instructions

```
SYSTEM INSTRUCTIONS    [▲ collapse]
┌──────────────────────────────────────┐
│ You are a master storyteller…        │
└──────────────────────────────────────┘
Applied to every AI request in this world.
```

- Expanded by default. Collapse state: `localStorage` key `ctrl_sysinstr_collapsed`
- `<textarea>`, `12px`, Inter 400, `--color-text-secondary`, `min-height: 80px`, auto-grow
- Saves on blur via `save_settings("system_instructions", value)`
- Synced with Settings → Writing → System Instructions (same store value)

---

## 6. Feedback Overlay

### 6.1 Toggle Button

```
[ ◎ Feedback  (7) ]
```

`lucide-react MessageSquare`, `13px`. Badge with count of non-empty feedback entries.
Click toggles overlay open/closed.

### 6.2 Overlay Layout

Slides in from right, covering pane content above telemetry bars:

```css
.feedback-overlay {
  position: absolute;
  inset: 0;
  bottom: <telemetry-bar-height>px;
  background: var(--color-bg-base);
  z-index: 20;
}
```

Slide animation: `transform: translateX(100%)` → `translateX(0)`, `200ms ease`.

### 6.3 Feedback Entry List

Each message with non-empty `user_feedback` renders as an entry:

```
┌───────────────────────────────────────┐
│ "…she recognised the handwriting…"    │  ← excerpt, 11px italic, muted
│ ┌──────────────────────────────────┐  │
│ │ This pacing felt rushed.        │  │  ← editable textarea
│ └──────────────────────────────────┘  │
│                        [→ Go to msg]  │
└───────────────────────────────────────┘
```

- Message excerpt: first 60 chars of model content
- Feedback textarea: editable, saves on blur
- `[→ Go to msg]`: closes overlay, scrolls Theater to message
- Ordered root → leaf

**Note on Feedback and AI History:**
Feedback entered here is injected directly into the AI history context
(appended to the model message content as `[WRITER FEEDBACK]\n{text}`)
with every subsequent `send_message` call. This means the AI always
reads feedback inline where it applies, without any additional configuration.

### 6.4 Empty State

```
No feedback notes yet.
Add feedback via the speech bubble icon on any AI message.
```

---

## 7. Telemetry Bars

Pinned to bottom of Control Pane.

```
USAGE
─────────────────────────────
RPM  ████████░░  8 / 10
TPM  ████░░░░░░  98,432 / 250,000
RPD  ██░░░░░░░░  312 / 1,500
```

- Section header: `10px`, Inter 600, uppercase, `--color-text-muted`
- Bar color thresholds: < 60% emerald · 60–80% amber · > 80% rose
- Updated after every response via `telemetryStore.refresh()`
- Padding: `12px 14px`

Full specification in `06-Telemetry-and-Rate-Limiting.md §6.2`.

---

## 8. Tauri Command Reference

| Command | Parameters | Returns |
|---|---|---|
| `get_context_docs` | `story_id: String` | `Vec<ContextDoc>` |
| `attach_context_doc` | `story_id: String, doc_id: String` | `()` |
| `detach_context_doc` | `story_id: String, doc_id: String` | `()` |
| `get_attachment_history_story` | `story_id: String` | `Vec<AttachmentRecord>` |
| `get_attachment_history_doc` | `doc_id: String` | `Vec<AttachmentRecord>` |

`ContextDoc` struct:
```rust
pub struct ContextDoc {
    pub id: String,
    pub name: String,
    pub item_subtype: String,
    pub icon: String,
    pub content: String,
    pub file_uri: Option<String>,  // Gemini File API URI if uploaded
}
```
