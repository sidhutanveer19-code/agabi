import { describe, it, expect } from "vitest";
import { contradicts, anyContradiction, type ContradictionInput } from "@/server/knowledge/trust/contradiction";
import type { StatementForm } from "@/server/knowledge/types";

/**
 * contradiction.ts — per-form conflict detection (§14.4). PURE logic, no I/O: every
 * branch is exercised for real with hostile/edge input (§H1.7), asserting the EXACT
 * ContradictionResult (not "didn't throw"). Covers both early returns, all 7 form
 * rules + the defensive `default`, the `obj`/`interval`/`str` helpers, the overlap
 * math (both disjoint directions + touching boundary), and anyContradiction.
 *
 * `detectable:false` (NO_INTERVAL / FORM_UNDETECTABLE) is the load-bearing distinction
 * from `detectable:true, conflict:false` — an undetected conflict must never look like
 * an absence of conflict (§14.4). Every case asserts both fields.
 */

function mk(over: Partial<ContradictionInput> = {}): ContradictionInput {
  return {
    form: "SPO",
    contextId: "ctx-1",
    subjectId: null,
    predicate: null,
    objectId: null,
    objectLit: null,
    structure: {},
    ...over,
  };
}

describe("contradicts — early guards (§14.2)", () => {
  it("different forms → not a conflict, but detectable, reason DIFFERENT_FORMS", () => {
    const a = mk({ form: "SPO" });
    const b = mk({ form: "DEFINITIONAL" }); // same contextId
    expect(contradicts(a, b)).toEqual({
      conflict: false,
      detectable: true,
      form: "SPO",
      reason: "DIFFERENT_FORMS",
    });
  });

  it("same form but no shared context → detectable, reason NO_CONTEXT_OVERLAP", () => {
    const a = mk({ form: "SPO", contextId: "ctx-A", subjectId: "s", predicate: "p", objectId: "o1" });
    const b = mk({ form: "SPO", contextId: "ctx-B", subjectId: "s", predicate: "p", objectId: "o2" });
    // would-be conflict, but different contexts must short-circuit BEFORE the SPO rule
    expect(contradicts(a, b)).toEqual({
      conflict: false,
      detectable: true,
      form: "SPO",
      reason: "NO_CONTEXT_OVERLAP",
    });
  });
});

describe("contradicts — SPO (same subject+predicate, different object)", () => {
  it("same s+p, different objectId → conflict SAME_SPO_DIFFERENT_OBJECT", () => {
    const a = mk({ subjectId: "water", predicate: "boilsAt", objectId: "100C" });
    const b = mk({ subjectId: "water", predicate: "boilsAt", objectId: "90C" });
    expect(contradicts(a, b)).toEqual({
      conflict: true,
      detectable: true,
      form: "SPO",
      reason: "SAME_SPO_DIFFERENT_OBJECT",
    });
  });

  it("same s+p AND same object → no conflict (third condition false), reason undefined", () => {
    const a = mk({ subjectId: "water", predicate: "boilsAt", objectId: "100C" });
    const b = mk({ subjectId: "water", predicate: "boilsAt", objectId: "100C" });
    expect(contradicts(a, b)).toEqual({ conflict: false, detectable: true, form: "SPO", reason: undefined });
  });

  it("different subject → no conflict (first condition false)", () => {
    const a = mk({ subjectId: "water", predicate: "boilsAt", objectId: "100C" });
    const b = mk({ subjectId: "ethanol", predicate: "boilsAt", objectId: "78C" });
    expect(contradicts(a, b)).toEqual({ conflict: false, detectable: true, form: "SPO", reason: undefined });
  });

  it("different predicate → no conflict (second condition false)", () => {
    const a = mk({ subjectId: "water", predicate: "boilsAt", objectId: "100C" });
    const b = mk({ subjectId: "water", predicate: "freezesAt", objectId: "0C" });
    expect(contradicts(a, b)).toEqual({ conflict: false, detectable: true, form: "SPO", reason: undefined });
  });

  it("obj() falls through objectId(null) → objectLit: different literals conflict", () => {
    const a = mk({ subjectId: "s", predicate: "p", objectId: null, objectLit: "red" });
    const b = mk({ subjectId: "s", predicate: "p", objectId: null, objectLit: "blue" });
    expect(contradicts(a, b)).toEqual({
      conflict: true,
      detectable: true,
      form: "SPO",
      reason: "SAME_SPO_DIFFERENT_OBJECT",
    });
  });

  it("obj() falls all the way to null for both (no object at all) → equal → no conflict", () => {
    const a = mk({ subjectId: "s", predicate: "p", objectId: null, objectLit: null });
    const b = mk({ subjectId: "s", predicate: "p", objectId: null, objectLit: null });
    // obj(a) === obj(b) === null, so `obj(a) !== obj(b)` is false → no conflict
    expect(contradicts(a, b)).toEqual({ conflict: false, detectable: true, form: "SPO", reason: undefined });
  });
});

describe("contradicts — DEFINITIONAL (same term, different definition)", () => {
  it("same definiendum, different definiens → conflict SAME_TERM_DIFFERENT_DEFINITION", () => {
    const a = mk({ form: "DEFINITIONAL", structure: { definiendum: "acid", definiens: "proton donor" } });
    const b = mk({ form: "DEFINITIONAL", structure: { definiendum: "acid", definiens: "electron pair acceptor" } });
    expect(contradicts(a, b)).toEqual({
      conflict: true,
      detectable: true,
      form: "DEFINITIONAL",
      reason: "SAME_TERM_DIFFERENT_DEFINITION",
    });
  });

  it("different definiendum → no conflict (first condition false)", () => {
    const a = mk({ form: "DEFINITIONAL", structure: { definiendum: "acid", definiens: "proton donor" } });
    const b = mk({ form: "DEFINITIONAL", structure: { definiendum: "base", definiens: "proton acceptor" } });
    expect(contradicts(a, b)).toEqual({ conflict: false, detectable: true, form: "DEFINITIONAL", reason: undefined });
  });

  it("same definiendum AND same definiens → no conflict (second condition false)", () => {
    const a = mk({ form: "DEFINITIONAL", structure: { definiendum: "acid", definiens: "proton donor" } });
    const b = mk({ form: "DEFINITIONAL", structure: { definiendum: "acid", definiens: "proton donor" } });
    expect(contradicts(a, b)).toEqual({ conflict: false, detectable: true, form: "DEFINITIONAL", reason: undefined });
  });

  it("nullish structure (str's ?. short-circuits) → undefined !== value handled, no crash, no conflict", () => {
    // a.structure is missing entirely; str(a,k) must return undefined via ?. rather than throw
    const a = mk({ form: "DEFINITIONAL", structure: undefined as unknown as Record<string, unknown> });
    const b = mk({ form: "DEFINITIONAL", structure: { definiendum: "acid", definiens: "proton donor" } });
    // definiendum: undefined === "acid" → false → conflict false
    expect(contradicts(a, b)).toEqual({ conflict: false, detectable: true, form: "DEFINITIONAL", reason: undefined });
  });
});

describe("contradicts — COMPARATIVE (same pair+dimension, opposite direction)", () => {
  it("same pair+dimension, opposite direction → conflict OPPOSITE_COMPARISON", () => {
    const a = mk({ form: "COMPARATIVE", structure: { pair: "A|B", dimension: "mass", direction: "GT" } });
    const b = mk({ form: "COMPARATIVE", structure: { pair: "A|B", dimension: "mass", direction: "LT" } });
    expect(contradicts(a, b)).toEqual({
      conflict: true,
      detectable: true,
      form: "COMPARATIVE",
      reason: "OPPOSITE_COMPARISON",
    });
  });

  it("different pair → no conflict (first condition false)", () => {
    const a = mk({ form: "COMPARATIVE", structure: { pair: "A|B", dimension: "mass", direction: "GT" } });
    const b = mk({ form: "COMPARATIVE", structure: { pair: "A|C", dimension: "mass", direction: "LT" } });
    expect(contradicts(a, b)).toEqual({ conflict: false, detectable: true, form: "COMPARATIVE", reason: undefined });
  });

  it("same pair, different dimension → no conflict (second condition false)", () => {
    const a = mk({ form: "COMPARATIVE", structure: { pair: "A|B", dimension: "mass", direction: "GT" } });
    const b = mk({ form: "COMPARATIVE", structure: { pair: "A|B", dimension: "volume", direction: "LT" } });
    expect(contradicts(a, b)).toEqual({ conflict: false, detectable: true, form: "COMPARATIVE", reason: undefined });
  });

  it("same pair+dimension AND same direction → no conflict (third condition false)", () => {
    const a = mk({ form: "COMPARATIVE", structure: { pair: "A|B", dimension: "mass", direction: "GT" } });
    const b = mk({ form: "COMPARATIVE", structure: { pair: "A|B", dimension: "mass", direction: "GT" } });
    expect(contradicts(a, b)).toEqual({ conflict: false, detectable: true, form: "COMPARATIVE", reason: undefined });
  });
});

describe("contradicts — CAUSAL (same cause+effect, opposite sign)", () => {
  it("same cause+effect, opposite sign → conflict OPPOSITE_CAUSAL_SIGN", () => {
    const a = mk({ form: "CAUSAL", structure: { cause: "heat", effect: "rate", sign: "+" } });
    const b = mk({ form: "CAUSAL", structure: { cause: "heat", effect: "rate", sign: "-" } });
    expect(contradicts(a, b)).toEqual({
      conflict: true,
      detectable: true,
      form: "CAUSAL",
      reason: "OPPOSITE_CAUSAL_SIGN",
    });
  });

  it("different cause → no conflict (first condition false)", () => {
    const a = mk({ form: "CAUSAL", structure: { cause: "heat", effect: "rate", sign: "+" } });
    const b = mk({ form: "CAUSAL", structure: { cause: "pressure", effect: "rate", sign: "-" } });
    expect(contradicts(a, b)).toEqual({ conflict: false, detectable: true, form: "CAUSAL", reason: undefined });
  });

  it("same cause, different effect → no conflict (second condition false)", () => {
    const a = mk({ form: "CAUSAL", structure: { cause: "heat", effect: "rate", sign: "+" } });
    const b = mk({ form: "CAUSAL", structure: { cause: "heat", effect: "yield", sign: "-" } });
    expect(contradicts(a, b)).toEqual({ conflict: false, detectable: true, form: "CAUSAL", reason: undefined });
  });

  it("same cause+effect AND same sign → no conflict (third condition false)", () => {
    const a = mk({ form: "CAUSAL", structure: { cause: "heat", effect: "rate", sign: "+" } });
    const b = mk({ form: "CAUSAL", structure: { cause: "heat", effect: "rate", sign: "+" } });
    expect(contradicts(a, b)).toEqual({ conflict: false, detectable: true, form: "CAUSAL", reason: undefined });
  });
});

describe("contradicts — CONDITIONAL (same antecedent, contradictory consequents)", () => {
  it("same antecedent, different consequent → conflict SAME_ANTECEDENT_DIFFERENT_CONSEQUENT", () => {
    const a = mk({ form: "CONDITIONAL", structure: { antecedent: "rain", consequent: "wet" } });
    const b = mk({ form: "CONDITIONAL", structure: { antecedent: "rain", consequent: "dry" } });
    expect(contradicts(a, b)).toEqual({
      conflict: true,
      detectable: true,
      form: "CONDITIONAL",
      reason: "SAME_ANTECEDENT_DIFFERENT_CONSEQUENT",
    });
  });

  it("different antecedent → no conflict (first condition false)", () => {
    const a = mk({ form: "CONDITIONAL", structure: { antecedent: "rain", consequent: "wet" } });
    const b = mk({ form: "CONDITIONAL", structure: { antecedent: "snow", consequent: "dry" } });
    expect(contradicts(a, b)).toEqual({ conflict: false, detectable: true, form: "CONDITIONAL", reason: undefined });
  });

  it("same antecedent AND same consequent → no conflict (second condition false)", () => {
    const a = mk({ form: "CONDITIONAL", structure: { antecedent: "rain", consequent: "wet" } });
    const b = mk({ form: "CONDITIONAL", structure: { antecedent: "rain", consequent: "wet" } });
    expect(contradicts(a, b)).toEqual({ conflict: false, detectable: true, form: "CONDITIONAL", reason: undefined });
  });
});

describe("contradicts — PROBABILISTIC (non-overlapping intervals on same quantity)", () => {
  it("different quantity → no conflict, reason undefined (result(false) short branch)", () => {
    const a = mk({ form: "PROBABILISTIC", structure: { quantity: "mass", interval: [0, 10] } });
    const b = mk({ form: "PROBABILISTIC", structure: { quantity: "length", interval: [50, 60] } });
    expect(contradicts(a, b)).toEqual({ conflict: false, detectable: true, form: "PROBABILISTIC", reason: undefined });
  });

  it("same quantity, OVERLAPPING intervals → no conflict (both overlap operands true)", () => {
    const a = mk({ form: "PROBABILISTIC", structure: { quantity: "q", interval: [0, 10] } });
    const b = mk({ form: "PROBABILISTIC", structure: { quantity: "q", interval: [5, 15] } });
    expect(contradicts(a, b)).toEqual({ conflict: false, detectable: true, form: "PROBABILISTIC", reason: undefined });
  });

  it("same quantity, TOUCHING at a shared endpoint → overlap (boundary), no conflict", () => {
    const a = mk({ form: "PROBABILISTIC", structure: { quantity: "q", interval: [0, 5] } });
    const b = mk({ form: "PROBABILISTIC", structure: { quantity: "q", interval: [5, 10] } });
    // ia[0]=0<=ib[1]=10 AND ib[0]=5<=ia[1]=5 → overlap true → not disjoint
    expect(contradicts(a, b)).toEqual({ conflict: false, detectable: true, form: "PROBABILISTIC", reason: undefined });
  });

  it("same quantity, DISJOINT with a above b (first overlap operand false) → conflict DISJOINT_INTERVALS", () => {
    const a = mk({ form: "PROBABILISTIC", structure: { quantity: "q", interval: [10, 20] } });
    const b = mk({ form: "PROBABILISTIC", structure: { quantity: "q", interval: [0, 5] } });
    // ia[0]=10 <= ib[1]=5 → false → overlap false → disjoint
    expect(contradicts(a, b)).toEqual({
      conflict: true,
      detectable: true,
      form: "PROBABILISTIC",
      reason: "DISJOINT_INTERVALS",
    });
  });

  it("same quantity, DISJOINT with b above a (second overlap operand false) → conflict DISJOINT_INTERVALS", () => {
    const a = mk({ form: "PROBABILISTIC", structure: { quantity: "q", interval: [0, 5] } });
    const b = mk({ form: "PROBABILISTIC", structure: { quantity: "q", interval: [10, 20] } });
    // ia[0]=0<=ib[1]=20 true, but ib[0]=10 <= ia[1]=5 → false → overlap false → disjoint
    expect(contradicts(a, b)).toEqual({
      conflict: true,
      detectable: true,
      form: "PROBABILISTIC",
      reason: "DISJOINT_INTERVALS",
    });
  });

  it("a's interval is NOT an array → NO_INTERVAL, detectable:false (undetectable, NOT a clean pass)", () => {
    const a = mk({ form: "PROBABILISTIC", structure: { quantity: "q", interval: "not-an-array" } });
    const b = mk({ form: "PROBABILISTIC", structure: { quantity: "q", interval: [0, 10] } });
    expect(contradicts(a, b)).toEqual({
      conflict: false,
      detectable: false,
      form: "PROBABILISTIC",
      reason: "NO_INTERVAL",
    });
  });

  it("b's interval missing while a's is valid (!ia false, !ib true) → NO_INTERVAL, detectable:false", () => {
    const a = mk({ form: "PROBABILISTIC", structure: { quantity: "q", interval: [0, 10] } });
    const b = mk({ form: "PROBABILISTIC", structure: { quantity: "q" } }); // interval undefined
    expect(contradicts(a, b)).toEqual({
      conflict: false,
      detectable: false,
      form: "PROBABILISTIC",
      reason: "NO_INTERVAL",
    });
  });

  it("interval() rejects wrong length (length !== 2) → NO_INTERVAL", () => {
    const a = mk({ form: "PROBABILISTIC", structure: { quantity: "q", interval: [1, 2, 3] } });
    const b = mk({ form: "PROBABILISTIC", structure: { quantity: "q", interval: [0, 10] } });
    expect(contradicts(a, b)).toEqual({
      conflict: false,
      detectable: false,
      form: "PROBABILISTIC",
      reason: "NO_INTERVAL",
    });
  });

  it("interval() rejects a non-number lower bound (typeof v[0] !== number) → NO_INTERVAL", () => {
    const a = mk({ form: "PROBABILISTIC", structure: { quantity: "q", interval: ["x", 2] } });
    const b = mk({ form: "PROBABILISTIC", structure: { quantity: "q", interval: [0, 10] } });
    expect(contradicts(a, b)).toEqual({
      conflict: false,
      detectable: false,
      form: "PROBABILISTIC",
      reason: "NO_INTERVAL",
    });
  });

  it("interval() rejects a non-number upper bound (typeof v[1] !== number) → NO_INTERVAL", () => {
    const a = mk({ form: "PROBABILISTIC", structure: { quantity: "q", interval: [1, "y"] } });
    const b = mk({ form: "PROBABILISTIC", structure: { quantity: "q", interval: [0, 10] } });
    expect(contradicts(a, b)).toEqual({
      conflict: false,
      detectable: false,
      form: "PROBABILISTIC",
      reason: "NO_INTERVAL",
    });
  });
});

describe("contradicts — QUANTIFIED (universal vs existential counterexample)", () => {
  it("same domain, different quantifier AND different claim → conflict UNIVERSAL_VS_COUNTEREXAMPLE", () => {
    const a = mk({ form: "QUANTIFIED", structure: { domain: "birds", quantifier: "ALL", claim: "fly" } });
    const b = mk({ form: "QUANTIFIED", structure: { domain: "birds", quantifier: "SOME", claim: "cannot-fly" } });
    expect(contradicts(a, b)).toEqual({
      conflict: true,
      detectable: true,
      form: "QUANTIFIED",
      reason: "UNIVERSAL_VS_COUNTEREXAMPLE",
    });
  });

  it("different domain → no conflict (first condition false)", () => {
    const a = mk({ form: "QUANTIFIED", structure: { domain: "birds", quantifier: "ALL", claim: "fly" } });
    const b = mk({ form: "QUANTIFIED", structure: { domain: "fish", quantifier: "SOME", claim: "cannot-fly" } });
    expect(contradicts(a, b)).toEqual({ conflict: false, detectable: true, form: "QUANTIFIED", reason: undefined });
  });

  it("same domain, same quantifier → no conflict (second condition false)", () => {
    const a = mk({ form: "QUANTIFIED", structure: { domain: "birds", quantifier: "ALL", claim: "fly" } });
    const b = mk({ form: "QUANTIFIED", structure: { domain: "birds", quantifier: "ALL", claim: "cannot-fly" } });
    expect(contradicts(a, b)).toEqual({ conflict: false, detectable: true, form: "QUANTIFIED", reason: undefined });
  });

  it("same domain, different quantifier BUT same claim → no conflict (third condition false)", () => {
    const a = mk({ form: "QUANTIFIED", structure: { domain: "birds", quantifier: "ALL", claim: "fly" } });
    const b = mk({ form: "QUANTIFIED", structure: { domain: "birds", quantifier: "SOME", claim: "fly" } });
    expect(contradicts(a, b)).toEqual({ conflict: false, detectable: true, form: "QUANTIFIED", reason: undefined });
  });
});

describe("contradicts — defensive default (unknown form)", () => {
  it("an unrecognised form is EXPLICITLY UNDETECTABLE, not silently conflict-free", () => {
    // hostile input: a form outside the closed StatementForm union reaches the switch default
    const weird = "TELEPATHIC" as unknown as StatementForm;
    const a = mk({ form: weird });
    const b = mk({ form: weird });
    expect(contradicts(a, b)).toEqual({
      conflict: false,
      detectable: false,
      form: weird,
      reason: "FORM_UNDETECTABLE",
    });
  });
});

describe("anyContradiction — blocks promotion if ANY higher-trust statement conflicts (§14.3)", () => {
  const candidate = mk({ subjectId: "water", predicate: "boilsAt", objectId: "100C" });

  it("empty higher-trust set → false (nothing to conflict with)", () => {
    expect(anyContradiction(candidate, [])).toBe(false);
  });

  it("a single conflicting higher-trust statement → true", () => {
    const conflicting = mk({ subjectId: "water", predicate: "boilsAt", objectId: "90C" });
    expect(anyContradiction(candidate, [conflicting])).toBe(true);
  });

  it("higher-trust statements that all agree → false", () => {
    const agree1 = mk({ subjectId: "water", predicate: "boilsAt", objectId: "100C" }); // same object, no conflict
    const agree2 = mk({ subjectId: "ethanol", predicate: "boilsAt", objectId: "78C" }); // different subject, no conflict
    expect(anyContradiction(candidate, [agree1, agree2])).toBe(false);
  });

  it("first agrees, a LATER one conflicts → true (some() must scan past the first)", () => {
    const agree = mk({ subjectId: "water", predicate: "boilsAt", objectId: "100C" });
    const conflicting = mk({ subjectId: "water", predicate: "boilsAt", objectId: "80C" });
    expect(anyContradiction(candidate, [agree, conflicting])).toBe(true);
  });
});
