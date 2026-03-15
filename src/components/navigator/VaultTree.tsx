import { useMemo, useCallback, createContext } from "react";
import type { VaultItemMeta } from "../../lib/types";
import { useVaultStore } from "../../stores/vaultStore";
import { vaultMoveItem, vaultListItems } from "../../lib/tauriApi";
import { VaultTreeNode } from "./VaultTreeNode";
import { EmptyVault } from "../empty/EmptyVault";
import { NoSearchResults } from "../empty/NoSearchResults";

export interface TreeNode {
  item: VaultItemMeta;
  children: TreeNode[];
}

export const VaultTreeContext = createContext<{ flatOrder: string[] }>({
  flatOrder: [],
});

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

/** Computes flat pre-order traversal of visible items. */
function computeFlatOrder(
  tree: TreeNode[],
  expandedPaths: Set<string>,
  visibleIds: Set<string> | null,
  isFiltering: boolean,
): string[] {
  const result: string[] = [];

  function walk(nodes: TreeNode[]) {
    for (const node of nodes) {
      if (visibleIds && !visibleIds.has(node.item.id)) continue;
      result.push(node.item.id);
      const showChildren = node.item.item_type === "Folder" &&
        (expandedPaths.has(node.item.id) || isFiltering);
      if (showChildren && node.children.length > 0) {
        walk(node.children);
      }
    }
  }

  walk(tree);
  return result;
}

// Module-level drag state for cross-component communication
let draggedItemIds: string[] = [];
export function getDraggedItemIds(): string[] {
  return draggedItemIds;
}
export function setDraggedItemIds(ids: string[]) {
  draggedItemIds = ids;
}

interface VaultTreeProps {
  onCreateClick: () => void;
}

export function VaultTree({ onCreateClick }: VaultTreeProps) {
  const items = useVaultStore((s) => s.items);
  const filterQuery = useVaultStore((s) => s.filterQuery);
  const expandedPaths = useVaultStore((s) => s.expandedPaths);
  const setItems = useVaultStore((s) => s.setItems);

  const tree = useMemo(() => buildTree(items), [items]);

  const isFiltering = filterQuery.trim().length > 0;
  const visibleIds = useMemo(
    () => (isFiltering ? filterTree(tree, filterQuery.trim()) : null),
    [tree, filterQuery, isFiltering],
  );

  const flatOrder = useMemo(
    () => computeFlatOrder(tree, expandedPaths, visibleIds, isFiltering),
    [tree, expandedPaths, visibleIds, isFiltering],
  );

  // Root drop zone handler
  const handleRootDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleRootDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const ids = getDraggedItemIds();
      if (ids.length === 0) return;

      // Move all dragged items to root with sort_order after last root item
      const rootItems = items
        .filter((i) => i.parent_id === null)
        .sort((a, b) => a.sort_order - b.sort_order);
      let nextOrder = rootItems.length > 0
        ? rootItems[rootItems.length - 1].sort_order + 1
        : 0;

      try {
        for (const id of ids) {
          await vaultMoveItem(id, null, nextOrder);
          nextOrder++;
        }
        const refreshed = await vaultListItems();
        setItems(refreshed);
      } catch (err) {
        console.error("Failed to move items to root:", err);
      }
    },
    [items, setItems],
  );

  if (items.length === 0) {
    return <EmptyVault onCreateClick={onCreateClick} />;
  }

  if (isFiltering && visibleIds && visibleIds.size === 0) {
    return <NoSearchResults query={filterQuery.trim()} />;
  }

  function renderNodes(nodes: TreeNode[], depth: number) {
    return nodes.map((node) => {
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
    <VaultTreeContext.Provider value={{ flatOrder }}>
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden py-1"
        onDragOver={handleRootDragOver}
        onDrop={handleRootDrop}
      >
        {renderNodes(tree, 0)}
      </div>
    </VaultTreeContext.Provider>
  );
}
