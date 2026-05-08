import { create } from 'zustand';

import { listWorlds } from '@/lib/tauriApi/vault';

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

  // actions — worlds (Phase 2A)
  setWorlds: (worlds: WorldMeta[]) => void;
  refreshWorlds: () => Promise<void>;
  setActiveWorld: (worldId: string | null, dir?: string | null) => void;

  // actions — items (Phase 2C; stubs land now to lock the store shape)
  loadVault: () => Promise<void>;
  loadTrash: () => Promise<void>;
  setItems: (items: VaultItemMeta[]) => void;
  setSelected: (ids: Set<string>) => void;
  toggleSelection: (id: string) => void;
  setFilter: (query: string) => void;
  toggleExpanded: (folderId: string) => void;
  setTrashView: (val: boolean) => void;

  // Called on world switch and lock.
  clear: () => void;
}

/** Doc 06 §vaultStore. Shape locked there; this implementation extends it. */
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

  // --- items: stubs (real impls land in Phase 2C) ---
  async loadVault() {
    // TODO(2C): invoke list_items, populate `items`
  },
  async loadTrash() {
    // TODO(2C): invoke list_items({ include_deleted: true }), populate `trashItems`
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
