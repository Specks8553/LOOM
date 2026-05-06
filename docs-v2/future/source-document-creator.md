# Future — Source Document Creator

> **Status:** Design captured for v2.1 — **not implemented in v2.0**
> **Captured:** 2026-04-29 from a Doc 18 design session
> **Replaces in v2.0:** Nothing. The schema field `templates.creator_instructions` exists and is populated for built-in templates, but is not consumed.

This document captures the v1.0 Source Document Creator design (a multi-turn AI dialogue that helps the writer fill out a template, then produces an XML field-block payload that overwrites the document) and outlines the redesign options the v2.0 modes architecture has opened up.

When v2.1 work begins, start here. The schema deltas, command sketches, and three architectural options are all enumerated below.

---

## What it is

The Creator is a structured AI dialogue tied to a single Source Document. The writer opens the editor, selects a "Creator" tab, and has a conversation that explores the document's subject (a character, a location, a magic system…). When the writer is satisfied, they press `[Generate Document]` and the model emits an XML field-block payload — `<FIELD:name>...</FIELD:name>` blocks — that LOOM parses and writes into `items.content`, replacing the live placeholders with concrete content.

The dialogue is per-document and per-template; its instructions come from `templates.creator_instructions`, which the template author writes (along with `default_content`).

---

## v1.0 Spec (verbatim summary)

The full v1.0 PRD is `PRDs/22-Source-Document-Creator.md` (and `PRDs/22-Source-Document-Creator-CODEX-TASK.md`). Carry-forward summary:

### Entry points

- **New-doc prompt** — when creating a SourceDocument from a template with non-empty `creator_instructions`, a modal asks `Use the Creator to populate this document?` with `[Open Blank]` / `[Open Creator]`.
- **Existing-doc tab** — the DocEditor header gains a `[Creator] [Document]` pill-tab switcher when `creator_instructions` is non-empty.

### Conversation persistence — `creator_messages` table

```sql
CREATE TABLE creator_messages (
    id          TEXT PRIMARY KEY,
    doc_id      TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK(role IN ('user','model')),
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL
);

CREATE INDEX idx_creator_messages_doc ON creator_messages(doc_id);
```

Linear conversation, no branching. Cascades on `items` deletion.

### Per-turn API request

```
System Instruction =
  [DOCUMENT FIELDS BLOCK]          ← auto-injected: extracted {{placeholder}} names
  + creator_instructions           ← from templates
  (+ OUTPUT MODE AMENDMENT         ← only on Generate Document call)

Messages =
  [DOCUMENT CONTEXT BLOCK]         ← synthetic user+model pair carrying current items.content;
                                      never stored
  + creator_messages (all rows)    ← full persisted history
  + new user turn                  ← regular turns only
```

The `[DOCUMENT FIELDS]` block is auto-prepended to the SI: `[DOCUMENT FIELDS: name, age, occupation, …]` (comma-separated placeholder names extracted from `templates.default_content`).

### Generate Document flow

When the writer presses `[Generate Document]`, an Output Mode Amendment is appended to the SI for that call only:

```
[OUTPUT MODE]
You are now in document output mode. Your response must contain ONLY XML field
blocks — no prose, no commentary…

<FIELD:field_name>
field content here
</FIELD:field_name>

Fields not discussed must be reproduced EXACTLY as in the current document state.
```

The response streams into a dedicated **output bubble** (visually distinct), is parsed for `<FIELD:...>` blocks, and the parsed fields are written back into `items.content` (replacing the corresponding `{{placeholders}}`). Fields not present in the response are preserved exactly.

### UI rules

- Conversation reset (`⋯` menu) deletes all `creator_messages` for the doc and re-fires the initial turn.
- `[Generate Document]` confirmation modal when current content is non-empty (`Replace document content?`).
- Initial AI turn fires automatically on first open (no user prompt; SI alone triggers the opener).
- Streaming behaviour identical to story streaming.

---

## What v2.0 changes

The original spec predates several v2.0 architectural decisions. These need to be folded into any v2.1 implementation:

1. **Modes umbrella (Doc 23, D-10).** Story / handover / consulting are top-bar modes. The Creator is structurally similar to a session — multi-turn, scoped to one container, separate from story history. It might be a fourth mode, or it might be a per-doc session that lives entirely inside the DocEditor surface.
2. **Caching architecture (Doc 22, D-11).** Every multi-turn surface in v2.0 has a caching answer (story cache, per-session consulting cache, uncached handover). The Creator needs one too. Per-doc cache? Uncached? Tied to the doc's content hash?
3. **`isGenerating` global lock (Doc 15 / Doc 16).** Any model call goes through the single global lock. A Creator turn would block — and be blocked by — story / session / accordion-summarise generations.
4. **Theater Composition (Doc 27).** The DocEditor takes the workspace surface (Doc 18 §Mode-Switcher Interplay) and hides modes / right pane. A Creator-as-mode would conflict; a per-doc session inside the editor shell would not.
5. **Settings cascade (Doc 03 §settings cascade).** v1.0 hardcoded the same world `text_model_name` for the Creator. v2.0 might want separate `gen_creator_*` keys or to inherit from story's `gen_*`.

---

## Architectural Options for v2.1

### Option A — Creator-as-mode (fourth mode)

Add `'creator'` to the modes enum. Top-bar shows Story / Handover / Consulting / Creator. The Creator mode is **document-bound** rather than story-bound: switching to it requires a doc to be open in the DocEditor; exiting returns to whichever mode was active before.

| Pros | Cons |
|---|---|
| Reuses Doc 23 session machinery wholesale | Modes are conceptually story-scoped — Creator breaks that |
| Status section, banners, cache machinery already exist | Top bar gets crowded; Creator is rare for most writers |
| Re-entry, snapshot, divergence already solved | Hard to reason about "active mode" when no doc is open |

### Option B — Creator-as-per-doc-session (lives inside DocEditor)

The DocEditor regains the v1.0 `[Creator] [Document]` tab switcher. The Creator tab is a session-style multi-turn interface, but it lives entirely inside the editor surface — the workspace mode switcher remains hidden (Doc 18 §Mode-Switcher Interplay), and the Creator is not a `messages.kind` value.

A new table `creator_messages` (per v1.0) holds the conversation, scoped by `doc_id`. A new `messages.kind` is **not** added — Creator messages are their own thing.

| Pros | Cons |
|---|---|
| Surgically scoped — no cross-doc impact | Duplicates session logic (banners, status, cancel) inside DocEditor |
| DocEditor-as-focused-state pattern is preserved | Two parallel "session" mechanisms in the codebase |
| Clean cascade — doc deletion = creator history gone (v1 already handled this) | |

### Option C — Creator-as-consulting-template (no new mode, no new tab)

The writer opens a consulting session targeted at a specific source doc (e.g. `Consulting → "About: Elara Voss"`). The session's SI is composed from the doc's template + the doc's current content. `[Generate Document]` becomes a special "send" that emits the OUTPUT MODE amendment and parses XML fields back to the doc.

| Pros | Cons |
|---|---|
| Reuses the entire consulting machinery | Conceptually weird — "consulting on a doc" isn't what consulting was designed for |
| No new tables, no new modes | The XML-parsing / writeback path is still bespoke |
| Snapshot integrity already handles doc-content drift | Right-pane / banner UI assumes story-scope, not doc-scope |

### Recommendation (provisional)

**Option B** when v2.1 begins. Reasoning:
- The Creator is *fundamentally tied to a single document*, not to a story. Modes (Option A) and consulting sessions (Option C) are story-scoped.
- The duplication concern in B is real but smaller than it looks — most of the complexity is in the OUTPUT MODE flow, which is unique to the Creator regardless of where it lives.
- DocEditor-as-focused-state is already established in Doc 18; the Creator tab fits that surface naturally.

---

## Schema deltas (Option B)

```sql
CREATE TABLE creator_messages (
    id          TEXT PRIMARY KEY,
    doc_id      TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK(role IN ('user','model')),
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL
);

CREATE INDEX idx_creator_messages_doc ON creator_messages(doc_id);
```

No other schema changes. `templates.creator_instructions` already exists.

---

## Commands (Option B sketch)

| Command | Purpose |
|---|---|
| `creator_load_messages(doc_id)` | Read all rows for the doc, ordered by `created_at` |
| `creator_send_turn(doc_id, content)` | Append user message, fire model call, stream response, persist model message |
| `creator_cancel_turn(doc_id)` | Cancel in-flight generation (silent, like story cancel) |
| `creator_generate_document(doc_id, confirm)` | OUTPUT MODE call; parses XML; calls `update_item_content` with merged content |
| `creator_reset_conversation(doc_id)` | Delete all rows; on next open, fire initial turn |

Events: `creator_message_chunk`, `creator_message_complete`, `creator_generation_failed`, `creator_generation_cancelled`. Same shape as their story counterparts (Doc 07).

`isGenerating` covers Creator generations. The Creator tab disables its input + Generate button while *any* model call is in flight (story / session / summarise / Creator).

---

## Open Questions (for v2.1 design pass)

1. **Caching.** Per-doc cache (the SI + current doc state) refreshed on every Creator turn? Or uncached? Doc-content drift is high during a Creator session, so a cache would invalidate constantly. Lean: **uncached**, like handover.
2. **Initial-turn timing.** Fire on first tab-switch to Creator, or on first `creator_messages` row absent? V1 was the latter. Consider: do we want an explicit "Start Creator" button to avoid surprise model calls?
3. **OUTPUT MODE field merging.** When the model omits a field that exists in the doc, we preserve. When the model adds a field that doesn't exist in the template, do we accept it (extend the doc) or reject it (template-defined fields only)? Lean: **accept**, treat the field block as a free-form key/value.
4. **Multi-doc Creator.** Could the Creator be aware of *other* attached source docs (e.g. building a character in the context of an existing world bible)? V1 was single-doc. v2.1 could optionally include attached docs in the Creator SI.
5. **Streaming the parsed document live.** Today the OUTPUT MODE response is parsed only after the stream completes. Could we update `items.content` live as `<FIELD:name>` closing tags arrive? Cute but probably over-scope for v2.1.
6. **Per-template generation parameters.** Should `templates` get its own `gen_*` overrides, or use the world's gen params, or a new `gen_creator_*` cascade?
7. **Cancellation mid-Generate.** If the writer cancels during the OUTPUT MODE stream, do we leave the doc untouched, or apply the partially-parsed fields? Lean: **leave untouched** — the writer cancelled because it was going wrong.

---

## Migration story from v2.0

There is no migration. v2.0 ships without `creator_messages`; v2.1 adds the table on next open (idempotent `CREATE TABLE IF NOT EXISTS`). Existing source docs retain their `templates.creator_instructions` (already populated for built-ins); the Creator tab simply appears when v2.1 lands.
