import { describe, it, expect } from "vitest";
import type { RawStatement, RawEntity } from "@/server/knowledge/extraction/types";
import type { ContextDimension, DimensionRegistry } from "@/server/knowledge/context/registry";
import {
  v2Kind,
  v6EntityResolution,
  v11ContextValidity,
  v12Units,
  v14AnalogyBreakdown,
  v15SelfReference,
} from "@/server/knowledge/validators/structure";

/**
 * §H1 mutation-grade coverage for the structural/registry gates (§14). Every exported
 * function, every branch (both sides of each if/ternary/||/&&, each early return), and the
 * exact outcome + reason string are asserted so a mutated operator or flipped literal goes
 * red. Hostile / malformed input (empty, whitespace, wrong type, undefined, boundary-equal)
 * is exercised on purpose (§C.23 treat external input as untrusted, §D.13 falsification).
 */

// A registered-key registry; the ContextDimension bodies are irrelevant to V11 (it only
// checks key membership + the validFrom/validUntil ordering), so an empty cast is honest.
const dim = {} as ContextDimension;

function stmt(over: Partial<RawStatement> = {}): RawStatement {
  return {
    form: "SPO",
    kind: "FACT",
    text: "Plants turn sunlight into stored chemical energy.",
    quote: "converts light energy into chemical energy",
    structure: { subjectId: "photosynthesis", predicate: "converts", objectId: "energy" },
    subject: "photosynthesis",
    predicate: "converts",
    object: "energy",
    ...over,
  };
}

describe("v2Kind (V2 — payload/kind registered)", () => {
  it.each(["FACT", "PROCEDURE", "PRINCIPLE", "RULE", "DEFINITION", "RELATIONSHIP"])(
    "passes the registered kind %s",
    (kind) => {
      const r = v2Kind(stmt({ kind }));
      expect(r).toEqual({ validator: "V2", outcome: "pass" });
    },
  );

  it("discards an unregistered kind and names it in the reason", () => {
    const r = v2Kind(stmt({ kind: "VIBES" }));
    expect(r.validator).toBe("V2");
    expect(r.outcome).toBe("discard");
    expect(r.reason).toBe("UNKNOWN_KIND_VIBES");
  });

  it("discards an empty-string kind (boundary: empty is not registered)", () => {
    const r = v2Kind(stmt({ kind: "" }));
    expect(r.outcome).toBe("discard");
    expect(r.reason).toBe("UNKNOWN_KIND_");
  });

  it("is case-sensitive: lowercase 'fact' is unregistered", () => {
    const r = v2Kind(stmt({ kind: "fact" }));
    expect(r.outcome).toBe("discard");
    expect(r.reason).toBe("UNKNOWN_KIND_fact");
  });
});

describe("v6EntityResolution (V6 — resolve or flag as new)", () => {
  const entity: RawEntity = { name: "Ohm's Law" };

  it("passes when the name resolves", () => {
    const r = v6EntityResolution(entity, () => true);
    expect(r).toEqual({ validator: "V6", outcome: "pass" });
  });

  it("flags an unresolved name as NEW_ENTITY and carries the name as detail", () => {
    const r = v6EntityResolution(entity, () => false);
    expect(r.validator).toBe("V6");
    expect(r.outcome).toBe("flag");
    expect(r.reason).toBe("NEW_ENTITY");
    expect(r.detail).toBe("Ohm's Law");
  });

  it("calls the resolver with the entity's own name (not some other string)", () => {
    const seen: string[] = [];
    const resolves = (name: string) => {
      seen.push(name);
      return name === "Ohm's Law";
    };
    expect(v6EntityResolution(entity, resolves).outcome).toBe("pass");
    expect(v6EntityResolution({ name: "Nonesuch" }, resolves).outcome).toBe("flag");
    expect(seen).toEqual(["Ohm's Law", "Nonesuch"]);
  });
});

describe("v11ContextValidity (V11 — dimensions registered + valid interval)", () => {
  const registry: DimensionRegistry = {
    jurisdiction: dim,
    validFrom: dim,
    validUntil: dim,
  };

  it("passes when dimensions is undefined (early return, loop never runs)", () => {
    expect(v11ContextValidity(undefined, registry)).toEqual({ validator: "V11", outcome: "pass" });
  });

  it("passes an empty dimensions object (no keys, no interval)", () => {
    expect(v11ContextValidity({}, registry)).toEqual({ validator: "V11", outcome: "pass" });
  });

  it("passes a registered dimension key", () => {
    expect(v11ContextValidity({ jurisdiction: "IN" }, registry).outcome).toBe("pass");
  });

  it("discards an unregistered dimension key and names it", () => {
    const r = v11ContextValidity({ madeUp: "x" }, registry);
    expect(r.validator).toBe("V11");
    expect(r.outcome).toBe("discard");
    expect(r.reason).toBe("UNREGISTERED_DIMENSION_madeUp");
  });

  it("passes when validFrom is strictly before validUntil", () => {
    const r = v11ContextValidity({ validFrom: "2020-01-01", validUntil: "2021-01-01" }, registry);
    expect(r.outcome).toBe("pass");
  });

  it("discards when validFrom is AFTER validUntil", () => {
    const r = v11ContextValidity({ validFrom: "2021-01-01", validUntil: "2020-01-01" }, registry);
    expect(r.outcome).toBe("discard");
    expect(r.reason).toBe("VALID_FROM_NOT_BEFORE_UNTIL");
  });

  it("discards when validFrom EQUALS validUntil (boundary: >= not >)", () => {
    const r = v11ContextValidity({ validFrom: "2020-01-01", validUntil: "2020-01-01" }, registry);
    expect(r.outcome).toBe("discard");
    expect(r.reason).toBe("VALID_FROM_NOT_BEFORE_UNTIL");
  });

  it("ignores the interval check when validUntil is not a string", () => {
    // both keys registered so the loop passes; validUntil is a number so the typeof guard
    // short-circuits and the pair is NOT treated as an inverted interval.
    const r = v11ContextValidity({ validFrom: "2020-01-01", validUntil: 20200101 }, registry);
    expect(r.outcome).toBe("pass");
  });

  it("ignores the interval check when validFrom is not a string", () => {
    const r = v11ContextValidity({ validFrom: 20210101, validUntil: "2020-01-01" }, registry);
    expect(r.outcome).toBe("pass");
  });

  it("checks registration BEFORE the interval (unregistered key wins over bad interval)", () => {
    const r = v11ContextValidity(
      { validFrom: "2021-01-01", validUntil: "2020-01-01", rogue: "z" },
      registry,
    );
    expect(r.outcome).toBe("discard");
    expect(r.reason).toBe("UNREGISTERED_DIMENSION_rogue");
  });
});

describe("v12Units (V12 — declared value/unit disagreement)", () => {
  it("flags a unit that disagrees with expectedUnit, naming both", () => {
    const r = v12Units(stmt({ structure: { unit: "m", expectedUnit: "s" } }));
    expect(r.validator).toBe("V12");
    expect(r.outcome).toBe("flag");
    expect(r.reason).toBe("UNIT_MISMATCH_m_vs_s");
  });

  it("passes when unit equals expectedUnit", () => {
    const r = v12Units(stmt({ structure: { unit: "m", expectedUnit: "m" } }));
    expect(r).toEqual({ validator: "V12", outcome: "pass" });
  });

  it("passes when expectedUnit is absent (nothing to disagree with)", () => {
    expect(v12Units(stmt({ structure: { unit: "m" } })).outcome).toBe("pass");
  });

  it("passes when unit is absent", () => {
    expect(v12Units(stmt({ structure: { expectedUnit: "m" } })).outcome).toBe("pass");
  });

  it("passes when unit is present but not a string (number)", () => {
    expect(v12Units(stmt({ structure: { unit: 5, expectedUnit: "m" } })).outcome).toBe("pass");
  });

  it("passes when expectedUnit is present but not a string (number)", () => {
    expect(v12Units(stmt({ structure: { unit: "m", expectedUnit: 5 } })).outcome).toBe("pass");
  });

  it("passes on an empty structure (no unit fields at all)", () => {
    expect(v12Units(stmt({ structure: {} })).outcome).toBe("pass");
  });

  it("passes (does not throw) when structure itself is missing", () => {
    // defensive `s &&` guard: malformed input must not blow up the gate (§C.23).
    const bad = stmt({ structure: undefined as unknown as Record<string, unknown> });
    expect(v12Units(bad)).toEqual({ validator: "V12", outcome: "pass" });
  });
});

describe("v14AnalogyBreakdown (V14 — analogy must state where it breaks)", () => {
  it("passes a non-analogy asset untouched (WORKED_EXAMPLE)", () => {
    const r = v14AnalogyBreakdown({ kind: "WORKED_EXAMPLE", payload: {} });
    expect(r).toEqual({ validator: "V14", outcome: "pass" });
  });

  it("passes a non-analogy asset untouched (MISCONCEPTION)", () => {
    expect(v14AnalogyBreakdown({ kind: "MISCONCEPTION", payload: {} }).outcome).toBe("pass");
  });

  it("passes an analogy with a real breakdown point", () => {
    const r = v14AnalogyBreakdown({ kind: "ANALOGY", payload: { breakdownPoint: "breaks at capacitance" } });
    expect(r.outcome).toBe("pass");
  });

  it("discards an analogy with NO breakdown point", () => {
    const r = v14AnalogyBreakdown({ kind: "ANALOGY", payload: {} });
    expect(r.validator).toBe("V14");
    expect(r.outcome).toBe("discard");
    expect(r.reason).toBe("ANALOGY_MISSING_BREAKDOWN_POINT");
  });

  it("discards an analogy whose breakdown point is an empty string", () => {
    const r = v14AnalogyBreakdown({ kind: "ANALOGY", payload: { breakdownPoint: "" } });
    expect(r.outcome).toBe("discard");
    expect(r.reason).toBe("ANALOGY_MISSING_BREAKDOWN_POINT");
  });

  it("discards an analogy whose breakdown point is only whitespace (trim → empty)", () => {
    const r = v14AnalogyBreakdown({ kind: "ANALOGY", payload: { breakdownPoint: "   \t\n" } });
    expect(r.outcome).toBe("discard");
    expect(r.reason).toBe("ANALOGY_MISSING_BREAKDOWN_POINT");
  });

  it("discards an analogy whose breakdown point is not a string (number)", () => {
    const r = v14AnalogyBreakdown({ kind: "ANALOGY", payload: { breakdownPoint: 42 } });
    expect(r.outcome).toBe("discard");
    expect(r.reason).toBe("ANALOGY_MISSING_BREAKDOWN_POINT");
  });

  it("discards (does not throw) when an analogy's payload is null", () => {
    // optional-chaining guard on payload: malformed asset still resolves to a clean discard.
    const bad = { kind: "ANALOGY", payload: null as unknown as Record<string, unknown> };
    const r = v14AnalogyBreakdown(bad);
    expect(r.outcome).toBe("discard");
    expect(r.reason).toBe("ANALOGY_MISSING_BREAKDOWN_POINT");
  });
});

describe("v15SelfReference (V15 — SPO subject ≠ object)", () => {
  it("passes a non-SPO statement without inspecting subject/object", () => {
    const r = v15SelfReference(stmt({ form: "CONDITIONAL", subject: "x", object: "x" }));
    expect(r).toEqual({ validator: "V15", outcome: "pass" });
  });

  it("passes an SPO whose subject and object differ", () => {
    expect(v15SelfReference(stmt({ subject: "a", object: "b" })).outcome).toBe("pass");
  });

  it("discards an SPO whose subject equals object", () => {
    const r = v15SelfReference(stmt({ subject: "x", object: "x" }));
    expect(r.validator).toBe("V15");
    expect(r.outcome).toBe("discard");
    expect(r.reason).toBe("SUBJECT_EQUALS_OBJECT");
  });

  it("falls back to structure.subjectId / structure.objectId when the flat fields are absent", () => {
    const r = v15SelfReference(
      stmt({ subject: undefined, object: undefined, structure: { subjectId: "z", objectId: "z" } }),
    );
    expect(r.outcome).toBe("discard");
    expect(r.reason).toBe("SUBJECT_EQUALS_OBJECT");
  });

  it("passes when the structure fallbacks differ", () => {
    const r = v15SelfReference(
      stmt({ subject: undefined, object: undefined, structure: { subjectId: "a", objectId: "b" } }),
    );
    expect(r.outcome).toBe("pass");
  });

  it("prefers the flat subject over structure.subjectId, and object falls back to objectId", () => {
    // subject='a' (flat) beats subjectId='b'; object is absent so it falls back to objectId='a'
    // → both resolve to 'a' → self-reference. Proves the ?? picks the right operand each side.
    const r = v15SelfReference(
      stmt({ subject: "a", object: undefined, structure: { subjectId: "b", objectId: "a" } }),
    );
    expect(r.outcome).toBe("discard");
    expect(r.reason).toBe("SUBJECT_EQUALS_OBJECT");
  });

  it("passes an SPO with no subject/object resolvable at all (guard blocks a false self-ref)", () => {
    // Both flat fields and both structure ids undefined → subj & obj are undefined. Without the
    // `subj && obj` guard, `undefined === undefined` would falsely discard; it must PASS.
    const r = v15SelfReference(
      stmt({ subject: undefined, object: undefined, structure: { predicate: "converts" } }),
    );
    expect(r.outcome).toBe("pass");
  });

  it("passes when only the subject side resolves (object undefined)", () => {
    const r = v15SelfReference(
      stmt({ subject: "a", object: undefined, structure: {} }),
    );
    expect(r.outcome).toBe("pass");
  });
});
