import {
  BookOpen,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  MoreVertical,
  Paperclip,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { renameItem } from '@/lib/tauriApi/vault';
import { useVaultStore } from '@/stores/vaultStore';

import type { VaultItemMeta } from '@/lib/types';

interface VaultTreeRowProps {
  item: VaultItemMeta;
  depth: number;
  expanded: boolean;
  selected: boolean;
  isFolder: boolean;
  dropTarget: boolean;
  onToggleExpanded: () => void;
  onSelect: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  /** Called on double-click for SourceDocument / Image rows (Doc 18 §When
   *  the editor opens). Folder / Story rows fall back to inline rename. */
  onOpenDoc?: () => void;
  /** True iff this row's item is currently attached to the active story
   *  (Doc 18 §Attach via paperclip). Drives the filled-vs-outline paperclip. */
  attached?: boolean;
  /** True iff a story is currently active. When false, the paperclip is
   *  hidden because there's no target to attach to. */
  canAttach?: boolean;
  /** Click handler for the paperclip. No-op when the row is already
   *  attached (the icon is purely indicator in that state). */
  onAttachToggle?: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}

/** Icon for a vault row by item type. Image is reserved for Phase 10. */
function rowIcon(type: string, isOpen: boolean) {
  switch (type) {
    case 'Story':
      return <BookOpen size={14} aria-hidden />;
    case 'Folder':
      return isOpen ? <FolderOpen size={14} aria-hidden /> : <Folder size={14} aria-hidden />;
    case 'SourceDocument':
      return <FileText size={14} aria-hidden />;
    default:
      return <FileText size={14} aria-hidden />;
  }
}

/** A single row in the vault tree (Doc 14 §Tree row anatomy). */
export function VaultTreeRow({
  item,
  depth,
  expanded,
  selected,
  isFolder,
  dropTarget,
  onToggleExpanded,
  onSelect,
  onContextMenu,
  onOpenDoc,
  attached = false,
  canAttach = false,
  onAttachToggle,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: VaultTreeRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.name);

  // Doc 11 §Context Menus — the menu's "Rename" action signals through the
  // store; the matching row enters inline-rename and clears the request.
  const pendingRenameId = useVaultStore((s) => s.pendingRenameId);
  const clearRenameRequest = useVaultStore((s) => s.clearRenameRequest);
  useEffect(() => {
    if (pendingRenameId !== item.id) return;
    setDraft(item.name);
    setEditing(true);
    clearRenameRequest();
  }, [pendingRenameId, item.id, item.name, clearRenameRequest]);

  function startRename() {
    setDraft(item.name);
    setEditing(true);
  }

  async function commitRename() {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === item.name) {
      setDraft(item.name);
      return;
    }
    try {
      await renameItem(item.id, next);
      // vault_updated event will reload — no need to mutate local state
    } catch {
      setDraft(item.name);
    }
  }

  return (
    <li
      role="treeitem"
      aria-expanded={isFolder ? expanded : undefined}
      aria-selected={selected}
      draggable={!editing}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onSelect}
      onDoubleClick={(e) => {
        e.stopPropagation();
        // Doc 18: double-click on SourceDocument / Image opens the editor.
        // Folder / Story rows still get inline rename — rename for docs is
        // reached via the context menu (Phase 12 polish).
        if (
          onOpenDoc !== undefined &&
          (item.item_type === 'SourceDocument' || item.item_type === 'Image')
        ) {
          onOpenDoc();
          return;
        }
        startRename();
      }}
      onContextMenu={onContextMenu}
      className={`group flex h-7 cursor-pointer items-center gap-1 px-2 text-[13px] ${
        dropTarget
          ? 'bg-[var(--color-accent-subtle)] outline outline-1 outline-[var(--color-accent)]'
          : selected
            ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]'
            : 'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]'
      }`}
      style={{ paddingLeft: 8 + depth * 12 }}
    >
      {isFolder ? (
        <button
          type="button"
          aria-label={expanded ? 'Collapse folder' : 'Expand folder'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpanded();
          }}
          className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--color-text-muted)]"
        >
          <ChevronRight
            size={12}
            aria-hidden
            className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        </button>
      ) : (
        <span aria-hidden className="h-4 w-4 shrink-0" />
      )}
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--color-text-muted)]">
        {rowIcon(item.item_type, expanded)}
      </span>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={() => void commitRename()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commitRename();
            else if (e.key === 'Escape') {
              setDraft(item.name);
              setEditing(false);
            }
          }}
          className="flex-1 bg-transparent outline-none ring-1 ring-[var(--color-accent)] rounded-sm px-1"
        />
      ) : (
        <span className="flex-1 truncate">{item.name}</span>
      )}
      {canAttach && (item.item_type === 'SourceDocument' || item.item_type === 'Image') && (
        <button
          type="button"
          aria-label={attached ? `${item.name} attached to story` : `Attach ${item.name} to story`}
          title={attached ? 'Attached to story' : 'Attach to story'}
          onClick={(e) => {
            e.stopPropagation();
            if (!attached) onAttachToggle?.();
          }}
          className={`flex h-4 w-4 shrink-0 items-center justify-center ${
            attached
              ? 'text-[var(--color-accent)]'
              : 'invisible text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] group-hover:visible'
          }`}
        >
          <Paperclip size={12} aria-hidden />
        </button>
      )}
      <button
        type="button"
        aria-label="Item actions"
        onClick={(e) => {
          e.stopPropagation();
          onContextMenu(e);
        }}
        className="invisible flex h-4 w-4 shrink-0 items-center justify-center text-[var(--color-text-muted)] group-hover:visible"
      >
        <MoreVertical size={14} aria-hidden />
      </button>
    </li>
  );
}
