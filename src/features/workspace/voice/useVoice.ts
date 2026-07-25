"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VoiceController } from "@/features/workspace/voice/VoiceController";
import { createWebSpeechIn, createWebSpeechOut, speechSupported } from "@/features/workspace/voice/webSpeech";
import { collectSpeakable, newToSpeak } from "@/features/workspace/voice/speakQueue";
import { useWorkspaceStore } from "@/features/workspace/stores/workspace.store";

/**
 * Wires the tested VoiceController to the browser (Web Speech) and the teaching hook. The button
 * turns it on/off; when on: talk → transcribe → `teach.ask` → the lesson streams onto the canvas AND
 * is read aloud; the moment the student talks again, everything stops (barge-in, handled in the
 * controller). All state/logic lives in the controller; this hook is thin glue + browser lifecycle.
 */
export function useVoice(teach: { ask: (t: string) => void; cancel: () => void }) {
  const supported = useMemo(() => speechSupported(), []);
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

  // "Answer back": speak each NEW, settled text block as the lesson streams (pure logic in speakQueue).
  const spoken = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!supported) return;
    const unsub = useWorkspaceStore.subscribe((s) => {
      if (!active || !vcRef.current) return;
      for (const f of newToSpeak(collectSpeakable(s.doc.regions), spoken.current)) {
        vcRef.current.speak(f.text);
      }
    });
    return unsub;
  }, [supported, active]);

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
