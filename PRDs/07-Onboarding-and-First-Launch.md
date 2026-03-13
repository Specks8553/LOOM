# 07 — Onboarding and First Launch

## Purpose

This document specifies the first-launch onboarding experience in LOOM. Onboarding
is a multi-step wizard that collects the three required inputs before the workspace
is accessible: master password, Gemini API key, and first world name. Onboarding
runs exactly once — on first launch when `app_config.json` does not exist.

> **Coding-agent note:** Onboarding state is tracked via a single flag in
> `localStorage`: `onboarding_complete = "true"`. The `App.tsx` root router
> checks this flag combined with `check_app_config()` on mount. If either is
> absent, the workspace is replaced by `<OnboardingWizard />`. On successful
> completion, the flag is set and the app transitions into the workspace.
> The API key **never** touches localStorage — see §3 (Step 3) for the
> authoritative key lifecycle.

---

## 1. Trigger Condition

Onboarding runs when **either** of the following is true on app launch:

1. `localStorage.getItem("onboarding_complete") !== "true"`
2. `check_app_config()` returns `false` (app_config.json missing)

If `app_config.json` exists but `onboarding_complete` is missing (corrupted
localStorage), the app skips onboarding and shows the Lock Screen.

If `app_config.json` is missing but `onboarding_complete === "true"`, the
**Recovery Screen** is shown instead of onboarding (see §6).

---

## 2. Wizard Structure

The wizard is a **modal dialog** rendered over a plain dark background
(`--color-bg-base`). The workspace does not exist yet — this is a pre-workspace
state.

### 2.1 Modal Dimensions

- Width: `480px`
- Border-radius: `8px`
- Background: `--color-bg-elevated`
- Border: `1px solid --color-border`
- Cannot be dismissed by clicking outside or pressing Escape

### 2.2 Step Indicator

```
                ● ● ○ ○
```

- Filled dot (`--color-accent`): completed or current step
- Empty dot (`--color-border`): upcoming step
- 4 dots total
- `8px` gap, `6px` dot diameter, centered

### 2.3 Navigation Buttons

- `[Back]` left (ghost style) — hidden on step 1
- `[Next →]` / `[Get Started →]` right (accent background)
- Next disabled until current step's required fields are valid
- Final step label: `[Get Started →]`

---

## 3. Steps

### Step 1 — Welcome

```
┌─────────────────────────────────────────────────────┐
│                                                      │
│                    LOOM                              │
│                                                      │
│         Your private AI writing companion.           │
│                                                      │
│   Everything you write stays on your device,         │
│   encrypted with a password only you know.           │
│                                                      │
│                              ● ○ ○ ○                 │
│                              [Next →]                │
└─────────────────────────────────────────────────────┘
```

- Wordmark: `28px`, Inter 600, letter-spacing `0.15em`
- Subtitle: `15px`, `--font-theater-body`, `--color-text-secondary`
- Body: `13px`, Inter, `--color-text-muted`, `max-width: 340px`, centered
- Next always enabled — no inputs

---

### Step 2 — Create Master Password

```
┌─────────────────────────────────────────────────────┐
│  Create a Master Password                            │
│                                                      │
│  This password encrypts all your data. It cannot     │
│  be recovered if lost.                               │
│                                                      │
│  Password           [ ••••••••••  👁 ]               │
│  At least 8 characters.                              │
│                                                      │
│  Confirm password   [ ••••••••••  👁 ]               │
│                                                      │
│  ✕  Passwords do not match.                          │
│                              ● ● ○ ○                 │
│  [← Back]                    [Next →]               │
└─────────────────────────────────────────────────────┘
```

**Validation:**
- Min 8 characters — hint always visible, turns `--color-success` when met
- Mismatch error shown only after confirm field is blurred once
- Next disabled until: `password.length >= 8 AND password === confirm`
- No strength meter — only minimum length requirement

**On Next:**
1. Call `create_app_config(password)` Tauri command:
   - Generates random 32-byte salt
   - Derives key: PBKDF2-HMAC-SHA256, 200,000 iterations (see `11-App-Lifecycle-and-State-Management.md §5.1`)
   - Creates **key verification sentinel** (AES-256-GCM encrypted known-plaintext, see `11-App-Lifecycle-and-State-Management.md §5.3`)
   - Writes `app_config.json` with salt + iteration count + sentinel
2. Show inline spinner during derivation (Next replaced by `lucide-react Loader2`)
3. On success: advance to step 3
4. On error: inline error below confirm field

---

### Step 3 — Connect to Gemini

```
┌─────────────────────────────────────────────────────┐
│  Connect to Gemini                                   │
│                                                      │
│  LOOM uses the Gemini API to generate story text.    │
│  You will need a free API key from Google.           │
│                                                      │
│  ▸ How to get your API key                           │
│    1. Go to Google AI Studio (aistudio.google.com)   │
│    2. Sign in with your Google account               │
│    3. Click "Get API key" → "Create API key"         │
│    4. Copy the key and paste it below                │
│                                                      │
│  Your key stays on your device, encrypted with       │
│  your password. It is never sent to Anthropic        │
│  or any other party.                                 │
│                                                      │
│  API Key  [ ••••••••••••••••••••••  👁 ]             │
│                                                      │
│  [ Test Key ]   ✓ Key is valid.                      │
│                                                      │
│              ● ● ● ○                                 │
│  [← Back]                    [Next →]               │
└─────────────────────────────────────────────────────┘
```

**API Key Lifecycle (authoritative — key NEVER touches localStorage):**

```
1. User types key in input field
2. User clicks [Test Key]  (optional but recommended)
3. Frontend calls validate_and_store_api_key(key)
   ↓ Rust:
4. Tests key: GET generativelanguage.googleapis.com/v1beta/models
   (minimal API call — lists available models)
5. On success:
   a. Store key in AppState.api_key (memory only at this stage)
   b. Return Ok(())
6. On failure:
   Return Err(LoomError::ApiKeyInvalid(...))
7. Frontend shows ✓ or ✕ feedback
   Key NEVER touches JS memory beyond the input field
```

Key is persisted to the world DB in Step 4 when `create_world` is called.
This is the only path — `localStorage` and `app_config.json` never hold the key.

**Test Key flow:**
1. Call `validate_and_store_api_key(key)` Tauri command
2. Button shows `lucide-react Loader2` spinner during test
3. On success: green `✓ Key is valid.` (`--color-success`, `12px`)
4. On failure: rose `✕ Key rejected by Gemini. Check and try again.` (`--color-error`, `12px`)

**Next button:** Enabled as soon as the key field is non-empty, regardless of
whether `[Test Key]` was clicked. User is not forced to validate.

**"How to get your API key"** section: collapsible by default, expanded on first
view. Provides a 4-step guide with a direct link to `https://aistudio.google.com`.

---

### Step 4 — Create Your First World

```
┌─────────────────────────────────────────────────────┐
│  Create Your First World                             │
│                                                      │
│  A world holds all the stories, documents, and       │
│  settings for one creative project.                  │
│  You can create more worlds later.                   │
│                                                      │
│  World name  [ My World                           ]  │
│                                                      │
│  ── or ──                                            │
│                                                      │
│  [ ↑ Import an existing world (.loom-backup) ]       │
│                                                      │
│              ● ● ● ●                                 │
│  [← Back]               [Get Started →]             │
└─────────────────────────────────────────────────────┘
```

**World name field:**
- `<input type="text">`, min 2 chars, max 80 chars
- Default placeholder: `"My World"`
- `[Get Started →]` disabled until name ≥ 2 chars

**On `[Get Started →]`:**
1. Call `create_world(name, tags)` Tauri command (tags default to `[]` if not provided):
   - Creates world directory and `loom.db`
   - Runs `init_schema()` to create all tables with defaults
   - **Writes `AppState.api_key` to `settings` table** key `gemini_api_key`
     (this is the moment the key leaves memory and is persisted to encrypted DB)
   - Creates auto-start checkpoint for the world (no story yet — stored when first story is created)
   - Returns `WorldMeta`
2. Sets `localStorage.onboarding_complete = "true"`
3. `authStore.isUnlocked = true`
4. `uiStore.appPhase = "workspace"`
5. Triggers recovery file prompt (see §5)

**Import existing world:**
- Clicking `[↑ Import an existing world]` → `tauri-plugin-dialog: open()` filtered to `.loom-backup`
- Calls `vault_import_world(src_path)` Tauri command
- On success: `onboarding_complete = true`, app transitions to workspace with imported world active

---

## 4. `create_world` Tauri Command (Extended)

```rust
#[tauri::command]
pub async fn create_world(
    state: tauri::State<'_, AppState>,
    name: String,
    tags: Option<Vec<String>>,  // defaults to [] if None
) -> Result<WorldMeta, LoomError> {
    // 1. Generate world UUID and directory
    // 2. Create loom.db, run init_schema()
    // 3. Write AppState.api_key → settings table (gemini_api_key)
    //    AppState.api_key is cleared after write (no longer needed in memory
    //    — it will be read from DB on next unlock via load_api_key())
    // 4. Write world_meta.json with default accent_color: "#7c3aed"
    // 5. Return WorldMeta
}
```

---

## 5. Recovery File Prompt

After successful first world creation, LOOM prompts the user to save a recovery file:

```
┌─────────────────────────────────────────────────────┐
│  Save your recovery file                             │
│                                                      │
│  If LOOM's configuration is ever lost, this file     │
│  lets you restore access to your worlds.             │
│                                                      │
│  It contains only technical parameters — not your    │
│  password or any of your writing.                    │
│                                                      │
│  Store it somewhere safe, separate from your worlds. │
│                                                      │
│             [Skip]       [Save Recovery File →]      │
└─────────────────────────────────────────────────────┘
```

`[Save Recovery File →]` → `tauri-plugin-dialog: save()` → writes `loom_recovery.json`:

```json
{
  "loom_recovery_version": 1,
  "created_at": "2026-03-07T17:00:00Z",
  "pbkdf2_salt_hex": "a3f1…",
  "pbkdf2_iterations": 200000,
  "pbkdf2_algorithm": "HMAC-SHA256",
  "warning": "This file does NOT contain your password or encryption key."
}
```

Recovery file is regenerated (and re-prompt shown) after every successful
`change_master_password` call since the salt changes.

---

## 6. Recovery Screen

Shown when `onboarding_complete === "true"` AND `app_config.json` is missing:

```
┌─────────────────────────────────────────────────────┐
│                    LOOM                              │
│                                                      │
│  Configuration file missing.                         │
│                                                      │
│  Your worlds are intact but LOOM needs your          │
│  recovery file to restore access.                    │
│                                                      │
│  [ Import Recovery File ]   [ Fresh Install ]        │
└─────────────────────────────────────────────────────┘
```

- `[Import Recovery File]`: `dialog.open()` → reads `loom_recovery.json` →
  calls `restore_app_config(recovery_data)` → restores `app_config.json` →
  proceeds to Lock Screen
- `[Fresh Install]`: clears `localStorage.onboarding_complete` → starts
  full Onboarding (existing world DBs are orphaned but not deleted)

---

## 7. Tauri Commands

| Command | Parameters | Returns |
|---|---|---|
| `check_app_config` | — | `bool` |
| `create_app_config` | `password: String` | `()` |
| `validate_and_store_api_key` | `key: String` | `()` (Ok or Err) |
| `create_world` | `name: String, tags: Option<Vec<String>>` | `WorldMeta` |
| `vault_import_world` | `src_path: String` | `WorldMeta` |
| `restore_app_config` | `recovery: RecoveryData` | `()` |
