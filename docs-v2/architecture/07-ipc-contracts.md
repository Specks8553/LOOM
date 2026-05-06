# 07 — IPC Contracts

> **Status:** Format complete — command signatures populated as feature docs are written (see IMPL-NOTES.md IN-07)
> **Last updated:** 2026-05-04 — Feedback design pass (D-17): `update_feedback` row annotated with Doc 28 server-side preconditions (rejects non-story-kind messages with `Validation`; cache + accordion stale rules apply per Doc 22 / Doc 16).
> **Earlier:** 2026-05-03 — pre-implementation audit resolution: accordion command names + events rewritten to match Doc 16 — `load_accordion` → `get_accordion_state`, `edit_segment_summary` → `update_segment_summary`, `cancel_summarise_segment` removed (covered by `cancel_generation`), `clear_segment_summary` added, the four `accordion_summarise_*` streaming events removed (summarisation is non-streaming), `accordion_state_changed` payload narrowed to `{ story_id, segment_id?, checkpoint_id? }` (HB-4).
> **Earlier:** 2026-05-03 — Doc 20 design pass: `commands/settings.rs` populated (15 commands, 2 events); `get_story_settings` / `save_story_setting` dropped (no story scope per D-03-A); `restore_prompt_default` enum widened to include `prompt_handover_seed` and `prompt_consulting_seed`
> **Earlier:** 2026-04-29 — Doc 19 design pass: vault commands `upload_image`, `export_world`, `import_world` flipped from skeleton to specified
> **Earlier:** 2026-04-29 — Doc 17 design pass: `ghostwriter` command domain populated (4 commands; non-streaming; surgical-stitching protocol)
> **Earlier:** 2026-04-29 — Doc 18 design pass: vault commands `update_item_content`, `attach_context_doc`, `detach_context_doc`, `list_attached_docs`, `list_templates` flipped from skeleton to specified; `delete_item` / `restore_item` cross-referenced with Doc 18 cascade rules
> **Earlier:** 2026-04-29 — Doc 16 design pass: `accordion` command domain populated (9 commands) + accordion events (`accordion_state_changed`, `accordion_summarise_*`)
> **Earlier:** 2026-04-28 — Doc 15 design pass: `conversation` commands fully populated; new event `generation_failed` added; `delete_message` / `undelete_message` replaced by `delete_exchange` / `delete_from`; draft persistence commands added
> **Earlier:** 2026-04-27 — consultant pass: auth `complete_onboarding` renamed to `setup_vault` (Doc 13 wins); vault list reconciled with Doc 14; `attach_context_doc` / `detach_context_doc` moved from `conversation` to `vault` (they mutate `story_state`, not message flow)

Every Tauri command and every backend-emitted event. The contract the frontend holds the backend to. If a command signature changes, this doc changes first.

---

## How to Read This Document

**Commands** are frontend-initiated (invoke). **Events** are backend-initiated (emitted, frontend listens).

### Command entry format

```
### command_name
**Domain:** commands/filename.rs
**Preconditions:** what must be true before this command can succeed
**Args:**
  field_name: Type  — description
**Returns:** Type
**Emits:** event_name — when; payload shape
**Errors:**
  LoomError::Variant — when this is thrown
```

### Signature status

Each command is marked:
- ✅ **Specified** — full signature defined
- 🔲 **Skeleton** — name confirmed; signature filled in when the feature doc is written

### Error display

Doc 07 lists which `LoomError` variants a command can throw. How each variant is *displayed* to the user (toast, banner, blocking modal) is defined in Doc 12 (Empty States and Errors).

---

## Commands — `auth`

**File:** `commands/auth.rs`
**Precondition for all except `check_onboarding`, `setup_vault`, and `unlock_vault`:** vault must be unlocked (`AppState.master_key` is `Some`).

| Command | Status |
|---|---|
| `check_onboarding` | 🔲 Skeleton |
| `setup_vault` | ✅ Specified in Doc 13 |
| `unlock_vault` | ✅ Specified in Doc 13 |
| `lock_vault` | ✅ Specified in Doc 13 |
| `change_password` | ✅ Specified in Doc 13 |
| `set_api_key` | ✅ Specified in Doc 13 |
| `has_api_key` | ✅ Specified in Doc 13 |

*Full signatures live in Doc 13 §Backend Commands.*

---

## Commands — `vault`

**File:** `commands/vault.rs`
**Precondition for all:** vault must be unlocked.

Reconciled with Doc 14 (authoritative for world and item commands) and Doc 18 (authoritative for source-document commands). `attach_context_doc` / `detach_context_doc` live here because they mutate `story_state.context_doc_ids`, not message flow.

| Command | Status | Source doc |
|---|---|---|
| `list_worlds` | ✅ Specified | Doc 14 |
| `create_world` | ✅ Specified | Doc 14 |
| `open_world` | ✅ Specified | Doc 14 |
| `delete_world` | ✅ Specified | Doc 14 |
| `update_world_meta` | ✅ Specified | Doc 14 |
| `list_items` | ✅ Specified | Doc 14 |
| `create_item` | ✅ Specified | Doc 14 |
| `rename_item` | ✅ Specified | Doc 14 |
| `update_item_content` | ✅ Specified | Doc 18 |
| `move_item` | ✅ Specified | Doc 14 |
| `delete_item` | ✅ Specified | Doc 14 — soft-delete cascades to detach from all stories per Doc 18 |
| `restore_item` | ✅ Specified | Doc 14 — does **not** auto-reattach (Doc 18) |
| `delete_item_permanent` | ✅ Specified | Doc 14 |
| `empty_trash` | ✅ Specified | Doc 14 |
| `attach_context_doc` | ✅ Specified | Doc 18 |
| `detach_context_doc` | ✅ Specified | Doc 18 |
| `list_attached_docs` | ✅ Specified | Doc 18 |
| `list_templates` | ✅ Specified | Doc 18 (CRUD lives in Doc 20) |
| `upload_image` | ✅ Specified | Doc 19 |
| `export_world` | ✅ Specified | Doc 14 §World Backup |
| `import_world` | ✅ Specified | Doc 14 §World Backup |

*Names match Doc 14 verbatim. Any future feature doc that adds a vault command must update this table.*

---

## Commands — `conversation`

**File:** `commands/conversation.rs`
**Precondition for all:** vault must be unlocked; a story must be active.

Full signatures are authoritative in Doc 15 §Backend API. This table is the index.

| Command | Status | Notes |
|---|---|---|
| `load_messages` | ✅ Specified | Doc 15 |
| `send_message` | ✅ Specified | Doc 15; emits `message_chunk`, `message_complete`, `generation_failed`, `generation_cancelled` |
| `cancel_generation` | ✅ Specified | Idempotent |
| `edit_user_message` | ✅ Specified | Truncate-and-replace + regenerate (one atomic op) |
| `update_message_content` | ✅ Specified | In-place model edit; no truncation |
| `regenerate_last_response` | ✅ Specified | Hard-deletes last model message and re-fires |
| `delete_exchange` | ✅ Specified | User/model pair; hard-delete with cascade |
| `delete_from` | ✅ Specified | Range hard-delete with cascade |
| `update_feedback` | ✅ Specified | Empty string clears. Server-side preconditions per Doc 28: rejects with `Validation` if message is not story-kind; cache + accordion stale rules apply per Doc 22 / Doc 16 |
| `get_token_count` | ✅ Specified | Pre-flight via Gemini `countTokens` |
| `get_draft` | ✅ Specified | Reads `story_state.draft` |
| `save_draft` | ✅ Specified | Writes `story_state.draft`; frontend debounces ~1 s |
| `clear_draft` | ✅ Specified | Cleared automatically on successful send |

*Note: `attach_context_doc` and `detach_context_doc` are in `vault` — they mutate `story_state.context_doc_ids`, not message flow.*

*Removed from this domain since the previous draft:* `delete_message` and `undelete_message` (replaced by `delete_exchange` / `delete_from`; v2.0 has no undelete since deletion is hard — see `docs-v2/future/undo-redo.md` for the v2.1 design).

---

## Commands — `settings`

**File:** `commands/settings.rs`
**Precondition for all:** vault must be unlocked.

Full signatures are authoritative in Doc 20 §Backend API. This table is the index.

| Command | Status | Notes |
|---|---|---|
| `get_resolved_settings` | ✅ Specified | Returns the merged cascade (world → app → fallback). Called on unlock, world switch, and after every `settings_changed` event |
| `get_app_settings` | ✅ Specified | Raw `app_settings` map for the App chapter view |
| `get_world_settings` | ✅ Specified | Raw world override map for the World chapter view |
| `save_app_setting` | ✅ Specified | Validates server-side; emits `settings_changed` |
| `save_world_setting` | ✅ Specified | Validates server-side; emits `settings_changed` |
| `clear_world_override` | ✅ Specified | Deletes the row from world `settings`; emits `settings_changed` |
| `clear_all_world_overrides_in_tab` | ✅ Specified | Tab-scoped bulk clear; returns count cleared |
| `restore_prompt_default` | ✅ Specified | Writes the hardcoded baseline for a `prompt_*` key. Enum: `prompt_ghostwriter`, `prompt_accordion_summarise`, `prompt_accordion_fake_user`, `prompt_handover_seed`, `prompt_consulting_seed` |
| `list_templates` | ✅ Specified | App + current world templates merged |
| `save_template` | ✅ Specified | CRUD for built-ins (rename / `default_content`) and user-created |
| `delete_template` | ✅ Specified | User-created only. Built-ins return `LoomError::Forbidden` |
| `restore_template_default` | ✅ Specified | Built-ins only |
| `reset_rate_limiter` | ✅ Specified | Zeros the rate-limit counters; confirmation modal in UI |
| `get_telemetry` | ✅ Specified | Live counter snapshot |
| `export_settings_bundle` | ✅ Specified | Writes app + world settings into the `.loom-backup` zip per D-15. Blocks while `isGenerating` |

**Note:** `get_story_settings` / `save_story_setting` were dropped — there is no story scope in v2.0 (D-03-A; Doc 20 §Why no Story scope). Per-story operational state (`story_state.context_doc_ids`, `active_mode`, `active_aux_slot`, `draft`) is set by the relevant feature surface, not by Settings.

**Events:**

| Event | Payload | When |
|---|---|---|
| `settings_changed` | `{ scope: 'app' \| 'world', key: String }` | After any successful save / clear |
| `telemetry_tick` | `Telemetry` | 1 Hz while Rate Limits tab is open |

---

## Commands — `cache`

**File:** `commands/cache.rs`
**Precondition for all:** vault must be unlocked.

| Command | Status |
|---|---|
| `get_cache_state` | ✅ Specified |
| `create_story_cache` | ✅ Specified |
| `delete_story_cache` | ✅ Specified |
| `get_session_cache_state` | ✅ Specified |
| `list_alive_caches` | ✅ Specified |

TTL refresh is internal (fire-and-forget after every successful send) and not exposed as a command. See Doc 22 for full signatures and behaviour.

---

## Commands — `ghostwriter`

**File:** `commands/ghostwriter.rs`
**Precondition for all:** vault unlocked; story active.

Full signatures are authoritative in Doc 17 §Backend API. This table is the index.

| Command | Status | Notes |
|---|---|---|
| `send_ghostwriter_request` | ✅ Specified | Non-streaming. Surgical-stitching protocol: model receives `<context_before>` / `<selected_passage>` / `<context_after>` + instruction, returns only the rewritten passage. Mode-aware history assembly (story / handover / consulting). Subject to `'text'` rate limit and `isGenerating` global lock. |
| `cancel_ghostwriter_generation` | ✅ Specified | Idempotent; silent (no event emitted) |
| `save_ghostwriter_edit` | ✅ Specified | Single-transaction: append `ghostwriter_history` entry, update `messages.content`, mark accordion / cache stale where applicable |
| `revert_ghostwriter_edit` | ✅ Specified | Pops last `ghostwriter_history` entry, restores prior content, same accordion / cache stale rules |

### Ghostwriter events

Ghostwriter uses no streaming events in v2.0 — generation is non-streaming and the response is returned as the command's `Result`. `cache_state_changed` and `accordion_state_changed` (Doc 22 / Doc 16) fire on accept and revert when those mutations apply.

---

## Commands — `accordion`

**File:** `commands/accordion.rs`
**Precondition for all:** vault must be unlocked; a story must be active.

Full signatures are authoritative in Doc 16 §Backend API. This table is the index.

| Command | Status | Notes |
|---|---|---|
| `get_accordion_state` | ✅ Specified | Returns `{ segments, checkpoints }` for the active story |
| `create_checkpoint` | ✅ Specified | Args: `after_message_id`, `name`. Splits the enclosing segment if one existed; new segments default `summary = NULL`, `is_collapsed = 0`, `use_summary = 1` |
| `rename_checkpoint` | ✅ Specified | Args: `checkpoint_id`, `name`. Updates `modified_at`; never marks segments stale |
| `delete_checkpoint` | ✅ Specified | Merges adjacent segments per Doc 16 §Cascade. Rejected on the start sentinel (`is_start = 1`) with `LoomError::Validation { kind: ProtectedSentinel, … }` |
| `summarise_segment` | ✅ Specified | Non-streaming Gemini call; sets `summary` + `summarised_at`; clears `is_stale`. Subject to `isGenerating` global lock (Doc 15). Cancelled via the global `cancel_generation` (no separate cancel command) |
| `update_segment_summary` | ✅ Specified | Args: `segment_id`, `summary`. Manual override; bumps `modified_at`; clears `is_stale` |
| `clear_segment_summary` | ✅ Specified | Args: `segment_id`. Sets `summary = NULL`; sets `use_summary = 0`; if `is_collapsed = 1`, also sets `is_collapsed = 0` (cannot show a banner with no summary). Bumps `modified_at` |
| `set_segment_collapsed` | ✅ Specified | Args: `segment_id`, `collapsed`. Pure UI state; rejected when `summary IS NULL` and `collapsed = true` |
| `set_segment_use_summary` | ✅ Specified | Args: `segment_id`, `use`. API-substitution flag; rejected when `summary IS NULL` and `use = true`. Forced on while `is_collapsed = 1` |

### Accordion events

| Event | Payload | When |
|---|---|---|
| `accordion_state_changed` | `{ story_id: String, segment_id: Option<String>, checkpoint_id: Option<String> }` | Any successful accordion mutation. `segment_id` set when one specific segment changed; `checkpoint_id` set when a checkpoint was created / renamed / deleted; both `None` for changes that affect the whole story (e.g. cascade from message delete). The frontend reloads via `get_accordion_state` rather than diffing the payload |

**No streaming events for accordion.** v2.0 summarisation is non-streaming — the response arrives in a single chunk via the command's `Result`. There is no `accordion_summarise_chunk` / `_complete` / `_failed` / `_cancelled`. The `summarise_segment` command's `Result` carries the outcome; cancellation goes through the global `cancel_generation` (Doc 15).

`accordion_state_changed` is also a downstream signal for `cache_state_changed` when the operation overlaps the cached prefix — see Doc 22 §Accordion-specific Stale Triggers.

---

## Commands — `modes`

**File:** `commands/modes.rs`
**Precondition for all:** vault must be unlocked; a story must be active (except `list_sessions`, which only requires the story to exist).

| Command | Status |
|---|---|
| `list_sessions` | ✅ Specified |
| `start_handover_session` | ✅ Specified |
| `start_consulting_session` | ✅ Specified |
| `enter_session` | ✅ Specified |
| `exit_session` | ✅ Specified |
| `send_session_message` | ✅ Specified |
| `cancel_session_generation` | ✅ Specified |
| `rename_session` | ✅ Specified |
| `delete_session` | ✅ Specified |
| `set_session_collapsed` | ✅ Specified |

Story-mode messaging lives in `commands/conversation.rs` (Doc 15). The session commands above cover handover and consulting. See Doc 23 for full signatures.

### Session events

| Event | Payload | When |
|---|---|---|
| `session_created` | `{ session_id, story_id, kind }` | After successful start of a session |
| `session_message_chunk` | `{ session_id, chunk }` | Per Gemini SSE chunk during session generation |
| `session_message_complete` | `{ session_id, message_id, finish_reason, token_count }` | Session generation finished |
| `session_generation_cancelled` | `{ session_id }` | Session-cancel or pre-flight retraction |
| `session_generation_failed` | `{ session_id, error_kind, error_detail }` | HTTP error / panic / stream interruption |
| `session_state_changed` | `{ session_id, status }` | Rename, collapse change, deletion, cache state update |

### Cache events

| Event | Payload | When |
|---|---|---|
| `cache_state_changed` | `{ story_id, status }` | Story cache created / refreshed / stale / deleted |
| `session_cache_state_changed` | `{ session_id, status }` | Session cache created / refreshed / stale / deleted |

---

## Event Catalogue

All events emitted by the Rust backend. The frontend registers listeners in the appropriate hook (global events) or component `useEffect` (local events). All listeners must clean up on unmount.

---

### `message_chunk`

**Direction:** Backend → Frontend
**Listener:** `useWorkspaceEvents` (global hook)
**When:** During streaming generation, once per token chunk received from the Gemini API.

```typescript
payload: {
  story_id: string;
  chunk: string;       // partial text content of the response
}
```

---

### `message_complete`

**Direction:** Backend → Frontend
**Listener:** `useWorkspaceEvents` (global hook)
**When:** Streaming generation finishes successfully (finish_reason received).

```typescript
payload: {
  story_id: string;
  message_id: string;
  finish_reason: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'ERROR';
  token_count: number;
}
```

---

### `generation_cancelled`

**Direction:** Backend → Frontend
**Listener:** `useWorkspaceEvents` (global hook)
**When:** The user cancelled generation via `cancel_generation`, **or** a pre-flight check failed (rate limit, validation, missing API key) and the optimistically-rendered user bubble must be retracted.

```typescript
payload: {
  story_id: string;
}
```

---

### `generation_failed`

**Direction:** Backend → Frontend
**Listener:** `useWorkspaceEvents` (global hook)
**When:** Generation failed in a way that requires writer attention. Distinct from `generation_cancelled` (silent) — this triggers a friendly toast with a "view full error" affordance.

```typescript
payload: {
  story_id: string;
  error_kind:
    | 'http_error'        // Gemini 4xx/5xx
    | 'network_error'     // connection drop, DNS, TLS
    | 'malformed_response'// SSE parse failure
    | 'backend_panic'     // unexpected Rust failure
    | 'stream_interrupted'; // mid-stream connection drop; partial AI message preserved
  error_detail: string;   // human-readable; may be shown in the "view full error" modal
}
```

For `stream_interrupted` the partial AI message is preserved (see Doc 15 §Cancellation Taxonomy). For all other kinds, the optimistic user bubble is retracted by the frontend.

---

### `cache_state_changed`

**Direction:** Backend → Frontend
**Listener:** `useCacheEvents` (global hook)
**When:** Cache is created, refreshed, deleted, or marked stale. Triggered by any action that modifies cache state.

```typescript
payload: {
  story_id: string;
  status: CacheStatus;  // see Doc 03 for CacheStatus shape
}
```

---

### `vault_updated`

**Direction:** Backend → Frontend
**Listener:** `useWorkspaceEvents` (global hook)
**When:** Any vault item is created, renamed, moved, deleted, or restored. Frontend should reload the item list for the active world.

```typescript
payload: {
  world_id: string;
}
```

---

## General Preconditions

Unless a command explicitly states otherwise, these apply to every command:

| Precondition | Enforced by |
|---|---|
| Vault is unlocked | Command handler checks `AppState.master_key.is_some()`; returns `LoomError::Validation` if not |
| World is active | Command handler checks `AppState.active_world_id.is_some()`; returns `LoomError::Validation` if not |
| Input IDs exist | DB layer returns `LoomError::NotFound` on missing rows |

---

## LoomError → Frontend Mapping (summary)

Full display rules are in Doc 12. Quick reference:

| Variant | Typical cause | Display rule |
|---|---|---|
| `Crypto` | Wrong password, corrupt sentinel | Blocking modal |
| `Database` | DB write failure, corrupt DB | Blocking modal |
| `NotFound` | Stale ID reference | Toast (error) |
| `Validation` | Bad input, missing precondition | Inline or toast |
| `ApiError` | Gemini 4xx / 5xx | Toast (error) with detail |
| `RateLimited` | RPM / TPM / RPD exceeded | Toast (warning) with reset time |
| `Io` | File system failure | Toast (error) |
| `Serialization` | Corrupt stored data | Toast (error) |
| `Internal` | Unexpected failure | Toast (error) |
