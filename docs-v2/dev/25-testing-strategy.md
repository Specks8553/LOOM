# 25 — Testing Strategy

> **Status:** Stub
> **Scope:** What must be unit-tested, what must be integration-tested, coverage requirements by module, and test patterns. Defined before implementation — not retroactively.

---

## Philosophy

Test the things that are hardest to debug visually: crypto, history assembly, rate limiting, DB logic.

## Rust — Required Unit Tests

### `security/crypto.rs` — key derivation, sentinel encryption/decryption, zeroing
### `services/history.rs` — history assembly, Accordion fake-pair injection
### `services/rate_limiter.rs` — window calculation, persistence
### `db/messages.rs` — insert, load, truncate
### `services/cache.rs` — cache lifecycle, stale detection, TTL expiry

## Rust — Integration Tests

### Full send_message flow (in-memory DB)
### Lock / unlock flow

## TypeScript — Required Tests

### Store logic (pure functions)
### Token counting display
### Theme application

## Test Patterns

### In-Memory SQLite for DB Tests
### Mocking Gemini API
### Mocking Tauri IPC in Frontend Tests

## Coverage Requirements by Module

## What Does Not Need Tests

UI rendering, CSS behavior, Tauri window management.
