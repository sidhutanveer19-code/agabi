import { describe, it, expect, beforeEach } from "vitest";
import { VoiceController, type SpeechIn, type SpeechOut, type TeachControl } from "./VoiceController";

// Fakes at the I/O boundary (§H1.7): the browser speech APIs + teaching hook are injected, so the
// barge-in LOGIC is tested for real without a browser. This is the hard part — stop INSTANTLY when
// the student interrupts.
function makeFakes() {
  let speechStart = () => {};
  let finalTranscript = (_t: string) => {};
  const calls: string[] = [];
  const stt: SpeechIn = {
    start: () => calls.push("stt.start"),
    stop: () => calls.push("stt.stop"),
    onSpeechStart: (cb) => { speechStart = cb; },
    onFinalTranscript: (cb) => { finalTranscript = cb; },
  };
  const tts: SpeechOut = { speak: (t) => calls.push(`tts.speak:${t}`), cancel: () => calls.push("tts.cancel") };
  const teach: TeachControl = { ask: (t) => calls.push(`teach.ask:${t}`), cancel: () => calls.push("teach.cancel") };
  return { stt, tts, teach, calls, fireSpeechStart: () => speechStart(), fireTranscript: (t: string) => finalTranscript(t) };
}

describe("VoiceController — barge-in: stop instantly when the student interrupts", () => {
  let f: ReturnType<typeof makeFakes>;
  let vc: VoiceController;
  beforeEach(() => { f = makeFakes(); vc = new VoiceController(f.stt, f.tts, f.teach); });

  it("a final transcript starts teaching (trimmed); empty is ignored", () => {
    vc.start();
    f.fireTranscript("  what is a prime number?  ");
    expect(f.calls).toContain("teach.ask:what is a prime number?");
    f.calls.length = 0;
    f.fireTranscript("   ");
    expect(f.calls.some((c) => c.startsWith("teach.ask"))).toBe(false);
  });

  it("BARGE-IN: student speaks while it is teaching/speaking → cancels TTS + teaching INSTANTLY, re-listens", () => {
    vc.start();
    vc.speak("the answer is a number with exactly two factors...");
    expect(vc.state).toBe("speaking");
    f.calls.length = 0;
    f.fireSpeechStart(); // student interrupts
    expect(f.calls).toContain("tts.cancel");
    expect(f.calls).toContain("teach.cancel");
    expect(vc.state).toBe("listening");
  });

  it("does NOT barge-in when idle/listening (nothing to stop → no spurious cancels)", () => {
    vc.start(); // listening, not speaking
    f.calls.length = 0;
    f.fireSpeechStart();
    expect(f.calls).not.toContain("tts.cancel");
    expect(f.calls).not.toContain("teach.cancel");
  });

  it("a new transcript CANCELS any in-flight TTS/teaching before the new ask (no overlap, red-team)", () => {
    vc.start();
    vc.speak("the old answer plays..."); // speaking
    f.calls.length = 0;
    f.fireTranscript("new different question"); // arrives without a prior speechStart barge-in
    expect(f.calls).toContain("tts.cancel");                  // old voice stopped
    expect(f.calls).toContain("teach.cancel");                // old lesson aborted
    expect(f.calls).toContain("teach.ask:new different question"); // then the new one
  });

  it("stop() halts everything (stt + tts + teaching) and goes idle", () => {
    vc.start();
    vc.speak("x");
    f.calls.length = 0;
    vc.stop();
    expect(f.calls).toEqual(expect.arrayContaining(["stt.stop", "tts.cancel", "teach.cancel"]));
    expect(vc.state).toBe("idle");
  });
});
