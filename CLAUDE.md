# CLAUDE.md — LOOM

## Identity

LOOM is a local-first, privacy-first desktop application for AI-assisted creative writing. It is encrypted, offline-capable, and designed for writers who care about owning their work. Built on Tauri v2 (Rust backend + React frontend), it uses the Gemini API for text generation and SQLCipher for end-to-end encrypted local storage.

This is a passion project. Every line of code, every pixel, every interaction matters. LOOM should feel like a tool made by someone who writes — not a tech demo. Quality is non-negotiable.

---

## Project Structure

```
D:\Proj\LOOM\
├── CLAUDE.md                    ← you are here
├── docs/                        ← PRD documents (00–21), implementation plan
│   ├── 00-Index.md              ← start here for any architectural question
│   ├── 02-Design-System.md      ← visual language, CSS variables, typography
│   ├── 11-App-Lifecycle-and-State-Management.md  ← THE lifecycle doc (01 merged in)
│   ├── 15-Build-and-Release.md  ← tech stack, dependencies, security checklist
│   └── ...
├── src/                         ← React frontend
│   ├── App.tsx                  ← root: 3-phase conditional rendering
│   ├── components/
│   │   ├── auth/                ← LockScreen
│   │   ├── onboarding/          ← OnboardingWizard
│   │   ├── layout/              ← Workspace, PaneDivider, LeftPane, CenterPane, RightPane
│   │   ├── navigator/           ← VaultTree, CreateNewDialog
│   │   ├── theater/             ← InputArea, UserBubble, AiBubble, ReaderView
│   │   ├── modals/              ← SettingsModal, WorldPickerModal, KeyboardShortcutsModal
│   │   ├── overlays/            ← FeedbackOverlay
│   │   ├── empty/               ← NoStorySelected, EmptyStory, EmptyVault, EmptyTrash
│   │   ├── branchmap/           ← BranchMapDrawer, BranchMapNode
│   │   ├── ghostwriter/         ← GhostwriterToolbar, DiffDisplay
│   │   └── editor/              ← DocEditor
│   ├── stores/                  ← Zustand stores
│   │   ├── uiStore.ts
│   │   ├── authStore.ts
│   │   ├── workspaceStore.ts
│   │   ├── vaultStore.ts
│   │   ├── controlPaneStore.ts
│   │   ├── settingsStore.ts
│   │   ├── telemetryStore.ts
│   │   ├── ghostwriterStore.ts
│   │   ├── branchMapStore.ts
│   │   └── accordionStore.ts
│   ├── lib/                     ← utilities
│   │   ├── applyTheme.ts        ← accent color, body font, bubble colors, feature colors
│   │   ├── colorUtils.ts        ← darkenHex, lightenHex, hexWithAlpha
│   │   ├── autoLock.ts
│   │   ├── viewportWatcher.ts
│   │   ├── shortcuts.ts         ← global keyboard shortcut registration
│   │   └── types.ts             ← shared TypeScript interfaces
│   ├── hooks/
│   │   └── useFocusTrap.ts
│   ├── styles/
│   │   ├── globals.css          ← CSS variables (Doc 02), shadcn overrides
│   │   └── fonts.css            ← @font-face declarations (bundled woff2)
│   └── assets/
│       └── fonts/               ← Inter, Lora, JetBrains Mono woff2 files
├── src-tauri/
│   ├── src/
│   │   ├── main.rs              ← Tauri entry, env_logger init
│   │   ├── lib.rs               ← Tauri command registration
│   │   ├── state.rs             ← AppState: master_key, api_key, active_conn, rate_limiter
│   │   ├── error.rs             ← LoomError enum (Doc 14)
│   │   ├── crypto.rs            ← PBKDF2 key derivation, AES-256-GCM sentinel
│   │   ├── config.rs            ← app_config.json read/write/atomic-save
│   │   ├── db.rs                ← SQLCipher open/close, init_schema (all tables)
│   │   ├── world.rs             ← create/list/switch/delete/export/import worlds
│   │   ├── vault.rs             ← item CRUD, move, soft-delete, purge, images
│   │   ├── commands.rs          ← send_message, cancel_generation, edit, delete
│   │   ├── gemini.rs            ← Gemini API client, streaming, request assembly
│   │   ├── history.rs           ← server-side history assembly, feedback injection, accordion substitution
│   │   ├── rate_limiter.rs      ← ProviderCounters, check/record, window logic
│   │   ├── ghostwriter.rs       ← send_ghostwriter_request, diff (or delegate to frontend)
│   │   ├── accordion.rs         ← summarise_segment, collapse/expand
│   │   ├── checkpoints.rs       ← create/rename/delete, orphan cleanup
│   │   ├── export.rs            ← markdown export, JSON export
│   │   ├── image_gen.rs         ← ImageGenerationProvider trait + stubs (v1.1)
│   │   └── tts.rs               ← TtsProvider trait + stubs (v2)
│   ├── Cargo.toml
│   └── tauri.conf.json
└── package.json
```

---

## Architecture — The Rules

These are not suggestions. They are load-bearing walls.

### 1. History assembly is server-side only
The frontend sends `(story_id, leaf_id, user_content)` — nothing more. The Rust backend reconstructs the full branch via Recursive CTE, injects feedback as `[WRITER FEEDBACK]` tags, substitutes collapsed Accordion segments with Fake-Pairs, loads context docs, reads system instructions, and assembles the complete Gemini API request. The frontend never touches history.

### 2. One encrypted database per World
Each World has its own `loom.db` encrypted with SQLCipher (AES-256, key from PBKDF2). Only one database connection is open at a time. World switching closes the current connection and opens another — same master key, different file.

### 3. The master key and API key never touch the frontend
The master key lives in `AppState.master_key` (Rust memory), zeroed on lock/close. The API key lives in `AppState.api_key` and the encrypted `settings` table. Neither appears in localStorage, app_config.json, JavaScript memory, or logs. Ever.

### 4. Key verification uses a sentinel, not a database
`app_config.json` contains an AES-256-GCM encrypted known-plaintext sentinel. Password correctness is verified by decrypting the sentinel — this works even when no World databases exist (all deleted). See Doc 11 §5.3.

### 5. No router library
All routing is pure conditional rendering on `uiStore.appPhase: "onboarding" | "locked" | "workspace"`. No React Router, no TanStack Router. Three states, three components.

### 6. `isGenerating` is global
`workspaceStore.isGenerating` is `true` during ANY AI request — send_message, Ghostwriter, Accordion summarisation. This single flag gates Send button, lock confirmation, and world switch confirmation. Feature-specific flags (e.g., `ghostwriterStore.isGenerating`) are additional, not replacements.

### 7. All fonts bundled locally
No Google Fonts CDN. No external network requests except to the Gemini API. Fonts are woff2 files in `src/assets/fonts/` loaded via `@font-face` in `fonts.css`.

---

## Code Standards

### Rust

- **Edition 2021.** Use idiomatic Rust — `Result<T, LoomError>`, `?` operator, no unwrap() in production paths.
- **Every Tauri command** returns `Result<T, LoomError>`. No panics crossing the IPC boundary.
- **`LoomError`** is the single error type (Doc 14 §1.1). Map external errors via `From` impls.
- **Logging:** Use `log` crate. INFO for lifecycle events, DEBUG for request metadata (IDs, token counts), WARN for approaching limits, ERROR for failures. **Never log** master key, API key, user content, message text, feedback, or document content.
- **Atomic file writes:** Always write to `.tmp` then `fs::rename`. Applies to `app_config.json`, `world_meta.json`, any config file.
- **Key zeroing:** Overwrite `[u8; 32]` with `0x00` before dropping. Use `zeroize` crate or manual fill.
- **SQLCipher:** Use `rusqlite` with `features = ["sqlcipher", "bundled"]`. Always PRAGMA key immediately after opening.
- **Tests:** Unit tests for `crypto.rs`, `rate_limiter.rs`, `history.rs` at minimum. Use in-memory SQLite (non-encrypted) for DB logic tests.

### TypeScript / React

- **Strict mode.** No `any` unless wrapping a third-party type.
- **Zustand stores** per Doc 11 §11. Don't add new stores without clear justification — prefer extending existing ones.
- **Component files** are functional components with hooks. No class components.
- **Styling:** Tailwind utility classes + CSS variables from `globals.css`. Use `cn()` (clsx + tailwind-merge) for conditional classes. Override shadcn/ui defaults with LOOM's design tokens, not inline styles.
- **No localStorage for sensitive data.** Only UI preferences: pane widths, collapsed states, expanded paths, auto-lock timer, export folder, onboarding_complete.
- **Tauri IPC:** All `invoke()` calls wrapped in typed async functions in `src/lib/tauriApi.ts` (or similar). No raw `invoke("command_name", { ... })` scattered through components.
- **Error handling:** Every `invoke()` call has a `.catch()` that surfaces the error via toast, banner, or inline message per Doc 14 §2.

### CSS / Design

- **Read Doc 02 before touching any visual.** It is pixel-precise.
- **Color palette:** `globals.css` CSS variables are the single source of truth. Never hardcode hex values in components.
- **Dark editorial aesthetic.** Minimal chrome, generous typography, writing is the focus. Reference points: Craft dark mode, Bear dark mode, early Linear.
- **Accent color is runtime-computed** from a single hex input. `applyAccentColor()` derives hover, subtle, and text variants. Feature colors (Ghostwriter, Checkpoint, Accordion) track accent by default but can be independently overridden.
- **Type scale** per Doc 02 §3.3. Pane headers 11px uppercase. Prose 15px serif. UI body 13px sans. Don't invent new sizes.
- **Transitions:** 150–300ms ease. Nothing should feel sluggish or jumpy.
- **Empty states are first-class UI** (Doc 03). Every zero-data condition has specified content, styling, and actions. Blank screens are bugs.

---

## PRD Quick Reference

When in doubt, read the PRD. The documents are implementation-ready — they contain
SQL DDL, Rust structs, TypeScript interfaces, CSS snippets, ASCII layouts, and
precise behavioral specs.

| Question | Read |
|---|---|
| How does the app launch? What screens exist? | Doc 11 |
| What does X look like? Colors? Spacing? | Doc 02 |
| What happens when data is empty? | Doc 03 |
| How does onboarding work? | Doc 07 |
| How are messages structured? How does send work? | Doc 09 |
| How does branching/editing/regeneration work? | Doc 09 §7–§8 |
| What settings exist? Defaults? | Doc 05 |
| How does the Control Pane work? Context docs? | Doc 10 |
| How does rate limiting work? | Doc 06 |
| How do errors surface? Error taxonomy? | Doc 14 |
| How does Ghostwriter work? | Doc 16 |
| How does the Branch Map work? Checkpoints? | Doc 17 |
| How does Accordion (context compression) work? | Doc 18 |
| How do image uploads work? | Doc 19 |
| How does Reader View / export work? | Doc 04 |
| What keyboard shortcuts exist? | Doc 13 |
| What Rust crates? What npm packages? | Doc 15 |
| What DB tables exist? Complete schemas? | Doc 15 §7, plus individual docs |
| What Tauri commands exist? | Each doc has a command reference table at the end |
| What is planned for v1.1 / v2? | Doc 20 (image gen stubs), Doc 21 (TTS stubs) |

---

## Implementation Phases

Development follows `docs/loom-implementation-plan.md` — 15 phases, each designed
as a single Claude Code session. Always read the current phase section and its
referenced PRD documents before starting.

**Phase progression rule:** All Testable Checkpoints from the previous phase must
pass before starting the next phase. Fixing regressions from earlier phases takes
priority over starting new features.

---

## Security — Red Lines

These rules cannot be relaxed, deferred, or worked around. Violations are immediate reverts.

1. **Master key** exists only in `AppState` (Rust memory). Zeroed on lock and app close.
2. **API key** exists only in `AppState` and the encrypted `settings` table. Never in localStorage, app_config.json, frontend memory, URL params, or log output.
3. **User content** (message text, feedback, document content) is never logged. Log only IDs and metadata (story_id, token_count, model_name).
4. **app_config.json** never contains the master key, API key, or any user content. Only: PBKDF2 salt, iterations, key sentinel, world directory list.
5. **No external network requests** except to `generativelanguage.googleapis.com` (Gemini API). No analytics, no telemetry, no CDN, no fonts from Google, no update checks.
6. **New PBKDF2 salt + new key sentinel** generated on every password change.
7. **Atomic file writes** for all config files (write .tmp then rename).

---

## MCP Tools Available

Claude Code has access to these MCP servers. Use them.

| Server | Purpose | When to use |
|---|---|---|
| **git** | Git operations on `D:\Proj\LOOM` | Commits, diffs, branch management. Commit after each meaningful unit of work with descriptive messages. |
| **github** | GitHub API | Creating issues, PRs, checking CI if we set up a remote. |
| **memory** | Persistent knowledge graph | Store cross-session context: decisions made, tricky bugs solved, patterns established. Read at session start. |
| **context7** | Up-to-date library documentation | Look up Tauri v2 APIs, rusqlite, Zustand, shadcn/ui, Gemini API. Don't guess — fetch current docs. |
| **fetch** | HTTP fetching | Retrieve docs, check API schemas, download reference material. |
| **playwright** | Browser automation | End-to-end testing of the frontend in the Tauri webview if needed. |

### Git Discipline

- Commit frequently. One logical change per commit.
- Commit messages: imperative mood, reference the phase. Examples:
  - `feat(phase-1): implement PBKDF2 key derivation and sentinel`
  - `feat(phase-6): add streaming Gemini response handler`
  - `fix(phase-4): enforce 5-level max folder nesting depth`
  - `refactor(phase-8): extract theme application into applyTheme.ts`
- Branch per phase: `phase-01-scaffold`, `phase-02-lock-screen`, etc.
- Merge to `main` after phase checkpoint passes.

### Memory Usage

At the start of each session:
1. Read the memory graph for prior context.
2. At the end of each session, store:
   - Key decisions made during the session
   - Tricky implementation details future sessions need
   - Any deviations from the PRD (and why)
   - Patterns or utilities established that should be reused

---

## Common Pitfalls (Read Before Each Phase)

### Rust / Tauri

- **SQLCipher on Windows:** The `bundled` feature compiles OpenSSL from source. First build may take 5+ minutes. If it fails, check that `perl` and `nasm` are on PATH (required for OpenSSL build). Visual Studio Build Tools must be installed with C++ workload.
- **Tauri v2 IPC serialization:** All types crossing the IPC boundary must derive `serde::Serialize` + `serde::Deserialize`. Enums need `#[serde(tag = "type")]` or similar for clean JSON.
- **Mutex in AppState:** Use `Mutex<Option<T>>` for fields that can be absent (e.g., DB connection when locked). Always drop the lock guard before calling other locked methods to avoid deadlocks.
- **Stream cancellation:** Dropping a `reqwest` response stream doesn't immediately cancel the HTTP connection. Use an `AbortHandle` or a `CancellationToken` to properly cancel Gemini streaming.

### React / Frontend

- **Zustand store subscriptions:** Use selectors (`useStore(s => s.field)`) to avoid unnecessary re-renders. Never subscribe to the entire store.
- **shadcn/ui Dialog:** Doesn't unmount children on close by default. If a dialog contains state that should reset on close, use a key prop or reset in an onOpenChange handler.
- **Tailwind class conflicts:** Use `cn()` (clsx + tailwind-merge) everywhere. Raw `className` string concatenation causes class conflicts that silently break styles.
- **Tauri events (streaming):** `listen()` returns an unlisten function. Always clean up in useEffect return. Forgetting this causes memory leaks and ghost listeners.

### Design

- **Bubble max-width:** 80% of Theater width, not a fixed pixel value. This adapts to pane resizing.
- **Section headers:** 11px, Inter 500, uppercase, letter-spacing 0.08em, --color-text-muted. This is consistent across Navigator, Control Pane, Branch Map, Settings.
- **Escape chain:** Priority order is modal > Branch Map > Feedback > Ghostwriter > Editor (dirty) > Editor (clean) > Reader View > no-op. Getting this wrong causes confusing UX. Implement it as a single function with explicit priority checks (Doc 13 §1.1).

---

## Quality Bar

Before considering any phase complete:

1. **Does it compile without warnings?** Both `cargo build` and `tsc --noEmit`.
2. **Do all Testable Checkpoints pass?** Every single one, manually verified.
3. **Are error states handled?** Not just the happy path — what happens when the Gemini call fails? When the DB is locked? When the network is down?
4. **Are empty states rendered?** Not blank screens. Specific messages with specific actions per Doc 03.
5. **Is it visually consistent with Doc 02?** Correct fonts, sizes, colors, spacing. Screenshot-compare if needed.
6. **Are Tauri commands typed?** Frontend has typed wrappers, not raw invoke calls.
7. **Is sensitive data protected?** No keys in logs, no content in error messages, no secrets in localStorage.
8. **Is the code committed?** With a descriptive commit message referencing the phase.

---

## Platform Notes

- **Development OS:** Windows (paths use `D:\Proj\LOOM`)
- **Target platforms:** macOS (arm64 + x86_64), Windows x86_64, Linux x86_64
- **Node.js:** Available at `C:\Program Files\nodejs\`
- **Python/uvx:** Available at `C:\Users\Adrian\.local\bin\`
- **Minimum window:** 1100×700px (enforced in tauri.conf.json)
- **Tauri conf:** See Doc 15 §2 for exact window config

---

## When You're Unsure

1. **Read the PRD.** The answer is almost certainly in there. Start with Doc 00 (Index) to find the right document.
2. **Use context7** to fetch current docs for Tauri v2, rusqlite, Zustand, Gemini API, or any dependency.
3. **Check memory** for decisions made in prior sessions.
4. **Ask.** If a PRD is ambiguous or contradictory, flag it rather than guessing. The worst outcome is a silent assumption that compounds across phases.

LOOM deserves to be built right.
