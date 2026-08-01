import { describe, it, expect } from "vitest";
import { scoreExtraction, type GoldenTruth } from "@/server/knowledge/extraction/golden";
import type { RawStatement } from "@/server/knowledge/extraction/types";

/**
 * Mutation-killing coverage for `scoreExtraction` (§5.3, §29 golden-set scoring).
 *
 * The quality-runner test (`content/quality.test.ts`) exercises the happy path + a single
 * hallucination, but never a DUPLICATE proposal, never the double-count guard on `matchedTruth`,
 * never the `object ?? objectLit` fallback, and never the 0/0 safe-division guard. Each test below
 * is written to go RED if the source drops the dedup counter, the "already matched this truth" guard,
 * the objectLit fallback, or the `den === 0 ? 0` guard. §H1: the exact numeric result is named.
 */

const mk = (
  subject: string | undefined,
  predicate: string | undefined,
  object: string | undefined,
  quote: string,
  extra: Partial<RawStatement> = {},
): RawStatement => ({
  form: "SPO",
  kind: "FACT",
  text: `${subject} ${predicate} ${object}.`,
  quote,
  structure: {},
  subject,
  predicate,
  object,
  ...extra,
});

const CHUNK = "Chlorophyll absorbs light in the visible spectrum. A cell is bounded by a membrane.";

describe("scoreExtraction — duplicate + double-match guards", () => {
  const truth: GoldenTruth = { statements: [{ subject: "Chlorophyll", predicate: "absorbs", object: "Light" }] };

  it("two IDENTICAL matching proposals count as ONE match, ONE duplicate (not two matches)", () => {
    const p = mk("Chlorophyll", "absorbs", "Light", "Chlorophyll absorbs light");
    const s = scoreExtraction([p, { ...p }], truth, CHUNK);

    expect(s.proposed).toBe(2);
    // matchedTruth guard: the 2nd proposal hits an already-matched truth key → matched stays 1.
    expect(s.matched).toBe(1);
    // duplicates counter: the 2nd proposal's key was already seen → duplicateRate = 1/2.
    expect(s.duplicateRate).toBe(0.5);
    expect(s.precision).toBe(0.5); // 1 matched / 2 proposed
    expect(s.recall).toBe(1); // the single truth was found
    expect(s.groundingRate).toBe(1); // both quotes appear verbatim
  });

  it("a DISTINCT second proposal is NOT a duplicate (duplicateRate 0), even if ungrounded/unmatched", () => {
    const good = mk("Chlorophyll", "absorbs", "Light", "Chlorophyll absorbs light");
    const other = mk("Water", "flows", "Downhill", "water flows downhill"); // different key, not in chunk/truth
    const s = scoreExtraction([good, other], truth, CHUNK);

    expect(s.matched).toBe(1);
    expect(s.duplicateRate).toBe(0); // two different keys → nothing seen twice
    expect(s.precision).toBe(0.5);
    expect(s.groundingRate).toBe(0.5); // only the first quote is in the chunk
  });
});

describe("scoreExtraction — object falls back to objectLit for the triple key", () => {
  const truth: GoldenTruth = { statements: [{ subject: "Cell", predicate: "bounded-by", object: "Membrane" }] };

  it("matches on objectLit when object is absent (object ?? objectLit)", () => {
    // object undefined, objectLit set → the key must use objectLit, so it matches the truth triple.
    const p = mk("Cell", "bounded-by", undefined, "a cell is bounded by a membrane", { objectLit: "Membrane" });
    const s = scoreExtraction([p], truth, CHUNK);
    expect(s.matched).toBe(1);
    expect(s.precision).toBe(1);
    expect(s.recall).toBe(1);
  });

  it("with NEITHER object nor objectLit the object slot is empty → no match against a real truth object", () => {
    const p = mk("Cell", "bounded-by", undefined, "a cell is bounded by a membrane");
    const s = scoreExtraction([p], truth, CHUNK);
    expect(s.matched).toBe(0); // key "cell|bounded-by|" ≠ "cell|bounded-by|membrane"
    expect(s.precision).toBe(0);
  });
});

describe("scoreExtraction — truth count + safe division", () => {
  it("recall divides by the TRUTH count: matching 1 of 2 truths → recall 0.5", () => {
    const truth: GoldenTruth = {
      statements: [
        { subject: "Chlorophyll", predicate: "absorbs", object: "Light" },
        { subject: "Cell", predicate: "bounded-by", object: "Membrane" },
      ],
    };
    const p = mk("Chlorophyll", "absorbs", "Light", "Chlorophyll absorbs light");
    const s = scoreExtraction([p], truth, CHUNK);
    expect(s.truth).toBe(2);
    expect(s.matched).toBe(1);
    expect(s.recall).toBe(0.5);
    expect(s.precision).toBe(1);
  });

  it("empty proposals → every per-proposed rate is 0, NOT NaN (den === 0 ? 0 guard)", () => {
    const truth: GoldenTruth = { statements: [{ subject: "A", predicate: "r", object: "B" }] };
    const s = scoreExtraction([], truth, CHUNK);
    expect(s.proposed).toBe(0);
    expect(s.precision).toBe(0);
    expect(s.groundingRate).toBe(0);
    expect(s.duplicateRate).toBe(0);
    expect(s.recall).toBe(0); // 0 matched / 2 truth (real division, not the guard)
    expect(Number.isNaN(s.precision)).toBe(false);
  });
});
