# LOOM 2.0 — Improvement Backlog

> **Purpose:** Maintainability and quality items surfaced during the 2026-04-28 mid-planning review.
> Distinct from `TODO.md` (open design questions blocking docs) and `IMPL-NOTES.md` (decisions deferred to implementation time).
> This file is a backlog: each entry is actionable, owned, and resolves to a doc edit, a tooling change, or a new file.

When an item is acted on, mark it resolved with a date and reference the commit / doc / PR.

---

## R1 — Lock down Modes before any further feature doc

**Problem:** `messages.kind`, `cache_state.mode`, `story_state.active_mode`, `modeStore.activeMode`, and the request-shape variation per mode all pivot on Doc 23 (Modes), which is a stub. The caching session already hit O1 (a structural conflict) directly because of this. Until Doc 23 is locked, Doc 22 (Caching) and Doc 16 (Accordion) can't be finalised — they both depend on which messages, segments, and SI variants belong in which mode's request.

**Action:** schedule a Doc 23 design session as the next planning unit. Resolve consulting Q1–Q6 (TODO.md), pick one of (a)/(b)/(c) for caching O1, then draft Doc 23 in full.

**Status:** Open

---

## R2 — Type the key-value tables

**Problem:** `app_settings` and `story_state` are `(key TEXT, value TEXT)` tables. Doc 03 documents the known keys, but nothing in code enforces that. Any contributor can add a key without updating the table; any consumer can `get_app_setting("typo_key")` and get an empty string. Drift grows linearly with codebase age.

**Action:** in `services/settings.rs` (or a dedicated `settings_keys.rs`), define enums:

```rust
pub enum AppSettingKey {
    ApiKey,
    TextModelName,
    GenTemperature, GenTopP, GenTopK, GenMaxOutputTokens,
    AccentColor, BodyFont, AutoLockSecs,
    RateLimitRpm, RateLimitTpm, RateLimitRpd,
    ContextTokenLimit,
    CacheTtlSecs, CacheMinTokens,
    StorySi, HandoverSi, ConsultingSi,
    AuxSlot1Name, AuxSlot1Content, AuxSlot2Name, AuxSlot2Content,
    ModificatorPresets,
    PromptGhostwriter, PromptAccordionSummarise, PromptAccordionFakeUser,
    // image / audio provider keys
}

pub enum StoryStateKey {
    ContextDocIds,
    ActiveMode,
    ActiveAuxSlot,
    Draft,
}
```

Each variant has `as_str() -> &'static str` (the DB column key) and `default_value() -> &'static str`. Typed accessors (`get_app_setting<T>`, `set_app_setting<T>`) take the enum, never a string. The known-keys tables in Doc 03 become the enum's source of truth and the per-variant doc-comment explains its purpose.

Stringly-typed K/V access is forbidden in code review.

**Status:** **Spec'd in Doc 24 §Settings Access (2026-05-04, SB-1)** — typed enums, accessors, and grep-gate established. Code lands in Phase 0.

---

## R3 — Enforce "no cross-store imports" with tooling

**Problem:** Doc 06 says stores never import each other. Currently enforced by convention. Six months in, someone will do it; reviewers will miss it; the next contributor will copy the pattern.

**Action:** add an ESLint rule in `dev/24-coding-standards.md` and the project's `.eslintrc`:

```js
'import/no-restricted-paths': ['error', {
  zones: [
    {
      target: 'src/stores/*Store.ts',
      from: 'src/stores',
      except: ['./[same-store-file]'],
      message: 'Stores must not import each other. Compose in components or hooks.',
    },
  ],
}]
```

Bake into `pnpm lint` and CI. One-time setup; pays back forever.

**Status:** **Closed (2026-05-04).** Doc 24 §No Cross-Store Imports (SB-2) is the rule home; ESLint config snippet inline. Closed in `Resolution Log`.

---

## R4 — Generate TS types from Rust structs

**Problem:** Doc 03's TypeScript interfaces and the Rust structs in `db/`, `services/`, and IPC payloads are written by hand. They will drift the moment the schema changes.

**Action:** adopt `ts-rs` (or `specta`) to derive TypeScript types from Rust at build time. Rust struct becomes the single source of truth; `src/lib/types.ts` is generated.

```rust
#[derive(Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct ChatMessage { /* ... */ }
```

A small build script generates `types.ts` and is wired into `pnpm dev`. Doc 03 documents the canonical Rust shape; TS readers see the generated file.

**Status:** **Spec'd in Doc 24 §Type Generation (2026-05-04, SB-3)** — `ts-rs` derive on every IPC type; `types.ts` committed; CI drift-check gate. Code lands in Phase 0.

---

## R5 — Doc 07 ↔ feature doc signature drift policy

**Problem:** Doc 07 indexes commands; feature docs hold authoritative signatures. There's no automated check that a signature change in a feature doc is mirrored in Doc 07.

**Action (lightweight, immediate):** add to Doc 24 (coding standards) the rule "any change to a `#[tauri::command]` signature requires updating both the feature doc and Doc 07's table row in the same PR." Add a PR-template checklist line.

**Action (heavier, deferred):** consider generating Doc 07's tables from `#[tauri::command]` macros at build time. Defer until v2.0 is shipped.

**Status:** **Closed (lightweight, 2026-05-04).** Doc 24 §Tauri Command Discipline ("signature-drift policy") + PR-template checklist line landed. Heavyweight automation remains deferred. Closed in `Resolution Log`.

---

## R6 — Centralise the streaming pattern in Doc 06

**Problem:** Doc 15 describes streaming as "frontend appends chunks to in-memory tail message via `message_chunk`, then reloads on `message_complete`." This is the canonical pattern but lives only in Doc 15. Doc 17 (Ghostwriter) and any future streaming feature will re-invent it inconsistently if it stays buried.

**Action:** add a "Streaming Pattern" section to Doc 06 (Frontend Architecture). One subsection covering: optimistic placeholder → chunk listener → store reducer → final reconciliation on completion event → error path. Reference it from Doc 15 and any future streaming feature.

**Status:** Open

---

## R7 — Specify cancellation token lifecycle

**Problem:** `AppState.cancel_tx: Mutex<Option<watch::Sender<bool>>>` exists but the lifecycle (per-request? global? when replaced?) is not stated in Doc 04 or Doc 05. Open questions:
- Is a new token created per `send_message`, or is one global token toggled on cancel?
- Can a cancel signal leak from a cancelled request to the next request?
- Does the fire-and-forget TTL refresh share the token?

**Action:** add a "Cancellation Lifecycle" subsection to Doc 05 (Backend Modules). Recommended model:
- Per-request `tokio_util::CancellationToken`, created at the start of `send_message` and stored in `AppState.cancel_tx` for the duration.
- `cancel_generation` triggers the stored token's cancel.
- On request completion (any termination path), the token is dropped from `AppState`.
- Background tasks (TTL refresh) get their own short-lived tokens, tied to that task's lifetime.

Document the "next request creates a fresh token; cancel of the old one is a no-op on the new" invariant explicitly.

**Status:** Open

---

## R8 — Resolve settings cascade fallback location

**Problem:** Doc 03 cascade is "world override → app default (DB row) → hardcoded fallback (Rust constant)." This implies two sources of "what is the default": a DB row that may or may not exist, and a Rust constant that always exists. If we change a constant but the DB row was pre-populated, the change has no effect for existing users.

**Action:** pick one strategy and document it in Doc 03 explicitly:

- **Option (a) — recommended:** Never pre-populate DB rows for defaults. App defaults always come from Rust constants (returned by `AppSettingKey::default_value()` per R2). DB rows in `app_settings` only exist when a writer has explicitly changed a value. Cascade simplifies to `world override → app override → constant`. "Reset to default" is a single DELETE.
- **Option (b):** Always pre-populate. Constants only exist as the seed values for migrations. Then the cascade is `world override → app row → (no fallback needed)`.

**Recommendation: (a).** It removes the constant/row drift surface entirely and keeps the DB clean (only meaningful overrides exist there).

**Status:** Open

---

## R9 — Add happy-path walkthroughs

**Problem:** The docs describe what each piece does. They do not describe end-to-end traces. A new contributor lacks the narrative they need to onboard.

**Action:** create `architecture/04A-walkthroughs.md` (or a §"Walkthroughs" in Doc 04). Three traces, ~150–300 lines total:

1. **First send of the day.** Onboarding-complete + locked → unlock → world picker → story open → type plot direction → Send → ... → streamed response in the Theater. List every file touched, in order, with one-line annotations.
2. **Edit + regenerate.** From right-click on a user bubble to the new model response replacing everything after.
3. **World switch with active generation.** From World Picker click to confirmation modal to cancel-and-swap to vault tree reload.

Each trace is a numbered list of files + actions. Useful both as onboarding and as a sanity check on the architecture.

**Status:** Open

---

## R10 — Cache_state schema cleanup post-O1

**Problem:** Doc 03 has `cache_state` PK as `(story_id, mode)`. Doc 22 working notes conclude one cache per story is the model — `mode` should drop. Until O1 (TODO.md) resolves, the docs disagree.

**Action:** when caching session resumes, fix Doc 03's `cache_state` schema in the same PR that finalises Doc 22. Drop the `mode` column, add `last_cached_message_id` and `total_token_count`. PK becomes `story_id` alone.

**Status:** Open. Blocked on O1.

---

## R11 — Doc 13 ↔ Doc 15 reconciliation

**Problem:** Doc 15 specifies that `lock_vault` awaits any pending debounced draft write before zeroing keys. Doc 13 was written before Doc 15 and likely doesn't mention this. If the two disagree, a writer who locks while typing risks losing the in-progress draft.

**Action:** read Doc 13 §lock_vault. Add the await-pending-draft step if missing. Same audit for any other Doc 15 → Doc 13 dependency surfaced during this review.

**Status:** Open

---

## R12 — Draft Doc 25 (testing strategy) early

**Problem:** Stub. v2.0 prioritises quality but has no test plan.

**Action:** when ready, draft Doc 25 with three layers:
- **Unit:** `services/history.rs` (assembly), `services/rate_limiter.rs` (window math), `security/crypto.rs` (PBKDF2 + sentinel), `services/settings.rs` (cascade).
- **Integration:** in-memory SQLite (non-encrypted) + mocked Gemini, exercising send_message → message_chunk → message_complete end-to-end. Per-mode variants.
- **E2E:** Tauri webdriver tests for golden paths: onboarding → first send → edit → regenerate → cancel → mode switch → world switch → lock.

Tag invariants from completed feature docs with which layer covers them.

**Status:** Open

---

## R13 — Draft Doc 24 (coding standards) early

**Problem:** Stub. Many discipline rules (lock ordering, error handling, IPC wrappers, log content rules, store boundaries) are spread across feature/architecture docs. They need a single home where the implementer can consult them.

**Action:** draft Doc 24 collecting:
- Rust: edition, no `.unwrap()` in production, lock ordering rule, `LoomError` mapping requirement, `safecommand!` macro usage, `#[tauri::command]` signature rules.
- TypeScript: strict mode, no `any`, store boundary rule (R3), tauriApi wrapper rule, Zustand selector rule.
- CSS: token-only, no hardcoded hex, no inline styles in components.
- Logging: never log content; log only IDs and metadata.
- Pre-commit: clippy + tsc + eslint + prettier.
- Commit messages: format, scope tags.

Cross-link from each rule's source doc.

**Status:** **Closed (2026-05-04).** Doc 24 written end-to-end per D-18; covers all listed items plus 13-entry v1.0 anti-pattern appendix. Closed in `Resolution Log`.

---

## R14 — `app_settings.db` connection lifetime — be explicit

**Problem:** Doc 05 says "open for full session." Implicit but not stated: this means the *vault-unlocked* session (`app_settings.db` is encrypted with the master key; can't be open while locked).

**Action:** add a sentence to Doc 05 §AppState: *"`settings_conn` is opened on vault unlock and closed on lock, identically to `active_conn`. It is never open while the master key is zeroed."*

**Status:** Open. Trivial edit.

---

## R15 — Confirm Markdown subset in Doc 09

**Problem:** Doc 15 punts Markdown rendering to Doc 09 (Component Library). Doc 09 may not actually specify the subset (headings? tables? code? footnotes?) or how user-typed Markdown in input fields is treated (literal vs. parsed).

**Action:** read Doc 09. If the Markdown subset is missing, add a small section listing the supported features and the rendering strategy for each (e.g., "ATX headings yes; setext no; tables no; fenced code blocks yes (no syntax highlighting); inline code yes; bold/italic/strikethrough yes; lists yes; blockquotes yes; horizontal rules yes; images no").

**Status:** Open

---

## R16 — Rate limiter window semantics

**Problem:** `telemetry.window_start_min` and `window_start_day` are documented in Doc 03 but the reset / rollover semantics aren't specified anywhere I've seen. Sliding window? Fixed window? When does a new window start?

**Action:** when Doc 06 (or whichever doc owns rate limiting in v2 — possibly Doc 15 §Rate Limiting could host this) is touched next, add a clear definition. Recommended: fixed-window — when current time crosses `window_start_min + 60s`, reset count and update `window_start_min` to the new minute boundary. Same for daily.

**Status:** Open

---

## R17 — Mutex-access helper to eliminate `lock().map_err(...)` boilerplate

**Problem (surfaced by V1-LESSONS A3):** v1.0 has 118 occurrences of the same four-line idiom across `lib.rs`, `cache.rs`, and `world.rs`:

```rust
let conn_guard = state.active_conn.lock().map_err(|e| {
    LoomError::Internal(format!("Failed to lock connection: {}", e))
})?;
let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
```

Across 87 commands, this is hundreds of lines of pure boilerplate. It also makes the lock-ordering rule (Doc 05) harder to enforce by inspection — the boilerplate hides the access pattern.

**Action:** add a small helper module `state/access.rs` (or similar) with one function per AppState mutex:

```rust
pub fn with_active_conn<T>(
    state: &AppState,
    f: impl FnOnce(&Connection) -> Result<T, LoomError>,
) -> Result<T, LoomError> {
    let guard = state.active_conn.lock()
        .map_err(|_| LoomError::Internal("active_conn mutex poisoned".into()))?;
    let conn = guard.as_ref().ok_or_else(|| LoomError::Validation("vault is locked".into()))?;
    f(conn)
}
```

Same for `master_key`, `api_key`, `settings_conn`, `cancel_tx`. Commands call these helpers; never touch `state.X.lock()` directly. Lock-ordering rule becomes a property of the helpers — they can be the only place that takes more than one lock.

Land this **before** the first command is implemented. Retrofitting later is the path that produces 118-occurrence boilerplate.

**Status:** **Spec'd in Doc 24 §AppState Access (2026-05-04, SB-5)** — raw `.lock()` on AppState fields forbidden outside `state/access.rs`; helper family enumerated. Full helper signatures land in a follow-up Doc 05 amendment; code lands in Phase 0.

---

## R18 — Versioned schema migration system

**Problem (surfaced by V1-LESSONS A10):** v1.0's `migrate_dev_schema()` detects schema versions by inspecting `sqlite_master.sql` for substring patterns and applies phase-specific patches. It is explicitly dev-only ("Messages table should be empty at this development stage"). v2.0 starts clean per Doc 03, but every post-v2.0 schema change still needs a real migration story.

**Action:** adopt a versioned migrations approach.

**Recommended:** a `schema_migrations` table:

```sql
CREATE TABLE schema_migrations (
    version    INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL,
    name       TEXT NOT NULL
);
```

Migrations live as numbered files: `db/migrations/001_initial.sql`, `002_add_undo_log.sql`, etc. On `open_world_db`, query `MAX(version)` from `schema_migrations`, run all higher-numbered migrations in order, record each. Append-only — never edit a shipped migration.

**Alternative:** `refinery` or `sqlx::migrate!` if it integrates cleanly with `rusqlite` + SQLCipher.

**v2.0 launch:** the initial schema is migration `001`. From there, every change is a new file.

This must land **before v2.0's first post-launch schema change**, not after.

**Status:** **Spec'd in Doc 24 §Schema Migrations (2026-05-04, SB-6)** — numbered SQL files under `db/migrations/world/` and `db/migrations/app/`; `schema_migrations` table per DB; append-only rule. Doc 03 §Migration update lands alongside Phase 0 code.

---

## R19 — Component size budget convention

**Problem (surfaced by V1-LESSONS A8):** v1.0 has ten components over 600 lines, including `SettingsModal.tsx` at 2,267 and `RightPane.tsx` at 1,392. These mega-files block onboarding and create constant merge conflicts.

**Action:** add a soft rule to Doc 24:

> **Component size budget.** Components over 400 lines warrant a structural review during code review (likely a sign of mixed concerns or a missing primitive). Components over 600 lines require explicit justification in the PR description. There is no hard ceiling, but a 1,000-line component is almost certainly hiding 3+ smaller components or a state-machine that wants its own hook.

Heuristics that often resolve oversize components:
- A modal with multiple tabs → one component per tab.
- A pane composing multiple sections → one component per section.
- A bubble with many feature integrations → feature-specific affordances move into hooks (`useGhostwriter`, `useImagePrompter`, etc.).
- A wizard with multiple steps → one component per step.
- A tree-row with rename / drag / context-menu / multi-select → primitives composed.

**Status:** **Closed (2026-05-04).** Doc 24 §Component Rules / §Component size budget landed as ⚪ Convention; max-stores-per-component ⚪ smell rule also landed. Closed in `Resolution Log`.

---

## Resolution Log

- **2026-05-04 — R3 closed.** Doc 24 §No Cross-Store Imports (SB-2) is the rule home; ESLint `import/no-restricted-paths` config snippet inline; CI fails on violation.
- **2026-05-04 — R5 closed (lightweight).** Doc 24 §Tauri Command Discipline ("signature-drift policy") + `.github/pull_request_template.md` checklist line. Heavyweight build-time automation remains deferred until post-v2.0.
- **2026-05-04 — R13 closed.** Doc 24 written end-to-end per D-18 — covers Rust / TypeScript / CSS / build / commit / review surface plus 13-entry v1.0 anti-pattern appendix.
- **2026-05-04 — R19 closed.** Doc 24 §Component Rules — size budget (> 400 review, > 600 justify, no hard ceiling) + max-stores-per-component (> 3 smell) both landed as ⚪ Convention tier.
- **2026-05-04 — R2, R4, R17, R18 spec'd.** Doc 24 §Settings Access (SB-1), §Type Generation (SB-3), §AppState Access (SB-5), §Schema Migrations (SB-6) all establish the rule and the shape; code lands in Phase 0 substrate session and closes the SB-N items at that point.

---

## Process

- Add a new entry when a maintainability/quality item is identified during planning or implementation.
- Mark items resolved with a date and reference the doc / commit / PR that closed them.
- An item that turns out to be a real design question (not just an implementation note) is moved to TODO.md.
- An item that's a deferred-decision-already-decided (just needs implementation) is moved to IMPL-NOTES.md.
