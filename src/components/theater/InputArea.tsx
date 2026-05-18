import { useEffect, useRef, useState } from 'react';

import { createStoryCache } from '@/lib/tauriApi/cache';
import { getTokenCount } from '@/lib/tauriApi/conversation';
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

function hasExtraFields(d: UserContent): boolean {
  return (
    d.background_information.trim().length > 0 ||
    d.modificators.length > 0 ||
    d.constraints.trim().length > 0
  );
}

/**
 * Doc 15 §User Input Fields + Doc 27 §Input area + `Designfiles/Phase 2`.
 *
 * A single `--color-bg-pane` card. Plot Direction (required) is always
 * visible; a `+ Fields` toggle reveals Background Information, Modificators
 * (chip row, comma-delimited), and Constraints, each separated by a hairline
 * divider. The bottom bar carries the token meter (left) and Send / Cancel
 * (right).
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
  const tokenEstimate = useWorkspaceStore((s) => s.tokenEstimate);
  const setTokenEstimate = useWorkspaceStore((s) => s.setTokenEstimate);

  const [localDraft, setLocalDraft] = useState<InputDraft>(initial ?? storeDraft);
  const [expanded, setExpanded] = useState(initial !== undefined ? hasExtraFields(initial) : false);

  // In default mode, mirror the store draft (story switch / draft load).
  useEffect(() => {
    if (!editMode) setLocalDraft(storeDraft);
  }, [editMode, storeDraft]);

  // Doc 15 §Token Counting (NB-3) — 500 ms-debounced pre-flight estimate.
  // Default mode only; the meter reads `workspaceStore.tokenEstimate`.
  useEffect(() => {
    if (editMode || activeStoryId === null) return;
    const handle = window.setTimeout(() => {
      getTokenCount(activeStoryId, localDraft)
        .then(setTokenEstimate)
        .catch((e) => {
          console.error('getTokenCount', e);
        });
    }, 500);
    return () => window.clearTimeout(handle);
  }, [editMode, activeStoryId, localDraft, setTokenEstimate]);

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

  const tokenLabel =
    !editMode && tokenEstimate !== null
      ? `~${tokenEstimate.total.toLocaleString('en-US')} tok`
      : '';

  return (
    <div className="bg-[--color-bg-elevated] px-3 pb-3 pt-2">
      <div className="rounded-lg border border-[--color-border-subtle] bg-[--color-bg-pane] px-3.5 py-2.5">
        {/* Plot Direction — always visible */}
        <div className="flex items-center justify-between">
          <FieldLabel required>Plot Direction</FieldLabel>
          {!expanded && <FieldsToggle onClick={() => setExpanded(true)}>+ Fields</FieldsToggle>}
        </div>
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
          className="mt-1 w-full resize-none bg-transparent text-[13px] leading-normal text-[--color-text-primary] outline-none placeholder:text-[--color-text-muted]"
        />

        {expanded && (
          <>
            <Divider />
            <div className="flex items-center justify-between">
              <FieldLabel dim>Background Information</FieldLabel>
              <FieldsToggle onClick={() => setExpanded(false)}>− Fields</FieldsToggle>
            </div>
            <textarea
              value={localDraft.background_information}
              onChange={(e) => update('background_information', e.target.value)}
              rows={2}
              placeholder="Context the model should know but not write directly"
              className="mt-1 w-full resize-none bg-transparent text-[12px] leading-normal text-[--color-text-primary] outline-none placeholder:text-[--color-text-muted]"
            />

            <Divider />
            <FieldLabel dim>Modificators</FieldLabel>
            <div className="mt-1">
              <ChipInput
                chips={localDraft.modificators}
                onChange={(chips) => update('modificators', chips)}
                placeholder="noir, tight pacing, present tense"
              />
            </div>

            <Divider />
            <FieldLabel dim>Constraints</FieldLabel>
            <textarea
              value={localDraft.constraints}
              onChange={(e) => update('constraints', e.target.value)}
              rows={2}
              placeholder="What the model must obey but never include in the prose"
              className="mt-1 w-full resize-none bg-transparent text-[12px] leading-normal text-[--color-text-primary] outline-none placeholder:text-[--color-text-muted]"
            />
          </>
        )}

        <Divider />

        {/* Bottom bar: token meter + actions */}
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-[--color-text-muted]">{tokenLabel}</span>
          <div className="flex items-center gap-2">
            {editMode && (
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-md border border-[--color-border] px-4 py-1.5 text-[12px] font-medium text-[--color-text-secondary] hover:text-[--color-text-primary]"
              >
                Cancel
              </button>
            )}
            {!editMode && isGenerating ? (
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-md border border-[--color-border] px-4 py-1.5 text-[12px] font-medium text-[--color-text-secondary] hover:text-[--color-text-primary]"
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
                    !canSubmit ||
                    (!editMode && isGenerating) ||
                    (!editMode && activeStoryId === null)
                  }
                  title={
                    cacheStale
                      ? 'Cache is outdated. Update it before sending for cost savings, or send anyway.'
                      : undefined
                  }
                  className="relative rounded-md bg-[--color-accent] px-4 py-1.5 text-[12px] font-medium text-[--color-text-on-accent] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {submitLabel ?? 'Send'}
                  {cacheStale && (
                    <span
                      aria-label="Cache is stale"
                      className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[--color-warning]"
                    />
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Divider() {
  return <div className="my-2 h-px bg-[--color-border-subtle]" />;
}

function FieldLabel({
  children,
  required,
  dim,
}: {
  children: string;
  required?: boolean;
  dim?: boolean;
}) {
  return (
    <span
      className={`text-[9px] font-medium uppercase tracking-[0.08em] text-[--color-text-muted] ${
        dim ? 'opacity-70' : ''
      }`}
    >
      {children}
      {required && <span className="ml-1 text-[--color-accent]">*</span>}
    </span>
  );
}

function FieldsToggle({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[3px] border border-[--color-border-subtle] px-1.5 py-px text-[10px] text-[--color-text-muted] hover:text-[--color-text-primary]"
    >
      {children}
    </button>
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
    <div className="flex min-h-[24px] flex-wrap items-center gap-1">
      {chips.map((chip, i) => (
        <span
          key={`${chip}-${i}`}
          className="flex items-center gap-1 rounded-sm bg-[--color-accent-subtle] px-2 py-0.5 text-[10px] text-[--color-accent-text]"
        >
          {chip}
          <button
            type="button"
            onClick={() => removeChip(i)}
            aria-label={`Remove ${chip}`}
            className="text-[--color-accent-text] opacity-70 hover:opacity-100"
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
        className="min-w-[120px] flex-1 bg-transparent text-[12px] text-[--color-text-primary] outline-none placeholder:text-[--color-text-muted]"
      />
    </div>
  );
}
