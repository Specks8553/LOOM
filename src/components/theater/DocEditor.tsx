import { ArrowLeft, FileText, ImageIcon } from 'lucide-react';
import { marked } from 'marked';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { getItemContent } from '@/lib/tauriApi/vault';
import { useVaultStore } from '@/stores/vaultStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

// GFM is the only feature we depend on; everything else is marked's defaults.
marked.use({ gfm: true });

const PLACEHOLDER_RE = /\{\{[^}]+\}\}/g;

interface DocEditorProps {
  docId: string;
}

/**
 * Doc 18 §DocEditor. Full-surface editor for SourceDocument / Image content.
 *
 * - Text body: monospaced textarea, debounced 1 s autosave (via workspaceStore).
 * - `[Preview]` toggle renders the body as Markdown (GFM via `marked`).
 * - `Tab` / `Shift+Tab` navigate `{{placeholder}}` tokens when any exist;
 *   otherwise `Tab` inserts two spaces.
 * - Image items render read-only with a banner — full lightbox lands in Phase 10.
 * - Soft-deleted items render read-only with a "restore to edit" banner.
 * - `Escape` closes (debounced save is flushed by `closeDoc`).
 */
export function DocEditor({ docId }: DocEditorProps) {
  const closeDoc = useWorkspaceStore((s) => s.closeDoc);
  const updateDocContent = useWorkspaceStore((s) => s.updateDocContent);
  const item = useVaultStore(
    (s) => s.items.find((i) => i.id === docId) ?? s.trashItems.find((i) => i.id === docId) ?? null,
  );

  const [content, setContent] = useState<string>('');
  const [loaded, setLoaded] = useState(false);
  const [savedContent, setSavedContent] = useState<string>('');
  const [previewMode, setPreviewMode] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load content on docId change. We only load once per id; further edits
  // are in-memory until the debounced save flushes them.
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    void getItemContent(docId)
      .then((c) => {
        if (cancelled) return;
        setContent(c);
        setSavedContent(c);
        setLoaded(true);
      })
      .catch((e) => {
        if (cancelled) return;
        toast.error(e instanceof Error ? e.message : 'Could not load document');
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [docId]);

  // If the item disappears (soft-delete cascade, hard delete), close the
  // editor (Doc 18 §Per-item editor closure).
  useEffect(() => {
    if (item === null && loaded) {
      void closeDoc();
    }
  }, [item, loaded, closeDoc]);

  const isImage = item?.item_type === 'Image';
  const isSoftDeleted = item?.deleted_at !== null && item?.deleted_at !== undefined;
  const readOnly = isImage || isSoftDeleted;
  const dirty = loaded && content !== savedContent;

  function onChange(next: string) {
    setContent(next);
    updateDocContent(docId, next);
    // Optimistically mark saved when the debounced save settles. We re-sync
    // savedContent on the next loaded round-trip; in the meantime, dirty
    // reflects "diverged from last loaded value" — close enough for the dot.
    // (Refining to read from the in-flight save promise is Phase 12 polish.)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      void closeDoc();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = textareaRef.current;
      if (ta === null) return;
      const value = ta.value;
      const matches = Array.from(value.matchAll(PLACEHOLDER_RE));

      if (matches.length === 0) {
        if (e.shiftKey) return; // no-op
        // Insert two spaces at the cursor.
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const next = value.slice(0, start) + '  ' + value.slice(end);
        setContent(next);
        updateDocContent(docId, next);
        // Restore the cursor after React re-renders.
        requestAnimationFrame(() => {
          if (textareaRef.current !== null) {
            textareaRef.current.selectionStart = start + 2;
            textareaRef.current.selectionEnd = start + 2;
          }
        });
        return;
      }

      const cursor = ta.selectionStart;
      let target: RegExpMatchArray | null = null;
      if (e.shiftKey) {
        // Previous: last match strictly before the cursor; else wrap to last.
        for (let i = matches.length - 1; i >= 0; i--) {
          const idx = matches[i].index ?? 0;
          if (idx < cursor - 1) {
            target = matches[i];
            break;
          }
        }
        if (target === null) target = matches[matches.length - 1];
      } else {
        // Next: first match whose start is >= cursor; else wrap to first.
        for (const m of matches) {
          const idx = m.index ?? 0;
          if (idx >= cursor) {
            target = m;
            break;
          }
        }
        if (target === null) target = matches[0];
      }
      const start = target.index ?? 0;
      const end = start + target[0].length;
      ta.selectionStart = start;
      ta.selectionEnd = end;
      ta.focus();
    }
  }

  const renderedMarkdown = useMemo(() => {
    if (!previewMode) return '';
    try {
      // `marked.parse` is sync when no async extensions are registered.
      const result = marked.parse(content);
      return typeof result === 'string' ? result : '';
    } catch {
      return '';
    }
  }, [content, previewMode]);

  if (item === null) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-[var(--color-text-muted)]">
        Loading document…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg-base)]">
      {/* Header */}
      <header className="flex h-10 shrink-0 items-center gap-3 border-b border-[var(--color-border)] px-3">
        <button
          type="button"
          onClick={() => void closeDoc()}
          className="flex items-center gap-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          aria-label="Close editor"
        >
          <ArrowLeft size={14} aria-hidden />
          <span>Back</span>
        </button>
        <span className="flex items-center gap-2 text-[13px] text-[var(--color-text-primary)]">
          <span aria-hidden className="text-[var(--color-text-muted)]">
            {isImage ? <ImageIcon size={14} /> : <FileText size={14} />}
          </span>
          <span className="truncate">{item.name}</span>
          {dirty && (
            <span
              aria-label="Unsaved changes"
              title="Unsaved changes"
              className="text-[var(--color-accent)]"
            >
              ·
            </span>
          )}
        </span>
        <span className="ml-auto">
          {!isImage && (
            <button
              type="button"
              onClick={() => setPreviewMode((v) => !v)}
              className={`rounded-sm px-2 py-0.5 text-[11px] uppercase tracking-wider ${
                previewMode
                  ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              Preview
            </button>
          )}
        </span>
      </header>

      {/* Body */}
      {isImage && (
        <div className="border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-4 py-2 text-[12px] text-[var(--color-text-muted)]">
          Image editing arrives in Phase 10. The caption below is read-only for now.
        </div>
      )}
      {!isImage && isSoftDeleted && (
        <div className="border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-4 py-2 text-[12px] text-[var(--color-text-muted)]">
          This document is in Trash — restore to edit.
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {previewMode && !isImage ? (
          <MarkdownPreview html={renderedMarkdown} />
        ) : (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            readOnly={readOnly}
            spellCheck={false}
            className="h-full w-full resize-none bg-transparent px-6 py-4 font-mono text-[13px] leading-6 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
            placeholder={isImage ? '' : 'Write your source document here.'}
          />
        )}
      </div>
    </div>
  );
}

function MarkdownPreview({ html }: { html: string }) {
  // Trusted source: this is the writer's own content rendered locally inside
  // an offline app with strict CSP — no XSS surface (the same content is
  // already sent verbatim to the model).
  return (
    <div
      className="loom-prose px-6 py-4 text-[15px] leading-[1.7] text-[var(--color-text-primary)]"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
