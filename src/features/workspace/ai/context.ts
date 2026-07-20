import { create } from "zustand";

/**
 * Conversation context — what the "teacher" knows about the session so far.
 * Today it feeds the mock (current topic → follow-up requests); it is also the
 * interface the Phase-6 backend will read (current lesson, prior explanations,
 * focus, history) without any UI change.
 */
export interface Explanation {
  regionId: string;
  title: string;
  kind: string;
}

interface TeachingContext {
  topic: string;
  explanations: Explanation[];
  selectedRegionId: string | null;
  setTopic: (topic: string) => void;
  addExplanation: (e: Explanation) => void;
  setSelected: (regionId: string | null) => void;
  reset: (topic?: string) => void;
}

export const useTeachingContext = create<TeachingContext>((set) => ({
  topic: "",
  explanations: [],
  selectedRegionId: null,
  setTopic: (topic) => set({ topic }),
  addExplanation: (e) => set((s) => ({ explanations: [...s.explanations, e] })),
  setSelected: (selectedRegionId) => set({ selectedRegionId }),
  reset: (topic = "") => set({ topic, explanations: [], selectedRegionId: null }),
}));
