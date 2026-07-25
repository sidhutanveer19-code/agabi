"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VoiceController } from "@/features/workspace/voice/VoiceController";
import { createWebSpeechIn, createWebSpeechOut, speechSupported } from "@/features/workspace/voice/webSpeech";
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

  // "Answer back": speak each NEW text block as the lesson streams in (best-effort; dedup by id).
  const spoken = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!supported) return;
    const unsub = useWorkspaceStore.subscribe((s) => {
      if (!active || !vcRef.current) return;
      for (const r of s.doc.regions) {
        for (const b of r.blocks) {
          const text = (b.data as { text?: unknown } | undefined)?.text;
          if (typeof text === "string" && text.trim() && !spoken.current.has(b.id)) {
            spoken.current.add(b.id);
            vcRef.current.speak(text);
          }
        }
      }
    });
    return unsub;
  }, [supported, active]);

  const toggle = useCallback(() => {
    const vc = vcRef.current;
    if (!supported || !vc) return;
    setActive((a) => {
      const next = !a;
      if (next) vc.start();
      else vc.stop();
      return next;
    });
  }, [supported]);

  return { supported, active, toggle };
}
