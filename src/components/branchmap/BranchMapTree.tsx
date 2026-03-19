import { useMemo } from "react";
import type { BranchMapData, BranchMapNode as NodeType, Checkpoint } from "../../lib/types";
import { BranchMapNodeCard } from "./BranchMapNode";
import { CheckpointMarker } from "./CheckpointMarker";

interface BranchMapTreeProps {
  data: BranchMapData;
  isGenerating: boolean;
  onNodeClick: (node: NodeType) => void;
  onNodeContextMenu: (e: React.MouseEvent, node: NodeType) => void;
  onCheckpointContextMenu: (e: React.MouseEvent, cp: Checkpoint) => void;
  renamingCpId: string | null;
  renameValue: string;
  onRenameChange: (value: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onCollapsedClick: (nodeIds: string[]) => void;
  expandedNodeIds: Set<string>;
}

/** A processed tree node used for rendering. */
interface TreeNode {
  type: "node";
  node: NodeType;
  children: TreeEntry[];
}

interface CollapsedRun {
  type: "collapsed";
  count: number;
  nodeIds: string[]; // model_msg_ids of collapsed nodes, for expansion
}

interface RenameProps {
  renamingCpId: string | null;
  renameValue: string;
  onRenameChange: (value: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
}

interface CheckpointEntry {
  type: "checkpoint";
  checkpoint: Checkpoint;
}

type TreeEntry = TreeNode | CollapsedRun | CheckpointEntry;

export function BranchMapTree({
  data,
  isGenerating,
  onNodeClick,
  onNodeContextMenu,
  onCheckpointContextMenu,
  renamingCpId,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onCollapsedClick,
  expandedNodeIds,
}: BranchMapTreeProps) {
  const tree = useMemo(() => buildTree(data, expandedNodeIds), [data, expandedNodeIds]);

  if (!tree) {
    return (
      <div className="px-4 py-8 text-center text-[13px]" style={{ color: "var(--color-text-muted)" }}>
        No messages yet.
      </div>
    );
  }

  const renameProps = { renamingCpId, renameValue, onRenameChange, onRenameSubmit, onRenameCancel };

  return (
    <div className="px-3 pb-6">
      {renderEntries([tree], data.current_leaf_id, isGenerating, onNodeClick, onNodeContextMenu, onCheckpointContextMenu, renameProps, onCollapsedClick, true)}
    </div>
  );
}

// ─── Tree Building ──────────────────────────────────────────────────────────

function buildTree(data: BranchMapData, expandedNodeIds: Set<string>): TreeEntry | null {
  if (data.nodes.length === 0) return null;

  // Build lookup maps
  const nodeMap = new Map<string, NodeType>();
  for (const n of data.nodes) {
    nodeMap.set(n.model_msg_id, n);
  }

  // Build children map: parent_model_msg_id -> [child nodes]
  const childrenMap = new Map<string, NodeType[]>();
  // Track which nodes are children (have a parent edge)
  const hasParentEdge = new Set<string>();

  for (const edge of data.edges) {
    // Find the node whose user_msg_id matches child_user_msg_id
    const childNode = data.nodes.find((n) => n.user_msg_id === edge.child_user_msg_id);
    if (childNode) {
      const existing = childrenMap.get(edge.parent_model_msg_id) ?? [];
      existing.push(childNode);
      childrenMap.set(edge.parent_model_msg_id, existing);
      hasParentEdge.add(childNode.model_msg_id);
    }
  }

  // Find root node (no incoming edge)
  const root = data.nodes.find((n) => !hasParentEdge.has(n.model_msg_id));
  if (!root) return null;

  // Build checkpoint map: after_message_id -> checkpoint
  const checkpointMap = new Map<string | null, Checkpoint>();
  for (const cp of data.checkpoints) {
    checkpointMap.set(cp.after_message_id, cp);
  }

  // Find active path (root → current_leaf)
  const activePath = new Set<string>();
  buildActivePath(root.model_msg_id, data.current_leaf_id, childrenMap, data.nodes, activePath);

  // Build tree with collapsing
  return buildTreeNode(root, childrenMap, checkpointMap, activePath, expandedNodeIds);
}

function buildActivePath(
  currentId: string,
  targetId: string,
  childrenMap: Map<string, NodeType[]>,
  _nodes: NodeType[],
  path: Set<string>,
): boolean {
  path.add(currentId);
  if (currentId === targetId) return true;

  const children = childrenMap.get(currentId) ?? [];
  for (const child of children) {
    if (buildActivePath(child.model_msg_id, targetId, childrenMap, _nodes, path)) {
      return true;
    }
  }
  path.delete(currentId);
  return false;
}

function buildTreeNode(
  node: NodeType,
  childrenMap: Map<string, NodeType[]>,
  checkpointMap: Map<string | null, Checkpoint>,
  activePath: Set<string>,
  expandedNodeIds: Set<string>,
): TreeEntry {
  const children = childrenMap.get(node.model_msg_id) ?? [];

  // If this node has exactly one child and that child also has exactly one child (or is a leaf),
  // and it's not on a fork point, we can potentially collapse
  // But: fork points (>1 child) and leaves always render as full nodes
  // Active path nodes always render

  const childEntries: TreeEntry[] = [];

  for (const child of children) {
    const cp = checkpointMap.get(node.model_msg_id);
    if (cp) {
      childEntries.push({ type: "checkpoint", checkpoint: cp });
    }

    const grandchildren = childrenMap.get(child.model_msg_id) ?? [];

    // Can we collapse a straight sequence starting from this child?
    if (
      children.length === 1 &&
      grandchildren.length <= 1 &&
      !child.is_current_leaf &&
      !activePath.has(child.model_msg_id) &&
      !expandedNodeIds.has(child.model_msg_id)
    ) {
      // Start collapsing: count consecutive straight nodes not on active path
      const run = collectStraightRun(child, childrenMap, activePath, expandedNodeIds);
      if (run.count > 0) {
        childEntries.push({ type: "collapsed", count: run.count, nodeIds: run.nodeIds });
        if (run.nextNode) {
          childEntries.push(buildTreeNode(run.nextNode, childrenMap, checkpointMap, activePath, expandedNodeIds));
        }
      } else {
        childEntries.push(buildTreeNode(child, childrenMap, checkpointMap, activePath, expandedNodeIds));
      }
    } else {
      childEntries.push(buildTreeNode(child, childrenMap, checkpointMap, activePath, expandedNodeIds));
    }
  }

  return {
    type: "node",
    node,
    children: childEntries,
  };
}

function collectStraightRun(
  start: NodeType,
  childrenMap: Map<string, NodeType[]>,
  activePath: Set<string>,
  expandedNodeIds: Set<string>,
): { count: number; nodeIds: string[]; nextNode: NodeType | null } {
  let count = 0;
  const nodeIds: string[] = [];
  let current: NodeType | null = start;

  while (current) {
    const children: NodeType[] = childrenMap.get(current.model_msg_id) ?? [];

    // Stop collapsing if: on active path, is a fork point, is current leaf, or is expanded
    if (activePath.has(current.model_msg_id) || children.length > 1 || current.is_current_leaf || expandedNodeIds.has(current.model_msg_id)) {
      return { count, nodeIds, nextNode: current };
    }

    count++;
    nodeIds.push(current.model_msg_id);

    if (children.length === 0) {
      return { count, nodeIds, nextNode: null }; // end of branch
    }

    current = children[0];
  }

  return { count, nodeIds, nextNode: null };
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function renderEntries(
  entries: TreeEntry[],
  currentLeafId: string,
  isGenerating: boolean,
  onNodeClick: (node: NodeType) => void,
  onNodeContextMenu: (e: React.MouseEvent, node: NodeType) => void,
  onCheckpointContextMenu: (e: React.MouseEvent, cp: Checkpoint) => void,
  renameProps: RenameProps,
  onCollapsedClick: (nodeIds: string[]) => void,
  isRoot: boolean,
): React.ReactNode[] {
  const result: React.ReactNode[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    if (entry.type === "checkpoint") {
      const isRenaming = renameProps.renamingCpId === entry.checkpoint.id;
      result.push(
        <CheckpointMarker
          key={`cp-${entry.checkpoint.id}`}
          checkpoint={entry.checkpoint}
          onContextMenu={onCheckpointContextMenu}
          isRenaming={isRenaming}
          renameValue={renameProps.renameValue}
          onRenameChange={renameProps.onRenameChange}
          onRenameSubmit={renameProps.onRenameSubmit}
          onRenameCancel={renameProps.onRenameCancel}
        />,
      );
    } else if (entry.type === "collapsed") {
      result.push(
        <div
          key={`collapsed-${i}`}
          className="flex items-center justify-center py-1 cursor-pointer group"
          onClick={() => onCollapsedClick(entry.nodeIds)}
          title="Click to expand"
        >
          <div
            className="flex items-center gap-1 text-[11px] group-hover:text-[var(--color-text-secondary)] transition-colors"
            style={{ color: "var(--color-text-muted)" }}
          >
            <span className="inline-block w-4 border-t" style={{ borderColor: "var(--color-border)" }} />
            <span>{entry.count} msgs</span>
            <span className="inline-block w-4 border-t" style={{ borderColor: "var(--color-border)" }} />
          </div>
        </div>,
      );
    } else if (entry.type === "node") {
      const treeNode = entry;
      const hasFork = treeNode.children.filter((c) => c.type === "node").length > 1;

      result.push(
        <div key={treeNode.node.model_msg_id}>
          {/* Connector line above (not for root) */}
          {!isRoot && (
            <div className="flex justify-center py-0.5">
              <div className="w-px h-3" style={{ background: "var(--color-border)" }} />
            </div>
          )}

          <BranchMapNodeCard
            node={treeNode.node}
            isGenerating={isGenerating}
            onClick={onNodeClick}
            onContextMenu={onNodeContextMenu}
          />

          {/* Children */}
          {treeNode.children.length > 0 && (
            <>
              {/* Connector line below */}
              <div className="flex justify-center py-0.5">
                <div className="w-px h-3" style={{ background: "var(--color-border)" }} />
              </div>

              {hasFork ? (
                // Fork: render children side by side with branch lines
                <div className="flex gap-2">
                  {treeNode.children.map((child, ci) => (
                    <div
                      key={ci}
                      className="flex-1 min-w-0"
                      style={{
                        borderLeft: ci > 0 ? "1px solid var(--color-border)" : undefined,
                        paddingLeft: ci > 0 ? "8px" : undefined,
                      }}
                    >
                      {renderEntries(
                        [child],
                        currentLeafId,
                        isGenerating,
                        onNodeClick,
                        onNodeContextMenu,
                        onCheckpointContextMenu,
                        renameProps,
                        onCollapsedClick,
                        false,
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                // Straight: render children inline
                renderEntries(
                  treeNode.children,
                  currentLeafId,
                  isGenerating,
                  onNodeClick,
                  onNodeContextMenu,
                  onCheckpointContextMenu,
                  renameProps,
                  onCollapsedClick,
                  false,
                )
              )}
            </>
          )}
        </div>,
      );
    }
  }

  return result;
}
