import { create } from "zustand";

/**
 * TRANSIENT UI state — never persisted. Selection, hover, focus, and the active
 * interaction gesture. Kept separate from the document + camera so ephemeral
 * cursor churn never touches the saved workspace.
 */
export type InteractionKind = "idle" | "panning" | "zooming" | "dragging";

interface UiStore {
  selectedIds: string[];
  hoverId: string | null;
  focusId: string | null;
  interaction: InteractionKind;

  select: (id: string, opts?: { additive?: boolean }) => void;
  clearSelection: () => void;
  isSelected: (id: string) => boolean;
  setHover: (id: string | null) => void;
  setFocus: (id: string | null) => void;
  setInteraction: (kind: InteractionKind) => void;
}

export const useUiStore = create<UiStore>((set, get) => ({
  selectedIds: [],
  hoverId: null,
  focusId: null,
  interaction: "idle",

  select: (id, opts) =>
    set((s) => {
      if (opts?.additive) {
        return s.selectedIds.includes(id)
          ? { selectedIds: s.selectedIds.filter((x) => x !== id) }
          : { selectedIds: [...s.selectedIds, id] };
      }
      return { selectedIds: [id], focusId: id };
    }),
  clearSelection: () => set({ selectedIds: [] }),
  isSelected: (id) => get().selectedIds.includes(id),
  setHover: (hoverId) => set({ hoverId }),
  setFocus: (focusId) => set({ focusId }),
  setInteraction: (interaction) => set({ interaction }),
}));
