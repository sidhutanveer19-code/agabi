/**
 * The voice loop's brain — a pure state machine over injected speech I/O, so the barge-in logic is
 * unit-tested without a browser (§H1.7: fake at the I/O boundary). The browser adapters (Web Speech
 * now, Kokoro-JS later) and the teaching hook are plugged in; this file has no browser/React deps.
 *
 * The centrepiece is BARGE-IN: the moment the student starts speaking while Agabi is teaching or
 * talking, everything stops INSTANTLY and it listens again — so the student is never talked over.
 */
export interface SpeechIn {
  start(): void;
  stop(): void;
  onSpeechStart(cb: () => void): void;            // student began talking (barge-in trigger)
  onFinalTranscript(cb: (text: string) => void): void; // a completed utterance
}
export interface SpeechOut {
  speak(text: string): void;
  cancel(): void; // MUST stop playback immediately
}
export interface TeachControl {
  ask(text: string): void;
  cancel(): void; // abort the in-flight lesson stream
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
  }

  /** Begin listening. */
  start(): void {
    this.state = "listening";
    this.stt.start();
  }

  /** Stop everything and go quiet. */
  stop(): void {
    this.state = "idle";
    this.stt.stop();
    this.tts.cancel();
    this.teach.cancel();
  }

  /** Speak a chunk of the lesson aloud. */
  speak(text: string): void {
    if (!text.trim()) return;
    this.state = "speaking";
    this.tts.speak(text);
  }

  /** The current utterance finished playing → listen for the next question. */
  onSpokenDone(): void {
    if (this.state === "speaking") this.state = "listening";
  }

  private onTranscript(text: string): void {
    const t = text.trim();
    if (!t) return; // silence / noise → ignore, keep listening
    this.state = "teaching";
    this.teach.ask(t);
  }

  private onBargeIn(): void {
    // Only interrupt if there is something to interrupt — never fire spurious cancels while listening.
    if (this.state === "teaching" || this.state === "speaking") {
      this.tts.cancel();
      this.teach.cancel();
      this.state = "listening";
    }
  }
}
