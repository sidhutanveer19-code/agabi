"use client";

import { useCallback, useEffect, useRef } from "react";
import { EXAMPLES } from "@/constants/examples";
import { useSessionStore } from "@/stores/session.store";

/**
 * Session controller hook. Owns the entry ↔ workspace phase machine, the rotating
 * examples loop, and resumable persistence. It generates NOTHING — entering the
 * workspace hands the topic to the backend-streamed teaching surface
 * (LearningWorkspace); this hook only manages navigation + entry-screen state.
 */
export function useAgabi() {
  const state = useSessionStore((s) => s.state);
  const set = useSessionStore((s) => s.set);
  const ref = useRef(state);
  useEffect(() => {
    ref.current = state;
  }, [state]);
  const loopExRef = useRef<() => void>(() => {});

  const timers = useRef<{ a?: number; b?: number }>({});
  const clear = (k: keyof typeof timers.current) => {
    if (timers.current[k] != null) window.clearTimeout(timers.current[k]);
    timers.current[k] = undefined;
  };

  // ---- rotating examples loop (entry screen) ----
  const loopEx = useCallback(() => {
    clear("a");
    clear("b");
    if (ref.current.phase !== "entry" || ref.current.goal) return;
    timers.current.b = window.setTimeout(() => {
      if (ref.current.phase !== "entry" || ref.current.goal) return;
      set({ exOp: 0 });
      timers.current.a = window.setTimeout(() => {
        set((s) => ({ exIndex: (s.exIndex + 1) % EXAMPLES.length, exOp: 1 }));
        loopExRef.current();
      }, 440);
    }, 3400);
  }, [set]);

  // mount / unmount
  useEffect(() => {
    loopExRef.current = loopEx;
    loopEx();
    const t = timers.current;
    return () => {
      if (t.a) window.clearTimeout(t.a);
      if (t.b) window.clearTimeout(t.b);
    };
  }, [loopEx]);

  const pick = () => (ref.current.goal || "").trim() || EXAMPLES[ref.current.exIndex];

  /** Enter the workspace with a topic. No client-side lesson composition — the
   *  backend streams the lesson into LearningWorkspace. */
  const canvasEnter = (goal?: string) => {
    clear("a");
    clear("b");
    const g = (goal ?? ref.current.goal ?? "").trim();
    set({ phase: "canvas", goal: g });
  };

  // ---- resume where you left off (restore once, post-hydration) ----
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("agabi:session");
      if (raw) {
        const s = JSON.parse(raw) as { phase?: string; goal?: string };
        if (s.phase === "canvas" && s.goal) canvasEnter(s.goal);
        else if (s.goal) set({ goal: s.goal });
      }
    } catch {
      // ignore malformed/absent storage
    }
    // run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // persist the resumable slice
  useEffect(() => {
    try {
      window.localStorage.setItem(
        "agabi:session",
        JSON.stringify({ phase: state.phase, goal: state.goal })
      );
    } catch {
      // storage unavailable — non-fatal
    }
  }, [state.phase, state.goal]);

  const actions = {
    onGoal: (value: string) => {
      const was = ref.current.goal;
      set({ goal: value });
      if (!was && value) {
        clear("a");
        clear("b");
      }
      if (was && !value) {
        set({ exOp: 1 });
        window.setTimeout(() => loopEx(), 0);
      }
    },
    onKeyEnter: () => canvasEnter(pick()),
    learn: () => canvasEnter(pick()),
    // "Quick question" now enters the same one teaching surface — the backend
    // answers it as a streamed explanation (no client-side quick-answer).
    quick: () => canvasEnter(pick()),
    back: () => {
      set({ phase: "entry", exOp: 1 });
      window.setTimeout(() => loopEx(), 0);
    },
    toggleMic: () => set((s) => ({ listening: !s.listening })),
    setListening: (v: boolean) => set({ listening: v }),
  };

  const mic = {
    border: state.listening ? "rgba(56,189,248,.5)" : "rgba(255,255,255,.14)",
    bg: state.listening ? "rgba(56,189,248,.1)" : "transparent",
    color: state.listening ? "#38BDF8" : "#B8B0A2",
    hint: state.listening ? "listening — just speak" : "or say it out loud",
    hintColor: state.listening ? "#7DD3FC" : "#8b8579",
  };

  return {
    state,
    example: EXAMPLES[state.exIndex],
    mic,
    ...actions,
  };
}

export type Agabi = ReturnType<typeof useAgabi>;
