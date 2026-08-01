// @no-test-ok: thin browser Web Speech I/O adapter (no logic to unit-test); the barge-in logic lives
// in the tested VoiceController and the speak-selection in the tested speakQueue. Verified in-browser.
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
  onend: (() => void) | null;
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
  let running = false; // session is meant to be on
  let muted = false;   // temporarily not hearing (while Agabi speaks) — echo fix (F1)
  const rec = Ctor ? new Ctor() : null;
  if (rec) {
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-IN";
    rec.onspeechstart = () => { if (!muted) onStart(); }; // never barge-in on our own voice
    rec.onresult = (e: SREvent) => {
      if (muted) return; // ignore any echo of Agabi's speech
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r?.isFinal) onFinal(String(r[0]?.transcript ?? ""));
      }
    };
    // Browsers auto-end recognition after a pause even with continuous=true — restart while on + unmuted.
    rec.onend = () => { if (running && !muted) { try { rec.start(); } catch { /* races */ } } };
  }
  const startRec = () => { if (rec) { try { rec.start(); } catch { /* already started */ } } };
  return {
    start: () => { muted = false; if (rec && !running) { running = true; startRec(); } },
    stop: () => { running = false; muted = false; if (rec) { try { rec.stop(); } catch { /* not running */ } } },
    mute: () => { muted = true; if (rec) { try { rec.stop(); } catch { /* */ } } }, // stop hearing, keep session
    unmute: () => { muted = false; if (rec && running) startRec(); },
    onSpeechStart: (cb) => { onStart = cb; },
    onFinalTranscript: (cb) => { onFinal = cb; },
  };
}

export function createWebSpeechOut(): SpeechOut {
  let onDoneCb = (): void => {};
  let pending = 0;
  let cached: SpeechSynthesisVoice | undefined;
  const pick = (): SpeechSynthesisVoice | undefined => {
    if (typeof window === "undefined") return undefined;
    const voices = window.speechSynthesis.getVoices(); // may be [] on first call → refreshed below
    return (
      voices.find((v) => /natural|neural|google|samantha|aria|jenny/i.test(v.name)) ??
      voices.find((v) => v.lang.startsWith("en"))
    );
  };
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    cached = pick();
    window.speechSynthesis.onvoiceschanged = () => { cached = pick(); }; // F5: voices load async
  }
  return {
    speak: (text: string) => {
      if (!text.trim()) return;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02;
      const v = cached ?? pick();
      if (v) u.voice = v;
      pending++;
      u.onend = () => { pending = Math.max(0, pending - 1); if (pending === 0) onDoneCb(); };
      window.speechSynthesis.speak(u);
    },
    cancel: () => { pending = 0; window.speechSynthesis.cancel(); }, // instant stop; no onDone on a barge-in
    onDone: (cb) => { onDoneCb = cb; },
  };
}
