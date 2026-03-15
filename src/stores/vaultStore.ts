import { create } from "zustand";
import type { WorldMeta, VaultItemMeta } from "../lib/types";

export type { WorldMeta, VaultItemMeta };

interface VaultStore {
  worlds: WorldMeta[];
  activeWorldId: string | null;
  items: VaultItemMeta[];
  trashItems: VaultItemMeta[];
  expandedPaths: Set<string>;
  filterQuery: string;
  selectedItems: Set<string>;
  pendingRename: string | null;
  createNewOpen: boolean;
  showingTrash: boolean;
  lastSelectedId: string | null;
  setWorlds: (w: WorldMeta[]) => void;
  setActiveWorldId: (id: string | null) => void;
  setItems: (items: VaultItemMeta[]) => void;
  setTrashItems: (items: VaultItemMeta[]) => void;
  setFilterQuery: (q: string) => void;
  toggleExpanded: (id: string) => void;
  toggleSelected: (id: string) => void;
  setSelectedItems: (ids: Set<string>) => void;
  selectRange: (fromId: string, toId: string, flatOrder: string[]) => void;
  clearSelection: () => void;
  setPendingRename: (id: string | null) => void;
  setCreateNewOpen: (v: boolean) => void;
  setShowingTrash: (v: boolean) => void;
  setLastSelectedId: (id: string | null) => void;
  clearVault: () => void;
}

export const useVaultStore = create<VaultStore>((set, get) => {
  // Restore expanded paths from localStorage
  let savedPaths: Set<string> = new Set();
  try {
    const stored = localStorage.getItem("vault_expanded_paths");
    if (stored) savedPaths = new Set(JSON.parse(stored));
  } catch {
    // ignore
  }

  return {
    worlds: [],
    activeWorldId: null,
    items: [],
    trashItems: [],
    expandedPaths: savedPaths,
    filterQuery: "",
    selectedItems: new Set(),
    pendingRename: null,
    createNewOpen: false,
    showingTrash: false,
    lastSelectedId: null,

    setWorlds: (w) => set({ worlds: w }),
    setActiveWorldId: (id) => set({ activeWorldId: id }),
    setItems: (items) => set({ items }),
    setTrashItems: (items) => set({ trashItems: items }),
    setFilterQuery: (q) => set({ filterQuery: q }),

    toggleExpanded: (id) => {
      const expanded = new Set(get().expandedPaths);
      if (expanded.has(id)) {
        expanded.delete(id);
      } else {
        expanded.add(id);
      }
      localStorage.setItem("vault_expanded_paths", JSON.stringify([...expanded]));
      set({ expandedPaths: expanded });
    },

    toggleSelected: (id) => {
      const selected = new Set(get().selectedItems);
      if (selected.has(id)) {
        selected.delete(id);
      } else {
        selected.add(id);
      }
      set({ selectedItems: selected });
    },

    setSelectedItems: (ids) => set({ selectedItems: ids }),

    selectRange: (fromId, toId, flatOrder) => {
      const fromIdx = flatOrder.indexOf(fromId);
      const toIdx = flatOrder.indexOf(toId);
      if (fromIdx === -1 || toIdx === -1) return;
      const start = Math.min(fromIdx, toIdx);
      const end = Math.max(fromIdx, toIdx);
      const rangeIds = new Set(flatOrder.slice(start, end + 1));
      // Merge with existing selection
      const existing = get().selectedItems;
      for (const id of existing) {
        rangeIds.add(id);
      }
      set({ selectedItems: rangeIds });
    },

    clearSelection: () => set({ selectedItems: new Set(), lastSelectedId: null }),
    setPendingRename: (id) => set({ pendingRename: id }),
    setCreateNewOpen: (v) => set({ createNewOpen: v }),
    setShowingTrash: (v) => set({ showingTrash: v }),
    setLastSelectedId: (id) => set({ lastSelectedId: id }),

    clearVault: () =>
      set({
        items: [],
        trashItems: [],
        activeWorldId: null,
        filterQuery: "",
        selectedItems: new Set(),
        showingTrash: false,
        lastSelectedId: null,
      }),
  };
});
