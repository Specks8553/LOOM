# 02 — Security Model

> **Status:** Complete
> **Last updated:** 2026-05-03 — pre-implementation audit resolution: Red Line 2 corrected to reference `app_settings.db` (CD-10); Amendment A-02-A retained as the change record.
> **Earlier:** 2026-04-26

All security rules live here. No security facts are defined in other docs — they reference this one.

---

## Red Lines

These cannot be relaxed, deferred, or worked around. Any change that would violate a red line must be stopped and redesigned before proceeding.

1. The **master key** exists only in `AppState` (Rust memory). It is zeroed on lock and on app close. It never appears in logs, IPC responses, localStorage, or any file.
2. The **API key** exists only in `AppState` and the encrypted `app_settings.db`. It never appears in localStorage, `app_config.json`, frontend memory, URL params, IPC responses, or log output.
3. **User content** (message text, feedback, document content) is never logged. Log only IDs and metadata.
4. `app_config.json` never contains the master key, API key, or any user content.
5. **No external network requests** except to `generativelanguage.googleapis.com` (Gemini API). No analytics, no telemetry, no font CDN.
6. **New PBKDF2 salt + new key sentinel** are generated on every password change.
7. **Atomic file writes** for all config files — write to `.tmp` then `fs::rename`. Applies to `app_config.json`, `world_meta.json`, any config file written by the backend.

---

## Encryption Architecture

### One encrypted database per World

Each World has its own `loom.db` encrypted with SQLCipher (AES-256). The encryption key is derived from the master password using PBKDF2. Only one database connection is open at a time — world switching closes the current connection and opens another.

### Key derivation

```
PBKDF2-HMAC-SHA256(
  password: user's master password,
  salt:     32-byte random salt (stored in app_config.json),
  rounds:   200,000,
  output:   32 bytes  →  master key
)
```

The 32-byte master key is passed directly to SQLCipher as the database encryption key.

### Sentinel scheme

Password correctness is verified by decrypting an AES-256-GCM sentinel in `app_config.json` — not by attempting to open a database. This means:

- Password verification works even when no World databases exist yet
- A wrong password fails fast at the sentinel, before touching any DB
- The sentinel contains no user data — only a known plaintext (`"LOOM_KEY_CHECK"`) encrypted with the derived key

`app_config.json` contains:
- `salt_hex` — the PBKDF2 salt (32 bytes, hex-encoded)
- `key_check.nonce_hex` — AES-256-GCM nonce (12 bytes, hex-encoded)
- `key_check.ciphertext_hex` — encrypted sentinel ciphertext (hex-encoded)
- `worlds` — list of world metadata (ID, name, DB path)

### SQLCipher setup

Immediately after opening a connection:
```sql
PRAGMA key = "x'<32-byte-key-as-hex>'";
```

The key is formatted as a raw hex key (not a passphrase) to avoid SQLCipher's internal key derivation.

---

## Key Lifecycle

### Master key

| Event | Action |
|---|---|
| Onboarding — password created | PBKDF2 derives key; sentinel created; key stored in `AppState.master_key` |
| Launch — password entered | PBKDF2 derives key; sentinel verified; key stored in `AppState.master_key` |
| World opened | Existing `AppState.master_key` passed to SQLCipher PRAGMA; connection stored in `AppState.active_conn` |
| World switched | Current `active_conn` closed; new world's `loom.db` opened with the same `AppState.master_key` (key is **not** re-derived, **not** zeroed) |
| App locked (manual or auto-lock) | `AppState.master_key` zeroed with `zeroize`; `settings_conn` and `active_conn` closed |
| App closed | Same as lock |
| Password changed | New random salt generated; new key derived; new sentinel created; `app_settings.db` and all World DBs rekeyed; old key zeroed |

**World switching does not touch the key.** All worlds share the single PBKDF2 salt in `app_config.json` and therefore the single master key in `AppState`. World switching is a connection swap, not an auth event. The key is zeroed only on lock or app close.

### API key

| Event | Action |
|---|---|
| Onboarding — key entered | Stored in `AppState.api_key` and in `app_settings.db` (app-level encrypted DB) |
| Vault unlocked | API key read from `app_settings.db`; stored in `AppState.api_key` |
| App locked | `AppState.api_key` zeroed |
| API key changed | Updated in `AppState.api_key` and in `app_settings.db` |

#### Amendment — A-02-A (2026-04-26)

API key is stored at **app level** in `app_settings.db`, not per-world. The original entry referenced the per-world `settings` table, which was incorrect. The API key is a single credential for the whole application, not a world-scoped resource. `app_settings.db` is an AES-256 SQLCipher database encrypted with the master key, opened on unlock and closed on lock alongside the world connection.

---

## What the Frontend May Never Touch

| Data | Reason |
|---|---|
| Master key (`[u8; 32]`) | Lives only in Rust `AppState`; zeroed on lock |
| API key | Lives only in Rust `AppState` + encrypted DB; never in JS memory |
| Derived key bytes | Never serialized or sent across IPC |
| Raw message content | Not sent in error messages or event payloads; logged only by ID |
| PBKDF2 salt | Lives in `app_config.json`; never sent to frontend |

The frontend knows only: whether the vault is locked/unlocked, whether an API key is configured (boolean), and user-facing error messages that contain no sensitive values.

---

## Logging Rules

Use the `log` crate. Violations of these rules are bugs:

| Level | Use for |
|---|---|
| `INFO` | Lifecycle events (app start, world open, lock, unlock) |
| `DEBUG` | Request metadata (IDs, token counts, model names, finish reasons) |
| `WARN` | Approaching rate limits, non-fatal anomalies |
| `ERROR` | Failures that affect user-visible behavior |

**Never log:** master key, API key, PBKDF2 salt, message text, user feedback, document content, or any user-generated content. Log only IDs and metadata.

---

## File System Security

### app_config.json

Contains: world list, PBKDF2 salt, key sentinel. No master key, no API key, no user content.

Atomic write: always write to `app_config.json.tmp`, then `fs::rename` to `app_config.json`. This prevents a corrupt config from a partial write.

### world_meta.json

Per-world metadata (name, tags, accent color) cached for fast World Picker rendering without opening the encrypted DB.

Atomic write: same `.tmp` → rename pattern.

### loom.db

Encrypted with SQLCipher. Never opened without the correct key. Never read or written by the frontend directly — all access goes through Tauri commands.

---

## Key Zeroing

All `[u8; 32]` key buffers are overwritten with `0x00` before dropping, using the `zeroize` crate:

```rust
use zeroize::Zeroize;
key.zeroize(); // overwrites all bytes with 0x00
```

This applies to: master key in `AppState`, API key buffer during derivation, any temporary key copies.
