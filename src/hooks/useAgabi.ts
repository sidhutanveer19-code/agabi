"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { EXAMPLES } from "@/constants/examples";
import { useSessionStore } from "@/stores/session.store";

/**
 * Entry-screen controller hook. Owns the rotating examples loop + entry input state.
 * It generates NOTHING and no longer holds a phase machine — the URL is the state:
 * submitting a topic mints a canvasId and navigates to `/c/{id}` (the backend-streamed
 * teaching surface). Refresh/back are handled by the router, not local persistence.
 */
export function useAgabi() {
  const state = useSessionStore((s) => s.state);
  const set = useSessionStore((s) => s.set);
  const router = useRouter();
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

  /** Mint a fresh canvas and navigate to it — the URL is the state. No client-side
   *  lesson composition; the backend streams the lesson into `/c/{id}`. The topic
   *  rides as a `?goal=` query param, consumed once to seed the first lesson. */
  const enterCanvas = (goal?: string) => {
    clear("a");
    clear("b");
    const g = (goal ?? ref.current.goal ?? "").trim();
    const id = crypto.randomUUID();
    router.push(`/c/${id}${g ? `?goal=${encodeURIComponent(g)}` : ""}`);
  };

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
    onKeyEnter: () => enterCanvas(pick()),
    learn: () => enterCanvas(pick()),
    // "Quick question" enters the same one teaching surface — the backend answers it
    // as a streamed explanation (no client-side quick-answer), identical to learn.
    quick: () => enterCanvas(pick()),
    back: () => {
      set({ exOp: 1 });
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
