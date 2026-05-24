# AUDIT-2026-05 — Plan

> **Status:** **Complete (2026-05-23)** — Pass A (A1–A7) + Pass B (B1, B2, B4, B5, B6, B7) + Pass C (C1 punch list, C2 remediation proposal) all done. Proposal **approved 2026-05-23** with decisions D1–D6; remediation structure landed as separate non-audit edits (Phase 12.5 + Phase 12.6 in IMPLEMENTATION-PLAN.md; R20–R29 in IMPROVEMENT-BACKLOG.md). Audit archived in place.
> **Started:** 2026-05-20
> **Last updated:** 2026-05-23 — Owner approved the C2 proposal. Decisions: D1 ship World Backup (Phase 12.6 + Doc 14 contradiction resolved), D2 PRE-AUDIT immutable, D3 schema FK in 12.5-D, D4 scroll findings → backlog R28, D5 rate limiter deferred to v2.1 (R29), D6 auto-lock code fixed to "wait then lock" (R26). 65 findings routed: 10 → Phase 12.5, 13 → Phase 12 Bucket-2 checkpoint, ~38 → backlog R20–R29, decisions recorded. See ledger §Phase C2 → Decisions resolved.
> **Earlier:** 2026-05-22 — Phase C2 remediation proposal drafted into ledger §Synthesis (Pass C). 65 findings routed into 4 buckets. Owner deferred the proceed/approve decision to the next session; no source-doc edits made.
> **Snapshot:** HEAD = `5126e6f` (feat(modes): switcher re-enters tail session; session banner action bar) **plus uncommitted working-tree modifications** (Navigator/Theater/stores + Docs 09/11/27/00-INDEX + new `features/29-selection-popup.md` + new `src/components/shared/`, `src/components/navigator/navigatorMenu.ts`).
> **Ledger:** [AUDIT-2026-05.md](AUDIT-2026-05.md)

---

## Goal

Complete, critical, precise audit of LOOM 2.0 as it stands after Phase 12 (visual design pass). Two passes — docs-first then code — synthesised into a remediation proposal. Strictly observational: this audit does not edit docs or code.

## Operating rules

- **Observation only.** No edits to source docs or source code during the audit. All findings flow into the ledger.
- **Live resumption notes.** Append a one-liner whenever a checkpoint completes, a finding lands, or a sweep finishes. Never save notes for end-of-session.
- **Severity taxonomy:** `HB-` Hard Blocker (must fix before next feature phase), `SB-` Soft Blocker (substrate), `CD-` Cross-Doc inconsistency, `SD-` Schema drift, `IP-` IPC drift, `CQ-` Code Quality, `DG-` Doc Gap. Numbering is per-audit, starting at `-01`.
- **Sub-agents allowed** for grep-heavy / parallel sweeps (B2, B4 especially); brief them cold per the Agent tool's own guidance.
- **Definition of "done"** for the audit: every checkpoint in every phase ticked, Pass C produces a prioritized punch list and remediation phase proposal.

---

## Pass A — Documentation audit (docs-first)

### Phase A1 — Foundation (Docs 01–03) + Security red lines (B3 pulled forward)

> **Status:** Complete (2026-05-20)
>
> **Resumption notes:**
> - 2026-05-20 — Started and completed in one session. 9/9 checkpoints ticked.
> - 2026-05-20 — Findings recorded: CD-01 (atomic `.tmp` extension drift, config.rs:88 + world.rs:118), SD-01 (`conversation_sessions.entry_message_id` missing FK clause in `world/001_initial.sql:33`), CD-02 (Doc 03 accent_color default disagrees with code + Doc 08). No HB, no SB, no IP. Counts: 2× CD, 1× SD.

**Why combined with B3:** docs 01–03 are where the security model is defined; auditing them while also grepping the codebase for red-line violations means cross-checking happens once, not twice.

- [x] Doc 01 (Vision & Principles) — principles still load-bearing? Any principle silently violated by shipped UX through Phase 12? *(Headline principles intact in Doc 01 itself; Phase-12-UX cross-check deferred to A3.)*
- [x] Doc 02 (Security Model) — every red line still enforceable as spec'd; PBKDF2 params / sentinel / atomic writes still match Doc 03 + Doc 13. *(Findings: CD-01 atomic-temp-file naming.)*
- [x] Doc 03 (Data Model) — schema matches `src-tauri/src/db/migrations/` reality; `app_settings` / `story_state` key inventory matches Rust enums (R2). *(Findings: SD-01 missing FK, CD-02 accent default; enum key inventory matches.)*
- [x] **B3.a** Grep frontend (`src/`) for master-key references — must be zero. *(Zero matches.)*
- [x] **B3.b** Grep frontend + log output paths for API-key handling — never in localStorage, app_config.json, URL params, log output. *(Frontend handles api key only as transient form state during entry + `has_api_key` boolean; never persisted on JS side.)*
- [x] **B3.c** Grep entire repo for user-content logging — message text / feedback / document content / draft fields must never reach `tracing` / `log` / stderr. *(All tracing/log macros log IDs + metadata only.)*
- [x] **B3.d** Verify `app_config.json` writer is content-empty and atomic (`.tmp` + `fs::rename`). *(`AppConfig` struct contains only worlds, active_world_id, salt_hex, key_check. Atomic rename present; temp-name drift → CD-01.)*
- [x] **B3.e** Verify CSP `connect-src` allowlist (only `generativelanguage.googleapis.com`). *(tauri.conf.json:26 — `connect-src ipc: http://ipc.localhost https://generativelanguage.googleapis.com`.)*
- [x] **B3.f** PBKDF2 params at the call site: 200,000 iterations, 32-byte salt, HMAC-SHA256; new salt + new sentinel on every password change. *(crypto.rs §PBKDF2_ITERS=200_000, sha2::Sha256, 32B salt+key; change_password generates new_salt + new sentinel before rekeying.)*

### Phase A2 — Architecture (Docs 04–07)

> **Status:** Complete (2026-05-20)
>
> **Resumption notes:**
> - 2026-05-20 — Started and completed in one session. 4/4 checkpoints ticked.
> - 2026-05-20 — Positive signals: 7 frontend stores match Doc 06; zero cross-store imports (R3/SB-2 honoured); invoke() calls contained to tauriApi/ (D-22 honoured); AppState fields match Doc 05's spec save for one type drift and the `app_phase` addition.
> - 2026-05-20 — 10 findings: 5× CD (03–08), 1× CQ (01), 1× SB (01), 3× IP (01–03), 1× DG (01). No HB, no SB beyond SB-01, no SD. Systemic pattern: design docs (04–07) were not re-verified against code after implementation phases shipped — module trees, command tables, and folder maps are all stale.

- [x] Doc 04 (System Overview) — launch flow + subsystem map match `src-tauri/src/main.rs` and `src/main.tsx`. *(AppState fields match, conditional rendering on appPhase confirmed. Findings: CD-03, DG-01.)*
- [x] Doc 05 (Backend Modules) — module tree matches actual `src-tauri/src/` layout; `services/` boundary respected. *(Findings: CD-04 module map stale, CD-05 cancel_tx type drift, CQ-01 layering inversion in db/settings.rs. Dependency rule violated once.)*
- [x] Doc 06 (Frontend Architecture) — six-store map matches actual `src/stores/`; no cross-store imports; `types.ts` ts-rs output committed and current. *(7 stores match; zero cross-store imports ✓. Findings: CD-06 components/ folders, CD-07 tauriApi inventory, SB-01 types.ts hand-maintained.)*
- [x] Doc 07 (IPC Contracts) — every `#[tauri::command]` listed; every listed command implemented; signatures match; typed wrappers exist in `src/lib/tauriApi/<domain>.ts`. *(invoke calls contained to tauriApi/ ✓. Findings: IP-01 missing app_phase domain, IP-02 4 unregistered commands, IP-03 4 implemented commands missing from doc, CD-08 list_templates duplicated.)*

### Phase A3 — Design (Docs 08–12, 27)

> **Status:** Complete (2026-05-20)
>
> **Resumption notes:**
> - 2026-05-20 — Phase started. Doc 08 complete; ticked below. Paused at end-of-session per the one-phase-per-session rule (`.claude/rules/audit-workflow.md` §One phase per session). Findings recorded for Doc 08: CQ-02, DG-02, CD-09.
> - 2026-05-20 — recorded CD-10 (Doc 09 §shadcn/ui — 7 primitives listed, shadcn not installed; cross-ref DG-02).
> - 2026-05-20 — recorded DG-03 (Doc 09 §Custom Shared Components — TagInput/Lightbox/InlineImage never built, LoadingDots inlined as StreamingDots, ErrorBoundary absent, SelectionToolbar undocumented).
> - 2026-05-20 — Doc 09 ticked. PaneDivider + RightPane match Doc 10 spec; NoStorySelected lives inline in TheaterBody.tsx (minor).
> - 2026-05-20 — recorded DG-04 (Doc 10 §Viewport Watcher — viewportWatcher.ts + appStore.viewport referenced but not implemented).
> - 2026-05-20 — recorded CD-11 (Doc 10 §Mode Layout Variations — "Settings" listed as right-pane section but Settings is full-surface only).
> - 2026-05-20 — Doc 10 ticked. Moved to Doc 11.
> - 2026-05-20 — recorded CD-12 (Doc 11 §Escape Chain — centralised App.tsx handler unimplemented; 12 components register their own).
> - 2026-05-20 — recorded DG-05 (Doc 11 §Focus Management — useFocusTrap.ts and shadcn-based focus restoration absent; cross-ref CD-10).
> - 2026-05-20 — Doc 11 ticked. D-22 navigator + bubble resolvers wired correctly (navigatorMenu.ts + StoryAIBubble onContextMenu); D-23 selection popup wired via SelectionToolbar.tsx. Escape chain + focus trap are the gaps.
> - 2026-05-20 — recorded DG-06 (Doc 12 has no LoomError variant ↔ display-rule mapping despite CLAUDE.md asserting one).
> - 2026-05-20 — recorded CD-13 (Doc 12 — 5 specified empty states unimplemented or degraded: recents list, No Source Documents, No Attached Documents copy, No Search Results, Handover/Consulting empties).
> - 2026-05-20 — Doc 12 ticked.
> - 2026-05-20 — recorded CD-14 (Doc 27 §Greying — consulting re-entry visual suppression unimplemented).
> - 2026-05-20 — recorded CD-15 (Doc 27 — story user bubble labels shortened + Markdown rendering not implemented).
> - 2026-05-20 — Doc 27 ticked. data-loom-selectable / data-loom-bubble-kind wiring matches D-29 spec; bubble action rows match Doc 27. Phase A3 complete.
> - 2026-05-20 — **Next session resumes from Doc 09.** Remaining checkpoints (Docs 09, 10, 11, 12, 27) are still `- [ ]`. Surfaces to read: `docs-v2/design/09-component-library.md` (against `src/components/shared/`, `src/components/navigator/navigatorMenu.ts`, and any ContextMenu provider for D-22); Doc 10 against `src/components/shell/WorkspaceShell.tsx` + `src/components/navigator/`; Doc 11 against the escape-chain implementation (grep for `onKeyDown.*Escape`, the selection popup wiring per D-23, and the context-menu resolvers per D-22 / Doc 29); Doc 12 against `LoomError` (`src-tauri/src/error.rs`) and empty-state components; Doc 27 against `src/components/theater/{SessionBubble,StoryAIBubble,StoryUserBubble}.tsx`.

- [x] Doc 08 (Design Tokens) — token names + values match `src/styles/globals.css`; no hex literals in components. *(@theme block in globals.css matches Doc 08 hex values verbatim; one hex in components is a placeholder string, not a styling value. Findings: CQ-02, DG-02, CD-09.)*
- [x] Doc 09 (Component Library) — primitives listed match `src/components/` (note: uncommitted modifications); `ContextMenu` provider pattern landed per D-22. *(D-22 ContextMenuProvider/useContextMenu pattern correctly implemented and mounted at WorkspaceShell:162. Findings: CD-10 (shadcn enumerated but unused), DG-03 (shared/ inventory drift — TagInput/Lightbox/InlineImage never built, LoadingDots inlined, ErrorBoundary absent, SelectionToolbar undocumented).)*
- [x] Doc 10 (Layout & Navigation) — pane composition matches `WorkspaceShell.tsx` (uncommitted modifications) and Navigator structure. *(Three-pane shell + PaneDivider geometry + RightPane collapse + Theater content-switching priority all match WorkspaceShell.tsx. NoStorySelected lives as an inline component in TheaterBody.tsx (minor). Findings: DG-04 (viewport watcher missing), CD-11 (phantom Settings right-pane section). Workspace.tsx → WorkspaceShell.tsx rename already captured by CD-06.)*
- [x] Doc 11 (Interaction Patterns) — escape chain priority verified in code (CD-6 closed in docs, but is the code in agreement?); selection popup wired per D-23; context-menu resolvers per D-22. *(D-22 navigator + bubble resolvers correctly implemented; D-23 SelectionToolbar wired with the spec'd observer-only behaviour. Findings: CD-12 (centralised Escape Chain unbuilt — 12 per-component listeners), DG-05 (useFocusTrap missing + shadcn-dependent focus claims). Bubble menu suppression on streaming/editing observed at StoryAIBubble.tsx:143.)*
- [x] Doc 12 (Empty States & Errors) — each `LoomError` variant has a display rule; every zero-data state has spec'd UI; no blank screens in shipped components. *(Five of nine empty states drifted or unimplemented; LoomError variant↔display matrix CLAUDE.md asserts does not exist in Doc 12. Findings: DG-06 (LoomError matrix missing), CD-13 (empty-state drift). ErrorBoundary covered by DG-03.)*
- [x] Doc 27 (Theater Composition) — bubble structure, banner placement, gutter rules match `SessionBubble` / `StoryAIBubble` / `StoryUserBubble` (all uncommitted modifications). *(D-29 data-loom-selectable / data-loom-bubble-kind wiring correct; bubble action rows + suppression on streaming/edit/ghostwriter all match Doc 27. Findings: CD-14 (consulting-re-entry greying unimplemented), CD-15 (user bubble labels shortened, AI bubble Markdown deferred but Doc 27 still asserts it).)*

### Phase A4 — Features (Docs 13–23, 28, 29)

> **Status:** Complete (2026-05-20)
>
> **Resumption notes:**
> - 2026-05-20 — Phase started and completed in one session. 13/13 checkpoints ticked.
> - 2026-05-20 — 14 findings recorded for Phase A4: 11× CD (CD-16..26), 2× CQ (CQ-03, CQ-04), 1× DG (DG-07). No HB. No SB. No SD. No IP. No new finding contributions from Docs 17, 18, 19, 21, 22, 23, 28, 29 (faithfully implemented or correctly deferred); they cross-ref existing findings where applicable.
> - 2026-05-20 — By-doc tally: Doc 13 → 4 (CD-16, CD-17, CD-18, DG-07); Doc 14 → 5 (CD-19..23); Doc 15 → 3 (CD-24, CD-25, CQ-03); Doc 16 → 1 (CQ-04); Doc 20 → 1 (CD-26). Notable: CQ-03 (backend has no concurrent-gen guard; sole gate is frontend `isGenerating`) is the load-bearing architectural finding from this phase.

- [x] Doc 13 (Auth & Onboarding) — Phase 1 deliverables match spec. *(Findings: CD-16 generation-completion timer reset unwired; CD-17 auto-lock cancels in-flight gen vs. Doc 13's "wait then lock"; CD-18 lock-time store-clear set mismatched; DG-07 authStore action names / RPC ownership drift.)*
- [x] Doc 14 (Vault & Worlds) — Phase 2 deliverables, World Backup state, vault-row paperclip. *(Findings: CD-19 Out-of-Scope ↔ World Backup internal contradiction; CD-20 export UI lives in WorldPicker not Settings as spec'd; CD-21 BulkActionBar unimplemented despite multi-select state wired; CD-22 "Move to…" picker overlay missing — drag-only; CD-23 Empty Trash button missing.)*
- [x] Doc 15 (Conversation Engine) — Phase 3 deliverables; history assembly server-side only; `isGenerating` global; cancellation token lifecycle (R7). *(Positive: history assembly server-side ✓; verbatim field labels ✓; aux-slot wrapping ✓; events match ✓; cancel-token type matches Doc 05 ✓. Findings: CD-24 scrollState missing from workspaceStore (lives in TheaterBody useState), CD-25 edit-mode scroll freeze unimplemented, CQ-03 backend has no concurrent-generation guard — sole gate is frontend isGenerating.)*
- [x] Doc 16 (Accordion) — Phase 7 status vs. implementation reality; fake-pair substitution server-side. *(Largely faithful: all 9 backend commands present (`get_accordion_state`, `create_checkpoint`, `rename_checkpoint`, `delete_checkpoint`, `summarise_segment`, `update_segment_summary`, `set_segment_collapsed`, `set_segment_use_summary`, `clear_segment_summary`); ProtectedSentinel variant exists; banner button-slot state machine + chevron + right-click menu (all 8 actions) + Insert checkpoint here all wired; set_segment_collapsed correctly NOT marking cache stale per spec; set_segment_use_summary correctly marks stale. Finding: CQ-04 destructive confirmations use native `window.confirm()` rather than Doc 12 styled modals.)*
- [x] Doc 17 (Ghostwriter) — Phase 8 status vs. reality; mode-first + selection-first entries; floating-panel gutter placement. *(Faithfully implemented: 4 backend commands (`send_ghostwriter_request`, `cancel_ghostwriter_generation`, `save_ghostwriter_edit`, `revert_ghostwriter_edit`); GhostwriterPanel renders all 4 phases (selecting/composing/generating/reviewing); pulse-frame outline + diff highlighting tokens present in globals.css; available on story + session bubbles. Sole drift: "Discard pending Ghostwriter changes?" uses `window.confirm()` (`StoryAIBubble.tsx:109`) — covered by CQ-04. No separate finding.)*
- [x] Doc 18 (Source Documents) — Phase 5 status; DocEditor; attach/detach. *(Well-implemented: DocEditor full-surface with header, Preview toggle, Tab placeholder navigation, debounced auto-save, dirty dot, soft-delete read-only banner with verbatim spec copy; ContextDocsSection in right pane with per-row `×` detach; image items correctly read-only per Doc 18's own v2.1 deferral note. Backend commands (`update_item_content`, `attach_context_doc`, `detach_context_doc`, `list_attached_docs`, `list_templates`) all present. No new findings; empty-state copy drift in ContextDocsSection already captured by CD-13.)*
- [x] Doc 19 (Media) — confirmed deferred to v2.1; no half-built code paths. *(Deferred status correctly observed: `upload_image` is not registered (`lib.rs` grep clean), no `New Image` in CreateMenu, no UI surface for image upload, drag-drop is wired but only triggers item move (not image ingest). The dormant `services/file_api.rs` (`get_or_upload_file_api_uri` defined but never called) and Image branches in `services/cache.rs:353, 395, 523` are explicitly retained per Doc 19's own status header. Built-in `image` template seeded per Doc 18 §Templates but produces a SourceDocument (which renders as a text textarea). No findings — dormancy matches spec.)*
- [x] Doc 20 (Settings & Themes) — Phase 11 deliverables; two-scope cascade; modificators have no Settings home. *(Two-scope cascade implemented; resolved settings server-side; applyTheme matches spec including feedback (#f59e0b default, no-track-accent); search + override-status chip wired; 13 of 16 backend commands present. Findings: CD-26 (Rate Limits tab + 3 supporting commands missing). Cross-refs to existing findings: IP-02 (commands missing), CD-09/DG-02 (shadcn token RGB format), CD-20 (export-world UI placement).)*
- [x] Doc 21 (Export & Reader) — confirmed deferred to v2.0.x; no half-built code paths. *(Deferral verified: grep `ReaderView|export_story|exportStory|Markdown Export|Plain Text Export` across the whole repo returns zero matches. No commands, no UI, no half-built paths. Doc 21 §Deferral note reads as the actual state.)*
- [x] Doc 22 (Context Caching) — Phase 6 status; story vs. consulting cache separation; handover never caches; prefix builder + inline fallback per D-21. *(Faithful: 5 commands match (`get_cache_state`, `create_story_cache`, `delete_story_cache`, `get_session_cache_state`, `list_alive_caches`); D-21 inline_context_fallback wired with `LoomError::CacheCreate` on cache-create failure; cached-message confirmation modal exists (CachedMessageConfirmModal.tsx) — copy is close to but not verbatim Doc 22's text; Update cache action in InputArea context menu. No new findings.)*
- [x] Doc 23 (Modes) — Phase 4 deliverables; mode switcher re-enters tail session (latest commit); session banner action bar. *(Faithful: 12 modes commands present (`list_sessions`, `start_handover_session`, `start_consulting_session`, `enter_session`, `exit_session`, `send_session_message`, `cancel_session_generation`, `rename_session`, `delete_session`, `get_story_active_mode`, `set_story_active_mode`, `set_session_collapsed`). ModeSwitcher.tsx implements tail-vs-fresh re-entry rule (commit 5126e6f). Session banner has hover Rename/Delete action row + right-click menu. CD-14 (consulting re-entry greying) already covers the one visual gap. SessionPartition uses `window.confirm` for Delete — covered by CQ-04. No new findings.)*
- [x] Doc 28 (Feedback) — Phase 9 status; inline strip only; escape-chain priority 5. *(Well-implemented in FeedbackStrip.tsx: hidden when empty, single-line preview when non-empty, inline editor with [Cancel] [Apply], explicit Apply only (no blur-save), Ctrl/Cmd+Enter shortcut, Escape cancels, useCachedMessageGuard for Doc 22 protection, `--color-feedback` triad, hint copy verbatim from spec. Per-bubble single-edit invariant via `feedbackEditingMessageId`. The "Feedback saved" confirmation flash spec'd in Doc 28 §Edit mode is not implemented but is ⚠️ provisional in the doc. No findings.)*
- [x] Doc 29 (Selection Popup) — implementation matches spec; observer-only selection model. *(Faithfully implemented: `SelectionToolbar.tsx` is a singleton observer mounted once in `WorkspaceShell.tsx:162`; `data-loom-selectable` + `data-loom-bubble-kind` registration on prose wrappers in StoryAIBubble / SessionBubble / StoryUserBubble; cross-bubble suppression via dual-endpoint `closest()`; selectionchange debounced 150ms; AI single-text-node offset model; user bubble offsets null; `resolveSelectionActions` per-target resolver (selectionMenu.ts). Structural suppression on streaming/in-ghostwriter/in-edit observed (no attribute = no popup). No findings.)*

### Phase A5 — Dev docs (24–26)

> **Status:** Complete (2026-05-20)
>
> **Resumption notes:**
> - 2026-05-20 — Phase started (paired with A6 per caller approval).
> - 2026-05-20 — Doc 24 walked end-to-end. Findings: CD-27 (eslint-plugin-tailwindcss dropped but doc still mandates it; 🔴 → 🟡 tier downgrade unacknowledged; cross-ref CQ-02), CD-28 (import/no-default-export claimed but missing from eslint.config.js), CD-29 (react-hooks/exhaustive-deps claimed `error` but config inherits plugin default `warn`). Doc 24 ticked.
> - 2026-05-20 — Doc 25 walked end-to-end. Major finding: CQ-05 (rate-limiter subsystem entirely unimplemented — `services/rate_limiter.rs` absent, `LoomError::RateLimited` never raised; cross-ref CD-26 whose "limits enforced at send time" assertion is therefore wrong). Also CD-30 (Doc 25 lists `cargo test` / `pnpm test` as pre-commit gates; pre-commit hook only runs lint-staged + tsc — Doc 24 is authoritative) and DG-08 (`tests/helpers/mod.rs` fixture mandated by Doc 25 but absent — currently moot since no DB integration test exists). Doc 25 ticked.
> - 2026-05-20 — Doc 26 walked. No findings — its stub status matches its declared status, and CLAUDE.md acknowledges "drafted before first release". Doc 26 ticked.

- [x] Doc 24 (Coding Standards) — every rule enforceable; lint coverage for 🔴 Linted tier complete. *(3 findings: CD-27 (tailwindcss plugin dropped), CD-28 (no-default-export missing), CD-29 (exhaustive-deps not `error`). Positive: husky+lint-staged wired per spec; tauriApi/ domain split mirrors backend; ts-rs drift check active in CI; SB-5 grep gate present in CI. Migration dual-root (`db/migrations/{world,app}/`) present.)*
- [x] Doc 25 (Testing Strategy) — test layout matches; recipes still demonstrated. *(3 findings: CQ-05 (rate-limiter unimplemented — biggest finding of A5; cross-ref CD-26 which is now partially wrong), CD-30 (Doc 25 pre-commit table contradicts Doc 24 + reality), DG-08 (canonical DB fixture absent). Positive: in-memory SQLite recipe and Gemini SSE mock recipe both materialised (`tests/gemini_sse_mock.rs`); vite.config.ts test block matches Doc 25 exactly; ts-rs drift test exists. `#[cfg(test)]` blocks present in 24 files across security/services/db/state — broad inline-unit coverage.)*
- [x] Doc 26 (Build & Release) — stub state vs. needs for Phase 13. *(No findings. Doc 26 status header reads "Stub" and CLAUDE.md PRD lookup explicitly notes "drafted before first release" — its incomplete state matches its declared state. CI workflow `.github/workflows/ci.yml` shipped in advance of Doc 26 per Doc 24's note that the workflow is "owned by Doc 26 — currently a stub", which Doc 24 accurately discloses.)*

### Phase A6 — Cross-doc & meta

> **Status:** Complete (2026-05-20)
>
> **Resumption notes:**
> - 2026-05-20 — Phase started (paired with A5 per caller approval).
> - 2026-05-20 — 00-INDEX D-NN chain walked (D-01..D-23 + amendments D-03-A/B). Forward integrity good: every D-NN names at least one Affects doc. Reverse lookup (does each cited doc actually cite the D-NN back?) spot-checked but not exhaustively verified — noted as light coverage. No finding.
> - 2026-05-20 — IMPLEMENTATION-PLAN drift recorded: CD-31 (header asserts "Phases 0–11 implemented" but Phase 11 own status is "In progress" with all checkpoints unticked; Phase 12 "last touched 2026-05-17" predates tail commit 2026-05-18 + uncommitted Phase-12 working tree).
> - 2026-05-20 — Meta-docs walked. Findings: DG-09 (IMPL-NOTES.md frozen at 2026-04-26 — IN-07 effectively closed, IN-09-A/B contradicted by reality, RESOLVED empty), DG-10 (HANDOVER.md frozen at 2026-04-27 — still says "we are writing the planning specification" and "Doc 23 NEXT SESSION FOCUS"; CLAUDE.md scopes it as planning-phase but the doc itself is silent on its archival status). V1-LESSONS, IMPROVEMENT-BACKLOG, COWORKING, TODO read — all still load-bearing; TODO bumped 2026-05-17 in the recent visual-design pass; no findings.
> - 2026-05-20 — Terminology sweep done as a sampling pass (not exhaustive): "session/thread" usage consistent (Doc 23 says "one implicit thread per story" — only acknowledged usage), "story/world" hierarchy clear, mode names (story/handover/consulting) consistent, cache-state terms (alive/expired/stale) consistent. No finding from the sample; deeper grep deferred to a follow-up if a finding surfaces.
> - 2026-05-20 — CLAUDE.md claims spot-checked. Verified: master-key zeroing (A1), single-conn invariant (A2 assumption), isGenerating global (A3 + CQ-03 caveat — frontend-only enforcement), fonts bundled in `src/assets/fonts/` (5 woff2 files present), generativelanguage allowlist (A1 B3.e). Finding: CD-32 (CLAUDE.md §10 self-contradicts — claims `connect-src 'none'` but actual CSP allows Gemini; parenthetical doesn't match the bullet's own claim).
> - 2026-05-20 — Phase A6 complete. 4 findings: CD-31, CD-32, DG-09, DG-10.

- [x] `00-INDEX.md` D-NN chain integrity — every decision has at least one affected doc; reverse lookup works. *(Forward integrity verified D-01..D-23 + D-03 amendments — every entry has at least one Affects doc. Reverse lookup spot-checked, not exhaustive — flag here so a later audit can drill deeper. No finding.)*
- [x] `IMPLEMENTATION-PLAN.md` phase statuses match real progress (commit history + working tree). *(Finding: CD-31. Header status disagrees with Phase 11 own status and Phase 12 "last touched" is one day stale; resumption-notes content for Phase 11 effectively declares it complete but checkpoints + Status box unflipped.)*
- [x] `IMPL-NOTES.md`, `V1-LESSONS.md`, `IMPROVEMENT-BACKLOG.md`, `HANDOVER.md`, `COWORKING.md`, `TODO.md` — still load-bearing? Stale entries? *(Findings: DG-09 (IMPL-NOTES 2026-04-26 freeze; all Open; RESOLVED empty), DG-10 (HANDOVER 2026-04-27 freeze; describes planning phase as ongoing — needs archival banner or rewrite). V1-LESSONS / IMPROVEMENT-BACKLOG / COWORKING / TODO still load-bearing — TODO updated 2026-05-17.)*
- [x] Terminology sweep — session vs. thread; story vs. world; mode names; cache states; consistent across docs. *(Sampling-pass only — confirmed no glaring drift. "Thread" appears once meaningfully in Doc 23 ("one implicit thread per story") as an acknowledged usage, not a competing term. Mode names + cache states consistent. Deeper grep deferred — no finding raised.)*
- [x] CLAUDE.md (project + global) — every claim still holds. *(Finding: CD-32 — §10 architecture bullet's parenthetical "`connect-src 'none'`" contradicts the actual CSP and the bullet's own headline. Other major claims verified — fonts bundled at `src/assets/fonts/` (5 woff2 files), master-key Rust-only, isGenerating-as-global-flag matches frontend reality (backend gap = CQ-03), Gemini-only allowlist matches A1 B3.e.)*

### Phase A7 — PRE-AUDIT reconciliation

> **Status:** Complete (2026-05-20)
>
> **Resumption notes:**
> - 2026-05-20 — Phase started. Open `- [ ]` inventory: ST-4 (Doc 26 stub), NB-1..NB-4 (provisional ⚠️ tokens/copy/visual/keyboard), TD-1, TD-4, TD-5. 8 items total.
> - 2026-05-20 — Walked each item; ⚠️-grepped Docs 08/11/12/15/17/22/27 and TODO.md. Doc 08's 2026-05-17 sweep cleared its own tokens; Docs 17/22/27 still carry ⚠️ markers; copy in Doc 12 still ⚠️; Doc 11 keyboard table still a declared stub.
> - 2026-05-20 — Disposition table added to ledger (§Phase A7). Roll-up: ST-4/NB-4/TD-1/TD-5 correctly open elsewhere; NB-1 partially resolved-but-not-ticked (Doc 08 portion); NB-2/TD-4 still open; NB-3 heterogeneous (image sub-item superseded by v2.1 deferral, others open).
> - 2026-05-20 — 1 finding recorded: DG-11 (PRE-AUDIT no longer reflects current status of provisionals; needs decision on immutable-vs-live and a tracking-surface migration for the remaining ⚠️ items).
> - 2026-05-20 — Phase A7 complete. Pass A complete.

- [x] Walk every open `- [ ]` in `PRE-IMPLEMENTATION-AUDIT.md`. For each: still open / resolved-but-not-ticked / superseded — record the disposition in the new ledger. *(8 items walked; disposition table + DG-11 recorded in ledger §Phase A7. NB-1 is the only resolved-but-not-ticked case; the rest are either correctly open or correctly tracked elsewhere.)*

---

## Pass B — Code quality audit

### Phase B1 — Substrate enforcement (R2–R18)

> **Status:** Complete (2026-05-21)
>
> **Resumption notes:**
> - 2026-05-21 — Phase started and completed in one session (first Pass B phase). 7/7 checkpoints ticked.
> - 2026-05-21 — 4 findings: 1× SB (SB-02), 3× CQ (CQ-06, CQ-07, CQ-08). No HB. R3 / R7 / R18 verified clean (no findings).
>   - **R2** PASS — typed `AppSettingKey`/`StoryStateKey` helpers in `db/settings.rs`; zero literal-key access; Settings Access correctly 🟡. → CQ-06 (header "only place" overclaim; `vault.rs:344` reverse-lookup queries `story_state` via typed key, so R2 itself holds).
>   - **R3** PASS — `import/no-restricted-paths` (error) + CI positive-control fixture + clean store graph.
>   - **R4** FAIL → SB-02 (sharpens SB-01): CI ts-rs drift step regenerates `src-tauri/src/lib/types.ts` but `git diff`s repo-root `src/lib/types.ts` (hand-maintained 455-line superset) — wrong path, gate is a no-op. (Did not run the export test — it writes tracked files; observation-only.)
>   - **R7** PASS — fresh token per request in all 4 gen paths; biased select aborts in-flight stream. (Adjacent gaps already = CD-05, CQ-03.)
>   - **R17** PASS in substance → CQ-07: `AppState::drop` is an undocumented exception to the "only call sites" claim; gate's `state.` prefix misses `self.` locks.
>   - **R18** PASS — numbered dual-root migrations + idempotent transactional runner + tests; no ad-hoc schema.
>   - **R19** → CQ-08: `Navigator.tsx` 629 lines (only file > 600; next 392; already decomposed, marginal). Full histogram deferred to B4.
> - 2026-05-21 — B1 verified clean via /audit-verify. One-phase-per-session: do NOT roll into B2 — next session opens it cold.

- [x] R2 — Typed `AppSettingKey` / `StoryStateKey` enums in use; no string-key settings access. *(PASS — typed helpers in db/settings.rs; zero literal-key access. Finding: CQ-06 header overclaim.)*
- [x] R3 — `no-cross-store-imports` ESLint rule live and clean. *(PASS — `import/no-restricted-paths` zone at eslint.config.js:46 set to `error`; CI runs a positive-control fixture (`scripts/check-eslint-fixture.mjs`) that fails if the rule stops firing; 7 stores, zero cross-store imports. No finding.)*
- [x] R4 — `ts-rs` generated `types.ts` exists, is committed, CI drift-check active, no stale types. *(FAIL — substrate hole. ts-rs reference exists at src-tauri/src/lib/types.ts but consumed src/lib/types.ts is hand-maintained; CI "drift check" diffs the wrong path → no-op. Findings: SB-02 (this phase, sharpens SB-01).)*
- [x] R7 — `tokio_util::CancellationToken` per-request; cancellation actually propagates to in-flight Gemini streams. *(PASS — fresh token per request via `install_cancel_token` in all 4 gen paths (conversation send+regen, modes, ghostwriter, accordion); biased `tokio::select!` on `cancel_token.cancelled()` at send/parse and each SSE loop iteration drops the reqwest response to abort the connection (gemini.rs:214/231/324/345). No new finding — cancel_tx doc-type drift = CD-05; concurrent-gen orphaning of prior token = mechanism of CQ-03.)*
- [x] R17 — `with_active_conn` (and siblings) helpers in use; no raw `.lock()` on `AppState` fields. *(PASS in substance — every command/service routes through `state/access.rs` helpers; the only `.lock()` calls on AppState fields are in access.rs (allowed) + one test helper + `AppState::drop`. CI SB-5 gate covers all 7 fields. Finding: CQ-07 (Drop is an undocumented exception to the "only call sites" claim; gate's `state.` prefix misses `self.`-style locks).)*
- [x] R18 — Numbered SQL migrations in `db/migrations/`; migration runner verified. *(PASS, no finding. Dual-root (`world/`, `app/`) numbered SQL bundled via `include_str!`; `apply_pending` runs pending in numeric order, each in its own transaction, records version+name+applied_at in per-root `schema_migrations`; idempotent; contiguous-order `debug_assert`; covered by 3 tests. Only `CREATE TABLE` in Rust is the `schema_migrations` bootstrap — no heuristic/ad-hoc schema (SB-6 honoured).)*
- [x] R19 — Component LOC distribution; flag anything > 600 lines without justification. *(One file over cap: `Navigator.tsx` at 629 (next-largest 392). Finding: CQ-08. Already decomposed (sub-components extracted), 29 over — marginal. Full histogram deferred to B4.)*

### Phase B2 — Forbidden patterns scan

> **Status:** Complete (2026-05-21)
>
> **Resumption notes:**
> - 2026-05-21 — Phase started. Running the 7 forbidden-pattern grep sweeps directly (controlled evidence). Highest existing finding IDs: CQ-08, SB-02, DG-11.
> - 2026-05-21 — recorded CQ-09 (`// Phase N` comments — 5 production + 2 test sites; 2 of the production sites are `///` doc-comments baking temporal coupling into API docs).
> - 2026-05-21 — recorded CQ-10 (`.unwrap()` in production — 2 sites only: auth.rs:85, conversation.rs:292; 528/530 unwraps are test code).
> - 2026-05-21 — clean sweeps (no finding): raw `invoke(` outside tauriApi/ (zero), hex-in-components (only benign placeholder), hardcoded model names (typed default + UI list + tests), git-log hook-bypass (none). `.lock()`-on-AppState sweep surfaced only the `AppState::drop` sites already held by CQ-07 (B1) — no new finding.
> - 2026-05-21 — `.claude/worktrees/` excluded from all sweeps as scratch checkouts (out of audit scope; their hits are duplicates of the main tree).
> - 2026-05-21 — Phase B2 complete. 7/7 checkpoints ticked. 2 findings (CQ-09, CQ-10), both CQ, no HB. One-phase-per-session: do NOT roll into B4 — next session opens it cold.

(All sweeps run as parallel sub-agent grep tasks where useful.)

- [x] `// Phase N` comments — must be zero. *(NOT zero. Finding CQ-09: 5 production + 2 test sites — Navigator.tsx:125-127, modeStore.ts:175, services/modes.rs:128, services/world.rs:401 (///), db/messages.rs:427 (///), + 2 test-file headers.)*
- [x] Raw `.lock()` on `AppState` fields — must be zero. *(Outside `state/access.rs` the only matches are `AppState::drop` (mod.rs:49,54) — already captured by CQ-07 in B1. access.rs:265 `.lock().unwrap()` is in that file's test helper. No new finding.)*
- [x] Raw `invoke(` outside `src/lib/tauriApi/` — must be zero. *(PASS — zero matches in `src/` outside tauriApi/. Confirms A2's containment observation.)*
- [x] Hex literals in component files — must be zero (CSS variables only). *(PASS for styling. Sole match `SettingField.tsx:219` is a placeholder string `'#6b9f78'` showing the user the accent-hex input format — content, not a styling value; same disposition as the A3/Doc 08 walk. Cross-ref CQ-02 (raw Tailwind colour classes).)*
- [x] Hardcoded model names (`"gemini-2.5-flash"` etc.) outside settings — must be zero. *(PASS. Only production literals: `settings_keys.rs:123` (the typed-accessor default — the compliant single source, doc-commented "Hardcoded fallback per Doc 03's defaults column") and `settingsSchema.ts:35-39` MODEL_OPTIONS (UI dropdown enumeration, not a fallback). All others are `#[cfg(test)]` fixtures. `.claude/worktrees/` matches excluded — scratch checkouts, out of audit scope.)*
- [x] `.unwrap()` in production paths — must be zero. *(NOT zero. Finding CQ-10: exactly 2 production sites — auth.rs:85, conversation.rs:292 — out of 530 total; the other 528 are all inside `#[cfg(test)]` modules. Both production sites low panic-risk.)*
- [x] `--no-verify` / `--no-gpg-sign` traces in git log — must be zero. *(PASS — no bypass traces in any commit message across full history. All commits are unsigned (`%G?`=N), but that reflects no signing configured on this dev machine, not a `--no-gpg-sign` bypass; `--no-verify` leaves no log trace. No finding.)*

### Phase B4 — Component & store health

> **Status:** Complete (2026-05-21)
>
> **Resumption notes:**
> - 2026-05-21 — Started and completed in one session (B1, B2 done in prior sessions). 4/4 checkpoints ticked. 1 finding: CQ-11 (1× CQ). No HB.
> - Per-checkpoint: B4.1 LOC histogram — 41 component files / 7640 LOC; only Navigator.tsx > 600 cap (629; already CQ-08), clean gap to next (392); no new finding. B4.2 store graph — 7 stores, zero cross-store imports (R3/SB-2 honoured); no finding. B4.3 typed-IPC — all ~75 invoke calls (incl. generic `invoke<T>(`, which an initial `invoke(`-only grep missed) sit in typed `tauriApi/` wrappers; `getVersion`/`listen` are first-party plugin APIs, not `invoke`; full coverage, no finding. B4.4 isGenerating — clean single-flag/single-owner (workspaceStore sole mutator, all else read-only selectors) EXCEPT accordion summarisation bypasses the flag → CQ-11.
> - CQ-11 is the load-bearing finding: pairs with CQ-03 (no backend concurrent-gen guard) — together they're a real Architecture Wall #6 violation (summarise→send fires two concurrent model calls). Flag for Pass C elevation.
> - /audit-verify run clean 2026-05-21. One-phase-per-session: do NOT roll into B5 — next session opens it cold.

- [x] LOC distribution per component file; histogram. *(41 component files, 7640 LOC. Only Navigator.tsx > 600 cap (629 — already CQ-08); next-largest WorldPickerModal.tsx 392, then AccordionBanner 391, InputArea 371, TheaterBody 365, StoryAIBubble 311. Zero files in the 400–599 band. No new finding.)*
- [x] Store import graph — verify no store imports another store. *(PASS — 7 stores (app/auth/cache/mode/settings/vault/workspace); every import resolves to `zustand`, `@/lib/*`, or `@/lib/types`; zero cross-store imports incl. same-directory relative form. Confirms R3 / SB-2. No finding.)*
- [x] Typed-IPC wrapper coverage — every `invoke()` call resolves to a typed wrapper in `src/lib/tauriApi/`. *(PASS — `invoke` imported only in the 9 `tauriApi/` domain files; ~75 invoke calls (incl. generic-typed `invoke<T>(`) all sit inside named exported wrapper fns. `@tauri-apps/api/app::getVersion` (SettingsTabContent) + `@tauri-apps/api/event::listen` (useWorkspaceEvents) are first-party plugin APIs, not `invoke` — outside the rule. Test files mock `@tauri-apps/api/core` per the documented testing rule. No finding.)*
- [x] `isGenerating` — single flag, single owner, single state machine. *(Single flag, single owner: declared + mutated only in `workspaceStore`; all other references are read-only `useWorkspaceStore((s) => s.isGenerating)` selectors. Check-and-set on story send / session send / regenerate / ghostwriter. Finding: CQ-11 — accordion `summariseSegment` is an in-flight model call that bypasses the flag (no check, no set), relying on a backend gate that CQ-03 proved absent → asymmetric concurrency hole vs. Architecture Wall #6.)*

### Phase B5 — Error / empty state coverage

> **Status:** Complete (2026-05-21)
>
> **Resumption notes:**
> - 2026-05-21 — Phase started. Premise note: DG-06 (A3) already established Doc 12 has no LoomError variant↔display-rule matrix, so checkpoint 1 runs as a *code-side* audit — map each LoomError variant to its actual frontend display path, check against Doc 12 copy guidance. Checkpoint 2 is the code-side verification of CD-13's doc-walk empty-state findings.
> - 2026-05-21 — recorded HB-01 (**first HB of the audit**): serde internally-tagged `#[serde(tag="kind")]` cannot serialize the 10 newtype-`String` LoomError variants; ts-rs reference output corroborates with the `{ "kind": "x" } & string` intersection. Structured command errors never cross IPC intact. Verify empirically in remediation; lean = adjacently-tagged `content="message"`.
> - 2026-05-21 — recorded CD-33: Doc 12 §Error Display Hierarchy unimplemented as a system — catch sites collapse to hardcoded fallback via dead `instanceof Error` branch (no `.kind` read), generation errors render as raw `⚠ Stopped · rate_limited` in the auto-collapsing Status pane, no blocking-modal/persistent-toast tiers exist. Code-side companion to DG-06.
> - 2026-05-21 — CP1 done. Variant↔display map: all 10 String variants → (a) command path: serde-mangled (HB-01) → generic fallback toast (CD-33); (b) generation path bypasses LoomError via `generation_failed` event string kind → Status line (CD-33). `Validation` struct variant serializes OK but still unread by any catch site. Wrong-password is the only inline path and it ignores the error entirely (bare `catch`).
> - 2026-05-21 — recorded CD-34: implemented empty states (No Worlds/No Stories/Trash Empty) drop the spec'd icon; No Stories also omits [New story] action; Navigator filter-empty ("No items match the filter.") is a partial non-spec No-Search-Results stand-in. Distinct from CD-13 (absent/wrong-copy). Compliant: No Messages, No Story Selected (without-recents).
> - 2026-05-21 — Phase B5 complete. 2/2 checkpoints ticked. 3 findings: HB-01 (first HB), CD-33, CD-34. Verified clean via /audit-verify. One-phase-per-session: do NOT roll into B6 — next session opens it cold.

- [x] `LoomError` variant ↔ Doc 12 display rule matrix — every variant has a rule, every rule maps to a variant. *(Ran as code-side audit per DG-06. Findings: HB-01 (serde can't serialize 10/11 variants), CD-33 (no kind→surface/copy routing; Doc 12 hierarchy unimplemented). The "matrix" the checkpoint presumes exists in neither doc (DG-06) nor code.)*
- [x] Zero-data UI per Doc 12 — verified in code for each surface (Navigator empty, Theater empty, Vault empty, Settings empty, etc.). *(9 states walked in code. Compliant: No Messages (verbatim, no icon per spec), No Story Selected without-recents (icon present). Drifted/absent (CD-13 from A3, confirmed code-side): No Story Selected recents list, No Source Documents, No Attached Documents, No Search Results, Handover/Consulting. New finding CD-34: No Worlds / No Stories / Trash Empty render correct copy but drop the spec'd icon; No Stories also omits its [New story] action; Navigator has a filter empty state ("No items match the filter.") as a partial non-spec stand-in for No Search Results.)*

### Phase B6 — Build & lint health (baseline snapshot)

> **Status:** Complete (2026-05-21)
>
> **Resumption notes:**
> - 2026-05-21 — Started and completed in one session. 6/6 checkpoints ticked. **No findings** — every gate green (baseline table in ledger §Phase B6).
> - Results: `cargo build` 0 warn · `cargo clippy --all-targets --all-features` 0 warn (passes `-D warnings`) · `tsc --noEmit` 0 err · `pnpm lint` 0 problems · `pnpm test` 37/37 · `cargo test` 233/233. (Rust commands run with `OPENSSL_DIR` set per Windows req.)
> - **Process note:** `cargo test` ran the `ts_rs_export` integration test, which writes the tracked `src-tauri/src/lib/types.ts` (the exact write SB-02 flagged). That accidental working-tree edit was reverted via `git checkout --` to honour the cardinal rule — empirically corroborates SB-02 (the export *does* write a tracked file). Future B7 / re-runs: prefer `cargo test --workspace --exclude` of the export test, or revert after.
> - Pass-C hook: every finding through B5 is *semantic* (contract HB-01, concurrency CQ-03/CQ-11, doc-drift) — none caught by the toolchain. That gate/finding asymmetry is noted in the ledger for synthesis.
> - One-phase-per-session: do NOT roll into B7 — next session opens it cold.

- [x] `cargo build` — warning count, list. *(Clean — 0 warnings, 0 errors.)*
- [x] `cargo clippy` — warning count, list. *(Clean — 0 warnings via `--all-targets --all-features`; satisfies `-D warnings`.)*
- [x] `tsc --noEmit` — error/warning count, list. *(Clean — 0 errors.)*
- [x] `pnpm lint` — warning count, list. *(Clean — 0 errors, 0 warnings.)*
- [x] `pnpm test` — pass/fail/skip counts. *(37 passed / 0 failed / 0 skipped across 7 files.)*
- [x] `cargo test` — pass/fail/skip counts. *(233 passed / 0 failed / 0 ignored.)*

**No fixes during this phase — observe only.** Output captured into the ledger as a baseline.

### Phase B7 — Test coverage map

> **Status:** Complete (2026-05-22)
>
> **Resumption notes:**
> - 2026-05-22 — Phase started (final Pass B phase). Read Doc 25 (testing strategy) + existing test-related findings (CQ-05 rate-limiter unimplemented, DG-08 fixture absent, SB-02 ts-rs gate no-op, CD-30 pre-commit drift) to avoid dupes. Test files on disk: `src-tauri/tests/{canary,gemini_sse_mock,ts_rs_export}.rs` + frontend `src/**/*.test.{ts,tsx}`.
> - 2026-05-22 — CP1+CP2: walked all 6 Doc 24/25 required Rust modules. crypto.rs (8 tests) + sentinel.rs (4) exhaustive ✓; history.rs (~25), settings.rs (6 cascade), cache.rs (prefix/stale/create-TTL) all cover their named "High" invariants ✓. rate_limiter.rs absent → already CQ-05 (cross-ref, no dupe). cache.rs "TTL expiry logic" = Gemini-managed; local alive/expired is DB-flag-based, tested at db/cache_state.rs:352 — no gap. Coverage table recorded in ledger §Phase B7.
> - 2026-05-22 — Frontend gap: recorded CQ-12 — Doc 25 "High" targets applyTheme + cn() have zero tests; 4 of 7 stores untested (auth/mode/settings/vault). Tested stores: app/cache/workspace.
> - 2026-05-22 — recorded CD-35 — Doc 24:261 + :906 call Doc 25 "currently a stub" but Doc 25 is Complete (2026-05-07). Distinct from CD-30; cross-ref it.
> - 2026-05-22 — CP3: canary.rs proves the in-memory SQLite fixture recipe works + functional (cargo test 233/233, B6); 19 modules use open_in_memory() in inline #[cfg(test)] tests. Shared tests/helpers/mod.rs still absent → DG-08 (cross-ref, no dupe). No new finding.
> - 2026-05-22 — Phase B7 complete. 3/3 checkpoints ticked. 2 findings (CQ-12, CD-35), no HB. Pass B complete. Next: Pass C synthesis (C1) — open a new session per one-phase-per-session.

- [x] What modules have tests vs. what Doc 25 expects to have tests. *(Coverage table in ledger §Phase B7. All 6 required Rust modules present except rate_limiter.rs (CQ-05). Frontend gap → CQ-12 (applyTheme/cn/4 stores). Doc-cross-ref → CD-35.)*
- [x] `crypto.rs` / `rate_limiter.rs` / `history.rs` coverage (Doc 24 minimum bar). *(crypto.rs exhaustive ✓ (8 tests, all named invariants); history.rs exceeds High ✓ (~25 tests); rate_limiter.rs absent ❌ → CQ-05. Bonus: sentinel/settings/cache also walked — all covered.)*
- [x] Integration tests using in-memory SQLite — present? functional? *(Present + functional: canary.rs proves the fixture recipe end-to-end; 19 modules use open_in_memory() inline. Shared helper absent → DG-08. No new finding.)*

---

## Pass C — Synthesis

### Phase C1 — Prioritized punch list

> **Status:** Complete (2026-05-22)
>
> **Resumption notes:**
> - 2026-05-22 — Phase started. Full finding inventory extracted from ledger: **65 findings** — 1 HB, 2 SB, 35 CD, 1 SD, 3 IP, 12 CQ, 11 DG. (Ledger header line 3 said "63" — that count predated B7's CQ-12 + CD-35.)
> - 2026-05-22 — Synthesis is read-from-ledger work, not fresh observation, so C1 may share a session with C2 (the one-phase-per-session rule targets intensive *observation* phases A1–A4/B1–B7; C1/C2 are not on that list).
> - 2026-05-22 — Punch list written to ledger §Synthesis (Pass C) → Phase C1: severity tally + 5 tiers (Tier 1 HB-01; Tier 2 SB cluster; Tier 3 CD/SD/IP batched 3a–3m by surface; Tier 4 CQ batched 4a–4e; Tier 5 DG) + a 9-cluster doc↔code cross-reference map. All 3 checkpoints satisfied.
> - 2026-05-22 — Headline chain: SB-01 → SB-02 → HB-01 → (CD-33 + DG-06). CQ-03 + CQ-11 flagged as a real Wall #6 violation — candidate for HB-tier elevation in the C2 proposal. C1 complete; ready for /audit-verify then C2.

- [x] Order all ledger findings by severity (HB → SB → CD/SD/IP → CQ → DG). *(Tally table + 5 tiers in ledger §Synthesis → C1.)*
- [x] Within each severity, order by surface (so a remediation session can batch a surface). *(Tier 3 batched 3a–3m; Tier 4 batched 4a–4e; Tier 5 grouped by surface.)*
- [x] Cross-reference: where doc drift caused code drift (or vice versa), link the two. *(9-cluster cross-reference map; headline = type-gen → error-contract chain.)*

### Phase C2 — Remediation phase proposal

> **Status:** Complete (2026-05-23) — proposal approved with decisions D1–D6; remediation landed as separate non-audit edits.
>
> **Resumption notes:**
> - 2026-05-23 — **Approved.** Decisions D1–D6 resolved (see ledger §Phase C2 → Decisions resolved). Landed: Phase 12.5 (Audit Remediation) + Phase 12.6 (World Backup) into IMPLEMENTATION-PLAN.md; Bucket-2 verification checkpoint added to Phase 12; R20–R29 appended to IMPROVEMENT-BACKLOG.md; PRE-AUDIT immutability banner (D2); Doc 14 §Out of Scope contradiction resolved (D1). Audit is now closed/observational-complete.
> - 2026-05-22 — Proposal drafted into ledger §Synthesis (Pass C) → Phase C2. Read IMPLEMENTATION-PLAN.md (Phase 12 still In progress; Phase 13 Not started, its goal already requires CSP verification) + IMPROVEMENT-BACKLOG.md (house style; next free R-number is R20).
> - 2026-05-22 — Routing realisation: findings split **four** ways, not two. Phase 12 is unfinished, so ~13 CD/DG findings belong to its remaining scope (12-3A+/12-Z), not a new phase. Buckets: (1) Phase 12.5 = 10 ship-blockers in 4 clusters [12.5-A IPC errors, 12.5-B CSP red line, 12.5-C concurrency Wall #6, 12.5-D schema FK]; (2) fold into Phase 12 = 13; (3) backlog R20–R27 = ~36; (4) owner decisions D1–D6. All 65 findings routed (coverage check in ledger).
> - 2026-05-22 — **Awaiting owner approval** before any edit to IMPLEMENTATION-PLAN.md / IMPROVEMENT-BACKLOG.md. Checkpoint 3 stays open until approval + the separate (non-audit) edits land.
> - 2026-05-22 — **Owner deferred the decision: "next session we will discuss how to proceed."** Proposal is documented and frozen; no source-doc edits made. **NEXT SESSION:** read ledger §Synthesis (Pass C) → Phase C2 (the full proposal — 4 buckets + coverage check), discuss/resolve owner decisions D1–D6, then land the approved structure (Phase 12.5 into IMPLEMENTATION-PLAN.md + R20–R27 into IMPROVEMENT-BACKLOG.md) as a **separate, non-audit** edit. Audit stays observational until then.

- [x] Draft a proposed new phase (likely Phase 12.5) for `IMPLEMENTATION-PLAN.md` covering HB-* items that must land before Phase 13. *(Phase 12.5 drafted — 4 clusters; ledger §C2 Bucket 1.)*
- [x] Draft `IMPROVEMENT-BACKLOG.md` additions for non-blockers. *(R20–R27 drafted; ledger §C2 Bucket 3.)*
- [x] Present to user; await approval before any edits to `IMPLEMENTATION-PLAN.md` (audit remains observational; only the proposal lands as an edit, separately). *(Presented 2026-05-22; **approved 2026-05-23** with decisions D1–D6. Remediation landed as separate non-audit edits — see §Phase C2 → Decisions resolved.)*

---

## Session log

| Date | Phases touched | Notes |
|---|---|---|
| 2026-05-20 | Plan drafted | This file + ledger skeleton + README created. Audit not yet started. |
| 2026-05-20 | A1 + B3 | All 9 checkpoints ticked. 3 findings recorded: CD-01, SD-01, CD-02. No HB. |
| 2026-05-20 | A2 | All 4 checkpoints ticked. 10 findings: CD-03..CD-08, CQ-01, SB-01, IP-01..IP-03, DG-01. No HB. |
| 2026-05-20 | A3 | All 6 checkpoints ticked across two sessions (Doc 08 in prior session; Docs 09/10/11/12/27 this session). 11 findings total: CQ-02, DG-02, CD-09 (prior); CD-10..CD-15, DG-03..DG-06 (this session). No HB. |
| 2026-05-20 | A4 | All 13 checkpoints ticked (Docs 13–23, 28, 29). 14 findings: CD-16..CD-26 (11×), CQ-03, CQ-04, DG-07. No HB. Doc 17, Doc 18, Doc 22, Doc 28, Doc 29 faithfully implemented; Docs 19 + 21 correctly deferred. |
| 2026-05-20 | A7 | Single light-phase session. 1 checkpoint ticked. 8 PRE-AUDIT open items walked, disposition table added to ledger §Phase A7. 1 finding: DG-11 (PRE-AUDIT not maintained as resolutions land — NB-1 partially closed by Doc 08 2026-05-17 sweep but not ticked; needs immutable-vs-live decision + migration of remaining ⚠️ items to TODO/IMPROVEMENT-BACKLOG). Pass A complete; Pass B next session. |
| 2026-05-20 | A5 + A6 | Paired light-phase session. A5: 3 checkpoints, 6 findings (CD-27 tailwindcss-plugin dropped, CD-28 no-default-export missing, CD-29 exhaustive-deps not error, CQ-05 rate-limiter entirely unimplemented — biggest finding, CD-30 Doc 25 pre-commit table contradicts Doc 24, DG-08 helpers/mod.rs absent). A6: 5 checkpoints, 4 findings (CD-31 IMPL-PLAN status drift, DG-09 IMPL-NOTES frozen, DG-10 HANDOVER frozen, CD-32 CLAUDE.md §10 self-contradicts on CSP). 10 total findings; no HB. Pass A complete except A7 (PRE-AUDIT reconciliation). |
| 2026-05-21 | B1 | First Pass B phase. All 7 checkpoints ticked. 4 findings: CQ-06 (db/settings.rs "only place" header overclaim — vault.rs reverse-lookup also queries story_state, but typed), SB-02 (CI ts-rs drift gate is a no-op — diffs repo-root src/lib/types.ts which the export never writes; sharpens SB-01), CQ-07 (AppState::drop is an undocumented exception to SB-5 "only call sites"; gate's `state.` prefix misses `self.` locks), CQ-08 (Navigator.tsx 629 lines > 600 cap). R3/R7/R18 clean. No HB. |
| 2026-05-21 | B2 | Forbidden-patterns scan. All 7 checkpoints ticked. 2 findings: CQ-09 (`// Phase N` comments — 5 production + 2 test sites), CQ-10 (`.unwrap()` in production — only 2 of 530 are outside `#[cfg(test)]`: auth.rs:85, conversation.rs:292). 5 sweeps clean (raw invoke, hex-in-components, model names, git-log bypass, `.lock()`-on-AppState which only re-surfaced CQ-07). No HB. |
| 2026-05-21 | B4 | Component & store health. All 4 checkpoints ticked. 1 finding: CQ-11 (accordion summarisation bypasses the global `isGenerating` flag — asymmetric concurrency hole; pairs with CQ-03's missing backend guard to violate Architecture Wall #6). Clean: LOC histogram (only Navigator.tsx > 600, already CQ-08), store graph (zero cross-store imports), typed-IPC coverage (all invoke calls wrapped). No HB. |
| 2026-05-21 | B5 | Error / empty-state coverage. Both checkpoints ticked. 3 findings — **HB-01 (first Hard Blocker of the audit)**: serde `#[serde(tag="kind")]` cannot serialize the 10 newtype-`String` LoomError variants (ts-rs `& string` corroborates) → structured command errors never cross IPC; CD-33: Doc 12 §Error Display Hierarchy unimplemented (catch sites collapse to fallback via dead `instanceof Error` branch; generation errors render raw `⚠ Stopped · rate_limited` in the auto-collapsing Status pane; no modal/persistent tiers); CD-34: implemented empty states (No Worlds/No Stories/Trash Empty) drop the spec'd icon, No Stories omits its action. Compliant: No Messages, No Story Selected (without-recents). |
| 2026-05-21 | B6 | Build & lint health baseline. All 6 checkpoints ticked. **No findings** — every gate green: `cargo build` 0 warn, `cargo clippy` 0 warn, `tsc --noEmit` 0 err, `pnpm lint` 0 problems, `pnpm test` 37/37, `cargo test` 233/233. Baseline table in ledger §Phase B6. Process note: `cargo test` ran `ts_rs_export` which wrote tracked `src/lib/types.ts` (corroborates SB-02); reverted via `git checkout --` to keep the audit observation-only. |
| 2026-05-22 | B7 | Test coverage map (final Pass B phase). All 3 checkpoints ticked. 2 findings: CQ-12 (Doc 25 "High" frontend targets untested — applyTheme/cn() zero tests, 4 of 7 stores untested), CD-35 (Doc 24 calls Doc 25 a "stub" in 2 places but Doc 25 is Complete). Rust required modules all covered except rate_limiter.rs (CQ-05 cross-ref); crypto/sentinel exhaustive, history/settings/cache cover named invariants; in-memory SQLite fixture proven via canary.rs (shared helper still absent → DG-08). No HB. **Pass B complete.** |
