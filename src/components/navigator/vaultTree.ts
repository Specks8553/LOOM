import type { VaultItemMeta } from '@/lib/types';

export interface VaultTreeNode {
  item: VaultItemMeta;
  children: VaultTreeNode[];
}

/**
 * Build a forest of `VaultTreeNode` from a flat item list (Doc 14 §Vault
 * Tree). Items reference parents by `parent_id`; root items have
 * `parent_id === null`. Sort_order is honoured within each parent — the
 * backend already sorts the list by `(parent_id, sort_order)`, so we just
 * preserve the input order while bucketing by parent.
 */
export function buildTree(items: VaultItemMeta[]): VaultTreeNode[] {
  const byId = new Map<string, VaultTreeNode>();
  for (const item of items) {
    byId.set(item.id, { item, children: [] });
  }

  const roots: VaultTreeNode[] = [];
  for (const item of items) {
    const node = byId.get(item.id);
    if (!node) continue;
    if (item.parent_id === null) {
      roots.push(node);
    } else {
      const parent = byId.get(item.parent_id);
      if (parent) {
        parent.children.push(node);
      } else {
        // Orphan (parent missing or filtered out) — treat as root.
        roots.push(node);
      }
    }
  }
  return roots;
}

/**
 * Filter a flat item list by name (case-insensitive substring). Doc 14
 * §Filter / Search says ancestor folders of matching items remain visible.
 * To preserve that, when a child matches we include all of its ancestors.
 */
export function filterItems(items: VaultItemMeta[], query: string): VaultItemMeta[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return items;

  const byId = new Map(items.map((i) => [i.id, i] as const));
  const keep = new Set<string>();
  for (const item of items) {
    if (item.name.toLowerCase().includes(trimmed)) {
      keep.add(item.id);
      // Walk ancestors.
      let cursor: string | null = item.parent_id;
      while (cursor) {
        if (keep.has(cursor)) break;
        keep.add(cursor);
        const parent = byId.get(cursor);
        cursor = parent ? parent.parent_id : null;
      }
    }
  }
  return items.filter((i) => keep.has(i.id));
}
