import { RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { surfaceError } from '@/lib/errors';
import { validateField } from '@/lib/settingsSchema';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settingsStore';

import type { FieldSpec } from '@/lib/settingsSchema';

const SAVE_DEBOUNCE_MS = 800;

interface SettingFieldProps {
  spec: FieldSpec;
  chapter: 'app' | 'world';
}

/**
 * One settings row (Doc 20 §Cascade UX). Holds the in-flight value locally,
 * validates on input, and debounce-saves through `settingsStore`. In the World
 * chapter an edit auto-creates the override; the `↺` button clears it.
 */
export function SettingField({ spec, chapter }: SettingFieldProps) {
  const appValues = useSettingsStore((s) => s.appValues);
  const worldOverrides = useSettingsStore((s) => s.worldOverrides);
  const saveApp = useSettingsStore((s) => s.saveApp);
  const saveWorld = useSettingsStore((s) => s.saveWorld);
  const clearOverride = useSettingsStore((s) => s.clearOverride);

  const isOverridden = chapter === 'world' && spec.key in worldOverrides;
  const externalValue =
    chapter === 'world'
      ? (worldOverrides[spec.key] ?? appValues[spec.key] ?? '')
      : (appValues[spec.key] ?? '');

  const [value, setValue] = useState(externalValue);
  const [error, setError] = useState<string | null>(null);
  const focusedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-sync from the store when the external value changes and the field is
  // not being edited — keeps `↺` reverts and cross-chapter edits reflected.
  useEffect(() => {
    if (!focusedRef.current) {
      setValue(externalValue);
      setError(null);
    }
  }, [externalValue]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const commit = useCallback(
    (next: string) => {
      const save = chapter === 'world' ? saveWorld : saveApp;
      void save(spec.key, next).catch((e) => {
        surfaceError(e, 'Could not save setting');
      });
    },
    [chapter, saveApp, saveWorld, spec.key],
  );

  const onEdit = useCallback(
    (next: string) => {
      setValue(next);
      const err = validateField(spec, next);
      setError(err);
      if (timerRef.current) clearTimeout(timerRef.current);
      // Doc 20 §Save Semantics — invalid input suppresses auto-save.
      if (err !== null) return;
      timerRef.current = setTimeout(() => commit(next), SAVE_DEBOUNCE_MS);
    },
    [commit, spec],
  );

  // Toggle / select commit immediately — no debounce for discrete controls.
  const onDiscrete = useCallback(
    (next: string) => {
      setValue(next);
      const err = validateField(spec, next);
      setError(err);
      if (err === null) commit(next);
    },
    [commit, spec],
  );

  function handleRevert() {
    if (timerRef.current) clearTimeout(timerRef.current);
    void clearOverride(spec.key).catch((e) => {
      surfaceError(e, 'Could not revert override');
    });
  }

  const focusProps = {
    onFocus: () => {
      focusedRef.current = true;
    },
    onBlur: () => {
      focusedRef.current = false;
    },
  };

  return (
    <div className="flex flex-col gap-1 border-b border-[var(--color-border)] py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-[var(--color-text-primary)]">{spec.label}</span>
            {isOverridden && (
              <span
                className="rounded-sm bg-[var(--color-accent-subtle)] px-1 text-[10px] uppercase tracking-wider text-[var(--color-accent-text)]"
                title="Overridden in this world"
              >
                Override
              </span>
            )}
          </div>
          {spec.hint !== undefined && (
            <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">{spec.hint}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <FieldControl
            spec={spec}
            value={value}
            onEdit={onEdit}
            onDiscrete={onDiscrete}
            focusProps={focusProps}
          />
          {chapter === 'world' && (
            <button
              type="button"
              onClick={handleRevert}
              disabled={!isOverridden}
              aria-label="Revert to app default"
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
        </div>
      </div>
      {error !== null && <span className="text-[11px] text-[var(--color-error)]">{error}</span>}
    </div>
  );
}

interface ControlProps {
  spec: FieldSpec;
  value: string;
  onEdit: (next: string) => void;
  onDiscrete: (next: string) => void;
  focusProps: { onFocus: () => void; onBlur: () => void };
}

function FieldControl({ spec, value, onEdit, onDiscrete, focusProps }: ControlProps) {
  const inputBase =
    'rounded-sm border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]';

  switch (spec.kind) {
    case 'toggle': {
      const on = value === 'true';
      return (
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={() => onDiscrete(on ? 'false' : 'true')}
          className={cn(
            'flex h-5 w-9 items-center rounded-full px-0.5 transition-colors',
            on ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]',
          )}
        >
          <span
            className={cn(
              'h-4 w-4 rounded-full bg-white transition-transform',
              on && 'translate-x-4',
            )}
          />
        </button>
      );
    }
    case 'select':
      return (
        <select
          value={value}
          onChange={(e) => onDiscrete(e.target.value)}
          className={cn(inputBase, 'w-48')}
        >
          {(spec.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case 'hex':
      return (
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-5 w-5 rounded-sm border border-[var(--color-border)]"
            style={{ background: value === '' ? 'transparent' : value }}
          />
          <input
            type="text"
            value={value}
            placeholder={spec.allowEmpty ? 'tracks accent' : '#6b9f78'}
            onChange={(e) => onEdit(e.target.value)}
            {...focusProps}
            className={cn(inputBase, 'w-28 font-mono')}
          />
        </div>
      );
    case 'slider':
      return (
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={spec.min}
            max={spec.max}
            step={spec.step}
            value={Number(value) || spec.min || 0}
            onChange={(e) => onEdit(e.target.value)}
            {...focusProps}
            className="w-40 accent-[var(--color-accent)]"
          />
          <span className="w-16 text-right font-mono text-[12px] text-[var(--color-text-muted)]">
            {value}
            {spec.unit ?? ''}
          </span>
        </div>
      );
    case 'number':
      return (
        <input
          type="number"
          min={spec.min}
          max={spec.max}
          value={value}
          onChange={(e) => onEdit(e.target.value)}
          {...focusProps}
          className={cn(inputBase, 'w-32 font-mono')}
        />
      );
    default:
      return (
        <input
          type="text"
          value={value}
          onChange={(e) => onEdit(e.target.value)}
          {...focusProps}
          className={cn(inputBase, 'w-48')}
        />
      );
  }
}
