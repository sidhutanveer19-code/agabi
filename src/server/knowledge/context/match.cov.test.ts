import { describe, it, expect } from "vitest";
import { isApplicable, specificity, rankByContext } from "@/server/knowledge/context/match";
import type { Context } from "@/server/knowledge/types";

/**
 * Context specificity matching (§13.2/§15). PURE + table-driven — no prisma, no
 * network, no clock — so every assertion below drives the REAL logic with the REAL
 * result named, including hostile/edge input. Written to BREAK the code (§H1.5):
 * each branch has a case that flips red under mutation.
 *
 * Branch map that MUST be covered:
 *   isApplicable · loop over candidate.dimensions
 *     - zero entries                       → falls through to `return true`
 *     - !(k in query.dimensions)  = true   → `return false` (candidate narrower)
 *     - !(k in query.dimensions)  = false  → continue to value check
 *     - !valueEquals(...)         = true   → `return false` (contradiction)
 *     - !valueEquals(...)         = false  → continue / `return true`
 *   valueEquals (private, via isApplicable) → JSON.stringify a === b, both branches
 *   specificity → Object.keys(...).length (0, 1, many)
 *   rankByContext
 *     - .filter drops non-applicable, keeps applicable
 *     - .sort primary  specificity(b) - specificity(a) (desc)
 *     - .sort tiebreak a.id < b.id ? -1 : a.id > b.id ? 1 : 0  (all three arms)
 */

const ctx = (id: string, dimensions: Record<string, unknown>): Context => ({ id, dimensions });

describe("isApplicable — key-presence gate (candidate must be a subset of query)", () => {
  it("an EMPTY candidate is applicable to any query (loop never runs → return true)", () => {
    expect(isApplicable(ctx("q", { grade: "5", region: "IN" }), ctx("c", {}))).toBe(true);
  });

  it("an empty candidate is applicable even to an empty query", () => {
    expect(isApplicable(ctx("q", {}), ctx("c", {}))).toBe(true);
  });

  it("candidate pins a dimension the query lacks → NOT applicable (narrower than declared)", () => {
    // `"region" in query.dimensions` is false → the first `return false` fires.
    expect(isApplicable(ctx("q", { grade: "5" }), ctx("c", { region: "IN" }))).toBe(false);
  });

  it("candidate against an EMPTY query with any pinned dim → not applicable", () => {
    expect(isApplicable(ctx("q", {}), ctx("c", { grade: "5" }))).toBe(false);
  });

  it("candidate is a proper subset of query on matching values → applicable", () => {
    // grade present & equal → continue; loop ends → return true. Query's extra `region` is ignored.
    expect(isApplicable(ctx("q", { grade: "5", region: "IN" }), ctx("c", { grade: "5" }))).toBe(true);
  });

  it("candidate equal to query on every dimension → applicable (all pass, return true)", () => {
    expect(
      isApplicable(ctx("q", { grade: "5", region: "IN" }), ctx("c", { grade: "5", region: "IN" })),
    ).toBe(true);
  });

  it("first dim matches but a SECOND pinned dim is absent from query → not applicable", () => {
    // Proves the loop keeps checking past the first entry, then hits the key-absence return.
    expect(
      isApplicable(ctx("q", { grade: "5" }), ctx("c", { grade: "5", region: "IN" })),
    ).toBe(false);
  });
});

describe("isApplicable — value-equality gate (shared axis must not contradict)", () => {
  it("shared axis with a DIFFERENT value → not applicable (direct contradiction)", () => {
    // `"grade" in query` true → skip first return; valueEquals("5","6") false → second return fires.
    expect(isApplicable(ctx("q", { grade: "5" }), ctx("c", { grade: "6" }))).toBe(false);
  });

  it("shared axis with the SAME value → applicable", () => {
    expect(isApplicable(ctx("q", { grade: "5" }), ctx("c", { grade: "5" }))).toBe(true);
  });

  it("number 5 and string '5' CONTRADICT (JSON.stringify differs: 5 vs \"5\")", () => {
    expect(isApplicable(ctx("q", { grade: 5 }), ctx("c", { grade: "5" }))).toBe(false);
  });

  it("two contexts agree on the first axis but contradict on the second → not applicable", () => {
    expect(
      isApplicable(ctx("q", { grade: "5", region: "IN" }), ctx("c", { grade: "5", region: "US" })),
    ).toBe(false);
  });

  it("structurally-equal object values (same key order) match → applicable", () => {
    expect(
      isApplicable(ctx("q", { band: { min: 0, max: 100 } }), ctx("c", { band: { min: 0, max: 100 } })),
    ).toBe(true);
  });

  it("object values differing only in a nested field CONTRADICT → not applicable", () => {
    expect(
      isApplicable(ctx("q", { band: { min: 0, max: 100 } }), ctx("c", { band: { min: 0, max: 50 } })),
    ).toBe(false);
  });

  it("array/tuple values compare by content — equal tuples match", () => {
    expect(isApplicable(ctx("q", { band: [0, 100] }), ctx("c", { band: [0, 100] }))).toBe(true);
  });

  it("array/tuple values differing in an element contradict", () => {
    expect(isApplicable(ctx("q", { band: [0, 100] }), ctx("c", { band: [0, 50] }))).toBe(false);
  });

  it("null on both sides matches (JSON.stringify(null) === JSON.stringify(null))", () => {
    expect(isApplicable(ctx("q", { x: null }), ctx("c", { x: null }))).toBe(true);
  });

  it("null vs a concrete value contradicts", () => {
    expect(isApplicable(ctx("q", { x: null }), ctx("c", { x: 0 }))).toBe(false);
  });

  it("boolean true vs false contradict on a shared axis", () => {
    expect(isApplicable(ctx("q", { flag: true }), ctx("c", { flag: false }))).toBe(false);
  });
});

describe("specificity — number of pinned dimensions", () => {
  it("no dimensions → 0", () => {
    expect(specificity(ctx("c", {}))).toBe(0);
  });

  it("one dimension → 1", () => {
    expect(specificity(ctx("c", { grade: "5" }))).toBe(1);
  });

  it("three dimensions → 3", () => {
    expect(specificity(ctx("c", { grade: "5", region: "IN", lang: "EN" }))).toBe(3);
  });

  it("counts KEYS, not truthiness — a dimension pinned to a falsy value still counts", () => {
    expect(specificity(ctx("c", { a: 0, b: "", c: false, d: null }))).toBe(4);
  });
});

describe("rankByContext — filter to applicable, most-specific first, id tiebreak", () => {
  const query = ctx("q", { grade: "5", region: "IN", lang: "EN" });

  it("drops NON-applicable candidates entirely", () => {
    const contradicting = ctx("c1", { grade: "6" }); // contradicts grade
    const narrower = ctx("c2", { subject: "math" }); // pins a dim query lacks
    expect(rankByContext(query, [contradicting, narrower])).toEqual([]);
  });

  it("empty candidate list → empty result", () => {
    expect(rankByContext(query, [])).toEqual([]);
  });

  it("orders MORE-specific before LESS-specific (primary sort is descending)", () => {
    const one = ctx("a", { grade: "5" });
    const two = ctx("b", { grade: "5", region: "IN" });
    const ranked = rankByContext(query, [one, two]);
    expect(ranked.map((c) => c.id)).toEqual(["b", "a"]); // 2 dims before 1 dim
  });

  it("stays descending even when input is already ascending by specificity", () => {
    const three = ctx("z", { grade: "5", region: "IN", lang: "EN" });
    const one = ctx("y", { grade: "5" });
    const ranked = rankByContext(query, [one, three]);
    expect(ranked.map((c) => c.id)).toEqual(["z", "y"]);
  });

  it("breaks specificity ties by id ASCENDING — input given high-id-first is reordered", () => {
    // Both applicable, both specificity 1 → tiebreak. Feed "b" then "a" so the comparator
    // must return +1 for (a.id='b' > b.id='a') on one call and -1 on the swapped call.
    const bCtx = ctx("b", { grade: "5" });
    const aCtx = ctx("a", { region: "IN" });
    const ranked = rankByContext(query, [bCtx, aCtx]);
    expect(ranked.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("breaks ties by id ascending — input already sorted stays sorted", () => {
    const aCtx = ctx("a", { grade: "5" });
    const bCtx = ctx("b", { region: "IN" });
    const ranked = rankByContext(query, [aCtx, bCtx]);
    expect(ranked.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("specificity dominates id: a low-id less-specific loses to a high-id more-specific", () => {
    // id 'a' would win a tie, but it is less specific → it must rank AFTER the specificity-2 'z'.
    const lowIdLessSpecific = ctx("a", { grade: "5" });
    const highIdMoreSpecific = ctx("z", { grade: "5", region: "IN" });
    const ranked = rankByContext(query, [lowIdLessSpecific, highIdMoreSpecific]);
    expect(ranked.map((c) => c.id)).toEqual(["z", "a"]);
  });

  it("full ranking: mixed specificity + ties, non-applicable dropped, fully deterministic", () => {
    const applicable3 = ctx("m3", { grade: "5", region: "IN", lang: "EN" }); // spec 3
    const applicable2b = ctx("k2", { grade: "5", region: "IN" }); // spec 2
    const applicable2a = ctx("d2", { grade: "5", lang: "EN" }); // spec 2, lower id
    const applicable1 = ctx("z1", { grade: "5" }); // spec 1
    const contradict = ctx("x", { region: "US" }); // dropped
    const narrower = ctx("w", { subject: "math" }); // dropped

    const ranked = rankByContext(query, [
      applicable1,
      contradict,
      applicable2b,
      narrower,
      applicable3,
      applicable2a,
    ]);
    // spec 3 first; then the two spec-2 by id asc (d2 < k2); then spec 1.
    expect(ranked.map((c) => c.id)).toEqual(["m3", "d2", "k2", "z1"]);
  });

  it("equal-id ties resolve to 0 → stable (input relative order preserved)", () => {
    // Constructs the `: 0` arm of the tiebreak ternary: same id, same specificity.
    // The sort comparator returns 0, so Array.prototype.sort keeps input order.
    const first = ctx("same", { grade: "5" });
    const second = ctx("same", { region: "IN" });
    const ranked = rankByContext(query, [first, second]);
    expect(ranked.map((c) => JSON.stringify(c.dimensions))).toEqual([
      JSON.stringify({ grade: "5" }),
      JSON.stringify({ region: "IN" }),
    ]);
  });

  it("does not mutate the caller's candidate array", () => {
    const one = ctx("a", { grade: "5" });
    const two = ctx("b", { grade: "5", region: "IN" });
    const input = [one, two];
    rankByContext(query, input);
    expect(input).toEqual([one, two]); // filter+sort operate on a fresh array
  });

  it("a single applicable candidate ranks as itself", () => {
    const only = ctx("solo", { grade: "5" });
    expect(rankByContext(query, [only])).toEqual([only]);
  });
});
