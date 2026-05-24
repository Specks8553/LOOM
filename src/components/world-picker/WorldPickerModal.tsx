import { open as openDialog, save } from '@tauri-apps/plugin-dialog';
import { Download, Trash2, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { surfaceError } from '@/lib/errors';
import { cancelGeneration } from '@/lib/tauriApi/conversation';
import {
  createWorld as createWorldApi,
  deleteWorld as deleteWorldApi,
  exportWorld as exportWorldApi,
  importWorld as importWorldApi,
  openWorld as openWorldApi,
} from '@/lib/tauriApi/vault';
import { useVaultStore } from '@/stores/vaultStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { WorldMeta } from '@/lib/types';

interface WorldPickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Doc 14 §World Picker Modal. Cards for each world; left-click opens, icons
 * for settings (Phase 11) and delete (type-to-confirm). A "Create world"
 * inline form sits below the grid.
 *
 * World switching honours `workspaceStore.isGenerating` — confirms before
 * aborting a (mocked) in-flight request and swapping the connection
 * (Architecture Wall #6).
 */
export function WorldPickerModal({ open, onOpenChange }: WorldPickerModalProps) {
  const worlds = useVaultStore((s) => s.worlds);
  const activeWorldId = useVaultStore((s) => s.activeWorldId);
  const refreshWorlds = useVaultStore((s) => s.refreshWorlds);
  const setActiveWorld = useVaultStore((s) => s.setActiveWorld);
  const isGenerating = useWorkspaceStore((s) => s.isGenerating);
  const setIsGenerating = useWorkspaceStore((s) => s.setIsGenerating);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  // Refresh on open so a freshly-created or imported world appears.
  useEffect(() => {
    if (open) {
      void refreshWorlds().catch(console.error);
    }
  }, [open, refreshWorlds]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy && activeWorldId !== null) {
        onOpenChange(false);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, activeWorldId, onOpenChange]);

  if (!open) return null;

  async function handleOpen(world: WorldMeta) {
    if (world.id === activeWorldId) {
      onOpenChange(false);
      return;
    }
    if (isGenerating) {
      const ok = window.confirm(
        'A request is in flight. Switching worlds will cancel it. Continue?',
      );
      if (!ok) return;
      try {
        await cancelGeneration();
      } catch {
        // Best-effort: cancellation token may already be cleared.
      }
      setIsGenerating(false);
    }

    setBusy(true);
    try {
      await openWorldApi(world.id);
      setActiveWorld(world.id, null /* dir is Phase 10 */);
      onOpenChange(false);
    } catch (e) {
      surfaceError(e, 'Could not open world');
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    try {
      const src = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: 'LOOM backup', extensions: ['loom-backup'] }],
      });
      if (!src || typeof src !== 'string') return;
      setBusy(true);
      const meta = await importWorldApi(src);
      await refreshWorlds();
      toast.success(`Imported "${meta.name}"`);
    } catch (e) {
      surfaceError(e, 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const meta = await createWorldApi(name);
      await refreshWorlds();
      setNewName('');
      setCreating(false);
      // Auto-open the new world.
      await handleOpen(meta);
    } catch (e) {
      surfaceError(e, 'Could not create world');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="World Picker"
      className="fixed inset-0 z-50 flex flex-col items-center overflow-y-auto bg-[var(--color-bg-base)]/95 px-6 py-12 backdrop-blur-sm"
    >
      <header className="mb-8 flex w-full max-w-3xl items-center justify-between">
        <h2 className="text-[20px] font-semibold tracking-tight text-[var(--color-text-primary)]">
          Worlds
        </h2>
        {activeWorldId !== null && (
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          >
            Close
          </button>
        )}
      </header>

      {worlds.length === 0 ? (
        <EmptyState onCreate={() => setCreating(true)} />
      ) : (
        <div className="grid w-full max-w-3xl grid-cols-1 gap-3 md:grid-cols-2">
          {worlds.map((w) => (
            <WorldCard
              key={w.id}
              world={w}
              isActive={w.id === activeWorldId}
              onOpen={() => void handleOpen(w)}
              onDeleted={() => void refreshWorlds().catch(console.error)}
            />
          ))}
        </div>
      )}

      <div className="mt-8 w-full max-w-3xl">
        {creating ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              type="text"
              placeholder="World name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate();
                else if (e.key === 'Escape') {
                  setNewName('');
                  setCreating(false);
                }
              }}
              className="flex-1 rounded-sm border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            />
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={busy || !newName.trim()}
              className="rounded-sm bg-[var(--color-accent)] px-4 py-2 text-[13px] font-medium text-white transition-opacity disabled:opacity-40 hover:opacity-90"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => {
                setNewName('');
                setCreating(false);
              }}
              className="text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="text-[13px] text-[var(--color-accent)] hover:underline"
            >
              + Create world
            </button>
            <button
              type="button"
              onClick={() => void handleImport()}
              disabled={busy}
              className="flex items-center gap-1 text-[13px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] disabled:opacity-40"
            >
              <Upload size={12} aria-hidden />
              Import backup
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface WorldCardProps {
  world: WorldMeta;
  isActive: boolean;
  onOpen: () => void;
  onDeleted: () => void;
}

function WorldCard({ world, isActive, onOpen, onDeleted }: WorldCardProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

  async function performExport() {
    try {
      const dest = await save({
        defaultPath: `${world.name}.loom-backup`,
        filters: [{ name: 'LOOM backup', extensions: ['loom-backup'] }],
      });
      if (!dest) return;
      setBusy(true);
      await exportWorldApi(world.id, dest);
      toast.success(`World exported to ${dest}`);
    } catch (e) {
      surfaceError(e, 'Export failed');
    } finally {
      setBusy(false);
    }
  }

  async function performDelete() {
    setBusy(true);
    try {
      await deleteWorldApi(world.id, confirmText);
      onDeleted();
    } catch (e) {
      surfaceError(e, 'Delete failed');
    } finally {
      setBusy(false);
      setConfirmingDelete(false);
      setConfirmText('');
    }
  }

  return (
    <div
      onClick={confirmingDelete ? undefined : onOpen}
      className={`group flex cursor-pointer flex-col gap-2 rounded-sm border bg-[var(--color-bg-elevated)] p-4 transition-colors ${
        isActive
          ? 'border-l-4 border-[var(--color-accent)] pl-3'
          : 'border-[var(--color-border)] hover:bg-[var(--color-bg-hover)]'
      }`}
      role={confirmingDelete ? undefined : 'button'}
      tabIndex={confirmingDelete ? -1 : 0}
      onKeyDown={(e) => {
        if (!confirmingDelete && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="truncate text-[15px] font-medium text-[var(--color-text-primary)]">
          {world.name}
        </h3>
        {!confirmingDelete && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-label="Export world"
              onClick={(e) => {
                e.stopPropagation();
                void performExport();
              }}
              disabled={busy}
              className="invisible text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] group-hover:visible disabled:opacity-40"
            >
              <Download size={14} aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Delete world"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmingDelete(true);
              }}
              className="invisible text-[var(--color-text-muted)] hover:text-red-400 group-hover:visible"
            >
              <Trash2 size={14} aria-hidden />
            </button>
          </div>
        )}
      </div>
      {world.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 text-[11px] text-[var(--color-text-muted)]">
          {world.tags.map((t) => (
            <span key={t} className="rounded-sm border border-[var(--color-border)] px-1.5">
              {t}
            </span>
          ))}
        </div>
      )}
      {confirmingDelete && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="mt-2 flex flex-col gap-2 border-t border-[var(--color-border)] pt-3"
        >
          <p className="text-[12px] text-[var(--color-text-secondary)]">
            Type <span className="font-medium text-[var(--color-text-primary)]">{world.name}</span>{' '}
            to confirm. This cannot be undone.
          </p>
          <input
            autoFocus
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className="rounded-sm border border-[var(--color-border)] bg-[var(--color-bg-base)] px-2 py-1 text-[12px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirmingDelete(false);
                setConfirmText('');
              }}
              className="text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void performDelete()}
              disabled={busy || confirmText !== world.name}
              className="rounded-sm bg-red-500/80 px-3 py-1 text-[12px] font-medium text-white transition-opacity disabled:opacity-40 hover:opacity-90"
            >
              Delete permanently
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="mt-12 flex w-full max-w-md flex-col items-center gap-4 text-center">
      <p className="text-[15px] text-[var(--color-text-primary)]">No worlds yet.</p>
      <p className="text-[13px] text-[var(--color-text-secondary)]">
        A world holds your stories, documents, and settings.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="rounded-sm bg-[var(--color-accent)] px-4 py-2 text-[13px] font-medium text-white hover:opacity-90"
      >
        Create your first world
      </button>
    </div>
  );
}
