"use client";

import { useCallback, useEffect, useRef } from "react";
import type { VariantKey } from "@/features/canvas/lib/lesson";
import { composeLesson } from "@/features/canvas/lib/compose";
import { EXAMPLES } from "@/constants/examples";
import { useSessionStore, type AgabiState } from "@/stores/session.store";

/**
 * Session controller hook. Owns orchestration (timers, effects, speech wiring,
 * compose, persistence); the serializable state lives in the session store.
 */
export function useAgabi() {
  const state = useSessionStore((s) => s.state);
  const set = useSessionStore((s) => s.set);
  const ref = useRef(state);
  useEffect(() => {
    ref.current = state;
  }, [state]);
  const loopExRef = useRef<() => void>(() => {});

  const timers = useRef<{
    a?: number;
    b?: number;
    q?: number;
    rd?: number;
    ak?: number;
  }>({});

  const clear = (k: keyof typeof timers.current) => {
    if (timers.current[k] != null) window.clearTimeout(timers.current[k]);
    timers.current[k] = undefined;
  };

  // ---- rotating examples loop ----
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
      if (t.q) window.clearTimeout(t.q);
      if (t.rd) window.clearTimeout(t.rd);
      if (t.ak) window.clearTimeout(t.ak);
    };
  }, [loopEx]);

  const pick = () => (ref.current.goal || "").trim() || EXAMPLES[ref.current.exIndex];

  const canvasEnter = async (goal?: string) => {
    clear("a");
    clear("b");
    clear("rd");
    clear("ak");
    const g = goal ?? ref.current.goal;
    set({
      phase: "canvas",
      goal: g,
      drawing: false,
      composing: true,
      paused: false,
      voice: false,
      variant: "normal",
      takeIdx: 0,
      ask: "",
      rethinking: false,
      asking: false,
    });
    const lesson = await composeLesson(g);
    // ignore if the user already left the canvas while we were composing
    if (ref.current.phase !== "canvas") return;
    set({ lesson, composing: false, drawing: true });
  };

  const redraw = (nv: VariantKey) => {
    clear("rd");
    set({ drawing: false, rethinking: true });
    timers.current.rd = window.setTimeout(
      () => set({ variant: nv, drawing: true, rethinking: false }),
      260
    );
  };

  // ---- resume where you left off (restore once, post-hydration) ----
  // localStorage cannot be read during SSR, so restoration must happen in a
  // mount effect (not a lazy initializer) to avoid a hydration mismatch.
  useEffect(() => {
    let restore: Partial<AgabiState> | null = null;
    let canvasGoal: string | null = null;
    try {
      const raw = window.localStorage.getItem("agabi:session");
      if (raw) {
        const s = JSON.parse(raw) as { phase?: string; goal?: string };
        if (s.phase === "canvas" && s.goal) canvasGoal = s.goal;
        else if (s.phase === "quick" && s.goal)
          restore = { phase: "quick", goal: s.goal, quickPhase: "answered" };
        else if (s.goal) restore = { goal: s.goal };
      }
    } catch {
      // ignore malformed/absent storage
    }
    if (canvasGoal) void canvasEnter(canvasGoal);
    else if (restore) set(restore);
    // run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // persist the resumable slice
  useEffect(() => {
    try {
      window.localStorage.setItem(
        "agabi:session",
        JSON.stringify({ phase: state.phase, goal: state.goal, variant: state.variant })
      );
    } catch {
      // storage unavailable — non-fatal
    }
  }, [state.phase, state.goal, state.variant]);

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
        // loop restarts on next tick with fresh (empty) goal in ref
        window.setTimeout(() => loopEx(), 0);
      }
    },
    onKeyEnter: () => void canvasEnter(pick()),
    learn: () => void canvasEnter(pick()),
    quick: () => {
      clear("a");
      clear("b");
      set({ phase: "quick", goal: pick(), quickPhase: "thinking" });
      timers.current.q = window.setTimeout(() => {
        if (ref.current.phase === "quick") set({ quickPhase: "answered" });
      }, 1600);
    },
    escalate: () => void canvasEnter(ref.current.goal),
    back: () => {
      clear("rd");
      clear("ak");
      set({
        phase: "entry",
        quickPhase: "thinking",
        paused: false,
        voice: false,
        variant: "normal",
        drawing: true,
        exOp: 1,
      });
      window.setTimeout(() => loopEx(), 0);
    },
    toggleMic: () => set((s) => ({ listening: !s.listening })),
    setListening: (v: boolean) => set({ listening: v }),
    setVoice: (v: boolean) => set({ voice: v }),
    explainAgain: () => {
      const seq: VariantKey[] = ["normal", "again1", "again2"];
      const i = (ref.current.takeIdx + 1) % 3;
      set({ takeIdx: i });
      redraw(seq[i]);
    },
    simpler: () => {
      set({ takeIdx: 0 });
      redraw("simpler");
    },
    deeper: () => {
      set({ takeIdx: 0 });
      redraw("deeper");
    },
    togglePause: () => set((s) => ({ paused: !s.paused })),
    toggleVoice: () => set((s) => ({ voice: !s.voice })),
    onAsk: (value: string) => set({ ask: value }),
    askEnter: () => {
      if (!ref.current.ask.trim()) return;
      set({ ask: "", asking: true });
      clear("ak");
      timers.current.ak = window.setTimeout(() => set({ asking: false }), 1600);
      redraw(ref.current.variant);
    },
  };

  // ---- derived (status + mic visuals) ----
  const status = state.paused
    ? { text: "Paused — take your time", dot: "#D9A441" }
    : state.composing
    ? { text: "Composing your lesson…", dot: "#A78BFA" }
    : state.rethinking
    ? { text: "Rethinking this…", dot: "#A78BFA" }
    : state.asking
    ? { text: "Adapting to you…", dot: "#A78BFA" }
    : state.voice
    ? { text: "Listening — interrupt anytime", dot: "#6FCF97" }
    : { text: "Teaching", dot: "#6FCF97" };

  const mic = {
    border: state.listening ? "rgba(56,189,248,.5)" : "rgba(255,255,255,.14)",
    bg: state.listening ? "rgba(56,189,248,.1)" : "transparent",
    color: state.listening ? "#38BDF8" : "#B8B0A2",
    hint: state.listening ? "listening — just speak" : "or say it out loud",
    hintColor: state.listening ? "#7DD3FC" : "#8b8579",
  };

  return {
    state,
    lesson: state.lesson,
    slots: state.lesson.variants[state.variant],
    example: EXAMPLES[state.exIndex],
    status,
    mic,
    ...actions,
  };
}

export type Agabi = ReturnType<typeof useAgabi>;
