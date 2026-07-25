import type { SpeechIn, SpeechOut } from "@/features/workspace/voice/VoiceController";

/**
 * Browser Web Speech API adapters — the I/O edge behind VoiceController (§H1.7). Thin: all the logic
 * (barge-in etc.) lives in the tested controller. Feature-detected; a no-op-safe fallback if the
 * browser lacks the API. Later, `createWebSpeechOut` is the ONE thing swapped for Kokoro-JS (Law 21).
 */

// Minimal typings (the Web Speech API isn't in TS's default lib) — only what we use, no `any`.
interface SRResult { isFinal: boolean; 0: { transcript: string } }
interface SREvent { resultIndex: number; results: { length: number } & Record<number, SRResult> }
interface SpeechRecognitionLike {
  continuous: boolean; interimResults: boolean; lang: string;
  onspeechstart: (() => void) | null;
  onresult: ((e: SREvent) => void) | null;
  start(): void; stop(): void;
}
type SRCtor = new () => SpeechRecognitionLike;
interface SpeechWindow extends Window { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor }

function recognitionCtor(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as SpeechWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechSupported(): boolean {
  return recognitionCtor() !== null && typeof window !== "undefined" && "speechSynthesis" in window;
}

export function createWebSpeechIn(): SpeechIn {
  const Ctor = recognitionCtor();
  let onStart = (): void => {};
  let onFinal = (_t: string): void => {};
  let running = false;
  const rec = Ctor ? new Ctor() : null;
  if (rec) {
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-IN"; // CBSE audience; still understands general English
    rec.onspeechstart = () => onStart();
    rec.onresult = (e: SREvent) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r?.isFinal) onFinal(String(r[0]?.transcript ?? ""));
      }
    };
  }
  return {
    start: () => { if (rec && !running) { try { rec.start(); running = true; } catch { /* already started */ } } },
    stop: () => { running = false; if (rec) { try { rec.stop(); } catch { /* not running */ } } },
    onSpeechStart: (cb) => { onStart = cb; },
    onFinalTranscript: (cb) => { onFinal = cb; },
  };
}

export function createWebSpeechOut(): SpeechOut {
  const pickVoice = (): SpeechSynthesisVoice | undefined => {
    const voices = window.speechSynthesis.getVoices();
    return (
      voices.find((v) => /natural|neural|google|samantha|aria|jenny/i.test(v.name)) ??
      voices.find((v) => v.lang.startsWith("en"))
    );
  };
  return {
    speak: (text: string) => {
      if (!text.trim()) return;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02;
      const v = pickVoice();
      if (v) u.voice = v;
      window.speechSynthesis.speak(u);
    },
    cancel: () => window.speechSynthesis.cancel(), // instant stop — the barge-in
  };
}
