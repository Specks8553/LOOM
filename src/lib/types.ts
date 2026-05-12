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

// --- Phase 3 — Conversation Engine ---

export type MessageRole = 'user' | 'model';
export type ContentType = 'json_user' | 'text' | 'blocks';
export type MessageKind = 'story' | 'handover' | 'consulting';
export type FinishReason = 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'ERROR';

/**
 * Doc 03 §`messages`. Linear conversation message — story or session.
 * `content` parses as `UserContent` JSON when `content_type === 'json_user'`,
 * otherwise plain text.
 */
export type ChatMessage = {
  id: string;
  story_id: string;
  session_id: string | null;
  role: string;
  content_type: string;
  content: string;
  token_count: number | null;
  model_name: string | null;
  finish_reason: string | null;
  created_at: string;
  deleted_at: string | null;
  user_feedback: string | null;
  ghostwriter_history: string;
  kind: string;
};

/** Doc 15 §User Input Fields. The four story-mode input fields. */
export type UserContent = {
  plot_direction: string;
  background_information: string;
  modificators: string[];
  constraints: string;
};

/** Persisted draft per Doc 15 §Drafts; same shape as UserContent. */
export type InputDraft = UserContent;

/** Doc 15 §Token Counting. Phase 3 returns only `total`; Phase 5 splits the buckets. */
export type TokenEstimate = {
  history_tokens: number;
  doc_tokens: number;
  user_turn_tokens: number;
  total: number;
};

/** Returned by `send_message`. The frontend pairs the optimistic user
 *  bubble with the persisted ids and listens for `message_chunk` /
 *  `message_complete` keyed on `model_message_id`. */
export type SendMessageResult = {
  user_message_id: string;
  model_message_id: string;
};

// --- Phase 4 — Modes (Doc 23) ---

/** Handover or consulting. Story is the implicit thread (no session). */
export type SessionKind = 'handover' | 'consulting';

/** Doc 03 §`conversation_sessions`. `entry_snapshot` is a JSON string;
 *  the frontend rarely needs to parse it (the cache rebuild path is
 *  backend-only). */
export type ConversationSession = {
  id: string;
  story_id: string;
  /** 'handover' | 'consulting' — the typed enum lives on `SessionKind`. */
  kind: string;
  name: string;
  entry_message_id: string | null;
  /** Stringified `SessionSnapshot` JSON. */
  entry_snapshot: string;
  is_collapsed: boolean;
  /** Populated only for consulting sessions with an active Gemini cache.
   *  Handover never sets these; the table CHECK enforces it. */
  cache_name: string | null;
  cache_expiry_at: string | null;
  cache_is_stale: boolean;
  created_at: string;
  modified_at: string;
};

/** Doc 22 §Session Snapshot. Phase 4 captures; Phase 6 uses on re-entry. */
export type SessionSnapshot = {
  schema_version: number;
  system_instruction: string;
  story_message_ids: string[];
  /** Empty in Phase 4; Phase 7 populates. */
  accordion_state: AccordionSnapshotEntry[];
  /** Empty in Phase 4; Phase 5 populates. */
  attached_docs: AttachedDocEntry[];
  prefix_hash: string;
};

export type AccordionSnapshotEntry = {
  segment_id: string;
  is_collapsed: boolean;
  summary: string | null;
  summary_hash: string | null;
};

export type AttachedDocEntry = {
  doc_id: string;
  content_hash: string;
};

/** Returned by `send_session_message`. Same shape as `SendMessageResult`. */
export type SendSessionMessageResult = {
  user_message_id: string;
  model_message_id: string;
};

/**
 * Per-story active mode — Doc 23 §Re-opening. Persisted via the typed
 * `StoryStateKey::ActiveMode` / `ActiveSessionId` accessors. `active_mode`
 * is one of `'story' | 'handover' | 'consulting'`. `active_session_id` is
 * null in story mode and after a silent fallback per CD-9 (named session
 * was deleted between reopen and this read).
 */
export type StoryActiveMode = {
  active_mode: 'story' | 'handover' | 'consulting';
  active_session_id: string | null;
};
