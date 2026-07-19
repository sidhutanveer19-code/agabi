"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

function getCtor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: Ctor;
    webkitSpeechRecognition?: Ctor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Real dictation via the browser Web Speech API. Degrades to an inert no-op
 * (supported=false) where the API is missing (e.g. Firefox, some desktops).
 */
export function useSpeech(onText: (text: string) => void, onEnd?: () => void) {
  const [supported] = useState(() => getCtor() != null);
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
    const Ctor = getCtor();
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
