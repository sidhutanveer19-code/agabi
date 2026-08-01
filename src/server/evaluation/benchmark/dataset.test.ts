import { describe, it, expect } from "vitest";
import type { Intent } from "@/server/advisors/intent";
import { BENCHMARK, type BenchCase, type Capability } from "@/server/evaluation/benchmark/dataset";
import { loadBenchmark, assertWellFormed, benchmarkStats } from "@/server/evaluation/benchmark/load";

/**
 * Benchmark Dataset + Loader — the labelled ground truth the routing KPIs (Wrong-Teaching-Rate,
 * Unsafe-Routing, Unknown-Detection) are measured against (L1: not measured = not engineered). The
 * dataset only earns those KPIs if it is well-formed and complete, so every assertion names the EXACT
 * number (§H1.2): a wrong count is a red test, never a silent skew. No adversarial/ambiguous row is TEACH.
 */

// The closed enums this corpus must fully exercise — every label reachable, nothing off-set.
const INTENTS: Intent[] = [
  "topic", "followup", "continue", "switch_topic",
  "clarification", "greeting", "smalltalk", "pause", "unclear",
];
const CAPABILITIES: Capability[] = ["TEACH", "GREET", "ANSWER", "CLARIFY", "REFUSE_OFF_SYLLABUS"];

/** A structurally valid row, cloned per test so mutations don't leak between cases. */
const validCase = (over: Partial<BenchCase> = {}): BenchCase => ({
  id: "sample-01",
  message: "teach me photosynthesis",
  expectedIntent: "topic",
  expectedCapability: "TEACH",
  inCorpus: true,
  tags: ["in-corpus"],
  ...over,
});

describe("BENCHMARK dataset — size, uniqueness, and full label coverage", () => {
  const cases = loadBenchmark();

  it("loadBenchmark() returns at least 150 rows (exact seed size = 172)", () => {
    expect(cases.length).toBeGreaterThanOrEqual(150);
    expect(cases.length).toBe(172);
    expect(cases).toBe(BENCHMARK); // the loader hands back the canonical corpus, not a copy
  });

  it("all ids are unique (no double-counted case)", () => {
    const ids = new Set(cases.map((c) => c.id));
    expect(ids.size).toBe(cases.length);
  });

  it("every Intent label appears at least once", () => {
    const { byIntent } = benchmarkStats(cases);
    for (const intent of INTENTS) {
      expect(byIntent[intent] ?? 0).toBeGreaterThanOrEqual(1);
    }
  });

  it("every Capability appears at least once (exact per-capability shape)", () => {
    const { byCapability } = benchmarkStats(cases);
    for (const cap of CAPABILITIES) {
      expect(byCapability[cap]).toBeGreaterThanOrEqual(1);
    }
    expect(byCapability).toEqual({
      TEACH: 78,
      GREET: 24,
      ANSWER: 20,
      CLARIFY: 24,
      REFUSE_OFF_SYLLABUS: 26,
    });
  });

  it("per-capability counts sum to the total", () => {
    const { total, byCapability } = benchmarkStats(cases);
    const summed = CAPABILITIES.reduce((s, cap) => s + byCapability[cap], 0);
    expect(summed).toBe(total);
    expect(total).toBe(172);
  });
});

describe("BENCHMARK dataset — safety invariants (the whole point of the corpus)", () => {
  const cases = loadBenchmark();

  it("has >= 6 injection rows and NONE of them route to TEACH (exactly 8)", () => {
    const injection = cases.filter((c) => c.tags.includes("injection"));
    expect(injection.length).toBeGreaterThanOrEqual(6);
    expect(injection.length).toBe(8);
    expect(injection.every((c) => c.expectedCapability !== "TEACH")).toBe(true);
  });

  it("has >= 8 off-syllabus rows, all inCorpus false and REFUSE_OFF_SYLLABUS (exactly 20)", () => {
    const off = cases.filter((c) => c.tags.includes("off-syllabus"));
    expect(off.length).toBeGreaterThanOrEqual(8);
    expect(off.length).toBe(20);
    expect(off.every((c) => c.inCorpus === false)).toBe(true);
    expect(off.every((c) => c.expectedCapability === "REFUSE_OFF_SYLLABUS")).toBe(true);
  });

  it("no in-corpus row is ever REFUSE_OFF_SYLLABUS", () => {
    const inCorpus = cases.filter((c) => c.inCorpus === true);
    expect(inCorpus.length).toBeGreaterThan(0);
    expect(inCorpus.every((c) => c.expectedCapability !== "REFUSE_OFF_SYLLABUS")).toBe(true);
  });

  it("no ambiguous (Unknown-Detection) row is ever TEACH", () => {
    const ambiguous = cases.filter((c) => c.tags.includes("ambiguous"));
    expect(ambiguous.length).toBeGreaterThan(0);
    expect(ambiguous.every((c) => c.expectedCapability !== "TEACH")).toBe(true);
  });

  it("weather smalltalk is never TEACH", () => {
    const weather = cases.filter((c) => c.tags.includes("weather"));
    expect(weather.length).toBeGreaterThan(0);
    expect(weather.every((c) => c.expectedCapability === "GREET")).toBe(true);
  });
});

describe("assertWellFormed — fails LOUDLY on a malformed corpus (Law 11)", () => {
  it("accepts the seed BENCHMARK without throwing", () => {
    expect(() => assertWellFormed(BENCHMARK)).not.toThrow();
  });

  it("throws on a duplicate-id input", () => {
    const dup = [validCase({ id: "dup-1" }), validCase({ id: "dup-1", message: "teach me polynomials" })];
    expect(() => assertWellFormed(dup)).toThrow(/duplicate id/);
  });

  it("throws on an empty-message input", () => {
    const empty = [validCase({ id: "empty-msg", message: "" })];
    expect(() => assertWellFormed(empty)).toThrow(/empty message/);
  });

  it("throws on a whitespace-only message (trimmed to empty)", () => {
    const blank = [validCase({ id: "blank-msg", message: "   " })];
    expect(() => assertWellFormed(blank)).toThrow(/empty message/);
  });

  it("throws on an empty id", () => {
    const noId = [validCase({ id: "" })];
    expect(() => assertWellFormed(noId)).toThrow(/empty id/);
  });

  it("throws on an unknown capability (out-of-set routing target)", () => {
    const bad = [validCase({ id: "bad-cap", expectedCapability: "SUMMON" as Capability })];
    expect(() => assertWellFormed(bad)).toThrow(/unknown capability/);
  });
});

describe("benchmarkStats — the measured shape of the corpus (total over empty → 0)", () => {
  it("empty input → total 0 and all-zero capability counts (never undefined)", () => {
    const s = benchmarkStats([]);
    expect(s.total).toBe(0);
    expect(s.byCapability).toEqual({ TEACH: 0, GREET: 0, ANSWER: 0, CLARIFY: 0, REFUSE_OFF_SYLLABUS: 0 });
    expect(s.byIntent).toEqual({});
    expect(s.tagCounts).toEqual({});
  });

  it("counts tags across the corpus (in-corpus = 72, injection = 8, off-syllabus = 20)", () => {
    const { tagCounts } = benchmarkStats(BENCHMARK);
    expect(tagCounts["in-corpus"]).toBe(72);
    expect(tagCounts.injection).toBe(8);
    expect(tagCounts["off-syllabus"]).toBe(20);
  });

  it("byIntent counts the exact topic rows (in-corpus 72 + off-syllabus 20 = 92)", () => {
    const { byIntent } = benchmarkStats(BENCHMARK);
    expect(byIntent.topic).toBe(92);
    expect(byIntent.unclear).toBe(20); // ambiguous 12 + injection 8
  });
});
