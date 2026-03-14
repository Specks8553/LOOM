# CLAUDE.md — LOOM

## Identity

LOOM is a local-first, privacy-first desktop application for AI-assisted creative writing. It is encrypted, offline-capable, and designed for writers who care about owning their work. Built on Tauri v2 (Rust backend + React frontend), it uses the Gemini API for text generation and SQLCipher for end-to-end encrypted local storage.

This is a passion project. Every line of code, every pixel, every interaction matters. LOOM should feel like a tool made by someone who writes — not a tech demo. Quality is non-negotiable.

---

## Project Structure

```
D:\Proj\LOOM\
├── CLAUDE.md                    ← you are here
├── .claude/
│   ├── rules/code-standards.md  ← Rust, TypeScript, CSS standards
│   ├── rules/pitfalls-and-reference.md ← PRD lookup table, pitfalls, quality bar
│   ├── commands/phase-start.md  ← /phase-start workflow
│   └── commands/phase-verify.md ← /phase-verify workflow
├── docs/                        ← PRD documents (00–21), implementation plan
│   ├── 00-Index.md              ← start here for any architectural question
│   └── ...                      ← see rules/pitfalls-and-reference.md for PRD lookup
├── src/                         ← React frontend
│   ├── App.tsx                  ← root: 3-phase conditional rendering
│   ├── components/              ← auth, onboarding, layout, navigator, theater, modals, etc.
│   ├── stores/                  ← Zustand: uiStore, authStore, workspaceStore, vaultStore, etc.
│   ├── lib/                     ← tauriApi.ts, types.ts, applyTheme.ts, shortcuts.ts, etc.
│   ├── hooks/                   ← useFocusTrap.ts, etc.
│   └── styles/                  ← globals.css (CSS variables), fonts.css
├── src-tauri/src/               ← Rust backend
│   ├── lib.rs                   ← Tauri command registration
│   ├── state.rs                 ← AppState: master_key, api_key, active_conn, rate_limiter
│   ├── crypto.rs, config.rs, db.rs, world.rs, vault.rs, commands.rs, gemini.rs, etc.
│   └── error.rs                 ← LoomError enum (Doc 14)
└── package.json
```

---

## Architecture — The Rules

These are not suggestions. They are load-bearing walls.

### 1. History assembly is server-side only
The frontend sends `(story_id, leaf_id, user_content)` — nothing more. The Rust backend reconstructs the full branch via Recursive CTE, injects feedback, substitutes Accordion segments, loads context docs, and assembles the complete Gemini API request. The frontend never touches history.

### 2. One encrypted database per World
Each World has its own `loom.db` encrypted with SQLCipher (AES-256, key from PBKDF2). Only one database connection is open at a time. World switching closes the current connection and opens another.

### 3. The master key and API key never touch the frontend
The master key lives in `AppState.master_key` (Rust memory), zeroed on lock/close. The API key lives in `AppState.api_key` and the encrypted `settings` table. Neither appears in localStorage, app_config.json, JavaScript memory, or logs. Ever.

### 4. Key verification uses a sentinel, not a database
`app_config.json` contains an AES-256-GCM encrypted known-plaintext sentinel. Password correctness is verified by decrypting the sentinel — this works even when no World databases exist.

### 5. No router library
All routing is pure conditional rendering on `uiStore.appPhase: "onboarding" | "locked" | "workspace"`. Three states, three components.

### 6. `isGenerating` is global
`workspaceStore.isGenerating` is `true` during ANY AI request. This single flag gates Send button, lock confirmation, and world switch confirmation.

### 7. All fonts bundled locally
No external network requests except to the Gemini API. Fonts are woff2 files in `src/assets/fonts/`.

---

## Security — Red Lines

These rules cannot be relaxed, deferred, or worked around. Violations are immediate reverts.

1. **Master key** exists only in `AppState` (Rust memory). Zeroed on lock and app close.
2. **API key** exists only in `AppState` and the encrypted `settings` table. Never in localStorage, app_config.json, frontend memory, URL params, or log output.
3. **User content** (message text, feedback, document content) is never logged. Log only IDs and metadata.
4. **app_config.json** never contains the master key, API key, or any user content.
5. **No external network requests** except to `generativelanguage.googleapis.com` (Gemini API).
6. **New PBKDF2 salt + new key sentinel** generated on every password change.
7. **Atomic file writes** for all config files (write .tmp then rename).

---

## Implementation Phases

Development follows `docs/loom-implementation-plan.md` — 15 phases, each designed as a single Claude Code session. Always read the current phase section and its referenced PRD documents before starting.

**Phase progression rule:** All Testable Checkpoints from the previous phase must pass before starting the next phase.

Use `/phase-start` and `/phase-verify` commands for standardized phase transitions.

---

## MCP Tools Available

| Server | Purpose | When to use |
|---|---|---|
| **git** | Git operations | Commits, diffs, branch management |
| **github** | GitHub API | Issues, PRs, CI |
| **memory** | Knowledge graph | Cross-session context |
| **context7** | Library docs | Tauri v2, rusqlite, Zustand, shadcn/ui, Gemini API |
| **fetch** | HTTP fetching | Docs, API schemas |
| **playwright** | Browser automation | E2E testing |

### Git Discipline

- Commit frequently. One logical change per commit.
- Commit messages: imperative mood, reference the phase (e.g., `feat(phase-4b): add vault tree navigator`)
- Branch per phase, merge to `main` after checkpoint passes.

---

## Platform Notes

- **Development OS:** Windows (paths use `D:\Proj\LOOM`)
- **Target platforms:** macOS (arm64 + x86_64), Windows x86_64, Linux x86_64
- **Minimum window:** 1100×700px (enforced in tauri.conf.json)

---

## When You're Unsure

1. **Read the PRD.** Start with Doc 00 (Index). See `.claude/rules/pitfalls-and-reference.md` for the full lookup table.
2. **Use context7** to fetch current docs for any dependency.
3. **Check memory** for decisions made in prior sessions.
4. **Ask.** If a PRD is ambiguous, flag it rather than guessing.

LOOM deserves to be built right.
