"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VariantKey } from "@/lib/lesson";
import { projectileLesson } from "@/data/lessons/projectile";

/** Rotating example prompts shown on the entry screen (verbatim from design). */
export const EXAMPLES = [
  "Teach me quadratic equations",
  "Why is the sky blue?",
  "Help me master Newton's laws",
  "Explain DNA replication",
  "Prepare me for tomorrow's physics exam",
  "Teach me integration",
  "I don't understand probability",
];

type Phase = "entry" | "quick" | "canvas";
type QuickPhase = "thinking" | "answered";

interface AgabiState {
  phase: Phase;
  goal: string;
  exIndex: number;
  exOp: number; // 1 | 0 opacity for the rotating example
  listening: boolean; // entry mic
  quickPhase: QuickPhase;
  drawing: boolean;
  paused: boolean;
  voice: boolean;
  variant: VariantKey;
  takeIdx: number;
  ask: string;
  rethinking: boolean;
  asking: boolean;
}

const INITIAL: AgabiState = {
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
};

export function useAgabi() {
  const [state, setState] = useState<AgabiState>(INITIAL);
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

  const set = useCallback(
    (p: Partial<AgabiState> | ((s: AgabiState) => Partial<AgabiState>)) =>
      setState((s) => ({ ...s, ...(typeof p === "function" ? p(s) : p) })),
    []
  );

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

  const canvasEnter = (goal?: string) => {
    clear("a");
    clear("b");
    clear("rd");
    clear("ak");
    set({
      phase: "canvas",
      goal: goal ?? ref.current.goal,
      drawing: true,
      paused: false,
      voice: false,
      variant: "normal",
      takeIdx: 0,
      ask: "",
      rethinking: false,
      asking: false,
    });
  };

  const redraw = (nv: VariantKey) => {
    clear("rd");
    set({ drawing: false, rethinking: true });
    timers.current.rd = window.setTimeout(
      () => set({ variant: nv, drawing: true, rethinking: false }),
      260
    );
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
        // loop restarts on next tick with fresh (empty) goal in ref
        window.setTimeout(() => loopEx(), 0);
      }
    },
    onKeyEnter: () => canvasEnter(pick()),
    learn: () => canvasEnter(pick()),
    quick: () => {
      clear("a");
      clear("b");
      set({ phase: "quick", goal: pick(), quickPhase: "thinking" });
      timers.current.q = window.setTimeout(() => {
        if (ref.current.phase === "quick") set({ quickPhase: "answered" });
      }, 1600);
    },
    escalate: () => canvasEnter(ref.current.goal),
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
    hintColor: state.listening ? "#7DD3FC" : "#5b564b",
  };

  return {
    state,
    lesson: projectileLesson,
    slots: projectileLesson.variants[state.variant],
    example: EXAMPLES[state.exIndex],
    status,
    mic,
    ...actions,
  };
}

export type Agabi = ReturnType<typeof useAgabi>;
