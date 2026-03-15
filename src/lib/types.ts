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

/** Parse user message content from JSON string. */
export function parseUserContent(content: string): UserContent {
  return JSON.parse(content) as UserContent;
}
