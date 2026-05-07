// AUTO-GENERATED — DO NOT EDIT. Edit the Rust struct instead.
// Source: src-tauri/src/ — every type that crosses the IPC boundary derives ts_rs::TS.
// Regenerate with `cargo test --test ts_rs_export -p loom_app`.
// CI gate: `pnpm check:types`.

export type ValidationKind =
  | 'generic'
  | 'invalid_setting_value'
  | 'no_baseline'
  | 'protected_sentinel';

export type LoomError =
  | { kind: 'crypto'; message: string }
  | { kind: 'database'; message: string }
  | { kind: 'not_found'; message: string }
  | { kind: 'validation'; validation_kind: ValidationKind; key: string | null; reason: string }
  | { kind: 'forbidden'; message: string }
  | { kind: 'api_error'; message: string }
  | { kind: 'cache_create'; message: string }
  | { kind: 'rate_limited'; message: string }
  | { kind: 'io'; message: string }
  | { kind: 'serialization'; message: string }
  | { kind: 'internal'; message: string };

export type AppPhase = 'onboarding' | 'locked' | 'workspace';
