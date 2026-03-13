import { create } from "zustand";

interface WorldMeta {
  id: string;
  name: string;
  tags: string[];
  cover_image: string | null;
  accent_color: string;
  created_at: string;
  modified_at: string;
  deleted_at: string | null;
}

interface VaultItemMeta {
  id: string;
  parent_id: string | null;
  item_type: string;
  item_subtype: string | null;
  name: string;
  description: string | null;
  sort_order: number;
  created_at: string;
  modified_at: string;
  deleted_at: string | null;
}

interface VaultStore {
  worlds: WorldMeta[];
  activeWorldId: string | null;
  items: VaultItemMeta[];
  trashItems: VaultItemMeta[];
  expandedPaths: Set<string>;
  filterQuery: string;
  setWorlds: (w: WorldMeta[]) => void;
  setActiveWorldId: (id: string | null) => void;
  setItems: (items: VaultItemMeta[]) => void;
  setTrashItems: (items: VaultItemMeta[]) => void;
  setFilterQuery: (q: string) => void;
  clearVault: () => void;
}

export const useVaultStore = create<VaultStore>((set) => {
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

    setWorlds: (w) => set({ worlds: w }),
    setActiveWorldId: (id) => set({ activeWorldId: id }),
    setItems: (items) => set({ items }),
    setTrashItems: (items) => set({ trashItems: items }),
    setFilterQuery: (q) => set({ filterQuery: q }),
    clearVault: () =>
      set({
        items: [],
        trashItems: [],
        activeWorldId: null,
        filterQuery: "",
      }),
  };
});
