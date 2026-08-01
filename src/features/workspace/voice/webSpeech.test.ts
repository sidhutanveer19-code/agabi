import { describe, it, expect, afterEach, vi } from "vitest";

/**
 * webSpeech.ts — the browser Web Speech I/O adapters (§H1.7 I/O edge). The browser API
 * (SpeechRecognition, speechSynthesis, SpeechSynthesisUtterance) is the ONLY thing faked;
 * every state transition, the mute/running machine, the onresult loop, the voice-pick regex,
 * and the pending/onDone counter are exercised for REAL against those fakes. Each assertion
 * names the exact expected value (a transcript string, a picked voice object, a call count,
 * a boolean support flag) — never "it ran". Branches under test:
 *   recognitionCtor: no window · SpeechRecognition · webkitSpeechRecognition fallback · both absent
 *   speechSupported: full true · no window (1st &&) · SR-but-no-synthesis ("speechSynthesis" in window)
 *   createWebSpeechIn (ctor present): config values · onspeechstart muted vs unmuted ·
 *     onresult muted-return · final vs interim · undefined result slot · missing transcript → "" ·
 *     resultIndex offset · onend restart (running&&!muted) vs not-running vs muted vs start-throws ·
 *     start first vs second-while-running · startRec throw caught · stop + throw · mute + throw ·
 *     unmute running vs not-running
 *   createWebSpeechIn (no ctor): every method is a safe no-op
 *   createWebSpeechOut: pick regex-hit vs en-fallback vs neither · init true vs no-window vs no-synth ·
 *     onvoiceschanged re-pick (F5) · speak empty-return · cached vs cached??pick() · voice set vs unset ·
 *     pending decrement (no early onDone) · onDone at 0 · Math.max(0,…) clamp on stale onend · cancel
 */

import { speechSupported, createWebSpeechIn, createWebSpeechOut } from "./webSpeech";

// ---- Browser API fakes (the I/O edge — nothing above it is faked) ---------------------------------

interface VoiceShape {
  name: string;
  lang: string;
}

class FakeUtterance {
  rate = 1;
  voice: VoiceShape | undefined = undefined;
  onend: (() => void) | null = null;
  constructor(public text: string) {}
}

interface SRResultShape {
  isFinal: boolean;
  0?: { transcript?: string };
}
interface SREventShape {
  resultIndex: number;
  results: { length: number } & Record<number, SRResultShape | undefined>;
}

class FakeRecognition {
  continuous = false;
  interimResults = false;
  lang = "";
  onspeechstart: (() => void) | null = null;
  onresult: ((e: SREventShape) => void) | null = null;
  onend: (() => void) | null = null;
  startCalls = 0;
  stopCalls = 0;
  startThrows = false;
  stopThrows = false;
  start(): void {
    this.startCalls++;
    if (this.startThrows) throw new Error("already started");
  }
  stop(): void {
    this.stopCalls++;
    if (this.stopThrows) throw new Error("not running");
  }
}

let recInstances: FakeRecognition[] = [];
class CapturingRecognition extends FakeRecognition {
  constructor() {
    super();
    recInstances.push(this);
  }
}
const lastRec = (): FakeRecognition => {
  const r = recInstances.at(-1);
  if (!r) throw new Error("no recognition instance was created");
  return r;
};

interface FakeSynth {
  getVoices: () => VoiceShape[];
  onvoiceschanged: (() => void) | null;
  speak: (u: FakeUtterance) => void;
  cancel: () => void;
}

const g = globalThis as unknown as {
  window?: unknown;
  SpeechSynthesisUtterance?: unknown;
};

function makeSynth(initial: VoiceShape[]) {
  let voices = initial;
  const spoken: FakeUtterance[] = [];
  const getVoices = vi.fn(() => voices);
  const speak = vi.fn((u: FakeUtterance) => {
    spoken.push(u);
  });
  const cancel = vi.fn();
  const synth: FakeSynth = { getVoices, onvoiceschanged: null, speak, cancel };
  const setVoices = (v: VoiceShape[]): void => {
    voices = v;
  };
  return { synth, spoken, getVoices, speak, cancel, setVoices };
}

/** Install a fake window for the SpeechIn adapter. */
function installIn(opts: { sr?: boolean; webkit?: boolean; synth?: boolean }): void {
  recInstances = [];
  const win: Record<string, unknown> = {};
  if (opts.sr) win.SpeechRecognition = CapturingRecognition;
  if (opts.webkit) win.webkitSpeechRecognition = CapturingRecognition;
  if (opts.synth) win.speechSynthesis = makeSynth([]).synth;
  g.window = win;
}

/** Install a fake window + utterance global for the SpeechOut adapter. */
function installOut(voices: VoiceShape[]) {
  const s = makeSynth(voices);
  g.window = { speechSynthesis: s.synth };
  g.SpeechSynthesisUtterance = FakeUtterance;
  return s;
}

/** Fire a wired zero-arg handler, asserting the module actually wired it (no non-null assertions). */
function fire(fn: (() => void) | null): void {
  expect(typeof fn).toBe("function");
  (fn as () => void)();
}
function fireResult(fn: ((e: SREventShape) => void) | null, e: SREventShape): void {
  expect(typeof fn).toBe("function");
  (fn as (e: SREventShape) => void)(e);
}

function srEvent(resultIndex: number, results: Array<SRResultShape | undefined>): SREventShape {
  const map: { length: number } & Record<number, SRResultShape | undefined> = {
    length: results.length,
  };
  results.forEach((r, i) => {
    map[i] = r;
  });
  return { resultIndex, results: map };
}

afterEach(() => {
  delete g.window;
  delete g.SpeechSynthesisUtterance;
  recInstances = [];
  vi.restoreAllMocks();
});

// ---- speechSupported / recognitionCtor ------------------------------------------------------------

describe("speechSupported", () => {
  it("no window at all → false (1st && operand false)", () => {
    expect(speechSupported()).toBe(false);
  });

  it("window with SpeechRecognition + speechSynthesis → true", () => {
    installIn({ sr: true, synth: true });
    expect(speechSupported()).toBe(true);
  });

  it("window with only webkitSpeechRecognition (fallback) + synthesis → true", () => {
    installIn({ webkit: true, synth: true });
    expect(speechSupported()).toBe(true);
  });

  it("recognition present but NO speechSynthesis in window → false", () => {
    installIn({ sr: true, synth: false });
    expect(speechSupported()).toBe(false);
  });

  it("window present but neither recognition ctor → false", () => {
    installIn({ synth: true });
    expect(speechSupported()).toBe(false);
  });
});

// ---- createWebSpeechIn — ctor present -------------------------------------------------------------

describe("createWebSpeechIn — recognition present", () => {
  it("configures the recognition instance (continuous/interim/lang=en-IN)", () => {
    installIn({ sr: true, synth: true });
    createWebSpeechIn();
    const rec = lastRec();
    expect(rec.continuous).toBe(true);
    expect(rec.interimResults).toBe(true);
    expect(rec.lang).toBe("en-IN");
  });

  it("uses the webkitSpeechRecognition fallback ctor when SpeechRecognition is absent", () => {
    installIn({ webkit: true, synth: true });
    createWebSpeechIn();
    expect(recInstances.length).toBe(1);
  });

  it("onspeechstart fires onStart only when NOT muted", () => {
    installIn({ sr: true, synth: true });
    const sIn = createWebSpeechIn();
    const rec = lastRec();
    let started = 0;
    sIn.onSpeechStart(() => {
      started++;
    });
    fire(rec.onspeechstart); // unmuted (default) → fires
    expect(started).toBe(1);
    sIn.mute();
    fire(rec.onspeechstart); // muted → suppressed (echo guard)
    expect(started).toBe(1);
    sIn.unmute();
    fire(rec.onspeechstart); // unmuted again → fires
    expect(started).toBe(2);
  });

  it("onresult: emits ONLY final transcripts, skips interim, from resultIndex to results.length", () => {
    installIn({ sr: true, synth: true });
    const sIn = createWebSpeechIn();
    const rec = lastRec();
    const finals: string[] = [];
    sIn.onFinalTranscript((t) => {
      finals.push(t);
    });
    fireResult(
      rec.onresult,
      srEvent(0, [
        { isFinal: true, 0: { transcript: "hello" } },
        { isFinal: false, 0: { transcript: "interim ignored" } },
      ]),
    );
    expect(finals).toEqual(["hello"]);
  });

  it("onresult: undefined slot skipped, missing transcript → '', missing r[0] → ''", () => {
    installIn({ sr: true, synth: true });
    const sIn = createWebSpeechIn();
    const rec = lastRec();
    const finals: string[] = [];
    sIn.onFinalTranscript((t) => {
      finals.push(t);
    });
    fireResult(
      rec.onresult,
      srEvent(0, [
        { isFinal: true, 0: {} }, // transcript undefined → ""
        undefined, // slot missing → r?.isFinal skips it
        { isFinal: true }, // r[0] absent → r[0]?.transcript ?? "" → ""
        { isFinal: true, 0: { transcript: "world" } },
      ]),
    );
    expect(finals).toEqual(["", "", "world"]);
  });

  it("onresult: honours resultIndex offset (skips indices before it)", () => {
    installIn({ sr: true, synth: true });
    const sIn = createWebSpeechIn();
    const rec = lastRec();
    const finals: string[] = [];
    sIn.onFinalTranscript((t) => {
      finals.push(t);
    });
    fireResult(
      rec.onresult,
      srEvent(1, [
        { isFinal: true, 0: { transcript: "skipped-before-index" } },
        { isFinal: true, 0: { transcript: "kept" } },
      ]),
    );
    expect(finals).toEqual(["kept"]);
  });

  it("onresult: while muted returns early — no transcript emitted (echo of Agabi's voice)", () => {
    installIn({ sr: true, synth: true });
    const sIn = createWebSpeechIn();
    const rec = lastRec();
    const finals: string[] = [];
    sIn.onFinalTranscript((t) => {
      finals.push(t);
    });
    sIn.mute();
    fireResult(rec.onresult, srEvent(0, [{ isFinal: true, 0: { transcript: "echoed" } }]));
    expect(finals).toEqual([]);
  });

  it("onend restarts recognition only while running AND unmuted", () => {
    installIn({ sr: true, synth: true });
    const sIn = createWebSpeechIn();
    const rec = lastRec();

    fire(rec.onend); // not running yet → no restart
    expect(rec.startCalls).toBe(0);

    sIn.start(); // running=true, first start
    expect(rec.startCalls).toBe(1);

    fire(rec.onend); // running && !muted → restart
    expect(rec.startCalls).toBe(2);

    sIn.mute(); // muted=true (also stops)
    fire(rec.onend); // muted → no restart
    expect(rec.startCalls).toBe(2);
  });

  it("onend swallows a start() race error (try/catch)", () => {
    installIn({ sr: true, synth: true });
    const sIn = createWebSpeechIn();
    const rec = lastRec();
    sIn.start(); // startCalls=1
    rec.startThrows = true;
    expect(() => fire(rec.onend)).not.toThrow(); // restart attempt throws → caught
    expect(rec.startCalls).toBe(2); // it was still attempted
  });

  it("start() is idempotent while running (second call does not re-start)", () => {
    installIn({ sr: true, synth: true });
    const sIn = createWebSpeechIn();
    const rec = lastRec();
    sIn.start();
    sIn.start(); // running already true → guarded out
    expect(rec.startCalls).toBe(1);
  });

  it("start() swallows an already-started error from rec.start()", () => {
    installIn({ sr: true, synth: true });
    const sIn = createWebSpeechIn();
    const rec = lastRec();
    rec.startThrows = true;
    expect(() => sIn.start()).not.toThrow();
    expect(rec.startCalls).toBe(1);
  });

  it("stop() stops recognition and swallows a not-running error", () => {
    installIn({ sr: true, synth: true });
    const sIn = createWebSpeechIn();
    const rec = lastRec();
    sIn.start();
    sIn.stop();
    expect(rec.stopCalls).toBe(1);
    rec.stopThrows = true;
    expect(() => sIn.stop()).not.toThrow();
    expect(rec.stopCalls).toBe(2);
  });

  it("mute() stops recognition (keeps session) and swallows errors; unmute() re-starts only if running", () => {
    installIn({ sr: true, synth: true });
    const sIn = createWebSpeechIn();
    const rec = lastRec();

    sIn.unmute(); // not running → no start
    expect(rec.startCalls).toBe(0);

    sIn.start(); // startCalls=1
    sIn.mute(); // stopCalls=1
    expect(rec.stopCalls).toBe(1);

    sIn.unmute(); // running → startRec again
    expect(rec.startCalls).toBe(2);

    rec.stopThrows = true;
    expect(() => sIn.mute()).not.toThrow(); // stop throws → caught
    expect(rec.stopCalls).toBe(2);
  });
});

// ---- createWebSpeechIn — no ctor (unsupported browser) --------------------------------------------

describe("createWebSpeechIn — no recognition available", () => {
  it("no window → every method is a safe no-op, no instance created", () => {
    const sIn = createWebSpeechIn();
    expect(recInstances.length).toBe(0);
    expect(() => {
      sIn.start();
      sIn.stop();
      sIn.mute();
      sIn.unmute();
      sIn.onSpeechStart(() => {});
      sIn.onFinalTranscript(() => {});
    }).not.toThrow();
  });

  it("window present but no recognition ctor → still a safe no-op adapter", () => {
    installIn({ synth: true }); // window exists, but no SpeechRecognition/webkit
    const sIn = createWebSpeechIn();
    expect(recInstances.length).toBe(0);
    expect(() => {
      sIn.start();
      sIn.unmute();
      sIn.stop();
    }).not.toThrow();
  });
});

// ---- createWebSpeechOut ---------------------------------------------------------------------------

describe("createWebSpeechOut — voice pick", () => {
  it("prefers a natural/branded voice by name regex, caches it, reuses cache (no re-pick)", () => {
    const s = installOut([
      { name: "Deutsch Stimme", lang: "de-DE" },
      { name: "Google US English", lang: "en-US" },
    ]);
    const sOut = createWebSpeechOut();
    expect(s.getVoices).toHaveBeenCalledTimes(1); // picked once at construction
    sOut.speak("hi");
    expect(s.spoken.length).toBe(1);
    expect(s.spoken[0].voice).toEqual({ name: "Google US English", lang: "en-US" });
    expect(s.spoken[0].rate).toBe(1.02);
    expect(s.spoken[0].text).toBe("hi");
    expect(s.getVoices).toHaveBeenCalledTimes(1); // cached ?? pick() short-circuited on cache
    expect(s.speak).toHaveBeenCalledTimes(1);
  });

  it("falls back to the first en-* voice when no branded voice matches", () => {
    const s = installOut([
      { name: "Fräulein", lang: "de-DE" },
      { name: "Zira Desktop", lang: "en-GB" },
    ]);
    const sOut = createWebSpeechOut();
    sOut.speak("hi");
    expect(s.spoken[0].voice).toEqual({ name: "Zira Desktop", lang: "en-GB" });
  });

  it("no branded and no en voice → utterance.voice left unset (if(v) false)", () => {
    const s = installOut([{ name: "Deutsch", lang: "de-DE" }]);
    const sOut = createWebSpeechOut();
    sOut.speak("hi");
    expect(s.spoken[0].voice).toBeUndefined();
  });

  it("cached??pick(): empty at construction, voices arriving later are picked at speak time", () => {
    const s = installOut([]); // cached undefined
    const sOut = createWebSpeechOut();
    s.setVoices([{ name: "Aria", lang: "en-US" }]);
    sOut.speak("hi"); // cached undefined → pick() re-reads getVoices
    expect(s.spoken[0].voice).toEqual({ name: "Aria", lang: "en-US" });
  });

  it("F5 onvoiceschanged re-picks the cached voice when voices load async", () => {
    const s = installOut([]); // nothing at first → cached undefined
    const sOut = createWebSpeechOut();
    s.setVoices([{ name: "Samantha", lang: "en-US" }]);
    fire(s.synth.onvoiceschanged); // async voices arrive → re-pick
    sOut.speak("hi");
    expect(s.spoken[0].voice).toEqual({ name: "Samantha", lang: "en-US" });
  });
});

describe("createWebSpeechOut — speak / pending / cancel", () => {
  it("blank text is ignored (no utterance, no speak call)", () => {
    const s = installOut([{ name: "Google", lang: "en-US" }]);
    const sOut = createWebSpeechOut();
    sOut.speak("");
    sOut.speak("   ");
    expect(s.speak).not.toHaveBeenCalled();
    expect(s.spoken.length).toBe(0);
  });

  it("onDone fires only when the pending queue drains to zero", () => {
    const s = installOut([{ name: "Google", lang: "en-US" }]);
    const sOut = createWebSpeechOut();
    let done = 0;
    sOut.onDone(() => {
      done++;
    });
    sOut.speak("one");
    sOut.speak("two");
    expect(s.spoken.length).toBe(2);

    fire(s.spoken[0].onend); // pending 2 → 1
    expect(done).toBe(0); // not drained yet

    fire(s.spoken[1].onend); // pending 1 → 0
    expect(done).toBe(1); // drained → onDone
  });

  it("cancel() resets pending + stops synthesis; a stale onend clamps at 0 (Math.max) and still drains", () => {
    const s = installOut([{ name: "Google", lang: "en-US" }]);
    const sOut = createWebSpeechOut();
    let done = 0;
    sOut.onDone(() => {
      done++;
    });
    sOut.speak("x"); // pending 1
    sOut.cancel(); // pending 0, synth.cancel()
    expect(s.cancel).toHaveBeenCalledTimes(1);

    fire(s.spoken[0].onend); // stale: Math.max(0, 0-1) = 0 → pending===0 → onDone
    expect(done).toBe(1);
  });

  it("no window → construction is a safe no-op (init block skipped)", () => {
    const sOut = createWebSpeechOut();
    expect(() => sOut.onDone(() => {})).not.toThrow();
    expect(typeof sOut.speak).toBe("function");
  });

  it("window present but no speechSynthesis → init block skipped (2nd && operand false)", () => {
    g.window = {};
    g.SpeechSynthesisUtterance = FakeUtterance;
    const sOut = createWebSpeechOut();
    expect(() => sOut.onDone(() => {})).not.toThrow();
  });
});
