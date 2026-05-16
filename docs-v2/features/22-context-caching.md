# 22 — Context Caching

> **Status:** Complete
> **Last updated:** 2026-05-03 — pre-implementation audit resolution: `cache_enabled` world-override toggle dropped — caching is always on subject to `cache_min_tokens` threshold; the inline-fallback path now triggers only on actual create-failure / below-threshold conditions (CD-12 / Q8). Doc 03 overridable-keys list left unchanged (`cache_enabled` was never added there).
> **Earlier:** 2026-04-29 — Doc 18 design pass: source-doc rename and soft-delete-cascade added to stale triggers
> **Earlier:** 2026-04-29 — Doc 16 design pass: accordion-specific stale triggers enumerated; fake-pair substitution confirmed for v2 (closes TODO §O3); accordion `is_collapsed` vs. `use_summary` decoupling reflected in trigger rules
> **Earlier:** 2026-04-29 — Doc 23 design pass: cache shape generalised to include full story-history-to-date; per-session caches added for consulting; refresh-on-send for both cache types; cached-message edit/delete warning; story cache and consulting cache coexistence rules; auto-rebuild on expiry
> **Earlier:** 2026-04-28 — initial design pass: locked decisions captured; structural questions deferred (esp. SI/consulting cache transition — resolved 2026-04-29 by per-session caches)
> **Scope:** Gemini API explicit context caching — what gets cached, lifecycle (create, refresh, expire, delete), staleness rules, story / consulting cache coexistence, edit / delete protection, and graceful fallback to inline.

---

## Overview

LOOM uses Gemini's explicit context caching (`cachedContents` API) to amortise the cost of long stories. The cached prefix contains the parts of a request that are stable across many turns — system instruction, attached source documents, and the story's prior message history up to a high-water mark — so that each subsequent turn pays only for the user's new turn plus any post-cache messages.

There are two kinds of cache in v2.0:

- **Story cache** — one per story, at most. Used by Story-mode `send_message` calls. Persists across consulting and handover excursions.
- **Consulting-session cache** — one per active consulting session. Created on session entry, dropped on exit. Replaces the story cache *for that session's requests* but does not invalidate the story cache.

Handover never caches (single short session, low reuse, see §Why Handover Doesn't Cache).

Caches are managed entirely in the Rust backend via `commands/cache.rs` and `services/cache.rs`. The frontend reads cache state for display but never makes Gemini API calls directly.

---

## What Gets Cached

The cached prefix, in order, consists of:

1. **System instruction** — the resolved `story_si` (for story cache) or `consulting_si` (for consulting cache), via the settings cascade `world → app → fallback`. Goes into Gemini's `system_instruction` field.
2. **Source documents** — ordered as a leading user/model pair (v1.0 §10.2 layout), one entry per attached doc, each wrapped in `=== SOURCE DOCUMENT: <subtype> — <name> ===` headers. Order is by attachment time (insertion order); doc-importance reordering is not in scope for v2.0.
3. **Story history** — every story-kind message for this story up to the high-water mark, with feedback injected on model turns and Accordion segments substituted with their fake-pair (Doc 16). For a consulting cache, the high-water mark is the session's `entry_message_id`. For the story cache, it is `cache_state.last_cached_message_id`.

Aux slots are **outside** the cached prefix — they are prepended to the live user turn at send time (Doc 15 §Aux Slot Injection). Switching aux slots does not invalidate any cache.

The current user turn is **outside** the cached prefix — it is the only thing the cache call appends per request.

### Why story history is in the cache (not just SI + docs)

In earlier drafts the cache held only SI + docs. v2.0 expands it to include all story messages up to a moving high-water mark because long stories spend most of their tokens on accumulated history, and history is overwhelmingly stable (writers append; they rarely edit older messages). Caching the history is where the savings live.

The cost model is unchanged from v1.0 — Gemini bills cached tokens at ~25% of normal input cost. A 250 k-token story with caching enabled is ~70% cheaper per turn after the cache is established; break-even is at ~2 turns post-creation.

---

## Cache Lifecycle

### Story cache

**Creation triggers:**

- Manual: writer right-clicks the Send button → "Update cache" (or any equivalent affordance). This is the explicit path for first creation when the writer wants caching from the start.
- Automatic on send: when a `send_message` (story mode) finds the story cache in any of these states — never created, expired, deleted, or stale-and-marked-rebuild — and the would-be cache prefix is at or above `app_settings.cache_min_tokens` (default 4096), the backend creates a new cache as part of the send. The new cache contains SI + docs + all story-kind messages up to and including the *prior* model message (i.e. everything in history before the current user turn).

There is no auto-creation on story creation, story open, or first send — the cache only comes into existence when there is enough content to amortise it (the min-tokens threshold) or when the writer explicitly asks.

**Refresh:** every successful `send_message` that uses the story cache fires a `PATCH cachedContents/<name>` to reset the TTL to `app_settings.cache_ttl_secs` (default 3600 s, world-overridable). Refresh is fire-and-forget via `tokio::spawn` — failures are logged but do not block the response stream. As long as the writer keeps sending, the cache will not expire on its own.

**Expiry:** if no send occurs for `cache_ttl_secs` seconds, the cache expires server-side (Gemini deletes it). The next send detects this (the `expiry_at` field is in the past) and rebuilds the cache as part of the send (see "Automatic on send" above). The user does not see expiry as an error — it is a transparent rebuild with one extra round-trip.

**High-water update:** when a story cache is created or rebuilt, `cache_state.last_cached_message_id` is set to the most recent story-kind message ID that was included. The cache's `total_token_count` is recorded from Gemini's response. `doc_snapshots` is populated with current SHA-256 hashes of all attached docs.

**Stale marking:** any side-effect that changes the cached prefix marks the cache stale. The cache is not re-uploaded automatically on staleness — the next send detects `is_stale = 1` and rebuilds before sending. Triggers are listed in §Stale Triggers below.

**Deletion:** best-effort `DELETE cachedContents/<name>` on:
- Manual recreate (delete-then-create).
- Story hard-delete (via vault permanent delete — Doc 14).
- World close / app close — *no*. Caches outlive sessions; they expire on their own TTL.

Deletion is never used to "save money" — Gemini doesn't refund storage on early deletion. Always let TTL expire when possible.

### Consulting-session cache

**Creation:** automatic when a consulting session is started or re-entered. Always created, regardless of cache-min-tokens — the session needs context to function. If the prefix is below the Gemini API's hard minimum, the create call will fail; the session falls back to inline assembly (see §Fallback to Inline Path).

**Cache contents at session start:**
- `consulting_si` (resolved from cascade)
- All currently-attached source docs
- All story-kind messages up to and including the message named by `entry_message_id` (or no story messages if `entry_message_id IS NULL`)
- Accordion state at session start: collapsed segments are substituted with their summaries (fake-pair), expanded segments contribute their constituent messages directly

**Cache contents on re-entry:** rebuilt from `conversation_sessions.entry_snapshot` (Doc 03), not from current state. This is critical: the AI saw a specific prefix when the original session messages were written, and re-entry must reproduce it so subsequent turns are coherent with the existing session history.

**Refresh:** identical to story cache — fire-and-forget `PATCH` on every successful `send_session_message` to a consulting session.

**Exit:** when the user leaves the session (mode switch back to story, switch into a different session, or app lock/close), the cache fields on the session row are cleared and a best-effort `DELETE` is fired against Gemini. The cache TTL is no longer being refreshed; if the user lingers in story mode and then returns to the consulting session, a fresh cache is rebuilt from the snapshot.

**Expiry while inactive:** if the user exits the session and the cache has not yet been DELETE'd (network loss, race), it expires on its own TTL. Re-entry rebuilds regardless.

**Coexistence with story cache:** during a consulting session, the story cache is left alive but is not used by `send_session_message`. Its TTL is not refreshed during consulting (no story sends are happening). If the user spends longer in consulting than `cache_ttl_secs`, the story cache expires; on return to story mode the next send rebuilds it transparently.

### Why handover doesn't cache

Handover sessions are interactive (multi-turn) but typically short — a writer asks for a structured report, optionally iterates on it ("expand the character section"), and leaves. The session window is too short for cache creation to amortise (break-even is ~2 turns *post-creation*, and creation itself is one extra round-trip). Handover requests are always assembled inline with the current SI + docs + story history + handover-session history.

Entering handover does not touch the story cache; it stays alive for return.

---

## Auto-rebuild on Expiry (story sends)

When a Story-mode `send_message` runs:

1. Read `cache_state` for the story.
2. Compute `use_cache = cache_name IS NOT NULL AND NOT is_stale AND expiry_at > now()`.
3. If `use_cache`:
   - Build a `with_cache` request body referencing the cache name. The body's `contents` is just the new user turn (with aux slot prepended) plus any uncached story messages between `last_cached_message_id` and now (typically empty, but possible if cached message protection was bypassed and a new exchange landed between sends).
   - Send. On success, fire-and-forget TTL refresh.
4. If not `use_cache`:
   - If `is_stale` or expired: best-effort `DELETE` the old cache name first.
   - If the would-be cache prefix exceeds `cache_min_tokens`: create a new cache with SI + docs + all story-kind messages prior to this turn. On success, store `cache_name`, `expiry_at`, `last_cached_message_id`, `total_token_count`, `doc_snapshots`. Then build a `with_cache` request for the new turn.
   - Otherwise (below threshold): build an inline request (SI + docs + history + new turn, all in one body) — the inline path described in §Fallback to Inline Path.

Rebuild is transparent. The writer sees the normal "Preparing → Thinking → Streaming" Status progression; if a rebuild happens, it manifests as a slightly longer "Preparing" phase (one extra Gemini round-trip).

---

## Stale Triggers

Any of the following marks the relevant cache stale (`is_stale = 1`). Both the story cache and the active consulting-session cache are checked against each trigger; only those whose prefix is affected are marked.

**Affecting story cache and any active consulting cache:**

- Source doc attached or detached for this story
- Source doc content edited (any document currently in either cache's `doc_snapshots` set)
- Source doc renamed (any document in `doc_snapshots` — name is part of the `=== SOURCE DOCUMENT: <subtype> — <name> ===` header per Doc 18)
- Source doc soft-deleted (Trash) — auto-detached from every story per Doc 18 §Cascade Rules; same effect as a manual detach
- World-level mode SI override changed (story_si for story cache; consulting_si for consulting cache)
- App-level mode SI changed AND the story has no world override for that key
- Model name changed (model is part of the cache parameters)

**Affecting story cache only:**

- A story-kind message at or before `cache_state.last_cached_message_id` is edited or hard-deleted (see §Cached-message Edit/Delete Protection — these only proceed after a confirmation dismissal, which marks the cache stale rather than blocks the operation)
- Feedback added/edited/cleared on a model message at or before `last_cached_message_id`
- An Accordion operation overlapping the cached range whose effect on history assembly differs (see §Accordion-specific Stale Triggers below)

**Affecting consulting cache only:**

- A consulting-session message edit or delete (the session's own history; same warning protection applies, scoped to the session)
- The session's snapshot becomes invalid because a story-kind message it references was hard-deleted (the session is still usable; the warning surfaces on re-entry)

A stale cache is rebuilt automatically on the next send to that mode. There is no manual "refresh stale" affordance — staleness is always resolved by sending or by manually recreating.

### Accordion-specific Stale Triggers

Accordion has two collapse states (`is_collapsed` for UI; `use_summary` for API substitution — see Doc 16). Only operations that change *what the cache prefix actually contains* mark the cache stale; pure-UI operations do not.

| Operation | Cache stale? |
|---|---|
| Generate first summary on a segment in cached prefix | **Yes** if `use_summary = 1` (default), because the prefix's substituted content changes |
| Re-summarise an existing summary in cached prefix | **Yes** if `(is_collapsed OR use_summary)` |
| Manual `Edit summary` in cached prefix | **Yes** if `(is_collapsed OR use_summary)` |
| Toggle `use_summary` (either direction) | **Yes** if the segment's range overlaps the cached prefix |
| Toggle `is_collapsed` (chevron click) | **No** — UI-only; `use_summary` is independent and unchanged |
| Create checkpoint that splits a substituted segment in cached prefix | **Yes** — the original segment row is gone; substitution can no longer use the same fake-pair |
| User-initiated `Delete checkpoint` (segment merge) | **Yes** if either old segment was substituted in cached prefix |
| Cascade-from-message-delete that drops a substituted segment | **Yes** — already covered by the message edit/delete protection rule |
| Rename a checkpoint | **No** — display-only |
| `is_stale` flag flips on a segment (via underlying message change) | **No** — the segment's substituted content has not changed, just its accuracy. The next intentional re-summarise will then mark cache stale. |

The cached-message edit/delete protection rule (next section) also fires for any underlying message change that propagates into a substituted segment via these triggers.

Story-kind messages whose `created_at` falls at or before `cache_state.last_cached_message_id`'s `created_at` are inside the cached prefix. Editing or deleting them invalidates the cache; the cost of rebuild is non-trivial; and writers are sometimes unaware which messages are "old enough" to be cached.

**Rule:** any operation that would mutate a cached story message — `edit_user_message`, `update_message_content`, `regenerate_last_response` (when the most recent model is cached, e.g. via tail-truncation), `delete_exchange`, `delete_from`, ghostwriter accept on a cached model message, feedback edit on a cached model message — requires a one-shot confirmation modal:

```
This message is part of the active cache.
Editing it will invalidate the cache. The next send will rebuild it.

[Cancel]  [Edit anyway]
```

Dismissal proceeds with the operation and marks the cache stale (`cache_state.is_stale = 1`). The cache is not deleted yet — the next send handles rebuild.

The same rule applies to consulting-session messages relative to their session cache's prefix, with copy adjusted to "consulting session cache."

A single confirmation per operation; LOOM does not remember "user already dismissed this for this session." The intent is to keep writers aware that their cost model just changed.

The confirmation modal is not shown when the cache is already stale (no further degradation possible) or when there is no active cache (`cache_name IS NULL`).

---

## Session Snapshot

Stored in `conversation_sessions.entry_snapshot` as JSON. Captured at session creation; consulted at session re-entry to reconstruct the original cache prefix.

```typescript
interface SessionSnapshot {
  schema_version: 1;
  system_instruction: string;
  story_message_ids: string[];
  accordion_state: Array<{
    segment_id: string;
    is_collapsed: boolean;
    summary: string | null;
    summary_hash: string | null;
  }>;
  attached_docs: Array<{ doc_id: string; content_hash: string }>;
  prefix_hash: string;
}
```

**Re-entry algorithm:**

1. Resolve the session row.
2. For each `story_message_ids[i]`: fetch the message. If missing (writer hard-deleted with the cached-message warning dismissed), record a divergence and skip.
3. For each `accordion_state[i]` whose `is_collapsed = true`: the captured `summary` is used verbatim — not the current segment summary, which may have been re-summarised. (Snapshot summaries are immutable; they reflect what the original AI saw.)
4. For each `attached_docs[i]`: fetch the doc. If missing, record divergence and skip. If `content_hash` no longer matches, use the current content and record divergence.
5. Recompute the rolled-up `prefix_hash`. If the recomputed value differs from the stored value, record divergence.
6. If any divergences were recorded: surface a non-blocking warning toast — "Story has changed since this session was created. Context may differ." — and proceed with the rebuilt prefix.
7. POST `cachedContents` with the assembled prefix; populate the session row's cache fields.

The snapshot's purpose is integrity. The cache itself is recreated, not preserved across the gap.

**Robustness notes:**
- Hash function is SHA-256 of UTF-8 content bytes, sharing the canonicalisation pipeline with cache-creation code so the two can never diverge.
- `schema_version` is captured so we can evolve the snapshot shape without breaking old sessions.
- Snapshots are write-once at session creation. They are never updated, even on rename — a renamed session's snapshot still describes the original prefix.

---

## Cache + Context Limit

The token meter (Doc 15 §Token Counting) compares the assembled request size against `app_settings.context_token_limit` (default 128 000). When a cache is active, the meter must include `cache_state.total_token_count` (or the consulting session's equivalent) plus the live additions (uncached messages, current user turn, aux slot) — the model's context window holds *all* of it, cached or not.

`get_token_count` runs on the resolved request and returns the same total whether cached or inline. Frontend warning thresholds use this value.

---

## Delivery Model — Real Cache vs. Inline Fake Cache

> **D-21 (2026-05-16).** The earlier "fallback to inline" wording (CD-12) is superseded by this section. The key change: the inline path now *carries the source documents* (it never did in the implemented Phase 5/6 code — a silent context-loss bug), and a cache-create failure is treated as a **stop**, not a silent degrade.

There is exactly one **prefix builder** (`services/cache.rs::build_*_prefix`). It assembles `SI + source documents + story/session history` — the bytes that *would* be cached. That prefix reaches the model by one of two routes:

| Route | When | Mechanism |
|---|---|---|
| **Real cache** | Prefix ≥ `cache_min_tokens` and `create_cache` succeeds | Gemini `cachedContent` object; the request carries only the new turn |
| **Inline fake cache** | Prefix < `cache_min_tokens`, OR cache-create failed and `inline_context_fallback` is on | `prefix.contents` are prepended verbatim into the request body where the cache would sit — no cache object. Same bytes, just not cached |

The fake cache is "everything the cache would contain, prepended where the cache would normally sit." Sub-threshold sends always use it — so a small story still sends all of its attached documents. (Before D-21 the sub-threshold path dropped every source doc.)

### Cache-create failure

When the prefix is ≥ `cache_min_tokens` so a real cache *should* be created, and `create_cache` fails (network, 4xx, 5xx):

- **`inline_context_fallback = false` (default)** → the send is **aborted**. The optimistic user/model rows are hard-deleted, and `LoomError::CacheCreate` surfaces to the writer: *"Couldn't create the context cache — send aborted. Enable inline context fallback in Settings to send anyway."* The writer is never given a degraded answer (one missing the world bible / character sheets) that they can't distinguish from a good one.
- **`inline_context_fallback = true`** → the send proceeds via the inline fake cache. The writer trades the cache's token-cost savings for send reliability.

`inline_context_fallback` is an `app_settings` boolean, default `false` (Doc 03). Its toggle lives in Settings → Features (Phase 11).

Cache deleted by Gemini between refresh and send (race) → 404 on send; transparently rebuild + retry.

Caching is still always on — there is no per-world `cache_enabled` toggle. `cache_min_tokens` is the cost-control knob; below it the fake cache is automatic.

The fake cache arranges SI + docs as a leading user/model pair (v1.0 PRD §10.2) so Gemini's implicit caching has the best chance of hitting the stable prefix. Implicit caching is not actively managed — we only lay out the request to be friendly.

---

## Cost Impact

From v1.0 PRD §11. For Gemini 2.5 Pro at typical pricing:

- Input cost: 1×
- Cached-input cost: ~0.25× (Gemini caches at ~25% of normal input)
- Cache storage cost: per-token-hour billing while alive

For a 250 k-token cached prefix and 20-message session:
- Inline: 20 × 250 k = 5 M input tokens billed
- Cached: 1 × 250 k (creation) + 20 × ~0 cached input (cache hit) + 20 × small uncached delta + storage-hours
- Net savings: ~70% on input cost, dominant for long sessions.

Break-even is ~2 messages *post creation* — the creation cost itself is roughly 1 send's worth.

Storage is small per token-hour but adds up across many alive caches. v2.0 does not aggressively prune; we trust Gemini's TTL.

---

## User Flows

### Create Cache (manual)

1. Writer right-clicks Send button → context menu shows "Update cache" (always available; if no cache exists, copy is "Create cache").
2. Backend assembles the prefix from current state (SI + docs + all story-kind messages to date), creates a new cache via Gemini API, stores fields in `cache_state`.
3. `cache_state_changed` event fires; right-pane Cache section updates.

If a cache already exists, the manual path deletes the old one first (best-effort) before creating the new one.

### Auto-create on send (story)

Transparent to the writer. The first send that triggers it pays one extra round-trip (cache creation). Subsequent sends use the cache.

### Auto-create on consulting session entry

Triggered by clicking the consulting tab in the mode switcher (which always creates a new session) or by re-entering an existing session via banner click. Cache creation happens before the session's input area becomes interactive — the writer sees a brief "Preparing session…" status if creation takes more than ~250 ms.

### View Cache Status

Right-pane Cache section shows all currently-alive caches across all stories in the world:

```
CACHE
─────
This story · 248 k tok · TTL 14:32   [✓ active]
"Sea of Stars" · 191 k tok · TTL 02:04  [● fading]
─────
```

Each row: story name, total cached tokens, TTL countdown (per-second ticker), state colour. Clicking a row opens the Cache Contents modal for that story (per-doc breakdown, total tokens, estimated per-message saving).

A consulting session that is currently active appears as an additional row labelled with the session name, e.g. `This story › Consulting 1 · 215 k tok · TTL 12:48`.

Visual values (colours, exact layout) are a TODO for the visual design phase — see TODO.md.

### Refresh Cache TTL

Automatic only. No manual refresh affordance. Fire-and-forget after every successful send to that cache.

### Delete Cache

Right-click a cache row → "Delete cache." Best-effort `DELETE` to Gemini. `cache_state` row is wiped (or the session row's cache fields are nulled). Useful when the writer wants to force a clean rebuild on next send.

---

## Cache Status UI

### TTL Countdown

Per-second ticker driven by a single shared `setInterval` in `cacheStore` while any cache row is rendered. Colour-coded:

| Range | Colour |
|---|---|
| > 5 min | green |
| 1–5 min | amber |
| < 1 min | red |
| Stale | amber dot, separate from time colour |

Tokens (final values) and timing are ⚠️ provisional — visual design phase.

### Stale Indicator

Amber dot on the Send button when the active cache for the current mode is stale. Tooltip: `Cache is outdated. Update it before sending for cost savings, or send anyway.` Two actions: Update Cache, Send Anyway.

Right-click Send → context menu always offers Update Cache.

### Cache Contents Modal

Opened by clicking a cache row. Shows:
- Header: story name, cache resource name, TTL countdown
- Per-doc rows: doc name, token count, hash match indicator (✓ unchanged since cache, ⚠ changed)
- Story-history row: number of messages, cumulative token count, last-cached message ID + excerpt
- Total token count
- Estimated per-message saving (current message-size baseline × cache-rate-discount)
- Actions: Update cache, Delete cache, Close

Per v1.0 PRD §7.3, kept for transparency.

---

## Data Requirements

- `cache_state` (Doc 03) — story caches, one row per story.
- `conversation_sessions` (Doc 03) — session caches, cache fields populated only for consulting kind.
- `messages` (Doc 03) — content, ordering, kind, session_id all consumed.
- `items` (Doc 03) — source docs (content + content hashes).
- `accordion_segments` (Doc 03) — collapsed segments contribute summaries.
- `app_settings` / `settings` (Doc 03) — `cache_ttl_secs`, `cache_min_tokens`, `story_si`, `consulting_si`, `text_model_name`.

---

## Backend API

`commands/cache.rs`:

```
get_cache_state(story_id: String) -> Result<CacheStatus>
  // Returns the story cache state for this story.

create_story_cache(story_id: String) -> Result<()>
  // Manual create / recreate of the story cache. Deletes any existing cache first.

delete_story_cache(story_id: String) -> Result<()>
  // Best-effort DELETE; clears cache_state row.

get_session_cache_state(session_id: String) -> Result<SessionCacheStatus>

list_alive_caches(world_id: String) -> Result<Vec<AliveCacheRow>>
  // For the right-pane Cache section: all currently-alive caches across stories.
```

Internally (not exposed as commands):

```
services/cache.rs:
  build_cache_prefix(story_id, scope: CacheScope) -> Result<CachePrefix>
  create_cache(prefix: CachePrefix) -> Result<CacheRecord>
  refresh_cache_ttl(name: String) -> Result<()>          // fire-and-forget
  delete_cache(name: String) -> Result<()>               // best-effort
  mark_stale(scope: CacheScope) -> Result<()>
  is_cached_message(story_id, message_id) -> Result<bool>
  reconstruct_from_snapshot(snapshot: SessionSnapshot) -> Result<CachePrefix>
```

Where `CacheScope` is `Story(story_id)` or `Session(session_id)`.

---

## Events

| Event | Payload | When |
|---|---|---|
| `cache_state_changed` | `{ story_id, status }` | Story cache created, refreshed, marked stale, or deleted |
| `session_cache_state_changed` | `{ session_id, status }` | Session cache created, refreshed, marked stale, or deleted |

`status` carries the relevant cache snapshot fields. Frontend `cacheStore` and `modeStore` consume these to update UI.

---

## Frontend State

`cacheStore` (Doc 06):

```typescript
interface CacheStore {
  byStory: Record<string, CacheStatus>;             // CacheStatus: see Doc 03
  bySession: Record<string, SessionCacheStatus>;
  // actions
  loadStoryCache(storyId: string): Promise<void>;
  loadSessionCache(sessionId: string): Promise<void>;
  handleStoryCacheEvent(payload: { story_id: string; status: CacheStatus }): void;
  handleSessionCacheEvent(payload: { session_id: string; status: SessionCacheStatus }): void;
  clearStory(storyId: string): void;                 // world switch / lock
  clearSession(sessionId: string): void;
}
```

A single shared `setInterval` ticker re-renders TTL countdowns at 1 Hz while any cache row is mounted.

---

## Edge Cases and Error Handling

| Scenario | Behaviour |
|---|---|
| Cache create fails (4xx) | Toast warning. Inline fallback for this send. Retry on next send. |
| Cache create fails (5xx) | Same as 4xx. |
| Refresh PATCH fails | Logged. Cache continues until TTL expires. Next send detects expiry and rebuilds. |
| Cache deleted by Gemini between use and refresh | 404 on next use. Backend transparently rebuilds. |
| Doc content edited mid-send | The send completes against the cache as it was. Cache is marked stale during the edit transaction (the doc-edit command does this). Next send rebuilds. |
| Story hard-deleted | Best-effort `DELETE` on the story cache and on every consulting session's cache for that story. |
| World switch | All cache fields cleared from in-memory `cacheStore` (caches themselves are not deleted; they expire on TTL). |
| Vault lock | Same as world switch. |
| App close | Same as world switch. |
| Consulting session re-entered while its old cache is somehow still alive | Old cache is DELETE'd best-effort, new cache is created from snapshot. |
| Story cache in use, doc attached → stale → consulting session entered | Story cache marked stale. Consulting cache is built from current state (which includes the new doc); no interaction. On story return, story cache rebuilds. |
| User dismisses the cached-message warning, then `send_message` finds cache stale | Auto-rebuild on send. No additional prompt. |
| Cache prefix below `cache_min_tokens` after a doc detach | Existing cache is allowed to expire; subsequent sends use inline path. |

---

## Out of Scope

- **Implicit caching tuning** — Gemini handles automatically; we lay out source docs as a leading pair to help, but we don't actively manage it.
- **Cross-story cache sharing** — each story has its own cache, even if two stories attach the same docs.
- **Cross-session cache sharing within consulting** — each consulting session has its own cache; sessions are self-contained.
- **Caching of handover output or handover sessions** — handover is uncached.
- **Doc-importance-ordered cache layout** — v2.0 uses insertion order. Importance ordering is a possible future refinement.
- **Manual TTL refresh affordance** — automatic only.
- **Operation-log integration** (v2.1 undo/redo) — every operation that would invalidate the cache will mark it stale via the same trigger list. To be wired in `docs-v2/future/undo-redo.md`.

---

## Cross-References

- **Doc 03** — `cache_state`, `conversation_sessions` schemas; `CacheStatus`, `SessionSnapshot` interfaces.
- **Doc 06** — `cacheStore` shape.
- **Doc 07** — IPC contracts for cache commands and events.
- **Doc 15** — Conversation Engine; cached-message edit/delete protection feeds the deletion confirmation modal in §Deletion.
- **Doc 16** — Accordion segment substitution feeds the cache prefix.
- **Doc 23** — Modes; consulting session lifecycle and snapshot semantics.
- **`docs-v2/future/undo-redo.md`** — v2.1 reversibility; cache stale-trigger integration.
