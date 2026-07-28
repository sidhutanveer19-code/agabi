import { describe, it, expect } from "vitest";
import { analogyKind } from "@/server/knowledge/teaching/kinds/analogy";

/**
 * §13.2/§13.3 ANALOGY kind. `validate` runs two gates in sequence:
 *   1. V2 — `source` AND `mapping` must each be a non-empty (post-trim) string, else discard
 *      with ANALOGY_NEEDS_SOURCE_AND_MAPPING.
 *   2. V14 — the load-bearing breakdownPoint gate (delegated to v14AnalogyBreakdown): a
 *      non-empty (post-trim) string `breakdownPoint` is MANDATORY, else discard V14 with
 *      ANALOGY_MISSING_BREAKDOWN_POINT.
 * These tests pin the static descriptor and drive every branch of the `has()` predicate, both
 * legs of the `!has(source) || !has(mapping)` seam, the V2→V14 ordering (V2 short-circuits
 * first), and both arms of the `v14.outcome === "pass"` ternary.
 */

const V2_DISCARD = {
  validator: "V2",
  outcome: "discard",
  reason: "ANALOGY_NEEDS_SOURCE_AND_MAPPING",
} as const;

const V14_DISCARD = {
  validator: "V14",
  outcome: "discard",
  reason: "ANALOGY_MISSING_BREAKDOWN_POINT",
} as const;

const V14_PASS = { validator: "V14", outcome: "pass" } as const;

// A minimal fully-valid payload; individual tests override exactly one field at a time.
const valid = () => ({
  source: "a computer's memory is like a desk",
  mapping: "RAM ↔ desk surface, disk ↔ drawers",
  breakdownPoint: "a desk does not lose its contents when the power is cut",
});

describe("analogyKind — static descriptor", () => {
  it("declares the ANALOGY kind string", () => {
    expect(analogyKind.kind).toBe("ANALOGY");
  });

  it("exposes exactly the analogical and explanatory capabilities, in that order", () => {
    expect(analogyKind.capabilities).toEqual(["analogical", "explanatory"]);
  });

  it("declares exactly two capabilities (length pinned so an added/removed capability is caught)", () => {
    expect(analogyKind.capabilities).toHaveLength(2);
  });

  it("requires exactly source, mapping, and breakdownPoint payload fields, in that order", () => {
    expect(analogyKind.requiredPayloadFields).toEqual(["source", "mapping", "breakdownPoint"]);
  });
});

describe("analogyKind.validate — accepting valid payloads (V14 pass)", () => {
  it("passes V14 when source, mapping, and breakdownPoint are all present and non-empty", () => {
    expect(analogyKind.validate(valid())).toEqual(V14_PASS);
  });

  it("passes with single-character non-whitespace fields (just above the empty boundary)", () => {
    expect(analogyKind.validate({ source: "a", mapping: "b", breakdownPoint: "c" })).toEqual(V14_PASS);
  });

  it("treats surrounding whitespace as content once trimmed text remains (all three fields)", () => {
    expect(
      analogyKind.validate({ source: "  s  ", mapping: "\t m \n", breakdownPoint: "\n b \t" }),
    ).toEqual(V14_PASS);
  });

  it("ignores unrelated extra payload fields and still passes", () => {
    expect(
      analogyKind.validate({ ...valid(), target: "memory", weight: 7, note: null }),
    ).toEqual(V14_PASS);
  });
});

describe("analogyKind.validate — source leg (V2 discard)", () => {
  it("discards when source is missing (undefined)", () => {
    const { source, ...rest } = valid();
    void source;
    expect(analogyKind.validate(rest)).toEqual(V2_DISCARD);
  });

  it("discards when source is an empty string (the > 0 length boundary)", () => {
    expect(analogyKind.validate({ ...valid(), source: "" })).toEqual(V2_DISCARD);
  });

  it("discards when source is whitespace only (trim boundary)", () => {
    expect(analogyKind.validate({ ...valid(), source: "   \t\n " })).toEqual(V2_DISCARD);
  });

  it("discards when source is a non-string number", () => {
    expect(analogyKind.validate({ ...valid(), source: 42 })).toEqual(V2_DISCARD);
  });

  it("discards when source is null", () => {
    expect(analogyKind.validate({ ...valid(), source: null })).toEqual(V2_DISCARD);
  });

  it("discards when source is boolean false", () => {
    expect(analogyKind.validate({ ...valid(), source: false })).toEqual(V2_DISCARD);
  });

  it("discards when source is an object (typeof object, not string)", () => {
    expect(analogyKind.validate({ ...valid(), source: {} })).toEqual(V2_DISCARD);
  });

  it("discards when source is an array (typeof object, not string)", () => {
    expect(analogyKind.validate({ ...valid(), source: ["s"] })).toEqual(V2_DISCARD);
  });
});

describe("analogyKind.validate — mapping leg (V2 discard)", () => {
  it("discards when mapping is missing (undefined)", () => {
    const { mapping, ...rest } = valid();
    void mapping;
    expect(analogyKind.validate(rest)).toEqual(V2_DISCARD);
  });

  it("discards when mapping is an empty string (the > 0 length boundary)", () => {
    expect(analogyKind.validate({ ...valid(), mapping: "" })).toEqual(V2_DISCARD);
  });

  it("discards when mapping is whitespace only (trim boundary)", () => {
    expect(analogyKind.validate({ ...valid(), mapping: " \t \n" })).toEqual(V2_DISCARD);
  });

  it("discards when mapping is a non-string number (including 0)", () => {
    expect(analogyKind.validate({ ...valid(), mapping: 0 })).toEqual(V2_DISCARD);
  });

  it("discards when mapping is null", () => {
    expect(analogyKind.validate({ ...valid(), mapping: null })).toEqual(V2_DISCARD);
  });

  it("discards when mapping is boolean true (non-string truthy)", () => {
    expect(analogyKind.validate({ ...valid(), mapping: true })).toEqual(V2_DISCARD);
  });

  it("discards when mapping is an object (typeof object, not string)", () => {
    expect(analogyKind.validate({ ...valid(), mapping: {} })).toEqual(V2_DISCARD);
  });
});

describe("analogyKind.validate — the || seam (one valid, one broken)", () => {
  // Drive each side of `!has("source") || !has("mapping")` independently. A mutant flipping the
  // `||` to `&&` would require BOTH broken to discard, so a single-broken case would wrongly pass
  // to V14 — these two tests kill that mutant from both directions.
  it("discards when only mapping is valid and source is empty", () => {
    expect(analogyKind.validate({ source: "", mapping: "m", breakdownPoint: "b" })).toEqual(V2_DISCARD);
  });

  it("discards when only source is valid and mapping is empty", () => {
    expect(analogyKind.validate({ source: "s", mapping: "", breakdownPoint: "b" })).toEqual(V2_DISCARD);
  });

  it("discards when both source and mapping are invalid at once", () => {
    expect(analogyKind.validate({ source: "", mapping: "", breakdownPoint: "b" })).toEqual(V2_DISCARD);
  });

  it("discards an entirely empty payload (all gates fail; V2 wins by order)", () => {
    expect(analogyKind.validate({})).toEqual(V2_DISCARD);
  });
});

describe("analogyKind.validate — breakdownPoint / V14 gate", () => {
  // These all hold source and mapping valid so execution reaches the V14 gate.
  it("discards V14 when breakdownPoint is missing (undefined) though source & mapping are valid", () => {
    const { breakdownPoint, ...rest } = valid();
    void breakdownPoint;
    expect(analogyKind.validate(rest)).toEqual(V14_DISCARD);
  });

  it("discards V14 when breakdownPoint is an empty string", () => {
    expect(analogyKind.validate({ ...valid(), breakdownPoint: "" })).toEqual(V14_DISCARD);
  });

  it("discards V14 when breakdownPoint is whitespace only (trim boundary)", () => {
    expect(analogyKind.validate({ ...valid(), breakdownPoint: "  \t\n " })).toEqual(V14_DISCARD);
  });

  it("discards V14 when breakdownPoint is a non-string number", () => {
    expect(analogyKind.validate({ ...valid(), breakdownPoint: 99 })).toEqual(V14_DISCARD);
  });

  it("discards V14 when breakdownPoint is null", () => {
    expect(analogyKind.validate({ ...valid(), breakdownPoint: null })).toEqual(V14_DISCARD);
  });

  it("discards V14 when breakdownPoint is boolean false", () => {
    expect(analogyKind.validate({ ...valid(), breakdownPoint: false })).toEqual(V14_DISCARD);
  });

  it("discards V14 when breakdownPoint is an object (typeof object, not string)", () => {
    expect(analogyKind.validate({ ...valid(), breakdownPoint: {} })).toEqual(V14_DISCARD);
  });

  it("discards V14 when breakdownPoint is an array (typeof object, not string)", () => {
    expect(analogyKind.validate({ ...valid(), breakdownPoint: ["b"] })).toEqual(V14_DISCARD);
  });

  it("passes V14 when breakdownPoint is a single non-whitespace character (just above boundary)", () => {
    expect(analogyKind.validate({ ...valid(), breakdownPoint: "x" })).toEqual(V14_PASS);
  });
});

describe("analogyKind.validate — V2 short-circuits before V14 (ordering)", () => {
  // When source/mapping AND breakdownPoint are all broken, the returned validator must be V2,
  // not V14 — proving the V2 guard runs first and returns before v14AnalogyBreakdown is reached.
  it("returns the V2 discard (not V14) when source and breakdownPoint are both invalid", () => {
    const result = analogyKind.validate({ source: "", mapping: "m", breakdownPoint: "" });
    expect(result).toEqual(V2_DISCARD);
    expect(result.validator).toBe("V2");
  });

  it("returns the V2 discard (not V14) when mapping and breakdownPoint are both invalid", () => {
    const result = analogyKind.validate({ source: "s", mapping: "", breakdownPoint: undefined });
    expect(result).toEqual(V2_DISCARD);
    expect(result.validator).toBe("V2");
  });
});

describe("analogyKind.validate — result object shape", () => {
  it("a V14 pass result exposes exactly validator and outcome keys and nothing else", () => {
    const result = analogyKind.validate(valid());
    expect(Object.keys(result).sort()).toEqual(["outcome", "validator"]);
    expect(result.validator).toBe("V14");
    expect(result.outcome).toBe("pass");
    expect(result.reason).toBeUndefined();
  });

  it("a V2 discard result exposes exactly validator, outcome, and reason keys", () => {
    const result = analogyKind.validate({});
    expect(Object.keys(result).sort()).toEqual(["outcome", "reason", "validator"]);
    expect(result.validator).toBe("V2");
    expect(result.outcome).toBe("discard");
    expect(result.reason).toBe("ANALOGY_NEEDS_SOURCE_AND_MAPPING");
  });

  it("a V14 discard result exposes exactly validator, outcome, and reason keys", () => {
    const { breakdownPoint, ...rest } = valid();
    void breakdownPoint;
    const result = analogyKind.validate(rest);
    expect(Object.keys(result).sort()).toEqual(["outcome", "reason", "validator"]);
    expect(result.validator).toBe("V14");
    expect(result.outcome).toBe("discard");
    expect(result.reason).toBe("ANALOGY_MISSING_BREAKDOWN_POINT");
  });

  it("carries no detail or securityAlert fields on any outcome", () => {
    for (const r of [
      analogyKind.validate(valid()),
      analogyKind.validate({}),
      analogyKind.validate({ source: "s", mapping: "m" }),
    ]) {
      expect(r.detail).toBeUndefined();
      expect(r.securityAlert).toBeUndefined();
    }
  });

  it("returns a fresh result object on each call (no shared mutable singleton)", () => {
    const a = analogyKind.validate({});
    const b = analogyKind.validate({});
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
