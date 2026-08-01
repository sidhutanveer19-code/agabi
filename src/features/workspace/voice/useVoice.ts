"use client";
// @no-test-ok: React hook that glues the tested VoiceController + speakQueue to the browser; needs a
// DOM harness to test. Its non-trivial logic was extracted into speakQueue.ts (which IS tested).

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { VoiceController } from "@/features/workspace/voice/VoiceController";
import { createWebSpeechIn, createWebSpeechOut, speechSupported } from "@/features/workspace/voice/webSpeech";
import { collectSpeakable, newToSpeak } from "@/features/workspace/voice/speakQueue";
import { useWorkspaceStore } from "@/features/workspace/stores/workspace.store";

/** Stable no-op subscribe: `supported` never changes after mount. */
const subscribeNever = () => () => {};

/**
 * Wires the tested VoiceController to the browser (Web Speech) and the teaching hook. The button
 * turns it on/off; when on: talk → transcribe → `teach.ask` → the lesson streams onto the canvas AND
 * is read aloud; the moment the student talks again, everything stops (barge-in, handled in the
 * controller). All state/logic lives in the controller; this hook is thin glue + browser lifecycle.
 */
export function useVoice(teach: { ask: (t: string) => void; cancel: () => void }, streaming: boolean) {
  // SSR-safe: constant server snapshot (false) matches the first client render, then the real probe
  // runs on the client. Computing this in render (useMemo(speechSupported)) read `window` →
  // server=false/client=true → React 19 hydration crash (same class of bug that took down the entry
  // screen). useSyncExternalStore is the rule-compliant way to hold a client-only value.
  const supported = useSyncExternalStore(subscribeNever, () => speechSupported(), () => false);
  const [active, setActive] = useState(false);
  const vcRef = useRef<VoiceController | null>(null);
  const teachRef = useRef(teach);
  useEffect(() => { teachRef.current = teach; }); // update in an effect, never during render (React rule)

  useEffect(() => {
    if (!supported) return;
    const vc = new VoiceController(createWebSpeechIn(), createWebSpeechOut(), {
      ask: (t) => teachRef.current.ask(t),
      cancel: () => teachRef.current.cancel(),
    });
    vcRef.current = vc;
    return () => { vc.stop(); vcRef.current = null; };
  }, [supported]);

  // "Answer back": speak the NEW blocks once the lesson has STOPPED streaming (settled → complete text).
  // Triggering on streaming→false (not per store change) fixes reading mid-stream fragments / skipping
  // unpunctuated blocks (red-team F3/F4) and avoids O(n) walks on every camera move (F6).
  const spoken = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!supported || !active || streaming) return;
    const vc = vcRef.current;
    if (!vc) return;
    for (const f of newToSpeak(collectSpeakable(useWorkspaceStore.getState().doc.regions), spoken.current)) {
      vc.speak(f.text);
    }
  }, [supported, active, streaming]);

  const toggle = useCallback(() => {
    const vc = vcRef.current;
    if (!supported || !vc) return;
    setActive((a) => {
      const next = !a;
      if (next) {
        // BASELINE (bug A): whatever is already on the canvas is NOT read aloud — only NEW blocks after
        // the mic turns on. Pre-load every existing id as "already spoken".
        for (const s of collectSpeakable(useWorkspaceStore.getState().doc.regions)) spoken.current.add(s.id);
        vc.start();
      } else {
        vc.stop();
      }
      return next;
    });
  }, [supported]);

  return { supported, active, toggle };
}
