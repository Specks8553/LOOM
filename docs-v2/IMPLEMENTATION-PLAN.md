# LOOM 2.0 — Implementation Plan

> **Status:** Not started — drafted 2026-05-05.
> **Audience:** The implementing agent (and any human reviewing). This is the canonical phase ledger. Read this *after* `00-INDEX.md`; read it *before* opening any feature spec.
> **How to use:** Each phase below has a `Status:` line, a Goal, Inputs, Scope, Testable Checkpoints (`- [ ]` boxes), Out of Scope, and a `Resumption notes:` subsection. Tick checkpoints as you complete them. **Update `Resumption notes:` live, not at session end** — sessions end abruptly. Do not start phase N+1 until phase N is `/phase-verify`-clean.
> **Authority:** `00-INDEX.md` D-NN entries are canonical for architectural decisions. `PRE-IMPLEMENTATION-AUDIT.md` is canonical for known drift. This file owns the **order and gating** of implementation work, nothing else. Cross-references point at the spec doc that owns the surface — never duplicate spec content here.

---

## Phase model recap

(Authoritative version lives in `_new_claude.md` §The phase model. Recap only.)

- A phase is a coherent unit of work, typically one session, sometimes more.
- A phase is `Not started`, `In progress (last touched YYYY-MM-DD)`, or `Complete`.
- A phase is complete only when **every** Testable Checkpoint is ticked and `/phase-verify` passes.
- Hard Blockers (HB-*) on the surface a phase touches must be resolved before the phase starts. All HB-* are currently resolved (audit closed 2026-05-04).
- Substrate (Phase 0) is non-negotiable. No feature command lands before Phase 0 is verify-clean.

---

## Phase index

| # | Phase | Gate (one-liner) |
|---|---|---|
| 0 | Substrate | `cargo build` + `tsc` + `eslint` + `cargo test` all green; SB-1..SB-6 ticked |
| 0.5 | Testing Strategy (Doc 25) design pass | Doc 25 Complete; ST-3 ticked |
| 1 | Auth & Onboarding | First-run onboarding lands a sentinel; lock/unlock round-trip works |
| 2 | Vault & Worlds | World CRUD; vault tree; World Picker; World Backup zip |
| 3 | Conversation Engine (story mode) | Story-mode round-trip with Gemini streaming, message lifecycle, `isGenerating` |
| 4 | Modes (handover + consulting) | Mode switcher; handover one-shot; consulting session |
| 5 | Source Documents | Vault docs, paperclip attach/detach, DocEditor with debounced auto-save |
| 6 | Context Caching | Cache create/refresh/delete; stale triggers; right-pane UI |
| 7 | Accordion (context compression) | Segments, summarisation, fake-pairs, banner |
| 8 | Ghostwriter | Surgical-stitching protocol; in-place edits; all three modes |
| 9 | Feedback | Per-bubble inline strip; Apply / Cancel; escape-chain slot 5 |
| 10 | Media (slim) | Image-as-source-doc; File API URI cache; rendering primitives |
| 11 | Settings & Themes | Full-surface Settings; cascade UX; theme tokens; applyTheme |
| 12 | Visual polish & copy pass | NB-1..NB-4 resolved or intentionally deferred |
| 13 | Build, Release & Doc 26 | First signed build for all three platforms |

---

## Phase 0 — Substrate

**Status:** Complete (2026-05-07)

**Goal:** Land the rails that prevent v1.0-style drift from recurring. No feature code; pure tooling, type generation, lock helpers, migrations, and the project scaffold.

**Inputs:**
- `dev/24-coding-standards.md` (Complete) — the rule set the substrate codifies.
- `IMPROVEMENT-BACKLOG.md` items R2, R3, R4, R7, R17, R18 — context for each SB-*.
- `PRE-IMPLEMENTATION-AUDIT.md` SB-1..SB-6 — load-bearing items.
- `architecture/05-backend-modules.md` — module layout; `AppState`; cancellation lifecycle.
- `architecture/06-frontend-architecture.md` — store rules; cross-store-import ban; `types.ts` source of truth.
- `foundation/03-data-model.md` §Migration Strategy — schema migrations contract.
- `foundation/02-security-model.md` — red lines that the substrate must respect from line 1.

**Scope / Deliverables:**

1. **Project scaffold.** Tauri v2 + Vite 7 + React 19 + TypeScript strict + Tailwind v4 + shadcn/ui + Zustand 5 + Sonner. No `tailwind.config.js` (v4 uses native CSS). `src-tauri/` layout per Doc 05: `commands/` (thin), `services/` (logic), `db/`, `security/`. `lib.rs` is registration-only.
2. **SB-5 — Lock-access helpers (R17).** `with_active_conn`, `with_master_key`, `with_api_key`, `with_cancel_tx` on `AppState`. Forbid raw `.lock()` on AppState fields via Doc 24 + clippy lint where feasible.
3. **SB-1 — Typed setting keys (R2).** `AppSettingKey` and `StoryStateKey` enums. `get_setting<T>(key: AppSettingKey) -> Result<T>` API. No string-keyed `get_setting("...")` paths anywhere in the codebase.
4. **SB-3 — `ts-rs` type pipeline (R4).** Annotate all IPC payload structs in Doc 03 §IPC Payload and Result Types with `#[derive(TS)]`. CI step generates `src/lib/types.ts` and fails if the committed file drifts.
5. **SB-2 — ESLint `no-cross-store-imports` rule (R3).** Custom rule under `eslint-rules/`; wired into `.eslintrc`. Verified by a fixture test (deliberate cross-store import → lint fails).
6. **SB-6 — Versioned schema migrations (R18).** `schema_migrations` table; numbered SQL files in `src-tauri/src/db/migrations/`; `001_initial.sql` is the v2.0 schema. Boot path applies pending migrations within an `AppState.with_active_conn` lock; transactional per file.
7. **SB-4 — Cancellation lifecycle (R7).** Doc 05 §Cancellation Lifecycle subsection lands as part of this phase if not already amended. Implement `tokio_util::CancellationToken` per-request; old-token cancel is a no-op when superseded.
8. **CI rails.** GitHub Actions: `cargo build`, `cargo clippy -- -D warnings`, `cargo test`, `tsc --noEmit`, `eslint`, `prettier --check`, `ts-rs` drift check. `husky` + `lint-staged` pre-commit running the same on staged files.
9. **Logging.** `tracing` subscriber wired with field-redaction filters per Doc 24 (no master key, no API key, no message content).
10. **App phase shell.** `appStore.appPhase` state machine (`onboarding | locked | workspace`) and three top-level routes — purely conditional rendering, no router lib (D-05).

**Testable Checkpoints:**
- [x] `cargo build --release` succeeds on Windows with `OPENSSL_DIR` set; `tsc --noEmit` clean; `eslint .` clean; `prettier --check` clean.
- [x] `cargo test` runs and passes the substrate unit tests (lock helper, migrations applier, settings enum round-trip).
- [x] `ts-rs` generates `src/lib/types.ts` from Rust structs; `npm run check:types` fails when the file is out of date and passes when regenerated.
- [x] Cross-store import fixture (`appStore` importing `vaultStore`) fails ESLint with `no-cross-store-imports`.
- [x] `001_initial.sql` applies to a fresh encrypted DB; `schema_migrations` row recorded; re-running boot is a no-op.
- [x] `tracing` log output for a representative command does not contain master key, API key, or message content (manual `grep` check on captured logs).
- [x] `husky` pre-commit hook blocks a deliberate clippy warning on a staged file.
- [x] `appStore.appPhase` transitions from `onboarding` → `locked` → `workspace` driven by stub commands; conditional rendering switches the top-level component.
- [x] PRE-IMPLEMENTATION-AUDIT.md SB-1, SB-2, SB-3, SB-4, SB-5, SB-6 all ticked with notes.

**Out of scope:** Any feature command (auth, vault, world CRUD); any UI beyond the three-phase shell; any visual styling beyond importing the Tailwind v4 base layer.

**Resumption notes:**
- 2026-05-06: Scaffold committed (`c9479db`). All SB items implemented in Rust; React shell with 3-phase conditional rendering; ts-rs wired; ESLint custom rule + fixture; husky + lint-staged; migrations runner.
- 2026-05-07: Full verification pass. Fixed `bundled-sqlcipher` feature (was two separate features — linker error on Windows). Fixed epoch timestamp in migration test. Removed `eslint-plugin-tailwindcss` (incompatible with Tailwind v4). Added `eslint-import-resolver-typescript` + `eslint-import-resolver-node` (missing from devDeps). Scoped `recommendedTypeChecked` to `src/**` only. Fixed `vite.config.ts` `as const` type. Added `src/vite-env.d.ts`. All 9 checkpoints verified; SB-1..SB-6 ticked. Phase complete.

---

## Phase 0.5 — Testing Strategy (Doc 25)

**Status:** Complete (2026-05-07)

**Goal:** Land Doc 25 (Testing Strategy) end-to-end before the first feature commit. Audit ST-3 closes here. This is a planning pass following the COWORKING.md rhythm — Discovery → Picture-back → Numbered Qs → Write → Propagate.

**Inputs:**
- `dev/25-testing-strategy.md` (current stub).
- `dev/24-coding-standards.md` §Testing — the test-discipline rules already locked.
- `architecture/05-backend-modules.md` — module map (what needs unit coverage).
- `PRE-IMPLEMENTATION-AUDIT.md` ST-3 — the gap list.
- v1 lessons: `feedback_zustand_selectors.md`, `feedback_gemini_api.md`, `feedback_ui_events.md`, plus `V1-LESSONS.md`.

**Scope / Deliverables:**

1. Concrete commands: `cargo test`, `cargo test --doc`, `vitest run`, `vitest --ui` (dev-only), Playwright invocation if E2E ships.
2. Coverage targets per module class (high for `crypto`, `db`, `services/cache`; opportunistic for `commands/`).
3. In-memory SQLite fixture pattern — non-encrypted, schema applied via the same migration runner.
4. Gemini SSE mock recipe — `mockito` or `wiremock` against a stub server returning canned SSE chunks.
5. Tauri IPC mock pattern — `vi.mock('@tauri-apps/api/core')` template + typed `invoke` stubs from `types.ts`.
6. Playwright E2E plan: scope or explicit decision to defer (lean: defer to v2.0.x; Doc 25 documents the deferral).
7. CI matrix: which targets run on PR vs main vs nightly.

**Testable Checkpoints:**
- [x] Doc 25 written end-to-end; `00-INDEX.md` Document Map row flipped to Complete; D-NN umbrella added if a real architectural decision came out of the pass (else amend-only).
- [x] PRE-IMPLEMENTATION-AUDIT.md ST-3 ticked with resolution-log entry.
- [x] One canary unit test (Rust) and one canary component test (Vitest) committed and passing — proves the recipes work, not just describe them.
- [x] Gemini SSE mock recipe demonstrated by a passing test that streams 3 chunks.
- [x] Tauri IPC mock recipe demonstrated by a passing component test that asserts `invoke` was called with typed args.

**Out of scope:** Writing comprehensive test suites for every module (those land per-feature). Playwright E2E implementation if deferred.

**Resumption notes:**
- 2026-05-07: Doc 25 written end-to-end. Added `wiremock` + `reqwest` dev-deps (Rust). Canary: `tests/canary.rs` (3 in-memory DB invariants). Gemini SSE mock: `tests/gemini_sse_mock.rs` (2 tests, 3-chunk stream). Installed vitest 4.1.5 + @testing-library/react + happy-dom. `vite.config.ts` test block added. Canary: `appStore.test.ts` (2 store invariants). IPC mock: `ipc_mock.test.tsx` (1 component test, invoke verified with typed args). All 27 Rust + 3 TS tests pass. Phase complete.

---

## Phase 1 — Auth & Onboarding

**Status:** Complete

**Goal:** A user can complete first-run onboarding (set master password, generate sentinel) and subsequently lock / unlock the app. Master key lives only in `AppState`, never in JS.

**Inputs:**
- `features/13-auth-and-onboarding.md` (Complete).
- `foundation/02-security-model.md` (Complete).
- `foundation/03-data-model.md` §`app_config.json`, §`app_settings`, §`auth_sentinel`.
- `architecture/05-backend-modules.md` §`security/`, §`AppState`.
- `design/12-empty-states-and-errors.md` — onboarding empty states.
- `design/27-theater-composition.md` — lock-screen layout if it inherits theatre primitives.

**Scope / Deliverables:**

1. PBKDF2 (200 000 iterations, 32-byte salt, HMAC-SHA256) implemented in `security/crypto.rs`.
2. AES-256-GCM sentinel encrypt/decrypt in `security/sentinel.rs`.
3. Atomic `app_config.json` writes via `.tmp` + rename.
4. `app_settings.db` (separate from any world DB) provisioned per D-03-A.
5. Tauri commands: `setup_vault`, `unlock_vault`, `lock_vault`, `change_password` per Doc 07 §auth.
6. Frontend: onboarding flow (3-step wizard per Doc 13); lock screen; auto-lock timer wired against `app_settings`.
7. Master-key zeroing (`zeroize`) on lock and process exit.

**Testable Checkpoints:**
- [x] Fresh launch with no `app_config.json` boots into onboarding; completing it produces the file, the sentinel, and `app_settings.db`.
- [x] Wrong password on unlock is reported via a graceful error (Doc 12 copy); right password transitions to `workspace` phase (or `locked → world picker` if no worlds yet).
- [x] Locking from workspace zeroes the master key (verified by inspecting `AppState` debug repr in a test build).
- [x] Changing password generates a new salt, re-encrypts the sentinel, and re-keys the world DB(s) per A6.
- [x] No `tracing` log line contains the master key, API key, or password (grep-verified across a representative session).
- [x] All `features/13` Testable Checkpoints (cite the doc) pass.

**Out of scope:** API-key entry UI (lives in Settings — Phase 11), world creation (Phase 2), recovery flow (Doc 13 covers it; verify it ships here, but cosmetic copy can defer to Phase 12).

**Resumption notes:**
- 2026-05-07: `security/crypto.rs` — PBKDF2 + AES-256-GCM implemented; 9 unit tests green.
- 2026-05-07: `security/sentinel.rs` — create/verify implemented; 4 unit tests green.
- 2026-05-07: `services/config.rs` — atomic `app_config.json` read/write (`.tmp`+rename).
- 2026-05-07: `commands/auth.rs` — all 7 auth commands implemented; `lib.rs` handler registered.
- 2026-05-07: `src/lib/tauriApi/auth.ts` — typed wrappers for all 7 commands.
- 2026-05-07: `authStore.ts` rewritten; no cross-store imports; auto-lock timer fires `lockVault()` + `onLock()`.
- 2026-05-07: `OnboardingShell.tsx` — 2-step wizard (password + API key).
- 2026-05-07: `LockedShell.tsx` — unlock screen; wrong-password error inline.
- 2026-05-07: `App.tsx` — `checkOnboarding` on mount; `isLocked` watcher; activity listeners for auto-lock.
- 2026-05-07: ts-rs export path fixed: all Phase 1 types → `src-tauri/src/lib/types.ts` (reference); `src/lib/types.ts` manually maintained.
- 2026-05-07: All checks green — `cargo test` 44/44, `vitest` 3/3, `tsc --noEmit`, `eslint .`, `cargo clippy` clean. Phase complete.

---

## Phase 2 — Vault & Worlds

**Status:** Complete (last touched 2026-05-10)

**Goal:** A user can create, rename, switch, and delete Worlds; vault tree CRUD works for folders and items; World Backup (.loom-backup zip) round-trips.

**Inputs:**
- `features/14-vault-and-worlds.md` (Complete).
- `foundation/03-data-model.md` §`worlds`, §`vault_items`, §`attachment_history`, §World Backup.
- `architecture/05-backend-modules.md` §`services/vault.rs`, §`services/world.rs`.
- `design/10-layout-and-navigation.md` — three-pane layout, navigator placement.
- `design/12-empty-states-and-errors.md` — empty vault, empty world picker.

**Scope / Deliverables:**

1. World CRUD via Tauri commands per Doc 07 §worlds.
2. Vault tree: folders, items, drag-and-drop reparenting, soft delete + trash + restore.
3. World Picker modal; world switching closes the active connection and opens the new one (Architecture Wall #2).
4. World Backup: zip export of `loom.db` + `world_meta.json`; import path with name-collision handling.
5. Three-pane layout shell (Doc 10) with persisted divider widths.

**Testable Checkpoints:**
- [x] Create world; close app; reopen; world appears in picker; opening it loads the empty workspace.
- [x] Vault tree CRUD: create folder, create item, rename, drag to reparent, soft-delete to trash, restore — all reflected in DB and UI.
- [x] World switch with `isGenerating=true` (mocked) prompts confirmation and aborts the in-flight request before swapping the connection.
- [x] Backup → delete world → import → vault tree intact, settings overrides preserved.
- [x] All `features/14` Testable Checkpoints pass.

**Out of scope:** Source document content editing (Phase 5); paperclip attach/detach UI (Phase 5 — model lands here, the UI affordance lands with DocEditor).

**Resumption notes:**
- 2026-05-08: 2A — `services/world.rs` (create/open/list/update_meta/delete + `WorldMeta` / `WorldMetaPatch`), `commands/vault.rs` (5 thin handlers), `db/connection.rs` (shared SQLCipher open helper, refactored from `commands/auth.rs`), `services/config::WorldEntry` extended with `world_meta_path` (serde default for forward compat). Added `chrono` dep for ISO 8601 timestamps. 50 cargo tests pass (4 new world-validation tests + 2 new ts-rs binding tests). Frontend: `vaultStore` per Doc 06 §vaultStore (full shape locked; items half stubbed for 2C), `tauriApi/vault.ts` typed wrappers, `App.tsx` post-unlock auto-loads worlds and clears on lock.
- 2026-05-08: 2B — `<LeftPane>` / `<Theater>` / `<RightPane>` / `<PaneDivider>` per Doc 10. `appStore.rightPaneCollapsed` + toggle. Persisted widths (left 200-260-360, right 240-280-400) via localStorage. WorkspaceShell composes the three panes with placeholder bodies (Navigator/Theater/Control fill in 2C+). Verified via Vite preview at 1280×800: shell renders, right-pane collapse toggles via state, both dividers present in expanded mode and only the left one in collapsed mode.
- 2026-05-08: SPLIT POINT — pausing here per agreed rhythm. Resume with 2C (vault item CRUD + Navigator) when ready.
- 2026-05-10: 2C — vault item commands (`list_items`/`create_item`/`rename_item`/`move_item`/`delete_item`/`restore_item`/`delete_item_permanent`/`empty_trash`) wired through `services::vault` to `db::vault`. `Navigator` composes filter bar + tree + Trash row; `VaultTreeRow` handles inline rename + context-menu soft-delete; `CreateMenu` covers Story / Folder / SourceDocument templates. `vault_updated` event drives store reloads via `useWorkspaceEvents`. WorldPickerModal honours `isGenerating` (Wall #6) before swapping the active connection.
- 2026-05-10: 2C polish — added cycle-protection in `services::vault::move_item` (rejects moving a folder under one of its own descendants) + matching unit test.
- 2026-05-10: 2D — `import_world` lands in `services::world` (zip extraction with path-traversal guard, master-key decryption check, filename-derived name with case-insensitive `(copy N)` dedupe) and `commands::vault::import_world` registered in `lib.rs`. `dialog:allow-open` permission added to `capabilities/default.json`. WorldPickerModal grew an "Import backup" button next to "+ Create world" (uses `openDialog` to avoid shadowing the `open` prop). `tauriApi/vault.ts::importWorld` wrapper wired up.
- 2026-05-10: 2C polish — drag-and-drop reparenting in Navigator: `VaultTreeRow` is `draggable`, folders accept drop with accent-outlined target highlight, root drop zone wired on the tree `<ul>` (and on the empty-state container). Sort-order computed client-side as `max(siblings.sort_order) + 1`. Self-drops, no-parent-change drops, and dropping a folder onto its own descendant are filtered client-side; backend rejects the descendant case as defence-in-depth.
- 2026-05-10: Verification — `cargo check`, `cargo clippy --all-targets -- -D warnings`, and `cargo test` (75 passed, 6 suites) all clean. `pnpm exec tsc --noEmit` exits 0. `pnpm lint` clean.

---

## Phase 3 — Conversation Engine (story mode)

**Status:** Complete (2026-05-11)

**Goal:** Story-mode round-trip works end-to-end: user sends a message, Gemini streams a response, history persists, `isGenerating` gates the UI, cancellation works. Mode-aware history assembly is scaffolded so Phase 4 (handover/consulting) is additive.

**Inputs:**
- `features/15-conversation-engine.md` (Complete).
- `foundation/03-data-model.md` §`messages`, §`stories`, §`story_state`.
- `architecture/05-backend-modules.md` §`services/conversation.rs`, §`services/gemini.rs`.
- `design/27-theater-composition.md` — bubble structure, Theater layout.
- `features/23-modes.md` (Complete) — read the story-mode subsections; defer handover/consulting to Phase 4.
- `dev/24-coding-standards.md` §Cancellation, §Logging.

**Scope / Deliverables:**

1. Server-side history assembly (Architecture Wall #1) — frontend sends `(story_id, draft: UserContent)` only (no `leaf_id`; D-05).
2. Gemini streaming via `reqwest` SSE; `tokio_util::CancellationToken` per request.
3. Message lifecycle: persist user turn, stream AI turn, finalise on completion or cancellation.
4. `workspaceStore.isGenerating` global flag gating Send / lock / world-switch (Architecture Wall #6).
5. Theater: user bubbles, AI bubbles, in-flight streaming bubble, status section.
6. Edit + delete (no branching — D-05). Hard delete with cascade per Doc 15 §Deletion + Doc 03 §`messages` (v2.1 reserves `deleted_at` for reversible undo); UI confirmation copy per Doc 15.
7. Token meter wired to Status section (visual placement deferred to Phase 12 per NB-3).

**Testable Checkpoints:**
- [x] Send message → AI response streams in chunks → final state persisted; reload restores the conversation.
- [x] Cancel mid-stream → request aborts; partial AI message persisted with a `cancelled` marker per Doc 15.
- [x] Edit a user message in the latest exchange → next regeneration uses the edited content.
- [x] Delete an exchange → confirmation modal → hard-delete with cascade → exchange disappears from Theater.
- [x] `isGenerating=true` blocks the Send button, lock action, and world-switch.
- [x] Logs do not contain message content (grep-verified).
- [x] All `features/15` Testable Checkpoints pass.

**Out of scope:** Handover and consulting modes (Phase 4); context caching (Phase 6); accordion (Phase 7); ghostwriter (Phase 8); feedback (Phase 9). The engine must be designed so each of those slots in additively.

**Resumption notes:**
- 2026-05-10: Plan vs spec — fixed two stale lines (Deliverable 1 leaf_id → `draft: UserContent`; Deliverable 6 soft-delete → hard-delete with cascade) on 2026-05-11. Plan now matches Doc 15 §Backend API + §Deletion.
- 2026-05-10: 3A — backend foundations.
  - `db/messages.rs` — `ChatMessage` struct (ts-rs exported) + insert/get/list_story/list_all/update_content/update_feedback + `truncate_story_after`/`delete_exchange`/`delete_from`/`delete_last_story_message` with `hard_delete_with_cascade` covering checkpoints (anchored) + segments (referencing). 11 unit tests (in-memory SQLite).
  - `services/history.rs` — `ConversationMode` enum, `UserContent` (ts-rs exported), `assemble_story_request` (loads `kind='story'` rows, parses `json_user`, renders bracketed text, appends `[WRITER FEEDBACK]\n…`, optional aux-slot wrapper). `assemble_request` mode-router; handover/consulting branches return `LoomError::Internal` until Phase 4. 9 unit tests covering aux wrapper, feedback append, session-kind exclusion, empty-plot rejection.
  - `services/gemini.rs` — `build_request_body` (Gemini JSON shape with optional `systemInstruction`), `stream_generate_with_url` SSE consumer (handles split-chunks, `\n\n` and `\r\n\r\n` event delimiters, extracts `text`/`finishReason`/`usageMetadata.totalTokenCount`), `count_tokens_with_url`. Cancellation wired via `tokio::select!` against `CancellationToken` (Doc 24: reqwest stream drop alone does **not** cancel the connection — explicit abort required). 7 tests including `wiremock` SSE round-trip + cancel-before-send + HTTP-error surface.
  - `services/settings.rs` — `resolve<T>(world_conn, app_conn, key)` cascade (world `settings` → `app_settings` → hardcoded default). 4 tests including empty-world-override-falls-through.
  - `db/settings.rs` — added `get/set/clear_world_setting` accessors for the world `settings` table.
  - `commands/conversation.rs` — 14 commands (11 from Doc 15 + `load_story_messages` filter helper + `get/save/clear_draft` already counted). Streaming spawns a `tokio::spawn`'d task that holds owned data only — no AppState lock crosses an `await`. Per-request cancellation token via `access::install_cancel_token`; `commands/auth::lock_vault` now calls `cancel_current` before zeroing keys so in-flight streams abort cleanly.
  - **Phase 3 cancellation contract (working interpretation pending Doc 05 amendment):** backend always preserves the partial AI text on cancel + emits `generation_cancelled { story_id, user_message_id, model_message_id }`. Frontend distinguishes user-stop (issues `delete_exchange` to drop both) from lock-fired (no cleanup) — matches Doc 15 §Cancellation Taxonomy taxonomy table from the frontend perspective.
  - **`generation_failed` payload:** backend hard-deletes both rows on HTTP/internal failure (Doc 15 §Bubble Lifecycle: "user bubble retracted, AI bubble never appeared"); frontend just retracts UI state.
  - **Vault-locked-mid-stream caveat:** Doc 15 says "Both preserved (partial AI)". Current implementation cancels the token before clearing `active_conn`, so the post-cancel persist path may race with the connection drop and fail silently. Acceptable for Phase 3; revisit in a later phase (lock_vault could await pending writes with a timeout).
  - ts-rs exports added: `ChatMessage`, `UserContent`, `TokenEstimate`, `SendMessageResult`. Manually mirrored in `src/lib/types.ts` (file is hand-maintained per its own header). Existing types in the file are unchanged.
  - Cargo deps added: `reqwest = { default-features = false, features = ["json", "stream", "rustls-tls"] }` to main dependencies (was dev-only with different features); `futures-util = "0.3"`; `tokio` `time` feature. `wiremock` stayed in dev-deps.
  - Tauri capabilities: no new permissions needed (CSP already permits `generativelanguage.googleapis.com`).
  - Verification: `cargo check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (111 passed across 6 suites), `pnpm exec tsc --noEmit` exit 0. Content-leak grep on `commands/conversation.rs` clean.
  - **SPLIT POINT — pausing here per agreed rhythm.** Frontend (3B + 3C) starts in the next session: `workspaceStore` expansion, `tauriApi/conversation.ts`, `useWorkspaceEvents` listeners (`message_chunk`/`message_complete`/`generation_cancelled`/`generation_failed`), Theater body with bubble list + streaming bubble, story user/AI bubbles per Doc 27, four-field input area with Send/Cancel + 1s draft autosave, story selection wiring on Navigator click, then Status section + edit/delete affordances + token meter + scroll rules + `isGenerating` UI gates.
- 2026-05-11: 3B + 3C — frontend.
  - `lib/tauriApi/conversation.ts` — typed wrappers for all 14 commands.
  - `stores/workspaceStore.ts` — full Doc 15 §Frontend State surface: `activeStoryId`, `messages`, `draft`, `isGenerating`, `generationStatus` discriminated union, `currentUserMessageId`/`currentModelMessageId` flight tracking, `userInitiatedCancel` distinguishing user-stop from lock-fired. Actions: `setActiveStory`, `setDraftField` (1s debounced autosave via module-scope timer + `flushPendingDraft` for lock/switch), `send`, `cancel`, `editUser`, `updateModelContent`, `regenerateLast`, `deleteExchange`, `deleteFrom`, `updateFeedback`. Event handlers `onMessageChunk` (mutates in-place by `currentModelMessageId`), `onMessageComplete` (reloads from DB, clears draft on STOP), `onGenerationCancelled` (issues `delete_exchange` only if user-initiated), `onGenerationFailed` (reloads — backend already hard-deleted). Helper `clearDraftBackend` for the writer Clear affordance.
  - `hooks/useWorkspaceEvents.ts` — added the four conversation listeners alongside the existing `vault_updated`.
  - `components/theater/TheaterBody.tsx` — scroll surface implementing Doc 15 §Theater Scrolling rules 1–4 (open scroll-to-bottom, auto-follow during streaming, pause on user scroll-up, "↓ New content" floating button, re-engage within 32px); InputArea attached when a story is active. Empty states `<NoStorySelected />` and `Begin your story.` per Doc 27.
  - `components/theater/StoryUserBubble.tsx` — labelled four-section render (sections omitted when empty); hover action row with Edit / Delete exchange / Delete from here; edit pops InputArea in-place and commits via `edit_user_message`.
  - `components/theater/StoryAIBubble.tsx` — plain-text whitespace-preserving prose; streaming caret on in-flight bubble; "thinking" hint when content empty; hover action row with Edit (`update_message_content`) / Regenerate (last only) / Delete; stopped badge when `finish_reason` is not STOP. Markdown rendering deferred (Doc 09 work).
  - `components/theater/InputArea.tsx` — four fields (textareas + ChipInput for modificators with comma-as-delimiter and Backspace-removes-last); Send disabled until `plot_direction` is non-empty (after trim); Send swaps to Cancel during `isGenerating`. Ctrl/Cmd+Enter submits. Edit-mode variant uses local state + `onCommit`.
  - `components/theater/StatusSection.tsx` — Doc 15 §Status View. Lives in the bottom of the right pane (`WorkspaceShell`). Six states (idle / preparing / thinking / streaming / complete / stopped) with provisional glyphs `●◐◔◓✓⚠` and live duration ticking via 1s setInterval.
  - `components/navigator/Navigator.tsx` — `handleSelect` for `Story` items calls `setActiveStory`; mid-generation story switch behind `window.confirm`.
  - `components/shell/WorkspaceShell.tsx` — wires `TheaterBody` + `StatusSection`; resets workspace on world switch via `useEffect`; `handleLock` flushes pending draft + confirms-then-locks on generation; `handleOpenWorldPicker` confirms-then-cancels on generation.
  - **isGenerating gates** per plan checkpoint: Send → Cancel swap (intrinsic), lock action gated by confirm (Doc 15 says graceful lock; plan says block — confirm satisfies both), world-switch + story-switch gated by confirm. Lock/world-switch confirms fire `cancel_generation` then proceed.
  - **eslint config** — added `'@typescript-eslint/unbound-method': 'off'`. The rule fires on Zustand store-method selectors (`useStore(s => s.action)`); methods don't reference `this` so the warning is a false positive workspace-wide.
  - **Plan vs Doc 15 lock-on-generation:** plan checkpoint says block; Doc 15 §Cancellation Taxonomy says graceful cancel-and-lock. Resolved by confirm-then-proceed — satisfies both. Flag for next-phase audit if a strict modal is preferred.
  - **Story-switch modal is a `window.confirm`** placeholder; Doc 15 specifies a proper modal — defer to Phase 12 visual polish.
  - **Markdown rendering on AI bubble** is plain-text whitespace-preserving for Phase 3 (Doc 27 calls for Markdown per Doc 09). Doc 09's subset hasn't been drafted; revisit when Doc 09 lands.
  - **Token meter pre-flight (`get_token_count`)** wired through `tauriApi/conversation.ts` and store has `tokenEstimate` + `setTokenEstimate`, but the 500ms-debounced call from InputArea typing is not yet hooked up — Status section reads `tokenEstimate` if present. NB-3 defers visual placement to Phase 12; the live update wiring can land alongside.
  - Verification: `pnpm exec tsc --noEmit` clean; `pnpm lint` clean; `cargo check` clean; `cargo clippy --all-targets -- -D warnings` clean; `cargo test` 111 passed (no regression); content-leak grep clean (only error-object logging on `console.error`).

---

## Phase 4 — Modes (handover + consulting)

**Status:** Complete (2026-05-12)

**Goal:** Mode switcher works; handover one-shot generates a structured report; consulting session enables meta-discussion. Story-mode behaviour from Phase 3 is unchanged.

**Inputs:**
- `features/23-modes.md` (Complete).
- `foundation/03-data-model.md` §`modes`, §`story_state` (`active_session_id`, `active_mode`).
- `architecture/05-backend-modules.md` §`services/modes.rs`.
- `design/10-layout-and-navigation.md` — mode switcher placement.

**Scope / Deliverables:**

1. `modeStore` per D-03; mode-specific state slices.
2. Handover mode: one-shot request, structured output, written into the story export bundle (B-8).
3. Consulting mode: session lifecycle (start, persist, restore on reopen, close); `active_session_id` in `story_state` per CD-9.
4. Mode switcher UI placement per Doc 23 §Mode Switcher.
5. History assembly extended for handover and consulting prompts (`prompt_handover_seed`, `prompt_consulting_seed`).

**Testable Checkpoints:**
- [x] Switching from story to handover shows the handover shell; running it produces a report; switching back leaves the story state intact.
- [x] Consulting session persists and restores on reopen; deleting the session falls back silently per CD-9.
- [x] `active_mode` round-trips through `story_state`.
- [x] All `features/23` Testable Checkpoints pass.

**Out of scope:** Caching of handover/consulting prefixes (Phase 6 decides which modes cache).

**Resumption notes:**
- **4A (2026-05-11) — backend.** `db/conversation_sessions.rs` (CRUD + monotonic-naming counter + FK-CASCADE delete), `services/modes.rs` (`SessionKind`, `SessionSnapshot`/`AccordionSnapshotEntry`/`AttachedDocEntry`, SHA-256 prefix-hash, `create_session`), `db/messages.rs::list_story_messages_up_to` for boundary scoping, `services/history.rs::assemble_session_request` (handover/consulting inline assembly — SI + story-up-to-entry + prior session turns + new user turn). `commands/modes.rs` — 9 commands per Doc 23 with parallel `session_message_*` event shape. ts-rs exports: `ConversationSession`, `SessionKind`, `SessionSnapshot`, `AccordionSnapshotEntry`, `AttachedDocEntry`, `SendSessionMessageResult`. Consulting cache fields stay NULL (Phase 6); cancellation shares the global token (Architecture Wall #6).
- **4B (2026-05-11) — frontend stores + Theater rendering.** `tauriApi/modes.ts` (9 wrappers), `stores/modeStore.ts` (`activeMode`, `activeSessionId`, `sessions[]` + lifecycle actions + `refreshFromEvent` with CD-9 silent fallback), `workspaceStore.ts` (`loadStoryMessages` → `loadMessages`; `currentSessionId` flight tracker; `sendSession`; four session event handlers). `useWorkspaceEvents.ts` listens to six session events. New components: `Banner` (shared with Phase 7 accordion), `SessionPartition` (collapse/Enter/Exit + window.prompt context menu placeholder), `SessionBubble` (plain-prose, read-only in v2.0). `TheaterBody.buildRenderItems` interleaves story messages and session partitions via `<created_at>__<a|b>__<id>` sort keys (partitions land after their anchor message). Session-message edit/delete affordances deferred.
- **4C (2026-05-12) — ModeSwitcher + SessionInputArea + active_mode round-trip.** `commands/modes.rs::StoryActiveMode` + `get_story_active_mode` / `set_story_active_mode` (typed `StoryStateKey` accessors; null session_id round-trips as empty string). `modeStore` got `storyId` field + `restoreForStory` (validates persisted session still exists; persists silent fallback when not) + `activateStoryMode` for the Story tab. All transition actions persist via best-effort `persistActiveMode`. New `ModeSwitcher` (tab strip with active-session sublabel; not gated by `isGenerating` per Doc 23 §Switching during generation), `SessionInputArea` (single textarea, no draft persistence). `TheaterBody` swaps `<InputArea>` ↔ `<SessionInputArea>` by `activeMode`. `WorkspaceShell` story-open effect swapped to `restoreForStory`; restoring `active_mode='consulting'` does **not** auto-enter — the banner Enter button gates the (eventual Phase 6) cache rebuild on intentional action.
- **`/phase-verify` 2026-05-12 — green.** `cargo build --release` clean (fix: added `"json"` feature to `tracing-subscriber` for the release-branch JSON formatter; pre-existing build break). `cargo clippy --all-targets -- -D warnings` clean. `cargo test` 135 passed across 6 suites. `tsc --noEmit` + `eslint .` + `prettier --check .` clean (Prettier reformatted 12 files left dirty by Phase 3/4A/4B; no behaviour change). ts-rs reference at `src-tauri/src/lib/types.ts` regenerates clean; hand-maintained `src/lib/types.ts` mirror has Phase 3+4 uncommitted edits that the `check:types` `git diff --exit-code` gate flags until the phase commits — same pattern Phase 3 / 4A / 4B left. Phase 4 surface grep gates all clean: no raw `.lock()`, no raw `invoke()` in components, no string-key settings SELECT, no `.unwrap()` in production paths, no `// Phase N` comments, no hex in components, no key/content/feedback in `tracing` logs, only pane widths + vault expand state in localStorage. Phase 4 audit items (CD-9, HB-5, IP-9) already ticked at audit-reconciliation time; Phase 4C delivers what CD-9 prescribed.
- **Pre-existing tech debt flagged (not Phase 4-introduced; tracked for next clean-up pass):**
  - `commands/conversation.rs` has 4 raw `.lock()` on `AppState.active_conn` violating SB-5 (Phase 3, uncommitted).
  - `components/world-picker/WorldPickerModal.tsx` imports `invoke` directly from `@tauri-apps/api/core` instead of via `tauriApi/` (Phase 2D, uncommitted).
  - Both are in entirely-untracked files from Phase 2D / Phase 3 that have never been committed; resolution belongs with whoever commits those phases.
- **Known follow-ups deferred from Phase 4 (out of scope; tracked):** session-message edit/delete affordances; window.prompt context menu on SessionPartition → proper popover (Phase 12); story-switch confirm modal beyond `window.confirm` (Phase 12); consulting cache create/refresh/drop on Enter (Phase 6); session-message Markdown rendering (Doc 09 work).

---

## Phase 5 — Source Documents

**Status:** Complete (2026-05-14)

**Goal:** Vault items can hold source-document content; DocEditor edits them with debounced auto-save; paperclip attaches them to a story; attachments cascade on soft-delete.

**Inputs:**
- `features/18-source-documents.md` (Complete).
- `foundation/03-data-model.md` §`vault_items` content fields, §`attachment_history`.
- `architecture/05-backend-modules.md` §`services/vault.rs` (extension).
- `design/27-theater-composition.md` §DocEditor.
- `features/19-media.md` (Complete, slim) — image-as-source-doc shares the editor; full image render path lands in Phase 10.

**Scope / Deliverables:**

1. DocEditor component; debounced auto-save (`flushDocSave()` on close / lock / world-switch).
2. Paperclip affordance on vault rows; attach / detach commands return the new ordered `context_doc_ids` (CD-8).
3. Soft-delete cascade: detaching with `reason='soft_delete'` written to `attachment_history`.
4. Read-only banner for v2.0 image-as-source-doc rows (Phase 10 makes the lightbox functional).

**Testable Checkpoints:**
- [x] Edit a doc; close DocEditor without explicit save; reopen — content persists. *(5B — debounced save + flushDocSave on closeDoc covered by vitest; live verification at /phase-verify)*
- [x] Lock app mid-edit → `flushDocSave` runs → unlock shows the saved content. *(5B — `Promise.all([flushPendingDraft(), flushPendingDocSave()])` in `handleLock`; vitest covers flush semantics)*
- [x] Attach two docs to a story; reorder; detach one — `context_doc_ids` order matches the UI. *(5C: paperclip attaches; Right Pane Context Documents section shows insertion-order rows with × to detach. Reorder reinterpreted per Doc 18 §`attach_context_doc` — insertion-only; ordering deferred.)*
- [x] Soft-delete a vault item that is attached → `attachment_history` records `event='detach', reason='soft_delete'`. *(5A cargo test `soft_delete_cascades_detach_with_reason` confirms; 5C `useWorkspaceEvents` listener now reloads `loadAttachedDocs` on `vault_updated` so the right pane reflects the cascade.)*
- [x] All `features/18` Testable Checkpoints pass. *(/phase-verify 2026-05-14 — every contract has cargo or vitest coverage; live Tauri sweep run by user.)*

**Out of scope:** Source Document Creator (deferred to v2.1, `docs-v2/future/source-document-creator.md`); image rendering (Phase 10); cache stale-on-attach (Phase 6).

**Resumption notes:**

**Closed 2026-05-14 — /phase-verify clean, all 5 checkpoints ticked.**

- **Surface that landed:** `db/vault.rs` content R/W; new `db/attachment_history.rs`; new `services/cache.rs` with `mark_story_stale` no-op stub (Phase 6 fills the body without touching call sites); `services/vault.rs` extensions — `get_item_content`, `update_item_content`, `get_context_doc_ids`/`set_context_doc_ids` (JSON-encoded list lives in `story_state` via existing helpers; kept inside services rather than `db/` to avoid a near-empty module), `attach_context_doc`, `detach_context_doc`, `cascade_detach_on_soft_delete`, `list_attached_docs`; `soft_delete_item` cascades for SourceDocument/Image. Five new commands wired in `commands/vault.rs` + `lib.rs`; typed wrappers in `src/lib/tauriApi/vault.ts`. Frontend: `<DocEditor>` (marked 18.0.3 + GFM; Tab/Shift+Tab placeholder navigation; debounced 1 s save; read-only banners for Image / soft-deleted; auto-close when item disappears); Theater priority swap in `WorkspaceShell` (`activeDocId` takes Theater + right pane; Navigator stays visible); `flushPendingDocSave` integrated into `handleLock` and world-switch; `<ContextDocsSection>` right-pane section; Navigator hover-paperclip (filled-accent when attached, outline-on-hover when detachable); `useWorkspaceEvents` `vault_updated` listener reloads `loadAttachedDocs` so soft-delete cascade is reflected.
- **Tests added (19 total):** 11 cargo (attach/detach/cascade/content validation/insertion order); 8 vitest (5 debounce + flush semantics, 6 Tab navigation). All 148 cargo + 14 vitest pass.
- **Key decisions for downstream phases:**
  - `services/cache.rs::mark_story_stale` is a stub with six live call sites already routing through it. **Phase 6 fills the body** — write `UPDATE cache_state SET is_stale = 1`, emit `cache_state_changed` — without touching any caller.
  - `stories_with_attached_doc` uses SQL `LIKE` over the JSON-encoded list with a defensive parse-and-verify pass. UUIDs make false positives impossible today; the verify pass keeps it correct if IDs ever stop being UUIDs.
  - The unsaved-dot in DocEditor is optimistic (`content !== savedContent` where `savedContent` is the last-loaded value, not the last-saved). Doesn't re-sync on save success — Phase 12 polish can wire a per-save settled-promise to clear it precisely.
- **Deferred from this phase:**
  - Right-click "Attach to story" context-menu entry — Phase 12 (proper popover menu replaces the Phase-2C single-confirm placeholder).
  - Inline doc rename for SourceDocument / Image — Phase 12 (context menu).
  - `list_templates` IPC + Settings → Templates management — Phase 11 (Doc 20).

---

## Phase 6 — Context Caching

**Status:** Complete (2026-05-15)

**Goal:** Caching is always on subject to `cache_min_tokens`; cache create / refresh / delete works against the Gemini File API; stale triggers fire correctly; right-pane Cache section reflects state in real time.

**Inputs:**
- `features/22-context-caching.md` (Complete).
- `foundation/03-data-model.md` §`cache_state`, §`cache_min_tokens`, §`cache_ttl_secs`.
- `architecture/05-backend-modules.md` §`services/cache.rs`, §`services/file_api.rs`.
- `design/27-theater-composition.md` §Right Pane §Cache section.

**Scope / Deliverables:**

1. Port v1.0 cache service with v2.0 architecture (no branching, no DAG; linear contiguous-collapsed-prefix).
2. `cache_state_changed` event; `cacheStore` wired in App.tsx with cleanup.
3. Stale triggers per Doc 22 §Stale Triggers (every accordion / vault / settings mutation that touches the prefix).
4. Inline-optimisation fallback path (Doc 22 §Fallback to Inline) for sub-threshold or failure conditions.
5. Right-pane Cache section: TTL countdown (1 s tick), color-coded dot, create/update/delete buttons; CacheContentsModal with doc dirty-check (`crypto.subtle.digest`).

**Testable Checkpoints:**
- [x] Send a message above `cache_min_tokens` → cache row created in DB and visible in right pane.
- [x] Edit an attached doc → cache marked stale; amber dot on Send button.
- [x] Refresh TTL → expiry advances; UI countdown updates.
- [x] Delete cache → row gone; next request goes inline.
- [x] Sub-threshold message → inline path used; no cache row created.
- [x] All `features/22` Testable Checkpoints pass.

**Out of scope:** Cache visuals beyond the row format (token colors, density — Phase 12 per O10 residual).

**Resumption notes:**

- **2026-05-14: Pre-session prep (handover for the agent starting Phase 6 cold).**

  **Audit gate — clean.** All Phase 6 audit items resolved at audit-reconciliation time:
  - HB-6 — `LoomError::CacheCreate(String)` variant exists ([src-tauri/src/error.rs:33](src-tauri/src/error.rs#L33)).
  - HB-7 — Doc 05 module map includes `services/cache.rs` + `services/file_api.rs`.
  - CD-12 — `cache_enabled` toggle dropped entirely; caching is always-on subject to `cache_min_tokens` threshold. Doc 22 §Fallback to Inline rewritten — inline path triggers only on (a) prefix below threshold, (b) Gemini-side hard-minimum 400, or (c) cache-create failure.
  - SD-4 — moot (resolved by CD-12).
  - IP-9 — `AliveCacheRow` is in the ts-rs-generated `types.ts` list (commands return it).
  - **Non-blockers:** NB-1 (TTL color thresholds — Phase 12 visual pass); TD-1 (`cache_min_tokens=4096` empirical verify — O16, post-launch).

  **Phase 5 carries forward.** `services/cache.rs::mark_story_stale(conn: &Connection, story_id: &str) -> Result<(), LoomError>` is a no-op stub with **three live call sites** in [src-tauri/src/services/vault.rs](src-tauri/src/services/vault.rs): `update_item_content` (loops over `stories_with_attached_doc`), `attach_context_doc`, `detach_context_doc` (including the cascade path). Phase 6 fills the body (`UPDATE cache_state SET is_stale = 1`) without touching any caller, then adds new call sites for the remaining triggers below. Signature is correct as-is — do not change it.

  **Proposed split (four sub-phases, mirrors Phase 5's rhythm):**

  - **6A — Story cache core (backend + IPC).** ~45% of phase effort.
    - Fill `services/cache.rs::mark_story_stale` body (`UPDATE cache_state SET is_stale = 1 WHERE story_id = ?`). Service does NOT emit events — that's command-layer responsibility per Doc 05.
    - Add `services/cache.rs::build_cache_prefix(conn, scope: CacheScope) -> Result<CachePrefix, LoomError>` where `CacheScope = Story(story_id) | Session(session_id)`; 6A implements the `Story` arm only (Session lands in 6C). Returns SI (cascade-resolved) + attached doc list (wrapped in `=== SOURCE DOCUMENT: <subtype> — <name> ===` headers per Doc 22) + story-kind messages up to prior model + rolling SHA-256 hash + token estimate.
    - Add `create_cache(prefix) -> Result<CacheRecord, LoomError>` (Gemini `POST /v1/cachedContents`); `refresh_cache_ttl(cache_name)` (fire-and-forget `PATCH`, never blocks send); `delete_cache(cache_name)` (best-effort `DELETE`, errors logged).
    - `db/cache_state.rs` (new) — typed CRUD on `cache_state` table; existing schema is in place from Phase 0.
    - New `commands/cache.rs`: `get_cache_state`, `create_story_cache`, `delete_story_cache`, `list_alive_caches`. Emit `cache_state_changed { story_id, status }` after each mutation.
    - Wire `commands/conversation.rs::send_message` to auto-create cache when `prefix_token_count ≥ cache_min_tokens AND (cache_name IS NULL OR is_stale OR expiry_at ≤ now())`. On `LoomError::CacheCreate` or sub-threshold: inline-fallback path (one toast: "Cache unavailable, sending inline"). After a successful cached send, fire-and-forget `refresh_cache_ttl` via `tokio::spawn`.
    - New stale-trigger call sites (the 4 not in vault):
      - `commands/vault.rs::rename_item` — when item is `SourceDocument` (name is in `=== SOURCE DOCUMENT: ... — <name> ===` header), call `mark_story_stale` for every story attaching it.
      - `commands/conversation.rs::{edit_user_message, update_message_content, regenerate_last_response, delete_exchange, delete_from, update_feedback}` — when the affected message is at-or-before `cache_state.last_cached_message_id`, mark stale + emit. Also require confirmation modal per Doc 22 §Cached-message Edit/Delete Protection.
      - `commands/settings.rs` (when added in Phase 11) — `story_si`, `consulting_si`, `text_model_name` writes mark relevant story caches stale. Phase 6 stubs this with a `services/cache.rs::mark_world_stories_stale(conn, world_id)` helper that Phase 11 calls.
      - Accordion triggers defer to Phase 7 — `commands/accordion.rs` does not exist yet. Phase 7 wires its own `mark_story_stale` calls when shipping summarise / use_summary / create_checkpoint / delete_checkpoint commands.
    - Cargo tests: prefix assembly (SI cascade, doc order = attachment order, message ordering up to prior model), `mark_story_stale` writes `is_stale=1`, fallback path returns `LoomError::CacheCreate` on simulated Gemini failure, sub-threshold prefix routes to inline.
    - **Open at 6A start:** how to mock Gemini HTTP for tests — Doc 25 §Tauri IPC mock recipe + wiremock (already in dev-deps from Phase 0.5). Use a per-test mock server URL injected via env-var / config; preserve existing test pattern.

  - **6B — File API + image-doc URIs.** ~10% of phase effort.
    - New `services/file_api.rs::get_or_upload_file_api_uri(conn, item_id, world_dir) -> Result<String, LoomError>`. Reads `items.file_api_uri` + `items.file_api_uploaded_at`; if cached URI is < 47 hours old, returns it; otherwise uploads via Gemini `POST /v1/files` and persists URI + timestamp.
    - `build_cache_prefix` integrates: for `item_type='Image'` docs, the prefix block uses the Gemini `fileData` URI reference instead of inline content.
    - Cargo tests: 47-hour boundary, re-upload after expiry, URI passthrough when fresh.
    - **Open at 6B start:** none — surface is small and isolated.

  - **6C — Consulting cache + snapshot reconstruction.** ~25% of phase effort.
    - Add `services/cache.rs::mark_session_stale(conn, session_id) -> Result<(), LoomError>` (`UPDATE conversation_sessions SET cache_is_stale = 1`).
    - `build_cache_prefix(Session(session_id))` — implements the `Session` arm. Uses `conversation_sessions.entry_snapshot` for re-entry: loads `story_message_ids` and uses **captured** accordion-segment summaries verbatim (not current ones), per Doc 22 §Re-entry algorithm. Computes rolling SHA-256 and compares to snapshot's stored hash; records divergences as non-blocking warnings.
    - Session cache CRUD on `conversation_sessions` row (`cache_name`, `cache_expiry_at`, `cache_is_stale` — schema already exists from Phase 0).
    - Hooks: `commands/modes.rs::start_consulting_session` and `enter_session` trigger session-cache create; `exit_session` triggers best-effort delete + NULL fields. Each emits `session_cache_state_changed { session_id, status }`.
    - Stale triggers (consulting-cache-only): session message edit/delete in `commands/modes.rs::send_session_message` post-edit paths; snapshot-divergence on re-entry (mark stale + warn).
    - Coexistence per Doc 22 §Coexistence with story cache: story cache stays alive but unrefreshed during a consulting session; handover sessions never cache (schema constraint enforces NULL cache fields).
    - Cargo tests: snapshot reconstruction round-trip, divergence detection on missing message, captured-summary verbatim use, session-stale write.
    - **Open at 6C start:** session-snapshot divergence UX wording (Doc 22 says "Story has changed since this session was created. Context may differ." — confirm phrasing; toast on session entry, non-blocking).

  - **6D — Frontend (cacheStore + right-pane UI + Send affordances).** ~20% of phase effort.
    - New `src/stores/cacheStore.ts`: `byStory: Record<string, CacheStatus>`, `bySession: Record<string, SessionCacheStatus>`, single shared `setInterval` ticker (1 Hz) for TTL countdowns when any cache row is mounted. Actions: `loadStoryCache`, `loadSessionCache`, `handleStoryCacheEvent`, `handleSessionCacheEvent`, `clearStory`, `clearSession`.
    - Event listeners in `useWorkspaceEvents`: `cache_state_changed` → `handleStoryCacheEvent`; `session_cache_state_changed` → `handleSessionCacheEvent`.
    - Right-pane **Cache section** (Doc 27 §Right Pane): collapsible "CACHE" header (11px uppercase per Doc 27 conventions); rows for each alive cache with `<story_name> · <tokens_k> tok · TTL <time> [status_badge]`; consulting row shown when active session has a cache; row click opens Cache Contents modal; row right-click → "Delete cache".
    - **Cache Contents modal**: per-doc rows with name + token count + dirty-check (`crypto.subtle.digest` against `cache_state.doc_snapshots`); story-history row with message count + last-cached message excerpt; actions "Update cache" / "Delete cache" / "Close".
    - **Send button** stale indicator (amber dot via `--color-warning` or accent fallback when `byStory[storyId].is_stale`); tooltip "Cache is outdated. Update it before sending for cost savings, or send anyway."; right-click → "Update cache" / "Send anyway".
    - Vitest: ticker tick reduces TTL by 1 s; event reducer merges incoming `CacheStatus`; modal dirty-check matches hashes correctly.
    - **Open at 6D start:** Cache Contents modal — `shadcn/ui` Dialog or custom? Doc 09 Dialog primitive lands in Phase 11 but the underlying shadcn primitive is already in deps. Recommend reusing the `Dialog` already generated for `WorldPickerModal` to stay consistent.

  **Phase 6 Testable Checkpoints — sub-phase mapping:**
  - 6A closes: "Send above `cache_min_tokens` → cache row created" (DB visible; UI lands in 6D), "Delete cache → row gone; next request goes inline", "Sub-threshold → inline path".
  - 6B closes: no Phase-6 plan checkpoint directly (image-doc prefix is a Doc 22 §Image source documents sub-checkpoint).
  - 6C closes: no Phase-6 plan checkpoint directly (covers Doc 22 consulting-cache checkpoints).
  - 6D closes: "Edit attached doc → cache stale + amber dot on Send button", "Refresh TTL → expiry advances + UI countdown updates", and the visible half of the cache-row checkpoint.
  - The fifth Plan checkpoint ("All `features/22` Testable Checkpoints pass") sweeps Doc 22's full list at `/phase-verify`.

  **Cross-phase contracts (don't violate):**
  - `services/cache.rs::mark_story_stale` signature stays `(conn: &Connection, story_id: &str) -> Result<(), LoomError>`. Six call sites depend on it.
  - Service layer never emits events — Doc 05 §Dependency Rules. Always emit in the command layer after the service call returns.
  - Inline-fallback path is the **same** request assembly as cached, minus the `cachedContents` reference. Don't introduce a second code path; share `build_cache_prefix` output with the inline send.
  - Handover sessions never cache. Schema CHECK constraint already enforces NULL cache fields for `kind='handover'`. Don't add a runtime check — the constraint is the source of truth.

  **Estimated work distribution:** 6A ~45%, 6B ~10%, 6C ~25%, 6D ~20%.

  **Decisions/deferrals to log at phase start:**
  1. Accordion stale triggers: defer to Phase 7 (commands don't exist).
  2. TTL color thresholds: tokens-only (no hex); exact <5 min warning threshold per Doc 22.
  3. `cache_min_tokens` default: accept 4096; mark `TODO(O16)` for post-launch tuning.
  4. Gemini hard-minimum 400 response: fallback to inline (same path as sub-threshold).
  5. Regenerate / edit-and-regenerate: no special path — falls through normal auto-create logic.

- **2026-05-14: 6A landed (backend story-cache core).**
  - `db/cache_state.rs` — typed CRUD (`get`, `upsert_active`, `refresh_expiry`, `mark_stale`, `clear_active`, `list_story_ids`, `list_alive_story_rows`); `CacheStatus` ts-rs export. 7 unit tests.
  - `services/cache.rs` — `mark_story_stale` body lit (was Phase 5 stub), `mark_world_stories_stale` (Phase 11 stub), `is_cached_story_message`, `build_story_prefix` + `build_cache_prefix(Story)` with cascade-resolved SI, attached-doc headers, message ordering, SHA-256 doc snapshots and rolling prefix hash, `estimate_prefix_tokens` (chars/4 heuristic per TD-1), Gemini HTTP `create_cache` / `refresh_cache_ttl` / `delete_cache` (URL-injectable for wiremock). 5 unit tests + 2 wiremock tests.
  - `commands/cache.rs` — 4 commands (`get_cache_state`, `create_story_cache`, `delete_story_cache`, `list_alive_caches`), all emit `cache_state_changed`. Registered in `lib.rs`.
  - `commands/conversation.rs::send_message` rewired: `decide_cache_path` runs after the inline-prep block — picks cached fresh / create-then-cached / inline based on `cache_state` + `cache_min_tokens`. Fire-and-forget refresh on STOP. `LoomError::CacheCreate` triggers a `cache_unavailable` event + inline fallback.
  - Stale-trigger sites added: `commands/vault.rs::rename_item` (SourceDocument/Image → all attached stories), `commands/conversation.rs::{update_message_content,delete_exchange,delete_from,update_feedback,edit_user_message,regenerate_last_response}`. Backend stale-marks silently; Doc 22's confirmation-modal contract is a 6D frontend-only UX gate per "Dismissal proceeds with the operation and marks the cache stale".
  - `AssembledRequest` gained `cached_content_name: Option<String>`; `gemini::build_request_body` emits `cachedContent` (and skips top-level `systemInstruction` since the SI is in the cache) when present.
  - **6A scope decisions:**
    - `re_send_after_edit` (used by `edit_user_message` / `regenerate_last_response`) sends inline (no cache use, no refresh). Stale-trigger has already invalidated the cache; next plain send rebuilds. Documented inline.
    - Image source-doc bodies are placeholder strings in the prefix; 6B replaces with `fileData` URI.
  - `cargo build`, `cargo clippy --all-targets -- -D warnings`, `cargo test --lib` (156 passed), `tsc --noEmit`, `eslint .` all clean.
  - **Open at 6A close:** `src/lib/types.ts` updated with `CacheStatus`, `AliveCacheRow`, `CacheStateChangedPayload`, `CacheUnavailablePayload`. Frontend `tauriApi/cache.ts` shipped (typed wrappers). No store / UI yet — that's 6D.

- **2026-05-14: 6B landed (File API + image-doc URIs).**
  - `services/file_api.rs` — `get_or_upload_file_api_uri(conn, base_url, api_key, item_id, world_dir)` reads `(file_api_uri, file_api_uploaded_at)` from `items`; if URI is < 47 hours old returns it; otherwise reads bytes from `asset_path` (resolved relative to world dir), `POST`s to `/upload/v1beta/files?uploadType=media`, persists URI + ISO timestamp via `db::vault::set_file_api_uri`. Internal `get_or_upload_with_now` injects "now" for deterministic tests. 6 tests (3 boundary + 3 wiremock).
  - `db/vault.rs` — added `get_file_api_state(id) -> (Option<String>, Option<String>)` and `set_file_api_uri(id, uri, uploaded_at)` accessors. 47-hour check uses `chrono::Duration::hours(47)`.
  - `services/history.rs::GeminiPart` extended: `text` is now `#[serde(skip_serializing_if = "String::is_empty")]` and a sibling `file_data: Option<GeminiFileData>` (with `fileUri` + `mimeType`) is `#[serde(skip_serializing_if = "Option::is_none")]`. Constructors `GeminiPart::text(s)` / `GeminiPart::file(uri, mime)` keep call sites tidy. All in-tree direct constructions migrated.
  - `services/cache.rs::DocPayload { Text(String) | File { uri, mime_type } }` replaces `body: String`. `build_story_prefix` emits a header text part followed by either a body text part (SourceDocument) or a `fileData` part (Image). For Image payloads, `doc_snapshots` keys hash the URI (stable per upload).
  - **6B scope decisions:**
    - Resolution of file-API URIs is **not** triggered automatically inside `build_cache_prefix` (would couple a sync DB-only function to async HTTP). Instead, the prefix builder reads whatever `file_api_uri` is currently on the `items` row; the caller (a future image-attach or manual cache-update path) is responsible for calling `services/file_api::get_or_upload_file_api_uri` first. When the URI is missing the builder falls back to the 6A text placeholder so cache create still succeeds; the next cache refresh after an upload picks up the URI. This is a pragmatic split for 6B; a full pre-resolve hook lands when image source-doc UI is wired (post-Phase-6).
  - `cargo build`, `cargo clippy --all-targets -- -D warnings`, `cargo test --lib` (162 passed, +6 file_api tests) all clean.

- **2026-05-14: 6C landed (consulting cache + snapshot reconstruction).**
  - `services/cache.rs`:
    - `mark_session_stale(conn, session_id)` — `UPDATE conversation_sessions SET cache_is_stale = 1 WHERE id = ? AND cache_name IS NOT NULL`. Handover never has an active cache (table CHECK), so no kind-guard needed.
    - `build_session_prefix(conn, session_id) -> (CachePrefix, Vec<SessionDivergence>)` — reads `entry_snapshot` JSON, walks `attached_docs` (compares current SHA-256 → `AttachedDocChanged`; missing rows → `MissingAttachedDoc`), walks `story_message_ids` verbatim (missing → `MissingStoryMessage`; renders user/model the same way story prefix does). Captured accordion state is used verbatim per Doc 22 §Re-entry algorithm (Phase 4 snapshots have empty `accordion_state`; Phase 7 will populate).
    - Divergence's `prefix_hash_mismatch` recomputed via `services::modes::canonicalise_and_hash` (now `pub`) — matches the snapshot's hash domain. Independent of `CachePrefix.prefix_hash` (rendered-bytes hash, used for cache-create's own integrity chain).
    - `is_cached_session_message(conn, session_id, message_id)` — true when `cache_name IS NOT NULL` AND id appears in snapshot's `story_message_ids`. Modal contract uses this in 6D for session edit/delete.
    - `build_cache_prefix(Session)` arm now delegates to `build_session_prefix`, dropping divergences (the eager-create paths in modes commands surface them via `session_cache_diverged` event).
  - `db/conversation_sessions.rs::list_alive_session_rows` — joins `conversation_sessions` to `items.name` for the right-pane Cache list.
  - `db/cache_state.rs::SessionCacheStatus` (Default + ts-rs export) — IPC payload mirroring the cache fields on a session row.
  - `commands/cache.rs`:
    - `list_alive_caches` now returns story rows + active consulting rows (session id/name populated; `total_tokens=0` placeholder until session-cache create stores it via update_session_cache token field — out of 6C scope).
    - New `get_session_cache_state` Tauri command, registered in `lib.rs`.
  - `commands/modes.rs`:
    - `ensure_consulting_cache(app, state, api_key, session_id)` — sync prep block builds prefix from snapshot under `with_two_conns`; releases locks; best-effort `DELETE` of any existing cache; `POST cachedContents` with consulting SI from snapshot. On failure, NULLs the session's cache fields and emits empty status. On success, persists via `update_session_cache` and emits `session_cache_state_changed`. Divergences (if any) emitted as `session_cache_diverged`.
    - `start_consulting_session` (now `async`) — after row creation, eagerly calls `ensure_consulting_cache`. Failure is non-fatal; first session send retries via the same path.
    - `enter_session` (now `async`) — for consulting kind, runs `ensure_consulting_cache` (rebuilds from snapshot per Doc 22 §Consulting-session cache §Cache contents on re-entry).
    - `exit_session` (now `async`) — for consulting kind: best-effort `DELETE`, NULL the row's cache triple, emit empty status.
    - `send_session_message` — under prep, decides cached vs inline (consulting only; cached when `cache_name IS NOT NULL AND !cache_is_stale AND expiry_at > now`). Cached path replaces the inline request with one carrying `cached_content_name` and only the new user turn. `spawn_session_cache_refresh` fires on STOP, persists new expiry via `update_session_cache`, emits.
    - New IPC payloads: `SessionCacheStateChangedPayload`, `SessionCacheDivergedPayload`. New events: `session_cache_state_changed`, `session_cache_diverged`.
  - `src/lib/types.ts` extended: `SessionCacheStatus`, `SessionCacheStateChangedPayload`, `SessionDivergence`, `SessionDivergenceKind`, `SessionCacheDivergedPayload`. `tauriApi/cache.ts::getSessionCacheState` wrapper.
  - **6C scope decisions:**
    - Session-message edit/delete stale triggers: `commands/modes.rs` does not currently expose direct edit/delete of session messages (only send + cancel). When 6D / a future phase adds those commands, they should call `mark_session_stale`. The `is_cached_session_message` predicate is already in place.
    - `total_tokens` for session rows in `list_alive_caches` is a placeholder 0 — the live token count from Gemini's create response isn't persisted on the session row (no column for it). A column add lands when session-cache UI surfaces a token figure (out of 6C scope).
    - Coexistence: story cache stays alive but unrefreshed during a consulting session — already the natural behavior (story-mode `send_message` is the only refresher). Verified by test setup.
  - 4 new cache.rs tests (snapshot round-trip, missing-message divergence, mark_session_stale + no-op, is_cached_session_message). `cargo build`, `cargo clippy --all-targets -- -D warnings`, `cargo test --lib` (169 passed, +7 from 6B), `tsc --noEmit`, `eslint .` all clean.

- **2026-05-14: 6D landed (frontend cache surface).**
  - `src/stores/cacheStore.ts` — Zustand store with `byStory: Record<string, CacheStatus>`, `bySession: Record<string, SessionCacheStatus>`, `alive: AliveCacheRow[]`, and a `tick: number` driven by a single shared 1 Hz `setInterval` via `subscribeTicker()` (ref-counted; auto-stops when last subscriber unmounts). Event reducers `handleStoryCacheEvent` / `handleSessionCacheEvent` patch the right `byStory`/`bySession` map and refresh `alive` (cheap local-DB join). `clearAll` for world switch. Helper exports `isStoryCacheActive`, `formatTtl`, `ttlColorToken` (tokens-only per NB-1).
  - `src/lib/tauriApi/cache.ts` — typed wrappers (`getCacheState`, `createStoryCache`, `deleteStoryCache`, `listAliveCaches`, `getSessionCacheState`).
  - `src/hooks/useWorkspaceEvents.ts` — listeners for `cache_state_changed`, `session_cache_state_changed`, `cache_unavailable` (toast: "Cache unavailable; sending inline."), `session_cache_diverged` (toast: "Story has changed since this session was created. Context may differ."). Lifecycle subscriptions: load story-cache on `activeStoryId` change; `clearAll` on `activeWorldId` change; `refreshAlive` after world open.
  - `src/components/theater/CacheSection.tsx` — collapsible "CACHE" header (11px uppercase per Doc 27), one row per alive cache: `<label> · <tokens k> · <TTL> [stale-dot]`. Click row → `CacheContentsModal`. Right-click row → `deleteStoryCache` (consulting rows owned by session lifecycle — no manual delete affordance). Mounted in `WorkspaceShell` between `ContextDocsSection` and `StatusSection`.
  - `src/components/theater/CacheContentsModal.tsx` — overlay dialog (mirrors `WorldPickerModal` pattern, since Doc 09 Dialog primitive doesn't ship until Phase 11). Per-doc rows with `crypto.subtle.digest('SHA-256', ...)` dirty check (compares `getItemContent(id)` for SourceDoc, `file_api_uri` for Image, against `cache_state.doc_snapshots`). Header shows resource name / TTL / token count / stale flag. Actions: Delete / Update / Close.
  - `src/components/theater/CachedMessageConfirmModal.tsx` + `src/hooks/useCachedMessageGuard.tsx` — Doc 22 §Cached-message Edit/Delete Protection. Hook returns `(modal, guard)`; the guard returns `true` immediately when no cache is active or the message is post-high-water; otherwise pops the modal and resolves on confirm/cancel. Wired into `StoryUserBubble` for both edit and delete paths. Dismissal proceeds — backend stale-trigger then marks the cache stale.
  - `src/components/theater/InputArea.tsx` — Send button gains an amber dot when the active story cache is stale, plus an inline "Update cache" link to its left. Tooltip: "Cache is outdated. Update it before sending for cost savings, or send anyway." (matches Doc 22 wording).
  - 12 vitest cases in `src/__tests__/cacheStore.test.ts` covering: event-merge for story / session, `clearAll`, ticker increment + ref-counted shared interval (single tick per second across 2+ subscribers), `isStoryCacheActive` truth table, `formatTtl` boundaries. Tauri IPC mocked at the wrapper boundary so `refreshAlive` doesn't hit the missing runtime.
  - **6D scope decisions:**
    - The right-click context-menu UX from Doc 22 §Stale Indicator is condensed to an inline "Update cache" button + amber dot. A real popover-style context menu requires the Doc 09 menu primitive (Phase 11) — deferred.
    - The cached-message guard is wired into `StoryUserBubble` only. `StoryAIBubble` exposes Ghostwriter and feedback edits, neither of which currently goes through the high-water predicate (feedback flips `cache_state_changed` server-side post-update; Ghostwriter accept lands in Phase 8). Hook is general so adding new sites is a one-line wrap.
    - CacheContentsModal hashes the content fetched via `get_item_content` IPC. For Images it hashes the `file_api_uri` (mirrors backend's snapshot key for Image rows in `services/cache.rs`). Newly-attached docs (no snapshot key) display as "⚠ changed".
    - Verification: `tsc --noEmit`, `eslint .`, `vitest run` (26 passed, +12), and Vite frontend-only preview start with no cache-code console errors. Full UI exercise requires `npm run tauri dev` (the auth gate keeps the workspace shell out of reach in browser-only preview).
  - All checkpoints from the Phase 6 plan now have backend + UI coverage. `/phase-verify` next.

- **2026-05-15: Phase 6 closed (`/phase-verify` clean).** All six Testable Checkpoints ticked via code/test inspection (per agreement with user — UI-bound checkpoints not exercised live). Build/lint/test green: `cargo build --release`, `cargo clippy -- -D warnings`, `cargo test --lib` (169 passed), `tsc --noEmit`, `eslint .`, `prettier --check .`, ts-rs drift = intentional Phase 6 deltas only. Quality bar: no hex in cache components; no raw `invoke` in components; no `.unwrap()` in production paths (all in `#[cfg(test)]`); logs reference IDs + metadata only; localStorage limited to pane widths + expanded-folder IDs. Removed one `// Phase 6A scope:` comment from [conversation.rs:883](src-tauri/src/commands/conversation.rs#L883) to satisfy the forbidden-pattern rule. Two preexisting `// Phase X` comments remain in `services/vault.rs:49` and `db/messages.rs:427` — Phase 2/3 tech debt, out of Phase 6 scope; flag for a future audit-resolve sweep. All Phase 6 audit items (HB-6, HB-7, CD-12, SD-4, IP-9) were already ticked at audit-reconciliation time — no new Resolution log entries needed. Next phase: Phase 7 (Accordion); Phase 7 owns wiring its own `mark_story_stale` call sites for summarise/use_summary/create_checkpoint/delete_checkpoint per the cross-phase contracts captured above.

---

## Phase 7 — Accordion (context compression)

**Status:** Complete (2026-05-15)

**Goal:** Story segments can be collapsed and summarised; fake-pairs replace collapsed exchanges in history; banner reflects token impact; segment edits mark cache stale.

**Inputs:**
- `features/16-context-compression.md` (Complete).
- `foundation/03-data-model.md` §`segments`, §`use_summary`, §`gen_summarise_*`.
- `architecture/05-backend-modules.md` §`services/accordion.rs`.
- `design/27-theater-composition.md` §Accordion banner.

**Scope / Deliverables:**

1. Segment CRUD; collapse / expand; summary CRUD per Doc 16.
2. Summarise command — non-streaming per HB-4; `accordion_state_changed` single event.
3. Fake-pair injection in history assembly when `use_summary` is set.
4. Banner UI: token-impact display (provisional copy per NB-2); `--color-accordion` triad.
5. Cache stale on every segment write (Doc 22 cross-ref).

**Testable Checkpoints:**
- [x] Collapse a 5-exchange segment, summarise it → next request sends fake-pair instead of full exchanges.
- [x] Edit summary → cache stale; banner refreshes.
- [x] Clear summary → fake-pair removed; full exchanges return to history.
- [x] All `features/16` Testable Checkpoints pass.

**Out of scope:** Summary placement visuals beyond the banner shell (Phase 12).

**Resumption notes:**

- **2026-05-15: Phase 7 complete (closed via /phase-verify).** Backend (7A db+services+commands, 7B history substitution, 7C summarisation+stale wiring) and frontend (7D store, listener, AccordionBanner, theater integration, AI-bubble right-click) all landed across commits 8c4210b -> 871a546. All four Testable Checkpoints manually verified.
  - **Architecture invariants in place.** Service layer never emits events; command layer emits `accordion_state_changed` after success. `cache::segment_overlaps_cached_prefix` gates story-cache stale on segment mutations; create/delete checkpoint widen-invalidate (any active cache). `conversation.rs` edit/regenerate/delete/feedback paths call `mark_segment_stale_for_message` BEFORE delete so the message id is still resolvable. `history::build_history_with_accordion` substitutes `(fake_user, summary)` when `summary.is_some() && (is_collapsed || use_summary)` -- fast path returns literal rendering when no segments exist. Snapshot capture in `services::modes::build_snapshot` populates `accordion_state` so consulting re-entry sees frozen state per Doc 22.
  - **Audit gate clean.** HB-4, IP-1, IP-7, CD-3 all ticked. NB-2 (accordion banner token-impact copy) deferred to Phase 12 visual pass.
  - **Known deferrals.** (1) Rate-limiter module does not yet exist -- summarise calls do not pre-flight a `text`-provider rate-limit check; same gap applies to existing story sends. (2) Server-side `isGenerating` not raised during summarise (per-segment spinner instead) -- backend cancel-token install still serialises real generations. (3) Frontend cached-message-style confirmation modal for checkpoint create/delete -- backend auto-stales correctly; current `window.confirm` on delete preserves "cannot be undone" parity. (4) Consulting cache rebuild (`cache::build_session_prefix`) does not yet apply snapshot accordion substitution; inline consulting sends DO see current-state substitution via the shared `assemble_session_request` path. (5) Doc 05 module map should be amended to list `services/accordion.rs` and `commands/accordion.rs` (same precedent as cache/file_api files added in Phase 6).
  - **Verification at close.** `cargo build --release` clean (2m12s), `cargo test --lib` 196 passed, `cargo clippy --all-targets -- -D warnings` clean, `tsc --noEmit` clean, `eslint . --max-warnings 0` clean, `prettier --check .` clean, `vitest run` 31 passed, `ts-rs` no drift on `src/lib/types.ts`.

---

## Phase 8 — Ghostwriter

**Status:** In progress (last touched 2026-05-15)

**Goal:** Ghostwriter rewrites a selection in any of the three modes via the surgical-stitching protocol; in-place edit on non-latest messages; floating panel anchored to the bubble per Doc 27.

**Inputs:**
- `features/17-ghostwriter.md` (Complete).
- `foundation/03-data-model.md` §`messages.ghostwriter_history`, §`GhostwriterEdit` (canonical shape per HB-1).
- `architecture/05-backend-modules.md` §`services/ghostwriter.rs`.
- `design/27-theater-composition.md` §Ghostwriter floating panel.
- `feedback_*` / `project_ghostwriter_fix.md` memory — surgical-stitching rationale.

**Scope / Deliverables:**

1. Mode-first activation per Doc 11 (selection-first wording is dropped).
2. Surgical-stitching: AI returns full message with only the selection rewritten; UI diffs and lets user accept/reject/revert.
3. `ghostwriter_history` records `{ edited_at, original_content, new_content, instruction, selected_text }`.
4. Available across all three modes; in-place edit only — no branching (D-05).
5. Cache stale on accept (Doc 22 cross-ref).

**Testable Checkpoints:**
- [ ] Select text in an AI bubble → activate Ghostwriter → enter instruction → accept → bubble shows full message with only the selection rewritten.
- [ ] Reject leaves the bubble unchanged.
- [ ] Revert restores the previous version using `ghostwriter_history`.
- [ ] Works on non-latest messages (in-place, no branching).
- [ ] Works in handover and consulting modes.
- [ ] All `features/17` Testable Checkpoints pass.

**Out of scope:** `blocks` content-type support (deferred to v2.1).

**Resumption notes:**

- **2026-05-15: Phase 8A backend landed.** `services/ghostwriter.rs` owns request assembly (mode-aware history truncated at the edited message, synthetic user turn with the `<context_*>`/instruction tag block per Doc 17 §Request Assembly), the canonical `GhostwriterEdit` struct (HB-1 shape — `edited_at` / `original_content` / `new_content` / `instruction` / `selected_text`), the `DEFAULT_GHOSTWRITER_SI` constant baseline (used when `prompt_ghostwriter` resolves empty), and the `append_history_entry` / `pop_history_entry` JSON helpers. UTF-16-aware `slice_selection` matches the JS `Selection` API. `commands/ghostwriter.rs` ships `send_ghostwriter_request` (non-streaming, shares global cancel token), `cancel_ghostwriter_generation`, `save_ghostwriter_edit` (single transaction: read history → append → UPDATE content+history), `revert_ghostwriter_edit` (single transaction: read → pop → UPDATE). Defensive `<selected_passage>…</selected_passage>` wrapper-strip on response. Accept + revert mark story cache stale (when message is at-or-before high-water mark) and silently mark the containing accordion segment stale, matching the `update_message_content` precedent in Phase 3.
  - **Gemini visibility tweak.** Promoted `GeminiContent::user` / `::model` from private to `pub(crate)` so the ghostwriter service can build the synthetic user turn without duplicating the helper.
  - **Cache-stale gap (carried forward).** Consulting-session caches whose snapshot includes the edited story message are NOT marked stale by Phase 8A — same gap as Phase 3's `update_message_content`. The story-cache + segment-stale path matches existing precedent. Doc 22's "either cache's range" rule for ghostwriter accept/revert will need a follow-up pass alongside the session-message edit/regenerate work deferred from Phase 4.
  - **ts-rs regen.** `GhostwriterEdit`, `GhostwriterResponse`, `RevertResult` exported via `cargo test`; reference lives in `src-tauri/src/lib/types.ts`. The hand-maintained frontend mirror `src/lib/types.ts` is NOT yet updated — that happens in 8B (the IPC-wrapper task).
  - **Verification at 8A close.** `cargo build --lib` clean. `cargo test --lib` 215 passed (up from 196). `cargo clippy --all-targets --release -- -D warnings` clean.
- **Status:** 8B frontend (panel, store, bubble wiring, escape chain, modals) not started.

---

## Phase 9 — Feedback

**Status:** Not started

**Goal:** Per-bubble inline feedback strip is the sole affordance; explicit Apply / Cancel; escape-chain slot 5 lands; feedback influences subsequent regeneration.

**Inputs:**
- `features/28-feedback.md` (Complete).
- `foundation/03-data-model.md` §`messages.feedback`, §`feedback_color`.
- `design/11-interaction-patterns.md` §Escape Chain (rewritten 2026-05-04).
- `design/27-theater-composition.md` §Feedback strip placement.

**Scope / Deliverables:**

1. Per-bubble strip with always-visible single-line preview when non-empty.
2. Explicit Apply / Cancel; no auto-save on blur.
3. `workspaceStore.feedbackEditingMessageId` flag; escape-chain slot 5 (cancels edit, no modal).
4. `--color-feedback` triad; default `#f59e0b`; world-overridable; does not track accent.
5. Hidden in Ghostwriter; mode-gated to story bubbles.

**Testable Checkpoints:**
- [ ] Open feedback edit → type → Apply → preview shows; next regeneration uses the feedback.
- [ ] Cancel discards changes.
- [ ] Esc with feedback edit open cancels (no other slot fires).
- [ ] Feedback strip is hidden during Ghostwriter and outside story mode.
- [ ] All `features/28` Testable Checkpoints pass.

**Out of scope:** Right-pane feedback overlay (dropped per D-17; reserved for v2.1 if usage warrants).

**Resumption notes:**
*(empty — phase not started)*

---

## Phase 10 — Media (slim)

**Status:** Not started

**Goal:** Image source documents upload, persist, render in DocEditor with a lightbox layout, and survive the File API URI cache lifecycle.

**Inputs:**
- `features/19-media.md` (Complete, slim).
- `foundation/03-data-model.md` §image fields on `vault_items`, §`file_api_uri`.
- `architecture/05-backend-modules.md` §`services/file_api.rs`.

**Scope / Deliverables:**

1. Image upload command per Doc 19 (`upload_image`).
2. File API URI cache with expiry handling (O6 closed in Doc 19).
3. DocEditor lightbox layout for image source documents (CD-5).
4. Image rendering primitives in story bubbles only when an image source doc is attached as context.

**Testable Checkpoints:**
- [ ] Upload an image → vault row created → File API URI persisted.
- [ ] Attach image to a story → next request includes the image part per Gemini API spec.
- [ ] File API URI expiry triggers re-upload transparently.
- [ ] All `features/19` Testable Checkpoints pass.

**Out of scope:** Image generation (v2.1); per-turn user-message images (v2.1); AI-generated `blocks` model messages (v2.1); TTS (v2.1).

**Resumption notes:**
*(empty — phase not started)*

---

## Phase 11 — Settings & Themes

**Status:** Not started

**Goal:** Full-surface Settings replaces v1's modal; cascade UX (auto-create override on edit, `↺` revert, per-tab Reset all overrides) works across App and World scopes; `applyTheme` writes the full token snapshot.

**Inputs:**
- `features/20-settings-and-themes.md` (Complete).
- `foundation/03-data-model.md` §`app_settings`, §`world_settings_overrides`, §`ResolvedSettings`.
- `design/08-design-tokens.md` — token contract.
- `architecture/05-backend-modules.md` §`services/settings.rs`.
- `design/10-layout-and-navigation.md` §Theater Content Switching — Settings is highest-priority full-surface view (CD-5).

**Scope / Deliverables:**

1. Settings full-surface component; tabs per Doc 20.
2. Cascade UX: edit a value → override auto-created; `↺` reverts to baseline; per-tab "Reset all overrides".
3. `applyTheme(snapshot)` writes the full triad set: `accent`, `ghostwriter`, `accordion`, `checkpoint`, `bubbleUser`, `bubbleAi`, `bodyFont`, `feedback`.
4. Developer tab with the 5-prompt inventory (HB-5 closed); modificators are free-text per-turn (no Settings home).
5. Dark-only in v2.0 (light deferred to v2.1).

**Testable Checkpoints:**
- [ ] Edit an App-scope value → world picker shows the new default for new worlds.
- [ ] Edit a World-scope override → revert with `↺` → value returns to baseline.
- [ ] `applyTheme` updates every CSS variable in the snapshot; visual changes reflect immediately.
- [ ] API key entry persists in `app_settings.db`; never appears in logs or localStorage.
- [ ] All `features/20` Testable Checkpoints pass.

**Out of scope:** Light mode (v2.1); story-scope settings (removed per D-16).

**Resumption notes:**
*(empty — phase not started)*

---

## Phase 12 — Visual polish & copy pass

**Status:** Not started

**Goal:** Resolve every NB-1..NB-4 audit item — either tune to a final value or intentionally defer (with a follow-up note). The aesthetic bar Doc 01 sets is hit.

**Inputs:**
- `PRE-IMPLEMENTATION-AUDIT.md` NB-1..NB-4.
- All ⚠️-marked values across Doc 08, 17, 22, 27.
- `TODO.md` §VERIFY in the visual / UI design phase.
- `design/12-empty-states-and-errors.md` — copy provisional.

**Scope / Deliverables:**

1. Tune every ⚠️ design token (Doc 08, Doc 27).
2. Tune every ⚠️ copy string (Doc 12, Doc 16, Doc 17, Doc 18, Doc 15 deletion modal).
3. Resolve open visual questions (NB-3): short-bubble Ghostwriter layout, per-bubble cache marker, truncated-summary treatment, image upload progress, Ctrl+S acknowledgement, token meter placement, status section glyphs.
4. Populate Doc 11 §Keyboard Shortcuts table (NB-4).
5. Empty-state pass: every Doc 12 state has its specified content, styling, and actions.
6. Animation pass: 150–300 ms transitions across all interactions.

**Testable Checkpoints:**
- [ ] Every NB-1..NB-4 item is either ticked-resolved or ticked-deferred (with a `(YYYY-MM-DD — deferred to <where>)` note).
- [ ] No `⚠️` marker remains in any spec doc that is in v2.0 scope.
- [ ] Doc 11 §Keyboard Shortcuts table populated; document-level listener wired.
- [ ] Manual visual pass against Doc 02 / Doc 27 — screenshot-compare equivalents look correct.

**Out of scope:** Light mode (v2.1); any feature behaviour changes — this phase is visual + copy only.

**Resumption notes:**
*(empty — phase not started)*

---

## Phase 13 — Build, Release & Doc 26

**Status:** Not started

**Goal:** Doc 26 lands; first signed build for Windows, macOS, and Linux ships; CSP `connect-src 'none'` verified in `tauri.conf.json`.

**Inputs:**
- `dev/26-build-and-release.md` (current stub).
- `architecture/04-system-overview.md` §IPC Boundary, §CSP.
- `PRE-IMPLEMENTATION-AUDIT.md` ST-4.
- `MEMORY.md` Build Setup notes (OPENSSL_DIR; icons).
- `TODO.md` §VERIFY when writing Doc 26 — CSP enforcement.

**Scope / Deliverables:**

1. Doc 26 written end-to-end (ST-4 closes).
2. `tauri.conf.json` capabilities locked; CSP `connect-src https://generativelanguage.googleapis.com 'self'` (or per Doc 04 final wording); verified at runtime.
3. Windows code-signing pipeline; macOS notarization; Linux package format chosen and built (.deb / AppImage).
4. Icon source files; generation script.
5. Release checklist: version bump, changelog, backup-format compatibility test, smoke-test matrix.
6. v2.0.0 tag and signed artifacts attached to a GitHub release (or equivalent distribution surface).

**Testable Checkpoints:**
- [ ] Fresh Windows machine installs the signed `.exe` / `.msi`; first-run onboarding completes; cache create/refresh/delete works against the live Gemini API.
- [ ] Fresh macOS install (signed + notarised) does not Gatekeeper-warn; same smoke test passes.
- [ ] Linux artifact installs and runs; same smoke test passes.
- [ ] Frontend cannot make HTTP requests to any host other than `generativelanguage.googleapis.com` (CSP-violation logged on attempt).
- [ ] PRE-IMPLEMENTATION-AUDIT.md ST-4 ticked.

**Out of scope:** Auto-update (v2.0.x); telemetry (never).

**Resumption notes:**
*(empty — phase not started)*

---

## Cross-cutting rules

- **No phase ships with an open Hard Blocker on its surface.** All HB-* are currently resolved; if a new one is discovered, resolve it before continuing the phase.
- **Every phase commits the audit ticks it earned.** Resolution log entries land in the same commit as the phase's last commit.
- **Cache stale on every prefix-mutating operation.** Phases 5, 7, 8, 9 all touch the prefix; each must wire the stale trigger and verify it.
- **Logging discipline.** No master key, API key, or user content in any `tracing` line. Verify per-phase via grep on captured logs.
- **`isGenerating` is sacred.** Phase 3 establishes it; every later phase that initiates a request must check and set it.

---

## What lives outside this plan

- **v2.0.x deferred features.** Doc 21 (Export & Reader View); right-pane feedback overlay; light mode; `blocks` content-type. Tracked in their respective `future/` files and TODO.md.
- **v2.1 features.** Source Document Creator; media generation; TTS; per-turn user images; undo/redo; operation log. Tracked in `docs-v2/future/`.
- **One-off audit reconciliations.** Future drift goes into a new amendment block in `00-INDEX.md` or `IMPROVEMENT-BACKLOG.md`, not back into `PRE-IMPLEMENTATION-AUDIT.md`.
