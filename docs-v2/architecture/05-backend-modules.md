# 05 — Backend Modules

> **Status:** Complete
> **Last updated:** 2026-05-04 — D-18 (Coding Standards) propagation: cross-references to Doc 24 added for the `with_*` access helpers (SB-5), the typed `AppSettingKey` / `StoryStateKey` settings access (SB-1), the numbered-migrations system (SB-6), and the `tracing` logging crate. Doc 05 owns the canonical contracts; Doc 24 owns the rules. Full SB-4 (cancellation lifecycle) and SB-5 (helper signatures) subsections are scheduled for a dedicated Doc 05 amendment pass.
> **Earlier:** 2026-05-03 — pre-implementation audit resolution: `services/cache.rs` and `services/file_api.rs` added to module map (HB-7); `services/settings.rs` export contract documented (HB-7); `LoomError` enum extended with `Forbidden` and `CacheCreate` variants (HB-6); structured `Validation { kind, key, reason }` payload via `ValidationKind` enum covers `ProtectedSentinel`, `InvalidSettingValue`, `NoBaseline` (HB-6).
> **Earlier:** 2026-04-27 — consultant pass: `services/generation.rs` expanded into `services/generation/` submodule (one file per provider)

Rust module map — what each module owns, what it is forbidden to touch, dependency rules, AppState, LoomError, and the GenerationProvider trait.

---

## Module Structure

```
src-tauri/src/
├── commands/           ← thin Tauri command handlers; one file per domain
│   ├── auth.rs         ← lock, unlock, password change, API key management
│   ├── vault.rs        ← world and vault item CRUD
│   ├── conversation.rs ← send message, edit, delete, load history
│   ├── settings.rs     ← read/write world and story settings
│   ├── cache.rs        ← context cache lifecycle
│   └── modes.rs        ← mode-specific commands (WIP — story mode only initially)
├── services/           ← business logic that is not trivial CRUD
│   ├── history.rs      ← history assembly + Accordion fake-pair substitution
│   ├── gemini.rs       ← Gemini request building + streaming client
│   ├── rate_limiter.rs ← RPM/TPM/RPD window tracking
│   ├── settings.rs     ← cascade resolution: merge world overrides onto app defaults; per-key validators
│   ├── cache.rs        ← cache prefix construction, create/refresh/delete, snapshot rebuild (Doc 22)
│   ├── file_api.rs     ← Gemini File API URI cache (`get_or_upload_file_api_uri`, Doc 19)
│   └── generation/     ← GenerationProvider trait + one file per provider
│       ├── mod.rs      ← trait definition + provider registry
│       ├── image_<provider>.rs  ← image provider implementation(s)
│       └── audio_<provider>.rs  ← audio/TTS provider implementation(s)
├── db/                 ← schema creation + typed DB access functions
│   ├── schema.rs       ← CREATE TABLE statements, seed data, migrations
│   ├── messages.rs     ← message insert, load, truncate, soft delete
│   ├── vault.rs        ← item CRUD, trash, restore
│   └── settings.rs     ← raw key/value r/w for app_settings and world settings
├── security/
│   ├── crypto.rs       ← PBKDF2 key derivation, key zeroing
│   └── sentinel.rs     ← AES-256-GCM sentinel create/verify
├── state.rs            ← AppState definition
├── error.rs            ← LoomError enum
└── lib.rs              ← Tauri command registration only; no logic
```

---

## Dependency Rules

These rules form a strict DAG. No upward or sideways calls. Violations are bugs.

```
lib.rs
  └── commands/         (registration only)
        ├── services/
        │     ├── db/
        │     └── security/
        └── db/
```

| Module | May call | May NOT call |
|---|---|---|
| `lib.rs` | `commands/` (to register) | `services/`, `db/`, `security/`, `state.rs` directly |
| `commands/` | `services/`, `db/`, `state.rs` (read only) | `security/` directly (except `commands/auth.rs`) |
| `commands/auth.rs` | `services/`, `db/`, `security/`, `state.rs` | — |
| `services/` | `db/`, `security/`, `state.rs` (read only) | `commands/` |
| `db/` | `rusqlite` only | All other LOOM modules |
| `security/` | `rand`, `pbkdf2`, `aes-gcm`, `zeroize` only | All other LOOM modules |
| `state.rs` | Defines `AppState` only | No calls outward |
| `error.rs` | Defines `LoomError` only | No calls outward |

**Why `commands/auth.rs` is the only command that touches `security/` directly:** All other commands operate on an already-unlocked vault — the key is derived and stored in `AppState` before any other command runs. Only auth commands deal with raw key material: deriving, verifying, changing, and zeroing it.

---

## AppState

Defined in `state.rs`. Holds only security-sensitive and connection state. No business logic.

```rust
pub struct AppState {
    pub master_key:      Mutex<Option<[u8; 32]>>,  // PBKDF2-derived; zeroed on lock
    pub api_key:         Mutex<Option<String>>,     // Gemini API key; zeroed on lock
    pub settings_conn:   Mutex<Option<Connection>>, // app_settings.db — open for full session
    pub active_conn:     Mutex<Option<Connection>>, // world loom.db — one world at a time
    pub active_world_id: Mutex<Option<String>>,     // UUID of the open world
    pub cancel_tx:       Mutex<Option<tokio::sync::watch::Sender<bool>>>, // stream cancel
}
```

**What AppState does NOT hold:**
- Active mode — passed as a parameter by the frontend on each command call
- Vault tree — frontend state in `vaultStore`
- Message list — frontend state in `workspaceStore`
- Any cached query results

**Locking discipline:** Always acquire locks in a consistent order when holding multiple simultaneously: `master_key` → `api_key` → `settings_conn` → `active_conn` → `active_world_id` → `cancel_tx`. Drop lock guards as soon as they are no longer needed — never hold a lock across an `await` point.

**Access helpers (SB-5).** Direct `.lock()` calls on AppState fields outside `state/access.rs` are forbidden by Doc 24 §AppState Access. The `with_active_conn` / `with_settings_conn` / `with_master_key` / `with_api_key` / `with_active_world_id` / `with_two_conns` helpers wrap acquisition, poison-error mapping, `Option` unwrapping, and the lock-ordering invariant. The full helper-signature spec lands in a follow-up Doc 05 amendment; Doc 24 establishes the rule today.

**Cancellation lifecycle (SB-4).** Per-request `tokio_util::CancellationToken`: created at the start of `send_message` (and any other cancellable command), stored in `AppState.cancel_tx` for the duration of that request, signalled by `cancel_generation`, and dropped on completion. The next request creates a fresh token; cancel of the old one is a no-op on the new. The full contract — including how TTL refresh, accordion summarise, and ghostwriter calls each interact with the token — lands in a follow-up Doc 05 amendment.

**Logging.** Backend uses [`tracing`](https://docs.rs/tracing) + [`tracing-subscriber`](https://docs.rs/tracing-subscriber); the `log` crate is forbidden in v2.0. Per Doc 24 §Logging, never log master key, API key, message text, feedback, document content, or any user-named identifier (world / item / story names). Log IDs and bounded values only.

**`settings_conn` vs `active_conn`:** `settings_conn` holds the `app_settings.db` connection — open for the full session. `active_conn` holds the current world's `loom.db` — replaced on world switch. Commands that need the resolved settings cascade hold both connections briefly; `db/settings.rs` reads from each, `services/settings.rs` merges them.

---

## LoomError

Defined in `error.rs`. The single error type for all Tauri commands. External errors are mapped via `From` implementations — no `.unwrap()` or `.expect()` in production paths.

```rust
#[derive(Debug, thiserror::Error, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LoomError {
    #[error("Crypto error: {0}")]
    Crypto(String),           // key derivation, sentinel, AES-GCM failures

    #[error("Database error: {0}")]
    Database(String),         // rusqlite errors

    #[error("Not found: {0}")]
    NotFound(String),         // requested ID does not exist

    #[error("Validation error: {0}")]
    Validation {
        kind: ValidationKind, // structured discriminator — see below
        key: Option<String>,  // setting key, item id, etc. — when applicable
        reason: String,       // human-readable explanation
    },

    #[error("Forbidden: {0}")]
    Forbidden(String),        // semantically distinct from Validation: the operation
                              // is *prohibited*, not malformed. Example: deleting a
                              // built-in template; mutating a protected sentinel.

    #[error("API error: {0}")]
    ApiError(String),         // Gemini API 4xx / 5xx responses

    #[error("Cache create failed: {0}")]
    CacheCreate(String),      // Gemini cache creation failed (4xx/5xx during cache POST).
                              // Distinct from `ApiError` because the recovery path differs:
                              // the caller falls back to inline assembly for the current
                              // send and retries cache create on the next send (Doc 22 §Fallback).

    #[error("Rate limited: {0}")]
    RateLimited(String),      // RPM / TPM / RPD exceeded

    #[error("IO error: {0}")]
    Io(String),               // file system errors

    #[error("Serialization error: {0}")]
    Serialization(String),    // serde parse / serialization failures

    #[error("Internal error: {0}")]
    Internal(String),         // catch-all for unexpected failures
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ValidationKind {
    Generic,             // bad input, constraint violation, missing precondition
    InvalidSettingValue, // value failed `services/settings.rs` validators
    NoBaseline,          // restore-default called for a key with no hardcoded baseline
    ProtectedSentinel,   // attempted to mutate a protected sentinel (e.g. start checkpoint)
}
```

**Why `Validation` is structured but the rest aren't.** Validation is the variant the frontend most often pattern-matches on for bespoke copy (per-field error messages, restore-default-not-available banners, "you can't delete the start chapter" toasts). A flat string would force display-layer text matching. The other variants either route to a generic toast (`Database`, `Internal`, `ApiError`, `Io`, `Serialization`), need a specific recovery path that the variant alone signals (`CacheCreate`, `RateLimited`, `NotFound`, `Forbidden`), or carry crypto-class semantics that should not surface key/item context (`Crypto`).

**`Forbidden` vs `Validation`.** `Validation` means "the operation could be valid but isn't given these inputs." `Forbidden` means "the operation is structurally not allowed regardless of inputs" (built-in template delete, protected key write). The frontend can render `Forbidden` as a quiet "This isn't editable" inline message rather than a destructive-action error.

**`CacheCreate` vs `ApiError`.** `ApiError` is for Gemini 4xx/5xx that should surface to the user as a generation failure. `CacheCreate` is for Gemini errors specifically during cache POST/PATCH/DELETE — the failure is recoverable internally (fall back to inline assembly), and the user should see at most a quiet toast.

**`From` implementations required for:**
- `rusqlite::Error` → `LoomError::Database`
- `std::io::Error` → `LoomError::Io`
- `serde_json::Error` → `LoomError::Serialization`
- `reqwest::Error` → `LoomError::ApiError`

Every Tauri command returns `Result<T, LoomError>`. The `thiserror` + `serde::Serialize` derive ensures the error message crosses the IPC boundary as a plain string the frontend can display. The frontend maps error variants to display rules per Doc 12 (Empty States and Errors).

---

## Command Registration Pattern

`lib.rs` does nothing except register commands. One `invoke_handler` call, listing every command from every `commands/` module. No logic, no direct DB calls, no service calls.

```rust
// lib.rs — abbreviated example
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            // auth
            commands::auth::unlock_vault,
            commands::auth::lock_vault,
            commands::auth::change_password,
            commands::auth::set_api_key,
            // vault
            commands::vault::create_world,
            commands::vault::list_worlds,
            // ... all other commands
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**Commands are thin.** A command handler should: validate inputs, acquire the AppState lock, call a service or DB function, release the lock, return the result. If a handler grows beyond ~30 lines, the business logic belongs in `services/`.

---

## GenerationProvider Trait

Defined in `services/generation/mod.rs`. Provides a provider-agnostic interface for image and audio generation. Text generation (Gemini) is handled directly in `services/gemini.rs` and does not go through this trait.

```rust
#[async_trait]
pub trait GenerationProvider: Send + Sync {
    fn provider_id(&self) -> &str;

    async fn generate_image(
        &self,
        prompt: &str,
        width: u32,
        height: u32,
        api_key: &str,
    ) -> Result<GeneratedImage, LoomError>;

    async fn generate_audio(
        &self,
        text: &str,
        voice: &str,
        api_key: &str,
    ) -> Result<GeneratedAudio, LoomError>;
}

pub struct GeneratedImage {
    pub data: Vec<u8>,
    pub mime_type: String,
    pub width: u32,
    pub height: u32,
}

pub struct GeneratedAudio {
    pub data: Vec<u8>,
    pub mime_type: String,
    pub duration_secs: f32,
}
```

Concrete implementations live one per file under `services/generation/`, selected at runtime via `provider_id` from the resolved settings cascade. The rest of the backend calls only the trait — never a concrete provider directly. Adding a new provider is one file plus one line in the registry — no other module needs to change.

Providers are TBD (see TODO.md). The trait is defined now so the architecture is in place; implementations are added when providers are chosen.

---

## Module Ownership Summary

| Module | Owns | Forbidden from |
|---|---|---|
| `commands/auth.rs` | Unlock, lock, password change, API key set/clear | Any story or vault logic |
| `commands/vault.rs` | World CRUD, item CRUD, trash, restore | Message logic, settings logic |
| `commands/conversation.rs` | Send message, edit, delete, load history, cancel | Vault logic, auth logic |
| `commands/settings.rs` | App and world settings r/w, story state r/w | Vault CRUD, message logic |
| `commands/cache.rs` | Cache create, refresh, delete, get state | Vault logic, auth logic |
| `commands/modes.rs` | Mode-specific commands (WIP) | Replicating conversation logic |
| `services/history.rs` | Branch assembly, Accordion substitution, fake-pair injection | Making HTTP requests |
| `services/gemini.rs` | Gemini request building, streaming, token counting | DB writes |
| `services/rate_limiter.rs` | RPM/TPM/RPD window tracking, telemetry r/w | Making HTTP requests |
| `services/cache.rs` | Cache prefix construction (`build_cache_prefix`); Gemini cache create / refresh / delete (`create_cache`, `refresh_cache_ttl`, `delete_cache`); stale marking; snapshot reconstruction (`reconstruct_from_snapshot`); cached-message membership test | Frontend exposure (those are command-domain concerns) |
| `services/file_api.rs` | Gemini File API URI cache: `get_or_upload_file_api_uri(conn, item_id, world_dir) -> Result<String>`; uses `items.file_api_uri` / `items.file_api_uploaded_at` with a 47-hour TTL (Doc 19) | Vault item lifecycle outside the URI cache |
| `services/generation/` | GenerationProvider trait (mod.rs) + one file per provider | Story/message logic |
| `db/schema.rs` | Schema creation, seed data, migrations | Business logic |
| `db/messages.rs` | Message insert, load, truncate, soft-delete | Calling services |
| `db/vault.rs` | Item insert, update, delete, trash queries | Calling services |
| `services/settings.rs` | Cascade resolution (world → app → hardcoded fallback); per-key validators (type / range / enum / regex) exported as a typed schema for the frontend; default-value table; restore-default helpers | Making HTTP requests, vault logic |
| `db/settings.rs` | Raw key/value r/w for both app_settings and world settings | Calling services |
| `security/crypto.rs` | PBKDF2 derivation, key zeroing | Anything outside crypto |
| `security/sentinel.rs` | Sentinel create/verify | Anything outside sentinel |
