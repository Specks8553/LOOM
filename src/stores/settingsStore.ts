import { create } from "zustand";
import { getSettingsAll, saveSetting } from "../lib/tauriApi";
import { applyAllTheme } from "../lib/applyTheme";

interface SettingsStore {
  settings: Record<string, string>;
  loaded: boolean;

  /** Load all settings from DB and apply theme */
  loadSettings: () => Promise<void>;

  /** Save a single setting to DB and update local cache */
  updateSetting: (key: string, value: string) => Promise<void>;

  /** Get a setting value with optional default */
  get: (key: string, fallback?: string) => string;

  /** Clear on lock/world switch */
  clearSettings: () => void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: {},
  loaded: false,

  loadSettings: async () => {
    const settings = await getSettingsAll();
    set({ settings, loaded: true });
    applyAllTheme(settings);
  },

  updateSetting: async (key, value) => {
    await saveSetting(key, value);
    set((state) => ({
      settings: { ...state.settings, [key]: value },
    }));
  },

  get: (key, fallback = "") => {
    return get().settings[key] ?? fallback;
  },

  clearSettings: () => set({ settings: {}, loaded: false }),
}));
