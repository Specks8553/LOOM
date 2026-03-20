# 14 — Error Handling and Logging

## Purpose

This document specifies LOOM's error taxonomy, surface rules (when to show a
toast, banner, inline message, or modal), the Rust `LoomError` type, client-side
error display, and the logging approach.

---

## 1. Error Taxonomy

### 1.1 `LoomError` (Rust)

```rust
#[derive(Debug, thiserrorError, serdeSerialize)]
pub enum LoomError {
     Crypto  Auth
    #[error(Incorrect password)]
    WrongPassword,

    #[error(Vault is locked)]
    VaultLocked,

    #[error(PBKDF2 key derivation failed {0})]
    KeyDerivation(String),

     Database
    #[error(Database error {0})]
    Database(#[from] rusqliteError),

    #[error(Migration failed {0})]
    Migration(String),

     API  Network
    #[error(API key invalid or rejected)]
    ApiKeyInvalid(String),

    #[error(Rate limited {reason})]
    RateLimited { reason String, wait_ms u64 },

    #[error(Gemini API error {code} {message})]
    GeminiApi { code u16, message String },

    #[error(Network error {0})]
    Network(String),

     File  IO
    #[error(IO error {0})]
    Io(#[from] stdioError),

    #[error(Serialization error {0})]
    Serialization(#[from] serde_jsonError),

     Vault  World
    #[error(World not found {0})]
    WorldNotFound(String),

    #[error(Item not found {0})]
    ItemNotFound(String),

    #[error(World name already in use)]
    WorldNameConflict,

     Content
    #[error(Generation cancelled)]
    GenerationCancelled,

    #[error(Context too large {tokens} tokens)]
    ContextTooLarge { tokens u32 },

     Config
    #[error(App config missing or corrupt)]
    AppConfigCorrupt,

    #[error(Recovery file invalid {0})]
    RecoveryFileInvalid(String),
}
```

All Tauri commands return `ResultT, LoomError`. The `LoomError` type implements
`serdeSerialize` so it can be sent to the frontend as a structured JSON error.

---

## 2. Frontend Error Surface Rules

 Error type  Surface  Component 
---------
 `WrongPassword`  Inline below password field  LockScreen  ChangePassword form 
 `ApiKeyInvalid`  Inline below API key field  Onboarding  Connections 
 `RateLimited`  Amber banner above input  Theater 
 `GeminiApi` (non-429)  Rose banner in Theater  Theater 
 `GeminiApi` (429)  Rose banner + rate banner  Theater 
 `GenerationCancelled`  No UI (expected — user triggered)  — 
 `ContextTooLarge`  Rose banner in Theater  Theater 
 `Database`  Toast (error) + log  Sonner 
 `Io`  Toast (error) + log  Sonner 
 `WorldNotFound`  World Picker shows warning  World Picker 
 `ItemNotFound`  Toast  Sonner 
 `AppConfigCorrupt`  Recovery Screen  App.tsx 
 `Migration`  Blocking modal with error detail  App.tsx 
 All others  Toast (error)  Sonner 

---

## 3. Error Display Components

### 3.1 Theater Error Banner

Generic template (rose)

```
┌──────────────────────────────────────────────────────────────────┐
│  ✕  [Error message]                              [Retry]       │
└──────────────────────────────────────────────────────────────────┘
```

- `[Retry]` shown for `GeminiApi`, `Network` errors — retries last `send_message`
- Not shown for `ContextTooLarge` (no retry possible without user action)
- Dismissed when user successfully sends next message

### 3.2 Inline Field Errors

Appear below the relevant input field

```css
.field-error {
  font-size 12px;
  color var(--color-error);
  margin-top 4px;
}
```

### 3.3 Blocking Migration Error Modal

If `init_schema()` fails (schema migration error), this non-dismissible modal
appears

```
┌──────────────────────────────────────────────────────────────────┐
│  LOOM could not open this world                                 │
│                                                                  │
│  Database migration failed                                      │
│  [technical error message]                                       │
│                                                                  │
│  Your data is intact. Please restart LOOM. If the problem       │
│  persists, check the log file at                               │
│  [log path]                                                      │
│                                                                  │
│                                           [Restart LOOM]        │
└──────────────────────────────────────────────────────────────────┘
```

`[Restart LOOM]` calls `processexit(1)` which triggers OS restart prompt.

---

## 4. Logging

### 4.1 Log File Location

- macOS `~LibraryLogsLOOMloom.log`
- Windows `%APPDATA%LOOMlogsloom.log`
- Linux `~.localshareLOOMlogsloom.log`

Log rotation single file, max `10 MB`. On size exceed rename to `loom.log.1`
(overwrite existing backup), start fresh `loom.log`.

### 4.2 Log Format

```
2026-03-07T170000.000Z [INFO]  App launched — LOOM v0.1.0
2026-03-07T170001.123Z [INFO]  World opened uuid-v4 (Mirrorlands)
2026-03-07T170005.441Z [DEBUG] send_message story=uuid, parent=uuid, tokens_in=14320
2026-03-07T170007.882Z [INFO]  send_message completed, tokens=14632, finish=STOP
2026-03-07T170008.000Z [WARN]  Rate limit approaching RPM 810
2026-03-07T170100.000Z [ERROR] GeminiApi 500 Internal server error
```

### 4.3 Log Level Rules

 Level  When 
------
 `INFO`  App launch, world openclose, lockunlock, settings change, export complete 
 `DEBUG`  Message send (story_id, token counts), API request params (no key, no content) 
 `WARN`  Rate limit  80%, slow DB operations ( 500ms), API retryable errors 
 `ERROR`  Unrecovered errors, LoomError variants, panics 

Never log Master key, API key, user content, message text, feedback text,
document content. Log only IDs and metadata.

### 4.4 Rust Logging

```toml
# Cargo.toml
log  = 0.4
env_logger = 0.11
```

```rust
 src-taurisrcmain.rs
fn main() {
    env_loggerBuildernew()
        .filter_level(logLevelFilterInfo)
        .init();
     ...
}
```

---

## 5. Recovery Scenarios

### 5.1 `app_config.json` Missing

User had LOOM installed, `app_config.json` deleted (accidental or migration).
`onboarding_complete === true` in localStorage.

LOOM shows Recovery Screen (see `07-Onboarding-and-First-Launch.md §6`).
`[Import Recovery File]` restores `app_config.json` from `loom_recovery.json`.
`[Fresh Install]` resets onboarding flag and starts fresh (worlds preserved on disk but orphaned).

### 5.2 World DB Missing (World Listed in `app_config.json` But File Gone)

World Picker shows the world card with a `⚠` badge Database not found.
Clicking the world error toast World database is missing. Restore from backup or remove this world.
Right-click → Remove From List removes the world from `app_config.json` without touching disk.

### 5.3 DB Schema Version Mismatch (Future Migration)

`app_meta` table stores `schema_version`. On `init_schema()`
- If `schema_version  CURRENT_VERSION` run migration scripts in order
- If `schema_version  CURRENT_VERSION` (newer DB, older app) show blocking error modal

---

## 6. Crash Reporting

v1 has no automatic crash reporting. Crashes produce a standard OS crash
report. Users can share the LOOM log file manually for support.

No telemetry, no analytics, no third-party error tracking services are used.
All data stays on the user's device.

---

## 7. Frontend Error Boundary

A top-level React `ErrorBoundary` wraps `Workspace `

```tsx
ErrorBoundary fallback={CrashScreen error={error} logPath={logPath} }
  Workspace 
ErrorBoundary
```

`CrashScreen ` shows
```
Something went wrong.

LOOM encountered an unexpected error. Your data is saved.

[log path]    [Copy Error Details]    [Restart LOOM]
```

`[Restart LOOM]` calls `invoke(restart_app)` (Tauri `processrestart`).