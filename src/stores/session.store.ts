import { create } from "zustand";

export type Phase = "entry" | "canvas";

/** Serializable session state (the phase machine). Orchestration lives in useAgabi. */
export interface AgabiState {
  phase: Phase;
  goal: string;
  exIndex: number;
  exOp: number;
  listening: boolean;
}

export const INITIAL: AgabiState = {
  phase: "entry",
  goal: "",
  exIndex: 0,
  exOp: 1,
  listening: false,
};

type Patch = Partial<AgabiState> | ((s: AgabiState) => Partial<AgabiState>);

interface SessionStore {
  state: AgabiState;
  set: (patch: Patch) => void;
  reset: () => void;
}

/** App-global session store. Single responsibility: the current learning session. */
export const useSessionStore = create<SessionStore>((set) => ({
  state: INITIAL,
  set: (patch) =>
    set((store) => ({
      state: { ...store.state, ...(typeof patch === "function" ? patch(store.state) : patch) },
    })),
  reset: () => set({ state: INITIAL }),
}));
