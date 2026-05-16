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

// --- Phase 6 — Context Caching (Doc 22) ---

/** Doc 03 §TypeScript Interfaces §Context Caching. Story-cache status. */
export type CacheStatus = {
  cache_name: string | null;
  expiry_at: string | null;
  is_stale: boolean;
  last_cached_message_id: string | null;
  total_token_count: number | null;
  /** doc_id → SHA-256 hex (BTreeMap on the Rust side; key order is sorted). */
  doc_snapshots: Record<string, string>;
};

/** Right-pane Cache section row. Story rows have `session_id = null`;
 *  consulting rows (Phase 6C) carry session_id + session_name. */
export type AliveCacheRow = {
  story_id: string;
  story_name: string;
  session_id: string | null;
  session_name: string | null;
  total_tokens: number;
  expiry_at: string;
  is_stale: boolean;
};

/** Payload of `cache_state_changed` event. */
export type CacheStateChangedPayload = {
  story_id: string;
  status: CacheStatus;
};

/** Payload of `cache_unavailable` event — emitted when a cache create
 *  failed and the send fell back to inline assembly. */
export type CacheUnavailablePayload = {
  story_id: string;
  reason: 'create_failed';
};

/** Doc 03 §TypeScript Interfaces §Context Caching. Consulting-session cache. */
export type SessionCacheStatus = {
  cache_name: string | null;
  expiry_at: string | null;
  is_stale: boolean;
};

/** Payload of `session_cache_state_changed` event. */
export type SessionCacheStateChangedPayload = {
  session_id: string;
  status: SessionCacheStatus;
};

/** Doc 22 §Re-entry algorithm. Non-blocking divergences recorded while
 *  rebuilding a session's cache prefix from snapshot. */
export type SessionDivergenceKind =
  | 'missing_story_message'
  | 'missing_attached_doc'
  | 'attached_doc_changed'
  | 'prefix_hash_mismatch';

export type SessionDivergence = {
  kind: SessionDivergenceKind;
  /** id of the message / doc / segment; empty for prefix_hash_mismatch. */
  id: string;
};

/** Payload of `session_cache_diverged` — surfaces as a non-blocking toast
 *  on session re-entry per Doc 22 §Re-entry. */
export type SessionCacheDivergedPayload = {
  session_id: string;
  divergences: SessionDivergence[];
};

// --- Phase 7 — Accordion (Doc 16) ---

/** Doc 03 §`checkpoints`. The start sentinel has `after_message_id = null`
 *  and `is_start = true`; user checkpoints anchor to an AI bubble id. */
export type Checkpoint = {
  id: string;
  story_id: string;
  after_message_id: string | null;
  name: string;
  is_start: boolean;
  created_at: string;
  modified_at: string;
};

/** Doc 03 §`accordion_segments`. A closed segment between two checkpoints.
 *  Open segments (after the most-recent checkpoint) have no row. */
export type AccordionSegment = {
  id: string;
  story_id: string;
  start_cp_id: string;
  end_cp_id: string;
  summary: string | null;
  is_collapsed: boolean;
  use_summary: boolean;
  is_stale: boolean;
  summarised_at: string | null;
  created_at: string;
  modified_at: string;
};

/** Aggregate returned by `get_accordion_state`. */
export type AccordionState = {
  checkpoints: Checkpoint[];
  segments: AccordionSegment[];
};

/** Payload of `accordion_state_changed` event. Optional ids let the frontend
 *  re-fetch surgically; full re-fetch is also acceptable. */
export type AccordionStateChangedPayload = {
  story_id: string;
  segment_id: string | null;
  checkpoint_id: string | null;
};

// --- Phase 8 — Ghostwriter (Doc 17) ---

/** Canonical Ghostwriter edit record per Doc 03 §`GhostwriterEdit` (HB-1).
 *  Stored as one element in the `messages.ghostwriter_history` JSON array. */
export type GhostwriterEdit = {
  edited_at: string;
  original_content: string;
  new_content: string;
  instruction: string;
  selected_text: string;
};

/** Returned by `send_ghostwriter_request`. The frontend stitches per Doc 17
 *  §Response: `new = before + revised_passage.trim() + after`. `cancelled`
 *  is `true` iff the user cancelled mid-flight (then `revised_passage` is
 *  empty and the panel returns to `selecting`). */
export type GhostwriterResponse = {
  revised_passage: string;
  token_count: bigint | null;
  cancelled: boolean;
};

/** Returned by `revert_ghostwriter_edit`. Lets the frontend re-render the
 *  bubble and decide whether to keep the `[Revert]` action visible. */
export type RevertResult = {
  restored_content: string;
  remaining_history_len: number;
};

/** Doc 17 §Selection. Character offsets into `messages.content` (UTF-16 code
 *  units, matching the JS `Selection` API). */
export type GhostwriterSelection = {
  startOffset: number;
  endOffset: number;
  selectedText: string;
};

/** Doc 17 §Diff Display. One span of the word-level LCS diff between the
 *  original message content and the stitched revision. */
export type DiffSpan = { kind: 'unchanged'; text: string } | { kind: 'changed'; text: string };

// --- Phase 11 — Settings & Themes (Doc 20) ---

/**
 * Doc 03 §`ResolvedSettings`. Merged settings cascade (world override → app
 * default → hardcoded fallback) returned by `get_resolved_settings`. The
 * frontend consumes this directly — theme, runtime gen params, ceilings.
 */
export type ResolvedSettings = {
  // Gemini
  text_model_name: string;
  gen_temperature: number;
  gen_top_p: number;
  gen_top_k: number;
  gen_max_output_tokens: number;
  gen_summarise_temperature: number;
  gen_summarise_top_p: number;
  gen_summarise_top_k: number;
  gen_summarise_max_output_tokens: number;
  cache_ttl_secs: number;
  cache_min_tokens: number;
  context_token_limit: number;
  // Theme
  accent_color: string;
  body_font: string;
  bubble_user_color: string;
  bubble_ai_color: string;
  ghostwriter_color: string;
  accordion_color: string;
  checkpoint_color: string;
  feedback_color: string;
  // System Instructions
  story_si: string;
  handover_si: string;
  consulting_si: string;
  aux_slot_1_name: string;
  aux_slot_1_content: string;
  aux_slot_2_name: string;
  aux_slot_2_content: string;
  // App-only (world cannot override)
  has_api_key: boolean;
  auto_lock_secs: number;
  rate_limit_rpm: number;
  rate_limit_tpm: number;
  rate_limit_rpd: number;
};

/** Doc 03 §`templates`. A source-document template — built-in or user-created. */
export type Template = {
  id: string;
  slug: string;
  name: string;
  icon: string;
  default_content: string;
  /** Forward-compat for the v2.1 Source Document Creator — not surfaced in v2.0. */
  creator_instructions: string;
  is_builtin: boolean;
  sort_order: number;
  created_at: string;
  modified_at: string;
};

/** Payload of the `settings_changed` event. Frontend re-fetches the cascade
 *  and re-runs `applyTheme` on receipt. `key` is the changed setting key, or
 *  the tab name for a bulk tab-clear, or `'templates'` for a template change. */
export type SettingsChangedPayload = {
  scope: 'app' | 'world';
  key: string;
};
