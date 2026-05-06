# 13 — Auth and Onboarding

> **Status:** Complete
> **Last updated:** 2026-04-27 — consultant pass: auto-lock now resets on any meaningful UI activity (was: generation only); world-switch behavior clarified per D-07

First-launch setup, lock/unlock, auto-lock, password change, and API key lifecycle.

---

## Overview

LOOM is encrypted at rest. The master password is required on every launch. There is no cloud sync, no recovery email, no password reset — the password is the only key. If it is lost, the encrypted data is permanently inaccessible.

Authentication has three phases, corresponding to the three app phases in `appStore`:

| Phase | Condition | UI |
|---|---|---|
| `onboarding` | `app_config.json` does not exist | Two-step setup wizard |
| `locked` | Config exists, vault is locked | Lock screen |
| `workspace` | Vault is unlocked | Main workspace |

Phase transitions are managed by `authStore`. The frontend never reads the master key or any derived bytes.

---

## User Flows

### First Launch (Onboarding)

**Trigger:** `app_config.json` does not exist in the platform config directory.

**Steps:**

```
Step 1 — Create master password
  ├── Password field (type="password")
  ├── Confirm password field
  ├── Validation: min 8 chars, fields must match
  └── [Continue]

Step 2 — Enter API key
  ├── API key field (type="password", masked)
  ├── Subtext: "Your Gemini API key. Never sent anywhere except Google's API."
  ├── [Skip for now] → proceeds without API key; Send is disabled until key is added
  └── [Finish]
```

**On Finish:**
1. Backend derives master key via PBKDF2 (new random 32-byte salt)
2. Backend creates and writes `app_config.json` (sentinel + salt)
3. Backend opens (creates) `app_settings.db`, writes API key if provided
4. `appStore.appPhase` → `'workspace'`

**Skip API key:** The user can skip Step 2 and add the API key later in Settings. Until an API key is configured, the Send button is disabled with the label "Add API key in Settings".

---

### Unlock (Returning User)

**Trigger:** `app_config.json` exists.

**Layout:**
```
┌───────────────────────────────────┐
│                                   │
│         LOOM                      │  ← wordmark, --color-text-primary
│                                   │
│   [Password field          ]      │
│   [Unlock                  ]      │
│                                   │
└───────────────────────────────────┘
```

**On submit:**
1. Backend derives key from entered password + stored salt
2. Backend verifies key against sentinel
3. On success: opens `app_settings.db`, loads API key into `AppState.api_key`, transitions to `'workspace'`
4. On failure: inline error "Incorrect password." — field clears, focus returns to input

**No submission rate limiting** at this layer — the PBKDF2 cost (200k iterations) is the natural throttle.

---

### Lock (Manual)

**Trigger:** User clicks Lock in the workspace (location defined in feature docs for Settings/toolbar).

If generation is in progress, a confirmation dialog appears first (see Doc 11 — Confirmation Dialogs).

**On lock:**
1. Backend: `AppState.master_key.zeroize()`, `AppState.api_key.zeroize()`, closes `settings_conn` and `active_conn`
2. `appStore.appPhase` → `'locked'`
3. All workspace state clears (`vaultStore`, `workspaceStore`, `cacheStore`, `modeStore` reset to empty)

---

### Auto-Lock

**Timer:** Configurable in Settings. Default: 900 seconds (15 minutes). Stored in `app_settings.db` under `auto_lock_secs`.

**Reset events:** The timer resets on any meaningful user activity:
- Keystroke in any input or editor (Theater InputArea, DocEditor, modal fields, Navigator filter)
- Mouse click on any interactive element
- Scroll within any pane
- Completed AI generation (story, ghostwriter, accordion summary, handover)

The timer does **not** reset on raw mouse-move events — those are too cheap to be a meaningful signal of user presence.

**Implementation note:** A single document-level listener attached in `App.tsx` handles `keydown`, `click`, and a throttled `scroll` (250 ms). The listener calls `authStore.resetAutoLockTimer()`. Components do not register their own activity listeners.

**On timer expiry:**
- If generation is **not** in progress: lock immediately (same sequence as manual lock)
- If generation **is** in progress: wait for generation to complete, then lock

**Timer management:** `authStore` holds the timer handle. Started on unlock, cleared on lock.

```typescript
// authStore
startAutoLockTimer(secs: number): void   // called on unlock
resetAutoLockTimer(): void               // called on user activity and on generation completion
clearAutoLockTimer(): void               // called on lock
```

---

### Password Change

**Location:** Settings → Security.

**Steps:**
1. Current password field
2. New password field (min 8 chars)
3. Confirm new password field
4. [Change Password]

**On submit:**
1. Backend verifies current password against sentinel
2. On failure: inline error "Incorrect password."
3. On success:
   - New random 32-byte salt generated
   - New master key derived from new password + new salt
   - New sentinel created with new key
   - `app_config.json` rewritten atomically (new salt + new sentinel)
   - `app_settings.db` rekeyed with new master key (SQLCipher `PRAGMA rekey`)
   - All world `loom.db` files rekeyed with new master key
   - Old key zeroed
   - `AppState.master_key` updated to new key
4. Success toast: "Password changed."

**World rekeying:** Each world DB is opened with the old key, rekeyed with `PRAGMA rekey`, then closed. This is done sequentially for all worlds in `app_config.json`. If any rekey fails, the operation is aborted and the error is reported — the old key remains active.

---

### API Key Update

**Location:** Settings → General (or API section).

**Flow:** Single field, masked. [Save] button.

**On save:**
1. Backend writes new key to `app_settings.db`
2. Backend updates `AppState.api_key`
3. Success toast: "API key saved."
4. If the Send button was previously disabled due to missing key, it re-enables immediately

---

## Data Requirements

### app_config.json

Written on first launch, read on every subsequent launch.

```typescript
interface AppConfig {
  worlds: WorldEntry[];
  active_world_id: string | null;
  salt_hex: string;                                         // 32-byte PBKDF2 salt, hex-encoded
  key_check: { nonce_hex: string; ciphertext_hex: string }; // AES-256-GCM sentinel
}
```

### app_settings.db

Opened on unlock, closed on lock. Single `app_settings` table (key-value). See Doc 03 for full key list.

Auth-relevant keys: `api_key`, `auto_lock_secs`.

### authStore state

```typescript
interface AuthStore {
  // State
  isLocked: boolean;
  hasApiKey: boolean;           // boolean only — key bytes never in frontend
  autoLockSecs: number;         // loaded from app_settings on unlock
  autoLockTimerHandle: ReturnType<typeof setTimeout> | null;

  // Actions
  unlock(): Promise<void>;
  lock(): void;
  startAutoLockTimer(): void;
  resetAutoLockTimer(): void;
  clearAutoLockTimer(): void;
  setHasApiKey(val: boolean): void;
}
```

---

## Backend Commands

Populates the auth section of Doc 07 (IPC Contracts).

```
check_onboarding() -> Result<bool>
  Returns true if app_config.json exists and onboarding is complete; false if first launch.

setup_vault(password: String, api_key: Option<String>) -> Result<()>
  Creates app_config.json, derives master key, creates sentinel, opens app_settings.db,
  writes API key if provided. Only valid when no config exists.

unlock_vault(password: String) -> Result<UnlockResult>
  Verifies sentinel, opens app_settings.db, loads api_key into AppState.
  Returns: UnlockResult { has_api_key: bool, auto_lock_secs: u64 }

lock_vault() -> Result<()>
  Zeros master_key and api_key in AppState. Closes settings_conn and active_conn.

change_password(current: String, new_password: String) -> Result<()>
  Verifies current, generates new salt, derives new key, rewrites sentinel,
  rekeys app_settings.db and all world loom.db files.

set_api_key(key: String) -> Result<()>
  Writes key to app_settings.db and AppState. Requires unlocked vault.

has_api_key() -> Result<bool>
  Returns whether a non-empty API key is configured. Does not return the key.
```

---

## Edge Cases and Error Handling

| Scenario | Behaviour |
|---|---|
| Password mismatch on setup | Inline validation, [Finish] stays disabled |
| Incorrect password on unlock | "Incorrect password." inline; field clears |
| `app_config.json` missing on non-first-launch | Treated as first launch — onboarding shown |
| `app_config.json` corrupt / unreadable | Error toast: "Cannot read configuration file. LOOM may need to be reinstalled." Workspace blocked. |
| `app_settings.db` cannot be opened after correct password | Error toast: "Cannot open settings database." Lock screen shown. |
| World rekey failure during password change | Abort, report error, old key remains active |
| Auto-lock fires during generation | Wait for generation to finish, then lock |
| API key saved while Send is disabled | Send re-enables immediately |

---

## Out of Scope

- Password recovery (by design — encrypted data is irrecoverable without the password)
- Biometric unlock / OS keychain integration
- Multi-user accounts
- Remote vault access
