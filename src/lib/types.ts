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
