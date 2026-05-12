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

**Status:** Not started

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
- [ ] Edit a doc; close DocEditor without explicit save; reopen — content persists.
- [ ] Lock app mid-edit → `flushDocSave` runs → unlock shows the saved content.
- [ ] Attach two docs to a story; reorder; detach one — `context_doc_ids` order matches the UI.
- [ ] Soft-delete a vault item that is attached → `attachment_history` records `event='detach', reason='soft_delete'`.
- [ ] All `features/18` Testable Checkpoints pass.

**Out of scope:** Source Document Creator (deferred to v2.1, `docs-v2/future/source-document-creator.md`); image rendering (Phase 10); cache stale-on-attach (Phase 6).

**Resumption notes:**
*(empty — phase not started)*

---

## Phase 6 — Context Caching

**Status:** Not started

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
- [ ] Send a message above `cache_min_tokens` → cache row created in DB and visible in right pane.
- [ ] Edit an attached doc → cache marked stale; amber dot on Send button.
- [ ] Refresh TTL → expiry advances; UI countdown updates.
- [ ] Delete cache → row gone; next request goes inline.
- [ ] Sub-threshold message → inline path used; no cache row created.
- [ ] All `features/22` Testable Checkpoints pass.

**Out of scope:** Cache visuals beyond the row format (token colors, density — Phase 12 per O10 residual).

**Resumption notes:**
*(empty — phase not started)*

---

## Phase 7 — Accordion (context compression)

**Status:** Not started

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
- [ ] Collapse a 5-exchange segment, summarise it → next request sends fake-pair instead of full exchanges.
- [ ] Edit summary → cache stale; banner refreshes.
- [ ] Clear summary → fake-pair removed; full exchanges return to history.
- [ ] All `features/16` Testable Checkpoints pass.

**Out of scope:** Summary placement visuals beyond the banner shell (Phase 12).

**Resumption notes:**
*(empty — phase not started)*

---

## Phase 8 — Ghostwriter

**Status:** Not started

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
*(empty — phase not started)*

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
