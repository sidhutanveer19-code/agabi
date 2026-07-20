import { create } from "zustand";

/** Global UI store — chrome-level state shared across features (not session data). */
interface UiStore {
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  toggleCommand: () => void;
}

export const useUiStore = create<UiStore>((set) => ({
  commandOpen: false,
  setCommandOpen: (commandOpen) => set({ commandOpen }),
  toggleCommand: () => set((s) => ({ commandOpen: !s.commandOpen })),
}));
