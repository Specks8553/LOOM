# 04 — System Overview

> **Status:** Complete
> **Last updated:** 2026-05-03 — pre-implementation audit: dead `branch_map_updated` example replaced with live events (CD-11).
> **Earlier:** 2026-04-27 — consultant pass: AppState diagram, encryption boundary, file system layout, and world-switch sequence corrected post A-02-A and D-07; auto-lock wording aligned with Doc 13; Sonner added to tech stack

The 10,000ft view. Covers process model, IPC boundary, encryption boundary, state lifecycle, network boundary, file system layout, and tech stack decisions with rationale.

---

## Tech Stack

| Layer | Technology | Decision |
|---|---|---|
| Desktop shell | Tauri v2 | D-01 |
| Backend language | Rust (Edition 2021) | D-01 |
| Database | SQLCipher (AES-256, via rusqlite bundled) | D-01 |
| Frontend framework | React 19 + TypeScript (strict mode) | D-01 |
| State management | Zustand 5 | D-01 |
| Styling | Tailwind CSS v4 + shadcn/ui | D-01, D-06 |
| Build tool | Vite 7 | D-01 |
| Toasts | Sonner (via shadcn integration) | D-06 |
| AI — text generation | Google Gemini API (via Rust/reqwest) | D-02 |
| AI — image / audio generation | Provider-agnostic trait (providers TBD) | D-02 |

**Why Tauri v2 over Electron:** Rust backend gives us in-process key management with no JS memory exposure for sensitive data. The master key and API key live in Rust memory and are zeroed on lock — this is not possible in an Electron app where the backend is Node.js. Binary size and memory footprint are also significantly smaller.

**Why Tailwind v4 over v3:** Native CSS variable integration. LOOM's entire design system runs through CSS variables (Doc 08). Tailwind v4 treats CSS variables and utility classes as the same system, eliminating the config overhead and making the token-to-class relationship direct.

---

## Process Model

Tauri v2 runs two processes:

```
┌─────────────────────────────────────────────────────────┐
│  Rust Core Process                                       │
│                                                          │
│  AppState { master_key, api_key,                         │
│             settings_conn, active_conn,                  │
│             active_world_id, cancel_tx }                 │
│                                                          │
│  Tauri command handlers (commands/)                      │
│  Services: history assembly, Gemini client,             │
│            rate limiter, generation trait               │
│  DB layer: SQLCipher (one connection at a time)         │
│  Security: crypto, sentinel                             │
│                                                          │
│  HTTP client (reqwest) ──► generativelanguage.googleapis.com
└──────────────────┬──────────────────────────────────────┘
                   │ IPC (invoke / events)
┌──────────────────▼──────────────────────────────────────┐
│  WebView (React Frontend)                                │
│                                                          │
│  Zustand stores: app, auth, vault, workspace,           │
│                  settings, mode, cache                  │
│  Components: layout, theater, navigator, modals         │
│  tauriApi.ts: typed wrappers for all invoke() calls     │
│                                                          │
│  No direct DB access. No HTTP requests.                 │
│  No sensitive data in memory.                           │
└─────────────────────────────────────────────────────────┘
```

All business logic, data access, and network calls happen in the Rust process. The WebView is a pure rendering and interaction layer.

---

## IPC Boundary

The frontend communicates with the backend through two mechanisms:

**`invoke()` — request/response**
The frontend calls a typed Tauri command and awaits a result. All `invoke()` calls are wrapped in typed async functions in `src/lib/tauriApi.ts`. No raw `invoke("command_name", {...})` appears in component code.

**Tauri events — backend-to-frontend push**
The backend emits named events for state changes that the frontend needs to react to without polling. Examples: `message_chunk` (streaming token), `vault_updated`, `cache_state_changed`. Listeners are registered in `useEffect` hooks and always cleaned up on unmount.

**What crosses the boundary (safe to send):**
- IDs (story ID, message ID, world ID)
- Serialised content (story text, document content, settings values)
- Metadata (token counts, model names, timestamps)
- Status booleans (is_stale, is_collapsed)
- Error messages (containing no sensitive values)

**What never crosses the boundary:**
- Master key or API key bytes
- PBKDF2 salt
- Any internal Rust state

---

## Encryption Boundary

```
Unencrypted                │  Encrypted (AES-256, SQLCipher)
───────────────────────────┼─────────────────────────────────
app_config.json            │  app_settings.db
  - world list             │    - API key
  - PBKDF2 salt            │    - app-level settings
  - key sentinel           │    - cache TTL default, model
                           │    - all `prompt_*` overrides
world_meta.json (per-world)│
  - name, tags, accent     │  loom.db (per-world)
  - cover image path       │    - all stories
                           │    - all messages
AppState (Rust memory)     │    - all source documents
  - master_key (zeroed     │    - world-level setting overrides
    on lock)               │    - templates, telemetry
  - api_key (zeroed        │    - cache_state, attachment_history
    on lock)               │    - creator_messages
```

The master key exists in Rust memory only for as long as the vault is unlocked. On lock (manual or auto-lock timer), it is overwritten with `0x00` using `zeroize` and the DB connection is closed.

---

## State Lifecycle

### Three app phases

The entire application is one of three mutually exclusive phases, rendered conditionally in `App.tsx`. No router library.

```
app_config.json missing
or onboarding_complete = false
         │
         ▼
  ┌─────────────┐
  │  Onboarding │  First-ever launch; guided setup wizard
  └──────┬──────┘
         │ wizard complete
         ▼
  ┌─────────────┐     wrong password
  │   Locked    │ ◄──────────────────┐
  └──────┬──────┘                    │
         │ correct password           │
         ▼                           │
  ┌─────────────┐     manual lock    │
  │  Workspace  │ ───────────────────┘
  └─────────────┘     auto-lock timer expires
```

`appStore.appPhase`: `"onboarding" | "locked" | "workspace"`

### Modes — workspace sub-state

Within the Workspace phase, the active mode is a sub-state managed by `modeStore`. It does not change the app phase — the user stays in Workspace when switching modes.

```
Workspace
  └── modeStore.activeMode: "story" | "handover" | "consulting"
```

**Important:** Only `story` mode is fully defined and stable. Additional modes (`handover`, `consulting`) are planned and will be implemented, but their detailed behavior is still being designed. The mode architecture is built to accommodate new modes cleanly — adding a mode must not require structural changes to existing code. See Doc 23 (Modes) for current definitions and open questions.

### `isGenerating` — global flag

`workspaceStore.isGenerating` is `true` during any AI generation request, regardless of which mode initiated it. This single flag:

- Disables the Send button across all modes
- Triggers a confirmation dialog if the user attempts to lock or switch worlds
- Is set to `false` when the stream ends, is cancelled, or errors

The flag is global because the rate limiter is global — two concurrent generation requests would compete for the same RPM/TPM budget with no coordination. If a future mode requires a genuinely independent generation pipeline, this is a D-07 amendment.

### World switching

Switching worlds from the World Picker:

1. If `isGenerating`, show confirmation dialog
2. Cancel any in-flight generation (`cancel_tx.send()`)
3. Close the current world's `active_conn`
4. Open the new world's `loom.db` using the existing `AppState.master_key` (key is **not** zeroed and **not** re-derived — see D-07)
5. Load the new world's vault tree and settings
6. Restore `last_open_story_id` if set; otherwise show vault empty state
7. Reset all workspace-scoped store state (messages, mode, accordion, cache)

All worlds share the same master key (single PBKDF2 salt in `app_config.json`), so a world switch is a connection swap, not an auth event. `app_settings.db` and `AppState.master_key` are untouched. The master key is zeroed only on lock or app close.

### Auto-lock

Configured via Settings. Default: 15 minutes of UI inactivity. The timer resets on any meaningful UI activity (keystroke, scroll, click, generation completion) — see Doc 13 for the full reset rule. On trigger:

1. Same as manual lock: zero master key, close DB connection
2. App phase transitions to `"locked"`
3. On unlock, full state is restored (last open story, vault tree, settings)

---

## Network Boundary

Only one external host is permitted: `generativelanguage.googleapis.com` (Gemini API).

All HTTP is made by the Rust backend using `reqwest`. The WebView's Content Security Policy is set to `connect-src 'none'` — the frontend cannot make HTTP requests at all. This is enforced at the platform level, not just by convention.

**No other network activity:**
- No analytics or telemetry
- No update checks that phone home
- No font CDN (all fonts are bundled woff2 files)
- No external image or icon resources

---

## File System Layout

All application data lives under the OS app data directory:

```
{app_data_dir}/
└── loom/
    ├── app_config.json          ← world list, PBKDF2 salt, key sentinel (unencrypted)
    ├── app_settings.db          ← SQLCipher: API key + app-level settings
    └── worlds/
        └── {world-uuid}/
            ├── loom.db          ← SQLCipher: per-world encrypted database
            └── world_meta.json  ← unencrypted display cache (name, accent, tags)
```

| Platform | `{app_data_dir}` |
|---|---|
| Windows | `%APPDATA%\` (`C:\Users\{user}\AppData\Roaming\`) |
| macOS | `~/Library/Application Support/` |
| Linux | `~/.local/share/` |

Tauri's `app_data_dir()` resolves this at runtime — no hardcoded paths.

All writes to `app_config.json` and `world_meta.json` are atomic: write to `{filename}.tmp`, then `fs::rename`. This prevents config corruption from a partial write or crash.
