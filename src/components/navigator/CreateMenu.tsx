import { type ReactElement, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { createItem } from '@/lib/tauriApi/vault';
import { useVaultStore } from '@/stores/vaultStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { VaultItemType } from '@/lib/types';

interface CreateMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentId: string | null;
  trigger: ReactElement;
}

/**
 * Doc 14 §"+" button. Popover offering "New Story" / "New Folder" / "New
 * Source Document". Each option creates the item with a default name and
 * places it under `parentId` (or root when null).
 *
 * Phase 2C uses default names directly; rename happens via double-click on
 * the new row. Inline-name-input on creation is Phase 12 polish.
 */
export function CreateMenu({ open, onOpenChange, parentId, trigger }: CreateMenuProps) {
  const expandFolder = useVaultStore((s) => s.expandFolder);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onOpenChange(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  async function create(itemType: VaultItemType, defaultName: string) {
    if (busy) return;
    setBusy(true);
    onOpenChange(false);
    try {
      const created = await createItem(parentId, itemType, defaultName);
      // If we created inside a folder, ensure it's expanded so the new row
      // is visible after the vault reloads.
      if (parentId !== null) {
        expandFolder(parentId);
      }
      // Doc 18 §When the editor opens — auto-open DocEditor on new
      // SourceDocument creation.
      if (created.item_type === 'SourceDocument') {
        useWorkspaceStore.getState().openDoc(created.id);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create item');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <span onClick={() => onOpenChange(!open)} role="button" tabIndex={-1} className="contents">
        {trigger}
      </span>
      {open && (
        <div
          ref={popoverRef}
          role="menu"
          className="absolute right-0 top-full z-10 mt-1 w-44 overflow-hidden rounded-sm border border-[--color-border] bg-[--color-bg-pane] py-1 text-[13px] shadow-lg"
        >
          <CreateMenuItem
            label="New story"
            onSelect={() => void create('Story', 'Untitled Story')}
          />
          <CreateMenuItem label="New folder" onSelect={() => void create('Folder', 'New Folder')} />
          <CreateMenuItem
            label="New source document"
            onSelect={() => void create('SourceDocument', 'Untitled Document')}
          />
        </div>
      )}
    </div>
  );
}

function CreateMenuItem({ label, onSelect }: { label: string; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className="block w-full px-3 py-1.5 text-left text-[--color-text-primary] hover:bg-[--color-bg-hover]"
    >
      {label}
    </button>
  );
}
