import { describe, it, expect, beforeEach } from "vitest";
import { VoiceController, type SpeechIn, type SpeechOut, type TeachControl } from "./VoiceController";

// Fakes at the I/O boundary — but note: the CRITICAL browser bug (mic hears the speaker → echo loop)
// lives in the real wiring, not here. What we CAN test in the machine: the mic is MUTED while speaking
// and RESUMED when speech ends (that's what prevents the echo), and state returns to listening.
function makeFakes() {
  let speechStart = () => {};
  let finalTranscript = (_t: string) => {};
  let spokenDone = () => {};
  const calls: string[] = [];
  const stt: SpeechIn = {
    start: () => calls.push("stt.start"),
    stop: () => calls.push("stt.stop"),
    mute: () => calls.push("stt.mute"),
    unmute: () => calls.push("stt.unmute"),
    onSpeechStart: (cb) => { speechStart = cb; },
    onFinalTranscript: (cb) => { finalTranscript = cb; },
  };
  const tts: SpeechOut = {
    speak: (t) => calls.push(`tts.speak:${t}`),
    cancel: () => calls.push("tts.cancel"),
    onDone: (cb) => { spokenDone = cb; },
  };
  const teach: TeachControl = { ask: (t) => calls.push(`teach.ask:${t}`), cancel: () => calls.push("teach.cancel") };
  return { stt, tts, teach, calls, fireSpeechStart: () => speechStart(), fireTranscript: (t: string) => finalTranscript(t), fireSpokenDone: () => spokenDone() };
}

describe("VoiceController — barge-in, and mic-muted-while-speaking (echo fix, red-team F1/F2)", () => {
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

  it("F1 ECHO FIX: speaking MUTES the mic (so it can't hear the speaker); onDone UNMUTES + re-listens", () => {
    vc.start();
    f.calls.length = 0;
    vc.speak("the answer is...");
    expect(f.calls).toContain("stt.mute");        // mic off while Agabi talks → no echo
    expect(f.calls).toContain("tts.speak:the answer is...");
    expect(vc.state).toBe("speaking");
    f.calls.length = 0;
    f.fireSpokenDone();                            // F2: onDone is actually wired now
    expect(f.calls).toContain("stt.unmute");       // mic back on
    expect(vc.state).toBe("listening");
  });

  it("BARGE-IN: student speaks while teaching → cancels TTS + teaching, re-listens", () => {
    vc.start();
    vc.speak("streaming answer...");
    f.calls.length = 0;
    f.fireSpeechStart();
    expect(f.calls).toContain("tts.cancel");
    expect(f.calls).toContain("teach.cancel");
    expect(f.calls).toContain("stt.unmute");        // resume listening after interrupting
    expect(vc.state).toBe("listening");
  });

  it("does NOT barge-in when idle/listening (no spurious cancel)", () => {
    vc.start();
    f.calls.length = 0;
    f.fireSpeechStart();
    expect(f.calls).not.toContain("tts.cancel");
    expect(f.calls).not.toContain("teach.cancel");
  });

  it("a new transcript cancels in-flight TTS/teaching before the new ask (no overlap)", () => {
    vc.start();
    vc.speak("old answer");
    f.calls.length = 0;
    f.fireTranscript("new question");
    expect(f.calls).toContain("tts.cancel");
    expect(f.calls).toContain("teach.cancel");
    expect(f.calls).toContain("teach.ask:new question");
  });

  it("stop() halts everything and goes idle", () => {
    vc.start();
    vc.speak("x");
    f.calls.length = 0;
    vc.stop();
    expect(f.calls).toEqual(expect.arrayContaining(["stt.stop", "tts.cancel", "teach.cancel"]));
    expect(vc.state).toBe("idle");
  });
});
