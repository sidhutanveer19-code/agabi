"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/** Stable no-op subscribe: `supported` never changes after mount, so nothing to subscribe to. */
const subscribeNever = () => () => {};

/** Minimal shape of the Web Speech API we use (not in TS lib DOM types). */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
}

type Ctor = new () => SpeechRecognitionLike;

/**
 * Probe the browser for the Web Speech API constructor. Reads `window`, so it is
 * ONLY safe to call after mount (in an effect) — NEVER in render/initial state,
 * or the server (no `window`) and the client (has `window`) diverge and React 19
 * throws a hydration error (this crashed the whole app when voice landed on the
 * entry screen). Standard `SpeechRecognition` wins over the webkit-prefixed one.
 */
export function probeSpeechCtor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: Ctor;
    webkitSpeechRecognition?: Ctor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Server / first-hydration snapshot of `supported`. MUST be a window-free constant so the server and
 * the first client render agree (React uses this getServerSnapshot for both); the real capability is
 * read on the client via getSnapshot right after. Do NOT compute this from `window`.
 */
export const INITIAL_SPEECH_SUPPORTED = false;

/**
 * Real dictation via the browser Web Speech API. Degrades to an inert no-op
 * (supported=false) where the API is missing (e.g. Firefox, some desktops).
 * `supported` is read through useSyncExternalStore with a constant server snapshot, so the first
 * render matches the server and React 19 never sees a hydration divergence (which crashed the app).
 */
export function useSpeech(onText: (text: string) => void, onEnd?: () => void) {
  const supported = useSyncExternalStore(
    subscribeNever,
    () => probeSpeechCtor() != null, // client snapshot — real capability
    () => INITIAL_SPEECH_SUPPORTED, // server + first-hydration snapshot — constant, no window
  );
  const [listening, setListening] = useState(false);
  const [denied, setDenied] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const onTextRef = useRef(onText);
  const onEndRef = useRef(onEnd);

  useEffect(() => {
    onTextRef.current = onText;
    onEndRef.current = onEnd;
  });

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = probeSpeechCtor();
    if (!Ctor) return;
    if (recRef.current) return; // already running
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
      }
      if (text.trim()) onTextRef.current(text.trim());
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
      onEndRef.current?.();
    };
    rec.onerror = (e) => {
      recRef.current = null;
      setListening(false);
      if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
        setDenied(true);
      }
    };
    recRef.current = rec;
    setListening(true);
    rec.start();
  }, []);

  useEffect(() => () => recRef.current?.stop(), []);

  return { supported, listening, denied, start, stop };
}
