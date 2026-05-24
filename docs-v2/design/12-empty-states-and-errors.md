# 12 — Empty States and Errors

> **Status:** Complete — copy verified against the Designfiles where covered; uncovered copy still provisional ⚠️
> **Last updated:** 2026-05-23 — Phase 12.5 (DG-06): added §Error Display Hierarchy → "0 — `LoomError` → display rule" — the variant↔surface↔copy routing matrix CLAUDE.md §Quality bar item 5 promised, indexed by all 11 `LoomError` kinds + the four `validation_kind` sub-cases. This is the contract `surfaceError()` (CD-33) implements from.
> **Earlier:** 2026-05-17 — Designfiles reconciliation (Phase 12 prep): empty-state copy verified against `docs-v2/design/Designfiles/Phase 0D - Components.html` and `Phase 1 / Phase 2`. ⚠️ cleared on the three states the mockups confirm verbatim — No Worlds subtext, No Story Selected (without recents) headline, No Messages headline + subtext. States the Designfiles do not yet cover (No Stories, No Source Documents, No Attached Documents, No Search Results, Handover/Consulting empty) and the §Error Copy Reference remain ⚠️ provisional. Toast tier unchanged (see `docs-v2/future/toast-free-notifications.md` for the future direction).
> **Earlier:** 2026-04-26

Empty states and error surfaces are first-class UI. Blank screens are bugs. Every zero-data condition and every error class has a specified presentation here.

---

## Empty State Template

All empty states share a structural template. Deviations require explicit justification.

```
┌──────────────────────────────────────────┐
│                                          │
│           [Icon — 40–48px]               │
│                                          │
│         Headline text                    │
│       Supporting subtext                 │
│                                          │
│         [Primary action]                 │  ← optional
│                                          │
└──────────────────────────────────────────┘
```

**Layout:** Vertically and horizontally centered within its container. Flex column, gap between elements.

**Token references:**

| Element | Tokens |
|---|---|
| Icon | `--color-text-muted`, 40–48px |
| Headline | `--color-text-primary`, 15px / 500 |
| Subtext | `--color-text-secondary`, 13px / 400 |
| Primary action | Button or underline text link, `--color-accent` |

**Copy principle:** The copy creates atmosphere — terse, slightly literary, not chatty. No exclamation marks. No "Oops." Provisional copy is marked ⚠️ and will be refined in the design pass.

---

## Empty States

### No Worlds (Vault — no worlds created yet)

Shown in the WorldPicker when no worlds exist. The first step of onboarding covers this, so this state should only appear post-onboarding if a world is deleted.

```
Icon:       Globe (40px)
Headline:   "No worlds yet."
Subtext:    "A world holds your stories, documents, and settings."
Action:     [Create your first world]  → opens CreateWorldModal
```

---

### No Stories (Navigator — world open, vault root or folder is empty)

Shown in the Navigator when the active world has no stories (or the current folder is empty).

```
Icon:       BookOpen (40px)
Headline:   "Nothing here yet."
Subtext:    "Create a story to start writing."  ⚠️
Action:     [New story]  → opens create story flow
```

---

### No Story Selected (Theater — stories exist, none selected)

Shown when the vault has stories but none is active. Includes a recent stories list if available (up to 5 entries with timestamps).

**With recents:**
```
Headline:   "Select a story to continue."  ⚠️
            ─────────────────────────────
            Story Title One                2h ago
            Story Title Two               yesterday
            Story Title Three            3 days ago
            ...
```

**Without recents:**
```
Icon:       BookOpen (40px)
Headline:   "Select a story from the Navigator, or create one to begin."
```

Recent story entries use `--color-text-primary` for the title and `--color-text-muted` for the timestamp. Clicking a row opens the story.

---

### No Messages (Theater — story open, no messages sent yet)

Shown in the Theater when a story is selected but has no messages.

```
Icon:       (none — the InputArea itself invites action)
Headline:   "Your story begins here."
Subtext:    "Write a direction and press Send to start."
```

No action button — the InputArea below is the action.

---

### No Source Documents (Control Pane — no docs exist in vault)

Shown in the context docs section of the Control Pane when the vault has no source documents at all.

```
Icon:       FileText (32px)
Headline:   "No documents yet."  ⚠️
Subtext:    "Add a source document to attach it to a story."  ⚠️
Action:     [Create document]  → creates new source doc in vault
```

---

### No Attached Documents (Control Pane — docs exist, none attached to this story)

Shown when source documents exist in the vault but none is attached to the current story.

```
Icon:       (none — inline in section, compact)
Text:       "No documents attached."  ⚠️
Action:     [Attach]  → opens attachment picker
```

This is a compact inline state, not the full centered template — the Control Pane section is narrow.

---

### No Search Results (Navigator search)

Shown when a search query returns no matches.

```
Icon:       Search (32px)
Headline:   "No results for "{query}"."
Subtext:    "Try a different search term."  ⚠️
```

Query is interpolated verbatim. No action button.

---

### Trash Empty

Shown when the Trash view is open and contains no items.

```
Icon:       Trash2 (40px)
Headline:   "Trash is empty."
Subtext:    (none)
```

---

### Handover — No Content

Shown in the Theater when handover mode is active but no handover output has been generated yet. Placeholder — final copy defined in Doc 21 (Export and Reader View).

```
Icon:       FileOutput (40px)  ⚠️
Headline:   "No handover generated yet."  ⚠️
Subtext:    "Generate a structured report about this story."  ⚠️
Action:     [Generate handover]  → triggers handover generation
```

---

### Consulting — No History

Shown in the consulting conversation pane when no consulting messages exist. Placeholder — final copy and structure defined in Doc 23 (Modes).

```
Icon:       MessageSquare (40px)  ⚠️
Headline:   "No consulting conversation yet."  ⚠️
Subtext:    "Ask questions or get feedback about your story."  ⚠️
```

---

## Error Display Hierarchy

Errors surface at three levels. The level is determined by severity and recoverability.

### 0 — `LoomError` → display rule (the routing contract)

Every Tauri command returns `Result<T, LoomError>`. The error crosses IPC as an
adjacently-tagged object `{ "kind": …, "message": … }` (Doc 05 §LoomError; HB-01).
The frontend's `surfaceError(err, context)` helper switches on `err.kind` and
routes to the tier + copy below. `context` lets a call site override the default
surface where the same variant means different things (e.g. a `crypto` failure on
the unlock screen is inline "Incorrect password", not a blocking modal).

| `kind` | Default surface | Default copy (→ §Error Copy Reference row) |
|---|---|---|
| `crypto` | Blocking modal — *unlock screen overrides to Inline* | "Could not unlock your vault." / unlock: "Incorrect password." (Auth → Wrong password) |
| `database` | Blocking modal | "A database error occurred." / message-send: "Failed to save your message…" (Vault/DB → DB write failed) |
| `not_found` | Toast (6s) | "That item could no longer be found." ⚠️ |
| `validation` | Inline (field/section) — keyed by `message.validation_kind`, see below | uses `message.reason` |
| `forbidden` | Toast (6s) | uses `message` — the op is prohibited (e.g. "Built-in templates can't be deleted") |
| `api_error` | Toast (6s) — persistent for rate/key/filter sub-cases | "Cannot reach the AI service. Check your connection." (Generation → Network unreachable / Invalid API key) |
| `cache_create` | Toast (6s) | "Couldn't attach story context; sent without the cache." ⚠️ (Doc 22 §Fallback to Inline) |
| `rate_limited` | Toast (persistent) | "Rate limit reached. Wait a moment before sending." (Generation → Rate limited) |
| `io` | Inline (where a field exists) / Toast (6s) | "Failed to save. Check available disk space." (Vault/DB → Doc save failed) |
| `serialization` | Toast (6s) | "Something went wrong processing data." ⚠️ |
| `internal` | Toast (6s) | "An unexpected error occurred." ⚠️ |

`validation` carries a `message.validation_kind` discriminator; route on it:

| `validation_kind` | Default surface | Default copy |
|---|---|---|
| `generic` | Inline | uses `message.reason` |
| `invalid_setting_value` | Inline under the setting field; auto-save stays suppressed until valid (Doc 20) | uses `message.reason` |
| `no_baseline` | Toast (6s) ⚠️ | "Nothing to compare against yet." ⚠️ *(defined; no raise site in v2.0)* |
| `protected_sentinel` | Toast (6s) | "The story's opening checkpoint can't be removed." ⚠️ (accordion start sentinel) |

> **Generation errors** also arrive out-of-band via the `generation_failed` /
> `session_generation_failed` events (`error_kind ∈ {api_error, rate_limited,
> validation, internal}`), not as a command `Result`. `surfaceError` is the
> shared sink for both paths so the copy and surface match (CD-33).

### 1 — Toast (transient, bottom-right)

Used for: operation results, recoverable errors, undo confirmations.

**Implementation:** Sonner toast library. Rendered via a single `<Toaster />` in `App.tsx`.

| Property | Value |
|---|---|
| Position | Bottom-right |
| Duration (standard) | 4 seconds |
| Duration (error) | 6 seconds |
| Duration (persistent) | Manual dismiss only (`duration: Infinity`) |
| Max visible at once | 3 (older toasts auto-dismiss) |

**Toast variants:**

| Variant | Use case | Visual |
|---|---|---|
| Default | Operation success, info | `--color-bg-elevated`, `--color-text-primary` |
| Error | Recoverable error | `--color-error` left border or icon |
| Undo | Reversible action completed | Default + "Undo" action link |

**When to use persistent toasts:** Rate limit hit (user must dismiss to acknowledge), invalid API key (requires action), content filtered by API.

---

### 2 — Inline error

Used for: form validation, field-level errors, section-level failures that don't block the whole UI.

**Placement:** Directly below the input or section that produced the error.

**Visual:**
```
⚠  Error message text here.
```

Icon: `AlertCircle` 14px, `--color-error`. Text: 12px, `--color-error`. No background, no border — text only.

**When to use:** Invalid world name, template save failure, doc save failure, model not available.

---

### 3 — Blocking modal

Used for: errors that prevent any further action until resolved.

**Structure:** shadcn Dialog. Full-screen backdrop. Cannot be dismissed by clicking outside or Escape — only by the provided button(s).

**When to use:**
- Vault unlock failure (wrong password — requires explicit retry)
- DB write failure on message send (data loss risk — user must acknowledge)
- App config corruption detected on launch

**Structure:**
```
Title       — short imperative ("Cannot unlock vault")
Body        — one sentence: what happened and what to do next
[Action]    — single primary action (Retry, Reload App, etc.)
```

Blocking modals do not have a Cancel button unless there is a safe fallback option.

---

## Error Copy Reference

Provisional copy ⚠️ — will be refined in the design pass. Format is consistent: no jargon, no stack traces, no HTTP status codes visible to the user.

### Generation errors

| Error | Surface | Copy |
|---|---|---|
| Rate limited | Toast (persistent) | "Rate limit reached. Wait a moment before sending." |
| Invalid API key | Toast (persistent) | "Invalid API key. Update it in Settings." |
| Network unreachable | Toast (6s) | "Cannot reach the AI service. Check your connection." |
| Context length exceeded | Toast (6s) | "Story context is too long to send. Try compressing earlier segments." |
| Content filtered | Toast (persistent) | "The response was blocked by the content filter." |
| Generation cancelled | Toast (4s) | "Generation cancelled." |

### Vault / DB errors

| Error | Surface | Copy |
|---|---|---|
| World open failed | Blocking modal | "Cannot open this world. The file may be corrupted." |
| DB write failed (message) | Blocking modal | "Failed to save your message. Your input has not been lost." |
| Item rename failed | Toast (6s) | "Rename failed. Try again." |
| Doc save failed | Inline | "Failed to save. Check available disk space." |
| Trash empty failed | Toast (6s) | "Could not empty trash. Try again." |

### Auth errors

| Error | Surface | Copy |
|---|---|---|
| Wrong password | Inline (unlock screen) | "Incorrect password." |
| Password change failed | Toast (6s) | "Password change failed. Try again." |
| Vault locked during generation | — | Handled by confirmation dialog (Doc 11), not an error |

---

## Error Boundary

`ErrorBoundary` wraps the root app and catches unexpected React render errors. On catch, it replaces the entire app UI with a minimal fallback:

```
┌──────────────────────────────────────────┐
│                                          │
│   Something went wrong.                  │  ← --color-error, 15px/500
│   An unexpected error occurred in LOOM.  │  ← --color-text-secondary, 13px
│                                          │
│   [Reload app]                           │
│                                          │
└──────────────────────────────────────────┘
```

This is a last resort — `ErrorBoundary` should never trigger in normal use. It does not handle Tauri command errors (those are handled per-call in `tauriApi/`). Catches only synchronous render errors.

**Source:** `src/components/shared/ErrorBoundary.tsx` (class component — required by React error boundary API).
