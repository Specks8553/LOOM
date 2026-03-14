import { useMemo } from "react";
import type { VaultItemMeta } from "../../lib/types";
import { useVaultStore } from "../../stores/vaultStore";
import { VaultTreeNode } from "./VaultTreeNode";
import { EmptyVault } from "../empty/EmptyVault";
import { NoSearchResults } from "../empty/NoSearchResults";

interface TreeNode {
  item: VaultItemMeta;
  children: TreeNode[];
}

function buildTree(items: VaultItemMeta[]): TreeNode[] {
  const childrenMap = new Map<string | null, VaultItemMeta[]>();
  for (const item of items) {
    const key = item.parent_id;
    const list = childrenMap.get(key);
    if (list) {
      list.push(item);
    } else {
      childrenMap.set(key, [item]);
    }
  }

  function buildNodes(parentId: string | null): TreeNode[] {
    const children = childrenMap.get(parentId) ?? [];
    children.sort((a, b) => a.sort_order - b.sort_order);
    return children.map((item) => ({
      item,
      children: buildNodes(item.id),
    }));
  }

  return buildNodes(null);
}

/** Returns set of item IDs that match filter or have matching descendants. */
function filterTree(tree: TreeNode[], query: string): Set<string> {
  const visible = new Set<string>();
  const lowerQuery = query.toLowerCase();

  function walk(node: TreeNode): boolean {
    const nameMatch = node.item.name.toLowerCase().includes(lowerQuery);
    let childMatch = false;
    for (const child of node.children) {
      if (walk(child)) childMatch = true;
    }
    if (nameMatch || childMatch) {
      visible.add(node.item.id);
      return true;
    }
    return false;
  }

  for (const root of tree) {
    walk(root);
  }
  return visible;
}

interface VaultTreeProps {
  onCreateClick: () => void;
}

export function VaultTree({ onCreateClick }: VaultTreeProps) {
  const items = useVaultStore((s) => s.items);
  const filterQuery = useVaultStore((s) => s.filterQuery);
  const expandedPaths = useVaultStore((s) => s.expandedPaths);

  const tree = useMemo(() => buildTree(items), [items]);

  const isFiltering = filterQuery.trim().length > 0;
  const visibleIds = useMemo(
    () => (isFiltering ? filterTree(tree, filterQuery.trim()) : null),
    [tree, filterQuery, isFiltering],
  );

  if (items.length === 0) {
    return <EmptyVault onCreateClick={onCreateClick} />;
  }

  if (isFiltering && visibleIds && visibleIds.size === 0) {
    return <NoSearchResults query={filterQuery.trim()} />;
  }

  function renderNodes(nodes: TreeNode[], depth: number) {
    return nodes.map((node) => {
      // Skip items not matching filter
      if (visibleIds && !visibleIds.has(node.item.id)) return null;

      const isExpanded = expandedPaths.has(node.item.id);

      return (
        <VaultTreeNode
          key={node.item.id}
          item={node.item}
          depth={depth}
          isExpanded={isExpanded}
          isFiltering={isFiltering}
        >
          {node.children.length > 0 ? renderNodes(node.children, depth + 1) : null}
        </VaultTreeNode>
      );
    });
  }

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
      {renderNodes(tree, 0)}
    </div>
  );
}
