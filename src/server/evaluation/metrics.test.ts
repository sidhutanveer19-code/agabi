import { describe, it, expect } from "vitest";
import { classificationMetrics, rate, calibrationError, type LabeledPair } from "@/server/evaluation/metrics";

/**
 * Evaluation Engine — pure KPI math (L1: not measured = not engineered; L5: the ONE place KPIs are computed).
 * No I/O, no model — deterministic math over labelled pairs. Every assertion names the EXACT number (§H1.2).
 */

describe("classificationMetrics — accuracy / per-class precision·recall·F1 / confusion", () => {
  // 5 predictions, 4 correct → accuracy 0.8. Classes: LEARN, SMALL_TALK.
  const pairs: LabeledPair[] = [
    { predicted: "LEARN", actual: "LEARN" },       // TP LEARN
    { predicted: "LEARN", actual: "LEARN" },       // TP LEARN
    { predicted: "LEARN", actual: "SMALL_TALK" },  // FP LEARN / FN SMALL_TALK
    { predicted: "SMALL_TALK", actual: "SMALL_TALK" }, // TP SMALL_TALK
    { predicted: "SMALL_TALK", actual: "SMALL_TALK" }, // TP SMALL_TALK
  ];
  const m = classificationMetrics(pairs);

  it("accuracy = correct / total", () => {
    expect(m.accuracy).toBe(0.8); // 4/5
  });
  it("per-class precision: LEARN predicted 3×, 2 correct → 2/3", () => {
    expect(m.perClass.LEARN.precision).toBeCloseTo(2 / 3, 10);
  });
  it("per-class recall: LEARN actual 2×, 2 found → 1.0; SMALL_TALK actual 3×, 2 found → 2/3", () => {
    expect(m.perClass.LEARN.recall).toBe(1);
    expect(m.perClass.SMALL_TALK.recall).toBeCloseTo(2 / 3, 10);
  });
  it("F1 is the harmonic mean of precision & recall (LEARN)", () => {
    const p = 2 / 3, r = 1;
    expect(m.perClass.LEARN.f1).toBeCloseTo((2 * p * r) / (p + r), 10);
  });
  it("confusion counts the exact predicted→actual cell", () => {
    expect(m.confusion.LEARN.SMALL_TALK).toBe(1); // one LEARN-predicted was actually SMALL_TALK
    expect(m.confusion.LEARN.LEARN).toBe(2);
  });
  it("empty input → accuracy 0, no classes (never divides by zero)", () => {
    expect(classificationMetrics([]).accuracy).toBe(0);
  });
});

describe("rate — the safety KPIs (wrong-teaching, unsafe-routing) as a measured fraction", () => {
  it("fraction of rows where the predicate holds", () => {
    const rows = [{ taught: true }, { taught: false }, { taught: true }, { taught: false }];
    expect(rate(rows, (r) => r.taught)).toBe(0.5); // 2/4
  });
  it("zero rows → 0 (never NaN)", () => {
    expect(rate([], () => true)).toBe(0);
  });
  it("a single violation is visible: 1/4 = 0.25 (Wrong-Teaching must be provably 0)", () => {
    const rows = [{ bad: false }, { bad: false }, { bad: true }, { bad: false }];
    expect(rate(rows, (r) => r.bad)).toBe(0.25);
  });
});

describe("calibrationError — |stated confidence − empirical correctness|", () => {
  it("perfectly calibrated → 0", () => {
    const rows = [
      { confidence: 1, correct: true },
      { confidence: 1, correct: true },
    ];
    expect(calibrationError(rows)).toBe(0);
  });
  it("says 100% but only 50% right → error 0.5", () => {
    const rows = [
      { confidence: 1, correct: true },
      { confidence: 1, correct: false },
    ];
    expect(calibrationError(rows)).toBe(0.5); // mean conf 1.0 − empirical 0.5
  });
});
