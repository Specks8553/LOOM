import {
  BookOpen,
  FilePlus,
  FileText,
  FolderPlus,
  Paperclip,
  Pencil,
  RotateCcw,
  Trash2,
  Unlink,
} from 'lucide-react';

import type { MenuItem } from '@/components/shared/ContextMenu';
import type { VaultItemMeta, VaultItemType } from '@/lib/types';

/**
 * Doc 11 §Menu contents by target — the Navigator vault-tree resolver.
 *
 * A pure function: it inspects the right-clicked target and the current state
 * and returns the applicable `MenuItem[]`. No menu logic lives in the row
 * components. An empty result suppresses the menu (see `ContextMenuProvider`).
 */

export interface NavigatorMenuActions {
  /** Create a new item of `type` under `parentId` (null = vault root). */
  createItem: (parentId: string | null, type: VaultItemType) => void;
  /** Put the row with this id into inline-rename (via `vaultStore`). */
  rename: (id: string) => void;
  /** Open a Story in the Theater, or a SourceDocument/Image in the editor. */
  open: (item: VaultItemMeta) => void;
  /** Attach (`attached=true`) or detach a set of docs from the active story. */
  setAttached: (items: VaultItemMeta[], attached: boolean) => void;
  /** Soft-delete (move to Trash). */
  softDelete: (items: VaultItemMeta[]) => void;
  /** Restore a single soft-deleted item. */
  restore: (item: VaultItemMeta) => void;
  /** Permanently delete (from Trash). */
  permanentDelete: (items: VaultItemMeta[]) => void;
}

export interface NavigatorMenuArgs {
  /** The right-clicked row, or `null` for an empty-tree-area click. */
  target: VaultItemMeta | null;
  /** Items the menu acts on — the multi-selection, or just `[target]`. */
  selection: VaultItemMeta[];
  isTrashView: boolean;
  activeStoryId: string | null;
  /** Ids of docs currently attached to the active story. */
  attachedDocIds: Set<string>;
  /** Count of (non-deleted) children of a folder — the empty-folder gate. */
  childCount: (folderId: string) => number;
  actions: NavigatorMenuActions;
}

const sep: MenuItem = { label: '', separator: true, onClick: () => {} };

function isAttachable(item: VaultItemMeta): boolean {
  return item.item_type === 'SourceDocument' || item.item_type === 'Image';
}

export function buildNavigatorMenu(args: NavigatorMenuArgs): MenuItem[] {
  const { target, selection, isTrashView, activeStoryId, attachedDocIds, childCount, actions } =
    args;

  // --- Empty tree area: create at the vault root (non-trash only). ---------
  if (target === null) {
    if (isTrashView) return [];
    return [
      { label: 'New story', icon: BookOpen, onClick: () => actions.createItem(null, 'Story') },
      { label: 'New folder', icon: FolderPlus, onClick: () => actions.createItem(null, 'Folder') },
      {
        label: 'New source document',
        icon: FilePlus,
        onClick: () => actions.createItem(null, 'SourceDocument'),
      },
    ];
  }

  // --- Trash row: restore / permanent delete. ------------------------------
  if (isTrashView) {
    return [
      { label: 'Restore', icon: RotateCcw, onClick: () => actions.restore(target) },
      sep,
      {
        label: 'Delete permanently',
        icon: Trash2,
        destructive: true,
        onClick: () => actions.permanentDelete([target]),
      },
    ];
  }

  // --- Multi-select: intersection of actions valid for every item. ---------
  const inSelection = selection.some((i) => i.id === target.id);
  if (inSelection && selection.length > 1) {
    const items: MenuItem[] = [];
    const allAttachable = selection.every(isAttachable);
    if (allAttachable && activeStoryId !== null) {
      items.push({
        label: `Attach ${selection.length} documents to story`,
        icon: Paperclip,
        onClick: () => actions.setAttached(selection, true),
      });
      items.push(sep);
    }
    const hasNonEmptyFolder = selection.some(
      (i) => i.item_type === 'Folder' && childCount(i.id) > 0,
    );
    items.push({
      label: `Delete ${selection.length} items to Trash`,
      icon: Trash2,
      disabled: hasNonEmptyFolder,
      onClick: () => actions.softDelete(selection),
    });
    return items;
  }

  // --- Single row. ---------------------------------------------------------
  const deleteItem: MenuItem = {
    label: 'Delete to Trash',
    icon: Trash2,
    onClick: () => actions.softDelete([target]),
  };

  if (target.item_type === 'Folder') {
    deleteItem.disabled = childCount(target.id) > 0;
    return [
      { label: 'New story', icon: BookOpen, onClick: () => actions.createItem(target.id, 'Story') },
      {
        label: 'New folder',
        icon: FolderPlus,
        onClick: () => actions.createItem(target.id, 'Folder'),
      },
      {
        label: 'New source document',
        icon: FilePlus,
        onClick: () => actions.createItem(target.id, 'SourceDocument'),
      },
      sep,
      { label: 'Rename', icon: Pencil, onClick: () => actions.rename(target.id) },
      sep,
      deleteItem,
    ];
  }

  if (target.item_type === 'Story') {
    const items: MenuItem[] = [];
    if (target.id !== activeStoryId) {
      items.push({ label: 'Open', icon: BookOpen, onClick: () => actions.open(target) });
    }
    items.push({ label: 'Rename', icon: Pencil, onClick: () => actions.rename(target.id) });
    items.push(sep, deleteItem);
    return items;
  }

  // SourceDocument / Image.
  const items: MenuItem[] = [
    { label: 'Open', icon: FileText, onClick: () => actions.open(target) },
    { label: 'Rename', icon: Pencil, onClick: () => actions.rename(target.id) },
  ];
  if (activeStoryId !== null) {
    items.push(
      attachedDocIds.has(target.id)
        ? {
            label: 'Detach from story',
            icon: Unlink,
            onClick: () => actions.setAttached([target], false),
          }
        : {
            label: 'Attach to story',
            icon: Paperclip,
            onClick: () => actions.setAttached([target], true),
          },
    );
  }
  items.push(sep, deleteItem);
  return items;
}
