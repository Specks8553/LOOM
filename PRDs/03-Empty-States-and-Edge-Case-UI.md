# 03 — Empty States and Edge-Case UI

## Purpose

This document specifies every empty state, zero-data condition, and edge-case UI
in LOOM. Each entry defines exactly what renders, what copy is used, and what
actions are available. The coding agent must implement these states — placeholder
or blank renders are not acceptable in v1.

> **Coding-agent note:** Empty states are pure React components in
> `src/components/empty/`. Each is self-contained and receives no props beyond
> optional callbacks. They are rendered conditionally by parent pane components
> when the relevant data is empty or null.

---

## 1. Theater Empty States

### 1.1 No Story Selected (`<NoStorySelected />`)

**Condition:** `workspaceStore.activeStoryId === null`

**Renders in:** Theater (CenterPane), replacing the message list and input area.

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│             RECENT STORIES                              │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  📖  The Glass Architect          2h ago         │   │
│  │      World: Mirrorlands                          │   │
│  ├──────────────────────────────────────────────────┤   │
│  │  📖  Red Coast (Chapter 3)        yesterday      │   │
│  │      World: The Fold                             │   │
│  ├──────────────────────────────────────────────────┤   │
│  │  📖  Untitled Story               3 days ago     │   │
│  │      World: Mirrorlands                          │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│        or select a story from the Navigator             │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Content:**
- Section label: `RECENT STORIES` — `11px`, uppercase, `--color-text-muted`
- Up to 5 most recently modified stories in the active world
  (query: `SELECT id, name, modified_at FROM items WHERE item_type = 'Story'
  AND deleted_at IS NULL ORDER BY modified_at DESC LIMIT 5`)
- Each card: story name (`14px`, `--color-text-primary`) + relative timestamp
  (`11px`, `--color-text-muted`) + world name (`11px`, `--color-text-muted`)
- Click card → `load_story_messages(id)`, set `activeStoryId`
- Footer: *"or select a story from the Navigator"* — `13px`, `--color-text-muted`

**If no stories exist:** hide cards entirely, show:
*"Select a story from the Navigator, or create one to begin."*

---

### 1.2 Empty Story — No Messages (`<EmptyStory />`)

**Condition:** `activeStoryId !== null` AND `messageMap` empty.

**Renders in:** Theater message list area only. Input area always visible.

```
┌──────────────────────────────────────────────────────┐
│                                                       │
│              Your story begins here.                  │
│                                                       │
│   Write a plot direction and press Send to start.    │
│                                                       │
└──────────────────────────────────────────────────────┘
```

- Headline: `17px`, `--font-theater-body`, italic, `--color-text-muted`
- Sub-text: `13px`, Inter, `--color-text-muted`
- Content vertically centered in message area

---

### 1.3 Rate Limit Banner (Theater)

**Condition:** `check_rate_limit()` returns `can_proceed: false`.

Renders above the input area, inside the Theater bottom zone.

```
┌──────────────────────────────────────────────────────────────────┐
│  ⚠  Rate limit reached (RPM) · Try again in 0:47               │
└──────────────────────────────────────────────────────────────────┘
```

- Background: `rgba(245,158,11,0.12)`, Border: `1px solid rgba(245,158,11,0.3)`
- Icon: `lucide-react AlertTriangle`, `14px`, `--color-warning`
- Text: `13px`, Inter, `--color-warning`
- `{reason}`: `RPM`, `TPM`, or `RPD`
- Countdown: `setInterval(1000)` counting down from `wait_ms`
- At zero: banner auto-dismisses, `check_rate_limit()` re-called; Send re-enabled
  only after confirmed clearance
- Send button: disabled while banner is visible

---

### 1.4 Generation Error Banner (Theater)

**Condition:** `send_message` returns an error (non-429).

```
┌──────────────────────────────────────────────────────────────────┐
│  ✕  Generation failed: [error message]         [Retry]          │
└──────────────────────────────────────────────────────────────────┘
```

- Background: `rgba(244,63,94,0.12)`, Border: `1px solid rgba(244,63,94,0.3)`
- `[Retry]` calls `send_message` again with same parameters
- Dismissed automatically when user edits the input and sends again

---

### 1.5 Google 429 Error (Theater)

**Condition:** Google returns `RESOURCE_EXHAUSTED` (429).

```
┌──────────────────────────────────────────────────────────────────┐
│  ✕  Request rejected by Google (429 — quota exceeded).          │
│     Wait for your quota to reset before retrying.               │
└──────────────────────────────────────────────────────────────────┘
```

- Rose color scheme (same as §1.4)
- No automatic retry — user retries manually
- Rate limit banner also shown simultaneously

---

## 2. Navigator Empty States

### 2.1 Empty Vault Tree (`<EmptyVault />`)

**Condition:** `vaultStore.items` is empty for the active world.

**Renders in:** Navigator tree area (replaces tree list).

```
No items yet.
Click  +  to create your first story or document.
```

- `12px`, `--color-text-muted`, centered in tree area
- `+` styled as accent-colored inline reference

---

### 2.2 No Search Results

**Condition:** `vaultStore.filterQuery` non-empty AND no items match.

```
No results for "glasarch"
```

- `12px`, `--color-text-muted`, centered

---

### 2.3 Empty Trash (`<EmptyTrash />`)

**Condition:** Trash folder selected AND `vaultStore.trashItems` empty.

```
Trash is empty.
```

---

## 3. Control Pane Empty States

### 3.1 No Context Docs Attached

Shown in Context Docs section when `controlPaneStore.attachedDocIds` is empty.

```
No documents attached.
Attach source documents via the 📎 icon in the vault tree.
```

`12px`, `--color-text-muted`.

---

### 3.2 No Active Story (Control Pane)

**Condition:** `activeStoryId === null`.

The Control Pane renders its sections as greyed-out stubs with a message:

```
Open a story to see its details.
```

Context Docs section, System Instructions, Feedback toggle, and Branch Info
all replaced with this single message.
Telemetry bars remain visible and active.

---

## 4. World Picker Empty States

### 4.1 No Worlds

**Condition:** `vaultStore.worlds` empty (all deleted or never created).

Shows `<CreateFirstWorld />` — same as onboarding step 4 but within the
World Picker modal context.

---

## 5. Source Document Viewer/Editor Empty States

### 5.1 Empty Document Content

**Condition:** Source Document opened AND content is empty (no markdown, no text).

```
This document is empty.
Click to start writing, or use a template.
```

Inline within the editor area. Click activates the editor.

---

## 6. Loading States

### 6.1 Story Loading Spinner

**Condition:** `load_story_messages` in-flight.

Theater message area replaced with:
```
[spinner]  Loading…
```

Centered. `lucide-react Loader2` animated, `--color-text-muted`.
Only shown if loading takes > 200ms (avoids flash on fast loads).

### 6.2 World Switching Spinner

Full Theater + Control Pane covered by:
```
[spinner]  Switching world…
```

Same visual as §6.1.

---

## 7. Vault Trash View

**Condition:** User clicks Trash item in Navigator.

Renders in Theater (replaces message area and input):

```
┌──────────────────────────────────────────────────────────────────┐
│  Trash                                    [Empty Trash]         │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  📖  The Glass Architect        Deleted 2 days ago  [Restore]   │
│  📄  Character — Old Draft      Deleted 1 week ago  [Restore]   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

- Items listed with name, relative deletion time, `[Restore]` button
- `[Empty Trash]`: confirmation dialog → `vault_purge_item` for all items
- `[Restore]`: calls `vault_restore_item(id)` → item returned to original path

---

## 8. `<CreateFirstWorld />` Screen

**Condition:** No worlds exist after unlock.

Renders in full workspace area (all three panes replaced).

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                Create Your First World                         │
│                                                                 │
│   A world holds all the stories, documents, and settings       │
│   for one creative project. You can create more later.         │
│                                                                 │
│   World name                                                   │
│   [ My World                                                ]  │
│                                                                 │
│   ── or ──                                                     │
│                                                                 │
│   [ ↑ Import an existing world (.loom-backup) ]                │
│                                                                 │
│                              [ Create World ]                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

On Create: calls `create_world(name)`. On success: loads vault, shows workspace.
Import: calls `vault_import_world(src_path)`.

---

## 9. Onboarding "Back to Locked World" Guard

If the user is mid-onboarding (step 3–4) and `app_config.json` already exists
(set in step 2), pressing Back on step 2 after config creation does NOT delete
`app_config.json`. The config was already written; the user can restart the app
and will see the Lock Screen. LOOM does not offer a "delete everything and start
over" option in v1.

---

## 10. Max Context Warning

When token count exceeds 90% of the configured limit (`context_token_limit`):

```
⚠  Approaching context limit (~115,200 / 128,000 tokens).
   Consider summarising earlier chapters with Accordion.
```

- Amber banner inside Theater, above message list
- Not dismissible
- Disappears once token count drops back below 85% (e.g. after Accordion collapses a segment)

---

## 11. Ghostwriter Cancel Confirmation

**Condition:** Escape pressed OR navigation away while Ghostwriter mode is active
with unsaved diff.

```
Discard Ghostwriter changes?
  The generated replacement text will be lost.

                      [Keep Editing]   [Discard]
```

- If a new branch was created (non-latest message path): branch is destroyed on Discard.
- If same-branch replacement: original content is restored.

---

## 12. Performance: Theater Message List

The Theater message list must support **virtual scrolling** (windowed rendering)
to maintain performance for long stories. Only messages visible in the viewport
(plus a configurable overscan buffer) are rendered in the DOM.

**Implementation:** Use a virtualized list library (e.g., `@tanstack/react-virtual`
or `react-window`) for the Theater message list.

**Expected upper bounds:**
- Tested branch depth: up to 2,000 message pairs (~4,000 messages)
- Target load time for `load_story_messages`: < 500ms for 2,000 pairs
- DOM nodes: maximum ~50 message bubbles rendered at any time regardless of story length

Stories exceeding 2,000 pairs should still function but may exhibit degraded
scroll performance. Accordion compression is the recommended mitigation.
