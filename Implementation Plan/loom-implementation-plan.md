# LOOM — Implementation Plan for Claude Code

**Date:** 2026-03-12  
**Execution:** Claude Code (single-session phases)  
**Source Documents:** PRD Docs 00–21 (post-review revision)  
**Total Phases:** 14  

---

## How to Use This Plan

Each phase is designed as a **self-contained Claude Code session**. At the start
of each session, provide Claude Code with:

1. This implementation plan (the current phase section)
2. The relevant PRD documents listed in the phase header
3. Access to the existing codebase (from prior phases)

Each phase ends with a **Testable Checkpoint** — a concrete list of things the
developer can verify in the running application before proceeding to the next phase.

---

## Dependency Graph (Read Order)

```
Phase 1: Project Scaffold + Crypto Foundation
    │
Phase 2: Lock Screen + Unlock Flow
    │
Phase 3: Onboarding Wizard
    │
Phase 4: World Management + Vault Tree
    │
Phase 5: Three-Pane Layout + Navigation Shell
    │
Phase 6: Conversation Engine (Send + Stream + Display)
    │
Phase 7: Branching, Editing, Regeneration
    │
Phase 8: Settings Modal + Theming
    │
Phase 9: Control Pane + Context Docs + Feedback
    │
Phase 10: Rate Limiting + Telemetry
    │
Phase 11: Source Document Editor + Templates
    │
Phase 12: Ghostwriter
    │
Phase 13: Branch Map + Checkpoints
    │
Phase 14: Accordion (Context Compression)
    │
Phase 15: Reader View, Export, Image Uploads, Polish
```

---

## Phase 1 — Project Scaffold + Crypto Foundation

**Goal:** A compiling Tauri v2 project with SQLCipher, PBKDF2 key derivation,
AES-256-GCM key sentinel, app_config.json management, and world database
creation. No UI beyond a placeholder window.

**PRD References:** Doc 11 (§5, §12), Doc 15 (full), Doc 07 (§4)

### Tasks

**1.1 — Tauri v2 Project Initialization**
- `npm create tauri-app` with React + TypeScript + Vite template
- Configure `tauri.conf.json`: window title "LOOM", size 1280×800, min 1100×700
- Bundle identifier: `com.loom.app`
- Install all frontend dependencies per Doc 15 §6:
  react 19, zustand, lucide-react, marked, sonner, clsx, tailwind-merge
- Install all Tailwind + shadcn/ui setup
- Configure TypeScript strict mode

**1.2 — Rust Crate Dependencies**
- Add all crates per Doc 15 §5:
  rusqlite (with sqlcipher + bundled), tokio, reqwest, pbkdf2, sha2, rand,
  chrono, chrono-tz, thiserror, serde, serde_json, uuid, log, env_logger,
  aes-gcm, hex
- Verify `cargo build` succeeds on all crates (especially sqlcipher bundled)

**1.3 — LoomError Type**
- Create `src-tauri/src/error.rs`
- Implement full `LoomError` enum per Doc 14 §1.1
- Derive `thiserror::Error`, `serde::Serialize`

**1.4 — App Config + Key Derivation**
- Create `src-tauri/src/crypto.rs`:
  - `derive_key(password, salt, iterations) -> [u8; 32]` (PBKDF2-HMAC-SHA256)
  - `create_sentinel(key) -> SentinelData` (AES-256-GCM)
  - `verify_sentinel(key, sentinel) -> bool`
- Create `src-tauri/src/config.rs`:
  - `AppConfig` struct matching Doc 11 §12 schema (with `key_check` sentinel)
  - `check_app_config() -> bool`
  - `create_app_config(password) -> Result<()>`
  - `read_app_config() -> Result<AppConfig>`
  - Atomic writes (write .tmp then rename)
- Data directory: `app_data_dir()` per Doc 15 §8

**1.5 — Database Module**
- Create `src-tauri/src/db.rs`:
  - `open_world_db(world_dir, key) -> Result<Connection>`
  - `init_schema(conn)` — creates ALL 9+2 tables per Doc 15 §7:
    items, messages, story_settings, checkpoints, accordion_segments,
    templates, settings, telemetry, attachment_history,
    voice_profiles, tts_scripts
  - Seed `settings` table with all default values per Doc 05 §11
  - Seed `telemetry` table with 3 provider rows (text, image_gen, tts)
  - `close_db(conn)`

**1.6 — AppState**
- Create `src-tauri/src/state.rs`:
  - `AppState` struct with `Mutex<Option<Connection>>`, `master_key: Mutex<Option<[u8; 32]>>`,
    `api_key: Mutex<Option<String>>`
  - Key zeroing helper methods

**1.7 — World Creation**
- Create `src-tauri/src/world.rs`:
  - `create_world(name, tags) -> Result<WorldMeta>`
  - Creates world directory, loom.db, init_schema, world_meta.json
  - `list_worlds() -> Result<Vec<WorldMeta>>`
  - `WorldMeta` struct per Doc 08 §7

**1.8 — Register Tauri Commands**
- Register in `lib.rs`:
  `check_app_config`, `create_app_config`, `create_world`, `list_worlds`
- Frontend: simple test page that calls each command and displays results

### Testable Checkpoint
- [ ] `cargo tauri dev` opens a window titled "LOOM"
- [ ] Calling `check_app_config` from frontend returns `false` (no config yet)
- [ ] Calling `create_app_config("testpass123")` creates `app_config.json` with salt, iterations, and key_check sentinel
- [ ] Calling `check_app_config` now returns `true`
- [ ] Calling `create_world("Test World", [])` creates a world directory with `loom.db` and `world_meta.json`
- [ ] Opening `loom.db` with the derived key succeeds; all tables exist
- [ ] `settings` table contains all default values
- [ ] `telemetry` table has 3 rows (text, image_gen, tts)

---

## Phase 2 — Lock Screen + Unlock Flow

**Goal:** Full lock/unlock lifecycle. App launches to lock screen, user enters
password, app unlocks and shows a placeholder workspace.

**PRD References:** Doc 11 (§2–§7, §13, §14), Doc 14 (§1, §3)

### Tasks

**2.1 — Zustand Stores (Skeleton)**
- Create `src/stores/uiStore.ts`: appPhase, viewportNarrow, rightPaneCollapsed, branchMapOpen
- Create `src/stores/authStore.ts`: isUnlocked, isUnlocking, unlockError
- Create `src/stores/workspaceStore.ts`: placeholder (activeStoryId, isGenerating)
- Create `src/stores/vaultStore.ts`: placeholder (worlds, activeWorldId, items)

**2.2 — App.tsx Routing**
- Implement three-phase conditional rendering per Doc 11 §2:
  onboarding → OnboardingWizard (placeholder), locked → LockScreen, workspace → Workspace (placeholder)
- Mount evaluation: check localStorage + check_app_config

**2.3 — Lock Screen Component**
- `src/components/auth/LockScreen.tsx`
- LOOM wordmark centered, password input auto-focused, Unlock button
- Enter key submits, spinner during unlock, error display
- Styling per Doc 11 §4.2: dark background, Inter font

**2.4 — Unlock Tauri Command**
- `unlock_vault(password)`:
  - Read config, derive key, verify sentinel
  - If last_active_world_id exists: open world DB with key
  - Load API key into AppState
  - Load telemetry into AppState
- `lock_vault()`:
  - Close DB connection
  - Zero master_key and api_key

**2.5 — Manual Lock**
- Lock button (placeholder in a simple top bar for now)
- Lock flow: clear all stores per Doc 11 §7
- `Ctrl+L` shortcut

**2.6 — Global CSS + Tailwind Setup**
- `src/styles/globals.css` with all CSS variables from Doc 02 §2 (base neutrals, accent, semantic)
- shadcn/ui CSS variable overrides per Doc 02 §2.6
- Font bundling: copy woff2 files, create `fonts.css` with @font-face per Doc 02 §3

**2.7 — Error Boundary**
- `<ErrorBoundary>` wrapping Workspace per Doc 14 §7
- `<CrashScreen>` with restart button

### Testable Checkpoint
- [ ] App launches showing Lock Screen (after Phase 1 created app_config)
- [ ] Entering wrong password shows "Incorrect password."
- [ ] Entering correct password transitions to placeholder Workspace
- [ ] Clicking Lock returns to Lock Screen
- [ ] `Ctrl+L` locks the app
- [ ] Re-unlocking works (key derivation + sentinel verification)
- [ ] CSS variables applied: dark background (#0d0d0d), correct fonts

---

## Phase 3 — Onboarding Wizard

**Goal:** Complete first-launch experience. New users create password, enter
API key, create first world, save recovery file, and arrive at workspace.

**PRD References:** Doc 07 (full), Doc 11 §1

### Tasks

**3.1 — Onboarding Wizard Component**
- `src/components/onboarding/OnboardingWizard.tsx`
- 4-step wizard with step indicator (filled/empty dots)
- Navigation: Back (ghost), Next (accent), disabled until valid
- Modal over dark background, 480px width, non-dismissible

**3.2 — Step 1: Welcome**
- LOOM wordmark, subtitle, privacy message
- Next always enabled

**3.3 — Step 2: Create Master Password**
- Password + confirm fields with reveal toggle
- Min 8 chars validation, mismatch error on blur
- On Next: `create_app_config(password)` with spinner

**3.4 — Step 3: Connect to Gemini**
- API key input with reveal toggle
- Collapsible "How to get your API key" guide
- `[Test Key]` button → `validate_and_store_api_key(key)`
- Tauri command: validate key via GET to Gemini models endpoint
- Green ✓ or red ✕ feedback

**3.5 — Step 4: Create First World**
- World name input (min 2 chars, max 80)
- Import existing world option (file dialog for .loom-backup)
- On "Get Started": `create_world(name)`, persist API key to settings, set onboarding_complete

**3.6 — Recovery File Prompt**
- Post-creation dialog: Save recovery file or Skip
- `loom_recovery.json` generation per Doc 07 §5
- Save dialog via tauri-plugin-dialog

**3.7 — Tauri Commands**
- `validate_and_store_api_key(key)` — test against Gemini API, store in AppState
- `restore_app_config(recovery_data)` — for Recovery Screen

**3.8 — Recovery Screen**
- Shown when onboarding_complete = true but app_config missing
- Import recovery file or fresh install options

### Testable Checkpoint
- [ ] Fresh launch (delete app_config.json) shows Onboarding Wizard
- [ ] Step navigation works: Back/Next, dots update
- [ ] Password validation enforces min 8 chars and match
- [ ] API key test shows ✓ on valid key (requires real Gemini key for test)
- [ ] Creating world transitions to Workspace
- [ ] Recovery file can be saved and contains correct schema
- [ ] Subsequent launches show Lock Screen (onboarding complete)
- [ ] Deleting app_config.json with onboarding_complete=true shows Recovery Screen

---

## Phase 4 — World Management + Vault Tree

**Goal:** World Picker with world cards, vault tree with folders/stories/documents,
create/rename/delete items, drag-and-drop reorder.

**PRD References:** Doc 08 (full), Doc 03 (§2, §4)

### Tasks

**4.1 — World Picker Modal**
- `src/components/modals/WorldPickerModal.tsx`
- 2-column card grid, 600px width
- World cards per Doc 02 §9: 270×140px, accent outline on active
- Open via world name header click in Navigator
- New World inline form, Import World file picker

**4.2 — World Switching**
- `switch_world(world_id)` Tauri command
- Backend: close current DB, open new DB
- Frontend: clear stores, re-mount workspace
- Confirmation dialog if generating

**4.3 — World Deletion**
- Soft delete with name-typing confirmation
- Trash section in World Picker with Restore
- Permanent deletion: remove directory

**4.4 — Vault Tree Component**
- `src/components/navigator/VaultTree.tsx`
- Recursive tree rendering from `items` table
- Item types: Story (BookOpen), Folder (Folder), SourceDocument (FileText), Image (Image)
- Expand/collapse folders, persist to localStorage
- Filter input with debounced search (150ms)

**4.5 — Item CRUD**
- Tauri commands: `vault_create_item`, `vault_rename_item`, `vault_move_item`,
  `vault_soft_delete`, `vault_restore_item`, `vault_purge_item`
- Create New dialog: Story, Folder, Source Document types
- Inline rename on double-click
- Right-click context menus per item type
- Multi-select with Ctrl+Click and Shift+Click
- Bulk action bar: Move, Delete

**4.6 — Drag-and-Drop**
- Drag items onto folders (move inside)
- Drag between items at same level (reorder via sort_order)
- Visual: insertion line + folder highlight
- Enforce max 5 levels nesting depth

**4.7 — Navigator Bottom Bar**
- Lock button (connects to Phase 2 lock flow)
- Settings gear icon (placeholder — opens nothing yet)
- `+` create new button

**4.8 — Trash View**
- Renders in Theater when Trash selected
- Item list with Restore and Empty Trash

### Testable Checkpoint
- [ ] World Picker opens with active world highlighted in its accent color
- [ ] Creating a new world adds a card; switching worlds reloads vault
- [ ] Deleting world requires name typing; shows in Trash section; can restore
- [ ] Vault tree renders stories, folders, documents correctly
- [ ] Creating items: new story appears in tree, new folder is expandable
- [ ] Rename: double-click enables inline edit, Enter confirms
- [ ] Drag-and-drop: reorder works, move into folder works
- [ ] Nesting beyond 5 levels is blocked
- [ ] Multi-select + bulk delete works
- [ ] Filter input filters tree in real-time
- [ ] Trash view shows deleted items with Restore option

---

## Phase 5 — Three-Pane Layout + Navigation Shell

**Goal:** The full workspace layout: Navigator (left), Theater (center),
Control Pane (right) with resizable pane dividers, collapse/expand,
viewport watcher, and all empty states.

**PRD References:** Doc 02 (§4), Doc 03 (§1–§4), Doc 11 (§9, §13)

### Tasks

**5.1 — Workspace Layout**
- `src/components/layout/Workspace.tsx`
- Three-pane flex layout per Doc 02 §4.1
- Navigator: 260px default, 200–360px range
- Theater: flex-1
- Control Pane: 280px default, 240–400px range

**5.2 — Pane Dividers**
- `src/components/layout/PaneDivider.tsx`
- 1px hairline, cursor col-resize on hover
- Drag to resize with min/max constraints
- Width persisted to localStorage

**5.3 — Control Pane Collapse**
- Toggle button: PanelRightClose/PanelRightOpen
- Width transition: 200ms ease
- Collapse state in localStorage
- Rate limit dot placeholder (renders when collapsed)

**5.4 — Viewport Watcher**
- `src/lib/viewportWatcher.ts`
- Auto-collapse Control Pane below 1200px
- Does not auto-reopen on widen

**5.5 — Theater Empty States**
- `<NoStorySelected />`: recent stories list (up to 5), click to open
- `<EmptyStory />`: "Your story begins here" centered message
- Both per Doc 03 §1.1 and §1.2

**5.6 — Navigator Empty States**
- `<EmptyVault />`: "No items yet" message
- No search results: "No results for…"
- `<EmptyTrash />`: "Trash is empty"

**5.7 — Control Pane Empty State**
- "Open a story to see its details." when no story active
- Placeholder sections for Context Docs, System Instructions, Feedback, Telemetry

**5.8 — Toast System**
- Configure Sonner: `<Toaster position="bottom-right" theme="dark" richColors />`

**5.9 — Story Click → Load**
- Clicking a story in vault tree: call `load_story_messages(story_id)` (returns empty for now)
- Set activeStoryId, show EmptyStory
- last_open_story_id persistence

### Testable Checkpoint
- [ ] Three-pane layout renders with correct default widths
- [ ] Dragging pane dividers resizes panes within min/max constraints
- [ ] Widths persist across page reload
- [ ] Control Pane collapses/expands with smooth animation
- [ ] Narrowing window below 1200px auto-collapses Control Pane
- [ ] NoStorySelected shows recent stories list (or "create one" message)
- [ ] Clicking a story shows EmptyStory in Theater
- [ ] Empty vault shows "No items yet" message
- [ ] Toasts display correctly (test with a manual toast trigger)

---

## Phase 6 — Conversation Engine (Send + Stream + Display)

**Goal:** Users can send plot direction and receive streaming AI responses
from Gemini. Messages display in bubbles with proper formatting.

**PRD References:** Doc 09 (§1–§6, §9–§11), Doc 02 (§5, §6)

### Tasks

**6.1 — Gemini API Client**
- `src-tauri/src/gemini.rs`:
  - Build Gemini API request (system instruction + history + user turn)
  - Streaming response parser (SSE/chunked)
  - Extract `usageMetadata.totalTokenCount` and `finishReason`
  - Handle safety filter responses

**6.2 — Message Schema + DB Operations**
- Insert user message (content_type: json_user, content: JSON UserContent)
- Insert model message (content_type: text, streamed content)
- `load_story_messages(story_id)` with Recursive CTE for branch reconstruction
- Return `StoryPayload` (messages, sibling_counts, checkpoints placeholder, accordion placeholder)

**6.3 — Server-Side History Assembly**
- `build_user_turn_text(UserContent)` per Doc 09 §4.2
- `build_history_with_feedback(messages)` per Doc 09 §4.3
- Read system_instructions from settings
- Assemble complete Gemini request body server-side
- `send_message(story_id, leaf_id, user_content)` per C-02 decision

**6.4 — Input Area**
- `src/components/theater/InputArea.tsx`
- Plot Direction: always visible textarea, min-height 80px, auto-grow
- Background Information: collapsed by default, expand via toggle
- Modificators: collapsed by default, tag-style input
- Send button (accent), Stop button (amber, shown during generation)
- `Ctrl+Enter` sends
- All fields clear after send

**6.5 — Streaming Display**
- Listen for Tauri `stream_chunk` events
- Update model bubble content progressively
- Three-dot loading indicator before first token
- `stream_done` event: replace temp IDs, set isGenerating=false

**6.6 — Message Bubbles**
- `src/components/theater/UserBubble.tsx`:
  - Plot direction always visible
  - Background info pill (amber, expandable)
  - Modificators pill (accent, expandable)
- `src/components/theater/AiBubble.tsx`:
  - Role label + timestamp + token count + model name
  - Markdown rendering (via marked)
  - Code blocks with mono font
- Bubble colors: user = accent-subtle, ai = #1a1a1a (from CSS vars)

**6.7 — Stop Generation**
- `cancel_generation()` Tauri command
- Drops stream, saves partial content with finish_reason = ERROR
- Amber ⚠ icon on partial bubbles

**6.8 — Safety Filter Display**
- finish_reason === "SAFETY": warning bubble per Doc 09 §11

**6.9 — Token Counter (Toolbar)**
- Theater toolbar: `~X / 128,000 tokens`
- Estimation via chars/4 for pre-send, actual counts post-response
- Color: muted (normal), warning (>80%), error (>95%)

### Testable Checkpoint
- [ ] Typing plot direction and clicking Send creates a user bubble
- [ ] AI response streams in token-by-token into a model bubble
- [ ] Three-dot loading shows before first token arrives
- [ ] Stop button cancels generation; partial text saved with ⚠ icon
- [ ] Background Information pill shows amber, expands on click
- [ ] Modificators pill shows tags
- [ ] Markdown renders in AI bubbles (bold, italic, headers, code)
- [ ] Token counter updates after each response
- [ ] All input fields clear after Send
- [ ] Ctrl+Enter sends from within textarea
- [ ] Sending without plot direction is blocked

---

## Phase 7 — Branching, Editing, Regeneration

**Goal:** Full DAG navigation. Users can regenerate AI messages, edit user
messages (creating branches), navigate between siblings.

**PRD References:** Doc 09 (§2, §7, §8)

### Tasks

**7.1 — Sibling Navigation**
- `< N / M >` display inside bubble header when siblings exist
- Click arrows to switch between sibling branches
- Update `currentLeafId` and re-render active branch

**7.2 — Regenerate**
- `⟳` button on last AI bubble (action row on hover)
- Creates new model message as sibling of current
- Same UserContent from parent user message
- Updates currentLeafId to new response
- Shows as new sibling in `< N / M >`

**7.3 — Edit User Message**
- `✎` button on user bubble action row
- Bubble transforms to editable: textarea for plot_direction, fields expand
- Cancel and Send Edit buttons
- Case A (last message): new sibling branch from same parent
- Case B (non-last): new branch, terminates at new user+AI pair, no descendants copied
- AI always regenerates for edited content

**7.4 — Delete Message**
- 🗑 button on AI bubble action row (last message only)
- Soft delete (sets deleted_at)
- Switch to parent as new leaf
- Toast with 5s Undo

**7.5 — Leaf ID Persistence**
- Save `currentLeafId` to `story_settings.leaf_id` on every change
- Restore on story open via `get_story_leaf_id`

### Testable Checkpoint
- [ ] After regeneration, `< 1 / 2 >` appears; clicking arrows switches branches
- [ ] Editing a user message (last) creates a sibling with new AI response
- [ ] Editing a mid-branch user message creates new branch (original intact)
- [ ] Branch navigation updates Theater content and token counter
- [ ] Deleting last message: parent becomes leaf, Undo restores
- [ ] Reloading the app restores the correct branch (leaf_id persisted)

---

## Phase 8 — Settings Modal + Theming

**Goal:** Complete Settings modal with all tabs. Per-world theming (accent
color, fonts, bubble colors, feature colors) applies live.

**PRD References:** Doc 05 (full), Doc 02 (§2.2, §2.4, §2.5, §3.2, §13)

### Tasks

**8.1 — Settings Modal Shell**
- `src/components/modals/SettingsModal.tsx`
- Left vertical tab nav (180px) + right scrollable content
- 720px width, 80vh max height
- Section headers: APP, WORLD, DEV
- Auto-save on blur/change with ✓ flash

**8.2 — Tab: General**
- Auto-lock dropdown (Off, 5m, 15m, 30m, 1h)
- World name edit (convenience exposure)
- Auto-lock timer implementation per Doc 11 §6

**8.3 — Tab: Appearance**
- Accent color hex input with live preview swatch
- `applyAccentColor()` runtime computation (darken, lighten, alpha)
- `syncAccentToWorldMeta()` for World Picker cache
- Body font selector (Lora/Inter/JetBrains Mono)
- Bubble colors (user + AI)
- Feature colors (Ghostwriter frame/diff, Checkpoint, Accordion)

**8.4 — Tab: Writing**
- System instructions textarea (synced with Control Pane)
- Modificator presets: up to 5, add/delete chips

**8.5 — Tab: Connections**
- Model selector dropdown (from text_model_options)
- API key display (masked) + Change flow
- Image Gen and TTS sections greyed out with "not yet available"

**8.6 — Tab: Security**
- Change Master Password form with password-change-in-progress recovery

**8.7 — Tab: Export**
- Export folder picker (app-level localStorage)

**8.8 — Tab: Developer**
- Rate limit configuration (RPM, TPM, RPD inputs)
- Context token limit
- Custom models management
- AI Prompt Templates (Ghostwriter, Accordion summarise, Accordion fake-pair user prompt)
- Full Branch JSON Export button

**8.9 — Tab: Templates**
- List user-defined templates with Edit/Delete
- New Template form

**8.10 — Tab: Advanced**
- Placeholder for future destructive actions

**8.11 — Theme Application on World Mount**
- `applyTheme()` in Workspace mount per Doc 02 §13
- Re-run on activeWorldId change

### Testable Checkpoint
- [ ] `Ctrl+,` opens Settings modal
- [ ] Changing accent color immediately updates all accent-derived UI
- [ ] Switching body font changes Theater prose appearance
- [ ] Changing bubble colors updates bubble backgrounds
- [ ] Auto-lock: setting to 5 minutes and waiting shows warning toast at 4 minutes
- [ ] System instructions sync between Settings and Control Pane
- [ ] Model selector shows all model options; selection persists
- [ ] Rate limit values save and persist
- [ ] AI Prompt Templates: editing Ghostwriter instruction saves and persists
- [ ] Switching worlds applies that world's theme

---

## Phase 9 — Control Pane + Context Docs + Feedback

**Goal:** Fully functional right pane with story info, context document
attachment, system instructions, feedback overlay, and telemetry placeholder.

**PRD References:** Doc 10 (full), Doc 03 (§3)

### Tasks

**9.1 — Control Pane Layout**
- `src/components/RightPane.tsx`
- Section order per Doc 10 §1.4: Story Title, Description, Metadata, Context Docs,
  System Instructions, Feedback toggle, Telemetry bars

**9.2 — Story Title + Branch Info**
- Story name (click to inline rename)
- Branch N of M, depth N
- Branch Map button (placeholder — opens nothing yet)

**9.3 — Story Description**
- Editable inline italic text below branch info
- `update_item_description()` on blur
- Tooltip on hover in vault tree

**9.4 — Metadata Strip**
- Message count, word count (~chars/5), docs attached count

**9.5 — Context Docs Section**
- Attached docs list with template icon, subtype label, name, [×] remove
- Paperclip icon on Source Documents in Navigator (toggle attach/detach)
- `attach_context_doc`, `detach_context_doc` Tauri commands
- Persistence in story_settings key `context_doc_ids`
- `attachment_history` table writes
- Empty state: "No documents attached."

**9.6 — Context Doc Integration with Gemini**
- Backend: on `send_message`, read attached doc IDs from story_settings,
  load content from `items` table
- Text docs: always include inline as additional parts in the current user turn
  (NOT in the history — avoids bloating history with repeated doc content)
- Image docs: upload to Gemini File API, send as file URI (see Phase 15)
- No File API for text documents — always inline regardless of size

**9.7 — System Instructions**
- Collapsible textarea, synced with Settings → Writing
- Save on blur

**9.8 — Feedback Overlay**
- Toggle button with badge count
- Slide-in overlay covering pane content
- Feedback entry list: message excerpt + editable textarea + "Go to msg" link
- Empty state: "No feedback notes yet."

**9.9 — Feedback Injection**
- `update_message_feedback(id, feedback)` Tauri command
- Feedback box display below AI bubbles (expandable)
- Feedback injected into history assembly as `[WRITER FEEDBACK]` tag

### Testable Checkpoint
- [ ] Story title editable inline; branch info displays correctly
- [ ] Story description shows in Control Pane and as tooltip in Navigator
- [ ] Attaching a Source Document: paperclip turns accent, chip appears in Context Docs
- [ ] Detaching: chip removed, paperclip reverts
- [ ] Sending a message with attached docs: AI receives doc content in context
- [ ] System instructions textarea syncs with Settings
- [ ] Adding feedback to an AI bubble: feedback box appears below bubble
- [ ] Feedback overlay opens/closes with slide animation
- [ ] Subsequent AI responses account for feedback (visible in AI behavior)
- [ ] Deleting a doc that's attached: removed from Context Docs automatically

---

## Phase 10 — Rate Limiting + Telemetry

**Goal:** Full rate limiting system with counters, UI bars, send blocking,
and 429 handling.

**PRD References:** Doc 06 (full), Doc 03 (§1.3–§1.5), Doc 02 (§10, §11)

### Tasks

**10.1 — RateLimiter Struct**
- `src-tauri/src/rate_limiter.rs`
- ProviderCounters for text, image_gen (stub), tts (stub)
- RPM window (rolling 60s), RPD window (midnight PT via chrono-tz)
- `check_rate_limit(provider, settings) -> RateLimitStatus`
- `record_usage(provider, tokens)`

**10.2 — Persistence**
- Load from `telemetry` table on world open
- Write after every `record_usage()`
- `reset_rate_limiter()` zeros all counters

**10.3 — Telemetry Store + UI**
- `src/stores/telemetryStore.ts`: refresh() calls get_telemetry()
- Control Pane telemetry bars: RPM, TPM, RPD
- Color thresholds: <60% emerald, 60-80% amber, >80% rose
- Collapsed pane: rate limit dot indicator

**10.4 — Rate Limit Banner**
- Amber banner above input when can_proceed=false
- Shows reason (RPM/TPM/RPD) and countdown timer
- Send button disabled during banner
- Auto-dismiss and re-check at countdown zero

**10.5 — 429 Error Handling**
- Rose banner for Google RESOURCE_EXHAUSTED
- No auto-retry, no record_usage on failed request

**10.6 — Generation Error Banner**
- Rose banner for non-429 API errors
- Retry button calls send_message again

**10.7 — Integration with Ghostwriter (pre-wire)**
- Ensure check_rate_limit called before Ghostwriter requests
- Ensure record_usage called after Ghostwriter completes

### Testable Checkpoint
- [ ] Telemetry bars display in Control Pane with correct fill levels
- [ ] After multiple sends, RPM counter increments correctly
- [ ] Hitting RPM limit shows amber banner with countdown
- [ ] Send button disabled during rate limit
- [ ] Countdown reaches zero: banner dismissed, Send re-enabled
- [ ] Simulating 429: rose banner displayed, no retry
- [ ] Rate limit dot visible when Control Pane collapsed
- [ ] Reset Rate Limit Counters (Dev tab) zeros all bars

---

## Phase 11 — Source Document Editor + Templates

**Goal:** Source Documents open in a dedicated editor with Markdown preview,
template placeholders, and image document lightbox.

**PRD References:** Doc 12 (full), Doc 08 (§5, §6)

### Tasks

**11.1 — DocEditor Component**
- `src/components/DocEditor.tsx`
- Renders in Theater, replaces message view
- Header bar: Back to Story, doc name + type, Save button
- Unsaved changes indicator (dot on name)

**11.2 — Editor Textarea**
- Monospaced font, full-height, --color-bg-base
- Auto-save on blur
- Ctrl+S manual save with ✓ flash

**11.3 — Markdown Preview**
- Toggle between Edit and Preview mode
- Rendered styles per Doc 12 §5

**11.4 — Template Placeholder Navigation**
- `{{placeholder}}` detection via regex
- Tab: jump to next placeholder (select entire token)
- Shift+Tab: jump to previous
- If no placeholders: Tab inserts 2 spaces

**11.5 — Unsaved Changes Guard**
- Dialog on navigation away with dirty editor
- "Discard" / "Save and Close" options

**11.6 — Image Documents**
- Lightbox view for image items
- Caption field below image
- Asset protocol URL via `convertFileSrc`

**11.7 — Template Management Backend**
- `list_templates`, `save_template`, `delete_template` Tauri commands
- Templates table CRUD
- Built-in Image template (non-deletable)

**11.8 — Create from Template**
- Create New dialog: Source Documents section lists templates
- Clicking creates item with template default_content

### Testable Checkpoint
- [ ] Double-clicking a Source Document opens editor in Theater
- [ ] Editing content and clicking Save persists changes
- [ ] Ctrl+S saves; ✓ flash appears
- [ ] Preview toggle shows rendered Markdown
- [ ] Tab cycles through {{placeholders}} in document
- [ ] Navigating away with unsaved changes shows guard dialog
- [ ] Back to Story returns to conversation view
- [ ] Image documents show in lightbox with caption field
- [ ] Creating doc from template populates default content
- [ ] Template CRUD in Settings → Templates works

---

## Phase 12 — Ghostwriter

**Goal:** Targeted AI revision tool. Select text in an AI bubble, provide an
instruction, receive a diff, accept or reject.

**PRD References:** Doc 16 (full), Doc 02 (§5.4)

### Tasks

**12.1 — Ghostwriter Store**
- `src/stores/ghostwriterStore.ts` per Doc 16 §10
- activeMsgId, selection, instruction, isGenerating, pendingDiff

**12.2 — Enter Ghostwriter Mode**
- `✦ Ghostwriter` button in AI bubble action row
- Accent frame (pulsing outline) around bubble
- Markdown paused → plain text rendering for precise selection
- Ghostwriter toolbar below bubble: instruction textarea + Generate/Cancel

**12.3 — Text Selection**
- Track selection offsets from plain-text content
- Highlight selected text with diff color at reduced opacity
- Generate button disabled until selection + instruction non-empty

**12.4 — API Request**
- `send_ghostwriter_request` Tauri command (server-side history assembly)
- Read `prompt_ghostwriter` from settings (editable)
- System instruction assembly with selected_text, instruction, original_content
- Non-streamed response
- Rate limiting: check before, record after
- `workspaceStore.isGenerating = true` during request

**12.5 — Diff Display**
- Calculate text diff (word-level)
- Render changed spans with highlight color
- Accept/Reject toolbar replaces Generate toolbar

**12.6 — Accept Flow**
- Case A (latest message): update in-place, append to ghostwriter_history
- Case B (non-latest): create new branch dialog, new user+model pair

**12.7 — Reject/Cancel**
- Revert to original content
- If new branch was created (Case B): destroy branch
- Escape key: confirm if diff exists

**12.8 — Ghostwriter History + Revert**
- `ghostwriter_history` JSON array in messages table
- Revert button (RotateCcw) on bubbles with history
- Pops last entry, restores previous content

### Testable Checkpoint
- [ ] Clicking ✦ Ghostwriter enters mode: frame appears, text becomes plain
- [ ] Selecting text highlights it; instruction textarea appears
- [ ] Generate disabled until both selection and instruction present
- [ ] After generation: diff shows changed portions highlighted
- [ ] Accept: content updated, Ghostwriter mode exits, Revert button appears
- [ ] Reject: original content restored, mode exits
- [ ] Revert: reverts to previous version
- [ ] Editing non-latest message: "Create new branch?" dialog appears
- [ ] Rate limiting blocks Ghostwriter when limits reached
- [ ] Escape during diff: "Discard changes?" confirmation

---

## Phase 13 — Branch Map + Checkpoints

**Goal:** Visual tree overview of all branches. Checkpoint management for
marking narrative boundaries.

**PRD References:** Doc 17 (full), Doc 02 (§5.5)

### Tasks

**13.1 — Branch Map Drawer**
- Fixed right-side drawer, slides over Control Pane
- Default 400px, resizable 300px–70vw
- Open: Ctrl+M, Git Fork icon in Control Pane, right-click bubble
- Close: Ctrl+M, Escape (priority 2), ✕ button

**13.2 — Branch Map Store**
- `src/stores/branchMapStore.ts`
- `load_branch_map(story_id)` returns BranchMapData
- Nodes, edges, checkpoints, accordion_segments, current_leaf_id

**13.3 — Tree Visualization**
- Abstracted node tree: message pairs as nodes
- Straight sequences collapsed to "── N msgs ──" lines
- Fork points with branching lines (├/└)
- Current leaf marked with ● dot
- Active branch highlighted

**13.4 — Node Rendering**
- Node cards: excerpt, tokens, timestamp, active dot
- Hover tooltip: longer excerpt + metadata
- Origin icons: ✎ (edited), ✦ (Ghostwriter), ⟳ (regenerated)

**13.5 — Branch Switching**
- Click node → switch currentLeafId
- Theater scrolls to show new branch
- Map highlights new active path

**13.6 — Checkpoint CRUD**
- `create_checkpoint(story_id, after_message_id, name)` → creates DB row + accordion segment
- `rename_checkpoint(id, name)`
- `delete_checkpoint(id)` → merge adjacent accordion segments
- Start Checkpoint: auto-created, renameable, not deletable

**13.7 — Checkpoint Display**
- Theater: elegant divider lines between messages per Doc 02 §5.5
- Branch Map: markers between nodes
- Context menu: Rename, Summarize previous chapter (placeholder), Delete

**13.8 — Orphaned Checkpoint Cleanup**
- On story load: detect checkpoints pointing to permanently purged messages
- Auto-delete orphans, show warning toast

**13.9 — Branch Deletion**
- Right-click node → "Delete branch from here"
- Leaf node: delete pair, switch to parent
- Middle node: delete node + descendants, switch to sibling
- Soft delete with 5s Undo toast

**13.10 — Live Updates**
- `branch_map_updated` Tauri event after message/checkpoint changes
- Re-render map when event received and map is open
- Pulse animation on active leaf during generation

### Testable Checkpoint
- [ ] Ctrl+M opens Branch Map drawer with smooth animation
- [ ] Tree shows correct structure: forks, collapsed sequences, checkpoints
- [ ] Clicking a node switches to that branch in Theater
- [ ] Creating a checkpoint: divider appears in Theater, marker in Map
- [ ] Renaming checkpoint: updates in both Theater and Map
- [ ] Deleting checkpoint: segments merge, dividers update
- [ ] Branch deletion: removes node + descendants, Undo restores
- [ ] Regenerating a message: new sibling visible in Map
- [ ] Map updates live during/after generation
- [ ] "Show in Branch Map" from Theater right-click scrolls to correct node

---

## Phase 14 — Accordion (Context Compression)

**Goal:** Compress earlier chapters into AI summaries. Collapsed segments
replace original messages in API history with Fake-Pairs.

**PRD References:** Doc 18 (full), Doc 02 (§8)

### Tasks

**14.1 — Accordion Store**
- `src/stores/accordionStore.ts`
- segments from StoryPayload, collapse/expand/summarise actions

**14.2 — Segment Lifecycle**
- Segments created when checkpoints are created (Phase 13 already seeds them)
- Segment = messages between two consecutive checkpoints
- Segment merge on checkpoint deletion (already handled in Phase 13)

**14.3 — Summarisation Flow**
- Checkpoint divider context menu → "Summarise previous chapter"
- Pre-checks: rate limit, existing summary confirmation
- `summarise_segment(segment_id, story_id, leaf_id)` Tauri command
- Backend: extract segment messages, send to Gemini with summarisation instruction
  (read from `prompt_accordion_summarise` setting)
- Non-streamed response, store in accordion_segments.summary
- Rate limit: check before, record after
- Toast: "Summary generated. Collapse the chapter to use it in context." + [Collapse Now]

**14.4 — Collapse/Expand**
- Collapse: segment has summary → set is_collapsed=1 → re-render Theater
- Expand: set is_collapsed=0 → show full bubbles again
- Expand does NOT delete summary

**14.5 — Summary Card UI**
- Per Doc 02 §8: checkpoint name, message count, expand button, summary text
- border-left colored with --color-accordion

**14.6 — History Assembly Integration**
- `build_history_with_accordion()` in send_message backend:
  Read `prompt_accordion_fake_user` from settings
  Replace collapsed segments with Fake-Pairs
- Token counter shows: "~X tokens sent (N segments collapsed, ~Y saved)"

**14.7 — Stale Summary Detection**
- Ghostwriter edit inside collapsed segment → mark stale
- Regeneration inside collapsed segment → mark stale
- Stale indicator: ⚠ on summary card + tooltip
- Click ⚠ → re-summarise

**14.8 — Branch-Specific Collapse**
- Fork-spanning segments: prompt "Apply to all branches or separately?"
- branch_leaf_id column: NULL = all branches, set = specific branch

**14.9 — Accordion in Branch Map**
- Collapsed sequences show with --color-accordion + "summarised" badge
- Click expands to show summary text inline in map

**14.10 — Accordion in Reader View**
- Collapsed segments render summary card in Reader View

### Testable Checkpoint
- [ ] Creating 2+ checkpoints creates accordion segments
- [ ] "Summarise previous chapter": generates summary, toast appears
- [ ] Collapsing: messages replaced by summary card
- [ ] Expanding: full bubbles restored, summary retained
- [ ] Token counter shows savings: "X tokens sent (N collapsed, ~Y saved)"
- [ ] Sending a message with collapsed segments: AI receives Fake-Pairs (verify via response quality)
- [ ] Editing content inside summarised segment: stale ⚠ appears
- [ ] Re-summarising: new summary replaces old, stale cleared
- [ ] Branch Map shows collapsed sequences with accordion color
- [ ] Accordion prompts are editable in Dev settings

---

## Phase 15 — Reader View, Export, Image Uploads, Polish

**Goal:** Final features and polish. Reader View, Markdown/JSON export,
image upload system, keyboard shortcuts modal, and comprehensive error states.

**PRD References:** Doc 04 (full), Doc 19 (full), Doc 13 (full),
Doc 03 (remaining), Doc 14 (remaining), Doc 20 (stubs only), Doc 21 (stubs only)

### Tasks

**15.1 — Reader View**
- Toggle via Ctrl+R or toolbar button
- AI messages only, no input area, no action rows
- Increased padding (60px), max-width 720px, font 16px, line-height 1.8
- Auto-collapse Navigator and Control Pane (restore on exit)
- Checkpoint dividers visible (non-interactive)
- Accordion summary cards visible

**15.2 — Markdown Export**
- `export_story_markdown(story_id, leaf_id)` Tauri command
- AI messages only, H1 story name, metadata line, HR between messages
- Auto-save to export folder (if configured) or file dialog
- Filename: `<story_name>_<YYYYMMDD>.md`
- Success toast with "Open folder" action

**15.3 — Full Branch JSON Export**
- `export_full_branch_json(story_id, leaf_id)` Tauri command
- Schema per Doc 04 §4.2
- Available in Settings → Developer

**15.4 — Image Upload System**
- `vault_upload_image(src_path, name, parent_path)` Tauri command
- MIME validation by magic bytes, 10MB max
- Store in `worlds/<world_id>/assets/<item_id>.<ext>`
- Read dimensions via image crate
- Navigator: image icon, hover thumbnail (160×160px) via asset:// protocol
- Inline in bubbles: MessageBlock[] with image blocks
- Vault Image Picker modal for inserting images into messages
- Image as Context Doc (Gemini File API upload; text docs are always inline — see Phase 9.6)
- Deletion: soft delete preserves asset, purge deletes file

**15.5 — World Export/Import**
- `vault_export_world(dest_path)`: zip loom.db + assets/ into .loom-backup
- `vault_import_world(src_path)`: extract zip, create world
- zip crate integration

**15.6 — Keyboard Shortcuts Modal**
- `?` or `Ctrl+/` opens modal
- All shortcuts listed per Doc 13 §4.2
- 440px width, section headers

**15.7 — Full Keyboard Shortcut Registration**
- `src/lib/shortcuts.ts` per Doc 13 §7
- All global shortcuts: Ctrl+, Ctrl+L, Ctrl+R, Ctrl+M, Ctrl+F, ?, Escape
- Input-aware: Ctrl+Enter (send), Escape (blur)
- Escape priority chain (all 8 levels now functional)

**15.8 — v1.1/v2 Stubs**
- `src-tauri/src/image_gen.rs`: ImageGenerationProvider trait + 4 provider stubs
- `src-tauri/src/tts.rs`: TtsProvider trait + 2 provider stubs
- All stub Tauri commands registered, return "not yet implemented"
- Settings UI: Image Gen and TTS sections visible but greyed out

**15.9 — Error Polish**
- All error surfaces per Doc 14 §2 (toast, banner, inline, modal, blocking)
- Migration error blocking modal
- Recovery Screen (app_config missing)
- World DB missing warning in World Picker

**15.10 — Auto-Lock Polish**
- 60-second warning toast with [Stay Unlocked]
- Generation confirmation before lock

**15.11 — Accessibility Baseline**
- aria-labels on all icon buttons
- alt attributes on all images
- Labels associated with form fields
- Focus management in modals (useFocusTrap)

**15.12 — Max Context Warning**
- Amber banner when token count > 90% of limit
- Disappears below 85%

### Testable Checkpoint
- [ ] Ctrl+R enters Reader View: AI messages only, wider prose, no input
- [ ] Exiting Reader View restores pane states
- [ ] Export Markdown: .md file created with correct format
- [ ] Export JSON: .json file with full branch data
- [ ] Uploading image: appears in vault tree with thumbnail on hover
- [ ] Inserting image into message: inline display in bubble
- [ ] Image as Context Doc: AI references image content
- [ ] World Export: .loom-backup created with DB + assets
- [ ] World Import: new world appears from .loom-backup
- [ ] `?` shows shortcuts modal
- [ ] All keyboard shortcuts functional
- [ ] Escape chain: each level resolves correctly
- [ ] Image Gen/TTS sections greyed out with "not yet available"
- [ ] All error states display correctly (test by simulating errors)
- [ ] Auto-lock warning appears before timeout
- [ ] Focus trapped in modals, aria-labels present

---

## Glossary

| Term | Definition |
|---|---|
| **World** | A self-contained creative project with its own encrypted database, theme, and settings |
| **Story** | A conversation tree (DAG) within a World. The primary writing unit. |
| **Branch** | A path from root to a specific leaf message in the DAG |
| **Leaf** | The terminal message of a branch — the "current position" in the story |
| **Checkpoint** | A named marker between messages, defining narrative chapter boundaries |
| **Segment** | The sequence of messages between two consecutive checkpoints |
| **Fake-Pair** | A synthetic user+model exchange injected at runtime carrying an Accordion summary |
| **Accordion** | The context compression system that replaces collapsed segments with Fake-Pairs |
| **Ghostwriter** | The targeted AI revision tool for editing specific passages within AI output |
| **Context Doc** | A Source Document attached to a story, sent to the AI with every request |
| **Theater** | The center pane showing the conversation (messages, input, toolbars) |
| **Navigator** | The left pane showing the vault tree (files, folders, stories) |
| **Control Pane** | The right pane showing story metadata, context docs, feedback, telemetry |

---

## Session Preparation Checklist

Before each Claude Code session, ensure:

1. **Codebase access:** Claude Code has access to the full repository from prior phases
2. **PRD documents:** The relevant PRD docs (listed in each phase header) are available
3. **API key:** A valid Gemini API key is available for testing (Phases 6+)
4. **Platform:** Development machine has Rust toolchain, Node.js, and Tauri CLI installed
5. **Prior phase verified:** All Testable Checkpoints from the previous phase pass

---

*End of Implementation Plan*
