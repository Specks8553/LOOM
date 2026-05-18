# LOOM 2.0 — Documentation Index

> **Status:** In progress — implementation phase open; Phase 0 and Phase 0.5 complete
> **Last updated:** 2026-05-16 — Phase 10 re-scoped. D-20: the media surface (image source documents included) is deferred wholesale to v2.1 — Doc 19 status flipped to Deferred. D-21: source-document request delivery model locked — a single prefix builder feeds either a real Gemini cache or an inline "fake cache" (prepended verbatim); a failed cache-create aborts the send with a warning unless the new `inline_context_fallback` setting is on. Doc 03 (`inline_context_fallback` app-settings key), Doc 19 (status), Doc 22 (delivery model section) amended.
> **Earlier:** 2026-05-07 — Doc 25 (Testing Strategy) complete; D-19 (Testing Strategy umbrella) added; ST-3 ticked. Vitest + wiremock + happy-dom tooling landed; all recipes demonstrated by passing canary tests; Playwright E2E deferred to v2.0.x. Phase 0 complete (2026-05-07): all 9 checkpoints ticked, SB-1..SB-6 closed.
> **Earlier:** 2026-05-05 — `IMPLEMENTATION-PLAN.md` drafted: 14 phases (0 Substrate → 0.5 Doc 25 Testing → 1 Auth → 2 Vault/Worlds → 3 Conversation Engine story-mode → 4 Modes → 5 Source Documents → 6 Caching → 7 Accordion → 8 Ghostwriter → 9 Feedback → 10 Media slim → 11 Settings/Themes → 12 Visual polish → 13 Build/Release/Doc 26). Each phase has Status / Goal / Inputs / Scope / Testable Checkpoints / Out of Scope / Resumption notes. `_new_claude.md` §The phase model amended: `Resumption notes:` must be updated **live, not at session end** — sessions end abruptly. Document Map below adds `IMPLEMENTATION-PLAN.md` as the canonical phase ledger.
> **Earlier:** 2026-05-04 — Doc 24 (Coding Standards) complete; D-18 (Coding Standards umbrella) added; ST-2 closed. Three enforcement tiers (🔴 Linted / 🟡 Reviewed / ⚪ Convention); `tracing` over `log`; `safecommand!` macro dropped; Conventional Commits; `ts-rs` generated `types.ts` committed with CI drift-check; husky + lint-staged pre-commit; SB-1..SB-3, SB-5, SB-6 substrate items have rule home + `<!-- SB-N -->` anchors here (code lands in Phase 0); SB-4 (cancellation lifecycle) deferred to a dedicated Doc 05 amendment pass; v1.0 anti-pattern appendix (13 items) with Forbidden / Preferred snippet pairs. Doc 05 (lock-helper rule cross-ref, `tracing` note, cancellation cross-ref), Doc 06 (`types.ts` SoT line, ESLint enforcement note on §Store Rules) amended; PRE-IMPLEMENTATION-AUDIT ST-2 ticked; IMPROVEMENT-BACKLOG R3 / R5 / R13 / R19 closed, R2 / R4 / R17 / R18 marked "spec'd in Doc 24 — code pending Phase 0"; v1 rule files in `.claude/rules/` annotated with v2.0 banners.
> **Earlier:** 2026-05-04 — Doc 28 (Feedback) complete; D-17 (Feedback umbrella) added; per-bubble inline strip is the sole affordance, v1's right-pane Feedback Overlay dropped; explicit Apply / Cancel (no auto-save on blur); `--color-feedback` triad (default `#f59e0b`, world-overridable, does not track accent); Doc 11 §Escape Chain fully rewritten (CD-6 closed) — priority 5 = Feedback edit; Doc 03 (`feedback_color` key, `ResolvedSettings`), Doc 06 (`workspaceStore.feedbackEditingMessageId` + 3 actions), Doc 07 (`update_feedback` notes), Doc 08 (token triad), Doc 11 (escape chain), Doc 15 (cross-ref Doc 28), Doc 20 (Features tab row, ThemeSnapshot, applyTheme writes), Doc 27 (bubble-strip placement) amended; PRE-IMPLEMENTATION-AUDIT CD-13 added + ticked, CD-6 ticked.
> **Earlier:** 2026-05-03 — pre-implementation audit resolution batch (PRE-IMPLEMENTATION-AUDIT.md): 6 of 7 Hard Blockers, 11 of 12 Cross-Doc Inconsistencies, all Schema/IPC drift, and the Doc 21 deferral resolved. Touched docs: 02 (CD-10), 03 (HB-1, HB-2, HB-5, CD-2, CD-9, IP-3, IP-9, SD-6), 04 (CD-11), 05 (HB-6, HB-7), 06 (CD-7, CD-8), 07 (HB-4), 08 (CD-1, CD-2, CD-3), 09 (CD-4), 10 (CD-5), 11 (HB-3 only — full CD-6 Escape Chain rewrite pending Feedback design pass / CD-13), 14 (IP-3, CD-7), 17 (HB-1, CD-2), 18 (HB-2, CD-8, IP-8), 19 (IP-2), 20 (CD-1, CD-2), 21 (status flipped to Deferred to v2.0.x — ST-1), 22 (CD-12), 23 (CD-9). CD-6 escape-chain rewrite and the new CD-13 (Feedback affordance spec) are scheduled for the next session.
> **Earlier:** 2026-05-03 — Doc 20 (Settings and Themes) complete; D-16 (Settings & Themes umbrella) added; full-surface Settings (replaces v1 modal); two scopes only (App + World — story scope removed); cascade UX (auto-create override on edit, `↺` revert, per-tab "Reset all overrides"); modificators have no Settings home (free-text per-turn — Doc 15 amended); dark-only in v2.0 (light mode deferred to v2.1); `cache_min_tokens` exposed (TODO O16 partially closed — exposure spec'd, default still empirical); Doc 03 (`modificator_presets` removed; `cache_min_tokens` added; `cache_ttl_secs` / `cache_min_tokens` / `context_token_limit` added to world-overridable list), Doc 06 (`settingsStore` extended), Doc 07 (`commands/settings.rs` populated, story-scope commands dropped), Doc 15 (Modificators subsection rewritten) amended
> **Earlier:** 2026-04-29 — Doc 19 (Media, slim) complete; D-15 (Media slim umbrella) added; image-as-source-doc only — image generation, TTS, per-turn user images, AI-`blocks` messages all deferred to v2.1 (`docs-v2/future/media-generation.md`); World Backup added to Doc 14; narrative story export (Doc 21) deferred to v2.1; Doc 07 (`upload_image`, `export_world`, `import_world` flipped to specified), Doc 14 (World Backup section), Doc 18 (cross-ref to Doc 19 helper) amended; TODO O6 closed
> **Earlier:** 2026-04-29 — Doc 17 (Ghostwriter) complete; D-14 (Ghostwriter umbrella) added; surgical-stitching protocol adopted from memory; mode-first activation retained; in-place-only on non-latest messages; available in all three modes; floating panel pinned to bubble extent in the Theater's right gutter; `blocks` content-type deferred to v2.1; Doc 06 (`workspaceStore.ghostwriter` field/actions), Doc 07 (`ghostwriter` command domain), Doc 11 (selection-first wording corrected to mode-first), Doc 27 (Ghostwriter floating-panel placement) amended
> **Earlier:** 2026-04-29 — Doc 18 (Source Documents) complete; D-13 (Source Documents umbrella) added; Source Document Creator deferred to v2.1 (`docs-v2/future/source-document-creator.md`); Doc 06 (`workspaceStore` doc-edit + attach/detach actions), Doc 07 (vault commands flipped to specified), Doc 14 (vault row paperclip), Doc 22 (rename + soft-delete-cascade stale triggers), Doc 23 (Right Pane Context Documents wording) amended
> **Earlier:** 2026-04-29 — Doc 16 (Context Compression / Accordion) complete; D-12 (Accordion umbrella) added; Doc 03 (`use_summary` column, four `gen_summarise_*` keys), Doc 06 (`workspaceStore` accordion fields/actions), Doc 07 (`accordion` command domain populated), Doc 15 (`isGenerating` covers summarise), Doc 22 (accordion-specific stale triggers), Doc 27 (accordion banner detail) amended; TODO O3 + VERIFY-Doc-16 closed
> **Earlier:** 2026-04-29 — Doc 23 (Modes) complete; Doc 22 (Context Caching) complete; Doc 27 (Theater Composition) created; D-10 (Modes umbrella) and D-11 (Caching architecture) added; Doc 03, Doc 06, Doc 07, Doc 10, Doc 15, Doc 21 amended
> **Earlier:** 2026-04-28 — Doc 15 (Conversation Engine) complete; D-08 (engine v2 umbrella) and D-09 (undo/redo deferred to v2.1) added; Doc 03, Doc 07 amended; `docs-v2/future/undo-redo.md` captured for v2.1
> **Earlier:** 2026-04-27 — consultant pass: cross-doc reconciliation, cacheStore added, world-switch key handling resolved, internal prompts moved to Developer section, Sonner added to stack

Navigation hub and decision log for LOOM 2.0. All architectural decisions are recorded here with rationale. Before starting any implementation session, check this file for relevant decisions and open questions.

---

## Document Map

### Foundation — immutable; changes require explicit versioning

| Doc | Title | Status |
|---|---|---|
| [01](foundation/01-vision-and-principles.md) | Vision and Principles | Complete |
| [02](foundation/02-security-model.md) | Security Model | Complete |
| [03](foundation/03-data-model.md) | Data Model | Complete |

### Architecture — stable once settled

| Doc | Title | Status |
|---|---|---|
| [04](architecture/04-system-overview.md) | System Overview | Complete |
| [05](architecture/05-backend-modules.md) | Backend Modules | Complete |
| [06](architecture/06-frontend-architecture.md) | Frontend Architecture | Complete |
| [07](architecture/07-ipc-contracts.md) | IPC Contracts | Format complete — signatures populated per feature doc |

### Design — single source of truth for all visual decisions

| Doc | Title | Status |
|---|---|---|
| [08](design/08-design-tokens.md) | Design Tokens | Complete — values finalized (Designfiles) |
| [09](design/09-component-library.md) | Component Library | Complete — visual values finalized (Designfiles) |
| [10](design/10-layout-and-navigation.md) | Layout and Navigation | Complete |
| [11](design/11-interaction-patterns.md) | Interaction Patterns | Complete — shortcuts deferred |
| [12](design/12-empty-states-and-errors.md) | Empty States and Errors | Complete — copy partly verified (Designfiles) |
| [27](design/27-theater-composition.md) | Theater Composition | Complete — visual values reconciled (Designfiles) |

### Features — one doc per feature; self-contained

| Doc | Title | Status |
|---|---|---|
| [13](features/13-auth-and-onboarding.md) | Auth and Onboarding | Complete |
| [14](features/14-vault-and-worlds.md) | Vault and Worlds | Complete |
| [15](features/15-conversation-engine.md) | Conversation Engine | Complete |
| [16](features/16-context-compression.md) | Context Compression (Accordion) | Complete |
| [17](features/17-ghostwriter.md) | Ghostwriter | Complete |
| [18](features/18-source-documents.md) | Source Documents | Complete |
| [19](features/19-media.md) | Media System | Deferred to v2.1 (D-20) |
| [20](features/20-settings-and-themes.md) | Settings and Themes | Complete — visual values provisional |
| [21](features/21-export-and-reader.md) | Export and Reader View | Deferred to v2.0.x |
| [22](features/22-context-caching.md) | Context Caching | Complete |
| [23](features/23-modes.md) | Modes | Complete |
| [28](features/28-feedback.md) | Feedback | Complete |

### Dev — internal; for contributors

| Doc | Title | Status |
|---|---|---|
| [24](dev/24-coding-standards.md) | Coding Standards | Complete |
| [25](dev/25-testing-strategy.md) | Testing Strategy | Complete |
| [26](dev/26-build-and-release.md) | Build and Release | Stub |

---

## Decision Log

All architectural decisions with date and rationale, ordered chronologically. To amend a decision, add an amendment block beneath it — never edit the original entry.

---

### D-01 — Tech Stack (2026-04-26)

**Decision:** Keep Tauri v2 + Rust + SQLCipher + React 19 + TypeScript + Zustand. Upgrade Tailwind CSS v3 → v4.

**Rationale:** No alternative stack provides the same combination of local-first security (in-process key management, zero JS memory exposure for master key and API key), performance, and cross-platform desktop capability. Tailwind v4's native CSS variable integration aligns directly with LOOM's design token system and eliminates the `tailwind.config.js` overhead.

**Affects:** Doc 04 (System Overview)

---

### D-02 — AI Provider Strategy (2026-04-26)

**Decision:** Gemini API for text generation. Image and MP3 generation use a `GenerationProvider` trait (provider-agnostic abstraction in Rust); specific providers are TBD.

**Rationale:** Text generation on Gemini is proven and stable. Media generation providers are still in flux. A trait abstraction allows providers to be added or swapped without architectural change — the rest of the backend talks only to the trait, never to a concrete API.

**Affects:** Doc 05 (Backend Modules), Doc 19 (Media), Doc 15 (Conversation Engine)

---

### D-03 — Frontend State Management (2026-04-26)

**Decision:** Option C — six domain stores with a per-mode store slice.

**Store map:**
| Store | Owns |
|---|---|
| `appStore` | App phase, viewport, toast queue, open modals |
| `authStore` | Lock state, sentinel setup |
| `vaultStore` | Worlds, vault tree, selection, trash |
| `workspaceStore` | Active story/doc, message list, `isGenerating`, current leaf ID |
| `settingsStore` | App-level, world-level, and story-level settings |
| `modeStore` | Active mode (`story` \| `handover` \| `consulting`), mode-specific state |

**Rationale:** The Modes concept (D-05) requires isolated state per mode that does not pollute core workspace state. Six stores with explicit, non-overlapping domains prevents the v1.0 problem of stores accumulating unrelated concerns over time. Cross-store reads are always explicit.

**Affects:** Doc 06 (Frontend Architecture), Doc 23 (Modes)

---

### D-04 — Backend Module Structure (2026-04-26)

**Decision:** Option A — flat command modules with a targeted `services/` layer for complex logic only.

**Module structure:**
```
src-tauri/src/
├── commands/           ← thin; one file per domain; no business logic
│   ├── auth.rs
│   ├── vault.rs
│   ├── conversation.rs
│   ├── settings.rs
│   ├── cache.rs
│   └── modes.rs
├── services/           ← business logic that is not trivial CRUD
│   ├── history.rs      ← history assembly + Accordion substitution
│   ├── gemini.rs       ← request assembly + streaming client
│   ├── rate_limiter.rs
│   └── generation.rs   ← GenerationProvider trait + implementations
├── db/                 ← schema + typed DB access functions
│   ├── schema.rs
│   ├── messages.rs
│   ├── vault.rs
│   └── settings.rs
├── security/
│   ├── crypto.rs
│   └── sentinel.rs
├── state.rs
├── error.rs
└── lib.rs              ← registers commands from commands/; nothing else
```

**Rationale:** Eliminates the v1.0 `lib.rs` monolith (3,379 lines, 87 commands). Commands are thin and domain-scoped. Complex logic (history assembly, Gemini request building, rate limiting, provider abstraction) lives in `services/`. Simple CRUD commands talk directly to `db/` — no unnecessary abstraction layer. `lib.rs` becomes a pure registration file.

**Affects:** Doc 04 (System Overview), Doc 05 (Backend Modules)

---

### D-05 — Feature Scope for v2.0 (2026-04-26)

**Decision:** v2.0 includes all v1.0 shipped features **except branching**. Adds Context Caching and a Modes system (story, handover, consulting).

**Branching removed:**
- Usage data shows the feature is underutilized
- Removal collapses the message DAG to a linear list, eliminating the Recursive CTE, sibling navigation, Branch Map, and fork-spanning Accordion complexity
- Edit + regenerate becomes truncate-and-replace: delete all messages after the edit point, regenerate from there

**Modes (new concept):**
| Mode | AI persona | Context | Conversation type |
|---|---|---|---|
| `story` | Author — outputs only story content, never breaks character | Full story context | Main story thread |
| `handover` | Analyst — structured report about the story | Full story, read-only | Structured output |
| `consulting` | Editor/consultant — meta discussion about the story | Full story, read-only | Parallel conversation |

**Note:** Consulting mode has open design questions — see [TODO.md](TODO.md).

**Affects:** Doc 03 (Data Model), Doc 15 (Conversation Engine), Doc 23 (Modes)

---

### D-06 — Design System (2026-04-26)

**Decision:** Tailwind v4 + shadcn/ui. CSS variables are the single source of all design values.

**Enforcement rule:** Components reference design tokens only (e.g. `var(--color-text-muted)`, `text-[--color-accent]`). No hex values, no hardcoded pixel sizes, no raw Tailwind color classes (e.g. `text-gray-400`) in component files. Shadcn/ui is used for behavior only (focus management, ARIA, keyboard navigation) — all visual defaults are overridden via the token system. Any value not defined in Doc 08 (Design Tokens) does not exist as a design value.

**Affects:** Doc 08 (Design Tokens), Doc 09 (Component Library)

---

#### Amendment — D-03-A (2026-04-26)

**What changed:** Settings architecture overhauled. API key and all app-level settings move to a dedicated `app_settings.db` (SQLCipher, master key). World `settings` table becomes overrides-only. `story_settings` renamed `story_state` and narrowed to operational state only (`context_doc_ids`, `active_mode`). System instructions split into mode system instructions (true Gemini `system_instruction` field, world-overridable) and auxiliary slots (injected into conversation history, no cache impact). A cascade resolver (`services/settings.rs`) merges world → app → hardcoded fallback before returning to frontend.

**Affects:** Doc 02 (API key lifecycle), Doc 03 (data model), Doc 05 (AppState, module structure)

#### Amendment — D-03-B (2026-04-27)

**What changed:** Seventh Zustand store added: `cacheStore`. Owns per-story `CacheStatus` map, TTL countdown ticker, and the `cache_state_changed` event handler. The "six stores" guideline in the original D-03 was a guard against unrelated concerns piling into one store, not a hard cap. Cache state has a distinct lifecycle (server-managed expiry, fire-and-forget TTL refresh, stale-by-side-effect) that does not belong in `workspaceStore`.

**Affects:** Doc 06 (Frontend Architecture), Doc 22 (Context Caching)

---

### D-07 — World Switch Key Handling (2026-04-27)

**Decision:** The master key persists in `AppState.master_key` across world switches. World switching closes the current `active_conn` and opens the new world's `loom.db` using the existing master key. No re-derivation, no password held in JS memory, no re-prompt. The master key is zeroed only on lock or app close.

**Rationale:** All worlds in a vault share a single PBKDF2 salt (`app_config.json`) and therefore a single master key. Re-deriving on every switch would be wasted PBKDF2 work; holding the password in JS memory would violate Doc 02 Red Line 1; re-prompting per switch would punish the user for organising their work into multiple worlds. Persisting the key in `AppState` for the unlocked-session lifetime is the cleanest model and matches what was already implicit in the architecture.

**Affects:** Doc 02 (key lifecycle), Doc 04 (world switch sequence), TODO.md (verify-on-Doc-13 entry resolved)

---

### D-08 — Conversation Engine v2.0 (2026-04-28)

**Decision:** The v2.0 conversation engine is fully specified in Doc 15. Umbrella decision covering the multiple sub-decisions made in the design session:

| Sub-decision | Locked value |
|---|---|
| Topology | Linear messages — no DAG, no branching (per D-05) |
| User input fields | Four: `plot_direction` (required), `background_information`, `modificators[]`, `constraints` |
| Output-length feature | Removed — length cues live in Constraints or aux slots |
| Image attachments per turn | Removed (`attached_image_ids` dropped from `UserContent`) |
| Aux slot scope | Per-story (`story_state.active_aux_slot`), not per-world |
| Aux slot placement | Prepended to current user turn with explicit `[AUX — ALWAYS APPLY]` delimiter; not stored in messages; not in cached prefix |
| Edit user message | Truncate-and-replace + regenerate, one atomic op, hard-delete with cascade |
| Edit model message | In-place via `update_message_content`, no truncation |
| Regenerate last response | Hard-delete last model message + re-fire generation |
| Bubble lifecycle | User bubble optimistic; AI bubble lazy (only on first chunk); see Doc 15 §Cancellation Taxonomy for retraction rules |
| Cancellation paths | Eleven distinct paths; `generation_cancelled` (silent) vs. `generation_failed` (toast) |
| Generation parameters | `gen_temperature` / `gen_top_p` / `gen_top_k` / `gen_max_output_tokens` in Settings → Gemini, world-overridable, defaults ⚠️ provisional |
| Drafts | Per-story persisted in `story_state.draft`; debounced ~1 s; survives lock + close |
| Streaming | No buffering — one Tauri event per Gemini SSE chunk |
| Token meter | `get_token_count` debounced 500 ms; placement deferred to UI design phase |
| Status section | New `<ControlPaneSection>` at the bottom of the right pane; states `Idle / Preparing / Thinking / Streaming / Complete / Stopped`; collapsible |
| Theater scrolling | Auto-follow with user-controlled pause; floating "↓ New content" button on pause; freeze on edit; scroll-to-bottom on story open |
| Cascading deletion | Hard-delete of a message also removes anchored checkpoints and any segments whose range or boundaries are affected |

**Rationale:** Each sub-decision was made deliberately during the design session. Several explicitly trade simplicity for capability (linear over DAG; cascading hard-delete over reversible soft-delete in v2.0; aux outside the cache for adherence over cache-stability). The resulting engine is materially smaller than v1.0's while gaining writer-facing affordances (Status section, drafts, friendly cancellation taxonomy).

**Affects:** Doc 03 (data model amendments — `output_length` removed, `active_aux_slot` moved to `story_state`, `draft` key, gen params); Doc 07 (full conversation command list, new `generation_failed` event); Doc 11 (deletion confirmation copy, scroll rules — addendum pending); Doc 10 (Status section placement — addendum pending); Doc 15 (full spec); Doc 20 (Settings → Gemini tab — addendum pending); Doc 22 (cache prefix excludes aux); Doc 23 (handover messages excluded from history; consulting parallel conversation referenced).

---

### D-09 — Undo / Redo Deferred to v2.1 (2026-04-28)

**Decision:** Story-level undo / redo (operation log over deletes, generations, edits, regenerations, and accordion ops) is **not in v2.0**. v2.0 ships with immediate hard-delete (with cascade) and a confirmation modal. The full design is captured in `docs-v2/future/undo-redo.md` as a v2.1 starting point.

**Rationale:** Persistent undo/redo across generation boundaries requires (a) `undo_log` table, (b) `deleted_at` columns on `checkpoints` and `accordion_segments`, (c) cascading soft-delete with cascade-set capture in operation payloads, (d) auto-purge with a 7-day horizon, (e) UI affordances (Undo / Redo buttons, keyboard scoping for Cmd-Z to skip text-editor scope). The integrity surface — thirteen invariants — is large enough to merit its own implementation phase. v2.0 prioritises shipping the rest of the engine; v2.1 adds reversibility on top of a forward-compatible schema.

**Schema bridge:** `messages.deleted_at` already exists in v2.0 and is left `NULL` (reserved). v2.1 adds the `undo_log` table and `deleted_at` columns on `checkpoints` and `accordion_segments`. No data migration needed.

**Affects:** Doc 03 (`messages.deleted_at` reserved-comment); Doc 15 (Deletion section, Out-of-Scope reference); `docs-v2/future/undo-redo.md` (full v2.1 design).

---

### D-10 — Modes Umbrella (2026-04-29)

**Decision:** The Modes system is fully specified in Doc 23. Umbrella decision covering the multiple sub-decisions from the design session:

| Sub-decision | Locked value |
|---|---|
| Switcher placement | Top bar of the Theater pane; three tabs `Story · Handover · Consulting`; active session name surfaces on the active tab |
| Switcher behaviour | Clicking handover/consulting tab **always creates a new session** at the current story tail. Re-entry is exclusively via banner click. |
| Theater scroll surface | Single shared scroll across all modes; mode switch never re-positions scroll |
| Mode switch during streaming | Allowed; send blocked while `isGenerating`; cancel available from any mode |
| Story mode | Behaviourally identical to v1.0 conversation engine (Doc 15); 4-field input; story cache |
| Handover mode | Multi-turn within a session; one input field; uncached; no aux slots; manual copy-paste seed-doc workflow in v2.0 (auto-promotion deferred) |
| Consulting mode | Multi-turn within a session; one input field; per-session cache; no drafts; no aux slots; not actionable |
| Storage unification | Handover and consulting unified onto `conversation_sessions`; `messages.kind` enum expanded to `'story' \| 'handover' \| 'consulting'`; placeholder `mode_conversations` table dropped |
| Banner pattern | Shared across handover, consulting, and accordion (Doc 16): collapse / expand chevron, click-to-toggle, Enter button on session banners, right-click context menu |
| Sessions per story | Multiple per kind; each self-contained; default name `"<Kind> N"`; renameable |
| Session re-entry | Banner click → expand → "Enter" button (or right-click → "Enter…"); consulting re-entry rebuilds cache from `entry_snapshot`; post-entry story messages are greyed |
| Visual treatment | Owned by Doc 27 (Theater Composition) — newly created |

**Rationale:** Each sub-decision was made deliberately during the design session. The modes system is additive: adding a fourth mode in the future requires only a new `kind` enum value and persona SI; no structural changes to existing modes. Unifying handover and consulting onto one session table eliminates two parallel surfaces (one was a placeholder; both have identical metadata needs).

**Affects:** Doc 03 (data model — `messages.kind` enum, `messages.session_id`, `conversation_sessions` table, `cache_state` schema, removal of `mode_conversations` placeholder); Doc 06 (`modeStore` expansion, `cacheStore` per-session map); Doc 07 (full `commands/modes.rs` command list, session events, cache events); Doc 10 (mode switcher position, scroll-persists-on-switch); Doc 15 (cached-message protection cross-references, session-message edit/regenerate scoping); Doc 21 (handover and consulting in export); Doc 22 (consulting cache via `entry_snapshot`); Doc 27 (new — Theater Composition spec).

---

### D-11 — Caching Architecture (2026-04-29)

**Decision:** Context caching is fully specified in Doc 22. Umbrella decision covering the cache architecture:

| Sub-decision | Locked value |
|---|---|
| Cache prefix | SI + ordered source docs + all story-kind messages up to a moving high-water mark (`cache_state.last_cached_message_id`) |
| Two cache kinds | Story cache (one per story) and consulting-session cache (one per active consulting session); coexist; never share |
| Handover | Uncached |
| TTL default | 3600 s (`app_settings.cache_ttl_secs`); world-overridable; refreshed fire-and-forget on every successful send to that cache |
| Auto-rebuild on expiry | Story sends transparently rebuild expired/deleted/stale story caches as part of the send; one extra round-trip on rebuild |
| Cached-message edit/delete protection | Confirmation modal before any edit or delete that touches a cached message; dismissal proceeds and marks cache stale; rebuild happens on next send |
| Consulting session cache | Created on session start or re-entry; dropped on exit (best-effort `DELETE` to Gemini, fields nulled); rebuilt from `entry_snapshot` on re-entry |
| Story cache during consulting | Left alive but not refreshed; may expire transparently; rebuilt on first story send after consulting exit |
| Manual recreate | Right-click Send → "Update cache" / "Create cache"; same prefix as auto-create |
| Cache + context limit | Token meter sums cache size + uncached additions when comparing against `context_token_limit` |
| Stale triggers | Comprehensive list per mode-affected scope in Doc 22 §Stale Triggers |
| Snapshot integrity | Consulting `entry_snapshot` is write-once at session creation; captures SI, story_message_ids, accordion state with verbatim summaries, attached doc hashes, and a `prefix_hash` rollup; re-entry surfaces a non-blocking divergence warning when the recomputed prefix differs |

**Rationale:** Earlier drafts framed the cache as SI + docs only; the v2.0 expansion (history baked into the cache) is where most of the savings are. Per-session consulting caches dissolve the original O1 "SI mismatch on transition" question — story and consulting caches are simply distinct entities. The cached-message protection rule keeps writers aware that an edit is invalidating real cost savings; dismissal-marks-stale is the lightest possible enforcement that still tells the writer.

**Affects:** Doc 03 (`cache_state` PK and field changes; `conversation_sessions` cache fields); Doc 06 (`cacheStore.bySession` map); Doc 07 (cache command list, cache events); Doc 15 (deletion / edit protection cross-references); Doc 22 (full spec); Doc 23 (consulting session cache lifecycle and snapshot semantics).

---

### D-12 — Accordion Umbrella (2026-04-29)

**Decision:** Context Compression (Accordion) is fully specified in Doc 16. Umbrella decision covering the accordion architecture:

| Sub-decision | Locked value |
|---|---|
| Topology | Linear segments; no fork-spanning (branching removed in v2.0). Each closed segment owns `(start_cp_id, end_cp_id)`. Open tail (after the most-recent checkpoint) has no segment row |
| Decoupled state | `accordion_segments.is_collapsed` (UI-only — banner shows summary card vs. bubbles) and `accordion_segments.use_summary` (API substitution flag — fake-pair vs. raw history). Forced ON when `is_collapsed = 1` |
| Banner = checkpoint | One banner per checkpoint, rendered at the checkpoint's position. Banner represents the chapter that **starts** at this checkpoint — inverted from v1 ("name what comes next") |
| Start sentinel | Auto-created on story creation. `is_start = 1`, `after_message_id = NULL`. Default name `Chapter 1`. Renameable, never deletable, never targets `Summarise previous chapter` |
| Button-slot state machine | Per-banner: `Generate summary` → animated loader (clickable to cancel) → `Use summary` toggle (default ON). Greyed with tooltip `"Generation already in progress"` while another generation is in flight |
| Summarisation | Non-streaming Gemini call with its own gen params (`gen_summarise_temperature` / `_top_p` / `_top_k` / `_max_output_tokens`); world-overridable. Two-step: summarise sets `summary` but does **not** auto-collapse |
| `isGenerating` scope | Single global flag covering story turns, session turns, and accordion summarise. One model call in flight at a time |
| Manual summary edit | Allowed; bumps `modified_at`; clears `is_stale`; marks cached prefix stale if collapsed-and-cached |
| Empty segments | Disallowed at checkpoint creation time (case (c) from design pass). Right-click `Summarise previous chapter` is the discoverability shortcut for the open-segment case |
| Stale-on-Ghostwriter | Silent — banner badge is the only signal; no toast |
| Cascade rules | User `Delete checkpoint` merges adjacent segments (graceful; `summary = NULL` on merged segment). Hard-delete-of-message cascade drops affected segments outright (Doc 15 / Doc 03) |
| Fake-pair caching | Confirmed — collapsed segments substitute as fake-pairs in the cached prefix exactly as in v1.0. Closes TODO O3 |
| Token-impact display | Status section shows aggregate `~N tok saved by Accordion`; per-banner header shows per-segment label per Doc 27 |

**Rationale:** Decoupling `is_collapsed` and `use_summary` resolves a v1 confusion the writer kept hitting: "I want to read this chapter without giving up the token saving." Inverting the naming aligns with how writers actually think about chapter titles. Making every checkpoint a banner unifies the visual language with handover/consulting partitions (Doc 27) and removes the v1 distinction between "checkpoint divider" and "accordion card." Separate summarisation gen params are a forward-looking power-user knob; the provisional defaults (lower temperature) match the fact-extraction shape of summarise calls.

**Affects:** Doc 03 (`accordion_segments.use_summary` column; four `gen_summarise_*` keys with world-overridable cascade); Doc 06 (`workspaceStore` extended with `segments`, `checkpoints`, `summarisingSegmentId`, accordion actions); Doc 07 (`accordion` command domain populated, accordion events); Doc 15 (`isGenerating` documented as covering summarise); Doc 16 (full spec); Doc 22 (accordion-specific stale triggers); Doc 27 (accordion banner detail — button slot, naming, right-click menu, stale badge, token-impact label).

---

### D-13 — Source Documents Umbrella (2026-04-29)

**Decision:** Source Documents is fully specified in Doc 18. Umbrella decision covering the source-doc architecture:

| Sub-decision | Locked value |
|---|---|
| Editor model | `<textarea>` + `[Preview]` Markdown toggle (mutually exclusive). No split view, no WYSIWYG |
| Save model | Debounced auto-save at ~1 s; **no** `[Save]` button, **no** on-blur trigger, **no** unsaved-changes guard modal. Pending saves flush on close / lock / world switch |
| Placeholder navigation | `Tab` / `Shift+Tab` cycle through `{{...}}` tokens when present; `Tab` inserts two literal spaces when none remain |
| Image source documents | Lightbox view + caption field (caption stored in `items.content`). File API mechanics owned by Doc 19 |
| DocEditor placement | Takes the full main + right-pane region; Navigator stays visible. Mode switcher and right pane are **hidden**. `← Back` restores the previous mode (Q6 option 2) |
| Mode-switch while editing | Not possible — must `← Back` first. Reinforces editor-as-focused-state |
| Inclusion across modes | Source docs are sent in **all three modes** — story (cached), handover (uncached, inline), consulting (cached per session, captured in `entry_snapshot`) |
| Header format | `=== SOURCE DOCUMENT: <subtype> — <name> ===` — `Blank` for items with `item_subtype = NULL` |
| Order in request | Insertion order from `story_state.context_doc_ids` (Doc 22 O12). Importance-ordering deferred |
| Attach surface | Vault hover-paperclip + right-click → Attach. The Right Pane has **no** attach affordance |
| Detach surface | Right Pane Context Documents `×` icon. Vault has no detach affordance |
| Maximum attachments | No limit — token meter is the cost signal |
| Soft-delete cascade | Auto-detaches the doc from every story; cache stale per affected story; emits `vault_updated` + `cache_state_changed` |
| Restore from Trash | Does **not** auto-reattach — writer must reattach via the paperclip |
| Hard-delete | `attachment_history` cleaned via `ON DELETE CASCADE`. Best-effort `DELETE` to Gemini File API for Image items is out of scope for v2.0 |
| Rename / content edit | Marks every story-cache containing this doc stale (name and content are part of the cached prefix) |
| Source Document Creator | **Cut from v2.0**, deferred to v2.1. Schema field `templates.creator_instructions` retained. Design preserved in `docs-v2/future/source-document-creator.md` (Option B — per-doc session inside the DocEditor — recommended) |
| Templates management | User-editable via Settings → Templates (Doc 20). Built-ins: `image`, `character_profile`, `world_building`. Renameable; `default_content` editable; built-ins have Restore Default; built-ins not deletable |

**Rationale:** The split-attachment surface (vault attaches, right pane detaches) matches the moment-of-decision in each direction — discovery happens in the vault, pruning happens in the right pane. Debounced auto-save eliminates the cognitive overhead of "is this saved" — aligning with the Doc 15 draft model. Hiding the mode switcher when the editor is open establishes editor-editing and mode-driving as distinct activities, which both removes a class of mode-while-editing edge cases and makes the editor surface feel intentional. Including source docs in handover and consulting (not just story) means the writer's reference library is universal — no per-mode attachment lists to manage. Soft-delete-cascade is the kindest behaviour: the writer almost never *wants* a doc that's in Trash to keep going to the model, and the explicit re-attach on restore avoids the surprise of "where did this come back from".

**Affects:** Doc 06 (`workspaceStore` extended with `activeDocId`, doc-edit actions, attach/detach wrappers); Doc 07 (vault commands `update_item_content`, `attach_context_doc`, `detach_context_doc`, `list_attached_docs`, `list_templates` flipped to specified); Doc 14 (vault row paperclip affordance); Doc 18 (full spec); Doc 22 (source-doc rename + soft-delete-cascade stale triggers); Doc 23 (Right Pane Context Documents row wording).

---

### D-14 — Ghostwriter Umbrella (2026-04-29)

**Decision:** Ghostwriter is fully specified in Doc 17. Umbrella decision covering the targeted-revision architecture:

| Sub-decision | Locked value |
|---|---|
| Activation | **Mode-first.** Action-row `✦ Ghostwriter` button or right-click → Ghostwriter enters mode on the bubble. Selection inside the bubble drives the target only after mode is entered. Doc 11's previous selection-first wording was a contradiction; corrected. |
| Mode availability | Story, handover, **and** consulting AI bubbles. User bubbles excluded. `content_type = 'blocks'` excluded — deferred to v2.1. |
| One-bubble-at-a-time | Entering on a second bubble shows discard modal only if the first is in `reviewing`; otherwise silent exit. |
| Request protocol | **Surgical stitching.** Model receives `<context_before>` / `<selected_passage>` / `<context_after>` + instruction; returns ONLY the revised passage; frontend stitches at recorded character offsets. Original surroundings are guaranteed verbatim because the model never rewrote them. Adopted from `project_ghostwriter_fix.md` memory note (v1 had a bug where the model paraphrased surroundings). |
| History | Mode-aware. Story = full story-kind history up to and including the edited message. Handover/consulting = session-SI + docs + story-history-to-`entry_message_id` + session messages up to the edited one. Source docs included per Doc 18. |
| Streaming | **Non-streaming.** Response returned in one chunk via `Result`. Cancellation aborts the request handle; silent (no event). |
| Rate limit | Shares `'text'` window with story / session sends. |
| `isGenerating` global lock | Ghostwriter calls participate per Doc 15 / D-12 — one model call in flight at a time across the whole app. |
| Non-latest message handling | **In-place edit only.** Subsequent messages (`N+1`, `N+2`, …) are not touched. Ghostwriter is wordsmithing, not replot — truncate-and-replace is what `edit_user_message` is for. |
| Diff | Word-level LCS, computed client-side. Inline highlighted-new visual (no side-by-side). |
| Revert | Per-message stack via `messages.ghostwriter_history` JSON. `[Revert]` action-row button pops one entry per click. Cached-message protection and accordion-stale rule apply to revert. |
| Cached-message protection (Doc 22) | Confirmation modal on accept and revert when the message is in the cached prefix; dismissal proceeds and marks cache stale. |
| Accordion-stale rule (Doc 16) | Silent — segment marked stale, banner badge surfaces. No toast. |
| Floating panel | In the Theater's **right gutter** (between bubble and right pane). Vertically clamped to the bubble's extent; follows viewport within that range. ~300 px width ⚠️ provisional. Does not overlay the right pane. |
| Plain-text rendering | Bubble content swaps from Markdown to plain text while in mode (so character offsets map to `messages.content` directly). Reverts to Markdown on exit. |
| Selection minimum | At least 1 word (≥ 1 non-whitespace character bounded by whitespace or boundaries). |
| Frontend state | Lives on `workspaceStore.ghostwriter` (8th store rejected — same pattern as accordion in D-12). |

**Rationale:** Surgical stitching makes Ghostwriter's correctness structural rather than aspirational — the unselected portion of the message is preserved by *not being sent for rewriting*, removing an entire class of model-paraphrase failure modes that bedevilled v1. Mode-first keeps text selection in bubbles available for normal browser actions outside the mode and lets us flip to plain-text rendering at a deterministic moment. The floating-panel placement keeps the panel visible during long bubble scrolls without competing with the Theater scroll surface or overlaying the right pane. All-modes availability is essentially free — only history assembly differs by mode — and removes an arbitrary restriction. In-place-only on non-latest messages encodes the intent: Ghostwriter is for polishing prose, not for replotting; writers who need the truncate-and-replace path use `edit_user_message`. Deferring `blocks` to v2.1 ships untestable code now; PATCH-16 from v1 will be folded in alongside Doc 19's image-gen work.

**Affects:** Doc 06 (`workspaceStore.ghostwriter` field + 9 lifecycle actions); Doc 07 (`ghostwriter` command domain populated — 4 commands); Doc 11 (selection-first wording corrected to mode-first); Doc 17 (full spec); Doc 27 (floating-panel placement + plain-text rendering note on AI bubble).

---

### D-15 — Media Umbrella (Slim, v2.0 Scope) (2026-04-29)

**Decision:** Doc 19 ships in v2.0 with a deliberately narrow scope: **images as vault Source Documents only**. Image generation, TTS, per-turn user-message images, and AI-generated-image messages are all deferred to v2.1.

| Sub-decision | Locked value |
|---|---|
| v2.0 scope | Image upload (file picker + drag-and-drop), asset storage in `worlds/<world_id>/assets/<item_id>.<ext>`, magic-byte MIME validation, 10 MB max, Navigator hover thumbnails, `get_or_upload_file_api_uri` helper. Caption editing and lightbox display are owned by Doc 18 |
| Supported formats | PNG, JPEG, WebP, GIF (static; animated GIFs supported but Gemini reads first frame only) |
| File API URI cache | 47-hour TTL refreshed inside `get_or_upload_file_api_uri`. Closes TODO O6 |
| Best-effort delete to Gemini on hard-delete | **Not done.** Gemini auto-expires at 48 h; orphaned URIs are harmless |
| Per-image rate-limit tracking | None in v2.0. `telemetry.image_gen` and `telemetry.tts` rows reserved for v2.1 |
| World backup (`.loom-backup` zip) | Lives in Doc 14 §World Backup. Bundles `loom.db` + `assets/` into a zip. Encrypted DB stays encrypted; assets are not individually encrypted (filesystem permissions only). Imports get a new `world_id` to avoid collision |
| Per-turn user-message images | **Cut.** Removed from `UserContent` in Doc 15. The only path from a user to an image-in-context is via attaching an Image source document |
| AI-generated images in model messages (`content_type = 'blocks'`) | **Deferred to v2.1.** Schema enum value exists but no v2.0 path produces it |
| Image generation provider | **Deferred to v2.1.** Q1 in TODO unblocks v2.1 design |
| TTS / audio | **Deferred to v2.1.** Q2 in TODO unblocks v2.1 design |
| Ghostwriter on blocks messages | **Deferred to v2.1** alongside image generation. PATCH-16 design preserved |
| Story narrative export (PDF / HTML / Markdown) | **Deferred to v2.1.** Doc 21 deferred wholesale. World backup is structurally different and ships in v2.0 |

**Rationale:** v2.0's job is to ship a focused, complete writing tool — not to be feature-comprehensive. Image generation and TTS each need a provider decision before any meaningful design (Q1 / Q2 in TODO), and the v1.0 design predates the modes / cache / `isGenerating` architecture; touching it in v2.0 would mean redesigning two things simultaneously. The slim scope still gives the writer everything they need to use images as reference material — upload, attach, send, view — which is the v1.0 use case writers actually exercised. The narrative export deferral is symmetric: Doc 21 needs Doc 17's ghostwriter-history, Doc 19's full image pipeline, and Doc 23's handover/consulting transcripts to all be settled before "what does an export contain" has a stable answer. World backup as a `.loom-backup` zip ships separately because resilience is plumbing, not a deliverable for a reader.

**Affects:** Doc 07 (vault commands `upload_image`, `export_world`, `import_world` flipped to specified); Doc 14 (new World Backup section); Doc 18 (cross-reference to `get_or_upload_file_api_uri` corrected); Doc 19 (full slim spec); `docs-v2/future/media-generation.md` (new — captures v2.1 carry-forward for image gen, TTS, blocks).

---

### D-16 — Settings & Themes Umbrella (2026-05-03)

**Decision:** Settings and Themes is fully specified in Doc 20. Umbrella decision covering the settings architecture and theme system:

| Sub-decision | Locked value |
|---|---|
| Surface | Full workspace surface (replaces v1.0 modal). Hides mode switcher and right pane; `← Back` restores the previous mode. Pattern matches DocEditor (D-13). Mode switching not possible while open — `← Back` first |
| Scopes | **Two only:** App and World. Story scope removed — `story_state` (operational) is set by feature surfaces, not Settings. The cascade is `World → App → hardcoded fallback`, resolved server-side in `services/settings.rs` |
| Chapter switcher | Top-bar segmented control: `App ▾` / `World ▾`. Switching swaps the tab list |
| App tabs (8) | General · Appearance · Gemini · System Instructions · Templates · Features · Rate Limits · Developer |
| World tabs (5) | Appearance · Gemini · System Instructions · Templates · Features. (App-only tabs and the API key field are not present at world scope) |
| Cascade UX | Editing a value at World scope **auto-creates an override** (no explicit "Override" toggle). `↺` icon next to overridden fields clears the override. Per-tab "Reset all overrides" button at top of each World tab. Hardcoded fallback never surfaced in UI |
| Validation | Two-layer: frontend (instant inline error, **auto-save suppressed** until valid) + backend (server-side revalidation, returns `LoomError::InvalidSettingValue`). Single schema source in `services/settings.rs`, mirrored to frontend via IPC contract |
| Save semantics | Debounced auto-save ~1 s after last edit (consistent with DocEditor per D-13). No Save button. Pending writes flush on `← Back` / lock / world switch / app close |
| Search | Text search over setting names only (not body content of SIs / templates / prompts). Scope-scoped to current chapter. `⚑` filter chip restricts to overridden keys (World chapter only) |
| Theme | **Dark-only in v2.0** (light mode deferred to v2.1). Accent has an App default and a per-World override; both live in the Appearance tab |
| `applyTheme()` | Single function `applyTheme(snapshot)` writes derived CSS variables to `:root`. One subscription at App root; triggers on phase becomes `workspace`, world open, world switch, and `settingsStore` accent / feature-colour change |
| Feature colours | Ghostwriter and Accordion live in the **Features tab** at both scopes. Track accent by default; independently overridable per scope |
| Modificators | **No Settings home.** Modificators are free-text per-turn tags (Doc 15 §Modificators) with comma-as-delimiter input behaviour and no persistence beyond the in-flight draft and sent message history. v1.0's `modificator_presets` keys removed from `app_settings` and `settings` |
| Templates editor | Inline within the Templates tab (no separate surface). `<textarea>` + Markdown preview toggle, consistent with DocEditor. Built-ins: `image`, `character_profile`, `world_building` — renameable, `default_content` editable, Restore Default, not deletable. World templates are additive, not replacements. `templates.creator_instructions` retained in schema but hidden in v2.0 (forward-compat for v2.1 Source Document Creator) |
| Internal prompts (Developer tab) | Inventory: `prompt_ghostwriter`, `prompt_accordion_summarise`, `prompt_accordion_fake_user`, `prompt_handover_seed`, `prompt_consulting_seed`. Each with Restore Default. Hardcoded baselines in `services/` constants; `app_settings` is the override store |
| Rate Limits tab | Configurable ceilings (writer can set lower than Gemini's published limit, never higher); live counter view at 1 Hz; Reset counters button with confirmation modal |
| Settings export | Bundled into `.loom-backup` zip per D-15. Blocks while `isGenerating` |
| Persistence partition | `app_settings.db` (SQLCipher): API key, app-level settings, internal prompts. World `loom.db` `settings` table: overrides only. `story_state`: operational only. `app_config.json` (unencrypted): salt, sentinel, last-opened-world hint, `onboarding_complete`. `localStorage`: UI ephemera only |

**Rationale:** v1.0 settings sprawled across a modal, a `world_meta.json` file, and `localStorage`. v2.0 collapses this onto two clean scopes (App / World) with a single cascade, a single resolver (`services/settings.rs`), and a single source of truth for validation. The two-scope model is correct because the v1.0 "story scope" was always operational state misnamed as settings — narrowing `story_state` (D-03-A) made the absence visible. Auto-create override on edit is the friction-minimising default — writers expect editing a value to take effect; an explicit override toggle would punish the common case to communicate intent the `↺` already conveys. Inline templates editor matches DocEditor's pattern instead of inventing a third editor surface. Modificators losing their settings home reflects how writers actually used them in v1 (ad-hoc per turn, never curated).

**Affects:** Doc 03 (`modificator_presets` removed from both tables; `cache_min_tokens` added to `app_settings`; `cache_ttl_secs` / `cache_min_tokens` / `context_token_limit` added to world-overridable list); Doc 06 (`settingsStore` extended with `appRaw` / `worldRaw`, `clearAllWorldOverridesInTab`, `validate`, `handleSettingsChanged`, `restoreTemplateDefault`; `restorePromptDefault` enum widened); Doc 07 (`commands/settings.rs` populated — 15 commands, 2 events; `get_story_settings` / `save_story_setting` dropped); Doc 15 (Modificators subsection rewritten with comma-as-delimiter input and no-persistence note; Constraints contrast updated); Doc 20 (full spec).

---

### D-17 — Feedback Umbrella (2026-05-04)

**Decision:** Feedback is fully specified in Doc 28. Umbrella decision covering the v2.0 feedback affordance:

| Sub-decision | Locked value |
|---|---|
| Surface | **Per-bubble inline strip is the sole affordance.** v1.0's right-pane Feedback Overlay (Doc 10 §6) is dropped. The strip lives below the bubble (above the action row); the action-row "Feedback" entry toggles edit mode. Reversible if post-prototype usage shows writers needing the cross-branch view |
| Display when non-empty | Always-visible compact single-line preview, truncated with ellipsis. 2px `--color-feedback` left border, `--color-feedback-subtle` background. Click anywhere on the strip → edit mode |
| Display when empty | No strip rendered. The action-row entry is the only way in; opens directly into edit mode with empty textarea |
| Edit mode | Inline textarea (auto-grow up to ~6 lines then scroll), explicit `[Cancel]` and `[Apply]` buttons right-aligned. Hint line: *"Injected into AI context for future messages."* ⚠️ provisional |
| Save semantics | **Explicit Apply only.** No auto-save on blur. `Ctrl+Enter` / `Cmd+Enter` while focused = Apply. `Esc` = Cancel. No "discard changes?" confirmation modal |
| Cancel semantics | Discard in-progress textarea value; restore strip to last-saved state (or remove strip if previously empty). Implicit cancel when opening another bubble's edit, on bubble deletion, on world switch / lock |
| One-at-a-time | Only one feedback strip can be in edit mode across the Theater at a time. Tracked via `workspaceStore.feedbackEditingMessageId: string | null` so the Escape chain can read it |
| Mode-gating | Feedback affordance is hidden on handover (`kind = 'handover'`) and consulting (`kind = 'consulting'`) AI bubbles, on user bubbles (any mode), and on `content_type = 'blocks'` AI bubbles (deferred to v2.1) |
| Ghostwriter co-existence | Strip and action-row entry are hidden while Ghostwriter is active on the bubble (any of `selecting` / `generating` / `reviewing`). Feedback value is preserved across the cycle and re-appears on exit |
| Cached-message protection | Feedback edit on a message at or before `cache_state.last_cached_message_id` routes through the existing Doc 22 cached-message confirmation modal. On confirm: write proceeds, cache marked stale. On dismiss: strip stays in edit mode, value preserved |
| Accordion stale | Feedback edit on a message inside a closed accordion segment marks the segment stale (Doc 16 §Stale Triggers — same trigger set as `update_message_content`) |
| Token | New triad `--color-feedback`, `--color-feedback-hover`, `--color-feedback-subtle`. Default `#f59e0b` (matches `--color-warning` hex but independent token). World-overridable via `feedback_color`. Default does **not** track accent — feedback uses a stable amber so writers can theme it independently |
| Schema | No new column (`messages.user_feedback` already exists from v1.0). One new world-overridable settings key `feedback_color` |
| Backend | `update_feedback(message_id, feedback)` already specified (Doc 07). Server-side preconditions: rejects with `Validation` if message is not story-kind. No new event — frontend updates local state optimistically |
| Frontend state | One field on `workspaceStore` (`feedbackEditingMessageId`) + three actions (`beginFeedbackEdit` / `cancelFeedbackEdit` / `commitFeedbackEdit`). In-progress textarea value lives as local component state inside `<AiBubble>` — only the *fact* that this bubble is in edit mode is global. No new store |
| Escape chain | Doc 11 §Escape Chain fully rewritten (CD-6 closed). Final priority order: 1 Modal → 2 Settings full-surface → 3 Mode session end-confirmation → 4 Ghostwriter active → **5 Feedback edit open** → 6 DocEditor focus blur → 7 Reader View → 8 no-op |
| Multi-bubble discovery | **Out of scope for v2.0.** No "list all feedback in branch" UI. Reading the story scrolls past every annotation. Cross-branch view is the job of Handover synthesis (Doc 23) |

**Rationale:** v1.0 had two affordances — per-bubble inline + Control-Pane overlay — and the overlay duplicated state (count badge) without enough independent value to justify the right-pane real estate competing with cache / mode UI in v2.0. The inline strip is in-flow with story reading, scannable, and the click-to-edit interaction is direct. Explicit Apply (rather than auto-save on blur) is deliberate: feedback influences every future generation that includes the message; an accidental commit is a worse failure than a lost draft. The triad token defaulting to a stable amber rather than tracking accent reflects feedback's role as a stable annotation marker — visually distinct from accent-driven ornament. Re-introducing the overlay later requires zero data-layer change; it is held in reserve as a v2.1 toggle if writer telemetry asks for it.

**Affects:** Doc 03 (`feedback_color` world-overridable key; `ResolvedSettings.feedback_color`); Doc 06 (`workspaceStore.feedbackEditingMessageId` field + 3 actions; right-pane component-directory description trimmed); Doc 07 (`update_feedback` notes — server-side preconditions, stale rules); Doc 08 (`--color-feedback` triad relocated from Semantic to Feature Colors with explicit non-accent-tracking default); Doc 11 (full Escape Chain rewrite — CD-6 closed; Settings full-surface added at priority 2; Feedback edit at priority 5; Ghostwriter `reviewing`-phase nuance); Doc 15 (§Feedback now points at Doc 28 for the affordance); Doc 20 (Features tab adds Feedback row with `#f59e0b` default and non-accent-tracking note; `ThemeSnapshot.feedback`; `applyTheme()` writes the triad); Doc 27 (AI bubble feedback-rendering line rewritten from ⚠️ provisional to locked spec; cross-reference table now includes Doc 28); Doc 28 (full spec). PRE-IMPLEMENTATION-AUDIT CD-6 ticked, CD-13 added + ticked.

---

### D-18 — Coding Standards Umbrella (2026-05-04)

**Decision:** Doc 24 (Coding Standards) is fully specified. Umbrella decision covering the v2.0 code-rule architecture:

| Sub-decision | Locked value |
|---|---|
| Doc shape | TOC + v1.0 Anti-pattern Appendix (13 items, each Forbidden / Preferred snippet pair) |
| Enforcement tiers | Three explicit tiers — 🔴 Linted (CI fails) / 🟡 Reviewed (PR comment) / ⚪ Convention (smell) — every rule tagged |
| `safecommand!` panic-catch shim | **Dropped.** v2.0 discipline is "no `.unwrap()` in production paths"; a panic crossing IPC is a bug to fix at source, not to swallow |
| Logging crate | **`tracing` + `tracing-subscriber`.** `log` crate forbidden in v2.0 (transitive `tracing-log` bridge acceptable). Spans for request scopes; structured fields, never user content |
| ESLint scope | **Standard** — `@typescript-eslint/recommended-type-checked` + `react-hooks/recommended` + `import/order` + `import/no-restricted-paths` (store boundary) + `eslint-plugin-tailwindcss` (no-arbitrary-value with `[--color-*]` allow) + `no-floating-promises` + `no-explicit-any` (both `error`) |
| Pre-commit | **`husky` + `lint-staged`.** Per-file eslint / prettier / cargo fmt; top-level `tsc --noEmit`. Heavy clippy runs in CI |
| Commit messages | **Conventional Commits.** Closed type set (`feat / fix / refactor / perf / docs / test / build / ci / chore`); closed scope set (`auth / vault / convo / cache / mode / settings / accordion / ghostwriter / feedback / media / ipc / ui / build / ci / docs`); subject < 70 chars, imperative mood; no `// Phase N` framing |
| `types.ts` policy | **Generated by `ts-rs`, committed, CI drift-checked.** Rust struct is SoT; first line of `types.ts` is `// AUTO-GENERATED — DO NOT EDIT`; `cargo test ts_rs_export && git diff --exit-code src/lib/types.ts` is a CI gate |
| Constants | **Per-service `constants.rs` files** co-located with the consuming service (`services/gemini/constants.rs`, `services/cache/constants.rs`, etc.). No top-level junk-drawer `services/constants.rs` |
| Component size budget (R19) | **⚪ Soft** — > 400 warrants structural review; > 600 requires PR-description justification; no hard ceiling but a 1,000-line component almost certainly hides multiple smaller components or a state machine |
| Max-stores-per-component (V1-LESSONS A5) | **⚪ Convention** — > 3 is a smell, > 4 needs review. Linting deferred (custom plugin work not justified in v2.0) |
| PR template | **`.github/pull_request_template.md`** with checklist lines for: no `.unwrap()`, no `// Phase N`, no raw `state.X.lock()`, no raw settings SQL, no content in logs, signature parity (Doc 07 + feature doc), `ts-rs` regen, size justification, store amendment, token usage, tests added |
| SB-N anchors | Doc 24 embeds `<!-- SB-1 -->` / `<!-- SB-2 -->` / `<!-- SB-3 -->` / `<!-- SB-5 -->` / `<!-- SB-6 -->` next to the rule that resolves each substrate item; SB-4 (cancellation lifecycle) deferred to dedicated Doc 05 amendment |
| Markdown rendering subset (R15) | Stays in Doc 09 — Doc 24 is for code rules, not rendering rules |
| AppState lock-helper rule (SB-5) | Raw `.lock()` on AppState fields forbidden outside `state/access.rs`; the `with_active_conn` / `with_settings_conn` / `with_master_key` / `with_api_key` / `with_active_world_id` / `with_two_conns` family is the only call surface. Helper *signatures* land in Doc 05 follow-up amendment |
| Settings access rule (SB-1) | Stringly-typed access to `app_settings` / `story_state` forbidden; `AppSettingKey` / `StoryStateKey` enums in `services/settings_keys.rs` + typed accessors in `db/settings.rs`. Doc 03 key tables are SoT |
| Schema migrations rule (SB-6) | Numbered SQL files `db/migrations/world/NNN_*.sql` and `db/migrations/app/NNN_*.sql`; `schema_migrations` table tracks applied versions per DB; append-only |
| Tauri command signature drift (R5) | Any `#[tauri::command]` signature change updates **both** the owning feature doc **and** Doc 07 in the same PR; PR-template checklist line enforces this in review |

**Rationale:** Doc 24 collects the rule home for every code-discipline item that was scattered across Doc 05 (lock ordering, `LoomError` use, command shape), Doc 06 (no cross-store imports, IPC wrappers, selector rule), Doc 08 (token usage), V1-LESSONS (the 13 anti-patterns), and IMPROVEMENT-BACKLOG (R-items). The three-tier enforcement model makes "what fails CI vs. what review catches vs. what reviewers note as a smell" explicit at the point of each rule, which is the v1.0 deficit — rules without enforcement clarity are rules without teeth. Dropping `safecommand!` and forbidding raw `.lock()` are the two hardest commitments: each is the only way to prevent the v1.0 "convention drift" pattern from recurring (the 118-occurrence boilerplate accumulated *despite* the convention being known). The Anti-pattern Appendix is the doc's most reusable section — Forbidden / Preferred snippet pairs are inspectable shape, not aspirational prose. Substrate items (SB-1..SB-3, SB-5, SB-6) have their rule home here today; their tooling implementation lands in the Phase 0 substrate session and closes the SB-N items at that point. SB-4 (cancellation lifecycle) is the only item that genuinely warrants its own design pass before specification — bundling it here would skip the Discovery → Picture-back → Numbered Qs discipline that the cancellation surface needs.

**Affects:** Doc 24 (full spec); Doc 05 (cross-references for lock-helper rule, `tracing`, cancellation lifecycle — full SB-4 / SB-5 contract land in follow-up Doc 05 amendment); Doc 06 (`types.ts` source-of-truth line revised to reflect ts-rs; §Store Rules links to Doc 24 §No Cross-Store Imports for ESLint enforcement); PRE-IMPLEMENTATION-AUDIT.md (ST-2 ticked); IMPROVEMENT-BACKLOG.md (R3 / R5 / R13 / R19 closed; R2 / R4 / R17 / R18 marked "spec'd in Doc 24 — code pending Phase 0"); `.claude/rules/code-standards.md` and `.claude/rules/pitfalls-and-reference.md` (v2.0 redirect banners).

---

### D-19 — Testing Strategy Umbrella (2026-05-07)

**Decision:** Doc 25 (Testing Strategy) is fully specified. Umbrella decision covering the v2.0 test architecture:

| Sub-decision | Locked value |
|---|---|
| Rust test runner | `cargo test` (standard); unit tests alongside module in `#[cfg(test)]`; integration tests in `src-tauri/tests/` |
| TS test runner | **Vitest 4.x** — native ESM + Vite integration; single config in `vite.config.ts` under the `test` key |
| DOM environment | **`happy-dom`** — faster than jsdom; no native deps; sufficient for LOOM's component tests which mock IPC anyway |
| Globals | **`globals: false`** — all Vitest APIs explicitly imported; avoids global scope pollution |
| Component test library | **`@testing-library/react`** + `@testing-library/jest-dom` (matchers extended via `expect.extend`) |
| In-memory SQLite fixture | `Connection::open_in_memory()` + `apply_pending(MigrationRoot::World\|App)` — same migration runner, non-encrypted, fully isolated per test |
| Gemini HTTP mock | **`wiremock`** — ergonomic async mock server; SSE-compatible; `MockServer::start().await` in each async integration test |
| IPC mock boundary | Mock `@tauri-apps/api/core` (not the typed wrapper) via `vi.mock('@tauri-apps/api/core')` — wrapper's type-narrowing runs as real code; typed values from `src/lib/types.ts` ensure type drift is caught |
| Real Gemini calls in tests | **Never.** No API key in CI; no E2E call path. HTTP boundary is always mocked |
| Coverage thresholds | **Not enforced by CI in v2.0.** Module-class targets (exhaustive for `security/`, high for `services/history`, `rate_limiter`, `settings`, `cache`) are the contract; numeric enforcement deferred to v2.1 |
| Playwright E2E | **Deferred to v2.0.x.** `tauri-driver` setup adds CI complexity not warranted until surface is stable |
| CI matrix | PR: fast gates only (build + unit + lint); merge-to-main: adds Windows Tauri build + doc tests; nightly: all three platform builds |

**Rationale:** Vitest over Jest because it is Vite-native (zero extra config for the ESM + `@` alias setup already present) and faster in watch mode. `happy-dom` over `jsdom` because LOOM's component tests mock the IPC layer and don't rely on real browser APIs — `happy-dom` is faster with no native deps. `globals: false` matches the broader project convention of explicit imports. `wiremock` was chosen (over `httpmock`, `mockito`) because Doc 24 already names it, it handles async SSE-style chunked responses cleanly, and its `MockServer` lifecycle matches `tokio::test` naturally. The "mock at the IPC wrapper boundary, not the typed-wrapper boundary" rule is the critical one: it means the wrapper function is real code under test, which catches import drift, type errors, and wrong command names — the failure modes that matter.

**Affects:** Doc 25 (full spec); PRE-IMPLEMENTATION-AUDIT.md (ST-3 ticked); `vite.config.ts` (test block added); `package.json` (`pnpm test` + `pnpm test:ui` scripts; vitest + @testing-library/react + happy-dom devDeps); `src-tauri/Cargo.toml` (wiremock + reqwest devDeps); `src-tauri/tests/canary.rs` + `tests/gemini_sse_mock.rs` (canary + SSE recipe tests); `src/__tests__/setup.ts` + `appStore.test.ts` + `ipc_mock.test.tsx` (canary + IPC recipe tests).

---

### D-20 — Media Deferred to v2.1 (2026-05-16)

**Decision:** The entire media surface — **including image source documents** — is deferred to v2.1. This supersedes D-15's "slim v2.0 scope" (image-as-source-doc was the one media feature D-15 kept for v2.0). v2.0 source documents are **text only**.

| Sub-decision | Locked value |
|---|---|
| What's deferred | Image upload (`upload_image`), the File API URI cache integration, the DocEditor lightbox, Navigator hover thumbnails, `content_type = 'blocks'`, image generation, TTS — the whole of Doc 19 |
| Why now (not at D-15) | Phase 10 implementation surfaced that image delivery is entangled with the unresolved source-doc request-delivery question (D-21). Shipping image-as-source-doc would have meant resolving the File API integration *and* the cache-vs-inline delivery model in one phase. Text source documents alone deliver the v2.0 writer value (a reference library the model sees); images are the smaller, riskier half |
| Dormant code retained | `services/file_api.rs` (complete + wiremock-tested) and the `Image` branches in `services/cache.rs::build_*_prefix` stay in the tree, reserved for the v2.1 pickup. `services/vault.rs` continues to reject `Image` item creation (message updated to cite v2.1) |
| Schema | `items.asset_path` / `asset_meta` / `file_api_uri` / `file_api_uploaded_at` columns remain (Doc 03) — harmless, reserved |
| Doc 18 consequence | Image source documents (lightbox, image-as-context) are marked v2.1-deferred in Doc 18; the v2.0 surface there is text source documents |

**Rationale:** D-15 already deferred image *generation* and TTS; the one media feature it kept was image-as-source-doc. Phase 10 found that feature can't ship coherently without also resolving how *any* source document reaches the model (D-21) and wiring an async File API upload into request assembly. That is two hard problems for a "slim" phase. Deferring images wholesale lets Phase 10 do one thing well — text source-document delivery — and lets v2.1 pick up media as a coherent unit with `file_api.rs` already built and tested.

**Affects:** Doc 19 (status → Deferred to v2.1); Doc 18 (image-source-doc sections marked v2.1-deferred); `services/vault.rs` (Image-rejection message cites v2.1); `IMPLEMENTATION-PLAN.md` (Phase 10 re-scoped from "Media (slim)" to "Source-document delivery & cache safety").

---

### D-21 — Source-Document Request Delivery (2026-05-16)

**Decision:** Source documents reach the model through a **single prefix builder** whose output is delivered either as a real Gemini cache or as an inline "fake cache" (the same content prepended verbatim where the cache would sit). A cache-create failure **aborts the send with a warning** rather than silently sending without context, unless the writer opts into inline fallback.

| Sub-decision | Locked value |
|---|---|
| Single prefix builder | `services/cache.rs::build_*_prefix` is the one place SI + source docs + history are assembled. The inline path no longer has its own (doc-less) assembly — it reuses the prefix |
| Two delivery routes | (a) **Real cache** — `create_cache` → Gemini `cachedContent`. (b) **Inline fake cache** — `prefix.contents` prepended directly into the request, no cache object |
| Sub-threshold | When the prefix is below `cache_min_tokens`, the send uses the inline fake cache — docs are still included. (Previously: sub-threshold dropped all source docs — a silent-context-loss bug) |
| Cache-create failure | Default: **abort the send**, hard-delete the optimistic user/model rows, surface `LoomError::CacheCreate`. The writer is told context could not be attached rather than getting a degraded answer |
| `inline_context_fallback` | New `app_settings` boolean key, default `false`. When `true`, a failed cache-create falls back to the inline fake cache instead of aborting — the writer trades cache cost-savings for send reliability. Toggle UI lands in Settings (Phase 11); the key carries its default until then |
| All three modes | Story (this model), handover (never caches → always inline fake cache, now with docs prepended), consulting (cache when active; inline fake cache on absence/failure) |
| Supersedes | CD-12's loose "inline path triggers on real failure or below-threshold" — D-21 makes the inline path *include the docs* and makes failure a stop, not a silent degrade |

**Rationale:** Phase 5 wired source-document storage and attach/detach but never wired docs into the Gemini request; Phase 6 added doc inclusion only inside the cache prefix. The result was a latent bug: a story below `cache_min_tokens` (default 4096) sent none of its attached documents, silently. The fix is to make the prefix builder the single source of doc-inclusion truth and let the *delivery* (cache object vs. inline prepend) be the only thing that varies. Aborting on cache-create failure — rather than the prior silent inline fallback — is the safety posture the writer needs: a missing context cache means the model would answer without the world bible / character sheets, and a degraded answer the writer can't distinguish from a good one is worse than an explicit stop. `inline_context_fallback` exists for the writer who would rather pay full token price than have a send fail.

**Affects:** Doc 03 (`inline_context_fallback` app-settings key); Doc 22 (delivery-model section; CD-12 fallback semantics tightened); `services/settings_keys.rs` (`InlineContextFallback`); `commands/conversation.rs` + `commands/modes.rs` (delivery rework); `IMPLEMENTATION-PLAN.md` (Phase 10 scope + checkpoints).

---

## Amendment Process

When a decision needs to change:
1. Add an `#### Amendment` block directly below the original decision — do not edit the original
2. State what changed, why, and the date
3. Update the "Last updated" date at the top of this file
4. Update the Status column in the Document Map for any affected docs

---

## Open Questions

See [TODO.md](TODO.md) for all open questions and deferred decisions.
