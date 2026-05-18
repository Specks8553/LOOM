import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { CreateMenu } from '@/components/navigator/CreateMenu';
import { VaultTreeRow } from '@/components/navigator/VaultTreeRow';
import { buildTree, filterItems, type VaultTreeNode } from '@/components/navigator/vaultTree';
import { deleteItem, deleteItemPermanent, moveItem, restoreItem } from '@/lib/tauriApi/vault';
import { useVaultStore } from '@/stores/vaultStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { VaultItemMeta } from '@/lib/types';

interface NavigatorProps {
  onLock: () => void;
  onOpenWorldPicker: () => void;
  onOpenSettings: () => void;
}

/**
 * Doc 14 §Navigator Structure. Top: world picker / settings / lock.
 * Middle: filter bar + create button. Body: vault tree (or Trash view).
 * Bottom: Trash row.
 */
export function Navigator({ onLock, onOpenWorldPicker, onOpenSettings }: NavigatorProps) {
  const worlds = useVaultStore((s) => s.worlds);
  const activeWorldId = useVaultStore((s) => s.activeWorldId);
  const items = useVaultStore((s) => s.items);
  const trashItems = useVaultStore((s) => s.trashItems);
  const filterQuery = useVaultStore((s) => s.filterQuery);
  const isTrashView = useVaultStore((s) => s.isTrashView);
  const expandedFolderIds = useVaultStore((s) => s.expandedFolderIds);
  const selectedIds = useVaultStore((s) => s.selectedIds);

  const setFilter = useVaultStore((s) => s.setFilter);
  const setTrashView = useVaultStore((s) => s.setTrashView);
  const toggleExpanded = useVaultStore((s) => s.toggleExpanded);
  const toggleSelection = useVaultStore((s) => s.toggleSelection);
  const setSelected = useVaultStore((s) => s.setSelected);
  const loadVault = useVaultStore((s) => s.loadVault);
  const loadTrash = useVaultStore((s) => s.loadTrash);

  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [rootDropActive, setRootDropActive] = useState(false);

  const activeWorld = worlds.find((w) => w.id === activeWorldId) ?? null;

  function maxRootSortOrder(): number {
    let max = -1;
    for (const it of items) {
      if (it.parent_id === null && it.sort_order > max) max = it.sort_order;
    }
    return max;
  }

  function maxChildSortOrder(parentId: string): number {
    let max = -1;
    for (const it of items) {
      if (it.parent_id === parentId && it.sort_order > max) max = it.sort_order;
    }
    return max;
  }

  async function performMove(itemId: string, newParentId: string | null) {
    // Drop onto the same item or onto self → no-op.
    const dragging = items.find((i) => i.id === itemId);
    if (!dragging) return;
    if (newParentId === itemId) return;
    if (dragging.parent_id === newParentId) return;
    const sortOrder =
      newParentId === null ? maxRootSortOrder() + 1 : maxChildSortOrder(newParentId) + 1;
    try {
      await moveItem(itemId, newParentId, sortOrder);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Move failed');
    }
  }

  // Initial load when active world changes.
  useEffect(() => {
    if (activeWorldId === null) return;
    void loadVault().catch(console.error);
  }, [activeWorldId, loadVault]);

  // Toggle Trash view loads the trash list.
  useEffect(() => {
    if (isTrashView && activeWorldId !== null) {
      void loadTrash().catch(console.error);
    }
  }, [isTrashView, activeWorldId, loadTrash]);

  const visibleItems = filterItems(items, filterQuery);
  const tree = buildTree(visibleItems);
  const expandedSet = new Set(expandedFolderIds);
  // Doc 18: paperclip state — `contextDocIds` is the source of truth, scoped
  // to the active story. When `activeStoryId === null` the paperclip is hidden
  // entirely (see `canAttach` in VaultTreeRow).
  const activeStoryId = useWorkspaceStore((s) => s.activeStoryId);
  const contextDocIds = useWorkspaceStore((s) => s.contextDocIds);
  const attachedIdSet = new Set(contextDocIds);

  function handleSelect(item: VaultItemMeta, e: React.MouseEvent) {
    if (e.ctrlKey || e.metaKey) {
      toggleSelection(item.id);
      return;
    }
    setSelected(new Set([item.id]));

    // Phase 3 (Doc 15): clicking a Story item opens it in the Theater. Story
    // switch while generating is blocked per the cancellation taxonomy; for
    // Phase 3 the gate is a confirm prompt — a proper modal lands later.
    if (item.item_type === 'Story') {
      const ws = useWorkspaceStore.getState();
      if (ws.activeStoryId === item.id) return;
      if (ws.isGenerating) {
        if (!window.confirm('Generation in progress. Cancel and switch stories?')) return;
        void ws.cancel();
        return;
      }
      void ws.setActiveStory(item.id).catch(console.error);
    }
  }

  async function handleSoftDelete(item: VaultItemMeta) {
    try {
      await deleteItem(item.id);
      toast(`"${item.name}" moved to Trash`, {
        action: {
          label: 'Undo',
          onClick: () => {
            void restoreItem(item.id).catch(console.error);
          },
        },
        duration: 4000,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not move to Trash');
    }
  }

  function handleOpenDoc(item: VaultItemMeta) {
    // Doc 18 §When the editor opens — double-click on SourceDocument / Image.
    useWorkspaceStore.getState().openDoc(item.id);
  }

  async function handleAttachDoc(item: VaultItemMeta) {
    // Doc 18 §Attach via paperclip. The store guards against no-active-story.
    try {
      await useWorkspaceStore.getState().attachDoc(item.id);
      toast(`"${item.name}" attached to story`, { duration: 2000 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not attach document');
    }
  }

  async function handlePermanentDelete(item: VaultItemMeta) {
    if (!window.confirm(`Delete "${item.name}" permanently? This cannot be undone.`)) {
      return;
    }
    try {
      await deleteItemPermanent(item.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Permanent delete failed');
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top: world picker / settings / lock */}
      <header className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-2">
        <button
          type="button"
          onClick={onOpenWorldPicker}
          className="truncate text-[13px] font-medium text-[var(--color-text-primary)] hover:text-[var(--color-accent)]"
        >
          {activeWorld ? activeWorld.name : 'Select a world'}
        </button>
        <div className="flex items-center gap-1 text-[var(--color-text-muted)]">
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Settings"
            className="px-1 hover:text-[var(--color-text-primary)]"
          >
            ⚙
          </button>
          <button
            type="button"
            onClick={onLock}
            aria-label="Lock"
            className="px-1 hover:text-[var(--color-text-primary)]"
          >
            🔒
          </button>
        </div>
      </header>

      {/* Filter + create */}
      {!isTrashView && activeWorldId !== null && (
        <div className="flex h-8 shrink-0 items-center gap-1 border-b border-[var(--color-border)] px-2">
          <input
            type="text"
            placeholder="Filter items…"
            value={filterQuery}
            onChange={(e) => setFilter(e.target.value)}
            className="h-6 flex-1 rounded-sm border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 text-[12px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)]"
          />
          <CreateMenu
            open={createMenuOpen}
            onOpenChange={setCreateMenuOpen}
            parentId={null /* TODO(2C polish): use selected folder when available */}
            trigger={
              <button
                type="button"
                aria-label="New item"
                className="flex h-6 w-6 items-center justify-center rounded-sm text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
              >
                <Plus size={14} aria-hidden />
              </button>
            }
          />
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {activeWorldId === null ? (
          <NoWorldSelected onPick={onOpenWorldPicker} />
        ) : isTrashView ? (
          <TrashView
            items={trashItems}
            onRestore={(id) => {
              void restoreItem(id).catch((e) => toast.error(String(e)));
            }}
            onPermanentDelete={(item) => void handlePermanentDelete(item)}
          />
        ) : tree.length === 0 ? (
          <div
            onDragOver={(e) => {
              if (draggingId !== null) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setRootDropActive(true);
              }
            }}
            onDragLeave={() => setRootDropActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setRootDropActive(false);
              if (draggingId !== null) void performMove(draggingId, null);
            }}
            className={`h-full ${rootDropActive ? 'bg-[var(--color-accent-subtle)]' : ''}`}
          >
            <NoItems hasFilter={filterQuery.length > 0} />
          </div>
        ) : (
          <ul
            role="tree"
            className={`min-h-full py-1 ${rootDropActive ? 'bg-[var(--color-accent-subtle)]' : ''}`}
            onDragOver={(e) => {
              // Allow drop onto empty root area (not on a row).
              if (draggingId !== null && e.target === e.currentTarget) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setRootDropActive(true);
              }
            }}
            onDragLeave={(e) => {
              if (e.target === e.currentTarget) setRootDropActive(false);
            }}
            onDrop={(e) => {
              if (e.target === e.currentTarget) {
                e.preventDefault();
                setRootDropActive(false);
                if (draggingId !== null) void performMove(draggingId, null);
              }
            }}
          >
            {tree.map((node) => (
              <TreeBranch
                key={node.item.id}
                node={node}
                depth={0}
                expandedSet={expandedSet}
                selectedIds={selectedIds}
                draggingId={draggingId}
                dropTargetId={dropTargetId}
                attachedIdSet={attachedIdSet}
                canAttach={activeStoryId !== null}
                onToggle={toggleExpanded}
                onSelect={handleSelect}
                onOpenDoc={handleOpenDoc}
                onAttachDoc={(item) => void handleAttachDoc(item)}
                onContextDelete={(item) => void handleSoftDelete(item)}
                onDragStartItem={(id) => setDraggingId(id)}
                onDragEndItem={() => {
                  setDraggingId(null);
                  setDropTargetId(null);
                  setRootDropActive(false);
                }}
                onDropTargetChange={setDropTargetId}
                onDropOnFolder={(folderId) => {
                  if (draggingId !== null) void performMove(draggingId, folderId);
                }}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Trash row */}
      {activeWorldId !== null && (
        <button
          type="button"
          onClick={() => setTrashView(!isTrashView)}
          className={`flex h-8 shrink-0 items-center gap-2 border-t border-[var(--color-border)] px-3 text-[12px] ${
            isTrashView
              ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
          }`}
        >
          <Trash2 size={14} aria-hidden />
          <span>{isTrashView ? 'Back to vault' : 'Trash'}</span>
        </button>
      )}
    </div>
  );
}

interface TreeBranchProps {
  node: VaultTreeNode;
  depth: number;
  expandedSet: Set<string>;
  selectedIds: Set<string>;
  draggingId: string | null;
  dropTargetId: string | null;
  attachedIdSet: Set<string>;
  canAttach: boolean;
  onToggle: (id: string) => void;
  onSelect: (item: VaultItemMeta, e: React.MouseEvent) => void;
  onOpenDoc: (item: VaultItemMeta) => void;
  onAttachDoc: (item: VaultItemMeta) => void;
  onContextDelete: (item: VaultItemMeta) => void;
  onDragStartItem: (id: string) => void;
  onDragEndItem: () => void;
  onDropTargetChange: (id: string | null) => void;
  onDropOnFolder: (folderId: string) => void;
}

function TreeBranch({
  node,
  depth,
  expandedSet,
  selectedIds,
  draggingId,
  dropTargetId,
  attachedIdSet,
  canAttach,
  onToggle,
  onSelect,
  onOpenDoc,
  onAttachDoc,
  onContextDelete,
  onDragStartItem,
  onDragEndItem,
  onDropTargetChange,
  onDropOnFolder,
}: TreeBranchProps) {
  const { item, children } = node;
  const isFolder = item.item_type === 'Folder';
  const expanded = expandedSet.has(item.id);
  const canAcceptDrop = isFolder && draggingId !== null && draggingId !== item.id;

  return (
    <>
      <VaultTreeRow
        item={item}
        depth={depth}
        expanded={expanded}
        selected={selectedIds.has(item.id)}
        isFolder={isFolder}
        dropTarget={dropTargetId === item.id}
        onToggleExpanded={() => onToggle(item.id)}
        onSelect={(e) => onSelect(item, e)}
        onOpenDoc={() => onOpenDoc(item)}
        attached={attachedIdSet.has(item.id)}
        canAttach={canAttach}
        onAttachToggle={() => onAttachDoc(item)}
        onContextMenu={(e) => {
          e.preventDefault();
          // Phase 2C: keep the context menu lean — single Delete action.
          // Phase 12 will replace this with a proper popover (rename, move,
          // "Attach to story" per Doc 18, etc.). For Phase 5 the paperclip
          // affordance carries the attach interaction; right-click stays
          // delete-only here to avoid chained confirm prompts.
          if (window.confirm(`Move "${item.name}" to Trash?`)) {
            onContextDelete(item);
          }
        }}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', item.id);
          onDragStartItem(item.id);
        }}
        onDragEnd={onDragEndItem}
        onDragOver={(e) => {
          if (canAcceptDrop) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (dropTargetId !== item.id) onDropTargetChange(item.id);
          }
        }}
        onDragLeave={() => {
          if (dropTargetId === item.id) onDropTargetChange(null);
        }}
        onDrop={(e) => {
          if (canAcceptDrop) {
            e.preventDefault();
            e.stopPropagation();
            onDropTargetChange(null);
            onDropOnFolder(item.id);
          }
        }}
      />
      {isFolder && expanded && children.length > 0 && (
        <ul role="group">
          {children.map((child) => (
            <TreeBranch
              key={child.item.id}
              node={child}
              depth={depth + 1}
              expandedSet={expandedSet}
              selectedIds={selectedIds}
              draggingId={draggingId}
              dropTargetId={dropTargetId}
              attachedIdSet={attachedIdSet}
              canAttach={canAttach}
              onToggle={onToggle}
              onSelect={onSelect}
              onOpenDoc={onOpenDoc}
              onAttachDoc={onAttachDoc}
              onContextDelete={onContextDelete}
              onDragStartItem={onDragStartItem}
              onDragEndItem={onDragEndItem}
              onDropTargetChange={onDropTargetChange}
              onDropOnFolder={onDropOnFolder}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function NoWorldSelected({ onPick }: { onPick: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-[12px] text-[var(--color-text-muted)]">Select a world to begin.</p>
      <button
        type="button"
        onClick={onPick}
        className="text-[12px] text-[var(--color-accent)] hover:underline"
      >
        Open World Picker
      </button>
    </div>
  );
}

function NoItems({ hasFilter }: { hasFilter: boolean }) {
  if (hasFilter) {
    return (
      <p className="px-4 py-6 text-center text-[12px] text-[var(--color-text-muted)]">
        No items match the filter.
      </p>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-[12px] text-[var(--color-text-muted)]">
      <p className="text-[13px] text-[var(--color-text-secondary)]">Nothing here yet.</p>
      <p>Create a story to start writing.</p>
    </div>
  );
}

interface TrashViewProps {
  items: VaultItemMeta[];
  onRestore: (id: string) => void;
  onPermanentDelete: (item: VaultItemMeta) => void;
}

function TrashView({ items, onRestore, onPermanentDelete }: TrashViewProps) {
  if (items.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-[12px] text-[var(--color-text-muted)]">
        Trash is empty.
      </p>
    );
  }
  return (
    <ul role="list" className="py-1">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex h-7 items-center justify-between gap-2 px-3 text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
        >
          <span className="truncate">{item.name}</span>
          <span className="flex shrink-0 items-center gap-2 text-[11px]">
            <button
              type="button"
              onClick={() => onRestore(item.id)}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
            >
              Restore
            </button>
            <button
              type="button"
              onClick={() => onPermanentDelete(item)}
              className="text-[var(--color-text-muted)] hover:text-red-400"
            >
              Delete
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
