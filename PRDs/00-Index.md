# LOOM — PRD Index

## Overview

LOOM is a local desktop application (Tauri/Rust + React) for AI-assisted
creative writing. It uses the Gemini API for text generation, SQLCipher for
end-to-end encrypted local storage, and a DAG-based conversation structure
supporting full narrative branching.

**Architecture summary:**
- Shell: Tauri v2 (Rust backend + React frontend)
- UI: React 19 + TypeScript 5 + Tailwind CSS + shadcn/ui
- State: Zustand stores
- Database: SQLCipher (one encrypted DB per "World")
- AI: Google Gemini API (text generation; image/TTS stubbed for future)
- Routing: Pure conditional rendering — no router library

---

## Document Index

### Core Architecture

| Doc | Title | Key contents |
|---|---|---|
| 01 | ~~App Lifecycle and Routing~~ | *Merged into Doc 11* |
| 11 | App Lifecycle and State Management | State machine, routing, cold launch, lock/unlock, auto-lock, PBKDF2, key sentinel, store architecture, `app_config.json`, world switch, `isGenerating` semantics |
| 15 | Build and Release | Tech stack, Tauri config, DB schema list, security checklist, crates |

### UI and Design

| Doc | Title | Key contents |
|---|---|---|
| 02 | Design System | Colors, typography, spacing, bubbles, Theater layout, theme runtime |
| 03 | Empty States and Edge-Case UI | Every empty state, banners, error displays, loading states |
| 13 | Keyboard Shortcuts and Accessibility | All shortcuts, Escape chain, focus management |

### Application Screens

| Doc | Title | Key contents |
|---|---|---|
| 07 | Onboarding and First Launch | Wizard steps, API key lifecycle, recovery file, Recovery Screen |
| 05 | Settings Modal | All settings tabs, World vs App scope, defaults table, Tauri commands |
| 04 | Reader View and Export | View modes, Markdown export, Full Branch JSON export |
| 12 | Source Document Viewer and Editor | Editor UI, template placeholders, inline context injection, image docs |

### Vault and Conversation

| Doc | Title | Key contents |
|---|---|---|
| 08 | Vault and World Management | World Picker, world cards, accent color cache, vault tree, multi-select, templates |
| 09 | Conversation and Message System | Message schema, DAG structure, send flow, edit, feedback injection |
| 10 | Control Pane | Story title, Context Docs, System Instructions, Feedback overlay, telemetry bars |

### Infrastructure

| Doc | Title | Key contents |
|---|---|---|
| 06 | Telemetry and Rate Limiting | Rate limiter architecture, RPM/TPM/RPD windows, Ghostwriter rate limiting |
| 14 | Error Handling and Logging | `LoomError` taxonomy, display rules, log format, recovery scenarios |

### Features

| Doc | Title | Key contents |
|---|---|---|
| 16 | Ghostwriter | Text selection, API request, diff display, accept/reject, history, revert |
| 17 | Branch Map | Drawer layout, tree visualisation, checkpoints, branch deletion, live updates |
| 18 | Accordion | Context compression, segments, fake-pair, collapse/expand, history assembly |

### Media System

| Doc | Title | Key contents |
|---|---|---|
| 19 | Media System: Image Uploads | Image items, upload, inline bubbles, Gemini sending, world export |

---

## Key Architectural Decisions

### Security
- Master key derived via PBKDF2-HMAC-SHA256 (200,000 iterations, random 32-byte salt)
- Key stored only in `AppState` (memory), zeroed on lock
- **Key verification sentinel** in `app_config.json` (AES-256-GCM encrypted known-plaintext) — allows password verification without requiring a world DB
- API key stored only in SQLCipher DB + `AppState`, never in localStorage or logs
- New salt + sentinel generated on every password change
- `.loom-backup` files are zip archives; only `loom.db` is individually encrypted

### Data Architecture
- One SQLCipher database per "World"
- Single active DB connection at a time
- `world_meta.json` caches accent color for World Picker (reads without opening DB)
- `story_settings` table for per-story settings (avoids polluting global `settings`)
- `messages.content_type` field for reliable content type detection (no prefix sniffing)
- **History assembly is server-side only.** Frontend sends `(story_id, leaf_id, user_content)`. Backend reconstructs the full branch, applies Accordion substitution (Fake-Pairs), injects feedback, and assembles the complete history for the Gemini API call.
- Accordion Fake-Pairs injected at runtime during history assembly, never persisted

### Feature Interactions

| Feature | Interacts with | Notes |
|---|---|---|
| Ghostwriter | Rate Limiter | Must check/record usage like normal sends |
| Ghostwriter | Accordion | Accept inside collapsed segment → stale toast |
| Ghostwriter | Branch Map | New branch created if editing non-latest message |
| Accordion | Checkpoints | Checkpoints define segment boundaries |
| Accordion | Branch Map | Fork-spanning segments are branch-specific |
| Accordion | Token Counter | Shows sent tokens + saved tokens separately |
| Branch Map | Checkpoints | Checkpoints displayed as markers, manageable in map |
| Feedback | History | Injected as `[WRITER FEEDBACK]` tag in model message content |
| Context Docs | History / Request Assembly | Text docs always inline in current turn (not in history); image docs use Gemini File API |

### Settings Scope
- **App Settings** (in `localStorage`): auto-lock timer, export folder path
- **World Settings** (in `settings` table): everything else including accent color, system instructions, modificator presets, rate limits
- **Story Settings** (in `story_settings` table): leaf_id, context doc IDs, img_gen toggle

---

## Database Tables per World (`loom.db`)

| Table | Purpose |
|---|---|
| `items` | All vault items (stories, folders, docs, images) |
| `messages` | All conversation messages (DAG) |
| `story_settings` | Per-story key-value pairs |
| `checkpoints` | Branch checkpoints (Branch Map + Accordion boundaries) |
| `accordion_segments` | Accordion segment summaries and collapse states |
| `templates` | User-defined Source Document templates |
| `settings` | World-level key-value settings |
| `telemetry` | Rate limiter counters (3 rows) |
| `attachment_history` | Context doc attach/detach audit trail |

---

## Pending / Deferred

| ID | Item | Priority |
|---|---|---|
| M-04 | Finalize Accordion summarisation instruction text (currently editable in Dev settings) | Low |
| M-05 | Token Counter: finalize collapsed segment calculation UX | Low |
| M-07 | Ghostwriter new branch + Accordion inheritance edge cases | Low |
| M-08 | Checkpoint on-purge toast wording | Low |

---

## Not Implemented in v1

- Image generation (Media System v1.1)
- Audio / TTS (Media System v2)
- WCAG accessibility / screen reader support (planned for future release)
- Automatic crash reporting / telemetry
- Auto-update mechanism
- Multi-window support
- Collaboration / sync
- Full-text search across document content and message text (planned for v1.1)
- Raw mode (removed)
