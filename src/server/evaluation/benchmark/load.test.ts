import { describe, it, expect } from "vitest";
import { loadBenchmark, assertWellFormed, benchmarkStats } from "@/server/evaluation/benchmark/load";
import type { BenchCase } from "@/server/evaluation/benchmark/dataset";

/**
 * The loader is the gate the labelled ground truth passes before any KPI is computed against it — a
 * malformed corpus is a silent poison, so it must fail LOUDLY (Law 11). Every throw branch and every
 * counter is pinned here so a flipped check or a dropped increment dies under mutation.
 */
const ok = (over: Partial<BenchCase>): BenchCase => ({
  id: "id-1",
  message: "photosynthesis",
  expectedIntent: "topic",
  expectedCapability: "TEACH",
  inCorpus: true,
  tags: ["in-corpus"],
  ...over,
});

describe("assertWellFormed — a malformed corpus fails loud, never silently", () => {
  it("a well-formed corpus does NOT throw", () => {
    expect(() => assertWellFormed([ok({ id: "a" }), ok({ id: "b", expectedCapability: "GREET" })])).not.toThrow();
  });
  it("empty id → throws", () => {
    expect(() => assertWellFormed([ok({ id: "" })])).toThrow(/empty id/i);
  });
  it("duplicate id → throws naming the id", () => {
    expect(() => assertWellFormed([ok({ id: "dup" }), ok({ id: "dup" })])).toThrow(/duplicate id "dup"/);
  });
  it("empty / whitespace-only message → throws", () => {
    expect(() => assertWellFormed([ok({ id: "x", message: "   " })])).toThrow(/empty message/i);
  });
  it("unknown capability → throws", () => {
    const bad = { ...ok({ id: "y" }), expectedCapability: "HACK" as unknown as BenchCase["expectedCapability"] };
    expect(() => assertWellFormed([bad])).toThrow(/unknown capability/i);
  });
});

describe("loadBenchmark — validates then returns the canonical corpus", () => {
  it("returns the full seed corpus, already validated", () => {
    const cases = loadBenchmark();
    expect(cases.length).toBeGreaterThanOrEqual(150);
    expect(() => assertWellFormed(cases)).not.toThrow();
  });
});

describe("benchmarkStats — the measured shape of the corpus", () => {
  it("counts total, capability, intent and tag exactly", () => {
    const s = benchmarkStats([
      ok({ id: "1", expectedCapability: "TEACH", expectedIntent: "topic", tags: ["in-corpus"] }),
      ok({ id: "2", expectedCapability: "TEACH", expectedIntent: "topic", tags: ["in-corpus", "math"] }),
      ok({ id: "3", expectedCapability: "GREET", expectedIntent: "greeting", tags: ["greeting"] }),
    ]);
    expect(s.total).toBe(3);
    expect(s.byCapability.TEACH).toBe(2);
    expect(s.byCapability.GREET).toBe(1);
    expect(s.byCapability.CLARIFY).toBe(0);
    expect(s.byIntent.topic).toBe(2);
    expect(s.byIntent.greeting).toBe(1);
    expect(s.tagCounts["in-corpus"]).toBe(2);
    expect(s.tagCounts.math).toBe(1);
  });
  it("empty input → total 0 and every capability 0 (never NaN)", () => {
    const s = benchmarkStats([]);
    expect(s.total).toBe(0);
    expect(s.byCapability).toEqual({ TEACH: 0, GREET: 0, ANSWER: 0, CLARIFY: 0, REFUSE_OFF_SYLLABUS: 0 });
    expect(s.byIntent).toEqual({});
    expect(s.tagCounts).toEqual({});
  });
});
