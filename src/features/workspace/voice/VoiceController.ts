/**
 * The voice loop's brain — a pure state machine over injected speech I/O, so the logic is unit-tested
 * without a browser (§H1.7). Browser adapters (Web Speech now, Kokoro-JS later) + the teaching hook plug
 * in; no browser/React deps here.
 *
 * Two things it guarantees:
 *  - BARGE-IN: the student speaks → everything stops instantly and it listens again.
 *  - ECHO SAFETY (red-team F1): the mic is MUTED while Agabi is speaking, so the open mic never hears the
 *    speaker and barges in on Agabi's own voice. Resumes on onDone (F2 — now actually wired).
 * True mid-sentence barge-in on speakers needs acoustic echo cancellation (Kokoro/Pipecat later); with
 * raw Web Speech, muting-while-speaking is the correct, non-broken behaviour — the student interrupts
 * between spoken sentences or during the visual teaching.
 */
export interface SpeechIn {
  start(): void;
  stop(): void;
  mute(): void;   // stop hearing (while Agabi speaks) — without ending the session
  unmute(): void; // resume hearing
  onSpeechStart(cb: () => void): void;
  onFinalTranscript(cb: (text: string) => void): void;
}
export interface SpeechOut {
  speak(text: string): void;
  cancel(): void;          // stop playback immediately
  onDone(cb: () => void): void; // fires when the spoken queue drains
}
export interface TeachControl {
  ask(text: string): void;
  cancel(): void;
}

export type VoiceState = "idle" | "listening" | "teaching" | "speaking";

export class VoiceController {
  state: VoiceState = "idle";

  constructor(
    private readonly stt: SpeechIn,
    private readonly tts: SpeechOut,
    private readonly teach: TeachControl,
  ) {
    this.stt.onFinalTranscript((t) => this.onTranscript(t));
    this.stt.onSpeechStart(() => this.onBargeIn());
    this.tts.onDone(() => this.onSpokenDone()); // F2: wire the done callback so we leave "speaking"
  }

  start(): void {
    this.state = "listening";
    this.stt.start();
  }

  stop(): void {
    this.state = "idle";
    this.stt.stop();
    this.tts.cancel();
    this.teach.cancel();
  }

  speak(text: string): void {
    if (!text.trim()) return;
    this.state = "speaking";
    this.stt.mute(); // F1: don't hear the speaker while we talk → no echo self-interrupt
    this.tts.speak(text);
  }

  onSpokenDone(): void {
    if (this.state === "speaking") {
      this.state = "listening";
      this.stt.unmute();
    }
  }

  private onTranscript(text: string): void {
    const t = text.trim();
    if (!t) return;
    this.tts.cancel();
    this.teach.cancel();
    this.state = "teaching";
    this.teach.ask(t);
  }

  private onBargeIn(): void {
    if (this.state === "teaching" || this.state === "speaking") {
      this.tts.cancel();
      this.teach.cancel();
      this.state = "listening";
      this.stt.unmute(); // if we were muted mid-speech, resume hearing the student
    }
  }
}
