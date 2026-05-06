# LOOM 2.0 — Open Questions and Deferred Decisions

> **Last updated:** 2026-05-05 — `IMPLEMENTATION-PLAN.md` drafted (14 phases, 0 → 13 with 0.5 for Doc 25). Doc 25 (Testing Strategy) and Doc 26 (Build & Release) now have explicit phase homes (0.5 and 13 respectively); ST-3 / ST-4 will close in those phases. NB-1..NB-4 visual / copy items will close in Phase 12. SB-4 (cancellation lifecycle) folded into Phase 0 deliverables. `_new_claude.md` §The phase model amended to require live-update of `Resumption notes:`.
> **Earlier:** 2026-05-04 — Feedback design pass (D-17): Doc 28 (Feedback) complete; per-bubble inline strip is the sole affordance, v1.0 right-pane Feedback Overlay dropped (reversible — held in reserve as a v2.1 toggle if usage warrants); explicit Apply / Cancel (no auto-save on blur); `--color-feedback` triad introduced with stable amber default; Doc 11 §Escape Chain fully rewritten (CD-6 + CD-13 closed in PRE-IMPLEMENTATION-AUDIT).
> **Earlier:** 2026-05-03 — Doc 20 (Settings & Themes) design pass: D-16 added; full-surface settings; two scopes only (App + World); cascade UX (auto-create override on edit, `↺` revert, per-tab "Reset all overrides"); modificators have no Settings home (free-text per-turn — Doc 15 amended); dark-only in v2.0; O16 partially closed (exposure spec'd in Doc 20; default still empirical).
> **Earlier:** 2026-04-29 — Doc 19 (Media) design pass (slim): D-15 added; v2.0 ships image-as-source-doc only (upload, asset storage, File API URI cache, rendering primitives); image generation, TTS, per-turn user-message images, AI-generated `'blocks'` model messages all deferred to v2.1 (`docs-v2/future/media-generation.md`); world backup (`.loom-backup` zip) lives in Doc 14 §World Backup; narrative export (Doc 21) deferred to v2.1; O6 (File API expiry) closed.
> **Earlier:** 2026-04-29 — Doc 17 (Ghostwriter) design pass: D-14 (Ghostwriter Umbrella) added; mode-first activation retained; surgical-stitching protocol adopted from `project_ghostwriter_fix.md` memory; in-place edit only (no branching); available across all three modes; floating-panel placement documented in Doc 27; Doc 11 selection-first wording corrected to mode-first; `blocks` content-type support deferred to v2.1.
> **Earlier:** 2026-04-29 — Doc 18 (Source Documents) design pass: D-13 (Source Documents Umbrella) added; Source Document Creator deferred to v2.1 (`docs-v2/future/source-document-creator.md`); Doc 18 commands flipped from skeleton to specified; vault paperclip + cascade rules locked.
> **Earlier:** 2026-04-29 — Doc 16 (Accordion) design pass: O3 resolved (fake-pairs retained for v2 caching); VERIFY-Doc-16 block closed (`--color-checkpoint` retained — checkpoints still render as Theater banners); D-12 (Accordion Umbrella) added.
> **Earlier:** 2026-04-29 — Doc 23 (Modes) design pass: Modes block closed; consulting Q1–Q6 resolved; multiple cache O-items resolved (O1, O5, O14, O19); Doc 22 (Context Caching) finalised; Doc 27 (Theater Composition) created.

---

## OPEN — Context Caching (residual)

Most of the original O1–O19 list was resolved by the Doc 22 / Doc 23 design pass on 2026-04-29. The remaining items are independent of the modes / cache architecture and either depend on other features (Accordion, File API) or require empirical work.

**O16 — `cache_min_tokens` default.**
4096 (Gemini 2.5 Pro published minimum) is provisional. Exposure spec'd in Doc 20 §Gemini tab (App + World, world-overridable) and added to `app_settings` per Doc 03 (2026-05-03 Doc 20 pass). **Default value still requires empirical verification during testing phase.**

**O18 — Forward-compat for v2.1 undo/redo.**
Operation-log entries should mark cache stale. Doc 22 already lists this in Out of Scope; the canonical reference belongs in `docs-v2/future/undo-redo.md`. **Add to that file when it next gets touched.**

**O10 (residual) — Right-pane multi-cache display visuals.**
Doc 22 spec'd the row format and click action; the exact visual treatment (token colours, density, scrolling threshold) is deferred to the visual design phase, alongside the rest of the right pane.

---

## OPEN — Media Generation Providers (v2.1)

Blocks: v2.1 implementation of media generation. **Not blocking v2.0** — image generation and TTS were deferred from v2.0 in the Doc 19 design pass; the v2.1 design carry-forward lives in `docs-v2/future/media-generation.md`.

**Q1 — Image generation provider**
Which API? (Gemini 2.0 Flash multimodal, Imagen 3, OpenAI DALL-E, Stability AI, Replicate, fal.ai, etc.)

**Q2 — MP3 / TTS provider**
Which API? (ElevenLabs, Google TTS, OpenAI TTS, Kokoro, Piper, etc.)

**Q3 — Provider configuration**
Are providers hardcoded per media type, or user-selectable in Settings?

---

## DEFERRED — In-flight v1.0 Features (Decision 7)

Blocks: Doc 24 (Coding Standards)

These features exist in the v1.0 codebase in varying states of completion. Carry forward, redesign, or cut?

| Feature | v1.0 state | Decision |
|---|---|---|
| Source Document Creator (AI-assisted template creation) | 20% — UI scaffolded, no backend | **Cut from v2.0**, deferred to v2.1 — design captured in `docs-v2/future/source-document-creator.md` |
| API Debug Preview (dev-mode Gemini request inspector) | 20% — modal scaffolded, no intercept | TBD |
| Image Generation | 10% — provider stub only | **Cut from v2.0**, deferred to v2.1 — design captured in `docs-v2/future/media-generation.md` |
| TTS / Audio | 0% — no code | **Cut from v2.0**, deferred to v2.1 — design captured in `docs-v2/future/media-generation.md` |
| Story narrative export (PDF / HTML / Markdown) | 0% in v2 (Doc 21 stub) | **Cut from v2.0**, Doc 21 deferred wholesale to v2.1. World backup (`.loom-backup` zip) ships in v2.0 via Doc 14 §World Backup |

---

---

## VERIFY in the visual / UI design phase (deferred from Doc 15)

**UI items deferred from the Conversation Engine spec.** The behaviour is locked in Doc 15; only the visual treatment / placement is pending.

- **Token meter placement.** `get_token_count` is wired and the Status section shows the live total when typing. Decide whether to surface a more prominent meter near the input area (with a warning threshold near `context_token_limit`) or keep the Status section as the only surface.
- **Status section glyphs and copy.** The provisional `●◐◓◔✓⚠` set and the wording (`Preparing`, `Thinking`, `Streaming`, `Complete`, `Stopped`, etc.) are placeholders and should be tuned. Doc 15 §Status View has the state list.
- **Generation parameters tab visuals.** Settings → Gemini will host `gen_temperature` / `gen_top_p` / `gen_top_k` / `gen_max_output_tokens`. Defaults marked ⚠️ provisional in Doc 03; the input affordances (sliders / numeric / presets) are open.
- **Output-length-removed copy.** Surface a small note somewhere ("To request a specific length, write it in Constraints or set an Aux slot.") so writers used to v1.0's preset don't hunt for it. Likely lives near the Send button or in the Constraints field's empty-state placeholder.
- **Confirmation modal copy for deletion.** Doc 15 has a draft (`"Delete N exchange(s)? This cannot be undone in v2.0."`); the "in v2.0" framing should be tuned for tone — writers don't think in version numbers.
- **Status section position.** Currently spec'd as bottom of the right pane. Re-orderable via JSX (no special wiring); a future user-customisable order is possible but not in scope.

These do not block any other doc. They become live items when the visual design phase begins.

---

## VERIFY when writing Doc 26 (Build and Release)

**CSP enforcement — `connect-src 'none'`**
Doc 04 states that the WebView Content Security Policy is set to `connect-src 'none'`, enforcing that the frontend cannot make HTTP requests. This needs to be verified in `tauri.conf.json` (or the Tauri v2 capabilities config) when Doc 26 is written, and the exact CSP string documented there.

---

## RESOLVED

- **2026-05-04 — Feedback umbrella (D-17).** Doc 28 complete. Per-bubble inline strip below the AI bubble is the sole affordance: always-visible single-line preview when `user_feedback` is non-empty (2px `--color-feedback` left border, click anywhere to enter edit mode); when empty, the "Feedback" entry in the hover action row is the only entry point. Edit mode = inline textarea, auto-grow up to ~6 lines, explicit `[Cancel]` / `[Apply]` buttons; `Ctrl+Enter` = Apply, `Esc` = Cancel; no auto-save on blur (deliberate — feedback influences every future generation that includes the message); no "discard changes?" confirmation modal. One bubble in feedback-edit at a time; tracked via `workspaceStore.feedbackEditingMessageId`. Mode-gated to story-kind AI bubbles (hidden on handover/consulting, user bubbles, and v2.1 `'blocks'` content type). Hidden while Ghostwriter is active on the bubble (any phase). Stale-trigger set is the same as `update_message_content` — feedback edit on a cached message routes through the Doc 22 confirmation modal, feedback edit on a closed-segment message marks the segment stale (Doc 16). v1.0's right-pane Feedback Overlay (Doc 10 §6) is dropped — held in reserve as a v2.1 Settings toggle if writer telemetry shows the cross-branch view is wanted. New triad token `--color-feedback` / `-hover` / `-subtle` with stable `#f59e0b` default (does **not** track accent — feedback is a stable amber by design); world-overridable via `feedback_color`. Doc 11 §Escape Chain fully rewritten (CD-6 closed) — priority 5 = Feedback edit open. Touched docs: 03, 06, 07, 08, 11, 15, 20, 27, 28 (new), 00-INDEX, PRE-IMPLEMENTATION-AUDIT.
- **2026-04-29 — Media umbrella, slim (D-15).** Doc 19 complete (slim scope). v2.0 ships image-as-source-doc only: upload via picker + drag-and-drop, asset storage `worlds/<world_id>/assets/<item_id>.<ext>`, MIME validation by magic bytes (PNG/JPEG/WebP/GIF), 10 MB max, dimensions extracted via the `image` crate, Navigator hover thumbnails via `convertFileSrc`, `get_or_upload_file_api_uri` helper with 47-hour cache TTL (Gemini hard-expires at 48 h). Best-effort asset cleanup on hard-delete (orphaned files harmless; no orphan sweep). No `DELETE` to Gemini File API on hard-delete (auto-expiry handles it). Deferred to v2.1 in `docs-v2/future/media-generation.md`: image generation (Imagen / Stability / fal.ai / Gemini multimodal — provider TBD per Q1), TTS / audio (provider TBD per Q2), per-turn user-message images (`UserContent.image_blocks`), AI-generated images in model messages (`content_type = 'blocks'`), Ghostwriter on blocks messages (PATCH-16). World backup (`.loom-backup` zip) added to Doc 14 §World Backup; narrative story export deferred to Doc 21 (v2.1).
- **2026-04-29 — O6 (File API expiry vs. cache).** Resolved by Doc 19 §Gemini File API URI Cache: 47-hour cache TTL refreshed inside `get_or_upload_file_api_uri`. Stale handling is implicit — when the helper is called from cache-prefix construction (Doc 22), an expired URI triggers a fresh upload, and the new URI is what enters the cached prefix. The cached prefix's URI references update as a natural consequence of the next send.
- **2026-04-29 — Ghostwriter umbrella (D-14).** Doc 17 complete. Mode-first activation (selection-first model in Doc 11 was corrected); `✦ Ghostwriter` action-row button + right-click context menu both enter mode on the AI bubble. Floating panel in the Theater's right gutter, vertically clamped to the active bubble's extent, follows the viewport within that range. Surgical-stitching request protocol: model receives `<context_before>`, `<selected_passage>`, `<context_after>` + instruction, returns only the rewritten passage; frontend stitches at the recorded character offsets. Non-streaming; same `'text'` rate-limit window as story sends. Available on AI bubbles in **all three modes** (story / handover / consulting); per-mode history assembly. In-place edit only on non-latest messages — branching is gone, downstream messages are not touched. Word-level LCS diff with inline highlighted-new visual. Per-message revert via `messages.ghostwriter_history` JSON, popping one entry at a time. Cached-message protection (Doc 22) and accordion-stale rule (Doc 16) apply to accept and revert. `content_type = 'blocks'` (interleaved text + image) support **deferred to v2.1** alongside image generation; the action-row button hides on blocks messages. Ghostwriter state lives on `workspaceStore`, not a separate store (pattern consistency with accordion).
- **2026-04-29 — Source Documents umbrella (D-13).** Doc 18 complete. DocEditor: `<textarea>` + Markdown preview toggle (no split, no WYSIWYG); debounced auto-save at ~1 s with no manual button and no unsaved-guard modal; Tab / Shift+Tab placeholder navigation when `{{...}}` tokens are present, two-space indent fallback when none. Image items render in a lightbox with caption (File API mechanics owned by Doc 19). DocEditor takes the full workspace surface — mode switcher and right pane hidden — and `← Back` restores the previous mode (Q6 option 2). Source docs are sent in **all three modes** (story / handover / consulting); insertion-order; `=== SOURCE DOCUMENT: <subtype> — <name> ===` header. Attach via vault hover-paperclip or right-click only; detach via Right Pane Context Documents `×` only — split surfaces match decision moments. Soft-delete cascades to detach from every story (cache stale per affected story); restore from Trash does **not** auto-reattach. Hard-delete cleans `attachment_history` via `ON DELETE CASCADE`. Renames mark cache stale (name is part of the cached header). No max attachment count.
- **2026-04-29 — Source Document Creator (TODO §DEFERRED row).** Cut from v2.0; full v1 spec + v2.1 redesign options preserved in `docs-v2/future/source-document-creator.md` (Option B — per-doc session inside the DocEditor — recommended). `templates.creator_instructions` schema field retained for forward compatibility.
- **2026-04-29 — Accordion umbrella (D-12).** Doc 16 complete. Linear segments (no fork-spanning). `is_collapsed` (UI) and `use_summary` (API substitution) decoupled via new `accordion_segments.use_summary` column. Checkpoints render as banners; inverted naming ("name what comes next"); start sentinel `Chapter 1` auto-created on story creation, undeletable. Per-banner button-slot state machine: `Generate summary` → animated loader → `Use summary` toggle. Empty segments disallowed at creation time; "Generate summary" disabled on the most-recent (open) segment. Right-click `Summarise previous chapter` is the discoverability shortcut for the open-segment case. Manual summary edit allowed; clears `is_stale`. `isGenerating` is the single global flag covering story / session / summarise — per-banner button greys with tooltip when busy. Summarisation has its own world-overridable gen params (`gen_summarise_temperature` / `_top_p` / `_top_k` / `_max_output_tokens`); ⚠️ provisional defaults `0.3 / 0.95 / 40 / 2048`.
- **2026-04-29 — O3 (Accordion fake-pairs in v2 caching).** Resolved with Doc 16: collapsed segments are substituted as fake-pairs in the cache prefix exactly as in v1.0, so model input is identical on cache hit vs miss. See Doc 22 §Accordion-specific Stale Triggers for which accordion ops mark cache stale.
- **2026-04-29 — VERIFY-Doc-16 (`--color-checkpoint` token).** Retained. Checkpoints still have a Theater visual presence in v2.0 — they render as banners (one per checkpoint) per Doc 27. The token survives; `applyFeatureColors` is unchanged.
- **2026-04-27 — World switch, key re-derivation.** Resolved by D-07. Master key persists in `AppState` across world switches; the new world's `loom.db` opens with the existing key; key is zeroed only on lock/close.
- **2026-04-27 — `cacheStore` existence.** Resolved by D-03-B amendment. A 7th store is added.
- **2026-04-27 — `messages.kind` naming.** `'normal'` renamed to `'story'` for symmetry with the modes vocabulary.
- **2026-04-27 — Handover and caching.** Decision: handover output is not cached (single-shot per story; cache creation overhead exceeds reuse value). `cache_state.mode` enum stays `('story','consulting')`.
- **2026-04-27 — Auto-lock reset trigger.** Reset on any meaningful UI activity (keystroke, scroll, click, generation completion). The 15-minute timer is the failsafe, not the only signal.
- **2026-04-27 — Internal prompts in app_settings.** Stay editable, but only via a Developer section in Settings, with a Restore Default button per prompt.
- **2026-04-28 — Conversation engine umbrella.** Resolved by D-08. Linear messages, four-field input, truncate-and-replace edit, cascading hard-delete, drafts, Status section, Theater scroll rules, full cancellation taxonomy. See Doc 15.
- **2026-04-28 — Output-length feature.** Removed entirely from v2.0 (was `app_settings.output_length` and `UserContent.output_length` in earlier drafts). Length cues live in Constraints or aux slots.
- **2026-04-28 — Aux slot scope.** Per-story (`story_state.active_aux_slot`), not per-world. Doc 03 amended.
- **2026-04-28 — Aux slot placement in request.** Prepended to current user turn with explicit `[AUX — ALWAYS APPLY]` delimiter. Outside the cached prefix; not stored on messages. Doc 15 §Aux Slot Injection.
- **2026-04-28 — Generation parameter exposure.** `gen_temperature` / `gen_top_p` / `gen_top_k` / `gen_max_output_tokens` in `app_settings`, world-overridable. Defaults ⚠️ provisional. Doc 03 amended.
- **2026-04-28 — Per-turn image attachments.** Removed (`attached_image_ids` dropped from `UserContent`). Image work lives in Doc 19.
- **2026-04-28 — Cancellation taxonomy.** Eleven distinct paths spec'd in Doc 15 §Cancellation Taxonomy. New `generation_failed` event; `generation_cancelled` is silent.
- **2026-04-28 — Drafts persistence.** Per-story in `story_state.draft`; debounced ~1 s; cleared on successful send; survives lock + close.
- **2026-04-28 — Streaming chunk granularity.** No buffering. One Tauri event per Gemini SSE chunk.
- **2026-04-28 — Cascading deletion of checkpoints / segments.** A hard-deleted message also removes anchored checkpoints and any affected segments, in one transaction. Same cascade rules will apply to v2.1's reversible soft-delete.
- **2026-04-28 — Undo / redo for v2.0.** Deferred to v2.1 by D-09. Full operation-log design captured in `docs-v2/future/undo-redo.md`. v2.0 deletion is immediate hard-delete with confirmation.
- **2026-04-29 — Modes umbrella (D-10).** Doc 23 complete: top-bar mode switcher always creates new sessions; re-entry only via banner; Theater is a single shared scroll surface across modes; story uses 4-field input + cache, handover is multi-turn uncached with manual seed-doc workflow, consulting is multi-session with per-session cache. Banner pattern unified across handover / consulting / accordion (Doc 16 inherits the pattern).
- **2026-04-29 — Caching architecture (D-11).** Doc 22 complete: cache prefix = SI + docs + story-history-to-date; TTL refresh on every send; auto-rebuild on expiry as part of next send; cached-message edit/delete protected by confirmation modal that marks cache stale on dismissal; consulting has per-session caches keyed off `entry_snapshot`; story cache and active consulting cache coexist; story cache TTL is not refreshed during consulting and may expire transparently.
- **2026-04-29 — Consulting Q1 (persistence).** Persistent. Stored in `messages` with `kind='consulting'` and `session_id` set, per-session in `conversation_sessions`. Re-entry via banner; older story messages after entry are greyed.
- **2026-04-29 — Consulting Q2 (switching).** Free switching, including mid-stream. Send blocked while `isGenerating`; cancel available from any mode. Streaming continues in the background regardless of which mode is active.
- **2026-04-29 — Consulting Q3 (actionability).** Read-only reflection. Consulting cannot directly modify the story.
- **2026-04-29 — Consulting Q4 (scope).** Per-story; multiple sessions per story; each session is self-contained.
- **2026-04-29 — Consulting Q5 (context depth).** Full story up to entry, with current accordion-collapse state preserved in the entry snapshot. Snapshot drives re-entry integrity.
- **2026-04-29 — Consulting Q6 (UI placement).** Same Theater pane. Mode switcher in the top bar. Active session emphasised on the switcher tab.
- **2026-04-29 — `messages.kind` enum and storage unification.** `kind` expanded to `'story' | 'handover' | 'consulting'`; `session_id` foreign key added; the placeholder `mode_conversations` table was dropped before being built. Handover and consulting unified onto `conversation_sessions`.
- **2026-04-29 — `cache_state` schema (O14).** PK is now `story_id` only; `mode` column dropped. Added `last_cached_message_id` and `total_token_count`. Per-session caches live on `conversation_sessions` rows, not `cache_state`.
- **2026-04-29 — O1 (SI mismatch on consulting cache transition).** Resolved by per-session caches. Story cache and consulting cache are distinct, coexist, and each carries its own SI. No transition needed.
- **2026-04-29 — O2 (manual recreation contents).** Manual recreate uses the same prefix as auto-create on send: SI + currently-attached docs + all story-kind messages to date. No UI choice; one consistent rule.
- **2026-04-29 — O4 (initial cache creation timing).** Never auto on story creation or open. Auto on first send when the prefix exceeds `cache_min_tokens`; manual via right-click Send → "Create cache" any time before that.
- **2026-04-29 — O5 (consulting Q&A in subsequent caches).** No. Each consulting session is self-contained; sessions never see each other's history or cache. Confirmed in Doc 23.
- **2026-04-29 — O7 (cache + context-limit interaction).** Token meter sums cache size + uncached additions + new turn + aux. `get_token_count` returns the total whether cached or inline. Doc 22 §Cache + Context Limit.
- **2026-04-29 — O8 (cache creation failure handling).** Toast warning, fall back to inline for the current send, retry create on next send. No silent retries during the failing send.
- **2026-04-29 — O9 (comprehensive stale-trigger list).** Captured in Doc 22 §Stale Triggers, split by which cache (story / consulting) is affected.
- **2026-04-29 — O10 (multi-cache display row format).** Story name + token count + TTL countdown + state colour per row. Click opens Cache Contents modal. Active consulting session appears as an additional sub-row labelled with the session name. Visual specifics still deferred to the visual design phase.
- **2026-04-29 — O11 (cache deletion on story hard-delete).** Best-effort `DELETE` to Gemini for the story cache and for every consulting session's cache, on vault permanent delete.
- **2026-04-29 — O12 (source-doc ordering).** Insertion order. Importance-ordered layout is a possible future refinement but not v2.0.
- **2026-04-29 — O13 (source-doc rendering).** Keep v1.0 header format: `=== SOURCE DOCUMENT: <subtype> — <name> ===`.
- **2026-04-29 — O15 (manual recreate UX).** Right-click Send → "Update cache" / "Create cache" carries forward from v1.0. Stale-cache tooltip offers Update Cache / Send Anyway; both available.
- **2026-04-29 — O17 (token-savings display).** Per-doc tokens + total + estimated per-message saving in Cache Contents modal. Carried forward from v1.0 PRD §7.3.
- **2026-04-29 — O19 (handover-mode cache behaviour).** Handover is uncached. Entering handover does not invalidate or refresh the story cache; the story cache is left alive and is valid on return to story (subject to its own TTL).
- **2026-04-29 — Theater Composition doc.** Doc 27 created. Owns structural / behavioural rules for bubbles, banners, and partitions across all three modes plus accordion. Visual values (specific colours, exact pixels) ⚠️ provisional and deferred to visual design phase.
