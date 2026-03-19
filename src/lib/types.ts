/** World metadata from world_meta.json — Doc 08 §7. */
export interface WorldMeta {
  id: string;
  name: string;
  tags: string[];
  cover_image: string | null;
  accent_color: string;
  created_at: string;
  modified_at: string;
  deleted_at: string | null;
}

/** Vault item metadata (excludes content/story_id for list views). */
export interface VaultItemMeta {
  id: string;
  parent_id: string | null;
  item_type: "Story" | "Folder" | "SourceDocument" | "Image";
  item_subtype: string | null;
  name: string;
  description: string | null;
  sort_order: number;
  created_at: string;
  modified_at: string;
  deleted_at: string | null;
}

// ─── Conversation Types — Doc 09 §1 ─────────────────────────────────────────

/** Three-field user input per Doc 09 §4.1. */
export interface UserContent {
  plot_direction: string;
  background_information: string;
  modificators: string[];
  constraints: string;
  output_length: number | null;
  /** Names of context docs attached at send time (display only, not sent to API). */
  context_doc_names?: string[];
}

/** Message stored in DB — Doc 09 §1.3. */
export interface ChatMessage {
  id: string;
  story_id: string;
  parent_id: string | null;
  role: "user" | "model";
  content_type: "json_user" | "text" | "blocks";
  content: string;
  token_count: number | null;
  model_name: string | null;
  finish_reason: "STOP" | "MAX_TOKENS" | "SAFETY" | "ERROR" | null;
  created_at: string;
  deleted_at: string | null;
  user_feedback: string | null;
  ghostwriter_history: string;
}

/** Return type for load_story_messages. */
export interface StoryPayload {
  messages: ChatMessage[];
  sibling_counts: SiblingCount[];
}

/** Fork point with sibling count. */
export interface SiblingCount {
  parent_id: string;
  count: number;
}

/** Emitted per streaming token via Tauri event. */
export interface StreamChunk {
  message_id: string;
  delta: string;
}

/** Emitted when streaming completes. */
export interface StreamDone {
  message_id: string;
  user_msg_id: string;
  model_msg: ChatMessage;
}

// ─── Phase 9: Context Doc Types ──────────────────────────────────────────────

/** Context doc info returned from backend. */
export interface ContextDoc {
  id: string;
  name: string;
  item_subtype: string | null;
  content: string;
}

// ─── Phase 11: Source Document Types ─────────────────────────────────────────

/** Full vault item including content (for doc editor). */
export interface VaultItem {
  id: string;
  parent_id: string | null;
  item_type: "Story" | "Folder" | "SourceDocument" | "Image";
  item_subtype: string | null;
  name: string;
  content: string;
  description: string | null;
  sort_order: number;
  created_at: string;
  modified_at: string;
  deleted_at: string | null;
}

/** Source Document template. */
export interface Template {
  id: string;
  slug: string;
  name: string;
  icon: string;
  default_content: string;
  is_builtin: boolean;
  created_at: string;
  modified_at: string;
}

// ─── Phase 10: Rate Limiting Types ──────────────────────────────────────────

/** Telemetry counters returned from backend. */
export interface TelemetryCounters {
  req_count_min: number;
  req_count_day: number;
  token_count_min: number;
  rpm_limit: number;
  tpm_limit: number;
  rpd_limit: number;
}

/** Rate limit check result. */
export interface RateLimitStatus {
  can_proceed: boolean;
  reason: string | null;
}

/** Parse user message content from JSON string.
 *  Handles backward-compat for messages created before constraints/output_length. */
export function parseUserContent(content: string): UserContent {
  const raw = JSON.parse(content);
  return {
    plot_direction: raw.plot_direction ?? "",
    background_information: raw.background_information ?? "",
    modificators: raw.modificators ?? [],
    constraints: raw.constraints ?? "",
    output_length: raw.output_length ?? null,
    context_doc_names: raw.context_doc_names ?? [],
  };
}
