// Manually maintained TypeScript types mirroring Rust structs.
// The ts-rs reference output lives at src-tauri/src/lib/types.ts.
// Run `cargo test` to regenerate the reference; keep this file in sync manually.

// --- Phase 0 ---

export type ValidationKind = 'required' | 'too_short' | 'too_long' | 'invalid_format';

export type LoomError =
  | { kind: 'validation'; field: string; message: string; validation_kind: ValidationKind }
  | { kind: 'not_found'; message: string }
  | { kind: 'database'; message: string }
  | { kind: 'crypto'; message: string }
  | { kind: 'io'; message: string }
  | { kind: 'serialization'; message: string }
  | { kind: 'internal'; message: string };

export type AppPhase = 'onboarding' | 'locked' | 'workspace';

// --- Phase 1 ---

/** Sentinel payload stored in `app_config.json`. */
export type Sentinel = {
  nonce_hex: string;
  ciphertext_hex: string;
};

/** Represents one entry in the worlds registry. */
export type WorldEntry = {
  id: string;
  name: string;
  db_path: string;
};

/** Full `app_config.json` payload. */
export type AppConfig = {
  worlds: Array<WorldEntry>;
  active_world_id: string | null;
  salt_hex: string;
  key_check: Sentinel;
};

/** Result returned by `unlock_vault`. */
export type UnlockResult = {
  has_api_key: boolean;
  auto_lock_secs: bigint;
};
