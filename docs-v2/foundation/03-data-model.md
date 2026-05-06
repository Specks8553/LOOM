# 03 — Data Model

> **Status:** Complete
> **Last updated:** 2026-05-04 — Feedback design pass (D-17): `feedback_color` added to world-overridable `settings` keys and to `ResolvedSettings`; default `#f59e0b`. Drives the `--color-feedback` triad per Doc 28.
> **Earlier:** 2026-05-03 — pre-implementation audit resolution batch: `attachment_history.action` renamed to `event` and `reason TEXT NULL` column added (HB-2); `prompt_handover_seed` and `prompt_consulting_seed` added to `app_settings` keys (HB-5); `ghostwriter_frame_color` renamed to `ghostwriter_color` (CD-2); `story_state.active_session_id` known-key added (CD-9); `WorldMetaPatch`, `ResolvedSettings`, `Telemetry`, `AliveCacheRow`, `UnlockResult`, `GhostwriterResponse`, `RevertResult` TypeScript interfaces added (IP-3, IP-9 — annotated as ts-rs-generated authoritative); `GhostwriterEdit` interface shape updated to match Doc 17 (HB-1); `MessageBlock` flagged v2.1-reserved (SD-6).
> **Earlier:** 2026-05-03 — Doc 20 (Settings & Themes) design pass: `modificator_presets` removed from both `app_settings` and `settings` (modificators are per-turn free-text per Doc 15, no catalogue); `cache_min_tokens` added to `app_settings` (default 4096 ⚠️ provisional); `cache_ttl_secs`, `cache_min_tokens`, `context_token_limit` added to the world-overridable list
> **Earlier:** 2026-04-29 — Doc 16 design pass: `accordion_segments.use_summary` column added (decoupled from `is_collapsed`); four `gen_summarise_*` keys added to `app_settings` and the world-overridable `settings` cascade; checkpoint naming is inverted (`name what comes next`); start sentinel auto-named `Chapter 1`
> **Earlier:** 2026-04-29 — Doc 23 design pass: handover and consulting unified onto a single `conversation_sessions` table; `messages.kind` enum expanded to `'story' | 'handover' | 'consulting'`; `messages.session_id` foreign key added; `mode_conversations` placeholder removed; `cache_state` schema finalised (story-cache only, dropped the `mode` PK component); per-session caches live on `conversation_sessions` rows
> **Earlier:** 2026-04-28 — Doc 15 design pass: dropped `output_length` everywhere; dropped `attached_image_ids` from `UserContent`; `active_aux_slot` moved from world settings to `story_state`; added `draft` story_state key; clarified `messages.deleted_at` is reserved for v2.1 undo (see `docs-v2/future/undo-redo.md`); v2.0 deletion is hard-delete with cascade
> **Earlier:** 2026-04-27 — consultant pass: `messages.kind` `'normal'` renamed to `'story'`; rationale added for handover not being cached; internal prompts marked Developer-only with restore-default semantics

The single source of truth for all data shapes. Feature docs reference fields defined here — they do not define their own schemas.

---

## Storage Architecture

### app_settings.db

A single app-level SQLCipher database (AES-256, same master key as world databases). Stores all application-wide settings and the API key. Opened on vault unlock, closed on lock. Path: same directory as `app_config.json`.

This database is always open when the vault is unlocked, regardless of which world (if any) is active. It is distinct from world databases — its connection is stored separately in `AppState.settings_conn`.

### One encrypted database per World

Each World has its own `loom.db` (SQLCipher, AES-256). All story content, world-level setting overrides, documents, and media metadata for that World live in that database. Only one world connection is open at a time.

### app_config.json

Application-level config stored in plaintext (no user content, no keys). Contains:
- `worlds` — array of `WorldMeta` (ID, name, db_path, world_meta_path)
- `salt_hex` — PBKDF2 salt for master key derivation
- `key_check` — AES-256-GCM sentinel for password verification
- `active_world_id` — last-opened world (optional)

### world_meta.json

Per-world cache file stored alongside `loom.db`. Contains display data needed by the World Picker without decrypting the database:
- `id`, `name`, `tags`, `accent_color`, `cover_image_path`, `created_at`, `modified_at`

Written atomically (`.tmp` → rename) on any change to these fields.

### localStorage (frontend only)

UI preferences that are not sensitive and do not need encryption:
- Pane widths (left, right)
- Navigator collapsed state
- Export folder path
- `onboarding_complete` flag

**Never stored in localStorage:** master key, API key, story content, or any data that lives in the encrypted DB.

---

## Database Schema

### `items`

Vault tree nodes — stories, folders, source documents, and images.

```sql
CREATE TABLE items (
    id           TEXT PRIMARY KEY,           -- UUID
    parent_id    TEXT REFERENCES items(id) ON DELETE SET NULL,
    item_type    TEXT NOT NULL               -- 'Story' | 'Folder' | 'SourceDocument' | 'Image'
                   CHECK(item_type IN ('Story','Folder','SourceDocument','Image')),
    item_subtype TEXT,                       -- template slug for SourceDocument; NULL otherwise
    name         TEXT NOT NULL,
    content      TEXT NOT NULL DEFAULT '',   -- document text (SourceDocument only)
    description  TEXT,                       -- private story description
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,              -- ISO 8601
    modified_at  TEXT NOT NULL,
    deleted_at   TEXT,                       -- NULL = live; timestamp = soft-deleted
    asset_path   TEXT,                       -- local file path (Image only)
    asset_meta   TEXT,                       -- JSON: width, height, mime_type (Image only)
    file_api_uri TEXT,                       -- Gemini File API URI (Image only)
    file_api_uploaded_at TEXT               -- ISO 8601; NULL = not yet uploaded
);
```

**v2.0 note:** `story_id` column removed from v1.0. Stories are identified by their own `id` — `story_id` was a leftover from an earlier schema.

---

### `messages`

Linear conversation messages. **No DAG in v2.0** — `parent_id` is removed. Ordering is by `created_at`.

```sql
CREATE TABLE messages (
    id                  TEXT PRIMARY KEY,    -- UUID
    story_id            TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    session_id          TEXT REFERENCES conversation_sessions(id) ON DELETE CASCADE,
                          -- NULL for kind='story' (the implicit story-thread "session")
                          -- Set to a session UUID for kind='handover' or kind='consulting'
    role                TEXT NOT NULL        -- 'user' | 'model'
                          CHECK(role IN ('user','model')),
    content_type        TEXT NOT NULL DEFAULT 'text'
                          CHECK(content_type IN ('json_user','text','blocks')),
    content             TEXT NOT NULL DEFAULT '',
    -- json_user: JSON-serialised UserContent struct (story-mode only)
    -- text: plain prose (model responses; also handover/consulting user input)
    -- blocks: JSON array of MessageBlock (text + inline images)
    token_count         INTEGER,             -- token count from Gemini response metadata
    model_name          TEXT,                -- model that generated this response
    finish_reason       TEXT                 -- 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'ERROR'
                          CHECK(finish_reason IN ('STOP','MAX_TOKENS','SAFETY','ERROR') OR finish_reason IS NULL),
    created_at          TEXT NOT NULL,
    deleted_at          TEXT,                -- reserved for v2.1 undo/redo; v2.0 leaves NULL (hard-delete)
    user_feedback       TEXT,                -- writer's annotation on this response (story-mode only)
    ghostwriter_history TEXT NOT NULL DEFAULT '[]', -- JSON array of GhostwriterEdit
    kind                TEXT NOT NULL DEFAULT 'story'
                          CHECK(kind IN ('story','handover','consulting')),
    -- 'story':      story prose; included in story-mode history assembly
    -- 'handover':   handover-session dialogue; excluded from story history assembly;
    --               included in story export (Doc 21)
    -- 'consulting': consulting-session dialogue; excluded from story history assembly;
    --               included in story export
    CHECK ((kind = 'story' AND session_id IS NULL)
        OR (kind IN ('handover','consulting') AND session_id IS NOT NULL))
);
```

**v2.0 changes from v1.0:**
- `parent_id` removed — messages are linear, not a DAG
- `kind` enum expanded to `'story' | 'handover' | 'consulting'` (was `'normal' | 'handover'` in earlier drafts; `'normal'` was renamed to `'story'`)
- `session_id` foreign key added — handover and consulting messages always belong to a `conversation_sessions` row; story messages always have `session_id = NULL`
- `mode_conversations` placeholder removed — consulting messages live here in `messages` with their `session_id` set, unifying conversation storage across all three modes
- `deleted_at` column reserved for v2.1 undo/redo (see `docs-v2/future/undo-redo.md`); in v2.0 deletion is immediate hard-delete with cascade — Doc 15 §Deletion

**Edit + regenerate behavior (story messages):** To edit a story user message at position N, the backend deletes all story-kind messages for the same `story_id` with `created_at > messages[N].created_at`, then regenerates from N. Handover and consulting messages within the same story are **not** affected — they are scoped to their own sessions and are never truncated by story-mode edits. v2.0 deletion is permanent (hard-delete in one transaction); v2.1 will replace this with reversible soft-delete via the operation log.

**Edit + regenerate behavior (session messages):** Editing a user message inside a handover or consulting session truncates only within that `session_id`, not the story timeline. The cascade rules (checkpoints, accordion segments) apply only to story-kind deletions.

**Feedback's load-bearing role:** `user_feedback` is consumed by Story-mode history assembly (injected on the model message it annotates) **and** by Handover mode synthesis (Doc 23) as a primary input — Handover reads feedback off story messages, not its own. Feedback is not collected on handover or consulting messages. Feedback persists indefinitely until the writer clears it or the message is deleted.

---

### `story_state`

Per-story operational state. Not user-configurable settings — these track runtime state specific to each story. There are no per-story user settings; all user-configurable values live at world or app level.

```sql
CREATE TABLE story_state (
    story_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    key      TEXT NOT NULL,
    value    TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (story_id, key)
);
```

**Known keys:**
| Key | Type | Description |
|---|---|---|
| `context_doc_ids` | JSON array of strings | Source document IDs currently attached to this story |
| `active_mode` | string | `story` \| `handover` \| `consulting` — which mode is active for this story |
| `active_session_id` | string \| `""` | UUID of the active handover/consulting session if `active_mode` is a session mode; empty string when in story mode. Re-opening the story restores the session if it still exists; otherwise falls back to story mode silently. |
| `active_aux_slot` | string | `1` \| `2` — which auxiliary instruction slot is active for this story (story-scoped, not world-scoped) |
| `draft` | JSON object | Persisted input draft for this story: `{ plot_direction, background_information, modificators, constraints }`. Auto-saved (debounced ~1s) while typing; cleared on successful send. Survives vault lock and app close. |

---

### `checkpoints`

Named markers that define Accordion segment boundaries. Without branching, checkpoints are purely sequential position markers.

```sql
CREATE TABLE checkpoints (
    id               TEXT PRIMARY KEY,   -- UUID
    story_id         TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    after_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
    -- NULL means the checkpoint is at the very start (before any message);
    -- only valid when is_start = 1
    name             TEXT NOT NULL DEFAULT 'Chapter',
    is_start         INTEGER NOT NULL DEFAULT 0, -- 1 = auto-created start sentinel
    created_at       TEXT NOT NULL,
    modified_at      TEXT NOT NULL
);
```

**v2.0 naming convention:** A checkpoint names the chapter that **begins** at this position, not the one that just ended (inverted from v1). The start sentinel — auto-created on story creation, `is_start = 1`, never deletable — defaults to `"Chapter 1"` (renameable). See Doc 16 §Banners.

**v2.0 simplification:** Without branching, `after_message_id` is always unambiguous — there is only one message with that ID in the story. The `branch_leaf_id` concept from the Accordion segment table is also gone.

---

### `accordion_segments`

Closed chapter summaries. Each segment spans from `start_cp_id` to `end_cp_id`. Only **closed** segments (those with both endpoints) have rows here; the open segment (the run from the most recent checkpoint to the story tail) has no row and comes into existence when a new checkpoint is created behind it.

```sql
CREATE TABLE accordion_segments (
    id              TEXT PRIMARY KEY,    -- UUID
    story_id        TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    start_cp_id     TEXT NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
    end_cp_id       TEXT NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
    summary         TEXT,               -- AI-generated or manually-edited; NULL = not yet generated
    is_collapsed    INTEGER NOT NULL DEFAULT 0,
                      -- UI state: 1 = banner shows summary card; 0 = expanded (bubbles visible)
    use_summary     INTEGER NOT NULL DEFAULT 1,
                      -- API state: 1 = history assembly substitutes the fake-pair; 0 = full bubbles sent.
                      -- When is_collapsed = 1, fake-pair is forced regardless of this value
                      -- (see Doc 16 §History Assembly).
    is_stale        INTEGER NOT NULL DEFAULT 0, -- 1 = summary outdated; needs regeneration
    summarised_at   TEXT,               -- ISO 8601; NULL = never summarised
    created_at      TEXT NOT NULL,
    modified_at     TEXT NOT NULL
);
```

**v2.0 changes from v1.0:** `branch_leaf_id` removed (no branching). `use_summary` added to decouple UI collapse from API substitution — writers can read raw bubbles in the Theater while still saving tokens, or vice versa. See Doc 16 §Banners for the full state matrix.

---

### `app_settings` (in `app_settings.db`)

App-level key-value store. These are the authoritative values — world settings override them, but if a world has no override, these apply.

```sql
CREATE TABLE app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);
```

**Known keys:**
| Key | Default | Description |
|---|---|---|
| `api_key` | `""` | Gemini API key |
| `text_model_name` | `gemini-2.5-flash` | Default AI model |
| `gen_temperature` | `1.0` | Gemini `temperature` (⚠️ provisional — revisit in UI design phase) |
| `gen_top_p` | `0.95` | Gemini `topP` (⚠️ provisional) |
| `gen_top_k` | `40` | Gemini `topK` (⚠️ provisional) |
| `gen_max_output_tokens` | `8192` | Gemini `maxOutputTokens` (⚠️ provisional) |
| `gen_summarise_temperature` | `0.3` | Gemini `temperature` for accordion summarisation (⚠️ provisional — lower than conversation default for fact-extraction) |
| `gen_summarise_top_p` | `0.95` | Gemini `topP` for summarisation (⚠️ provisional) |
| `gen_summarise_top_k` | `40` | Gemini `topK` for summarisation (⚠️ provisional) |
| `gen_summarise_max_output_tokens` | `2048` | Gemini `maxOutputTokens` for summarisation (⚠️ provisional — summaries are shorter than story output) |
| `accent_color` | `#7c3aed` | Default accent color (hex) |
| `body_font` | `serif` | Default prose font family |
| `auto_lock_secs` | `900` | Auto-lock timer in seconds (15 min default) |
| `rate_limit_rpm` | `10` | Requests per minute limit |
| `rate_limit_tpm` | `250000` | Tokens per minute limit |
| `rate_limit_rpd` | `1500` | Requests per day limit |
| `context_token_limit` | `128000` | Max context tokens before Accordion is required |
| `img_gen_provider_id` | `""` | Image generation provider ID |
| `img_gen_default_width` | `1024` | Default generated image width |
| `img_gen_default_height` | `1024` | Default generated image height |
| `tts_model_name` | `""` | TTS provider/model |
| `cache_ttl_secs` | `3600` | Explicit cache TTL in seconds (app-wide default; 3600 = 1 hour) |
| `cache_min_tokens` | `4096` | Minimum prefix size before auto-create cache fires (⚠️ provisional — Gemini 2.5 Pro published minimum; verify empirically per TODO O16) |
| `story_si` | `""` | Default story mode system instruction |
| `handover_si` | `""` | Default handover mode system instruction |
| `consulting_si` | `""` | Default consulting mode system instruction |
| `aux_slot_1_name` | `Slot 1` | Auxiliary instruction slot 1 display name |
| `aux_slot_1_content` | `""` | Auxiliary instruction slot 1 content |
| `aux_slot_2_name` | `Slot 2` | Auxiliary instruction slot 2 display name |
| `aux_slot_2_content` | `""` | Auxiliary instruction slot 2 content |
| `prompt_ghostwriter` | *(long)* | **Developer-only.** Internal system prompt for Ghostwriter requests |
| `prompt_accordion_summarise` | *(long)* | **Developer-only.** Internal system prompt for Accordion summarisation |
| `prompt_accordion_fake_user` | *(long)* | **Developer-only.** Internal fake user turn for collapsed segment injection |
| `prompt_handover_seed` | *(long)* | **Developer-only.** Handover persona / instruction seed (D-10). |
| `prompt_consulting_seed` | *(long)* | **Developer-only.** Consulting persona / instruction seed (D-10). |

**Developer-only prompts:** The three `prompt_*` keys encode contracts the rest of the system depends on (e.g. fake-pair injection format, summary structure). They are editable for power users but only via the Developer section in Settings (Doc 20), and each one has a Restore Default button that writes the hardcoded baseline value back. The hardcoded baselines live in `services/` constants — `app_settings` is just the override store.

---

### `settings` (in `loom.db` — world-level overrides)

Per-world key-value overrides. When a key is present, it takes precedence over the matching `app_settings` value. When absent, the app default applies. The backend resolves the cascade before returning settings to the frontend — the frontend always receives a single merged object.

```sql
CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);
```

**Overridable keys (world scope):**
| Key | Overrides app key | Description |
|---|---|---|
| `text_model_name` | ✅ | World-specific model |
| `gen_temperature` | ✅ | World-specific Gemini temperature |
| `gen_top_p` | ✅ | World-specific Gemini topP |
| `gen_top_k` | ✅ | World-specific Gemini topK |
| `gen_max_output_tokens` | ✅ | World-specific Gemini maxOutputTokens |
| `gen_summarise_temperature` | ✅ | World-specific summarisation temperature |
| `gen_summarise_top_p` | ✅ | World-specific summarisation topP |
| `gen_summarise_top_k` | ✅ | World-specific summarisation topK |
| `gen_summarise_max_output_tokens` | ✅ | World-specific summarisation maxOutputTokens |
| `accent_color` | ✅ | World accent color |
| `body_font` | ✅ | World prose font |
| `bubble_user_color` | — | User bubble background (empty = token default); world-only |
| `bubble_ai_color` | — | AI bubble background; world-only |
| `ghostwriter_color` | — | Ghostwriter feature colour; world-only. Drives `--color-ghostwriter` and its derived `-hover` / `-subtle` / `-diff` tokens. |
| `checkpoint_color` | — | Checkpoint marker color; world-only |
| `accordion_color` | — | Accordion card color; world-only |
| `feedback_color` | — | Feedback annotation colour; world-only. Drives `--color-feedback` and its derived `-hover` / `-subtle` tokens. Default `#f59e0b` (Doc 28). |
| `story_si` | ✅ | World story mode system instruction |
| `handover_si` | ✅ | World handover mode system instruction |
| `consulting_si` | ✅ | World consulting mode system instruction |
| `aux_slot_1_name` | ✅ | World aux slot 1 name |
| `aux_slot_1_content` | ✅ | World aux slot 1 content |
| `aux_slot_2_name` | ✅ | World aux slot 2 name |
| `aux_slot_2_content` | ✅ | World aux slot 2 content |
| `cache_ttl_secs` | ✅ | World-specific cache TTL |
| `cache_min_tokens` | ✅ | World-specific cache auto-create threshold |
| `context_token_limit` | ✅ | World-specific context token limit |
| `last_open_story_id` | — | Restore last session within this world; world-only |

**Note on `active_aux_slot`:** This key is **per-story**, not per-world — it lives in `story_state` (above), not here. Switching stories may activate a different aux slot.

**Settings cascade rule:** `world value → app default → hardcoded fallback`. The backend resolves this in `services/settings.rs` before returning to the frontend. The frontend never performs cascade logic.

**Auxiliary slot distinction:** Aux slot 1 and 2 are user-named instruction blocks injected into conversation history (not into the Gemini `system_instruction` field). Switching between them has no cache impact. The mode system instructions (`story_si`, `handover_si`, `consulting_si`) go into the Gemini `system_instruction` field and are part of the cache — changing them invalidates the cache.

---

### `templates`

User-defined and built-in source document templates.

```sql
CREATE TABLE templates (
    id                   TEXT PRIMARY KEY,  -- UUID
    slug                 TEXT NOT NULL UNIQUE,
    name                 TEXT NOT NULL,
    icon                 TEXT NOT NULL DEFAULT 'FileText', -- lucide-react icon name
    default_content      TEXT NOT NULL DEFAULT '',         -- markdown with {{placeholders}}
    creator_instructions TEXT NOT NULL DEFAULT '',         -- instructions for AI Creator
    is_builtin           INTEGER NOT NULL DEFAULT 0,
    sort_order           INTEGER NOT NULL DEFAULT 0,
    created_at           TEXT NOT NULL,
    modified_at          TEXT NOT NULL
);
```

**Built-in templates:** `image`, `character_profile`, `world_building`

---

### `telemetry`

Rate limiter counters. Three rows: `text`, `image_gen`, `tts`.

```sql
CREATE TABLE telemetry (
    provider          TEXT PRIMARY KEY,  -- 'text' | 'image_gen' | 'tts'
    req_count_min     INTEGER NOT NULL DEFAULT 0,
    req_count_day     INTEGER NOT NULL DEFAULT 0,
    token_count_min   INTEGER NOT NULL DEFAULT 0,
    last_req_at       TEXT,
    window_start_min  TEXT,              -- ISO 8601; start of current 1-min window
    window_start_day  TEXT               -- ISO 8601; start of current day window
);
```

---

### `attachment_history`

Audit trail of context document attach/detach events. Used by Context Caching to detect stale caches.

```sql
CREATE TABLE attachment_history (
    id         TEXT PRIMARY KEY,
    story_id   TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    doc_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    event      TEXT NOT NULL CHECK(event IN ('attach','detach')),
    reason     TEXT,                                 -- e.g. 'soft_delete' for cascade detaches; NULL for normal user actions
    created_at TEXT NOT NULL
);
```

`reason` records *why* the event happened. `'soft_delete'` is set when a doc soft-delete cascades into a detach (Doc 18 §Cascade Rules). `NULL` for normal user-initiated attaches and detaches. Future reason codes can be added without a schema change.

---

### `creator_messages`

Conversation history for the Source Document Creator (AI-assisted document generation).

```sql
CREATE TABLE creator_messages (
    id         TEXT PRIMARY KEY,
    doc_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK(role IN ('user','model')),
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL
);
```

---

### `cache_state`

Gemini API context cache metadata for **story-mode** caches. One row per story that has an active or recently expired story cache. Consulting-session caches live on `conversation_sessions` rows (below); handover never caches.

```sql
CREATE TABLE cache_state (
    story_id               TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
    cache_name             TEXT,               -- Gemini API cache resource name; NULL = no active cache
    expiry_at              TEXT,               -- ISO 8601; NULL = no active cache
    is_stale               INTEGER NOT NULL DEFAULT 0,
    last_cached_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
                             -- High-water mark: the last story-kind message included in the cached prefix.
                             -- Editing or deleting a message at or before this ID requires the
                             -- cached-message-warning confirmation (Doc 22).
    total_token_count      INTEGER,            -- Tokens reported by Gemini at cache creation; used for
                             -- token-meter context-limit accounting (Doc 22 §Cache + context limit)
    doc_snapshots          TEXT NOT NULL DEFAULT '{}',
                             -- JSON: doc_id → SHA-256 content hash at cache creation
    created_at             TEXT NOT NULL,
    updated_at             TEXT NOT NULL
);
```

**v2.0 schema changes from earlier drafts:** the `mode` PK component is dropped — there is at most one story cache per story. Added `last_cached_message_id` and `total_token_count`. Consulting caches are no longer keyed by `mode` here; they live on the session row (next).

**Why story and consulting caches don't share this table:** A story has one story cache and may simultaneously have an active consulting-session cache (during a consulting session). Splitting them by owning entity is cleaner than overloading `cache_state` with nullable foreign keys.

**Why `'handover'` is not a cacheable mode:** Handover output is multi-turn within a single session but the session itself is short-lived and one-off per intent. The cache creation cost (a full upload of the cached prefix + Gemini cache TTL accounting) exceeds the savings of a few turns. Story mode and consulting mode both run many turns against a stable context, so the cache amortises.

---

### `conversation_sessions`

Handover and consulting sessions. A session is a self-contained sub-conversation anchored to a story at a specific point in time. Story mode does not use sessions — there is one implicit "story thread" per story, and its messages have `session_id = NULL`.

```sql
CREATE TABLE conversation_sessions (
    id                TEXT PRIMARY KEY,                 -- UUID
    story_id          TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    kind              TEXT NOT NULL CHECK(kind IN ('handover','consulting')),
    name              TEXT NOT NULL,                    -- e.g. "Consulting 1", "Handover 1"; renameable
    entry_message_id  TEXT REFERENCES messages(id) ON DELETE SET NULL,
                        -- The story-kind message after which this session was started.
                        -- NULL = session started before any story messages exist.
    entry_snapshot    TEXT NOT NULL,                    -- JSON; see Doc 22 §Session Snapshot
                        -- Captures: SI value, ordered story_message_ids, accordion state,
                        -- attached doc IDs + content hashes, prefix_hash. Used to reconstruct
                        -- the session's cache prefix on re-entry.
    is_collapsed      INTEGER NOT NULL DEFAULT 0,       -- Banner collapsed/expanded in Theater
    -- Cache fields — populated only when kind = 'consulting' AND a cache is currently active.
    -- Handover sessions never set these (handover is uncached).
    cache_name        TEXT,
    cache_expiry_at   TEXT,                             -- ISO 8601
    cache_is_stale    INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL,
    modified_at       TEXT NOT NULL,
    CHECK (kind = 'consulting' OR (cache_name IS NULL
                               AND cache_expiry_at IS NULL
                               AND cache_is_stale = 0))
);
```

**Lifecycle:**
- A session is created by an explicit user action (clicking the mode switcher tab while in story mode, or starting a new session from inside that mode).
- "Open" / "active" status is not stored in the DB — at any moment the workspace's `modeStore.activeSessionId` (Doc 06) names which session is currently being driven.
- A consulting cache is created when the session is started or re-entered, and dropped (`DELETE` to Gemini, NULL the fields) when the session is exited (mode switch back to story, or starting a different session). The cache TTL is not refreshed while the session is not active — it is allowed to expire naturally if the user does not return.
- The session row itself is permanent — exit does not delete it. The banner remains in the Theater for re-entry via banner click.

**Naming:** Default name on creation is `"<Kind> <N>"` where N is the next available 1-based index for that kind on this story (e.g. `"Consulting 1"`, `"Consulting 2"`, `"Handover 1"`). The user can rename via the banner. Defaults are stable — renaming an earlier session does not renumber later defaults.

**Per-session message ordering:** Messages within a session are ordered by `created_at`, scoped to `WHERE session_id = ?`. They are not interleaved with story-kind messages.

---

## TypeScript Interfaces

### Core

```typescript
// app_config.json shape
interface AppConfig {
  worlds: WorldEntry[];
  active_world_id: string | null;
  salt_hex: string;
  key_check: { nonce_hex: string; ciphertext_hex: string };
}

interface WorldEntry {
  id: string;
  name: string;
  db_path: string;
  world_meta_path: string;
}

// world_meta.json shape
interface WorldMeta {
  id: string;
  name: string;
  tags: string[];
  accent_color: string;
  cover_image_path: string | null;
  created_at: string;
  modified_at: string;
}
```

### Vault

```typescript
interface VaultItemMeta {
  id: string;
  parent_id: string | null;
  item_type: 'Story' | 'Folder' | 'SourceDocument' | 'Image';
  item_subtype: string | null;
  name: string;
  description: string | null;
  sort_order: number;
  created_at: string;
  modified_at: string;
  deleted_at: string | null;
  // Image-only
  asset_path: string | null;
  asset_meta: ImageAssetMeta | null;
  file_api_uri: string | null;
}

interface ImageAssetMeta {
  width: number;
  height: number;
  mime_type: string;
}
```

### Conversation

```typescript
type MessageRole = 'user' | 'model';
type ContentType = 'json_user' | 'text' | 'blocks';
type MessageKind = 'story' | 'handover' | 'consulting';
type FinishReason = 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'ERROR';

interface ChatMessage {
  id: string;
  story_id: string;
  session_id: string | null;     // null for kind='story'; set for handover/consulting
  role: MessageRole;
  content_type: ContentType;
  content: string;
  token_count: number | null;
  model_name: string | null;
  finish_reason: FinishReason | null;
  created_at: string;
  deleted_at: string | null;
  user_feedback: string | null;
  ghostwriter_history: GhostwriterEdit[];
  kind: MessageKind;
}

// Parsed form of content when content_type === 'json_user'
// Four user-input fields. Output length is not a per-message field in v2.0;
// length cues live in `constraints` or in the active aux slot. Image attachments
// are deferred (see Doc 19).
interface UserContent {
  plot_direction: string;
  background_information: string;
  modificators: string[];
  constraints: string;
}

// Persisted draft for the input area, story-scoped (story_state.draft).
interface InputDraft {
  plot_direction: string;
  background_information: string;
  modificators: string[];
  constraints: string;
}

// Used when content_type === 'blocks'.
// **Reserved for v2.1.** No v2.0 path produces 'blocks' messages (Doc 19 deferred image
// generation; Doc 17 hides Ghostwriter on blocks bubbles). Shape will be tightened when
// v2.1 image-gen design lands — `content`, `url`, and `mime_type` semantics are placeholders.
interface MessageBlock {
  type: 'text' | 'image';
  content: string;       // text: prose content; image: base64 or empty (v2.1 — TBD)
  url: string | null;    // image: local file URL or asset URL (v2.1 — TBD)
  mime_type: string | null;
}

// Per-message edit history entry. Appended on every accepted Ghostwriter edit; popped
// on revert. Authoritative shape lives here; Doc 17 §Accept Flow consumes it.
interface GhostwriterEdit {
  edited_at: string;        // ISO 8601
  original_content: string; // full message content before this edit
  new_content: string;      // full message content after this edit
  instruction: string;      // the writer's instruction
  selected_text: string;    // the passage the model was asked to revise
}
```

### Accordion & Checkpoints

```typescript
interface Checkpoint {
  id: string;
  story_id: string;
  after_message_id: string | null;
  name: string;
  is_start: boolean;
  created_at: string;
  modified_at: string;
}

interface AccordionSegment {
  id: string;
  story_id: string;
  start_cp_id: string;
  end_cp_id: string;
  summary: string | null;
  is_collapsed: boolean;          // UI: 1 = banner shows summary card; 0 = bubbles visible
  use_summary: boolean;           // API: 1 = inject fake-pair; 0 = full bubbles. Forced ON when is_collapsed=1.
  is_stale: boolean;
  summarised_at: string | null;
  created_at: string;
  modified_at: string;
}

interface AccordionState {
  checkpoints: Checkpoint[];
  segments: AccordionSegment[];   // closed segments only
}
```

### Context Caching

```typescript
// Story-cache status (one per story).
interface CacheStatus {
  cache_name: string | null;
  expiry_at: string | null;
  is_stale: boolean;
  last_cached_message_id: string | null;
  total_token_count: number | null;
  doc_snapshots: Record<string, string>; // doc_id → SHA-256 content hash
}

// Session-cache status, shared in shape with the cache fields on a session row.
// Populated only for consulting sessions; null on handover sessions.
interface SessionCacheStatus {
  cache_name: string | null;
  expiry_at: string | null;
  is_stale: boolean;
}

// Snapshot captured at session creation (and used on re-entry to rebuild
// the same cache prefix the AI saw originally). Stored verbatim as JSON
// in conversation_sessions.entry_snapshot.
interface SessionSnapshot {
  schema_version: 1;
  system_instruction: string;                 // Resolved consulting_si or handover_si at creation
  story_message_ids: string[];                // Ordered IDs of story-kind messages included in the prefix
  accordion_state: Array<{
    segment_id: string;
    is_collapsed: boolean;
    summary: string | null;                   // Verbatim summary at creation time (only when collapsed)
    summary_hash: string | null;              // SHA-256 of summary, when present
  }>;
  attached_docs: Array<{
    doc_id: string;
    content_hash: string;                     // SHA-256 of doc content at creation
  }>;
  prefix_hash: string;                        // SHA-256 rollup over the assembled prefix; integrity check
}
```

### Modes and Sessions

```typescript
type AppMode = 'story' | 'handover' | 'consulting';
type SessionKind = 'handover' | 'consulting';

interface ConversationSession {
  id: string;
  story_id: string;
  kind: SessionKind;
  name: string;
  entry_message_id: string | null;
  entry_snapshot: SessionSnapshot;
  is_collapsed: boolean;
  // Cache fields — populated only when kind='consulting' AND a cache is currently alive.
  cache_name: string | null;
  cache_expiry_at: string | null;
  cache_is_stale: boolean;
  created_at: string;
  modified_at: string;
  // Derived (not stored): message_count, computed by COUNT(*) on messages WHERE session_id = id
  message_count: number;
}
```

---

### IPC Payload and Result Types

These TypeScript interfaces describe the shapes that cross the Tauri IPC boundary as Tauri command results, command arguments, or event payloads. **Authoritative source: the Rust struct in the named module — generated to TypeScript via `ts-rs`.** The shapes below are documentation; the build-time-generated `src/lib/types.ts` is the consumed artefact. CI verifies the two match.

```typescript
// Returned by `update_world_meta`; Rust source: db/vault.rs::WorldMetaPatch
interface WorldMetaPatch {
  name?: string;
  tags?: string[];
  accent_color?: string;
  cover_image_path?: string | null;  // explicit null clears
}

// Returned by `get_resolved_settings`; Rust source: services/settings.rs::ResolvedSettings.
// Merged cascade (world override → app default → hardcoded fallback).
// Field set mirrors the App + World tables above with the overridable keys flattened.
interface ResolvedSettings {
  // Gemini
  text_model_name: string;
  gen_temperature: number;
  gen_top_p: number;
  gen_top_k: number;
  gen_max_output_tokens: number;
  gen_summarise_temperature: number;
  gen_summarise_top_p: number;
  gen_summarise_top_k: number;
  gen_summarise_max_output_tokens: number;
  cache_ttl_secs: number;
  cache_min_tokens: number;
  context_token_limit: number;
  // Theme
  accent_color: string;
  body_font: string;
  bubble_user_color: string;
  bubble_ai_color: string;
  ghostwriter_color: string;
  accordion_color: string;
  checkpoint_color: string;
  feedback_color: string;
  // System Instructions
  story_si: string;
  handover_si: string;
  consulting_si: string;
  aux_slot_1_name: string;
  aux_slot_1_content: string;
  aux_slot_2_name: string;
  aux_slot_2_content: string;
  // App-only (passthrough; world cannot override)
  has_api_key: boolean;
  auto_lock_secs: number;
  rate_limit_rpm: number;
  rate_limit_tpm: number;
  rate_limit_rpd: number;
}

// Returned by `get_telemetry`; payload of `telemetry_tick`. Rust source: db/settings.rs::Telemetry
interface Telemetry {
  text:      TelemetryRow;
  image_gen: TelemetryRow;  // reserved v2.1; zero in v2.0
  tts:       TelemetryRow;  // reserved v2.1; zero in v2.0
}
interface TelemetryRow {
  req_count_min:    number;
  req_count_day:    number;
  token_count_min:  number;
  last_req_at:      string | null;
  window_start_min: string | null;
  window_start_day: string | null;
}

// Returned by `list_alive_caches`. Rust source: services/cache.rs::AliveCacheRow
interface AliveCacheRow {
  story_id:        string;
  story_name:      string;
  session_id:      string | null;   // null for the story cache; set for active consulting
  session_name:    string | null;
  total_tokens:    number;
  expiry_at:       string;          // ISO 8601
  is_stale:        boolean;
}

// Returned by `unlock_vault`. Rust source: commands/auth.rs::UnlockResult
interface UnlockResult {
  has_api_key:    boolean;
  auto_lock_secs: number;
}

// Returned by `send_ghostwriter_request`. Rust source: services/gemini.rs::GhostwriterResponse
interface GhostwriterResponse {
  revised_passage: string;
  token_count:     number;
}

// Returned by `revert_ghostwriter_edit`. Rust source: commands/ghostwriter.rs::RevertResult
interface RevertResult {
  restored_content:      string;
  remaining_history_len: number;
}
```

**Why `ts-rs`:** the Rust struct is the single source of truth. Manually-maintained TS interfaces drift the moment a field is added on either side. A CI step compares the generated `types.ts` against the Rust source and fails the build on divergence.

---

## Field-Level Invariants

- All `id` fields are UUID v4, generated by the backend, never the frontend.
- All `created_at` / `modified_at` / `deleted_at` fields are ISO 8601 UTC strings.
- `deleted_at IS NULL` means the record is live; a timestamp means soft-deleted.
- `content` in `items` is always an empty string for Stories, Folders, and Images — only SourceDocuments store content there.
- `ghostwriter_history` defaults to `'[]'` (empty JSON array), never NULL.
- `messages.session_id IS NULL` iff `messages.kind = 'story'`; a non-NULL `session_id` always points to a `conversation_sessions` row whose `kind` matches the message's `kind`.
- `messages` with `kind IN ('handover','consulting')` are excluded from story history assembly in `services/history.rs` but are included in story export (Doc 21).
- A `conversation_sessions` row with `kind = 'handover'` always has `cache_name`, `cache_expiry_at` NULL and `cache_is_stale = 0` (handover never caches).
- A consulting session has at most one cache alive at any time. Switching away from a consulting session drops its cache; re-entering rebuilds from `entry_snapshot`.
- `cache_state.last_cached_message_id`, when non-NULL, references a `kind='story'` message in the same story (enforced by application logic — SQLite FK does not constrain on `kind`).

---

## Migration Strategy

v2.0 is a clean rewrite — no migration from v1.0 databases is required or planned. The schema differences (primarily removal of `parent_id` from `messages`) mean v1.0 and v2.0 databases are not compatible.
