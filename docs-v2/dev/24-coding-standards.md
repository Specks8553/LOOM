# 24 — Coding Standards

> **Status:** Complete
> **Last updated:** 2026-05-04 — initial draft per D-18 (Coding Standards Umbrella). Covers Rust, TypeScript / React, CSS, build / lint / format, commit conventions, PR template, review checklist, and a v1.0 anti-pattern appendix.
> **Scope:** Authoritative code rules for LOOM 2.0 contributors. Rust patterns cite Doc 05; frontend patterns cite Doc 06; visual patterns cite Doc 08. Substrate items (SB-1..SB-6) have their rule home here; their *implementation* lands in the Phase 0 substrate session.

---

## How to read this doc

Every rule is tagged with one of three enforcement tiers:

| Tier | Meaning | Failure surface |
|---|---|---|
| **🔴 Linted** | Tooling enforces it; CI fails on violation | clippy / eslint / prettier / `tsc --noEmit` / `cargo test` / `ts-rs` drift-check |
| **🟡 Reviewed** | A reviewer must reject the PR if violated; no automated check | PR review |
| **⚪ Convention** | A smell — surface in review when seen, but not a hard rule | PR review |

When a rule resolves a substrate item from `PRE-IMPLEMENTATION-AUDIT.md`, the section header includes the anchor (e.g. `<!-- SB-1 -->`) so the audit-resolve workflow can locate it.

The **v1.0 anti-patterns appendix (Appendix A)** at the bottom names thirteen specific patterns that are forbidden in v2.0, each with a Forbidden / Preferred snippet pair. If a rule below is unclear, the matching appendix entry has the concrete shape.

---

## Rust

### General — 🟡

- **Edition 2021.** No 2024 features until the project bumps.
- **No `.unwrap()` / `.expect()` in production paths.** The only acceptable uses are: tests, `lazy_static!` / `OnceLock` initialisers with provably infallible inputs, and `pub fn run()` in `lib.rs` for the single Tauri-builder bootstrap. Every fallible call uses `?` and propagates a `LoomError`.
- **No `panic!` / `todo!` / `unreachable!()` in production paths.** A panic that crosses the IPC boundary is a bug; fix the call site, do not catch it.
- **No `#[allow(...)]` without a one-line justification comment.** `clippy::all` runs in CI; allowed lints document why.
- **No `// Phase N` style comments.** v1.0 used these to record feature-arrival order; v2.0 organises by domain, not phase. See Appendix A1.
- **`lib.rs` is registration only.** It contains `pub fn run()`, `tauri::generate_handler![...]`, `.manage(AppState::default())`, and nothing else. No business logic, no DB calls, no service calls. See Appendix A11.

### Error Handling — `LoomError` — 🟡

`LoomError` is the single error type for all Tauri commands. The full enum lives in `error.rs` and is specified in **Doc 05 §LoomError**. Eleven variants, no more added without a doc amendment:

`Crypto · Database · NotFound · Validation { kind, key, reason } · Forbidden · ApiError · CacheCreate · RateLimited · Io · Serialization · Internal`

Rules:

- Every Tauri command returns `Result<T, LoomError>`. Never `Result<T, String>`, never `Result<T, anyhow::Error>`.
- External errors are mapped via `From` impls. The required impls (per Doc 05) are: `rusqlite::Error → Database`, `std::io::Error → Io`, `serde_json::Error → Serialization`, `reqwest::Error → ApiError`. Adding a new external dependency that returns a `Result` requires either a new `From` impl or an explicit `.map_err(LoomError::from)` at the call site.
- **No new `LoomError` variants without a Doc 05 amendment.** The "22 variants of bespoke" v1.0 problem (V1-LESSONS A9) is solved by routing display-layer concerns through the `Validation { kind }` discriminant or through Doc 12's display mapping, not by adding variants. See Appendix A9.
- **Do not put user content in error strings.** A `LoomError::Validation { reason: format!("Bad message: {}", msg.content) }` leaks user content into logs and frontend toasts. Reasons reference IDs, key names, and bounded values only.

### Logging — `tracing`, never log content — 🔴 🟡

LOOM uses [`tracing`](https://docs.rs/tracing) and [`tracing-subscriber`](https://docs.rs/tracing-subscriber). The `log` crate is forbidden in v2.0 (the bridge crate `tracing-log` is acceptable for transitive deps).

**Levels:**

| Level | Use for |
|---|---|
| `error!` | Failed operations that surface to the user (Gemini call failed, DB write failed). |
| `warn!` | Approaching limits, recoverable failures (rate-limit close, cache create failed → fallback). |
| `info!` | Lifecycle events (vault unlocked, world opened, mode switched, send started). |
| `debug!` | Request metadata (message ID, token count, cache hit/miss, duration). |
| `trace!` | Per-chunk streaming events; off by default. |

**🟡 Never log:**

- Master key, API key, PBKDF2 salt, sentinel ciphertext.
- Message text, feedback text, document content, summary text, ghostwriter selection / instruction.
- World name, item name, story name (these are user content).
- Resolved system instructions or aux-slot values.

When in doubt, log the ID, not the value:

```rust
// ❌ leaks user content
info!("Sent message: {}", user_msg.content);

// ✅
info!(message_id = %msg.id, story_id = %story_id, tokens = body_tokens, "send_message complete");
```

**🟡 Spans for request scopes.** Long-lived operations open a span:

```rust
let span = info_span!("send_message", story_id = %story_id, mode = ?mode);
let _enter = span.enter();
```

Span fields are structured; they cross to `tracing-subscriber`'s formatter without `format!`. See Appendix A12 for what content fields look like vs. what they must not look like.

### Async / Cancellation — 🟡

- **`tokio` is the runtime.** No `async-std`, no `smol`.
- **Never hold a `Mutex` guard across an `await`.** Acquire, copy / clone what's needed, drop the guard, then await. The lock-ordering rule (Doc 05 §AppState) becomes inspectable only when guards are short-lived. See Appendix A2.
- **Cancellation uses [`tokio_util::CancellationToken`].** Per-request lifetime: a token is created at the start of `send_message` (and any other cancellable operation), stored in `AppState.cancel_tx` for that request, signalled by `cancel_generation`, and dropped on completion. The exact contract — including the "next request creates a fresh token; cancel of the old one is a no-op on the new" invariant — is owned by **Doc 05 §Cancellation Lifecycle** (SB-4). Do not share a single `Sender<bool>` across requests. See Appendix A12.
- **`reqwest` stream drop does not cancel the HTTP connection.** Always wrap streaming reads in `tokio::select!` against the cancellation token and abort the request handle explicitly when cancelled.

### Key Zeroing — 🟡

- `[u8; 32]` master keys, derived KEKs, and any byte buffer holding key material is zeroed with the [`zeroize`](https://docs.rs/zeroize) crate (`Zeroizing<T>` wrapper, or `Zeroize::zeroize` before drop).
- `AppState.master_key` and `AppState.api_key` are zeroed on `lock_vault` and on app close.
- Never log a key fingerprint, key length, or PBKDF2 timing — these are side-channels.

### Atomic File Writes — 🟡

Any config file written outside SQLCipher (`app_config.json`, `.loom-backup` archives, exported templates) must be written atomically:

```rust
let tmp = path.with_extension("json.tmp");
fs::write(&tmp, contents)?;
fs::rename(&tmp, &path)?;
```

Never `fs::write` directly to the destination — a crash mid-write corrupts the config. Same rule for `world_meta.json` if reintroduced.

### SQLCipher Usage — 🟡

- `rusqlite` with `features = ["sqlcipher", "bundled"]`. No alternative SQLite driver.
- `PRAGMA key = '...'` runs **immediately** after `Connection::open` and **before** any other query. The connection is unusable until the key is set.
- `PRAGMA cipher_compatibility = 4` (current SQLCipher major).
- Never log the PRAGMA statement.
- Use parameterised queries (`?1`, `?2`) for every value. No string interpolation into SQL — clippy's `string_add` and the implicit "magic key" smell are both signals.

### AppState Access — `with_active_conn` family — 🟡 <!-- SB-5 -->

**Forbidden:** raw `.lock()` calls on `AppState` mutex fields anywhere outside `state/access.rs`. v1.0 had 118 occurrences of the four-line `state.X.lock().map_err(...).as_ref().ok_or(...)` idiom. See Appendix A2.

**Required:** the access-helper family in `state/access.rs`:

```rust
pub fn with_active_conn<T>(
    state: &AppState,
    f: impl FnOnce(&Connection) -> Result<T, LoomError>,
) -> Result<T, LoomError>;

pub fn with_settings_conn<T>(state: &AppState, f: impl FnOnce(&Connection) -> Result<T, LoomError>) -> Result<T, LoomError>;
pub fn with_master_key<T>(state: &AppState, f: impl FnOnce(&[u8; 32]) -> Result<T, LoomError>) -> Result<T, LoomError>;
pub fn with_api_key<T>(state: &AppState, f: impl FnOnce(&str) -> Result<T, LoomError>) -> Result<T, LoomError>;
pub fn with_active_world_id<T>(state: &AppState, f: impl FnOnce(&str) -> Result<T, LoomError>) -> Result<T, LoomError>;
pub fn with_two_conns<T>(state: &AppState, f: impl FnOnce(&Connection, &Connection) -> Result<T, LoomError>) -> Result<T, LoomError>;
```

Helpers:

- Acquire the mutex with the documented lock-ordering invariant (Doc 05 §AppState).
- Map poison errors to `LoomError::Internal`.
- Map `None` (vault locked / world not open) to `LoomError::Validation { kind: Generic, reason: "vault is locked" | "no world open" }`.
- Are the **only** call sites that call `.lock()` on AppState fields. A grep for `state\.\w+_(?:conn|key|tx)\.lock\(\)` outside `state/access.rs` returns zero matches — this is a CI grep gate.

The exact signatures are owned by **Doc 05 §AppState** (SB-5 expansion). Doc 24 establishes the rule; Doc 05 owns the contract.

### Settings Access — typed `AppSettingKey` / `StoryStateKey` — 🟡 <!-- SB-1 -->

**Forbidden:** stringly-typed access to `app_settings` or `story_state`. v1.0 had 45 occurrences of `SELECT value FROM settings WHERE key = '...'` with magic key strings and silent fallback to empty string. See Appendix A13.

**Required:** typed enums in `services/settings_keys.rs`:

```rust
pub enum AppSettingKey {
    ApiKey,
    TextModelName,
    GenTemperature, GenTopP, GenTopK, GenMaxOutputTokens,
    GenSummariseTemperature, GenSummariseTopP, GenSummariseTopK, GenSummariseMaxOutputTokens,
    AccentColor, GhostwriterColor, AccordionColor, FeedbackColor, BodyFont,
    AutoLockSecs,
    RateLimitRpm, RateLimitTpm, RateLimitRpd,
    ContextTokenLimit, CacheTtlSecs, CacheMinTokens,
    StorySi, HandoverSi, ConsultingSi,
    AuxSlot1Name, AuxSlot1Content, AuxSlot2Name, AuxSlot2Content,
    PromptGhostwriter, PromptAccordionSummarise, PromptAccordionFakeUser,
    PromptHandoverSeed, PromptConsultingSeed,
    // image / audio provider keys are added in v2.1
}

pub enum StoryStateKey {
    ContextDocIds,
    ActiveMode,
    ActiveAuxSlot,
    Draft,
}
```

Each variant has `as_str() -> &'static str` (the DB column key) and `default_value() -> &'static str` (the hardcoded fallback per R8 / Doc 03 cascade rules). Typed accessors live in `db/settings.rs`:

```rust
pub fn get_app_setting<T: FromSettingValue>(conn: &Connection, key: AppSettingKey) -> Result<T, LoomError>;
pub fn set_app_setting(conn: &Connection, key: AppSettingKey, value: &str) -> Result<(), LoomError>;
pub fn get_story_state<T: FromSettingValue>(conn: &Connection, story_id: &str, key: StoryStateKey) -> Result<T, LoomError>;
```

The known-keys tables in **Doc 03 §`app_settings`** and **Doc 03 §`story_state`** are the enums' source of truth. When Doc 03 adds a key, the enum variant is added in the same PR.

A grep for `SELECT.*FROM settings WHERE key = ['"]` and `SELECT.*FROM story_state WHERE key = ['"]` outside `db/settings.rs` returns zero matches.

### Schema Migrations — numbered SQL — 🟡 <!-- SB-6 -->

**Forbidden:** heuristic `migrate_dev_schema()` style migrations that detect schema state by `sqlite_master.sql` substring matching. See Appendix A10.

**Required:** versioned, append-only migrations:

```
src-tauri/src/db/migrations/
├── 001_initial.sql              ← all of v2.0's tables + indices, baseline
├── 002_<descriptor>.sql         ← first post-launch change
└── ...
```

A `schema_migrations` table tracks applied versions:

```sql
CREATE TABLE schema_migrations (
    version    INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL,
    name       TEXT NOT NULL
);
```

On `open_world_db` (and on `open_settings_db`), query `SELECT MAX(version) FROM schema_migrations`, run all higher-numbered migrations in numeric order inside a single transaction per file, record each on success.

Rules:

- **Append-only.** Never edit a shipped migration file. A bug in `003` is fixed by `004`, not by editing `003`.
- **Idempotency is the migration author's responsibility.** Use `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN` (then test on a populated DB), or guarded inserts.
- **Two migration roots.** `db/migrations/world/` (for `loom.db`) and `db/migrations/app/` (for `app_settings.db`). Each has its own `schema_migrations` table because the two DBs evolve independently.
- The initial v2.0 schema lives in `001_initial.sql` for each root. Doc 03 is the human-readable mirror; the SQL files are authoritative for what runs.

### Constants — per-service files — 🟡

Runtime constants (fallback model name, default TTLs, magic numbers, regex patterns) live in `constants.rs` files **co-located with the consuming service**:

```
src-tauri/src/services/
├── gemini/
│   ├── mod.rs
│   └── constants.rs    ← model id, base URL, retry max, etc.
├── cache/
│   ├── mod.rs
│   └── constants.rs    ← default TTL, min-tokens published floor, refresh-skew
└── ...
```

There is **no `services/constants.rs`** at the top level (it would become a junk drawer). A constant used by two services lives in the *higher-level* of the two; if there is no such relationship, a small shared module (`services/shared_constants.rs`) is acceptable as an exception.

### Tauri Command Discipline — 🟡

- **`#[tauri::command]` directly.** No `safecommand!` macro, no panic-catch shim. v1.0 wrapped every command in `safecommand!` to convert panics to errors; v2.0's discipline is "don't panic in production paths" (see General). A panic crossing IPC is a bug to fix at source. See Appendix A6.
- **Commands are thin.** Validate inputs, acquire AppState via the helper family (§AppState Access), call a service or `db/` function, return. If a handler grows beyond ~30 lines, the business logic belongs in `services/`. See Doc 05 §Command Registration Pattern.
- **One command per Tauri call.** Don't dispatch sub-operations from inside a command via `app.emit_to(...)` to a frontend listener that re-invokes another command. State machines run in Rust.
- **Signature-drift policy (R5).** Any change to a `#[tauri::command]` signature (params, return type, error variant additions) **must update both**:
  1. The owning **feature doc** (the doc that specifies the command's behaviour, per the Cross-References table at the bottom of each feature doc).
  2. **Doc 07 (IPC Contracts)** — its table row for the command.

  The PR template (§PR Template) has a checklist line for this.
- **Error returns.** Every command returns `Result<T, LoomError>`. The frontend wrapper handles the error per Doc 12 §Error Display.

### Testing Conventions — 🟡

- **Unit tests** live alongside the module: `#[cfg(test)] mod tests { … }` at the bottom of the file. Required for: `services/history.rs`, `services/rate_limiter.rs`, `services/settings.rs` (cascade), `services/cache.rs` (prefix construction), `security/crypto.rs`, `security/sentinel.rs`. Other modules: tests are encouraged but not gated on.
- **Integration tests** live in `src-tauri/tests/`. They use **in-memory SQLite (non-encrypted)** via `Connection::open_in_memory()` for DB-logic tests; SQLCipher's PRAGMA key flow is exercised in dedicated crypto tests only.
- **No tests against the real Gemini API in the test suite.** Mock the HTTP boundary (a small `MockGemini` struct that implements the same interface as `services/gemini.rs`). End-to-end Gemini calls happen during manual testing only.
- **Test names describe the invariant**, not the test mechanism: `cascade_world_override_beats_app_default`, not `test_cascade_1`.

The full layered strategy (unit / integration / E2E) is owned by **Doc 25 (Testing Strategy)** — currently a stub; this section is the contract Doc 25 will refine.

---

## TypeScript / React

### General — 🔴 🟡

- **Strict mode (`"strict": true` in `tsconfig.json`).** No exceptions for compatibility with third-party libs — wrap untyped libs in a typed shim under `src/lib/`.
- **No `any`.** `unknown` + a type guard, or a typed third-party shim. The `@typescript-eslint/no-explicit-any` rule is `error`.
- **No `// @ts-ignore` / `@ts-expect-error` without a one-line justification comment.** `@ts-expect-error` is preferred (it errors when no longer needed).
- **Functional components only.** No class components.
- **Hooks at the top level.** ESLint's `react-hooks/rules-of-hooks` is `error`; `react-hooks/exhaustive-deps` is `error`.
- **No default exports for components.** Named exports only — ESLint `import/no-default-export` is `error` for files under `src/components/`. Default exports are kept for `src/main.tsx` and any framework-required entry points.

### Type Generation — `ts-rs` — 🔴 <!-- SB-3 -->

**Source of truth for IPC types is the Rust struct.** `src/lib/types.ts` is a build artefact, regenerated by [`ts-rs`](https://docs.rs/ts-rs).

```rust
#[derive(Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "../src/lib/types.ts")]
pub struct ChatMessage {
    pub id: String,
    pub story_id: String,
    pub role: MessageRole,
    pub content: String,
    // ...
}
```

Rules:

- Every type that crosses the IPC boundary derives `ts_rs::TS`. This includes command return types, command param types (when not primitive), event payload types, and structured `LoomError` discriminants (`ValidationKind`).
- **`types.ts` is committed to the repo** (so IDE jump-to-definition works without a build step).
- **CI runs a drift-check.** `cargo test` invokes `ts-rs`'s exporter, then `git diff --exit-code src/lib/types.ts`. Any diff fails CI.
- **Do not hand-edit `src/lib/types.ts`.** The file's first line is `// AUTO-GENERATED — DO NOT EDIT. Edit the Rust struct instead.` See Appendix A8.
- Doc 03 (Data Model) documents the canonical Rust shape; the generated TS file mirrors it.

### Zustand Store Conventions — 🔴 🟡

- **Selectors only.** Subscribe to a single field with `useStore(s => s.field)`, never `useStore()`. ESLint custom rule (or convention + review) catches the latter. A re-render on every store change is a performance bug. See Doc 06 §Store Rules.
- **Stores hold data, not derived state.** Computed values are computed in components or hooks, not stored. Memoisation for expensive cases is fine; "derived field that mirrors another field" is a smell.
- **Stores never accumulate unrelated concerns.** Each store has an explicit Owns / Does-not-own paragraph in Doc 06. Adding a field that doesn't fit either bullet is a doc amendment, not a code-only change. See Appendix A4.
- **Actions are part of the store.** Don't define a free function that calls `useXStore.getState().setFoo(x)` from outside; put `setFoo` on the store.

### No Cross-Store Imports — 🔴 <!-- SB-2 -->

Stores never import each other. Doc 06 §Store Rules states this; this section is the lint home.

ESLint config (in `.eslintrc.cjs` or `eslint.config.js`):

```js
'import/no-restricted-paths': ['error', {
  zones: [
    {
      target: './src/stores',
      from:   './src/stores',
      message: 'Stores must not import each other. Compose in components or hooks (Doc 06 §Store Rules; Doc 24 §No Cross-Store Imports).',
    },
  ],
}]
```

Cross-store composition happens in components or in hooks under `src/hooks/`. See Doc 06 §Store Rules for the canonical pattern.

### Component Rules — 🟡 ⚪

- **One component per file** for components ≥ 50 lines. Below that, sibling sub-components are fine.
- **Component size budget (R19) — ⚪ Convention:**
  - **> 400 lines** warrants a structural review during PR review (likely a sign of mixed concerns or a missing primitive).
  - **> 600 lines** requires explicit justification in the PR description.
  - There is no hard ceiling, but a 1,000-line component is almost certainly hiding three smaller components or a state machine that wants its own hook. See Appendix A5 and V1-LESSONS A8.

  Heuristics that often resolve oversize components:
  - Modal with multiple tabs → one component per tab.
  - Pane composing multiple sections → one component per section (`<ControlPaneSection>` is the precedent — Doc 10).
  - Bubble with many feature integrations → feature-specific affordances move into hooks (`useGhostwriter`, `useFeedbackEdit`, etc.).
  - Wizard with multiple steps → one component per step.
  - Tree-row with rename / drag / context-menu / multi-select → primitives composed.
- **Max-stores-per-component (V1-LESSONS A5) — ⚪ Convention.** A component that imports more than three stores is a smell. v1.0's `AiBubble.tsx` imported seven; the v2.0 design (D-13 / D-14 / D-17) keeps bubble feature state on `workspaceStore` specifically to avoid this.
- **Props-driven over store-driven where possible.** A leaf component that takes a `feedback` string prop is more reusable and more testable than one that calls `useWorkspaceStore`. Reach for the store at the *highest* component that needs it; pass down to children.
- **No prop drilling beyond ~3 levels.** Beyond that, either lift the leaf into the higher component or extract a hook.

### Tauri IPC Conventions — 🟡

- **All `invoke()` calls are wrapped** in typed async functions in `src/lib/tauriApi/`. No raw `invoke("command_name", { ... })` in components or stores. See Doc 06 §Tauri IPC Conventions.
- **Files are split by domain** (`auth.ts`, `vault.ts`, `conversation.ts`, `settings.ts`, `cache.ts`, `accordion.ts`, `ghostwriter.ts`, `modes.ts`, `feedback.ts`). Mirrors the backend `commands/` layout.
- **Every wrapper is a typed async function** with explicit param types and a typed return value derived from the Rust struct via `ts-rs`:

  ```typescript
  export async function sendMessage(
    storyId: string,
    userContent: UserContent,
    mode: AppMode,
  ): Promise<void> {
    return invoke('send_message', { storyId, userContent, mode });
  }
  ```

- **Snake-case in the `invoke()` payload, camelCase in the wrapper signature.** Tauri serialises camelCase param names to snake_case for the Rust handler; the wrapper is the only place that knows.

### Error Handling — every `invoke()` has `.catch` — 🟡

Every call site that consumes a wrapper from `tauriApi/` either:

1. Awaits inside a `try / catch` and surfaces the error per Doc 12 (toast / inline / modal), or
2. Chains a `.catch(...)` that does the same.

Silent error swallowing (a bare `await` with no surrounding handling) is forbidden. ESLint's `@typescript-eslint/no-floating-promises` is `error` and catches the most common shape of this bug.

### No Sensitive Data in localStorage — 🔴

Allowed in localStorage:

- Pane widths (numeric).
- Collapsed/expanded states (booleans, ID arrays).
- Auto-lock-timer setting.
- Export folder path.
- Onboarding-complete flag.
- Active-modal recovery on refresh (string enum).

Forbidden in localStorage:

- API key, master key, derived keys (any byte material).
- World-DB password, sentinel ciphertext.
- Message content, feedback content, document content.
- Resolved system instructions, aux-slot values.
- Any settings value other than the explicit UI-preference list above.

A grep for `localStorage\.setItem\(` outside `src/stores/` and `src/lib/uiPrefs.ts` (single allowlisted module) requires PR justification.

### Naming Conventions — 🟡

- **Files:** `PascalCase.tsx` for React components, `camelCase.ts` for stores / hooks / lib utilities, `kebab-case.css` for styles.
- **Variables / functions:** `camelCase`. Constants: `SCREAMING_SNAKE_CASE` only at module scope and only for genuinely-immutable runtime constants.
- **Types / interfaces / classes:** `PascalCase`. No `I`-prefix on interfaces.
- **Stores:** `xxxStore.ts` — `appStore`, `authStore`, `vaultStore`, `workspaceStore`, `settingsStore`, `modeStore`, `cacheStore`. Adding an eighth store requires a Doc 06 amendment.
- **Tauri command modules:** match the backend domain — `tauriApi/conversation.ts` ↔ `commands/conversation.rs`.
- **Booleans:** prefer `is*` / `has*` / `can*` / `should*` prefixes. `isLocked`, `hasApiKey`, `canSend`, `shouldRefresh`.

---

## CSS / Design

### Token Usage — `var(--color-*)` only — 🔴 🟡

**Forbidden:** hex colour literals, named CSS colours (`white`, `black`, `gray`, `red`), or raw Tailwind colour classes (`text-gray-400`, `bg-blue-500`) in component files. The single source of truth for colour values is **Doc 08 (Design Tokens)**, exposed as CSS variables on `:root` and per-theme.

```tsx
// ❌
<div className="bg-[#0a0a0a] text-white border-gray-800">

// ✅
<div className="bg-[--color-bg] text-[--color-text-primary] border-[--color-border]">
```

[`eslint-plugin-tailwindcss`](https://www.npmjs.com/package/eslint-plugin-tailwindcss)'s `no-arbitrary-value` rule (configured to allow `[--color-*]` arbitrary values) catches the common case. The full rule (no hex anywhere in component files) is enforced by review. See Appendix A7.

The `applyTheme(snapshot)` function (Doc 20) writes derived CSS variables to `:root` at runtime — accent, ghostwriter colour, accordion colour, feedback colour, and their hover / subtle variants. Components reference the tokens; the runtime values cascade through.

### `cn()` for Conditional Classes — 🔴

Conditional Tailwind classes use `cn()` (a re-export of [`clsx`](https://www.npmjs.com/package/clsx) + [`tailwind-merge`](https://www.npmjs.com/package/tailwind-merge)) from `src/lib/utils.ts`:

```tsx
// ❌ raw concatenation; produces class conflicts
<div className={`px-3 py-2 ${isActive ? 'bg-accent' : 'bg-bg-soft'} ${large ? 'text-lg' : ''}`}>

// ✅
<div className={cn('px-3 py-2', isActive ? 'bg-accent' : 'bg-bg-soft', large && 'text-lg')}>
```

`tailwind-merge` resolves conflicts (`px-3 px-4 → px-4`); raw concatenation does not.

### No Inline Styles — 🟡

`style={{ ... }}` is reserved for **dynamic numeric values that have no Tailwind equivalent** — e.g. `style={{ width: paneWidth }}` for a runtime-computed pane width, or `style={{ transform: `translateX(${offset}px)` }}` for pointer-driven motion.

Using `style={{ color: '#0a0a0a' }}` is forbidden — the colour belongs in the token system (§Token Usage).

### Tailwind Naming Conventions — 🟡

- **Utility classes preferred over `@apply`.** `@apply` is allowed in `globals.css` for genuinely-shared primitives (e.g. a `.section-header` class consumed across Navigator, Control Pane, Branch Map, Settings) but not as a generic abstraction layer.
- **No CSS modules.** Tailwind + tokens cover the design surface.
- **No `!important`.** A specificity bug is a sign the structure is wrong; fix the structure.

---

## Build, Lint, Format

### Linters — 🔴

| Tool | Scope | Config |
|---|---|---|
| `clippy` | Rust | `clippy::all` + `clippy::pedantic` (selected lints) |
| `rustfmt` | Rust | Default config; runs on save in IDE; CI checks `cargo fmt --check` |
| `tsc --noEmit` | TypeScript | Strict mode |
| `eslint` | TS / React | See §ESLint Config below |
| `prettier` | TS / React / CSS / Markdown | Default config + project-specific overrides in `.prettierrc` |

**ESLint config (high-level):**

- `@typescript-eslint/recommended-type-checked` (full set; not just `recommended`)
- `react-hooks/recommended` (rules-of-hooks + exhaustive-deps as `error`)
- `import/order` (groups: builtin → external → internal → parent → sibling → index → object → type, alphabetised within group)
- `import/no-default-export` (scoped to `src/components/**`)
- `import/no-restricted-paths` (store-boundary rule, see §No Cross-Store Imports)
- `eslint-plugin-tailwindcss` with `no-arbitrary-value` configured to allow `[--color-*]`
- `@typescript-eslint/no-floating-promises` as `error`
- `@typescript-eslint/no-explicit-any` as `error`

The full `.eslintrc.cjs` lives in the repo root and is the authoritative reference; this section is the spec.

### Pre-commit — 🔴

[`husky`](https://github.com/typicode/husky) + [`lint-staged`](https://github.com/lint-staged/lint-staged):

```json
// package.json (excerpt)
{
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{js,cjs,mjs}": ["eslint --fix", "prettier --write"],
    "*.{json,md,css}": ["prettier --write"],
    "src-tauri/src/**/*.rs": ["cargo fmt --"]
  }
}
```

Husky's `pre-commit` hook runs `lint-staged` (fast — only changed files) and a top-level `tsc --noEmit` (catches cross-file type errors). `cargo clippy` runs in CI (slower; not in pre-commit) but is also available via `pnpm check:rust` for local pre-push runs.

### CI Gates — 🔴

CI fails if any of the following fail:

| Gate | Command |
|---|---|
| Rust format | `cargo fmt --all --check` |
| Rust lint | `cargo clippy --all-targets --all-features -- -D warnings` |
| Rust tests | `cargo test --all-features` |
| `ts-rs` drift | `cargo test ts_rs_export && git diff --exit-code src/lib/types.ts` |
| TS types | `pnpm tsc --noEmit` |
| ESLint | `pnpm lint` |
| Prettier | `pnpm prettier --check .` |
| Frontend tests | `pnpm test --run` (when Doc 25 lands) |
| Migration parity | (deferred — runs once Doc 26 lands) |

The exact CI workflow file (`.github/workflows/ci.yml`) is owned by **Doc 26 (Build and Release)** — currently a stub. This section is the contract Doc 26 will implement.

---

## Commit Conventions — 🟡

LOOM 2.0 uses [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

**Format:**

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types** (closed set; PRs that don't fit ask for a doc amendment):

| Type | Meaning |
|---|---|
| `feat` | New user-visible capability |
| `fix` | Bug fix |
| `refactor` | Code change without user-visible behaviour change |
| `perf` | Performance improvement |
| `docs` | `docs-v2/`, `docs/`, README, code comments |
| `test` | Adding / refactoring tests |
| `build` | Build-system / dependency / tooling changes |
| `ci` | CI workflow changes |
| `chore` | Ignorable mechanical changes (formatting, file moves) |

**Scopes** (closed set; tied to backend domain or frontend area):

`auth · vault · convo · cache · mode · settings · accordion · ghostwriter · feedback · media · ipc · ui · build · ci · docs`

**Examples:**

```
feat(convo): add aux-slot prepending to user turn

The aux-slot is injected with [AUX — ALWAYS APPLY] delimiter outside the
cached prefix so changes don't invalidate the cache.

Refs: D-08, Doc 15 §Aux Slot Injection
```

```
fix(cache): prevent TTL refresh during cancelled send

Cancelled sends were firing the post-send TTL refresh anyway, which created
a phantom write. Skip refresh when cancellation token is set.

Closes #N
```

**Subject line:** under 70 characters, imperative mood (`add`, `fix`, `remove` — not `added`, `fixes`, `removing`), no trailing period.

**Body:** wrap at ~72 characters. Explain the *why*, not the *what* — the diff shows the what.

**Footer:** `Closes #N` for issue refs, `Refs: D-NN, Doc XX §Section` for spec refs.

**No `// Phase N` framing in commit subjects.** v1's `feat(phase-13): polish UI — SI pill toggle, …` style is forbidden in v2.0; the scope is the domain, not the implementation phase.

---

## PR Template

`.github/pull_request_template.md`:

```markdown
## What

<one-paragraph summary>

## Why

<the motivating spec ref or bug>

## Spec refs

- Doc XX §Section
- D-NN umbrella entry (if applicable)

## Checklist

- [ ] No `.unwrap()` / `.expect()` in production paths
- [ ] No `// Phase N` style comments
- [ ] No raw `state.X.lock()` on AppState fields (use `with_*` helpers)
- [ ] No raw settings SQL (use `AppSettingKey` / `StoryStateKey`)
- [ ] No content in logs (master_key, api_key, message text, feedback, doc content)
- [ ] If `#[tauri::command]` signature changed: Doc 07 row updated **and** owning feature doc updated
- [ ] If new IPC type: derives `ts_rs::TS`; `types.ts` regenerated and committed
- [ ] If component > 600 lines: justification below
- [ ] If new Zustand store: Doc 06 amendment in this PR
- [ ] No hex / named colours in component files (use `var(--color-*)` tokens)
- [ ] Tests added or updated for changed logic

## Justifications (if any checkboxes are unchecked)

<...>

## Test plan

<bulleted manual / automated test steps>
```

The PR template is enforced by review; bot-checking is out of scope for v2.0.

---

## Code Review Checklist

For reviewers. The PR template's checklist is what authors confirm; this is the deeper read.

**Architecture:**

- Does this PR touch a "load-bearing wall" (Doc CLAUDE.md §Architecture)? If so, does it preserve the constraint?
- Is business logic in `services/`, not in `commands/`?
- Is the layering DAG respected (Doc 05 §Dependency Rules)?

**Correctness:**

- Are error states handled? Not just the happy path — Gemini fails, DB locked, network down.
- Are empty states rendered per Doc 12, not blank?
- Is sensitive data protected? No keys / content in logs, error strings, or localStorage.
- For streaming code: is cancellation wired to `tokio_util::CancellationToken`, not a shared sender?
- For DB writes that touch a cached prefix: does the relevant stale-trigger fire (Doc 22)?
- For deletions touching messages: are `checkpoints` and `accordion_segments` cascade-handled (Doc 15 / Doc 16)?

**Style:**

- Are tokens used for all colour values?
- Are Zustand selectors used, not full-store subscriptions?
- Does any component import more than three stores?
- Does any function exceed ~50 lines without obvious cause?
- Does any Rust handler exceed ~30 lines (logic should move to `services/`)?

**Doc parity:**

- If a `#[tauri::command]` signature changed: Doc 07 + feature doc both updated.
- If a Zustand store shape changed: Doc 06 updated.
- If a schema column added: Doc 03 + a numbered migration file both present.
- If a new design token added: Doc 08 updated; `applyTheme()` writes it (Doc 20).

**Tests:**

- Are unit tests added for new pure logic?
- Do test names describe invariants (`cascade_world_override_beats_app_default`), not mechanisms (`test_cascade_1`)?

---

## Appendix A — v1.0 Anti-patterns Forbidden in v2.0

Each entry: brief description, Forbidden snippet, Preferred snippet.

### A1 — `// Phase N` comments

v1.0 marked feature-arrival phases with `// ─── Phase 6: Conversation` headers. v2.0 organises by domain.

```rust
// ❌ Forbidden
// ─── Phase 8: Settings ─────────────────────────────────────
#[tauri::command]
async fn save_setting(...) -> Result<(), LoomError> { ... }

// ✅ Preferred — file is `commands/settings.rs`; the domain is the file
#[tauri::command]
async fn save_setting(...) -> Result<(), LoomError> { ... }
```

### A2 — Raw `.lock()` on AppState fields

```rust
// ❌ Forbidden — 118 occurrences in v1.0
let conn_guard = state.active_conn.lock()
    .map_err(|e| LoomError::Internal(format!("Failed to lock connection: {}", e)))?;
let conn = conn_guard.as_ref().ok_or(LoomError::NoActiveConnection)?;
db::messages::insert_user(conn, story_id, content)?;

// ✅ Preferred — the helper enforces lock ordering and Option unwrapping
with_active_conn(state, |conn| {
    db::messages::insert_user(conn, story_id, content)
})?
```

### A3 — Raw settings SQL with magic key strings

```rust
// ❌ Forbidden — 45 occurrences in v1.0
let static_si: String = conn.query_row(
    "SELECT value FROM settings WHERE key = 'static_system_instruction'", [],
    |row| row.get(0)).unwrap_or_default();

// ✅ Preferred
let story_si: String = db::settings::get_app_setting(conn, AppSettingKey::StorySi)?;
```

### A4 — Stores importing other stores

```typescript
// ❌ Forbidden — caught by ESLint import/no-restricted-paths
// src/stores/workspaceStore.ts
import { useSettingsStore } from './settingsStore';

const useWorkspaceStore = create<WorkspaceStore>(...);

// ✅ Preferred — compose in components or hooks
// src/hooks/useStoryContext.ts
export function useStoryContext() {
  const activeStoryId = useWorkspaceStore(s => s.activeStoryId);
  const model         = useSettingsStore(s => s.resolved?.text_model_name);
  return { activeStoryId, model };
}
```

### A5 — Mega-components

`SettingsModal.tsx` at 2,267 lines, `RightPane.tsx` at 1,392, `AiBubble.tsx` at 1,146.

```tsx
// ❌ Forbidden — every settings tab in one file
function SettingsModal() {
  return (
    <Tabs>
      <TabsContent value="general">{/* 200 lines of general */}</TabsContent>
      <TabsContent value="appearance">{/* 300 lines of appearance */}</TabsContent>
      <TabsContent value="gemini">{/* 400 lines of gemini */}</TabsContent>
      {/* ... 5 more tabs ... */}
    </Tabs>
  );
}

// ✅ Preferred — one component per tab
// src/components/settings/SettingsScreen.tsx (~80 lines: chrome + tab routing)
// src/components/settings/tabs/GeneralTab.tsx
// src/components/settings/tabs/AppearanceTab.tsx
// src/components/settings/tabs/GeminiTab.tsx
// ...
```

### A6 — `safecommand!` panic-catch shim

```rust
// ❌ Forbidden in v2.0 — masks panics that should be bugs
safecommand!(send_message(state: State<AppState>, ...) -> Result<(), LoomError> {
    // body
});

// ✅ Preferred — discipline replaces the macro
#[tauri::command]
async fn send_message(state: State<'_, AppState>, ...) -> Result<(), LoomError> {
    // No `.unwrap()`, no `panic!`. If a panic ever crosses IPC, fix the call site.
}
```

### A7 — Hex / named colours in component files

```tsx
// ❌ Forbidden
<div className="bg-[#0a0a0a] text-white">

// ✅ Preferred
<div className="bg-[--color-bg] text-[--color-text-primary]">
```

### A8 — Hand-edited `src/lib/types.ts`

```typescript
// ❌ Forbidden — types.ts is generated
// src/lib/types.ts
export interface ChatMessage {
  id: string;
  // ... edited by hand to add a field ...
}

// ✅ Preferred — edit the Rust struct; ts-rs regenerates
// src-tauri/src/db/messages.rs
#[derive(Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "../src/lib/types.ts")]
pub struct ChatMessage { /* ... */ }
```

### A9 — `LoomError` variant proliferation

```rust
// ❌ Forbidden — bespoke variants that could be Validation
pub enum LoomError {
    WorldExists(String),
    MaxNestingDepth,
    ApiKeyMissing,
    GenerationInProgress,
    CacheTooSmall,
    NoActiveConnection,
    // ... 22 total in v1.0
}

// ✅ Preferred — Doc 05's eleven generic variants; specific cases via Validation { kind }
return Err(LoomError::Validation {
    kind: ValidationKind::Generic,
    key: Some("world_name".into()),
    reason: "world already exists".into(),
});
```

### A10 — Heuristic schema migrations

```rust
// ❌ Forbidden — migrate_dev_schema substring sniffing
let table_sql: Option<String> = conn.query_row(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'",
    [], |row| row.get(0)).ok();
if let Some(sql) = table_sql {
    if sql.contains("'image'") || !sql.contains("'json_user'") {
        // drop and recreate ...
    }
}

// ✅ Preferred — numbered migration file
// db/migrations/world/004_add_kind_consulting.sql
ALTER TABLE messages ADD COLUMN session_id TEXT;
-- recorded in schema_migrations after success
```

### A11 — Fat `lib.rs`

```rust
// ❌ Forbidden — v1.0 had 87 commands and ~3,379 lines in lib.rs
// lib.rs
#[tauri::command]
async fn unlock_vault(...) -> Result<...> { /* 60 lines */ }

#[tauri::command]
async fn send_message(...) -> Result<...> { /* 400 lines */ }

// ... 85 more ...

// ✅ Preferred — registration only
// lib.rs
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::auth::unlock_vault,
            commands::conversation::send_message,
            // ...
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### A12 — Shared `Mutex<Option<watch::Sender<bool>>>` across requests

```rust
// ❌ Forbidden — sender persists across requests; cancel can leak to next request
struct AppState {
    cancel_tx: Mutex<Option<tokio::sync::watch::Sender<bool>>>,
}

// ✅ Preferred — per-request CancellationToken; details in Doc 05 §Cancellation Lifecycle
struct AppState {
    cancel_tx: Mutex<Option<tokio_util::sync::CancellationToken>>,
}
// Token created at start of send_message, replaced atomically on next request,
// dropped on completion. Cancel of the old token is a no-op on the new.
```

### A13 — Magic-string K/V access (settings, item types, modes)

```rust
// ❌ Forbidden
let mode: String = conn.query_row(
    "SELECT value FROM story_state WHERE story_id = ?1 AND key = 'active_mode'",
    [story_id], |r| r.get(0)).unwrap_or_else(|_| "normal".into());
if mode == "handover" { ... }

// ✅ Preferred — typed enum for the setting key + serde-tagged enum for the value
let mode: AppMode = db::settings::get_story_state(conn, story_id, StoryStateKey::ActiveMode)?;
match mode {
    AppMode::Story      => { ... }
    AppMode::Handover   => { ... }
    AppMode::Consulting => { ... }
}
```

---

## Cross-References

- **Doc 02 (Security Model)** — sets the red lines on key handling, content logging, and external network requests that this doc enforces in code.
- **Doc 03 (Data Model)** — source of truth for schema; the typed `AppSettingKey` / `StoryStateKey` enums (§Settings Access) mirror its key tables; numbered migrations (§Schema Migrations) implement its DDL.
- **Doc 05 (Backend Modules)** — owns the canonical Rust shape: module DAG, AppState locking discipline, `LoomError` variants, and the lock-helper signatures (SB-5) and cancellation lifecycle (SB-4) that this doc establishes the rules for.
- **Doc 06 (Frontend Architecture)** — owns the seven-store partition and the no-cross-store-imports rule that this doc lints; owns `tauriApi/` shape and component-layer rules.
- **Doc 07 (IPC Contracts)** — the table-of-record for command signatures; signature-drift policy (§Tauri Command Discipline) requires same-PR updates here.
- **Doc 08 (Design Tokens)** — source of truth for colour values; `var(--color-*)` rule (§Token Usage) cites tokens defined there.
- **Doc 12 (Empty States and Errors)** — display-layer mapping for `LoomError` variants; the IPC error-handling rule (§Error Handling) routes errors there.
- **Doc 25 (Testing Strategy)** — currently a stub. Will refine §Testing Conventions into a full layered plan.
- **Doc 26 (Build and Release)** — currently a stub. Will own the CI workflow file that implements §CI Gates.
- **`PRE-IMPLEMENTATION-AUDIT.md`** — substrate items SB-1 through SB-6 have their rule home here; the embedded `<!-- SB-N -->` anchors locate each.
- **`IMPROVEMENT-BACKLOG.md`** — R3 / R5 / R13 / R19 closed by this doc; R2 (SB-1) / R4 (SB-3) / R17 (SB-5) / R18 (SB-6) spec'd here, code pending Phase 0.
- **`V1-LESSONS.md`** — the source for Appendix A; each anti-pattern A* in this doc maps to the corresponding numbered lesson.
