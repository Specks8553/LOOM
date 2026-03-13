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
  setWorlds: (w: WorldMeta[]) => void;
  setActiveWorldId: (id: string | null) => void;
  setItems: (items: VaultItemMeta[]) => void;
  setTrashItems: (items: VaultItemMeta[]) => void;
  setFilterQuery: (q: string) => void;
  toggleExpanded: (id: string) => void;
  toggleSelected: (id: string) => void;
  clearSelection: () => void;
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

    clearSelection: () => set({ selectedItems: new Set() }),

    clearVault: () =>
      set({
        items: [],
        trashItems: [],
        activeWorldId: null,
        filterQuery: "",
        selectedItems: new Set(),
      }),
  };
});
