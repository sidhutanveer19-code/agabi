import { create } from "zustand";

interface SelectionStore {
  selectedRegionId: string | null;
  selectedBlockId: string | null;
  selectRegion: (id: string | null) => void;
  selectBlock: (regionId: string | null, blockId: string | null) => void;
  clear: () => void;
}

/** Selection/focus state — for navigation + highlighting only (not editing). */
export const useSelectionStore = create<SelectionStore>((set) => ({
  selectedRegionId: null,
  selectedBlockId: null,
  selectRegion: (id) => set({ selectedRegionId: id, selectedBlockId: null }),
  selectBlock: (regionId, blockId) => set({ selectedRegionId: regionId, selectedBlockId: blockId }),
  clear: () => set({ selectedRegionId: null, selectedBlockId: null }),
}));
