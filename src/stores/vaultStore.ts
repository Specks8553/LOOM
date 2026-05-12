import { create } from 'zustand';

import { listItems, listWorlds } from '@/lib/tauriApi/vault';

import type { VaultItemMeta, WorldMeta } from '@/lib/types';

const EXPANDED_LS_KEY = 'expanded_folder_ids';

function readExpandedFromStorage(): string[] {
  try {
    const raw = localStorage.getItem(EXPANDED_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeExpandedToStorage(ids: string[]): void {
  try {
    localStorage.setItem(EXPANDED_LS_KEY, JSON.stringify(ids));
  } catch {
    // localStorage unavailable (private mode etc.) — skip silently
  }
}

interface VaultState {
  worlds: WorldMeta[];
  activeWorldId: string | null;
  /** Absolute path to the active world directory. Phase 10 (Doc 19) uses this
   * for `convertFileSrc()` on image assets. Populated when a world opens. */
  activeWorldDir: string | null;
  items: VaultItemMeta[];
  trashItems: VaultItemMeta[];
  selectedIds: Set<string>;
  expandedFolderIds: string[];
  filterQuery: string;
  isTrashView: boolean;

  // actions — worlds
  setWorlds: (worlds: WorldMeta[]) => void;
  refreshWorlds: () => Promise<void>;
  setActiveWorld: (worldId: string | null, dir?: string | null) => void;

  // actions — items
  loadVault: () => Promise<void>;
  loadTrash: () => Promise<void>;
  setItems: (items: VaultItemMeta[]) => void;
  setSelected: (ids: Set<string>) => void;
  toggleSelection: (id: string) => void;
  setFilter: (query: string) => void;
  toggleExpanded: (folderId: string) => void;
  expandFolder: (folderId: string) => void;
  setTrashView: (val: boolean) => void;

  // Called on world switch and lock.
  clear: () => void;
}

/** Doc 06 §vaultStore. Shape locked there. */
export const useVaultStore = create<VaultState>((set, get) => ({
  worlds: [],
  activeWorldId: null,
  activeWorldDir: null,
  items: [],
  trashItems: [],
  selectedIds: new Set(),
  expandedFolderIds: readExpandedFromStorage(),
  filterQuery: '',
  isTrashView: false,

  setWorlds(worlds) {
    set({ worlds });
  },

  async refreshWorlds() {
    const worlds = await listWorlds();
    set({ worlds });
  },

  setActiveWorld(worldId, dir = null) {
    set({ activeWorldId: worldId, activeWorldDir: dir });
  },

  async loadVault() {
    if (get().activeWorldId === null) {
      set({ items: [] });
      return;
    }
    const items = await listItems(false);
    set({ items });
  },

  async loadTrash() {
    if (get().activeWorldId === null) {
      set({ trashItems: [] });
      return;
    }
    const all = await listItems(true);
    set({ trashItems: all.filter((i) => i.deleted_at !== null) });
  },

  setItems(items) {
    set({ items });
  },

  setSelected(ids) {
    set({ selectedIds: ids });
  },

  toggleSelection(id) {
    const next = new Set(get().selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ selectedIds: next });
  },

  setFilter(query) {
    set({ filterQuery: query });
  },

  toggleExpanded(folderId) {
    const current = get().expandedFolderIds;
    const next = current.includes(folderId)
      ? current.filter((id) => id !== folderId)
      : [...current, folderId];
    set({ expandedFolderIds: next });
    writeExpandedToStorage(next);
  },

  expandFolder(folderId) {
    const current = get().expandedFolderIds;
    if (current.includes(folderId)) return;
    const next = [...current, folderId];
    set({ expandedFolderIds: next });
    writeExpandedToStorage(next);
  },

  setTrashView(val) {
    set({ isTrashView: val });
  },

  clear() {
    set({
      activeWorldId: null,
      activeWorldDir: null,
      items: [],
      trashItems: [],
      selectedIds: new Set(),
      filterQuery: '',
      isTrashView: false,
    });
  },
}));
