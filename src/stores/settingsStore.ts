import { create } from 'zustand';

import {
  clearAllWorldOverridesInTab,
  clearWorldOverride,
  deleteTemplate,
  getAppSettings,
  getResolvedSettings,
  getWorldSettings,
  listTemplates,
  restorePromptDefault,
  restoreTemplateDefault,
  saveAppSetting,
  saveTemplate,
  saveWorldSetting,
} from '@/lib/tauriApi/settings';
import { applyTheme, snapshotFromResolved } from '@/lib/theme';

import type { ResolvedSettings, Template } from '@/lib/types';

/**
 * Doc 20 §Frontend State (`settingsStore`).
 *
 * Holds the resolved cascade plus the raw App / World value maps that the
 * Settings UI chapters render. Every mutation goes through a typed wrapper in
 * `tauriApi/settings.ts`; the store re-fetches and re-applies the theme after
 * each one. `applyTheme` is called from exactly one place — `refreshResolved`.
 */
interface SettingsState {
  /** Merged cascade — null until first load. */
  resolved: ResolvedSettings | null;
  /** Raw `app_settings` values (App chapter view). */
  appValues: Record<string, string>;
  /** Raw world `settings` overrides — only overridden keys are present. */
  worldOverrides: Record<string, string>;
  /** Active world's templates (built-in + user). */
  templates: Template[];

  // --- Loading ---
  /** Fetch the cascade and apply the theme. */
  refreshResolved: () => Promise<void>;
  /** Fetch the raw App + World chapter maps. */
  refreshChapters: () => Promise<void>;
  /** Fetch the active world's templates (empty when no world is open). */
  refreshTemplates: () => Promise<void>;
  /** Full refresh — cascade + chapters + templates. */
  refreshAll: () => Promise<void>;

  // --- Mutations (each re-fetches afterwards) ---
  saveApp: (key: string, value: string) => Promise<void>;
  saveWorld: (key: string, value: string) => Promise<void>;
  clearOverride: (key: string) => Promise<void>;
  clearTab: (tab: string) => Promise<number>;
  restorePrompt: (key: string) => Promise<void>;
  upsertTemplate: (template: Template) => Promise<void>;
  removeTemplate: (id: string) => Promise<void>;
  restoreTemplate: (id: string) => Promise<void>;

  /** Reset on lock / world switch. */
  clear: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  resolved: null,
  appValues: {},
  worldOverrides: {},
  templates: [],

  refreshResolved: async () => {
    const resolved = await getResolvedSettings();
    set({ resolved });
    applyTheme(snapshotFromResolved(resolved));
  },

  refreshChapters: async () => {
    const appValues = await getAppSettings();
    let worldOverrides: Record<string, string> = {};
    try {
      worldOverrides = await getWorldSettings();
    } catch {
      // No world open — the World chapter simply has no overrides to show.
      worldOverrides = {};
    }
    set({ appValues, worldOverrides });
  },

  refreshTemplates: async () => {
    try {
      const templates = await listTemplates();
      set({ templates });
    } catch {
      // No world open — templates live in the world DB.
      set({ templates: [] });
    }
  },

  refreshAll: async () => {
    await Promise.all([get().refreshResolved(), get().refreshChapters(), get().refreshTemplates()]);
  },

  saveApp: async (key, value) => {
    await saveAppSetting(key, value);
    await Promise.all([get().refreshResolved(), get().refreshChapters()]);
  },

  saveWorld: async (key, value) => {
    await saveWorldSetting(key, value);
    await Promise.all([get().refreshResolved(), get().refreshChapters()]);
  },

  clearOverride: async (key) => {
    await clearWorldOverride(key);
    await Promise.all([get().refreshResolved(), get().refreshChapters()]);
  },

  clearTab: async (tab) => {
    const count = await clearAllWorldOverridesInTab(tab);
    await Promise.all([get().refreshResolved(), get().refreshChapters()]);
    return count;
  },

  restorePrompt: async (key) => {
    await restorePromptDefault(key);
    await get().refreshChapters();
  },

  upsertTemplate: async (template) => {
    await saveTemplate(template);
    await get().refreshTemplates();
  },

  removeTemplate: async (id) => {
    await deleteTemplate(id);
    await get().refreshTemplates();
  },

  restoreTemplate: async (id) => {
    await restoreTemplateDefault(id);
    await get().refreshTemplates();
  },

  clear: () => set({ resolved: null, appValues: {}, worldOverrides: {}, templates: [] }),
}));
