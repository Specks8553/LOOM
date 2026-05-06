# LOOM 1.0 — Lessons Learned

> **Purpose:** Concrete pain points found in the v1.0 codebase (2026-04-28 audit), each mapped to its v2.0 mitigation. Where v2.0 doesn't yet have a mitigation, the gap is captured in `IMPROVEMENT-BACKLOG.md`.
>
> This is not a critique of v1.0's authors — it's the natural shape of a codebase that grew through 16+ feature phases without architectural pauses. The point is to make sure v2.0 doesn't re-derive these problems.

---

## Quantitative summary

| Metric | v1.0 actual | v2.0 plan / target |
|---|---|---|
| Tauri commands in `lib.rs` | 87 (3,379 lines) | 0 — `lib.rs` is registration only (Doc 05) |
| Total Rust LoC across all modules | 10,694 | TBD — D-04 layering should keep individual files < 600 |
| Largest single Rust file | `lib.rs` (3,379) | None > 1,000 (target) |
| Largest single React component | `SettingsModal.tsx` (2,267) | None > 600 (proposed convention — see R19) |
| Number of frontend stores | 12 | 7 (D-03 + D-03-B) |
| `tauriApi.ts` size | 557 lines, 90 exports, single file | Split per domain (Doc 06): `tauriApi/auth.ts`, `…/conversation.ts`, etc. |
| `types.ts` size | 363 lines, single file | Generated from Rust via `ts-rs` (R4) — `types.ts` becomes a build artefact |
| `lock().map_err(…)` boilerplate occurrences | 118 | Should be ~0 — one helper macro / function (R17) |
| Raw `SELECT value FROM settings WHERE key = '...'` occurrences | 45 across 6 files | 0 — typed accessors via `AppSettingKey` enum (R2) |
| `LoomError` variants | 22 (many bespoke) | 9 generic + Doc 12 display mapping (Doc 05) |
| Schema migration system | `migrate_dev_schema` — heuristic, phase-by-phase patches | Not yet spec'd — v2 needs a real versioned migrations system (R18) |

---

## Anti-patterns and v2 mitigations

### A1 — `lib.rs` as everything-bucket

**v1.0 evidence:** All 87 Tauri commands live in `lib.rs`, divided by `// ─── Phase X` comment headers reflecting the order features were added (Phase 6: conversation, Phase 7: branching, Phase 8: settings, Phase 9: control pane, Phase 11: source documents, Phase 12: ghostwriter, Phase 13: branch map, Phase 14: accordion, Phase 16: image gen, Phase 17: image prompter, Hand Over, Source Document Creator, etc.). The file ends with a `pub fn run()` registering all 87 commands inline.

There is no domain separation. `unlock_vault`, `vault_create_item`, `send_message`, `get_telemetry`, `creator_send_message`, and `summarise_segment` are siblings in the same file.

The single command `send_message` is roughly 400 lines (lines 555–957), embedding history loading, settings reads, accordion logic, gemini request building, and DB writes inline.

**v2.0 mitigation:** D-04 + Doc 05.
- Backend layout: `commands/{auth,vault,conversation,settings,cache,modes}.rs` — thin handlers, one file per domain.
- `services/` for non-trivial logic: `history.rs`, `gemini.rs`, `rate_limiter.rs`, `settings.rs`, `generation/`.
- `db/` for typed DB access.
- `lib.rs` is registration only — explicit rule.
- The "30-line handler" heuristic in Doc 05 prevents a `send_message`-style 400-line command body.

**Status of mitigation:** Designed. Needs to hold during implementation — easy to violate the first time something feels "easier inline."

---

### A2 — Settings access as raw SQL strings

**v1.0 evidence:** 45 occurrences of `SELECT value FROM settings WHERE key = '...'` scattered across 6 files. From `lib.rs:602–640` alone:

```rust
let static_si: String = conn.query_row(
    "SELECT value FROM settings WHERE key = 'static_system_instruction'", [],
    |row| row.get(0)).unwrap_or_default();

let active_slot: String = conn.query_row(
    "SELECT value FROM settings WHERE key = 'active_si_slot'", [],
    |row| row.get(0)).unwrap_or_else(|_| "1".to_string());

let wi_key = if active_slot == "2" { "system_instructions_2" } else { "system_instructions" };
let wi_content: String = conn.query_row(
    "SELECT value FROM settings WHERE key = ?1", rusqlite::params![wi_key],
    |row| row.get(0)).unwrap_or_default();

// ... 5 more keys read this way in the same function
```

Magic key strings, magic fallback values, and unrelated keys read individually with no batching. `gemini-2.5-flash` is hardcoded as a fallback in lib.rs.

**v2.0 mitigation:** R2 in IMPROVEMENT-BACKLOG.md. Typed `AppSettingKey` and `StoryStateKey` enums with `as_str()` and `default_value()`. Single typed accessor `get_app_setting<T>(key: AppSettingKey)`. Stringly-typed access forbidden.

The cascade resolver (`services/settings.rs`) reads all keys for a request once, returns a struct, the rest of the request uses the struct. No more "for each key, query the DB."

**Status of mitigation:** Open. Critical to land before the first `send_message` re-implementation.

---

### A3 — `lock().map_err(…)` boilerplate

**v1.0 evidence:** 118 occurrences across `lib.rs`, `cache.rs`, `world.rs`. Every `AppState` mutex access is:

```rust
let conn_guard = state.active_conn.lock().map_err(|e| {
    LoomError::Internal(format!("Failed to lock connection: {}", e))
})?;
let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
```

Four lines repeated 118 times for the same idiom: acquire a mutex, map the poison error, unwrap the `Option`. Multiplied across 87 commands this is hundreds of lines of pure boilerplate.

**v2.0 mitigation (proposed — R17 in backlog):** A single helper or macro:

```rust
// Acquires active_conn or returns LoomError::Validation("vault locked")
fn with_conn<T>(state: &AppState, f: impl FnOnce(&Connection) -> Result<T, LoomError>) -> Result<T, LoomError>;

// Or a macro for ergonomics:
let result = with_active_conn!(state, |conn| {
    db::messages::insert_user(conn, story_id, content)
});
```

Same helpers for `master_key`, `api_key`, `settings_conn`, `cancel_tx`. Lock ordering rule (already in Doc 05) becomes more enforceable because all access is through these helpers.

**Status of mitigation:** Open. Add R17 to backlog.

---

### A4 — Stores accumulate unrelated concerns

**v1.0 evidence:** `src/stores/workspaceStore.ts` (168 lines) holds:

- Conversation state: `activeStoryId`, `currentLeafId`, `messages`, `isGenerating`, `streamingMsgId`, `siblingCounts`
- Context doc attachment: `attachedDocIds`
- **Doc editor state** (entirely unrelated to conversation): `activeDocId`, `docContent`, `docSavedContent`, `docDirty`, `docName`, `docSubtype`, `docItemType`

The store has explicit `// Phase 9:` and `// Phase 11:` comments confessing the accretion. The doc editor (a source-document text editor) lives in workspaceStore because, when Phase 11 was implemented, that's where state was easy to add.

**v2.0 mitigation:** D-03 + Doc 06's "Owns / Does not own" sections per store. `workspaceStore` in v2 owns conversation only. Doc editor state lives where it belongs (likely a small `editorStore` if it must persist across mounts, or co-located as component state).

The "no cross-store imports" rule (R3) plus per-store explicit ownership prevents the workspace-as-junk-drawer pattern.

**Status of mitigation:** Designed. R3's tooling enforcement makes it stick.

---

### A5 — Components coupled to many stores

**v1.0 evidence:** `src/components/theater/AiBubble.tsx` (1,146 lines) imports from **seven** frontend stores: `workspaceStore`, `ghostwriterStore`, `imagePrompterStore`, `settingsStore`, `handoverStore`, `uiStore`, `branchMapStore`. Plus 9 functions from `tauriApi`.

A single "AI message bubble" component knows about ghostwriting, image prompting, handover synthesis, branch map navigation, API debug previews, and basic conversation. It is the natural product of features being bolted onto the bubble's context menu over time.

**v2.0 mitigation (partial):** The store partitioning (D-03) plus the Doc 09 component model puts shared bubble behavior into `theater/` and feature-specific behavior into hooks or sub-components. Doc 11 (Interaction Patterns) owns the right-click affordance set per bubble; new affordances are added via that doc, not by importing a new store into the bubble.

The remaining defence is convention: a component that imports more than ~3 stores is a smell. **R19 in backlog:** add a "max-3-stores per component" guideline to Doc 24.

**Status of mitigation:** Designed (D-03) + needs a convention (R19).

---

### A6 — `tauriApi.ts` and `types.ts` as monolithic single files

**v1.0 evidence:** `src/lib/tauriApi.ts` is 557 lines, 90 exports, single file. `src/lib/types.ts` is 363 lines, single file with all TS interfaces.

Both grow indefinitely as features are added; both have no logical sub-grouping in their shape; both make "find the wrapper for X" a search-by-name exercise.

**v2.0 mitigation:**
- Doc 06 splits `tauriApi/` into a folder, one file per backend domain (`auth.ts`, `vault.ts`, `conversation.ts`, `settings.ts`, `cache.ts`). Per-domain split mirrors the backend `commands/` layout.
- R4 in backlog: types are *generated* from Rust via `ts-rs`. `types.ts` becomes a build artefact; the human-edited source is the Rust struct.

**Status of mitigation:** Designed (per-domain split) + R4 (type generation, open).

---

### A7 — Stores per *feature*, not per *domain*

**v1.0 evidence:** 12 frontend stores: `accordionStore`, `authStore`, `branchMapStore`, `cacheStore`, `creatorStore`, `ghostwriterStore`, `handoverStore`, `imagePrompterStore`, `settingsStore`, `uiStore`, `vaultStore`, `workspaceStore`.

Six of these are feature-scoped (`accordionStore`, `branchMapStore`, `creatorStore`, `ghostwriterStore`, `handoverStore`, `imagePrompterStore`). They each hold a small amount of state for their feature. The split is along feature lines, which mirrors the feature-by-feature growth pattern.

The cost: every component that does anything story-adjacent imports from several of these (see A5). State that *should* live in a single domain store ends up fragmented.

**v2.0 mitigation:** D-03 + D-03-B. Seven stores along *domain* lines: `appStore`, `authStore`, `vaultStore`, `workspaceStore`, `settingsStore`, `modeStore`, `cacheStore`. Feature state belongs to a domain (e.g., ghostwriter state is workspace-scoped, lives in `workspaceStore`; or modal state lives in `appStore`).

If a future feature genuinely needs its own store (cache was the precedent — D-03-B), the pattern is "amend the decision," not "default to a new store."

**Status of mitigation:** Designed.

---

### A8 — Component mega-files

**v1.0 evidence:**

| Component | Lines | Why it's a problem |
|---|---|---|
| `SettingsModal.tsx` | 2,267 | All 8 settings tabs in one component |
| `RightPane.tsx` | 1,392 | All right-pane sections (cache, context docs, system instr, telemetry) in one |
| `AiBubble.tsx` | 1,146 | Bubble + ghostwriter UI + image prompter + handover entry + edit-in-place + diff renderer |
| `InputArea.tsx` | 963 | Three input fields + send + cancel + cache stale dot + context menus + drafts |
| `OnboardingWizard.tsx` | 793 | All wizard steps in one component |
| `VaultTreeNode.tsx` | 694 | Recursive tree + drag/drop + context menu + multi-select + rename in one |
| `UserBubble.tsx` | 657 | Bubble + edit-in-place + sibling nav + context menu |
| `Theater.tsx` | 645 | Layout + scroll + virtualization + transitions |
| `WorldPickerModal.tsx` | 620 | Cards + create form + delete confirm + edit form |
| `DocEditor.tsx` | 590 | Editor + toolbar + image insertion + autosave |

These files are each the size of a small library. Onboarding a new contributor requires reading thousands of lines to understand any one feature. Every change risks a merge conflict.

**v2.0 mitigation (designed):**
- Doc 09 (Component Library) defines small, composable primitives — the bubble visuals are not in `AiBubble.tsx` but in a primitive layer.
- Doc 10 (Layout) defines `<ControlPaneSection>` as the unit of right-pane composition; `RightPane.tsx` becomes ~50 lines that arranges sections.
- Doc 20 (Settings) — when written — should split each tab into its own component (`SettingsTabGemini.tsx`, `SettingsTabAppearance.tsx`, etc.) with `SettingsModal.tsx` as the chrome.

**v2.0 mitigation (proposed — R19 in backlog):**
- Add a "size budget" guideline to Doc 24: components > 400 lines warrant a structural review; > 600 needs justification. This is a soft rule, not a lint, but written down.

**Status of mitigation:** Designed + R19 needs to land in Doc 24.

---

### A9 — `LoomError` variant proliferation

**v1.0 evidence:** 22 `LoomError` variants. Many are over-specific:

```rust
WorldExists(String)             // could be Validation
MaxNestingDepth                 // could be Validation
ApiKeyMissing                   // could be Validation
GenerationCancelled             // explicit cancel — fine to keep, but separate IPC event makes it redundant
GenerationInProgress            // could be Validation
ImageGenProviderUnavailable     // could be Validation
ImageGenNotImplemented(String)  // could be Validation
CacheTooSmall                   // could be Validation
NoActiveConnection              // could be Validation
ConfigNotFound                  // could be Io
ConfigCorrupted(String)         // could be Crypto / Io
```

The `From<aes_gcm::Error>` impl maps any AES-GCM failure to `IncorrectPassword` — but AES-GCM can also fail on corrupt ciphertext, and that should not be reported as "wrong password."

**v2.0 mitigation:** Doc 05 has 9 generic variants (`Crypto`, `Database`, `NotFound`, `Validation`, `ApiError`, `RateLimited`, `Io`, `Serialization`, `Internal`). Doc 12 maps each variant to a display rule (toast, banner, modal). Specific cases that need bespoke copy are handled at the *display* layer, not the *error type* layer.

The downside: some context is lost (e.g., we can't pattern-match `LoomError::CacheTooSmall` in the frontend). But Doc 12's mapping table can branch on `error_detail` text or use a `kind: 'cache_too_small'` field on a structured `Validation` payload if needed.

**Trade-off accepted in v2.0.** Re-evaluate if the display layer needs branching that text-matching can't cleanly support.

**Status of mitigation:** Designed.

---

### A10 — Schema migration as heuristic patches

**v1.0 evidence:** `db.rs:272 — migrate_dev_schema()`. Excerpt:

```rust
// Phase 16: remove the legacy `img_gen_model_name` seed row from worlds
// created before the agnostic image-generation groundwork landed.
let _ = conn.execute("DELETE FROM settings WHERE key = 'img_gen_model_name'", []);

// Check if messages table has the old content_type constraint (Phase 4 schema had 'text','image')
let table_sql: Option<String> = conn.query_row(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'",
    [], |row| row.get(0)).ok();

if let Some(sql) = table_sql {
    if sql.contains("'image'") || !sql.contains("'json_user'") {
        // Old schema — drop and let init_schema recreate it
        // Messages table should be empty at this development stage
```

Migrations are detected by inspecting `sqlite_master.sql` for substring patterns. Some migrations DROP tables with the comment "should be empty at this development stage." Each "Phase" appended new patches. There is no version number, no idempotency guarantee, no rollback.

The function name (`migrate_dev_schema`) acknowledges this is dev-time-only.

**v2.0 mitigation (gap — R18 in backlog):** v2.0 starts clean (per Doc 03, no migration from v1.0 required). But once v2.0 ships, every schema change needs a real migration — a versioned, append-only migration system (e.g., `refinery`, `sqlx::migrate!`, or a hand-rolled equivalent). A `schema_version` table tracks the highest applied version; each migration is a numbered SQL file run exactly once in order.

**Status of mitigation:** Open. Doc 03 §Migration is a one-line note ("clean rewrite, no migration required"). For going-forward changes after v2.0 ships, R18 is needed.

---

### A11 — Magic strings everywhere

**v1.0 evidence:**

- Settings keys: `'static_system_instruction'`, `'active_si_slot'`, `'system_instructions'`, `'system_instructions_2'`, `'wi_model_ack'`, `'text_model_name'`, etc. (45 raw SELECT occurrences).
- Model names hardcoded as fallbacks: `"gemini-2.5-flash"` in `lib.rs:640` and others.
- Mode names: `"normal"`, `"handover"` as raw string comparisons in history filtering (the `kind` column).
- Finish reasons: `"STOP"`, `"MAX_TOKENS"`, etc. as raw strings.
- Item types: `"Story"`, `"Folder"`, `"SourceDocument"`, `"Image"` as strings.

Any typo silently fails. Any rename requires global search-and-replace across multiple languages (Rust + TS).

**v2.0 mitigation:**
- R2 (typed `AppSettingKey` / `StoryStateKey` enums).
- Rust enums with `serde(rename_all = "snake_case")` for `MessageRole`, `ContentType`, `MessageKind`, `FinishReason`, `ItemType`, `AppMode`. Frontend gets typed strings via R4 (ts-rs).
- Constants module for fallback model name etc.

**Status of mitigation:** Designed (R2, R4 cover most). A `services/constants.rs` for runtime constants is implicit but should be explicit in Doc 24.

---

### A12 — Cancellation as `Mutex<Option<watch::Sender<bool>>>` with no lifecycle spec

**v1.0 evidence:** `state.rs` defines `cancel_tx: Mutex<Option<tokio::sync::watch::Sender<bool>>>`. `send_message` (lib.rs:555+) creates a watch channel per request. Cancellation is signalled via `watch::Sender::send(true)`. There is no documented invariant about leakage between requests — and we know v1.0 had bugs here (per the context in MEMORY.md, the v1.0 cache prototype had to work around `reqwest` stream drop not actually cancelling the HTTP connection).

**v2.0 mitigation (open — R7 in backlog):** Spec a per-request `tokio_util::CancellationToken`. Document the lifecycle: created at start of request, stored in AppState for that request only, replaced on next request, dropped on completion. Cancel signal can never leak.

**Status of mitigation:** Open. R7 in IMPROVEMENT-BACKLOG.md.

---

### A13 — `cache.rs` as a half-migrated example of v2's pattern

**v1.0 evidence:** The most recent v1.0 module, `src-tauri/src/cache.rs` (828 lines), partially follows the v2 pattern that was emerging at the time:
- Has its own typed accessors for cache state (`read_cache_state`, `write_cache_state`).
- Has its own HTTP client functions (`api_create_cache`, `api_refresh_ttl`, `api_delete_cache`).
- Hosts its own 4 Tauri commands (rather than putting them in `lib.rs` like every other phase).

**The good:** This is closer to v2's `commands/cache.rs` + `services/cache.rs` split than anything else in v1.0.

**The bad:** It's an island. Every other domain still has commands in `lib.rs` — only cache lives apart. Inconsistent. A new contributor has no clear pattern to follow.

**Lesson for v2:** Pick the pattern from day one. The v1.0 cache module shows the pattern works; v2 must apply it everywhere or not at all.

**Status of mitigation:** Designed (D-04 applies the pattern uniformly).

---

## New backlog items surfaced by this audit

These have been added (or should be added) to `IMPROVEMENT-BACKLOG.md`:

- **R17 — Mutex-access helper.** Eliminate the 118-occurrence `lock().map_err(…)` boilerplate via a single helper or macro. Address before re-implementing any command.
- **R18 — Versioned schema migration system.** v2.0 starts clean, but the going-forward migration story is unspec'd. Use `refinery`, `sqlx::migrate!`, or a hand-rolled `schema_version` table. Required before v2.0 ships its first post-1.0 schema change.
- **R19 — Component size budget.** Add a soft rule to Doc 24: components > 400 lines warrant review; > 600 requires justification. Prevents `SettingsModal`-class mega-files.

---

## Big picture — does v2.0 actually solve v1.0's problems?

| v1.0 pain point | v2.0 mitigation | Confidence |
|---|---|---|
| 3,379-line `lib.rs` with 87 commands | D-04 layering, "lib.rs is registration only" | High — strict rule |
| Sprawling stores (workspaceStore-as-junk-drawer) | D-03 explicit ownership; "no cross-store imports" with tooling (R3) | High once R3 lands |
| 12 feature-scoped stores | D-03 7-store domain partitioning | High |
| 45 raw settings SQL queries | R2 typed accessors | Conditional — requires R2 to be implemented before any command |
| 118 lock-and-format-error idioms | R17 helper | Conditional — requires R17 |
| `tauriApi.ts` / `types.ts` monolithic | Per-domain split + R4 type generation | High once R4 lands |
| Component mega-files | Doc 09/10 primitives + R19 size budget | Medium — needs convention discipline |
| Magic strings | R2 + Rust enums + R4 type generation | High once these land |
| Heuristic schema migration | R18 versioned migrations | Open |
| Cancellation lifecycle drift | R7 spec | Conditional |
| `LoomError` variant explosion | Doc 05 9-variant set + Doc 12 display mapping | Medium — display layer must compensate |
| Inconsistent module pattern (`cache.rs` island) | D-04 applied uniformly | High |

**Net assessment:** v2.0's *design* addresses essentially every v1.0 pain point. The risk is in *execution*: most mitigations are rules and conventions, not load-bearing structural choices. R3 (lint enforcement), R2 + R4 (typed access + generation), R17 (lock helper), R18 (migrations) all need to land before — or in the very first sessions of — implementation, otherwise the patterns from v1.0 will start to creep back in.

The single largest risk is **v1.0-style "phase comments" reappearing in v2.0.** They are the smell that proves features were appended without architectural refactor. Code review should reject any `// Phase X` style comment in v2.0.

---

## Note for implementation phase start

When the first implementation session begins (after Modes/caching planning concludes):

1. Land the tooling first: ESLint store-boundary rule (R3), `ts-rs` for type generation (R4), the lock helper (R17), the `AppSettingKey` / `StoryStateKey` enums (R2). These take a session to set up and pay back forever.
2. Then implement the substrate: `db/`, `security/`, `state.rs`, `error.rs`, `services/settings.rs`, `services/rate_limiter.rs`. Each in its own commit so the layering shows in history.
3. Then domains in dependency order: auth → vault → conversation → settings → cache → modes.
4. Doc 24 (coding standards) and Doc 25 (testing strategy) should be drafted alongside the substrate work, not after — they constrain the substrate.

Resist the pull to ship a feature before the substrate is solid. v1.0's pain came almost entirely from this trade made over and over; the goal of v2.0 is to make that trade unavailable.
