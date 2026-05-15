import { useEffect, useRef, useState } from 'react';

import { createStoryCache } from '@/lib/tauriApi/cache';
import { useCacheStore } from '@/stores/cacheStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { InputDraft, UserContent } from '@/lib/types';

interface InputAreaProps {
  /** When provided, the input acts as an in-place editor: it controls its
   *  own local state seeded from `initial`, ignores the workspace draft, and
   *  uses `onCommit` instead of `send()`. */
  initial?: UserContent;
  onCommit?: (content: UserContent) => void;
  onCancel?: () => void;
  submitLabel?: string;
}

/**
 * Doc 15 §User Input Fields + Doc 27 §Input area.
 *
 * Four fields: Plot Direction (required), Background Information,
 * Modificators (chip row with comma-as-delimiter), Constraints.
 *
 * Default mode (no `initial`): bound to `workspaceStore.draft`; Send fires
 * `send()`. Edit mode (with `initial`): local state, commits via `onCommit`.
 */
export function InputArea({ initial, onCommit, onCancel, submitLabel }: InputAreaProps) {
  const editMode = initial !== undefined;
  const storeDraft = useWorkspaceStore((s) => s.draft);
  const setDraftField = useWorkspaceStore((s) => s.setDraftField);
  const isGenerating = useWorkspaceStore((s) => s.isGenerating);
  const send = useWorkspaceStore((s) => s.send);
  const cancel = useWorkspaceStore((s) => s.cancel);
  const activeStoryId = useWorkspaceStore((s) => s.activeStoryId);

  const [localDraft, setLocalDraft] = useState<InputDraft>(initial ?? storeDraft);

  // In default mode, mirror the store draft (story switch / draft load).
  useEffect(() => {
    if (!editMode) setLocalDraft(storeDraft);
  }, [editMode, storeDraft]);

  function update<K extends keyof InputDraft>(field: K, value: InputDraft[K]): void {
    if (editMode) {
      setLocalDraft((d) => ({ ...d, [field]: value }));
    } else {
      setDraftField(field, value);
      setLocalDraft((d) => ({ ...d, [field]: value }));
    }
  }

  const canSubmit = localDraft.plot_direction.trim().length > 0;

  // Doc 22 §Stale Indicator. Amber dot on Send when the active story cache
  // is stale. No effect on Send behavior — the next send rebuilds.
  const cacheStale = useCacheStore((s) =>
    !editMode && activeStoryId !== null ? (s.byStory[activeStoryId]?.is_stale ?? false) : false,
  );
  const cacheActive = useCacheStore((s) =>
    !editMode && activeStoryId !== null
      ? (s.byStory[activeStoryId]?.cache_name ?? null) !== null
      : false,
  );

  async function handleUpdateCache() {
    if (activeStoryId === null) return;
    try {
      await createStoryCache(activeStoryId);
    } catch (e) {
      console.error('createStoryCache', e);
    }
  }

  function handleSubmit() {
    if (!canSubmit) return;
    if (editMode) {
      onCommit?.(localDraft);
    } else {
      if (isGenerating) return;
      if (activeStoryId === null) return;
      void send();
    }
  }

  function handleCancel() {
    if (editMode) {
      onCancel?.();
    } else if (isGenerating) {
      void cancel();
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-[--color-border] bg-[--color-bg-soft] p-3">
      <Field label="Plot direction" required>
        <textarea
          value={localDraft.plot_direction}
          onChange={(e) => update('plot_direction', e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="What should happen next?"
          rows={3}
          className="w-full resize-y rounded-sm border border-[--color-border] bg-[--color-bg] p-2 text-[14px] text-[--color-text-primary] outline-none focus:border-[--color-accent]"
        />
      </Field>
      <Field label="Background information">
        <textarea
          value={localDraft.background_information}
          onChange={(e) => update('background_information', e.target.value)}
          rows={2}
          placeholder="Context the model should know but not write directly"
          className="w-full resize-y rounded-sm border border-[--color-border] bg-[--color-bg] p-2 text-[13px] text-[--color-text-primary] outline-none focus:border-[--color-accent]"
        />
      </Field>
      <Field label="Modificators">
        <ChipInput
          chips={localDraft.modificators}
          onChange={(chips) => update('modificators', chips)}
          placeholder="noir, tight pacing, present tense"
        />
      </Field>
      <Field label="Constraints">
        <textarea
          value={localDraft.constraints}
          onChange={(e) => update('constraints', e.target.value)}
          rows={2}
          placeholder="What the model must obey but never include in the prose"
          className="w-full resize-y rounded-sm border border-[--color-border] bg-[--color-bg] p-2 text-[13px] text-[--color-text-primary] outline-none focus:border-[--color-accent]"
        />
      </Field>

      <div className="flex items-center justify-end gap-2">
        {editMode && (
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-sm border border-[--color-border] px-3 py-1 text-[12px] text-[--color-text-muted] hover:text-[--color-text-primary]"
          >
            Cancel
          </button>
        )}
        {!editMode && isGenerating ? (
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-sm border border-[--color-border] bg-[--color-bg] px-3 py-1 text-[12px] text-[--color-text-primary] hover:border-[--color-accent]"
          >
            Cancel
          </button>
        ) : (
          <>
            {cacheActive && cacheStale && (
              <button
                type="button"
                onClick={() => void handleUpdateCache()}
                title="Cache is outdated. Update it before sending for cost savings, or send anyway."
                className="text-[11px] text-[--color-text-muted] underline-offset-2 hover:text-[--color-text-primary] hover:underline"
              >
                Update cache
              </button>
            )}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={
                !canSubmit || (!editMode && isGenerating) || (!editMode && activeStoryId === null)
              }
              title={
                cacheStale
                  ? 'Cache is outdated. Update it before sending for cost savings, or send anyway.'
                  : undefined
              }
              className="relative rounded-sm bg-[--color-accent] px-3 py-1 text-[12px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitLabel ?? 'Send'}
              {cacheStale && (
                <span
                  aria-label="Cache is stale"
                  className="absolute -right-1 -top-1 h-2 w-2 rounded-full"
                  style={{ background: 'var(--color-warning, #f59e0b)' }}
                />
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wider text-[--color-text-muted]">
        {label}
        {required && <span className="ml-1 text-[--color-accent]">*</span>}
      </span>
      {children}
    </label>
  );
}

interface ChipInputProps {
  chips: string[];
  onChange: (chips: string[]) => void;
  placeholder?: string;
}

function ChipInput({ chips, onChange, placeholder }: ChipInputProps) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function commitDraft(rest: string): void {
    const trimmed = rest.trim();
    if (trimmed.length === 0) return;
    onChange([...chips, trimmed]);
    setDraft('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === ',' || e.key === 'Enter') {
      e.preventDefault();
      commitDraft(draft);
      return;
    }
    if (e.key === 'Backspace' && draft.length === 0 && chips.length > 0) {
      e.preventDefault();
      onChange(chips.slice(0, -1));
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    if (value.includes(',')) {
      const parts = value.split(',');
      const newChips = [...chips];
      for (let i = 0; i < parts.length - 1; i += 1) {
        const t = parts[i].trim();
        if (t.length > 0) newChips.push(t);
      }
      onChange(newChips);
      setDraft(parts[parts.length - 1]);
    } else {
      setDraft(value);
    }
  }

  function removeChip(index: number) {
    onChange(chips.filter((_, i) => i !== index));
    inputRef.current?.focus();
  }

  return (
    <div className="flex min-h-[34px] flex-wrap items-center gap-1 rounded-sm border border-[--color-border] bg-[--color-bg] p-1.5">
      {chips.map((chip, i) => (
        <span
          key={`${chip}-${i}`}
          className="flex items-center gap-1 rounded-sm border border-[--color-border] bg-[--color-bg-soft] px-1.5 py-0.5 text-[12px] text-[--color-text-secondary]"
        >
          {chip}
          <button
            type="button"
            onClick={() => removeChip(i)}
            aria-label={`Remove ${chip}`}
            className="text-[--color-text-muted] hover:text-[--color-text-primary]"
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => commitDraft(draft)}
        placeholder={chips.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[120px] bg-transparent text-[13px] text-[--color-text-primary] outline-none placeholder:text-[--color-text-muted]"
      />
    </div>
  );
}
