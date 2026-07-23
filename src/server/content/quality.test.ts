import { describe, it, expect } from "vitest";
import { scoreRun, formatQuality, type GoldenTruth } from "@/server/content/quality";
import type { RawStatement } from "@/server/knowledge/extraction/types";

const TEXT = "Chlorophyll absorbs light in the visible spectrum. Water flows downhill.";
const golden: GoldenTruth = {
  statements: [
    { subject: "Chlorophyll", predicate: "absorbs", object: "Light" },
    { subject: "Water", predicate: "flows", object: "Downhill" },
  ],
};
const mk = (subject: string, predicate: string, object: string, quote: string): RawStatement => ({
  form: "SPO", kind: "FACT", text: `${subject} ${predicate} ${object}.`, quote, structure: {}, subject, predicate, object,
});

describe("quality runner (W3) — scoreExtraction over a run, records never gates", () => {
  it("perfect extraction scores 1.0 across precision/recall/grounding", () => {
    const proposals = [
      mk("Chlorophyll", "absorbs", "Light", "Chlorophyll absorbs light in the visible spectrum"),
      mk("Water", "flows", "Downhill", "Water flows downhill"),
    ];
    const s = scoreRun(proposals, TEXT, golden);
    expect(s.precision).toBe(1);
    expect(s.recall).toBe(1);
    expect(s.groundingRate).toBe(1);
    expect(s.duplicateRate).toBe(0);
  });

  it("penalises a hallucinated (ungrounded, off-truth) proposal", () => {
    const proposals = [
      mk("Chlorophyll", "absorbs", "Light", "Chlorophyll absorbs light in the visible spectrum"),
      mk("Chlorophyll", "eats", "Soil", "chlorophyll eats soil"), // not in text, not in truth
    ];
    const s = scoreRun(proposals, TEXT, golden);
    expect(s.proposed).toBe(2);
    expect(s.matched).toBe(1);
    expect(s.precision).toBe(0.5); // 1 of 2 correct
    expect(s.recall).toBe(0.5); // 1 of 2 truths found
    expect(s.groundingRate).toBe(0.5); // the hallucination is ungrounded
  });

  it("formats a one-line summary", () => {
    expect(formatQuality(scoreRun([], TEXT, golden))).toContain("precision=0.0%");
  });
});
