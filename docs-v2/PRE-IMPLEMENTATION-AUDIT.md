# LOOM 2.0 — Pre-Implementation Audit

> **Created:** 2026-05-03 — cross-doc audit performed at the close of the planning phase, before any LOOM 2.0 code is written.
> **Purpose:** Inventory every contradiction, drift, and gap found between the 23 spec docs in `docs-v2/`. Each item is actionable and has an owner-doc that must change.
> **How to use this file:** Treat it as a checklist. When you resolve an item, flip `- [ ]` to `- [x]` and append `(YYYY-MM-DD — <one-line note: which doc was edited, which D-NN was added/amended>)`. Do not delete resolved items — they form the audit trail.
> **Authority:** `00-INDEX.md` D-NN entries remain canonical. This file points at *where the docs disagreed*; resolution happens by amending the affected doc(s) and (where the resolution constitutes a real decision) adding a D-NN umbrella block per `COWORKING.md` §6.

---

## How items are scoped

- **Hard blockers** — would fail at compile time, runtime, or first integration. Must be resolved before the feature touched is implemented. Block the *feature*, not the substrate.
- **Cross-doc inconsistencies** — semantic drift between two docs that prescribe the same surface. Pick one, amend both.
- **Schema drift** — a field, key, enum value, or column that one doc references and Doc 03 doesn't define (or vice versa).
- **IPC drift** — command name, signature, event name, or event payload that disagrees between Doc 07 and a feature doc.
- **Stub doc gaps** — concrete content missing from Doc 21 / 24 / 25 / 26 that blocks a downstream activity.
- **Soft blockers / substrate** — items from `IMPROVEMENT-BACKLOG.md` that should land before the first command file is written, otherwise v1.0-style drift recurs.
- **Provisional / non-blocking** — flagged ⚠️ values that need tuning during the visual phase but do not gate substrate or feature implementation.

---

## Hard blockers

- [x] **HB-1 — `GhostwriterEdit` interface defined twice with incompatible shapes.**
  - Doc 03 §Conversation (around line 573–580): `{ original, revised, instruction, accepted, created_at }`.
  - Doc 17 §Accept Flow (around line 264–272): `{ edited_at, original_content, new_content, instruction, selected_text }` — no `accepted` field.
  - **Resolution lean:** Doc 17's richer shape wins (`edited_at`, `original_content`, `new_content`, `instruction`, `selected_text`); load-bearing for surgical-stitching.
  - **Owner doc:** `foundation/03-data-model.md` (update interface) + `messages.ghostwriter_history` field comment.

- [x] **HB-2 — `attachment_history` column name and missing field.**
  - Doc 03 schema: `action TEXT CHECK(action IN ('attach','detach'))`. No `reason` column.
  - Doc 18 §Soft-delete writes `(event = 'detach', reason = 'soft_delete')` and §Attach/Detach uses `event` throughout.
  - **Resolution lean:** rename `action` → `event` in Doc 03 schema; add `reason TEXT NULL` column for the soft-delete-cascade audit trail.
  - **Owner doc:** `foundation/03-data-model.md` §`attachment_history`.

- [x] **HB-3 — Doc 11 escape chain contradicts Doc 18 on DocEditor save behaviour.**
  - Doc 11 line 25–26: prescribes "DocEditor open with unsaved changes → Discard changes? confirmation".
  - Doc 11 §Confirmation Dialogs table: lists "Discard unsaved DocEditor changes: Yes".
  - Doc 18 lines 110–116: explicitly says **no Save button, no on-blur trigger, no unsaved-changes guard modal** (debounced auto-save with `flushDocSave()` on close/lock/world-switch).
  - **Resolution lean:** Doc 18 wins (it's the design pass for D-13). Strip the escape-chain step + confirmation row from Doc 11.
  - **Owner doc:** `design/11-interaction-patterns.md`.

- [x] **HB-4 — Doc 07 ↔ Doc 16 accordion command/event drift (5 items in one).**
  - Doc 07: `load_accordion`. Doc 16: `get_accordion_state`.
  - Doc 07: `edit_segment_summary`. Doc 16: `update_segment_summary`.
  - Doc 07: `cancel_summarise_segment` exists. Doc 16: explicitly says no separate cancel — `cancel_generation` covers it.
  - Doc 07: missing `clear_segment_summary` (Doc 16 specifies it).
  - Doc 07: lists 4 streaming events (`accordion_summarise_chunk/complete/failed/cancelled`). Doc 16: explicitly non-streaming, single `accordion_state_changed` event.
  - Event payload: Doc 07 `{ story_id, segments, checkpoints }`. Doc 16: `{ story_id, segment_id?, checkpoint_id? }`.
  - **Resolution lean:** Doc 16 is the design pass for D-12; rewrite Doc 07's accordion section to match.
  - **Owner doc:** `architecture/07-ipc-contracts.md` §accordion.

- [x] **HB-5 — `prompt_handover_seed` and `prompt_consulting_seed` referenced but not defined in `app_settings`.**
  - Referenced by Doc 06 (`settingsStore.restorePromptDefault` enum, around line 255), Doc 07 line 145 (`restore_prompt_default` enum), Doc 20 §Developer tab (5-prompt inventory).
  - Missing from Doc 03 §`app_settings` known-keys table.
  - **Resolution lean:** add both keys to Doc 03's `app_settings` table with default `*(long)*` and Developer-only marking, matching the existing 3 prompts.
  - **Owner doc:** `foundation/03-data-model.md` §`app_settings`.

- [x] **HB-6 — Five `LoomError` variants used by feature docs but missing from Doc 05's enum.**
  - `LoomError::Forbidden` — used by `delete_template` for built-ins (Doc 07 line 148, Doc 20 line 334).
  - `LoomError::ProtectedSentinel` — used by Doc 16 §Errors for start-checkpoint deletion.
  - `LoomError::InvalidSettingValue { key, reason }` — used by Doc 20 §Validation; structured payload.
  - `LoomError::NoBaseline { key }` — used by Doc 20 §Edge Cases for restore-default with no hardcoded baseline.
  - `LoomError::CacheCreate` — used by Doc 23 §Errors for consulting-cache creation failure.
  - Doc 05's existing 9 variants: `Crypto, Database, NotFound, Validation, ApiError, RateLimited, Io, Serialization, Internal`.
  - **Resolution lean:** add `Forbidden` (its semantics genuinely differ from `Validation`); convert the other four to structured `Validation { key: String, reason: String }` payloads. Update each feature doc's error column to reference the agreed mapping.
  - **Owner doc:** `architecture/05-backend-modules.md` §`LoomError` (canonical), then propagate to Docs 16, 17, 20, 23 error tables.

- [x] **HB-7 — Three load-bearing `services/` modules missing from Doc 05's module map.**
  - `services/cache.rs` — referenced by Doc 22 lines 380–388 (7 helper functions) and consumed by `commands/cache.rs` and `commands/conversation.rs`.
  - `services/file_api.rs` — referenced by Doc 19 §`get_or_upload_file_api_uri`, called from request-assembly paths.
  - `services/settings.rs` — listed in Doc 05 but its export contract (per-key validators per Doc 20 §Validation) is undocumented.
  - **Resolution lean:** add all three to Doc 05's module ownership table with a one-line responsibility statement and the symbols they export.
  - **Owner doc:** `architecture/05-backend-modules.md` §Module Structure.

---

## Cross-doc inconsistencies

- [x] **CD-1 — Theme API surface mismatch between Doc 08 and Doc 20.**
  - Doc 08 §Runtime Theme API: 5 functions (`applyAccentColor`, `applyBodyFont`, `applyBubbleColors`, `applyFeatureColors`, `applyAllTheme`).
  - Doc 20 §`applyTheme()` Contract: single `applyTheme(snapshot: ThemeSnapshot)` with `{ accent, ghostwriter, accordion }`.
  - `body_font`, `bubble_user_color`, `bubble_ai_color`, `checkpoint_color` are world-overridable in Doc 03 but absent from Doc 20's snapshot.
  - **Resolution lean:** Doc 20's single-function API wins (D-16 explicitly locked it). Expand the snapshot type to cover every world-overridable visual key, or document that those keys are read directly by their consumer components (not via `applyTheme`). Pick one. Then amend Doc 08 to match.
  - **Owner doc:** `design/08-design-tokens.md` + `features/20-settings-and-themes.md`.

- [x] **CD-2 — Ghostwriter token name drift across Docs 08, 17, 20, 03.**
  - Doc 08: `--color-ghostwriter-frame`, `--color-ghostwriter-diff`.
  - Doc 17 references: `--color-ghostwriter-frame`, `--color-ghostwriter-diff` (lines 49, 108, 243).
  - Doc 20 writes: `--color-ghostwriter`, `--color-ghostwriter-hover`, `--color-ghostwriter-subtle`.
  - Doc 03 settings keys: `ghostwriter_frame_color` (no `ghostwriter_diff_color`).
  - **Resolution lean:** pick one naming convention (probably `--color-ghostwriter-{accent,hover,subtle,diff}` mirroring the accent triad pattern). Update Doc 03 setting key, Doc 08 token list, Doc 17 references, Doc 20 `applyTheme()` body.
  - **Owner doc:** all four; lead with `design/08-design-tokens.md`.

- [x] **CD-3 — `--color-checkpoint` token retention.**
  - Doc 08 flags it as "may be removed when Doc 16 is written."
  - Doc 16 banners use it (each checkpoint renders as a banner per Doc 27); Doc 27 references it.
  - **Resolution lean:** retain. Remove the speculative-removal note from Doc 08.
  - **Owner doc:** `design/08-design-tokens.md`.

- [x] **CD-4 — Doc 09 `Slider` use case references removed feature.**
  - Doc 09 lists "Output length slider in InputArea" as the use case.
  - Doc 15 §User Input Fields lines 80–82: output-length preset removed.
  - **Resolution lean:** delete the use case or replace with another live slider (e.g. `gen_temperature` in Settings → Gemini).
  - **Owner doc:** `design/09-component-library.md`.

- [x] **CD-5 — Doc 10 missing Settings as a content surface.**
  - Doc 10 §Theater Content Switching only knows `<Theater>`, `<DocEditor>`, `<ImageViewer>`.
  - Doc 20 specifies Settings as a full workspace surface (hides mode switcher + right pane, `← Back` to exit) — same pattern as DocEditor.
  - **Resolution lean:** add Settings to Doc 10's content-switching priority list; collapse `<ImageViewer>` into `<DocEditor>` (Doc 18 says image source documents share the editor with a lightbox layout).
  - **Owner doc:** `design/10-layout-and-navigation.md`.

- [x] **CD-6 — Doc 11 Escape chain incomplete.**
  - Missing: Settings open (`← Back` exits, per Doc 20).
  - Missing: Ghostwriter `reviewing` phase confirmation modal nuance (Doc 17 specifies four phase-sensitive Escape behaviours; Doc 11 only says "Ghostwriter active → cancel").
  - Stale: step 2 references "Feedback panel expanded" — Doc 15 specifies feedback as per-bubble inline UI, not a panel.
  - **Resolution lean:** rewrite Doc 11 §Escape Chain in priority order, taking the per-feature behaviours from Docs 17, 18, 20 as authoritative.
  - **Owner doc:** `design/11-interaction-patterns.md`.

- [x] **CD-13 — Feedback affordance not specified.**
  - Doc 15 §Feedback says "Doc 11 owns the affordance"; Doc 11 has no affordance section. Doc 27 §AI Bubble flags the visual treatment as ⚠️ provisional.
  - The affordance is the missing input for CD-6 (Escape Chain priority slot for "Feedback edit open").
  - **Resolution lean:** new feature doc `28-feedback.md` covers the bubble strip, edit interaction, action-row entry, mode-gating, save semantics, token triad, escape-chain priority, and frontend state. Drop v1.0's right-pane Feedback Overlay; explicit Apply / Cancel; introduce `--color-feedback` triad; `workspaceStore.feedbackEditingMessageId` flag.
  - **Owner doc:** `features/28-feedback.md` (new) + propagation set per D-17.

- [x] **CD-7 — Doc 06 vs Doc 14 vaultStore field shapes.**
  - Doc 06: `selectedIds: Set<string>`, no `expandedFolderIds`, no `trashItems`, fields `filterText` and `showTrash`.
  - Doc 14: `selectedIds: string[]`, `expandedFolderIds: string[]`, `trashItems`, fields `filterQuery` and `isTrashView`.
  - **Resolution lean:** pick one set of names + one type for `selectedIds`. Doc 14 is the feature doc; let it win. Update Doc 06 to match.
  - **Owner doc:** `architecture/06-frontend-architecture.md` §vaultStore.

- [x] **CD-8 — `attach_context_doc` return type drift.**
  - Doc 18 backend signature: returns `Vec<String>` (the new context_doc_ids order).
  - Doc 06 wrapper: `attachDoc: (docId) => Promise<void>` discards the return.
  - **Resolution lean:** change wrapper to return the order; the frontend uses it to update `workspaceStore` without a follow-up `loadAttachedDocs` round-trip.
  - **Owner doc:** `architecture/06-frontend-architecture.md` (wrapper signature).

- [x] **CD-9 — Doc 23 `active_session_id` persistence undecided.**
  - Doc 23 line ~422: "`modeStore.activeSessionId` persisted in `story_state` (TBD — may live as `story_state.active_session_id` key)".
  - Doc 03 `story_state` known-keys table: doesn't list it.
  - **Resolution lean:** commit to persistence — add `active_session_id: string | null` key to Doc 03 §`story_state`. Re-opening a story in mid-consulting feels worse than a no-op.
  - **Owner doc:** `foundation/03-data-model.md` + `features/23-modes.md`.

- [x] **CD-10 — Doc 02 §Red Lines #2 not aligned with its own Amendment A-02-A.**
  - Line 11 still says "API key exists only in `AppState` and the encrypted `settings` table" (the world `settings` table).
  - Amendment A-02-A correctly moved API key to `app_settings.db`.
  - **Resolution lean:** edit line 11 in place to reference `app_settings.db`. Preserve the Amendment block as the change record.
  - **Owner doc:** `foundation/02-security-model.md`.

- [x] **CD-11 — Doc 04 §IPC Boundary uses dead event as example.**
  - Line ~78 mentions `branch_map_updated` as an example event. Branching is removed (D-05).
  - **Resolution lean:** swap example to a real v2.0 event, e.g. `vault_updated` or `cache_state_changed`.
  - **Owner doc:** `architecture/04-system-overview.md`.

- [x] **CD-12 — Doc 22 `cache_enabled` setting undefined in Doc 03.**
  - Doc 22 line ~240 references `cache_enabled = false` as a world override (fallback-to-inline path).
  - Doc 03 overridable-keys table: no such key.
  - **Resolution lean:** add `cache_enabled BOOLEAN default true` to Doc 03's world-overridable list, or remove the inline-fallback condition from Doc 22 and let cache always be on.
  - **Owner doc:** `foundation/03-data-model.md` (if we keep the toggle) + `features/22-context-caching.md`.

---

## Schema drift

- [x] **SD-1 — `attachment_history.event` (Doc 18) vs `action` (Doc 03).** See HB-2.
- [x] **SD-2 — `attachment_history.reason` column missing from Doc 03.** See HB-2.
- [x] **SD-3 — `prompt_handover_seed` / `prompt_consulting_seed` missing from `app_settings` keys.** See HB-5.
- [x] **SD-4 — `cache_enabled` referenced by Doc 22 but not in Doc 03 overridable list.** See CD-12.
- [x] **SD-5 — `story_state.active_session_id` speculated but not defined.** See CD-9.
- [x] **SD-6 — `MessageBlock.content` shape under-specified for `'blocks'` content type.** Doc 03 says "text: prose; image: base64 or empty". Doc 19 defers `'blocks'` to v2.1; flag the field as v2.1-reserved with a more precise spec when v2.1 design starts.
  - **Owner doc:** `foundation/03-data-model.md` §`MessageBlock` — add v2.1-reserved note.

---

## IPC drift

- [x] **IP-1 — Accordion command names + events mismatch (HB-4).**
- [x] **IP-2 — `vault_read_item` referenced by Doc 19 but not defined.**
  - Doc 19 line ~63 says items "exposed via `vault_read_item` for debugging". No such command in Doc 07 or Doc 14.
  - **Resolution lean:** drop the reference (debugging affordance can use existing `get_item`).
  - **Owner doc:** `features/19-media.md`.
- [x] **IP-3 — `update_world_meta(patch: WorldMetaPatch)` arg type undefined.**
  - Doc 14 declares the command. `WorldMetaPatch` not defined in Doc 03 or Doc 14.
  - **Resolution lean:** define as `Partial<WorldMeta>` shape (TS) / `struct WorldMetaPatch { name: Option<String>, tags: Option<Vec<String>>, accent_color: Option<String>, cover_image_path: Option<Option<String>> }` (Rust).
  - **Owner doc:** `foundation/03-data-model.md` (interface) + `features/14-vault-and-worlds.md` (command).
- [x] **IP-4 — `attach_context_doc` return type drift (CD-8).**
- [x] **IP-5 — `save_ghostwriter_edit` history-entry shape (HB-1).**
- [x] **IP-6 — `branch_map_updated` example in Doc 04 (CD-11).**
- [x] **IP-7 — `accordion_state_changed` payload shape mismatch (HB-4).**
- [x] **IP-8 — `vault_updated` payload undefined in Doc 18 attach/detach paths.**
  - Doc 07: `{ world_id }`. Doc 18 emits the event without specifying payload.
  - **Resolution lean:** keep `{ world_id }` and document in Doc 18 that this is sufficient (frontend reloads via `list_items`).
  - **Owner doc:** `features/18-source-documents.md`.
- [x] **IP-9 — Missing TypeScript interfaces for IPC payloads.**
  - `ResolvedSettings` (return of `get_resolved_settings`).
  - `Telemetry` (return of `get_telemetry`, payload of `telemetry_tick`).
  - `AliveCacheRow` (return of `list_alive_caches`, Doc 22 line ~374).
  - `UnlockResult { has_api_key: bool, auto_lock_secs: u64 }` (Doc 13 returns from `unlock_vault`).
  - `WorldMetaPatch` (IP-3).
  - `GhostwriterResponse`, `RevertResult` (Doc 17 commands).
  - **Resolution lean:** add all to Doc 03 §TypeScript Interfaces. (R4 — `ts-rs` — would prevent this class entirely; see SB-3.)
  - **Owner doc:** `foundation/03-data-model.md` §TypeScript Interfaces.

---

## Stub doc gaps

- [x] **ST-1 — Doc 21 (Export and Reader View): not implementation-ready.**
  - Missing: command signatures (`export_story`, `enter_reader_view`, etc.).
  - Missing: format spec for Markdown / plain text / JSON output bodies.
  - Missing: file extension, naming convention, destination dialog.
  - Missing: how handover/consulting sessions render in markdown vs JSON ("appendix" mentioned without template).
  - Missing: Reader View entry/exit behaviour (Doc 11 escape chain references it; no implementation spec).
  - Missing: frontend state location.
  - **Resolution lean:** v2.0 can defer this entirely. World Backup (`.loom-backup` zip) ships in Doc 14 §World Backup; that's the only resilience deliverable v2.0 must ship. Mark Doc 21 as deferred-to-v2.0.x and keep the stub.
  - **Owner doc:** `features/21-export-and-reader.md` (status note) + `00-INDEX.md` (status flip).

- [x] **ST-2 — Doc 24 (Coding Standards): empty TOC.**
  - **Required for day-1 implementation.** Without this:
    - ESLint config can't be written (R3 store-boundary rule has no home).
    - Clippy lints aren't enumerated.
    - Lock-helper rule (R17) has no canonical statement.
    - Logging rules (no master key / API key / user content) live only in CLAUDE.md.
    - Component size budget (R19) has no home.
    - Pre-commit hooks (clippy + tsc + eslint + prettier) are unspec'd.
  - **Resolution lean:** draft Doc 24 in the same session that lands the substrate tooling. Source content from CLAUDE.md `.claude/rules/code-standards.md` and `pitfalls-and-reference.md` (≈80% of the content already exists in those rule files).
  - **Owner doc:** `dev/24-coding-standards.md`.

- [x] **ST-3 — Doc 25 (Testing Strategy): skeleton only.**
  - Missing: concrete commands (`cargo test`, `vitest run`) and coverage targets.
  - Missing: in-memory SQLite fixture pattern (non-encrypted for unit tests).
  - Missing: Gemini SSE mock recipe.
  - Missing: Tauri IPC mock pattern (mock `@tauri-apps/api/core` `invoke`).
  - Missing: Playwright E2E plan (or decision to skip).
  - **Resolution lean:** can lag substrate by 1–2 sessions; write before the first feature command lands.
  - **Owner doc:** `dev/25-testing-strategy.md`.
  - (2026-05-07 — Doc 25 written end-to-end in Phase 0.5; all recipes demonstrated by passing canary tests; Playwright E2E explicitly deferred to v2.0.x with rationale.)

- [ ] **ST-4 — Doc 26 (Build and Release): skeleton only.**
  - Missing: Windows OpenSSL setup steps (CLAUDE.md MEMORY.md has `OPENSSL_DIR=...` not migrated).
  - Missing: macOS code-signing / notarization workflow.
  - Missing: Windows code-signing approach.
  - Missing: Linux package format choice (.deb / AppImage / Snap).
  - Missing: `tauri.conf.json` capability list with `connect-src 'none'` CSP per Doc 04.
  - Missing: icon source files + generation script.
  - Missing: release checklist (version bump, changelog, backup-format compatibility test).
  - **Resolution lean:** can lag substrate by several sessions; needed before first packaged release.
  - **Owner doc:** `dev/26-build-and-release.md`.

---

## Soft blockers (substrate work — must land before features)

These are restated from `IMPROVEMENT-BACKLOG.md` because the audit confirmed they are real prerequisites for v2.0 implementation, not just nice-to-haves.

- [x] **SB-1 — R2: Typed `AppSettingKey` / `StoryStateKey` enums.**
  Without these, the `prompt_handover_seed` class of drift (HB-5) recurs every time a setting is added. Land before any settings-touching command.
  (2026-05-07 — `AppSettingKey` + `StoryStateKey` enums in `src-tauri/src/db/settings.rs`; `get_setting<T>` generic accessor; Phase 0 scaffold.)

- [x] **SB-2 — R3: ESLint `no-cross-store-imports` rule.**
  Doc 06's "stores never import each other" rule is convention-only without this. Land before the second store is wired.
  (2026-05-07 — `eslint-rules/no-cross-store-imports.js` + `eslint-rules/__fixtures__/` + `scripts/check-eslint-fixture.mjs`; fixture test passes — deliberate cross-store import fires the rule.)

- [x] **SB-3 — R4: `ts-rs` (or `specta`) for TypeScript type generation.**
  Auto-fixes the missing-interface class (IP-9: `ResolvedSettings`, `Telemetry`, `AliveCacheRow`, `UnlockResult`, `WorldMetaPatch`, `GhostwriterEditRecord`, `GhostwriterResponse`, `RevertResult`). Land in the first implementation session — retrofitting is much more expensive.
  (2026-05-07 — `ts-rs` wired; `tests/ts_rs_export.rs` generates `src/lib/types.ts`; `pnpm check:types` drift-check passes.)

- [x] **SB-4 — R7: Cancellation token lifecycle spec in Doc 05.**
  Doc 15, Doc 16, Doc 17 all reference `tokio_util::CancellationToken` / `AbortHandle`. Doc 05's `AppState.cancel_tx` is a single `Mutex<Option<Sender<bool>>>` — must clarify per-request lifecycle and document the "next request creates a fresh token; cancel of the old one is a no-op on the new" invariant.
  **Owner doc:** `architecture/05-backend-modules.md` §Cancellation Lifecycle (new subsection).
  (2026-05-07 — `AppState.cancel_tx: Mutex<Option<CancellationToken>>` in `state.rs`; `with_cancel_tx` helper; per-request lifecycle per Doc 05.)

- [x] **SB-5 — R17: Lock-access helper (`with_active_conn`, `with_master_key`, etc.).**
  v1.0 had 118 occurrences of the four-line lock-and-format-error idiom. v2.0 must land the helper before the first command, otherwise the boilerplate compounds and the lock-ordering rule becomes inspection-only.
  **Owner doc:** `architecture/05-backend-modules.md` §AppState (canonical access pattern) + `dev/24-coding-standards.md` (forbid raw `.lock()` on AppState fields).
  (2026-05-07 — `with_active_conn`, `with_master_key`, `with_api_key`, `with_cancel_tx` on `AppState` in `state.rs`; all Tauri commands use these helpers.)

- [x] **SB-6 — R18: Versioned schema migration system.**
  Doc 03 §Migration Strategy is one line ("clean rewrite, no migration required"). True v1→v2; not true going forward. `templates.creator_instructions` and `messages.deleted_at` are reserved for v2.1 and *will* require a migration.
  **Resolution lean:** add a `schema_migrations` table + numbered SQL files under `db/migrations/`. The initial v2.0 schema is `001_initial.sql`. Land before any post-launch DDL change.
  **Owner doc:** `foundation/03-data-model.md` §Migration Strategy + `architecture/05-backend-modules.md` §db.
  (2026-05-07 — `db/migrations.rs` + `migrations/world/001_initial.sql` + `migrations/app/001_initial.sql`; 21/21 Rust tests pass including migration round-trip.)

---

## Provisional / non-blocking

These are flagged ⚠️ across the docs and need tuning during the visual-design phase, but **do not block substrate or feature implementation.** Listed for completeness; do not check off until each is intentionally tuned (not just touched).

- [ ] **NB-1 — Design tokens marked ⚠️.** Most hex values in Doc 08; all visual values in Doc 27; Ghostwriter panel width (~300px) in Doc 17; cache TTL color thresholds in Doc 22; auto-create cache threshold (`cache_min_tokens = 4096`, see TODO O16); banner partition tints in Doc 27.
- [ ] **NB-2 — Copy strings marked ⚠️.** Empty-state subtext (Doc 12); accordion banner token-impact format (Doc 16); confirmation modal copy (Doc 18 read-only banner); Ghostwriter panel hint text (Doc 17); deletion confirmation modal "this cannot be undone in v2.0" (Doc 15 — TODO notes the version-number framing should be tuned).
- [ ] **NB-3 — Open visual questions in feature docs.**
  - Short-bubble Ghostwriter panel layout (Doc 17 line ~72).
  - Per-bubble cache-membership marker (Doc 27 line ~291).
  - Truncated-summary visual treatment (Doc 16 line ~554).
  - Multi-file image upload progress indicator (Doc 19 line ~113).
  - Ctrl+S muscle-memory acknowledgement (Doc 18 line ~142).
  - Token meter UI placement (Doc 15 line ~175).
  - Status section glyphs and copy (TODO §VERIFY in visual phase).
- [ ] **NB-4 — Keyboard shortcut table.** Doc 11 §Keyboard Shortcuts is intentionally a stub (IN-11 in `IMPL-NOTES.md`). Implementation can register the document-level listener now and populate the table later.

---

## TODO items confirmed still load-bearing for substrate

Cross-referenced from `TODO.md`:

- [ ] **TD-1 — O16: `cache_min_tokens` empirical verification.** Default 4096 (Doc 03) is provisional. Verify during testing phase. Not a blocker for substrate.
- [x] **TD-2 — Q24: Export bundle format (Doc 21).** Soft-block on Doc 21 status decision (see ST-1).
- [x] **TD-3 — Active session persistence key.** See CD-9.
- [ ] **TD-4 — Token meter UI placement.** See NB-3.
- [ ] **TD-5 — O18: Operation-log entries should mark cache stale.** Belongs in `docs-v2/future/undo-redo.md`. Not a v2.0 blocker.

---

## What's actually ready to start (audit conclusion)

**Substrate yes, features no — yet.**

Auth (Doc 13), vault tree + world CRUD (Doc 14), the Tauri shell, the lock screen, and the World Picker are internally consistent and reference Doc 03 / Doc 07 cleanly. **Implementation can start immediately on:**

1. The substrate tooling (SB-1 through SB-6).
2. Doc 24 (Coding Standards) drafted alongside the substrate.
3. Auth + vault + world CRUD command implementation.

**Feature implementation on Ghostwriter (Doc 17), Accordion (Doc 16), Settings (Doc 20), and Source Documents (Doc 18) should not start until the relevant Hard Blockers above are resolved** — those four docs reference fields, commands, events, and error variants that do not exist in their canonical sources. Implementing against drift compounds it; resolving drift first is cheap (each Hard Blocker is one or two doc edits + a propagation pass).

Doc 21 (Export and Reader), Doc 25 (Testing), and Doc 26 (Build & Release) can be drafted asynchronously without blocking implementation, in priority order: Doc 25 before the first feature commit, Doc 26 before the first packaged release, Doc 21 deferred to v2.0.x.

---

## Resolution log

When an item is resolved, append a short note here in addition to ticking the checkbox above.

---

**2026-05-03 — Pre-implementation audit resolution batch.** 6/7 Hard Blockers, 11/12 Cross-Doc Inconsistencies, all Schema and IPC drift, ST-1 (Doc 21 deferral), TD-2 and TD-3 resolved. CD-6 (Escape Chain rewrite) deferred — depends on the new Feedback affordance design pass (CD-13, to be added in the next session). No new D-NN umbrella — these are reconciliation amendments rather than architectural decisions; each is captured in the touched doc's Last-updated header. 00-INDEX.md header date-stamped with the full list of touched docs.

Per-item notes:

- **HB-1** — Updated Doc 03 §Conversation interface block: `GhostwriterEdit` now `{ edited_at, original_content, new_content, instruction, selected_text }` matching Doc 17. Doc 17 cross-reference updated to point at Doc 03 as canonical.
- **HB-2** — Doc 03 §`attachment_history`: `action` → `event`; added `reason TEXT NULL` column with documented values (`'soft_delete'` for cascade detaches, `NULL` for user actions). Doc 18 attach/detach behaviour updated to write `reason = NULL` for user actions.
- **HB-3** — Doc 11 §Escape Chain: removed step 4 (DocEditor unsaved-changes confirmation) and shifted remaining steps. Doc 11 §Confirmation Dialogs: removed "Discard unsaved DocEditor changes" row. Header notes the partial nature (full CD-6 rewrite pending CD-13).
- **HB-4** — Doc 07 accordion section rewritten: `load_accordion` → `get_accordion_state`; `edit_segment_summary` → `update_segment_summary`; removed `cancel_summarise_segment` (covered by `cancel_generation`); added `clear_segment_summary`; removed all four `accordion_summarise_*` streaming events; `accordion_state_changed` payload now `{ story_id, segment_id?, checkpoint_id? }`.
- **HB-5** — Doc 03 §`app_settings` keys table: added `prompt_handover_seed` and `prompt_consulting_seed` rows, both Developer-only with `*(long)*` default placeholder.
- **HB-6** — Doc 05 §LoomError: added `Forbidden(String)` and `CacheCreate(String)` variants; converted `Validation` to a structured `{ kind: ValidationKind, key: Option<String>, reason: String }` payload with a `ValidationKind` enum (`Generic | InvalidSettingValue | NoBaseline | ProtectedSentinel`); added rationale paragraphs distinguishing each from siblings.
- **HB-7** — Doc 05 module map: added `services/cache.rs` and `services/file_api.rs` to the directory tree and the Module Ownership Summary table; expanded `services/settings.rs` ownership row to mention per-key validators.
- **CD-1** — Doc 20 §`applyTheme()` Contract: widened `ThemeSnapshot` to `{ accent, ghostwriter, accordion, checkpoint, bubbleUser, bubbleAi, bodyFont }`. Doc 08 §Runtime Theme API: replaced the five-function table with a one-line reference to `applyTheme(snapshot)`, owned by Doc 20.
- **CD-2** — Triad-pattern token names locked: `--color-ghostwriter`, `-hover`, `-subtle`, `-diff`. Doc 03 setting key renamed `ghostwriter_color`. Doc 08, Doc 17, Doc 20 references updated.
- **CD-3** — Doc 08: removed the speculative-removal note from `--color-checkpoint` (Doc 16 banners use it).
- **CD-4** — Doc 09 §Slider use case: replaced "Output length slider in InputArea" with the live use sites (Settings → Gemini gen-param sliders, auto-lock, cache TTL, rate-limit ceilings). Doc 09 §Select use case: removed stale "output length (if not slider)" reference.
- **CD-5** — Doc 10 §Theater Content Switching: added `<Settings />` as the highest-priority full-surface view; collapsed `<ImageViewer />` into `<DocEditor />` (image source documents share the editor with a lightbox layout per Doc 18).
- **CD-7** — Doc 06 §`vaultStore` reconciled with Doc 14: kept `Set<string> selectedIds` (correct DS), adopted Doc 14's longer field names (`filterQuery`, `isTrashView`), added missing fields (`expandedFolderIds`, `trashItems`, `activeWorldDir`). Doc 14 §Frontend State now defers to Doc 06 as canonical.
- **CD-8** — `attachDoc` / `detachDoc` wrappers in Doc 06 now return `Promise<string[]>` (the new ordered context_doc_ids). Doc 18 attach/detach paths note the return is consumed by the frontend without a follow-up `loadAttachedDocs` round-trip.
- **CD-9 / TD-3** — Doc 03 §`story_state` known keys: added `active_session_id`. Doc 23 edge case rewritten to describe restore-on-reopen with silent fallback when the session was deleted.
- **CD-10** — Doc 02 §Red Lines #2 corrected to reference `app_settings.db`. Amendment A-02-A retained as the change record.
- **CD-11** — Doc 04 §IPC Boundary: dead `branch_map_updated` example replaced with `vault_updated`.
- **CD-12** — Dropped `cache_enabled` toggle entirely. Doc 22 §Fallback to Inline rewritten — caching is always on subject to `cache_min_tokens` threshold; the inline path triggers only on real failure or below-threshold conditions. Doc 22 §Data Requirements line reduced. Doc 03 unaffected (the key was never added).
- **IP-1, IP-7** — Resolved by HB-4.
- **IP-2** — Doc 19: dropped the `vault_read_item` reference; clarified that `file_api_uri` / `file_api_uploaded_at` are not in IPC payloads (backend debugging only).
- **IP-3** — Doc 03 §IPC Payload and Result Types (new section): added `WorldMetaPatch` interface with optional fields and explicit-null-clears semantics. Doc 14 command list points to Doc 03 for the type.
- **IP-4** — Resolved by CD-8.
- **IP-5** — Resolved by HB-1 (`GhostwriterEditRecord` is the same struct as `GhostwriterEdit` — Doc 03 is canonical).
- **IP-6** — Resolved by CD-11.
- **IP-8** — Doc 18 attach/detach: `vault_updated` payload documented as `{ world_id }` (matches Doc 07); frontend reloads via `list_items`.
- **IP-9** — Doc 03 §IPC Payload and Result Types: added `ResolvedSettings`, `Telemetry`, `AliveCacheRow`, `UnlockResult`, `GhostwriterResponse`, `RevertResult`. All annotated as ts-rs-generated; the Rust struct is the authoritative source. CI verifies generated `types.ts` matches.
- **SD-1, SD-2, SD-3, SD-4, SD-5** — Resolved by HB-2 / HB-5 / CD-12 / CD-9.
- **SD-6** — Doc 03 §`MessageBlock`: marked v2.1-reserved with explicit note that field semantics will be tightened when v2.1 image-gen design lands.
- **ST-1 / TD-2** — Doc 21 status flipped to `Deferred to v2.0.x`. Header includes a deferral-note paragraph explaining what blocks the doc and why World Backup (Doc 14) covers v2.0's resilience deliverable. 00-INDEX.md Document Map updated.

**Deferred to next session:**
- ~~**CD-6** — Escape Chain full rewrite (depends on CD-13 — Feedback affordance spec).~~ **Resolved 2026-05-04 — see below.**
- ~~**CD-13** (new) — to be added at the start of the Feedback design pass.~~ **Resolved 2026-05-04 — see below.**

*Phase 0 substrate items (SB-1..SB-6) and stub doc gaps (ST-3, ST-4) remain open for their respective workstreams. ST-2 closed 2026-05-04 — see below.*

---

**2026-05-04 — Coding Standards design pass (D-18).** Doc 24 (Coding Standards) written end-to-end. ST-2 closed.

Per-item notes:

- **ST-2** — `dev/24-coding-standards.md` written: ~570 lines covering Rust (general / `LoomError` / `tracing` logging / async + cancellation / key zeroing / atomic file writes / SQLCipher / AppState access [SB-5] / settings access [SB-1] / schema migrations [SB-6] / per-service constants / Tauri command discipline / testing); TypeScript / React (general / type generation [SB-3] / Zustand / no cross-store imports [SB-2] / component rules incl. R19 size budget and max-stores convention / Tauri IPC wrappers / error handling / localStorage / naming); CSS / Design (token usage / `cn()` / no inline styles / Tailwind naming); Build, Lint, Format (linters / pre-commit `husky` + `lint-staged` / CI gates); Commit Conventions (Conventional Commits, closed type + scope sets, no `// Phase N` framing); PR Template (`.github/pull_request_template.md` body); Code Review Checklist; Appendix A (13 v1.0 anti-patterns with Forbidden / Preferred snippet pairs). Three-tier enforcement model: 🔴 Linted (CI fails) / 🟡 Reviewed / ⚪ Convention. Substrate rule home for SB-1 / SB-2 / SB-3 / SB-5 / SB-6 with embedded `<!-- SB-N -->` anchors; SB-4 (cancellation lifecycle) deferred to a dedicated Doc 05 amendment pass. R3 / R5 / R13 / R19 closed in `IMPROVEMENT-BACKLOG.md`; R2 / R4 / R17 / R18 marked "spec'd in Doc 24 — code pending Phase 0." Propagation: 00-INDEX (D-18 umbrella + Document Map row flipped to Complete), Doc 05 (lock-helper rule cross-ref + `tracing` note + cancellation-lifecycle cross-ref), Doc 06 (`types.ts` source-of-truth line revised to reflect ts-rs; §Store Rules cross-references Doc 24 §No Cross-Store Imports), `.claude/rules/code-standards.md` and `.claude/rules/pitfalls-and-reference.md` (v2.0 redirect banners).

---

**2026-05-04 — Feedback design pass (D-17).** Doc 28 (Feedback) created. CD-6 and CD-13 closed.

Per-item notes:

- **CD-6** — Doc 11 §Escape Chain fully rewritten. New 8-slot priority order (lower wins): 1 Modal, 2 Settings full-surface, 3 Mode session end-confirmation, 4 Ghostwriter active (with phase-sensitive behaviour — `selecting`/`generating` cancels immediately, `reviewing` opens confirmation modal which is then consumed by slot 1 on next Esc), **5 Feedback edit open** (cancels edit, no modal), 6 DocEditor focus blur, 7 Reader View, 8 no-op. Implementation note added describing which store flags each slot reads. The stale "Feedback panel expanded" reference is gone (the original `2.` slot in the pre-rewrite chain was Ghostwriter, not the feedback panel — the audit's claim was a misread of an older draft, but the rewrite is correct and the misread is now moot).

- **CD-13** — `features/28-feedback.md` written end-to-end. Locks: per-bubble inline strip is the sole affordance (v1.0's right-pane overlay dropped — D-17 Q1); always-visible single-line preview when non-empty (Q3); explicit Apply + Cancel (Q5/Q6); `--color-feedback` triad with stable `#f59e0b` default that does not track accent (Q4); `workspaceStore.feedbackEditingMessageId` flag (Q13); mode-gated to story bubbles (Q8); hidden during Ghostwriter (Q9); cached-message + accordion stale rules apply (Q10). Propagation: Doc 03 (`feedback_color` key), Doc 06 (workspaceStore field/actions; right-pane directory description trimmed), Doc 07 (`update_feedback` server-side notes), Doc 08 (token triad relocated to Feature Colors), Doc 11 (escape chain), Doc 15 (cross-ref Doc 28), Doc 20 (Features tab row, ThemeSnapshot, applyTheme writes), Doc 27 (bubble-strip placement, cross-ref table), 00-INDEX (D-17 umbrella + Document Map row).
