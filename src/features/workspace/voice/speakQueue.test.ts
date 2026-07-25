import { describe, it, expect } from "vitest";
import { collectSpeakable, newToSpeak, type Speakable } from "./speakQueue";

describe("collectSpeakable — pulls text blocks, skips non-text", () => {
  it("extracts data.text; ignores blocks without string text", () => {
    const regions = [{ blocks: [
      { id: "a", data: { text: "Prime numbers have two factors." } },
      { id: "b", data: { chart: [1, 2] } },       // visual, no text
      { id: "c", data: { text: "   " } },          // whitespace only → skipped
      { id: "d", data: undefined },
    ] }];
    expect(collectSpeakable(regions)).toEqual([{ id: "a", text: "Prime numbers have two factors." }]);
  });
});

describe("newToSpeak — no blurting, no fragments (red-team A + B)", () => {
  it("BUG A: with existing blocks pre-loaded as baseline, speaks NOTHING (never blurts the whole lesson)", () => {
    const current: Speakable[] = [{ id: "a", text: "already taught." }, { id: "b", text: "also taught." }];
    const seen = new Set(current.map((s) => s.id)); // caller baselines existing ids on mic-on
    expect(newToSpeak(current, seen)).toEqual([]);
  });

  it("speaks a genuinely NEW, settled block once", () => {
    const seen = new Set<string>(["old"]);
    const out = newToSpeak([{ id: "old", text: "x." }, { id: "new", text: "A quadratic has degree two." }], seen);
    expect(out).toEqual([{ id: "new", text: "A quadratic has degree two." }]);
    // second call → already seen → nothing (spoken once)
    expect(newToSpeak([{ id: "new", text: "A quadratic has degree two." }], seen)).toEqual([]);
  });

  it("BUG B: does NOT speak a mid-stream fragment; waits until the text settles", () => {
    const seen = new Set<string>();
    // streaming: fragment first (no end punctuation) → not spoken
    expect(newToSpeak([{ id: "s", text: "A quadratic equation is one wh" }], seen)).toEqual([]);
    // later update, now settled → spoken
    expect(newToSpeak([{ id: "s", text: "A quadratic equation is one where the highest power is two." }], seen))
      .toEqual([{ id: "s", text: "A quadratic equation is one where the highest power is two." }]);
  });
});
