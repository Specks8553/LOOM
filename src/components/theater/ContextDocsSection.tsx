import { FileText, ImageIcon, X } from 'lucide-react';
import { toast } from 'sonner';

import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { VaultItemMeta } from '@/lib/types';

/**
 * Doc 18 §Frontend State + Doc 27 §Right Pane.
 *
 * Right-pane section that lists the active story's context documents in
 * insertion order. Each row has a `×` icon that detaches the doc (user-
 * initiated; the backend writes `attachment_history.event='detach',
 * reason=NULL`). Empty state when no docs are attached.
 *
 * Subscribes to `attachedDocs` (resolved by `loadAttachedDocs`) rather than
 * `contextDocIds` so the rows can render the item name without a per-row
 * lookup. The cascade detach on soft-delete updates `attachedDocs` via the
 * `vault_updated` listener in `useWorkspaceEvents`.
 */
export function ContextDocsSection() {
  const activeStoryId = useWorkspaceStore((s) => s.activeStoryId);
  const attachedDocs = useWorkspaceStore((s) => s.attachedDocs);
  const detachDoc = useWorkspaceStore((s) => s.detachDoc);

  if (activeStoryId === null) {
    // Nothing to attach to — section is collapsed to nothing rather than
    // showing an empty-state row, since "no story open" is the surrounding
    // shell's empty state.
    return null;
  }

  async function handleDetach(docId: string) {
    try {
      await detachDoc(docId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not detach document');
    }
  }

  return (
    <section
      aria-label="Context documents"
      className="flex shrink-0 flex-col border-t border-[var(--color-border)] px-3 py-2"
    >
      <h3 className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
        Context documents
      </h3>
      {attachedDocs.length === 0 ? (
        <p className="text-[12px] text-[var(--color-text-muted)]">No context documents.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {attachedDocs.map((doc) => (
            <ContextDocRow key={doc.id} doc={doc} onDetach={() => void handleDetach(doc.id)} />
          ))}
        </ul>
      )}
    </section>
  );
}

interface ContextDocRowProps {
  doc: VaultItemMeta;
  onDetach: () => void;
}

function ContextDocRow({ doc, onDetach }: ContextDocRowProps) {
  const Icon = doc.item_type === 'Image' ? ImageIcon : FileText;
  return (
    <li className="group flex h-6 items-center gap-1.5 rounded-sm px-1 text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]">
      <Icon size={12} aria-hidden className="shrink-0 text-[var(--color-text-muted)]" />
      <span className="flex-1 truncate">{doc.name}</span>
      <button
        type="button"
        onClick={onDetach}
        aria-label={`Detach ${doc.name}`}
        title="Detach from story"
        className="invisible flex h-4 w-4 shrink-0 items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] group-hover:visible"
      >
        <X size={12} aria-hidden />
      </button>
    </li>
  );
}
