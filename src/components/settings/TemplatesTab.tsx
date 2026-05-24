import { FileText, Plus, Trash2 } from 'lucide-react';
import { marked } from 'marked';
import { useEffect, useMemo, useRef, useState } from 'react';

import { surfaceError } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settingsStore';

import type { Template } from '@/lib/types';

marked.use({ gfm: true });

const SAVE_DEBOUNCE_MS = 800;

/**
 * Doc 20 §Templates. Inline list + editor. Built-ins sort first and cannot be
 * deleted (only renamed / content-edited / restored); user templates have full
 * CRUD. Templates live in the active world's DB — no world, no templates.
 */
export function TemplatesTab() {
  const templates = useSettingsStore((s) => s.templates);
  const upsertTemplate = useSettingsStore((s) => s.upsertTemplate);
  const removeTemplate = useSettingsStore((s) => s.removeTemplate);
  const restoreTemplate = useSettingsStore((s) => s.restoreTemplate);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = templates.find((t) => t.id === selectedId) ?? null;

  // Keep a selection valid as the list changes.
  useEffect(() => {
    if (templates.length === 0) {
      setSelectedId(null);
    } else if (selectedId === null || !templates.some((t) => t.id === selectedId)) {
      setSelectedId(templates[0].id);
    }
  }, [templates, selectedId]);

  async function handleNew() {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const draft: Template = {
      id,
      slug: id,
      name: 'New template',
      icon: 'FileText',
      default_content: '',
      creator_instructions: '',
      is_builtin: false,
      sort_order: templates.length,
      created_at: now,
      modified_at: now,
    };
    try {
      await upsertTemplate(draft);
      setSelectedId(id);
    } catch (e) {
      surfaceError(e, 'Could not create template');
    }
  }

  if (templates.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-[var(--color-text-muted)]">
        Open a world to manage its templates.
      </div>
    );
  }

  return (
    <div className="flex h-full gap-4">
      {/* List */}
      <div className="flex w-56 shrink-0 flex-col gap-1 border-r border-[var(--color-border)] pr-3">
        <button
          type="button"
          onClick={() => void handleNew()}
          className="mb-1 flex items-center gap-1.5 rounded-sm border border-[var(--color-border)] px-2 py-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
        >
          <Plus size={13} aria-hidden />
          New template
        </button>
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSelectedId(t.id)}
            className={cn(
              'flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px]',
              t.id === selectedId
                ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]'
                : 'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)]',
            )}
          >
            <FileText size={13} aria-hidden className="shrink-0 text-[var(--color-text-muted)]" />
            <span className="truncate">{t.name}</span>
            {t.is_builtin && (
              <span className="ml-auto text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                Built-in
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Editor */}
      <div className="min-w-0 flex-1">
        {selected !== null && (
          <TemplateEditor
            key={selected.id}
            template={selected}
            onSave={(t) => upsertTemplate(t)}
            onDelete={() => removeTemplate(selected.id)}
            onRestore={() => restoreTemplate(selected.id)}
          />
        )}
      </div>
    </div>
  );
}

interface TemplateEditorProps {
  template: Template;
  onSave: (t: Template) => Promise<void>;
  onDelete: () => Promise<void>;
  onRestore: () => Promise<void>;
}

function TemplateEditor({ template, onSave, onDelete, onRestore }: TemplateEditorProps) {
  const [name, setName] = useState(template.name);
  const [content, setContent] = useState(template.default_content);
  const [preview, setPreview] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  function scheduleSave(nextName: string, nextContent: string) {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void onSave({ ...template, name: nextName, default_content: nextContent }).catch((e) => {
        surfaceError(e, 'Could not save template');
      });
    }, SAVE_DEBOUNCE_MS);
  }

  const renderedHtml = useMemo(() => {
    if (!preview) return '';
    try {
      const out = marked.parse(content);
      return typeof out === 'string' ? out : '';
    } catch {
      return '';
    }
  }, [preview, content]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            scheduleSave(e.target.value, content);
          }}
          className="flex-1 rounded-sm border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1 text-[14px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
        />
        <button
          type="button"
          onClick={() => setPreview((v) => !v)}
          className={cn(
            'rounded-sm px-2 py-0.5 text-[11px] uppercase tracking-wider',
            preview
              ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]',
          )}
        >
          Preview
        </button>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
        <span>
          {template.is_builtin ? 'Built-in template' : 'Template'} · {template.slug}
        </span>
      </div>

      {preview ? (
        <div
          className="loom-prose flex-1 overflow-y-auto rounded-sm border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      ) : (
        <textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            scheduleSave(name, e.target.value);
          }}
          spellCheck={false}
          className="flex-1 resize-none rounded-sm border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 font-mono text-[12px] leading-5 text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
          placeholder="Template body — {{placeholders}} are filled when a document is created."
        />
      )}

      <div className="flex items-center gap-2">
        {template.is_builtin ? (
          <button
            type="button"
            onClick={() => void onRestore()}
            className="rounded-sm border border-[var(--color-border)] px-2 py-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          >
            Restore default
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void onDelete()}
            className="flex items-center gap-1.5 rounded-sm border border-[var(--color-border)] px-2 py-1 text-[12px] text-[var(--color-error)] hover:bg-[var(--color-bg-elevated)]"
          >
            <Trash2 size={13} aria-hidden />
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
