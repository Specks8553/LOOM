import { RotateCcw } from 'lucide-react';
import { marked } from 'marked';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settingsStore';

marked.use({ gfm: true });

const SAVE_DEBOUNCE_MS = 800;

interface PromptEditorProps {
  settingKey: string;
  label: string;
  hint?: string;
  chapter: 'app' | 'world';
  /** App chapter: show `[Restore Default]` (writes the hardcoded baseline). */
  restorable?: boolean;
}

/**
 * Multi-line setting editor with a Markdown preview toggle — used for the mode
 * system instructions and the Developer internal prompts (Doc 20 §System
 * Instructions, §Developer). Debounced auto-save, same as `SettingField`.
 */
export function PromptEditor({ settingKey, label, hint, chapter, restorable }: PromptEditorProps) {
  const appValues = useSettingsStore((s) => s.appValues);
  const worldOverrides = useSettingsStore((s) => s.worldOverrides);
  const saveApp = useSettingsStore((s) => s.saveApp);
  const saveWorld = useSettingsStore((s) => s.saveWorld);
  const clearOverride = useSettingsStore((s) => s.clearOverride);
  const restorePrompt = useSettingsStore((s) => s.restorePrompt);

  const isOverridden = chapter === 'world' && settingKey in worldOverrides;
  const externalValue =
    chapter === 'world'
      ? (worldOverrides[settingKey] ?? appValues[settingKey] ?? '')
      : (appValues[settingKey] ?? '');

  const [value, setValue] = useState(externalValue);
  const [preview, setPreview] = useState(false);
  const focusedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!focusedRef.current) setValue(externalValue);
  }, [externalValue]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const onEdit = useCallback(
    (next: string) => {
      setValue(next);
      if (timerRef.current) clearTimeout(timerRef.current);
      const save = chapter === 'world' ? saveWorld : saveApp;
      timerRef.current = setTimeout(() => {
        void save(settingKey, next).catch((e) => {
          toast.error(e instanceof Error ? e.message : 'Could not save');
        });
      }, SAVE_DEBOUNCE_MS);
    },
    [chapter, saveApp, saveWorld, settingKey],
  );

  function handleRevert() {
    if (timerRef.current) clearTimeout(timerRef.current);
    void clearOverride(settingKey).catch((e) => {
      toast.error(e instanceof Error ? e.message : 'Could not revert');
    });
  }

  function handleRestore() {
    if (timerRef.current) clearTimeout(timerRef.current);
    void restorePrompt(settingKey).catch((e) => {
      toast.error(e instanceof Error ? e.message : 'Could not restore default');
    });
  }

  const renderedHtml = useMemo(() => {
    if (!preview) return '';
    try {
      const out = marked.parse(value);
      return typeof out === 'string' ? out : '';
    } catch {
      return '';
    }
  }, [preview, value]);

  return (
    <div className="flex flex-col gap-2 border-b border-[var(--color-border)] py-4">
      <div className="flex items-center gap-2">
        <span className="text-[13px] text-[var(--color-text-primary)]">{label}</span>
        {isOverridden && (
          <span className="rounded-sm bg-[var(--color-accent-subtle)] px-1 text-[10px] uppercase tracking-wider text-[var(--color-accent-text)]">
            Override
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
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
          {chapter === 'world' && (
            <button
              type="button"
              onClick={handleRevert}
              disabled={!isOverridden}
              title="Revert to app default"
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-sm',
                isOverridden
                  ? 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                  : 'cursor-default text-transparent',
              )}
            >
              <RotateCcw size={13} aria-hidden />
            </button>
          )}
          {chapter === 'app' && restorable === true && (
            <button
              type="button"
              onClick={handleRestore}
              className="rounded-sm px-2 py-0.5 text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            >
              Restore Default
            </button>
          )}
        </div>
      </div>
      {hint !== undefined && <p className="text-[11px] text-[var(--color-text-muted)]">{hint}</p>}
      {preview ? (
        <div
          className="loom-prose min-h-24 rounded-sm border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
          // Trusted local content — same as DocEditor's preview.
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      ) : (
        <textarea
          value={value}
          onChange={(e) => onEdit(e.target.value)}
          onFocus={() => {
            focusedRef.current = true;
          }}
          onBlur={() => {
            focusedRef.current = false;
          }}
          spellCheck={false}
          rows={6}
          className="resize-y rounded-sm border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 font-mono text-[12px] leading-5 text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
          placeholder="Empty — the built-in default is used."
        />
      )}
    </div>
  );
}
