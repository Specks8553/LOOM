import { getVersion } from '@tauri-apps/api/app';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { setApiKey } from '@/lib/tauriApi/auth';
import { useSettingsStore } from '@/stores/settingsStore';

import { PromptEditor } from './PromptEditor';
import { SettingField } from './SettingField';
import { TemplatesTab } from './TemplatesTab';

import type { FieldSpec, SettingsTabSpec } from '@/lib/settingsSchema';

export type Chapter = 'app' | 'world';

interface TabContentProps {
  tab: SettingsTabSpec;
  chapter: Chapter;
  /** Lower-cased search query over field labels. */
  query: string;
  /** World chapter only — restrict to overridden fields. */
  onlyOverridden: boolean;
}

/** Dispatch a tab id to its content component. */
export function SettingsTabContent({ tab, chapter, query, onlyOverridden }: TabContentProps) {
  if (tab.id === 'templates') return <TemplatesTab />;
  if (tab.id === 'system_instructions') {
    return <SystemInstructionsTab chapter={chapter} />;
  }
  if (tab.id === 'developer') return <DeveloperTab />;
  if (tab.id === 'general') return <GeneralTab tab={tab} query={query} />;
  return <FieldListTab tab={tab} chapter={chapter} query={query} onlyOverridden={onlyOverridden} />;
}

// --- Field-driven tabs (Appearance, Gemini, Features) ---------------------

function matchesQuery(spec: FieldSpec, query: string): boolean {
  return query === '' || spec.label.toLowerCase().includes(query);
}

function FieldListTab({ tab, chapter, query, onlyOverridden }: TabContentProps) {
  const worldOverrides = useSettingsStore((s) => s.worldOverrides);
  const fields = (tab.fields ?? []).filter((f) => {
    if (chapter === 'world' && !f.worldOverridable) return false;
    if (!matchesQuery(f, query)) return false;
    if (onlyOverridden && !(f.key in worldOverrides)) return false;
    return true;
  });

  return (
    <div className="flex flex-col">
      {chapter === 'world' && <ResetAllOverridesButton tab={tab.id} />}
      {tab.id === 'gemini' && chapter === 'app' && query === '' && <ApiKeyField />}
      {fields.length === 0 ? (
        <p className="py-6 text-[13px] text-[--color-text-muted]">
          {onlyOverridden ? 'No overrides on this tab.' : 'No matching settings.'}
        </p>
      ) : (
        fields.map((f) => <SettingField key={f.key} spec={f} chapter={chapter} />)
      )}
    </div>
  );
}

function GeneralTab({ tab, query }: { tab: SettingsTabSpec; query: string }) {
  const [version, setVersion] = useState('');
  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => setVersion('unknown'));
  }, []);

  const fields = (tab.fields ?? []).filter((f) => matchesQuery(f, query));

  return (
    <div className="flex flex-col">
      {fields.map((f) => (
        <SettingField key={f.key} spec={f} chapter="app" />
      ))}
      <div className="py-4">
        <h3 className="text-[11px] uppercase tracking-wider text-[--color-text-muted]">About</h3>
        <p className="mt-2 text-[13px] text-[--color-text-primary]">LOOM {version}</p>
        <p className="mt-1 text-[11px] text-[--color-text-muted]">
          Local-first, encrypted, offline-capable creative writing.
        </p>
      </div>
    </div>
  );
}

// --- API key (Gemini tab, App chapter only) -------------------------------

function ApiKeyField() {
  const resolved = useSettingsStore((s) => s.resolved);
  const refreshResolved = useSettingsStore((s) => s.refreshResolved);
  const [draft, setDraft] = useState('');
  const [show, setShow] = useState(false);
  const hasKey = resolved?.has_api_key ?? false;

  async function handleSave() {
    if (draft.trim() === '') return;
    try {
      await setApiKey(draft.trim());
      setDraft('');
      await refreshResolved();
      toast.success('API key saved. Existing context caches are invalidated.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save API key');
    }
  }

  return (
    <div className="flex flex-col gap-1 border-b border-[--color-border] py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <span className="text-[13px] text-[--color-text-primary]">Gemini API key</span>
          <p className="mt-0.5 text-[11px] text-[--color-text-muted]">
            {hasKey ? 'A key is set. Enter a new value to replace it.' : 'No key set.'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <input
            type={show ? 'text' : 'password'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={hasKey ? '••••••••' : 'Paste your key'}
            className="w-56 rounded-sm border border-[--color-border] bg-[--color-bg-elevated] px-2 py-1 font-mono text-[12px] text-[--color-text-primary] outline-none focus:border-[--color-accent]"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="text-[11px] uppercase tracking-wider text-[--color-text-muted] hover:text-[--color-text-primary]"
          >
            {show ? 'Hide' : 'Show'}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={draft.trim() === ''}
            className="rounded-sm bg-[--color-accent] px-2 py-1 text-[12px] text-white disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// --- System Instructions --------------------------------------------------

function SystemInstructionsTab({ chapter }: { chapter: Chapter }) {
  return (
    <div className="flex flex-col">
      {chapter === 'world' && <ResetAllOverridesButton tab="system_instructions" />}
      <PromptEditor
        settingKey="story_si"
        label="Story system instruction"
        chapter={chapter}
        restorable
      />
      <PromptEditor
        settingKey="handover_si"
        label="Handover system instruction"
        chapter={chapter}
        restorable
      />
      <PromptEditor
        settingKey="consulting_si"
        label="Consulting system instruction"
        chapter={chapter}
        restorable
      />
    </div>
  );
}

// --- Developer (App only) -------------------------------------------------

function DeveloperTab() {
  return (
    <div className="flex flex-col">
      <p className="py-2 text-[11px] text-[--color-text-muted]">
        Internal prompts encode contracts the rest of the app depends on. Edit with care — each has
        a Restore Default.
      </p>
      <PromptEditor
        settingKey="prompt_ghostwriter"
        label="Ghostwriter prompt"
        chapter="app"
        restorable
      />
      <PromptEditor
        settingKey="prompt_accordion_summarise"
        label="Accordion summarisation prompt"
        chapter="app"
        restorable
      />
      <PromptEditor
        settingKey="prompt_accordion_fake_user"
        label="Accordion fake-user turn"
        chapter="app"
        restorable
      />
      <PromptEditor
        settingKey="prompt_handover_seed"
        label="Handover seed"
        chapter="app"
        restorable
      />
      <PromptEditor
        settingKey="prompt_consulting_seed"
        label="Consulting seed"
        chapter="app"
        restorable
      />
    </div>
  );
}

// --- Shared: per-tab "Reset all overrides" --------------------------------

function ResetAllOverridesButton({ tab }: { tab: string }) {
  const worldOverrides = useSettingsStore((s) => s.worldOverrides);
  const clearTab = useSettingsStore((s) => s.clearTab);
  const busyRef = useRef(false);

  // The button is meaningful only when this tab actually has overrides; we
  // approximate by enabling whenever any override exists (backend returns the
  // accurate cleared-count).
  const hasAny = Object.keys(worldOverrides).length > 0;

  async function handleClear() {
    if (busyRef.current) return;
    if (!window.confirm('Clear every override on this tab? This cannot be undone.')) return;
    busyRef.current = true;
    try {
      const count = await clearTab(tab);
      toast.success(count === 0 ? 'No overrides to clear.' : `Cleared ${count} override(s).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not clear overrides');
    } finally {
      busyRef.current = false;
    }
  }

  return (
    <div className="flex justify-end py-2">
      <button
        type="button"
        onClick={() => void handleClear()}
        disabled={!hasAny}
        className="rounded-sm border border-[--color-border] px-2 py-1 text-[11px] uppercase tracking-wider text-[--color-text-muted] hover:text-[--color-text-primary] disabled:opacity-40"
      >
        Reset all overrides in this tab
      </button>
    </div>
  );
}
