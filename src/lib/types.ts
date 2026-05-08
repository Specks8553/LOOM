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
  world_meta_path: string;
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

// --- Phase 2A — Worlds ---

/** `world_meta.json` payload — Doc 03 §`world_meta.json`. Display cache for the World Picker. */
export type WorldMeta = {
  id: string;
  name: string;
  tags: string[];
  accent_color: string;
  cover_image_path: string | null;
  created_at: string;
  modified_at: string;
};

/**
 * Patch payload for `update_world_meta` — Doc 03 §IPC Payload and Result Types.
 * Optional fields; pass `null` on `cover_image_path` to clear it. Omit a field
 * to leave it untouched.
 */
export type WorldMetaPatch = {
  name?: string;
  tags?: string[];
  accent_color?: string;
  /** `null` clears, `string` sets, omit to leave untouched. */
  cover_image_path?: string | null;
};

/** Doc 03 §`items`. Vault tree node — Story / Folder / SourceDocument / Image. */
export type VaultItemType = 'Story' | 'Folder' | 'SourceDocument' | 'Image';

export type ImageAssetMeta = {
  width: number;
  height: number;
  mime_type: string;
};

/**
 * Doc 03 §IPC Payload and Result Types `VaultItemMeta`. Returned by
 * `list_items`, `create_item`, etc. Image-only fields are null for other
 * item types.
 */
export type VaultItemMeta = {
  id: string;
  parent_id: string | null;
  item_type: VaultItemType;
  item_subtype: string | null;
  name: string;
  description: string | null;
  sort_order: number;
  created_at: string;
  modified_at: string;
  deleted_at: string | null;
  asset_path: string | null;
  asset_meta: ImageAssetMeta | null;
  file_api_uri: string | null;
};
