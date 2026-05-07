# 25 — Testing Strategy

> **Status:** Complete
> **Last updated:** 2026-05-07 — written end-to-end (Phase 0.5). Supersedes the stub.
> **Scope:** What to test, what not to, coverage targets per module, concrete test recipes, and the CI matrix. Defined before feature implementation — not retroactively.
> **Authority:** This doc owns the *strategy*. Doc 24 §Testing Conventions owns the *rules* (test placement, naming, no-real-API rule). Recipes here are the canonical implementation pattern for each layer.

---

## Philosophy

Test the things that are hardest to debug visually: crypto, history assembly, rate limiting, DB logic, settings cascade. Do not test what the framework already tests (DOM rendering, CSS layout, Tauri window management). Mock at the narrowest boundary that still exercises the real code path.

Three principles:
1. **Test invariants, not mechanisms.** Name: `cascade_world_override_beats_app_default`, not `test_cascade_1`.
2. **Real DB, fake network.** Unit and integration tests use in-memory SQLite (same migration runner, same schema, no encryption overhead). HTTP is always mocked.
3. **No real Gemini calls in CI.** Ever. Not even behind a feature flag.

---

## Test commands

| Command | When to run | Notes |
|---|---|---|
| `cargo test` | Every commit (pre-commit hook + CI) | All unit + integration tests |
| `cargo test --doc` | CI only | Doctests; minimal coverage but catch stale examples |
| `cargo clippy --all-targets -- -D warnings` | Every commit (CI) | Linting; warnings = fail |
| `pnpm test` | Every commit (pre-commit hook + CI) | Vitest unit + component tests |
| `pnpm test:ui` | Dev-only | Vitest browser UI; never in CI |
| `pnpm typecheck` | Every commit (pre-commit hook + CI) | `tsc --noEmit` |

`pnpm test` maps to `vitest run` (single-pass, no watch). `pnpm test:ui` maps to `vitest --ui`.

---

## Rust — Unit Tests

Unit tests live **alongside the module** in `#[cfg(test)] mod tests { … }` at the bottom of the file (Doc 24 §Testing Conventions). Each test function name describes the invariant being asserted.

### Required modules (CI gates)

| Module | Coverage target | What to test |
|---|---|---|
| `security/crypto.rs` | Exhaustive | PBKDF2 derivation determinism; AES-256-GCM round-trip; wrong-password → `LoomError::Crypto`; zero-length plaintext; zeroize on drop |
| `security/sentinel.rs` | Exhaustive | Encrypt + verify round-trip; wrong-password fails gracefully; corrupt ciphertext fails gracefully |
| `services/history.rs` | High | Story-mode history assembly ordering; accordion fake-pair substitution; handover/consulting session scoping; empty-story edge case |
| `services/rate_limiter.rs` | High | Window calculation; counter increment; reset on window expiry; persistence round-trip |
| `services/settings.rs` | High | Cascade: world override beats app default; app default beats hardcoded fallback; missing world row falls through to app; typed accessor returns correct `T` |
| `services/cache.rs` | High | Prefix construction order (SI → docs → messages); stale detection after edit; TTL expiry logic |

### Encouraged (not gated)

`db/messages.rs`, `db/vault.rs`, `db/settings.rs` — test insert, load, and edge cases (missing row, type mismatch) using the in-memory fixture below.

`commands/` — thin handlers; test only non-trivial guard logic (e.g., `isGenerating` guard returns correct error variant).

---

## Rust — Integration Tests

Integration tests live in `src-tauri/tests/`. Each file is a separate test binary. They use **non-encrypted in-memory SQLite** via `Connection::open_in_memory()` — the encryption layer is tested separately in `security/crypto.rs`.

### In-memory SQLite fixture recipe

The canonical fixture for any test that touches the database:

```rust
// src-tauri/tests/helpers/mod.rs  (shared by all integration tests)

use loom_app_lib::db::migrations::{apply_pending, MigrationRoot};
use rusqlite::Connection;

/// Open an in-memory DB and apply the full world schema.
/// Use this for any test that reads or writes world tables.
pub fn world_db() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    apply_pending(&mut conn, MigrationRoot::World).unwrap();
    conn
}

/// Open an in-memory DB and apply the app schema.
pub fn app_db() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    apply_pending(&mut conn, MigrationRoot::App).unwrap();
    conn
}
```

Each test calls `world_db()` or `app_db()` at the top — no shared state between tests. Because `Connection::open_in_memory()` is private to the process and in-memory, tests are fully isolated and parallelisable.

**Never pass `PRAGMA key` in integration tests.** SQLCipher's key-pragma flow is exercised only in `security/crypto.rs` dedicated tests where the encrypted-DB code path is the subject.

### Gemini SSE mock recipe

The real `services/gemini.rs` HTTP client is injectable via a `GenerationProvider` trait (Doc 04 / Doc 05). For tests, mock the HTTP boundary using `wiremock`:

```rust
// src-tauri/tests/gemini_sse_mock.rs

use wiremock::matchers::method;
use wiremock::{Mock, MockServer, ResponseTemplate};

/// Helper: build a raw SSE body for N text chunks.
/// Each chunk is a `data: {...}` line in Gemini's streaming format.
fn sse_body(chunks: &[&str]) -> String {
    let mut body = String::new();
    for text in chunks {
        let json = format!(
            r#"{{"candidates":[{{"content":{{"parts":[{{"text":"{text}"}}],"role":"model"}},"finishReason":"STOP","index":0}}]}}"#
        );
        body.push_str("data: ");
        body.push_str(&json);
        body.push_str("\r\n\r\n");
    }
    body
}

#[tokio::test]
async fn gemini_sse_streams_three_chunks() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_raw(sse_body(&["Hello", ", ", "world"]), "text/event-stream"),
        )
        .mount(&server)
        .await;

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/generate", server.uri()))
        .send()
        .await
        .expect("request failed");

    assert_eq!(resp.status(), 200);
    let body = resp.text().await.unwrap();

    assert!(body.contains(r#""text":"Hello""#), "chunk 1 missing");
    assert!(body.contains(r#""text":", ""#), "chunk 2 missing");
    assert!(body.contains(r#""text":"world""#), "chunk 3 missing");
}
```

The real `services/gemini.rs` streaming consumer will parse each `data:` line as it arrives via `reqwest`'s async byte stream. The mock server above can return chunks in a single body or incrementally using `wiremock`'s `delay` features. For unit tests of the parser logic, use the `sse_body()` helper to construct fixture strings without a live server.

---

## TypeScript — Unit and Component Tests

### Tooling

| Package | Role |
|---|---|
| `vitest` | Test runner (replaces Jest; native ESM + Vite integration) |
| `@testing-library/react` | Component rendering + user-event queries |
| `@testing-library/jest-dom` | Extended matchers (`toBeInTheDocument`, etc.) |
| `happy-dom` | Lightweight DOM environment (no native deps; faster than jsdom) |

Config lives in `vite.config.ts` under the `test` key (no separate `vitest.config.ts` needed).

### Vitest configuration

```ts
// vite.config.ts — test block added alongside the existing build config
test: {
  environment: 'happy-dom',
  globals: false,           // explicit imports only — avoids polluting global scope
  setupFiles: ['src/__tests__/setup.ts'],
  include: ['src/**/*.test.{ts,tsx}'],
  coverage: {
    provider: 'v8',
    include: ['src/stores/**', 'src/lib/**'],
    exclude: ['src/lib/types.ts'],  // generated file
  },
},
```

### Setup file

```ts
// src/__tests__/setup.ts
import { afterEach, expect } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

// Auto-cleanup after each test so DOM state doesn't leak between tests.
afterEach(() => cleanup());
```

`globals: false` is intentional — all Vitest APIs (`describe`, `it`, `expect`, `vi`) are explicitly imported in each test file. This avoids polluting the global scope and keeps type inference accurate.

### What to test

| Target | Coverage target | What to test |
|---|---|---|
| `src/stores/*.ts` (pure actions) | High | State transitions for pure reducer-style actions; selector derivations |
| `src/lib/utils.ts` | High | `cn()` merges; any pure utility function |
| Theme application (`applyTheme`) | High | CSS variable writes for each token; accent derivation |
| Token-count display formatting | Opportunistic | Edge cases (> 1M tokens, zero, negative) |
| Component integration | Opportunistic | Phase-conditional rendering; IPC call sites |

Do **not** write tests for:
- CSS layout or visual appearance (use screenshots manually)
- Tauri window management or native APIs
- Components that are pure pass-through wrappers with no logic

### Tauri IPC mock recipe

Every Tauri command call is wrapped in a typed function under `src/lib/tauriApi/<domain>.ts`. Tests mock the `invoke` function at that boundary:

```ts
// src/__tests__/ipc_mock.test.tsx

import * as tauriCore from '@tauri-apps/api/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OnboardingShell } from '../components/shell/OnboardingShell';
import type { AppPhase } from '../lib/types';

// vi.mock() is hoisted by vitest at compile time — placing it after imports
// is equivalent to placing it before; all imports see the mock.
vi.mock('@tauri-apps/api/core');

describe('OnboardingShell — IPC wiring', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('calls invoke with dev_set_app_phase and typed phase arg when Continue is clicked', () => {
    const phase: AppPhase = 'locked';
    vi.mocked(tauriCore.invoke).mockResolvedValueOnce(undefined);

    render(<OnboardingShell />);
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

    expect(tauriCore.invoke).toHaveBeenCalledWith('dev_set_app_phase', { phase });
  });
});
```

Key rules for IPC mock tests:
1. Always mock `@tauri-apps/api/core`, not the typed wrapper — that lets the wrapper's type-narrowing code run as real code under test.
2. Use `vi.mocked(tauriCore.invoke).mockResolvedValueOnce(value)` with a value typed from `src/lib/types.ts` — this catches type drift between Rust and TS.
3. Reset all mocks in `beforeEach` to avoid test ordering dependence.

### Store unit test recipe

```ts
// src/__tests__/appStore.test.ts
import { describe, expect, it } from 'vitest';

// Import the store factory, not the singleton, so each test gets fresh state.
// Zustand: call `create(...)` inside the test or use `useStore.setState` to reset.
import { useAppStore } from '../stores/appStore';

describe('appStore', () => {
  it('defaults to onboarding phase', () => {
    const state = useAppStore.getState();
    expect(state.appPhase).toBe('onboarding');
  });
});
```

For stores with async actions, use `vi.useFakeTimers()` to control debounce timers or `await act(async () => { ... })` in component tests.

---

## Coverage targets by module class

| Class | Target | Rationale |
|---|---|---|
| `security/` (Rust) | Exhaustive | Crypto bugs are silent, high-impact, and impossible to find manually |
| `services/history.rs` (Rust) | High (≥ 80 % line) | History assembly is the load-bearing logic for every model call |
| `services/rate_limiter.rs` (Rust) | High | Rate-limit bugs cause API errors that confuse writers |
| `services/settings.rs` cascade (Rust) | High | Incorrect cascade silently changes model behaviour |
| `services/cache.rs` prefix (Rust) | High | Wrong prefix = wrong cached content = subtle model degradation |
| `db/` (Rust) | Opportunistic | Mostly typed wrappers; integration-level tests usually sufficient |
| `commands/` (Rust) | Opportunistic | Thin handlers; test guard logic only |
| `src/stores/` (TypeScript) | High for pure actions | State machine bugs are hard to reproduce from the UI |
| `src/lib/` (TypeScript) | High | Pure utility functions are cheapest to test |
| `src/components/` (TypeScript) | Opportunistic | Test IPC wiring at component roots; skip leaf render tests |

Numeric coverage thresholds are **not enforced by CI** in v2.0 — the module-class targets are the contract. Enforcement via `--coverage --coverage-threshold` is deferred to v2.1 once the coverage baseline is established.

---

## CI matrix

| Gate | PR | Merge to main | Nightly |
|---|---|---|---|
| `cargo build` | ✓ | ✓ | ✓ |
| `cargo clippy -- -D warnings` | ✓ | ✓ | ✓ |
| `cargo test` | ✓ | ✓ | ✓ |
| `cargo test --doc` | — | ✓ | ✓ |
| `ts-rs` drift check | ✓ | ✓ | ✓ |
| `tsc --noEmit` | ✓ | ✓ | ✓ |
| `eslint .` | ✓ | ✓ | ✓ |
| `prettier --check` | ✓ | ✓ | ✓ |
| `pnpm test` (Vitest) | ✓ | ✓ | ✓ |
| Tauri build (Windows) | — | ✓ | ✓ |
| Tauri build (macOS arm64) | — | — | ✓ |
| Tauri build (macOS x86_64) | — | — | ✓ |
| Tauri build (Linux x86_64) | — | — | ✓ |
| Playwright E2E | — | — | Deferred — see below |

PR gates run on every push to a PR branch. They are fast (< 5 min target): compile + unit tests + lint only. No cross-platform Tauri builds — those are too slow to block PR review.

Merge-to-main adds the Windows Tauri build, doc tests, and the `ts-rs` drift check. The drift check (`git diff --exit-code src/lib/types.ts`) catches regenerated types that were committed without the matching `types.ts` update.

Nightly adds all three platform builds. Platform-matrix failures page the maintainer but do not block the main branch.

---

## Playwright E2E — explicit deferral

**Playwright E2E testing is deferred to v2.0.x.** It will not ship with v2.0.

**Rationale:**
- The Tauri WebView environment requires a custom Playwright driver (`tauri-driver`) that needs platform-level setup (Xvfb on Linux, separate signing on macOS). This adds CI complexity that is not warranted until the application surface is stable.
- v2.0's IPC mock recipe (above) exercises the integration boundary at lower cost with faster feedback.
- E2E tests are most valuable for regression prevention on a stable surface. Writing them while the surface is still being built produces tests that need constant update — high cost, low signal.

**When to revisit:** After v2.0 ships and Phase 13 (Build, Release) lands, assess whether the Tauri WebView driver setup is worth the CI investment. If yes, add `tauri-driver` + `@playwright/test` in v2.0.x and document the setup in Doc 26.

---

## What does not need tests

- CSS layout and visual appearance — screenshot comparison is more meaningful; do manually during visual-polish phase (Phase 12).
- Tauri window management, focus, resize — tested by Tauri's own test suite.
- `lib.rs` command registration — it either compiles or it doesn't.
- `src/main.tsx` entry point — just mounts the root component; no logic.
- Generated files (`src/lib/types.ts`) — tested indirectly by the ts-rs drift check.
- Empty-state rendering for components with no logic — covered by visual-polish pass.
