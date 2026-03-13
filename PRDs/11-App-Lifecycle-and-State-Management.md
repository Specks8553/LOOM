# 11 — App Lifecycle and State Management

## Purpose

This document is the **single authoritative reference** for LOOM's complete
application lifecycle: cold launch sequence, routing, screen specifications,
lock/unlock flow, auto-lock, manual lock, world switching, store architecture,
and shutdown cleanup.

> **History:** Formerly split across Doc 01 (App Lifecycle and Routing) and
> Doc 11 (App Lifecycle and State Management). Merged into this single document
> to eliminate duplication and divergence risk.

> **Coding-agent note:** The root component is `src/App.tsx`. It owns the top-level
> rendering between `<OnboardingWizard />`, `<LockScreen />`, and `<Workspace />`.
> The app phase is tracked in `uiStore.appPhase: "onboarding" | "locked" | "workspace"`.
> All routing is **pure conditional rendering** based on Zustand store state.
> There is no router library (no React Router, no TanStack Router).
> All Zustand stores are defined in `src/stores/`. SQLCipher connection lifecycle is
> managed entirely in Rust (`src-tauri/src/db.rs`).

---

## 1. Top-Level State Machine

```
App cold launch
       │
       ▼
Check localStorage.onboarding_complete
AND check_app_config() Tauri command
       │
       ├─ onboarding_complete !== "true"  AND  config missing
       │         ▼
       │    <OnboardingWizard />  (first-ever launch)
       │
       ├─ onboarding_complete === "true"  AND  config missing
       │         ▼
       │    <RecoveryScreen />  (config lost, worlds intact)
       │
       ├─ onboarding_complete !== "true"  AND  config exists
       │         ▼
       │    <LockScreen />  (localStorage corrupted/cleared, skip onboarding)
       │
       └─ onboarding_complete === "true"  AND  config exists
                 ▼
            <LockScreen />
                 │
       ┌─────────┴─────────┐
     [fail]             [success]
       │                   │
    show error             ▼
    stay on         Load last_active_world_id
    LockScreen             │
                  ┌────────┴────────┐
                 NO worlds         YES
                  │                 │
                  ▼                 ▼
        <CreateFirstWorld />   <Workspace />
```

---

## 2. Routing Logic (`App.tsx`)

```tsx
export default function App() {
  const { appPhase } = useUiStore();
  // appPhase: "onboarding" | "locked" | "workspace"

  if (appPhase === "onboarding") return <OnboardingWizard />;
  if (appPhase === "locked")     return <LockScreen />;
  return <Workspace />;
}
```

`uiStore.appPhase` is set on mount after evaluating `localStorage.onboarding_complete`
and `check_app_config()`. The three-state model is authoritative — no other routing
logic exists.

### 2.1 Mount Evaluation (`App.tsx` useEffect on mount)

```ts
const onboardingDone = localStorage.getItem("onboarding_complete") === "true";
const configExists   = await invoke<boolean>("check_app_config");

if (!onboardingDone || !configExists) {
  // Recovery screen if config missing but onboarding was done
  if (onboardingDone && !configExists) {
    useUiStore.getState().setAppPhase("onboarding"); // renders RecoveryScreen
  } else {
    useUiStore.getState().setAppPhase("onboarding");
  }
} else {
  useUiStore.getState().setAppPhase("locked");
}
```

### 2.2 `uiStore.appPhase` Transitions

```
"onboarding" ──[complete]──────→ "workspace"
"locked"     ──[unlock]────────→ "workspace"
"workspace"  ──[lock]──────────→ "locked"
"workspace"  ──[switch world]──→ (stays "workspace", stores reloaded)
```

---

## 3. Cold Launch Sequence

Both `app_config.json` (cryptographic state) and `localStorage` (UI state) are
checked in combination — neither alone is sufficient.

### 3.1 `check_app_config` Command

```rust
#[tauri::command]
pub async fn check_app_config() -> Result<bool, String>
// Returns true if app_config.json exists and is parseable
```

Called on mount in `App.tsx` before rendering any screen.

---

## 4. Screen Specifications

### 4.1 `<OnboardingWizard />` (`src/components/onboarding/OnboardingWizard.tsx`)

**Condition:** `appPhase === "onboarding"`

Full specification in `07-Onboarding-and-First-Launch.md`.

**On completion:**
1. `localStorage.setItem("onboarding_complete", "true")`
2. `authStore.isUnlocked = true`
3. `uiStore.appPhase = "workspace"`

---

### 4.2 `<LockScreen />` (`src/components/auth/LockScreen.tsx`)

**Condition:** `appPhase === "locked"`

Full-screen overlay. No workspace content visible behind it.

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                         LOOM                               │
│                                                             │
│                  [ ••••••••••••  👁 ]                       │
│                    Enter your password                      │
│                                                             │
│                       [ Unlock ]                           │
│                                                             │
│              ✕  Incorrect password.                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

- Password field auto-focused on render
- `Enter` key submits
- Error message shown inline below field on failure
- No lockout mechanism in v1
- Spinner overlay (`authStore.isUnlocking === true`)

---

### 4.3 `<Workspace />` (`src/components/layout/Workspace.tsx`)

**Condition:** `appPhase === "workspace"`

**On mount** (every time workspace renders after unlock):

```
1. Call list_worlds()            → populate vaultStore.worlds
2. Read last_active_world_id     → from settings (key: "app__last_active_world_id")
3. Call switch_world(id)         → open world DB
   - If no last world or missing → show World Picker modal
4. Call vault_list_items("")     → populate vaultStore.items (root level)
5. Call vault_list_trash()       → populate vaultStore.trashItems
6. Call get_context_docs()       → populate controlPaneStore.contextDocs
7. Read last_open_story_id       → from settings
   - If set and story exists     → call load_story_messages(id)
   - If not set or missing       → show <NoStorySelected />
8. Apply world theme             → applyAccentColor(), applyBodyFont(), applyBubbleColors()
9. Start auto-lock timer
10. Render 3-pane layout
```

If `worlds.length === 0` after unlock: render `<CreateFirstWorld />` instead.

---

### 4.4 Empty States (Theater)

| Condition | Theater renders |
|---|---|
| `last_open_story_id` null on mount | `<NoStorySelected />` |
| Story open, `messageMap` empty | `<EmptyStory />` |
| Trash folder selected | Trash view |
| Rate limit active | Amber banner above input, Send disabled |

---

## 5. Unlock Flow

### 5.1 Key Derivation (PBKDF2)

| Parameter | Value |
|---|---|
| Algorithm | PBKDF2-HMAC-SHA-256 |
| Default iterations | 200,000 |
| Salt length | 32 bytes (random, `rand::thread_rng`) |
| Output key length | 32 bytes (matches SQLCipher AES-256) |
| Salt storage | `app_config.json` as hex string |
| Iterations storage | `app_config.json` as integer |

```rust
use pbkdf2::pbkdf2_hmac;
use sha2::Sha256;

pub fn derive_key(password: &str, salt: &[u8], iterations: u32) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, iterations, &mut key);
    key
}
```

### 5.2 Unlock Sequence

```
1. uiStore.isUnlocking = true
2. Call unlock_vault(password) Tauri command
   ↓ Rust:
   a. Read salt + iterations from app_config.json
   b. Derive key: PBKDF2-HMAC-SHA256, stored iterations, stored salt
   c. Verify key against sentinel (see §5.3)
   d. If last_active_world_id exists:
        Attempt SQLCipher PRAGMA key on last active world DB
        Load API key from settings into AppState.api_key
        Load telemetry counters from telemetry table → AppState.rate_limiter
   e. If no world exists: key verified via sentinel, proceed without DB
3. On success:
   a. authStore.isUnlocked = true
   b. uiStore.appPhase = "workspace"
   c. Run Workspace mount sequence (§4.3)
4. On failure:
   a. uiStore.isUnlocking = false
   b. authStore.unlockError = "Incorrect password."
```

### 5.3 Key Verification Sentinel

**Problem:** If all worlds are deleted, no SQLCipher DB exists to verify the
derived key against. The unlock flow must work regardless of world existence.

**Solution:** `app_config.json` stores a `key_check` field — a known plaintext
string encrypted with the derived master key using AES-256-GCM. On unlock,
LOOM decrypts the sentinel with the derived key. If decryption succeeds (GCM
tag validates), the password is correct.

```rust
use aes_gcm::{Aes256Gcm, KeyInit, aead::Aead, Nonce};

pub fn create_sentinel(key: &[u8; 32]) -> SentinelData {
    let cipher = Aes256Gcm::new_from_slice(key).unwrap();
    let nonce_bytes = rand::thread_rng().gen::<[u8; 12]>();
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher.encrypt(nonce, b"LOOM_KEY_CHECK".as_ref()).unwrap();
    SentinelData {
        nonce_hex: hex::encode(nonce_bytes),
        ciphertext_hex: hex::encode(ciphertext),
    }
}

pub fn verify_sentinel(key: &[u8; 32], sentinel: &SentinelData) -> bool {
    let cipher = Aes256Gcm::new_from_slice(key).unwrap();
    let nonce = Nonce::from_slice(&hex::decode(&sentinel.nonce_hex).unwrap());
    let ciphertext = hex::decode(&sentinel.ciphertext_hex).unwrap();
    cipher.decrypt(nonce, ciphertext.as_ref()).is_ok()
}
```

**`app_config.json` extension:**
```json
{
  "version": 1,
  "pbkdf2_salt_hex": "a3f1c8…",
  "pbkdf2_iterations": 200000,
  "key_check": {
    "nonce_hex": "…",
    "ciphertext_hex": "…"
  },
  "active_world_id": "uuid-v4",
  "worlds": [...]
}
```

The sentinel is regenerated on every `change_master_password` call (new key → new sentinel).

**Cargo.toml addition:**
```toml
aes-gcm = "0.10"
hex     = "0.4"
```

---

## 6. Auto-Lock

### 6.1 Configuration

Configured in Settings → General → Auto-Lock.
Stored in `localStorage` key `loom_auto_lock_minutes`.

| Value | Behaviour |
|---|---|
| `"0"` | Disabled (never auto-lock) |
| `"5"` | Lock after 5 minutes inactivity |
| `"15"` | Lock after 15 minutes inactivity (default) |
| `"30"` | Lock after 30 minutes inactivity |
| `"60"` | Lock after 1 hour inactivity |

### 6.2 Inactivity Detection

Activity events reset the timer: `mousemove`, `mousedown`, `keydown`, `wheel`.
Listener registered once on `window` after unlock.

```ts
// src/lib/autoLock.ts
export function initAutoLock() {
  const minutes = parseInt(localStorage.getItem("loom_auto_lock_minutes") ?? "15");
  if (minutes === 0) return;

  let timer: ReturnType<typeof setTimeout>;
  let warnTimer: ReturnType<typeof setTimeout>;

  const reset = () => {
    clearTimeout(timer);
    clearTimeout(warnTimer);
    // Warning toast 60 seconds before lock
    warnTimer = setTimeout(showLockWarning, (minutes * 60 - 60) * 1000);
    timer     = setTimeout(triggerLock, minutes * 60 * 1000);
  };

  ["mousemove", "mousedown", "keydown", "wheel"].forEach(ev =>
    window.addEventListener(ev, reset, { passive: true })
  );
  reset();
}
```

### 6.3 Warning Toast

60 seconds before auto-lock fires:

```
⚠  LOOM will lock in 60 seconds.     [Stay Unlocked]
```

- Sonner toast, `duration: 55000` (shows for 55s)
- `[Stay Unlocked]` resets the inactivity timer and dismisses the toast
- If not dismissed: auto-lock proceeds

### 6.4 Auto-Lock Trigger

Same as Manual Lock (§7) — no behavioral difference from the user's perspective.

---

## 7. Manual Lock

Lock button: `lucide-react Lock`, `16px`, in Navigator bottom action bar.
Keyboard shortcut: `Ctrl+L`.

```
1. If isGenerating === true:
     Show confirmation: "Locking will cancel the current generation. Continue?"
     [Cancel] / [Lock Anyway]
     On "Lock Anyway": call cancel_generation() first

2. Call lock_vault() Tauri command:
   ↓ Rust:
   a. Close active_world_conn (SQLCipher connection)
   b. Zero AppState.master_key (overwrite with 0x00)
   c. Zero AppState.api_key
   d. AppState.rate_limiter state preserved (persisted to DB before close)

3. Frontend — clear all workspace state:
   - workspaceStore: messageMap = {}, currentLeafId = null, isGenerating = false
   - vaultStore: items = [], activeItem = null, selectedItems = clear
   - controlPaneStore: attachedDocIds = clear, contextDocs = []
   - ghostwriterStore: activeMsgId = null, isGenerating = false
   - DO NOT clear: vaultStore.expandedPaths, localStorage.onboarding_complete

4. uiStore.appPhase = "locked"
5. authStore.isUnlocked = false
6. Toast: "LOOM locked."
```

---

## 8. World Switching

### 8.1 Normal Switch

When user selects a different world and `workspaceStore.isGenerating === false`:

1. Close World Picker modal
2. Call `switch_world(world_id)` Tauri command
3. Backend: close current DB, open new world DB with Master Key
4. Frontend: clear stores (same list as manual lock, §7 step 3)
5. Set `activeWorldId = new_world_id`
6. Re-run Workspace mount steps 4–10 (§4.3)
7. Save `new_world_id` to settings key `app__last_active_world_id`

World switching does NOT require re-entering the password.
`uiStore.appPhase` stays `"workspace"` throughout.

### 8.2 Switch During Generation

Show confirmation:
```
Switch world?
A response is being generated. Switching now will cancel it.
The partial response will not be saved.

            [Cancel]   [Switch Anyway]
```

On "Switch Anyway": call `cancel_generation()` then proceed with §8.1.

---

## 9. `isGenerating` Flag — Unified Semantics

**`workspaceStore.isGenerating`** is `true` whenever **any** AI request is
in-flight — including both normal story generation (`send_message`) and
Ghostwriter generation (`send_ghostwriter_request`).

```ts
// Set to true by:
// 1. send_message (normal story generation)
// 2. send_ghostwriter_request (Ghostwriter)
// 3. summarise_segment (Accordion summarisation)

// Set to false when:
// 1. Any of the above completes or is cancelled
```

All UI that checks `isGenerating` (Send button disable, lock confirmation,
world switch confirmation) automatically covers all AI request types.

`ghostwriterStore.isGenerating` is an **additional** flag that tracks
Ghostwriter-specific state (e.g., showing spinner in Ghostwriter toolbar)
but does not replace `workspaceStore.isGenerating`.

---

## 10. Workspace Mount Sequence

Runs after successful unlock and after world switch.

```ts
async function mountWorkspace(worldId: string) {
  // 1. Load vault tree
  const items = await invoke("vault_list_items", { path: "" });
  vaultStore.setItems(items);

  // 2. Load vault trash
  const trash = await invoke("vault_list_trash");
  vaultStore.setTrashItems(trash);

  // 3. Apply world theme
  const settings = await invoke("get_settings_all");
  applyAccentColor(settings.accent_color ?? "#7c3aed");
  applyBodyFont(settings.body_font ?? "serif");
  applyBubbleColors(...);
  applyFeatureColors(...);

  // 4. Load telemetry
  await telemetryStore.refresh();

  // 5. Restore last open story
  const lastStoryId = settings.last_open_story_id;
  if (lastStoryId) {
    const payload = await invoke("load_story_messages", { storyId: lastStoryId });
    workspaceStore.loadStory(payload);
  }

  // 6. Start auto-lock timer
  initAutoLock();
}
```

---

## 11. Store Architecture

### 11.1 `uiStore`

```ts
interface UiStore {
  appPhase:             "onboarding" | "locked" | "workspace";
  rightPaneCollapsed:   boolean;    // localStorage: right_pane_collapsed
  branchMapOpen:        boolean;    // in-memory only
  viewportNarrow:       boolean;    // in-memory, from viewport watcher
  setAppPhase:          (p: AppPhase) => void;
  setRightPaneCollapsed:(v: boolean) => void;
  setBranchMapOpen:     (v: boolean) => void;
  setViewportNarrow:    (v: boolean) => void;
}
```

### 11.2 `authStore`

```ts
interface AuthStore {
  isUnlocked:   boolean;
  isUnlocking:  boolean;
  unlockError:  string | null;
}
```

### 11.3 `workspaceStore`

```ts
interface WorkspaceStore {
  activeStoryId:    string | null;
  currentLeafId:    string | null;
  messageMap:       Map<string, ChatMessage>;
  isGenerating:     boolean;          // true for ANY AI request (send, Ghostwriter, Accordion)
  streamingMsgId:   string | null;
  checkpoints:      Checkpoint[];      // from StoryPayload
  accordionSegments: AccordionSegment[]; // from StoryPayload
  siblingCounts:    SiblingCount[];
}
```

### 11.4 `vaultStore`

```ts
interface VaultStore {
  worlds:         WorldMeta[];
  activeWorldId:  string | null;
  items:          VaultItemMeta[];
  trashItems:     VaultItemMeta[];
  expandedPaths:  Set<string>;      // localStorage: vault_expanded_paths
  activeItem:     VaultItem | null;
  selectedItems:  Set<string>;
  filterQuery:    string;
}
```

### 11.5 `controlPaneStore`

```ts
interface ControlPaneStore {
  contextDocs:    ContextDoc[];
  attachedDocIds: Set<string>;
  feedbackOpen:   boolean;
}
```

### 11.6 `settingsStore`

```ts
interface SettingsStore {
  all: Record<string, string>;    // flat key-value from get_settings_all()
  refresh: () => Promise<void>;
  save: (key: string, value: string) => Promise<void>;
}
```

### 11.7 `telemetryStore`

```ts
interface TelemetryStore {
  text:       ProviderCounters;
  image_gen:  ProviderCounters;
  tts:        ProviderCounters;
  refresh:    () => Promise<void>;
}
```

---

## 12. App Config JSON Schema (`app_config.json`)

```json
{
  "version":           1,
  "pbkdf2_salt_hex":   "a3f1c8…",
  "pbkdf2_iterations": 200000,
  "key_check": {
    "nonce_hex":       "…",
    "ciphertext_hex":  "…"
  },
  "active_world_id":   "uuid-v4",
  "worlds": [
    {
      "id":         "uuid-v4",
      "dir":        "worlds/uuid-v4",
      "deleted_at": null
    }
  ]
}
```

Written atomically (write to `.tmp`, then `fs::rename`). Never contains the
master key or API key. The `key_check` sentinel is regenerated on every
password change.

---

## 13. Viewport Watcher

Initialised once in `App.tsx` after unlock:

```ts
// src/lib/viewportWatcher.ts
export function initViewportWatcher() {
  const check = () => {
    const narrow = window.innerWidth < 1200;
    useUiStore.getState().setViewportNarrow(narrow);
    if (narrow) useUiStore.getState().setRightPaneCollapsed(true);
  };
  window.addEventListener("resize", check);
  check();
}
```

Auto-collapse fires only when crossing 1200px downward.
Does not re-open the pane when window widens.
Minimum window width enforced by Tauri config: `1100px`.

---

## 14. App Close / Crash Behaviour

- Tauri process termination triggers Rust `Drop` on `AppState`
- `Drop` closes the SQLCipher connection
- SQLite WAL journal ensures last committed transaction is the recovery point
- No in-memory state is written to disk during Drop (only normal DB writes matter)
- Master key is zeroed on Drop

---

## 15. Tauri Command Reference (Lifecycle)

| Command | Called when | Returns |
|---|---|---|
| `check_app_config` | App mount | `bool` |
| `unlock_vault` | Lock Screen submit | `()` |
| `lock_vault` | Lock button / auto-lock | `()` |
| `create_app_config` | Onboarding step 2 | `()` |
| `switch_world` | World Picker select | `WorldMeta` |
| `cancel_generation` | Stop button / lock during gen | `()` |
| `list_worlds` | Workspace mount | `Vec<WorldMeta>` |
| `vault_list_items` | Workspace mount | `Vec<VaultItemMeta>` |
| `vault_list_trash` | Workspace mount | `Vec<VaultItemMeta>` |
| `get_context_docs` | Story open | `Vec<ContextDoc>` |
| `load_story_messages` | Story click | `StoryPayload` |
| `get_settings` | Workspace mount | `String` |
