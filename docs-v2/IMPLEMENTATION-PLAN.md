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

**Status:** Not started

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
- [ ] `cargo build --release` succeeds on Windows with `OPENSSL_DIR` set; `tsc --noEmit` clean; `eslint .` clean; `prettier --check` clean.
- [ ] `cargo test` runs and passes the substrate unit tests (lock helper, migrations applier, settings enum round-trip).
- [ ] `ts-rs` generates `src/lib/types.ts` from Rust structs; `npm run check:types` fails when the file is out of date and passes when regenerated.
- [ ] Cross-store import fixture (`appStore` importing `vaultStore`) fails ESLint with `no-cross-store-imports`.
- [ ] `001_initial.sql` applies to a fresh encrypted DB; `schema_migrations` row recorded; re-running boot is a no-op.
- [ ] `tracing` log output for a representative command does not contain master key, API key, or message content (manual `grep` check on captured logs).
- [ ] `husky` pre-commit hook blocks a deliberate clippy warning on a staged file.
- [ ] `appStore.appPhase` transitions from `onboarding` → `locked` → `workspace` driven by stub commands; conditional rendering switches the top-level component.
- [ ] PRE-IMPLEMENTATION-AUDIT.md SB-1, SB-2, SB-3, SB-4, SB-5, SB-6 all ticked with notes.

**Out of scope:** Any feature command (auth, vault, world CRUD); any UI beyond the three-phase shell; any visual styling beyond importing the Tailwind v4 base layer.

**Resumption notes:**
*(empty — phase not started)*

---

## Phase 0.5 — Testing Strategy (Doc 25)

**Status:** Not started

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
- [ ] Doc 25 written end-to-end; `00-INDEX.md` Document Map row flipped to Complete; D-NN umbrella added if a real architectural decision came out of the pass (else amend-only).
- [ ] PRE-IMPLEMENTATION-AUDIT.md ST-3 ticked with resolution-log entry.
- [ ] One canary unit test (Rust) and one canary component test (Vitest) committed and passing — proves the recipes work, not just describe them.
- [ ] Gemini SSE mock recipe demonstrated by a passing test that streams 3 chunks.
- [ ] Tauri IPC mock recipe demonstrated by a passing component test that asserts `invoke` was called with typed args.

**Out of scope:** Writing comprehensive test suites for every module (those land per-feature). Playwright E2E implementation if deferred.

**Resumption notes:**
*(empty — phase not started)*

---

## Phase 1 — Auth & Onboarding

**Status:** Not started

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
5. Tauri commands: `setup_password`, `unlock_app`, `lock_app`, `change_password` per Doc 07 §auth.
6. Frontend: onboarding flow (3-step wizard per Doc 13); lock screen; auto-lock timer wired against `app_settings`.
7. Master-key zeroing (`zeroize`) on lock and process exit.

**Testable Checkpoints:**
- [ ] Fresh launch with no `app_config.json` boots into onboarding; completing it produces the file, the sentinel, and `app_settings.db`.
- [ ] Wrong password on unlock is reported via a graceful error (Doc 12 copy); right password transitions to `workspace` phase (or `locked → world picker` if no worlds yet).
- [ ] Locking from workspace zeroes the master key (verified by inspecting `AppState` debug repr in a test build).
- [ ] Changing password generates a new salt, re-encrypts the sentinel, and re-keys the world DB(s) per A6.
- [ ] No `tracing` log line contains the master key, API key, or password (grep-verified across a representative session).
- [ ] All `features/13` Testable Checkpoints (cite the doc) pass.

**Out of scope:** API-key entry UI (lives in Settings — Phase 11), world creation (Phase 2), recovery flow (Doc 13 covers it; verify it ships here, but cosmetic copy can defer to Phase 12).

**Resumption notes:**
*(empty — phase not started)*

---

## Phase 2 — Vault & Worlds

**Status:** Not started

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
- [ ] Create world; close app; reopen; world appears in picker; opening it loads the empty workspace.
- [ ] Vault tree CRUD: create folder, create item, rename, drag to reparent, soft-delete to trash, restore — all reflected in DB and UI.
- [ ] World switch with `isGenerating=true` (mocked) prompts confirmation and aborts the in-flight request before swapping the connection.
- [ ] Backup → delete world → import → vault tree intact, settings overrides preserved.
- [ ] All `features/14` Testable Checkpoints pass.

**Out of scope:** Source document content editing (Phase 5); paperclip attach/detach UI (Phase 5 — model lands here, the UI affordance lands with DocEditor).

**Resumption notes:**
*(empty — phase not started)*

---

## Phase 3 — Conversation Engine (story mode)

**Status:** Not started

**Goal:** Story-mode round-trip works end-to-end: user sends a message, Gemini streams a response, history persists, `isGenerating` gates the UI, cancellation works. Mode-aware history assembly is scaffolded so Phase 4 (handover/consulting) is additive.

**Inputs:**
- `features/15-conversation-engine.md` (Complete).
- `foundation/03-data-model.md` §`messages`, §`stories`, §`story_state`.
- `architecture/05-backend-modules.md` §`services/conversation.rs`, §`services/gemini.rs`.
- `design/27-theater-composition.md` — bubble structure, Theater layout.
- `features/23-modes.md` (Complete) — read the story-mode subsections; defer handover/consulting to Phase 4.
- `dev/24-coding-standards.md` §Cancellation, §Logging.

**Scope / Deliverables:**

1. Server-side history assembly (Architecture Wall #1) — frontend sends `(story_id, leaf_id, user_content)` only.
2. Gemini streaming via `reqwest` SSE; `tokio_util::CancellationToken` per request.
3. Message lifecycle: persist user turn, stream AI turn, finalise on completion or cancellation.
4. `workspaceStore.isGenerating` global flag gating Send / lock / world-switch (Architecture Wall #6).
5. Theater: user bubbles, AI bubbles, in-flight streaming bubble, status section.
6. Edit + delete (no branching — D-05). Soft delete with `deleted_at`; UI confirmation copy per Doc 15.
7. Token meter wired to Status section (visual placement deferred to Phase 12 per NB-3).

**Testable Checkpoints:**
- [ ] Send message → AI response streams in chunks → final state persisted; reload restores the conversation.
- [ ] Cancel mid-stream → request aborts; partial AI message persisted with a `cancelled` marker per Doc 15.
- [ ] Edit a user message in the latest exchange → next regeneration uses the edited content.
- [ ] Delete an exchange → confirmation modal → soft-delete → exchange disappears from Theater.
- [ ] `isGenerating=true` blocks the Send button, lock action, and world-switch.
- [ ] Logs do not contain message content (grep-verified).
- [ ] All `features/15` Testable Checkpoints pass.

**Out of scope:** Handover and consulting modes (Phase 4); context caching (Phase 6); accordion (Phase 7); ghostwriter (Phase 8); feedback (Phase 9). The engine must be designed so each of those slots in additively.

**Resumption notes:**
*(empty — phase not started)*

---

## Phase 4 — Modes (handover + consulting)

**Status:** Not started

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
- [ ] Switching from story to handover shows the handover shell; running it produces a report; switching back leaves the story state intact.
- [ ] Consulting session persists and restores on reopen; deleting the session falls back silently per CD-9.
- [ ] `active_mode` round-trips through `story_state`.
- [ ] All `features/23` Testable Checkpoints pass.

**Out of scope:** Caching of handover/consulting prefixes (Phase 6 decides which modes cache).

**Resumption notes:**
*(empty — phase not started)*

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
