import { create } from "zustand";
import type { Lesson, VariantKey } from "@/features/canvas/lib/lesson";
import { projectileLesson } from "@/features/canvas/data/lessons/projectile";

export type Phase = "entry" | "quick" | "canvas";
export type QuickPhase = "thinking" | "answered";

/** Serializable session state (the phase machine). Orchestration lives in useAgabi. */
export interface AgabiState {
  phase: Phase;
  goal: string;
  exIndex: number;
  exOp: number;
  listening: boolean;
  quickPhase: QuickPhase;
  drawing: boolean;
  paused: boolean;
  voice: boolean;
  variant: VariantKey;
  takeIdx: number;
  ask: string;
  rethinking: boolean;
  asking: boolean;
  lesson: Lesson;
  composing: boolean;
}

export const INITIAL: AgabiState = {
  phase: "entry",
  goal: "",
  exIndex: 0,
  exOp: 1,
  listening: false,
  quickPhase: "thinking",
  drawing: true,
  paused: false,
  voice: false,
  variant: "normal",
  takeIdx: 0,
  ask: "",
  rethinking: false,
  asking: false,
  lesson: projectileLesson,
  composing: false,
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
