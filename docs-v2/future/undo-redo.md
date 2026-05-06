# Future — Undo / Redo (Operation Log)

> **Status:** Design captured for v2.1 — **not implemented in v2.0**
> **Captured:** 2026-04-28 from a Doc 15 design session
> **Replaces in v2.0:** Immediate hard-delete with confirmation modal (see Doc 15 §Deletion).

This document captures the full undo/redo design that emerged during Doc 15 planning. It was deferred from v2.0 because the integrity surface is large enough to warrant its own implementation phase. Everything here is design-complete; what remains is implementation and UI polish.

When v2.1 work begins, start here. The data-model amendments listed at the end are the schema deltas needed.

---

## Goal

A persistent operation log that lets the writer undo/redo any story-changing action — including generations — with full structural integrity. The writer can experiment fearlessly: every operation is reversible until the 7-day auto-purge horizon.

The system is **not** a toast-with-an-Undo-button. It is **two buttons in the story title bar** (Undo / Redo), greyed when their respective stack is empty, plus `Cmd/Ctrl+Z / Y` keyboard shortcuts that scope correctly (text editors keep their text-undo; clicks elsewhere drive the story-level log).

---

## Operation Log Model

Every story-changing operation produces one entry in `undo_log`. Undo applies the inverse of the operation; redo replays it.

### Schema

```sql
CREATE TABLE undo_log (
    id          TEXT PRIMARY KEY,
    story_id    TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL
                  CHECK(kind IN ('generate','delete','edit_user','regenerate',
                                 'checkpoint_create','checkpoint_delete',
                                 'segment_collapse','segment_expand')),
    payload     TEXT NOT NULL,    -- JSON; shape varies by kind
    created_at  TEXT NOT NULL,
    undone_at   TEXT              -- NULL = applied (undo stack)
                                   -- timestamp = undone (redo stack)
);
```

Schema additions to existing tables:

```sql
ALTER TABLE checkpoints           ADD COLUMN deleted_at TEXT;
ALTER TABLE accordion_segments    ADD COLUMN deleted_at TEXT;
-- messages.deleted_at already exists in v2.0 (reserved for this feature)
```

### Operation Kinds

| Kind | When written | Payload | Undo action |
|---|---|---|---|
| `generate` | After a successful `send_message` (any preserved finish state — `STOP`, `MAX_TOKENS`, `SAFETY`, `RECITATION`, mid-stream interruption, vault-lock mid-stream) | `{ user_message_id, model_message_id }` | Soft-delete both messages |
| `delete` | After delete-exchange or delete-from-here | `{ message_ids, checkpoint_ids, segment_ids }` | Clear `deleted_at` on all rows |
| `edit_user` | After edit-user-message-and-regenerate (one atomic op) | `{ message_id, prev_content, new_content, truncated_message_ids, truncated_checkpoint_ids, truncated_segment_ids, new_model_message_id }` | Restore `prev_content`, clear `deleted_at` on truncated set, soft-delete `new_model_message_id` |
| `regenerate` | After regenerate-last-response | `{ old_model_id, new_model_id }` | Clear `deleted_at` on `old`, soft-delete `new` |
| `checkpoint_create` | After creating a checkpoint | `{ checkpoint_id }` | Soft-delete the checkpoint (and any segment that referenced it on creation) |
| `checkpoint_delete` | After deleting a checkpoint | `{ checkpoint_id, segment_ids }` | Clear `deleted_at` on all |
| `segment_collapse` | After collapsing a segment | `{ segment_id, prev_is_collapsed }` | Restore `prev_is_collapsed` |
| `segment_expand` | After expanding a segment | `{ segment_id, prev_is_collapsed }` | Restore `prev_is_collapsed` |

**Out of the log for v2.1:** in-place model edits via `update_message_content` (including Ghostwriter writes), and edits to a segment's summary text. These remain non-undoable. A future iteration could add per-message edit history; `messages.ghostwriter_history` already does this for Ghostwriter edits.

### Cascading Soft-Delete

When a message is soft-deleted, dependent rows cascade. The cascade set is captured in the operation's payload so undo restores everything in one shot.

- **INV-9** Soft-deleting a message also soft-deletes any checkpoint anchored to it (`checkpoints.after_message_id = msg.id`).
- **INV-10** Soft-deleting a checkpoint also soft-deletes any segment that references it as `start_cp_id` or `end_cp_id`.
- **INV-11** Soft-deleting a message that falls within a segment's range also soft-deletes that segment.
- **INV-12** A live checkpoint anchors to a live message; a live segment references live checkpoints and contains only live messages.

### Stack Mechanics

| Action | Effect |
|---|---|
| New operation | Append entry with `undone_at = NULL`. **Atomically drop all entries with `undone_at IS NOT NULL` for that story** (redo stack invalidation per F1). |
| Undo | Take most recent entry where `undone_at IS NULL` → apply inverse → set `undone_at = now()` |
| Redo | Take most recent entry where `undone_at IS NOT NULL` → re-apply → clear `undone_at` |

The redo-stack-invalidation step (F1) is exactly:

```sql
DELETE FROM undo_log WHERE story_id = ? AND undone_at IS NOT NULL;
```

It never touches `messages` / `checkpoints` / `accordion_segments`.

### Auto-Purge (7-day horizon)

Two passes on story open:

```
-- Part A: purge undo_log entries older than 7 days
DELETE FROM undo_log
WHERE story_id = ?
  AND COALESCE(undone_at, created_at) < now() - INTERVAL 7 DAY;

-- Part B: purge soft-deleted rows no longer referenced by any live entry
For each row in (messages | checkpoints | accordion_segments)
WHERE deleted_at IS NOT NULL
  AND deleted_at < now() - 7d
  AND row.id NOT IN (any live undo_log entry's payload):
  Hard-delete the row.
```

After 7 days from the most recent state change of an entry, the operation is no longer undoable. Storage is bounded.

### Invariants (full list)

```
INV-1   undo_log.payload always references rows that exist in
        messages / checkpoints / accordion_segments (live or soft-deleted).

INV-2   undo_log entries are story-scoped; no cross-story restoration.

INV-3   Auto-purge entries: COALESCE(undone_at, created_at) < now - 7d.

INV-4   Auto-purge rows: deleted_at < now - 7d AND no live entry references them.

INV-5   F1 — any new operation atomically drops all redo entries.

INV-6   Undo / redo are idempotent (skip missing rows defensively).

INV-7   Every operation, undo, and redo marks the cache stale.

INV-8   Operations / undo / redo are blocked while a generation is in flight.

INV-9   Soft-deleting a message cascades to anchored checkpoints.

INV-10  Soft-deleting a checkpoint cascades to referencing segments.

INV-11  Soft-deleting a message within a segment's range cascades to that segment.

INV-12  Live rows reference live rows (no live row points to a soft-deleted row).

INV-13  Each operation, undo, and redo is one DB transaction. No partial states.
```

### UI

- **Undo / Redo buttons** in the story title bar (top right, before the lock icon). Greyed when their stack is empty. Tooltips show what would be undone/redone (`"Undo: delete 3 exchanges"`).
- **Keyboard:** `Cmd/Ctrl+Z` and `Cmd/Ctrl+Shift+Z` (or `Cmd/Ctrl+Y`) bound at the document level. Handler returns early when the focused element is an `INPUT`, `TEXTAREA`, or has `isContentEditable === true`, so text-editing undo continues to work inside fields.
- **Visual indication of soft-deleted rows:** none. Soft-deleted rows are simply absent from Theater. The Undo button being enabled is the only signal that something can come back.
- **No "Trash" view for messages.** Messages are not first-class citizens of the global vault Trash (which is item-scoped per Doc 14).
- **No manual "Clear undo history" button.** Auto-purge handles cleanup.

### Story-Quality Note

After undo across a generation boundary, the restored exchange may be semantically inconsistent with messages generated in its absence — the model never saw it. This is the writer's choice: they asked for the power, they curate the result. Because every operation is in the log, the writer can also undo back to the consistent state at any point.

---

## Schema Deltas Required for v2.1

When implementing this feature in v2.1:

1. **New table:** `undo_log` (definition above).
2. **Add column:** `checkpoints.deleted_at TEXT`.
3. **Add column:** `accordion_segments.deleted_at TEXT`.
4. **No change** to `messages.deleted_at` — already present in v2.0 (column is reserved for this feature; the v2.0 deletion implementation is hard-delete and never sets it).

History assembly must filter on `deleted_at IS NULL` for messages, checkpoints, and segments.

---

## v2.0 Bridge

While v2.0 ships with hard-delete-only, the schema is forward-compatible:

- `messages.deleted_at` already exists; v2.0 leaves it `NULL`.
- v2.0's hard-delete cascade (Doc 15 §Deletion) follows INV-9 / INV-10 / INV-11 in spirit — a message and its dependent rows are deleted together, just permanently.
- A v2.1 migration adds `undo_log`, plus `deleted_at` on `checkpoints` and `accordion_segments`. No data migration is required; old stories simply have no undo history.

---

## Open Questions for the v2.1 Session

When this feature is taken up:

1. Confirm the eight operation kinds are still the right set, or whether v2.0 experience suggests adding/removing any.
2. Decide whether segment-summary edits should also enter the log (currently deferred).
3. Confirm 7-day horizon vs. user-configurable retention.
4. Tooltip copy for the Undo / Redo buttons (full operation descriptions vs. terse).
5. Whether to add a small "N hidden exchanges" indicator near Undo when the stack is non-trivial (was rejected for the toast-free design but worth revisiting once the feature is live).
