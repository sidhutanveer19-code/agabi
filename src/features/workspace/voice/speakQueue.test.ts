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

describe("newToSpeak — baseline + speak-once (red-team A); no punctuation gate (F3/F4)", () => {
  it("F-A: existing blocks pre-loaded as baseline → speaks NOTHING (never blurts the whole lesson)", () => {
    const current: Speakable[] = [{ id: "a", text: "already taught." }, { id: "b", text: "also taught." }];
    const seen = new Set(current.map((s) => s.id));
    expect(newToSpeak(current, seen)).toEqual([]);
  });

  it("speaks each NEW block exactly once", () => {
    const seen = new Set<string>(["old"]);
    const out = newToSpeak([{ id: "old", text: "x." }, { id: "new", text: "A quadratic has degree two." }], seen);
    expect(out).toEqual([{ id: "new", text: "A quadratic has degree two." }]);
    expect(newToSpeak([{ id: "new", text: "A quadratic has degree two." }], seen)).toEqual([]); // once
  });

  it("F3: speaks a HEADING / math block with NO terminal punctuation (was silently skipped before)", () => {
    const seen = new Set<string>();
    expect(newToSpeak([{ id: "h", text: "Real Numbers" }, { id: "m", text: "x = 5" }], seen))
      .toEqual([{ id: "h", text: "Real Numbers" }, { id: "m", text: "x = 5" }]);
  });
});
