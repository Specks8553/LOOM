# CLAUDE.md — LOOM 2.0

## Identity

LOOM is a local-first, privacy-first desktop application for AI-assisted creative writing. It is encrypted, offline-capable, and designed for writers who care about owning their work. Built on Tauri v2 (Rust backend + React 19 frontend), it uses the Gemini API for text generation and SQLCipher for end-to-end encrypted local storage.

LOOM 2.0 is a clean rewrite — not a migration — of LOOM 1.0. The goals, in priority order: **maintainability** (no 3,000-line `lib.rs`, no junk-drawer stores), **extensibility** (new modes and providers are additive, never structural), **drop unused weight** (branching is gone — the DAG, sibling navigation, Branch Map, and fork-spanning Accordion all go), **add what's missing** (Context Caching as a first-class feature; a Modes system — story / handover / consulting — replacing ad-hoc system-instruction switching).

This is a passion project. Every line of code, every pixel, every interaction matters. LOOM should feel like a tool made by someone who writes — not a tech demo. Quality is non-negotiable.

***

## Session-start ritual

Read these four files **before doing anything else**, in order:

1. **`CLAUDE.md`** (this file) — rules of the game.
2. **`docs-v2/00-INDEX.md`** — decision log + doc map. Skim the D-NN umbrella table; deep-read the entries relevant to the current phase.
3. **`docs-v2/IMPLEMENTATION-PLAN.md`** — find the current phase (`Status:` field at the top of each phase block). Read its Testable Checkpoints and `Resumption notes:` if any prior session left them.
4. **`docs-v2/PRE-IMPLEMENTATION-AUDIT.md`** — scan for unticked items in the surface you're about to touch.

Then per task: read the spec doc(s) the phase references. The PRD lookup table below is the index.

***

## Project structure

```
D:\Proj\LOOM2\
├── CLAUDE.md                          ← you are here
├── .claude/
│   ├── commands/
│   │   ├── phase-start.md             ← /phase-start workflow
│   │   ├── phase-verify.md            ← /phase-verify workflow
│   │   └── audit-resolve.md           ← /audit-resolve <ID> workflow
│   └── rules/                         ← (carried forward from v1; updated as Doc 24 lands)
├── docs-v2/                           ← all planning docs (the spec)
│   ├── 00-INDEX.md                    ← decision log
│   ├── COWORKING.md                   ← design-session rhythm (planning agents)
│   ├── HANDOVER.md                    ← planning-phase orientation
│   ├── IMPLEMENTATION-PLAN.md         ← phased plan; current Status per phase
│   ├── PRE-IMPLEMENTATION-AUDIT.md    ← live reconciliation checklist
│   ├── IMPROVEMENT-BACKLOG.md         ← substrate / maintainability backlog
│   ├── IMPL-NOTES.md                  ← decisions deferred to implementation time
│   ├── V1-LESSONS.md                  ← v1 anti-patterns and v2 mitigations
│   ├── foundation/                    ← Docs 01–03 (immutable; versioning required to change)
│   ├── architecture/                  ← Docs 04–07
│   ├── design/                        ← Docs 08–12, 27
│   ├── features/                      ← Docs 13–23 (one per feature)
│   ├── dev/                           ← Docs 24–26 (standards, testing, build)
│   └── future/                        ← v2.1+ designs captured but not built
├── src/                               ← React frontend
├── src-tauri/src/                     ← Rust backend
└── package.json
```

The repo lives at `D:\Proj\LOOM2\`. Auto-memory for this project lives at `C:\Users\Adrian\.claude\projects\D--Proj-LOOM2\memory\` — the v1 memory dir at `D--Proj-LOOM\memory\` is read-only historical reference.

***

## Authority — where decisions live

| Question | Source of truth |
|---|---|
| Why does X work this way? | `00-INDEX.md` D-NN umbrella entries |
| What's the schema for X? | `foundation/03-data-model.md` |
| What does X look like / behave like? | The feature doc that owns X (see PRD lookup) |
| What's still undecided / drifted? | `PRE-IMPLEMENTATION-AUDIT.md` (open `- [ ]` items) and `TODO.md` |
| What rules govern code style? | `dev/24-coding-standards.md` (drafted in Phase 0) + `.claude/rules/` |
| What's coming in v2.1, not v2.0? | `future/` and the "Out of Scope" section of each feature doc |
| What did v1 get wrong that v2 must avoid? | `V1-LESSONS.md` |

If two docs disagree, **one of them is wrong.** Don't pick a side silently — open `PRE-IMPLEMENTATION-AUDIT.md`, check whether the contradiction is already known, and if not, flag it before continuing.

### PRD lookup table

| Question | Read |
|---|---|
| What's the vision? Tone? Principles? | Doc 01 |
| What are the security red lines? Key lifecycle? | Doc 02 |
| What's the schema? Settings keys? IPC interfaces? | Doc 03 |
| How does the app launch? Subsystem map? | Doc 04 |
| How is the Rust backend structured? Modules? | Doc 05 |
| How is the frontend structured? Stores? | Doc 06 |
| What Tauri commands exist? Events? | Doc 07 |
| Design tokens? CSS variables? | Doc 08 |
| Component primitives? | Doc 09 |
| Layout? Pane composition? Content switching? | Doc 10 |
| Keyboard shortcuts? Escape chain? Selection? | Doc 11 |
| Empty states? Error display rules? | Doc 12 |
| Onboarding? Lock screen? Auth? | Doc 13 |
| World CRUD? Vault tree? World backup? | Doc 14 |
| Conversation engine? Send/edit/regenerate/cancel? | Doc 15 |
| Accordion (context compression)? Checkpoints? | Doc 16 |
| Ghostwriter (targeted revision)? | Doc 17 |
| Source documents? DocEditor? Templates? | Doc 18 |
| Image upload? File API cache? | Doc 19 |
| Settings? Theming? Internal prompts? | Doc 20 |
| Export? Reader View? | Doc 21 (deferred to v2.0.x) |
| Context caching? TTL? Stale triggers? | Doc 22 |
| Modes (story / handover / consulting)? Sessions? | Doc 23 |
| Coding standards? | Doc 24 (Phase 0) |
| Testing strategy? | Doc 25 (drafted before first feature commit) |
| Build / packaging / signing? | Doc 26 (drafted before first release) |
| Theater composition? Bubble structure? Banners? | Doc 27 |

***

## Architecture — load-bearing walls

These are not suggestions. Violations require an immediate revert before anything else proceeds.

### 1. History assembly is server-side only
The frontend sends `(story_id, session_id?, user_content)` — nothing more. The Rust backend reconstructs the full thread, applies modes (Doc 23), substitutes Accordion fake-pairs (Doc 16), injects feedback, attaches source documents (Doc 18), and assembles the complete Gemini request. **The frontend never touches history.**

### 2. One encrypted database per World
Each World has its own `loom.db` encrypted with SQLCipher (AES-256, master key). Only one world connection is open at a time (`AppState.active_conn`). The app-level `app_settings.db` (also SQLCipher, same master key) is open whenever the vault is unlocked, regardless of active world.

### 3. The master key and API key never touch the frontend
The master key lives in `AppState.master_key` (Rust memory), zeroed on lock and app close. The API key lives in `AppState.api_key` and the `app_settings.db` `app_settings` table. **Neither appears in localStorage, `app_config.json`, JavaScript memory, or logs. Ever.** (Doc 02 §Red Lines.)

### 4. Key verification uses a sentinel, not a database
`app_config.json` contains an AES-256-GCM encrypted known-plaintext sentinel. Password correctness is verified by decrypting the sentinel — works even when no World databases exist. (Doc 13.)

### 5. No router library
All routing is conditional rendering on `appStore.appPhase: "onboarding" | "locked" | "workspace"`. Three states, three components.

### 6. `isGenerating` is global
A single `workspaceStore.isGenerating` flag covers story sends, session sends (handover, consulting), accordion summarisation, and ghostwriter requests. **One model call in flight at a time across the whole app.** (D-08, D-12, D-14.)

### 7. Modes are first-class, not flags
`messages.kind ∈ {'story','handover','consulting'}` and `conversation_sessions` rows are the storage primitive. Story has one implicit thread per story (`session_id IS NULL`); handover and consulting use multiple sessions per story. Adding a fourth mode in the future = new enum value + new persona SI; no structural changes. (Doc 23, D-10.)

### 8. Caching is per-story (story mode) or per-session (consulting)
Story cache lives on `cache_state` (one row per story). Consulting cache lives on the `conversation_sessions` row. Handover never caches. Story cache and active consulting cache coexist; they never share. (Doc 22, D-11.)

### 9. No branching, no DAG, no sibling navigation
Messages are linear, ordered by `created_at`. Edit + regenerate = truncate-and-replace within scope (story-kind for story edits; session-scope for session edits). v2.0 hard-deletes; v2.1 will add reversible undo per `future/undo-redo.md` (D-09).

### 10. All fonts bundled locally
No external network requests except to `generativelanguage.googleapis.com`. CSP enforces this (`connect-src 'none'` in the WebView; Doc 04). Fonts are woff2 files in `src/assets/fonts/`.

***

## Security — Red Lines

Cannot be relaxed, deferred, or worked around. Any task that would violate these must be stopped and redesigned.

1. **Master key** lives only in `AppState.master_key` (Rust). Zeroed on lock and app close.
2. **API key** lives only in `AppState.api_key` and `app_settings.db`. Never in `localStorage`, `app_config.json`, frontend memory, URL params, or log output.
3. **User content** (message text, feedback, document content, draft fields) is never logged. Log only IDs and metadata.
4. **`app_config.json`** never contains the master key, API key, or any user content. Plaintext but content-empty.
5. **No external network requests** except to `generativelanguage.googleapis.com`. Enforced by CSP.
6. **New PBKDF2 salt + new key sentinel** generated on every password change. (200,000 iterations, 32-byte salt, HMAC-SHA256.)
7. **Atomic file writes** for all config files (write `.tmp`, then `fs::rename`).

***

## The phase model

Implementation work follows `docs-v2/IMPLEMENTATION-PLAN.md`. Each phase is a coherent unit of work — typically one session, **but a phase may span multiple sessions** when the surface is large or the day is short.

Phase state lives in the plan file itself:

- Each phase has a `Status:` line at its top: `Not started | In progress (last touched YYYY-MM-DD) | Complete`.
- Each phase has Testable Checkpoints as `- [ ]` boxes. As you complete a checkpoint, tick it.
- A phase has a `Resumption notes:` subsection. **Update it live as you work — do not save it for end-of-session.** Sessions can end abruptly (crashes, context limits, user interrupts), and a notes block written only at the end is a notes block that often never gets written. The rhythm: whenever you finish a checkpoint, hit a non-trivial decision, leave something half-done, or pause to investigate, append a one-liner immediately. At natural session-end you tidy the block (consolidate, drop superseded lines); you do not write it from scratch.

**Phase progression rule:** All Testable Checkpoints from the previous phase must pass (`/phase-verify` clean) before starting the next phase.

### How to start a phase

Type `/phase-start`. The command (defined in `.claude/commands/phase-start.md`) walks you through:

1. Read `IMPLEMENTATION-PLAN.md`, find the current phase.
2. Identify all docs the phase references; read them.
3. Identify open audit items (`PRE-IMPLEMENTATION-AUDIT.md`) that touch this surface — **resolve any unticked Hard Blocker (HB-*) before continuing**.
4. Draft the implementation plan for the phase; present it to the user.
5. Implement. Tick checkpoints as you go. **Update `Resumption notes:` live** — append a line whenever you finish a checkpoint, hit a non-trivial decision, or leave something half-done. Never save the notes for end-of-session; sessions end abruptly.

### How to verify a phase

Type `/phase-verify`. The command walks the Testable Checkpoints, reports pass/fail, and flags anything incomplete. Phase is not complete until verify is clean.

### How to resolve an audit item

Type `/audit-resolve HB-3` (or whichever ID). The command (defined in `.claude/commands/audit-resolve.md`) walks you through:

1. Read the item from `PRE-IMPLEMENTATION-AUDIT.md`.
2. Open the owner doc(s); make the edits the resolution lean prescribes (or push back if the lean is wrong).
3. Propagate per `COWORKING.md` §6 — date-stamp every amended doc; update `00-INDEX.md` if the resolution warrants a new D-NN.
4. Tick the box in the audit file.
5. Append a one-line entry to the §Resolution log at the bottom.

***

## Audit enforcement (non-negotiable)

`PRE-IMPLEMENTATION-AUDIT.md` lists every contradiction the cross-doc audit found at the close of the planning phase.

**Any feature work whose Hard Blocker (HB-*) is unticked is a bug. Stop, resolve the blocker, then continue.** Soft Blockers (SB-*) are required for substrate (Phase 0); Cross-Doc inconsistencies (CD-*) and Schema/IPC drift (SD-*, IP-*) must be resolved before the touching feature ships.

If a Hard Blocker turns out to be wrong, tick it with `(YYYY-MM-DD — wrong call: <reason>)`. Do not silently skip.

***

## Substrate-first rule

Phase 0 is **not optional and not negotiable**. It lands the tooling that prevents v1.0-style drift from recurring:

- **R2** — typed `AppSettingKey` / `StoryStateKey` enums (no string keys for settings access).
- **R3** — ESLint `no-cross-store-imports` rule.
- **R4** — `ts-rs` for TypeScript type generation from Rust structs.
- **R7** — cancellation token lifecycle (`tokio_util::CancellationToken`, per-request).
- **R17** — lock-access helpers (`with_active_conn`, etc. — no raw `.lock()` on `AppState` fields).
- **R18** — versioned schema migrations (numbered SQL files in `db/migrations/`).
- **Doc 24** — coding standards drafted in Phase 0; rules above are codified there.

No feature command is written before Phase 0 is `/phase-verify`-clean.

***

## Forbidden patterns (v1 lessons codified)

These produce v1.0's pain. Each is grounds for revert.

- **`// Phase X` comments in source code.** v1's `lib.rs` has them. They prove features were appended without architectural refactor. Any PR that adds one must remove it.
- **Raw `.lock()` on `AppState` fields.** Use the helpers (R17). v1 had 118 occurrences of the four-line lock-and-format-error idiom.
- **String keys for settings access.** Use `AppSettingKey` / `StoryStateKey` enums (R2). v1 had 45 raw `SELECT value FROM settings WHERE key = '...'` occurrences.
- **Cross-store imports.** Stores never import other stores. Compose in components or hooks. (R3, Doc 06.)
- **Components > 600 lines without explicit justification in the PR.** v1 has ten over 600 (largest: `SettingsModal.tsx` at 2,267). (R19, Doc 24.)
- **Hex values in components.** Use design tokens (`var(--color-accent)`). (Doc 06, Doc 08.)
- **Hardcoded model names** (e.g. `"gemini-2.5-flash"` as fallback in code). Live in `app_settings` with typed accessors.
- **Raw `invoke("command", { ... })`** scattered through components. Use typed wrappers in `src/lib/tauriApi/<domain>.ts`.
- **Master key, API key, or user content in logs.** Ever. Log IDs and metadata only.
- **Master key, API key, or user content in `localStorage`.** localStorage is for UI ephemera (pane widths, expanded folders, `onboarding_complete`).
- **Master key, API key, or user content in `app_config.json`.** Plaintext file; content-empty by definition.
- **`unwrap()` in production paths.** Use `Result<T, LoomError>` and the `?` operator.
- **Bypassing pre-commit hooks** (`--no-verify`, `--no-gpg-sign`). If a hook fails, fix the underlying issue.

***

## How work flows in a session

- **Use TodoWrite to plan and track work** within a session. Mark each task complete as soon as it's done; don't batch.
- **Sub-agents for parallel exploration.** When a task needs broad codebase searching or multi-file research, spawn an `Explore` or `general-purpose` agent. Don't duplicate work the sub-agent is doing.
- **Numbered questions when ambiguity blocks you.** Q1, Q2, … with a lean per question. Apply answers literally.
- **Apply edits immediately.** When a decision lands, edit the docs/code in the same turn. Confirm at the end with a brief summary.
- **Date-stamp every amended doc's header.** Add a "Last updated" line; preserve the prior one as "Earlier:".
- **Atomic commits per logical change.** One commit per checkpoint where reasonable. Commit messages reference the phase and checkpoint.

***

## MCP tools available

| Server | Use when |
|---|---|
| **git** | Reviewing diffs, branch state, history |
| **github** | Issues, PRs, CI status |
| **memory** | Cross-session context — check at session start |
| **context7** | Library docs (Tauri v2, rusqlite, Zustand, shadcn/ui, Gemini API). Prefer over web search for any library question. |
| **fetch** | One-off HTTP fetches |
| **playwright** / **Claude Preview** | Browser automation, dev-server verification |
| **serena** | Project-aware symbol navigation |

Sub-agents (`Explore`, `general-purpose`, `Plan`) for parallel research. The `Agent` tool spawns them; brief them like a smart colleague who walked into the room cold (per the tool's own instructions).

***

## Quality bar — definition of done

Before marking a phase complete:

1. **Compiles without warnings.** Both `cargo build` and `tsc --noEmit`.
2. **All Testable Checkpoints pass.** Every single one, manually verified via `/phase-verify`.
3. **Lints clean.** `cargo clippy`, `pnpm lint` — no new warnings.
4. **Tests pass** for any module the phase touched. (Test plan per Doc 25; integration tests use in-memory SQLite.)
5. **Error states handled.** Not just the happy path — what happens when the Gemini call fails, the DB is locked, the network is down? (Doc 12 maps `LoomError` variants to display rules.)
6. **Empty states rendered.** Per Doc 12. Blank screens are bugs.
7. **Visually consistent with Docs 02 / 08 / 27.** Correct fonts, sizes, colors, spacing. No hex in components.
8. **Tauri commands typed.** Frontend uses typed wrappers in `src/lib/tauriApi/<domain>.ts`, never raw `invoke`.
9. **Sensitive data protected.** No keys in logs, no content in error messages, no secrets in `localStorage`.
10. **Audit items relevant to this phase ticked.** No unresolved HB-* on this phase's surface.
11. **Code committed.** Descriptive messages referencing the phase and checkpoint.

***

## Platform notes

- **Development OS:** Windows. Repo at `D:\Proj\LOOM2\`. Use Unix shell syntax in Bash (`/dev/null`, forward slashes); PowerShell available where it fits better.
- **Target platforms:** macOS (arm64 + x86_64), Windows x86_64, Linux x86_64.
- **Minimum window:** 1100×700px (enforced in `tauri.conf.json`). Auto-collapse Control Pane below 1200px.
- **Windows OpenSSL setup:** `OPENSSL_DIR="C:/Users/Adrian/scoop/apps/openssl/current"` must be set for cargo. SQLCipher's `bundled` feature compiles OpenSSL from source on first build (~5 min).
- **Lucide-react:** pinned to `0.400.0` exactly (compatibility with shadcn/ui generation).

***

## When you're unsure

1. **Read the spec.** Find the doc via the PRD lookup table. The docs are implementation-ready — they contain SQL DDL, Rust structs, TypeScript interfaces, CSS snippets, ASCII layouts, and precise behavioural specs.
2. **Use context7** to fetch current docs for any dependency.
3. **Check memory** for decisions from prior sessions.
4. **Check `PRE-IMPLEMENTATION-AUDIT.md`** to confirm the surface isn't already known to be drifted.
5. **Ask.** If a spec is ambiguous or two docs disagree, flag it as `Q1, Q2, …` rather than guessing.

LOOM 2.0 deserves to be built right. Every line of code, every pixel, every interaction matters.
