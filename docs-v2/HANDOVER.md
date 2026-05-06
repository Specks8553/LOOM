# LOOM 2.0 — Session Handover

> **Last updated:** 2026-04-27
> **Read this first.** Then `00-INDEX.md`, then `TODO.md`. Then start work.

---

## What we are doing

We are writing the **complete planning specification for LOOM 2.0** in `docs-v2/`. The agent that implements LOOM 2.0 will read these docs and only these docs — they must be precise, internally consistent, and complete enough that the implementor never has to guess.

**LOOM 2.0 is a clean rewrite of LOOM 1.0**, not a migration. The goals, in priority order:

1. **Maintainability** — eliminate the v1.0 problems: a 3,379-line `lib.rs`, 87 sprawling Tauri commands, stores that accumulated unrelated concerns.
2. **Extensibility** — new features (especially new modes, new generation providers) must be additive. No structural change to existing code when adding the next thing.
3. **Drop unused weight** — branching is removed. The DAG, Recursive CTE, Branch Map, sibling navigation, and fork-spanning Accordion all go.
4. **Add what's missing** — Context Caching (already prototyped in v1.0) becomes a first-class feature; a Modes system (story / handover / consulting) replaces ad-hoc system-instruction switching.

LOOM 2.0 keeps everything else: local-first, privacy-first, encrypted-at-rest, dark-only, desktop-only, Gemini-only for text.

---

## What is important to the user

These are the load-bearing preferences. Violating any of them is a bug, not a style choice.

- **Documentation must be precise and concise.** No filler, no hedging, no repeated explanations across files. Each fact lives in one place; other docs reference it.
- **Cross-doc consistency is non-negotiable.** If two docs disagree, one of them is wrong — not "both perspectives valid." The consultant pass on 2026-04-27 reconciled a large batch of these; do not re-introduce drift.
- **Question everything.** The user explicitly invited pushback on architecture, schema, and product decisions. When something seems off, raise it before writing more docs on top of it. Number questions (Q1, Q2…) and ask rather than guess.
- **Security red lines are immovable.** Master key and API key never touch the frontend, never appear in logs, never go in `app_config.json` or localStorage. See `foundation/02-security-model.md`.
- **Aesthetic and craft matter.** This is a writing instrument, not a tech demo. Empty states are atmospheric. Errors are graceful. Animations are short and purposeful. Doc 01 captures the tone.
- **No code yet.** This phase is documentation only. The implementor agent will write code from these docs in a later phase.

---

## Where things are

```
docs-v2/
├── 00-INDEX.md              ← decision log + doc map; check first
├── HANDOVER.md              ← you are here
├── TODO.md                  ← open questions + next session focus
├── IMPL-NOTES.md            ← things deferred to implementation time
├── foundation/              ← immutable; changes need versioning
│   ├── 01-vision-and-principles.md   Complete
│   ├── 02-security-model.md          Complete
│   └── 03-data-model.md              Complete (consulting table pending)
├── architecture/            ← stable once settled
│   ├── 04-system-overview.md         Complete
│   ├── 05-backend-modules.md         Complete
│   ├── 06-frontend-architecture.md   Complete
│   └── 07-ipc-contracts.md           Format complete; fills in per feature doc
├── design/                  ← single source of truth for visuals
│   ├── 08-design-tokens.md           Complete (values provisional ⚠️)
│   ├── 09-component-library.md       Complete (visuals provisional ⚠️)
│   ├── 10-layout-and-navigation.md   Complete
│   ├── 11-interaction-patterns.md    Complete (shortcuts deferred)
│   └── 12-empty-states-and-errors.md Complete (copy provisional ⚠️)
├── features/                ← one doc per feature; mostly stubs
│   ├── 13-auth-and-onboarding.md     Complete
│   ├── 14-vault-and-worlds.md        Complete
│   ├── 15–22                          Stubs
│   └── 23-modes.md                   Stub — NEXT SESSION FOCUS
├── dev/                     ← stubs; for contributors later
│   ├── 24-coding-standards.md
│   ├── 25-testing-strategy.md
│   └── 26-build-and-release.md
└── Info/                    ← reference material (e.g. Gemini caching docs)
```

---

## Locked decisions you must not relitigate

These are settled. Read the rationale in `00-INDEX.md` before challenging.

| ID | Decision |
|---|---|
| D-01 | Tech stack: Tauri v2 + Rust + SQLCipher + React 19 + Zustand 5 + Tailwind v4 + shadcn/ui + Vite 7 + Sonner |
| D-02 | Gemini for text. Image/audio behind a `GenerationProvider` trait. Providers TBD. |
| D-03 + D-03-B | Seven Zustand stores: app, auth, vault, workspace, settings, mode, **cache** |
| D-03-A | API key + app-level settings live in a separate `app_settings.db`. World `settings` is overrides-only. `story_state` is operational state only. |
| D-04 | Backend layout: `commands/` (thin) → `services/` (logic) → `db/` + `security/`. `lib.rs` is registration-only. |
| D-05 | v2.0 = v1.0 features minus branching, plus Context Caching, plus Modes |
| D-06 | Tailwind v4 + shadcn/ui. Components reference design tokens only. No hex in components. |
| D-07 | Master key persists in `AppState` across world switches. Zeroed only on lock/close. |

---

## Next session focus — Modes (Doc 23)

This is the largest open item. `docs-v2/TODO.md` opens with a "NEXT SESSION — Modes" block listing the scope.

**Three modes to specify:**
1. **Story** — default; output is story prose; AI never breaks character. Conversation engine from Doc 15 (also a stub).
2. **Handover** — analyst persona; one-shot structured report about the story; output included in story export (per B-8 decision); not cached.
3. **Consulting** — editor/consultant persona for meta-discussion. Six open design questions (Q1–Q6 in TODO.md) must be answered before this can be specified.

**Cross-cutting items the Modes session must cover:**
- Mode switcher UI placement (header / right pane / mode-specific shell)
- What persists across a switch vs. what resets
- Switching during in-flight generation (cancel / queue / block)
- Confirm consulting messages live in `mode_conversations` (separate table) once Q1/Q4 land
- Update `messages.kind` enum docs once the consulting persistence model is decided

**Suggested approach:**
1. Walk through Q1–Q6 with the user (consulting); record decisions in `00-INDEX.md` as a new D-08 (or similar).
2. Draft Doc 23 in full — story / handover / consulting subsections, mode switcher spec, layout deltas referencing Doc 10.
3. Update Doc 03 with the `mode_conversations` schema once known.
4. Backfill Doc 07 mode commands with full signatures.

After Modes, the next priorities are Doc 15 (Conversation Engine), Doc 22 (Context Caching), and Doc 16 (Accordion) — all currently stubs, all referenced heavily by Modes.

---

## Working rhythm with the user

- **Numbered questions, not narrative.** When ambiguity blocks you, list Q1, Q2… and stop.
- **One decision at a time when needed.** The user often answers in flight ("A1 make this decision and give a short concise explanation"). Be ready to decide *and* explain *and* apply.
- **Apply edits immediately.** Don't draft a plan and wait — when a decision is made, edit the docs in the same turn. Confirm at the end with a brief summary.
- **Update timestamps and the consultant-pass note** in each touched doc's header. Future readers need to see what changed when.
- **Memory.** The user's memory system is at `C:\Users\Adrian\.claude\projects\D--Proj-LOOM\memory\`. The `MEMORY.md` index is loaded at session start. Update it when something cross-session matters; don't write project-state snapshots there (those live in `docs-v2/`).

---

## Provisional values you will see ⚠️

Several design tokens, copy strings, and font/size choices are marked ⚠️ — they are good enough to plan with and will be tuned in a dedicated visual design pass. Do not block on them. If a stub doc requires a number, use the provisional value from Doc 08 / Doc 12 verbatim and mark it ⚠️ if you invent anything new.

---

## What this file is not

- Not a status report — `00-INDEX.md` and per-doc Status fields hold that.
- Not a TODO list — `TODO.md` does.
- Not architecture — the `architecture/` folder does.

This file is **only** the orientation a fresh agent needs to walk in cold and pick up where the last session left off.
