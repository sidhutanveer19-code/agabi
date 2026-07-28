import { describe, it, expect } from "vitest";
import {
  ASSET_KINDS,
  assetKind,
  capabilitiesOf,
  hasCapability,
  validateAssetPayload,
  type AssetCapability,
} from "@/server/knowledge/teaching/registry";
import { misconceptionKind } from "@/server/knowledge/teaching/kinds/misconception";
import { analogyKind } from "@/server/knowledge/teaching/kinds/analogy";
import { workedExampleKind } from "@/server/knowledge/teaching/kinds/workedExample";

/**
 * §13.2/§18C.1 teaching-asset registry. These tests pin the exported surface of registry.ts:
 * the three registered kinds, the lookup (`assetKind`), the capability primitives
 * (`capabilitiesOf`, `hasCapability`), and the payload-validation dispatcher
 * (`validateAssetPayload`). Every branch is driven from both sides: known vs unknown kind,
 * present vs nullish capability list, capability present vs absent, and the unknown-kind
 * discard vs a real delegated verdict. Values are asserted exactly so a mutant that swaps a
 * kind, drops the `?? []` fallback, flips `!def`, or corrupts the reason string dies here.
 */

describe("ASSET_KINDS", () => {
  it("lists exactly the three Phase-2 kinds in registration order (D6)", () => {
    expect(ASSET_KINDS).toEqual(["MISCONCEPTION", "ANALOGY", "WORKED_EXAMPLE"]);
  });

  it("contains exactly three entries with no duplicates", () => {
    expect(ASSET_KINDS).toHaveLength(3);
    expect(new Set(ASSET_KINDS).size).toBe(3);
  });
});

describe("assetKind", () => {
  it("returns the misconception descriptor for MISCONCEPTION", () => {
    expect(assetKind("MISCONCEPTION")).toBe(misconceptionKind);
  });

  it("returns the analogy descriptor for ANALOGY", () => {
    expect(assetKind("ANALOGY")).toBe(analogyKind);
  });

  it("returns the worked-example descriptor for WORKED_EXAMPLE", () => {
    expect(assetKind("WORKED_EXAMPLE")).toBe(workedExampleKind);
  });

  it("returns undefined for an unregistered kind", () => {
    expect(assetKind("NOPE")).toBeUndefined();
  });

  it("returns undefined for the empty-string kind", () => {
    expect(assetKind("")).toBeUndefined();
  });

  it("reflects that a plain object lookup reaches Object.prototype keys (documented reality, no guard)", () => {
    // registry.ts uses a bare `REGISTRY[kind]`, so inherited prototype keys resolve to the
    // Object internals rather than undefined. Real callers only ever pass genuine kind strings
    // (validated upstream), but this pins the ACTUAL behavior so a false "guarded" claim can't
    // hide here. None of these are AssetKindDef descriptors.
    expect(assetKind("toString")).toBe(Object.prototype.toString);
    expect(assetKind("constructor")).toBe(Object);
    expect(assetKind("hasOwnProperty")).toBe(Object.prototype.hasOwnProperty);
  });
});

describe("capabilitiesOf", () => {
  it("returns the exact capability list for MISCONCEPTION", () => {
    expect(capabilitiesOf("MISCONCEPTION")).toEqual(["corrective"]);
  });

  it("returns the exact capability list for ANALOGY (order preserved)", () => {
    expect(capabilitiesOf("ANALOGY")).toEqual(["analogical", "explanatory"]);
  });

  it("returns the exact capability list for WORKED_EXAMPLE", () => {
    expect(capabilitiesOf("WORKED_EXAMPLE")).toEqual(["demonstrable"]);
  });

  it("returns the descriptor's own capabilities array by reference for a known kind", () => {
    // Kills a mutant that replaces the found value with a fresh/other array.
    expect(capabilitiesOf("ANALOGY")).toBe(analogyKind.capabilities);
  });

  it("falls back to an empty array for an unknown kind", () => {
    // Drives the `?? []` fallback (left side nullish). A dropped fallback would yield
    // undefined and fail toEqual; a non-empty fallback would fail the length check.
    const caps = capabilitiesOf("NOPE");
    expect(caps).toEqual([]);
    expect(caps).toHaveLength(0);
  });

  it("returns an empty array for the empty-string kind", () => {
    expect(capabilitiesOf("")).toEqual([]);
  });
});

describe("hasCapability", () => {
  it("is true when the kind declares the capability (MISCONCEPTION/corrective)", () => {
    expect(hasCapability("MISCONCEPTION", "corrective")).toBe(true);
  });

  it("is true for each capability an analogy declares", () => {
    expect(hasCapability("ANALOGY", "analogical")).toBe(true);
    expect(hasCapability("ANALOGY", "explanatory")).toBe(true);
  });

  it("is true for WORKED_EXAMPLE/demonstrable", () => {
    expect(hasCapability("WORKED_EXAMPLE", "demonstrable")).toBe(true);
  });

  it("is false when a known kind lacks the queried capability", () => {
    expect(hasCapability("MISCONCEPTION", "explanatory")).toBe(false);
    expect(hasCapability("ANALOGY", "corrective")).toBe(false);
    expect(hasCapability("WORKED_EXAMPLE", "analogical")).toBe(false);
  });

  it("is false for an unknown kind (empty capability list includes nothing)", () => {
    expect(hasCapability("NOPE", "corrective")).toBe(false);
  });

  it("is false when a made-up capability is queried on a real kind", () => {
    expect(hasCapability("ANALOGY", "nonsense" as AssetCapability)).toBe(false);
  });
});

describe("validateAssetPayload — unknown kind (the !def branch)", () => {
  it("discards with a kind-interpolated reason for an unregistered kind", () => {
    expect(validateAssetPayload("FOO", { anything: 1 })).toEqual({
      validator: "V2",
      outcome: "discard",
      reason: "UNKNOWN_ASSET_KIND_FOO",
    });
  });

  it("interpolates a different unknown kind into the reason (kills a hard-coded suffix)", () => {
    expect(validateAssetPayload("BAR", {}).reason).toBe("UNKNOWN_ASSET_KIND_BAR");
  });

  it("interpolates the empty string when the kind is empty", () => {
    expect(validateAssetPayload("", {}).reason).toBe("UNKNOWN_ASSET_KIND_");
  });

  it("does not attach detail or securityAlert on the unknown-kind discard", () => {
    const result = validateAssetPayload("FOO", {});
    expect(result.detail).toBeUndefined();
    expect(result.securityAlert).toBeUndefined();
  });
});

describe("validateAssetPayload — delegates to the kind validator (the known branch)", () => {
  it("passes a well-formed MISCONCEPTION payload through V2", () => {
    expect(
      validateAssetPayload("MISCONCEPTION", {
        misconception: "plants eat sunlight",
        correction: "they convert it via photosynthesis",
      }),
    ).toEqual({ validator: "V2", outcome: "pass" });
  });

  it("returns the MISCONCEPTION kind's own discard verdict, not the unknown-kind one", () => {
    // Proves the payload actually reaches misconceptionKind.validate rather than short-circuiting.
    expect(validateAssetPayload("MISCONCEPTION", { misconception: "x" })).toEqual({
      validator: "V2",
      outcome: "discard",
      reason: "MISCONCEPTION_NEEDS_MISCONCEPTION_AND_CORRECTION",
    });
  });

  it("passes a well-formed WORKED_EXAMPLE payload through V2", () => {
    expect(
      validateAssetPayload("WORKED_EXAMPLE", {
        problem: "2 + 2 = ?",
        steps: ["add the digits"],
        answer: "4",
      }),
    ).toEqual({ validator: "V2", outcome: "pass" });
  });

  it("returns the WORKED_EXAMPLE kind's discard verdict for a missing-steps payload", () => {
    expect(
      validateAssetPayload("WORKED_EXAMPLE", { problem: "p", answer: "a" }),
    ).toEqual({
      validator: "V2",
      outcome: "discard",
      reason: "WORKED_EXAMPLE_NEEDS_PROBLEM_STEPS_ANSWER",
    });
  });

  it("passes an ANALOGY with a breakdown point through V14", () => {
    expect(
      validateAssetPayload("ANALOGY", {
        source: "water in a pipe",
        mapping: "current is flow",
        breakdownPoint: "fails at capacitance",
      }),
    ).toEqual({ validator: "V14", outcome: "pass" });
  });

  it("discards an ANALOGY missing its breakdown point via the V14 gate", () => {
    expect(
      validateAssetPayload("ANALOGY", { source: "s", mapping: "m" }),
    ).toEqual({
      validator: "V14",
      outcome: "discard",
      reason: "ANALOGY_MISSING_BREAKDOWN_POINT",
    });
  });

  it("discards an ANALOGY missing source/mapping via the V2 pre-check", () => {
    expect(
      validateAssetPayload("ANALOGY", { breakdownPoint: "somewhere" }),
    ).toEqual({
      validator: "V2",
      outcome: "discard",
      reason: "ANALOGY_NEEDS_SOURCE_AND_MAPPING",
    });
  });
});

/**
 * Extended coverage (registry.cov.test.ts additions). These strengthen mutation resistance on
 * registry.ts itself: registry-swap mutants die on the iterated invariants, key-transform
 * mutants (lower/upper/trim) die on the case-sensitivity block, and a mutant that drops the
 * `payload` argument to `def.validate` dies on the forwarding proof.
 */

describe("registry structural invariants (iterated over ASSET_KINDS)", () => {
  it("every registered key maps to a descriptor whose own `kind` equals that key", () => {
    // A swap mutant (e.g. filing analogyKind under MISCONCEPTION) breaks this identity:
    // the descriptor's self-declared kind would no longer match the key it is stored under.
    for (const key of ASSET_KINDS) {
      expect(assetKind(key)?.kind).toBe(key);
    }
  });

  it("every ASSET_KINDS entry round-trips to a defined descriptor", () => {
    expect(ASSET_KINDS.every((k) => assetKind(k) !== undefined)).toBe(true);
  });

  it("every registered descriptor exposes a non-empty capabilities array", () => {
    for (const key of ASSET_KINDS) {
      const caps = capabilitiesOf(key);
      expect(Array.isArray(caps)).toBe(true);
      expect(caps.length).toBeGreaterThan(0);
    }
  });

  it("every registered descriptor exposes a non-empty requiredPayloadFields array", () => {
    for (const key of ASSET_KINDS) {
      const def = assetKind(key)!;
      expect(Array.isArray(def.requiredPayloadFields)).toBe(true);
      expect(def.requiredPayloadFields.length).toBeGreaterThan(0);
    }
  });
});

describe("assetKind — full descriptor surface pinned exactly", () => {
  it("MISCONCEPTION descriptor: kind, capabilities, and required fields", () => {
    const def = assetKind("MISCONCEPTION")!;
    expect(def.kind).toBe("MISCONCEPTION");
    expect(def.capabilities).toEqual(["corrective"]);
    expect(def.requiredPayloadFields).toEqual(["misconception", "correction"]);
  });

  it("ANALOGY descriptor: kind, capabilities (order preserved), and required fields", () => {
    const def = assetKind("ANALOGY")!;
    expect(def.kind).toBe("ANALOGY");
    expect(def.capabilities).toEqual(["analogical", "explanatory"]);
    expect(def.requiredPayloadFields).toEqual(["source", "mapping", "breakdownPoint"]);
  });

  it("WORKED_EXAMPLE descriptor: kind, capabilities, and required fields", () => {
    const def = assetKind("WORKED_EXAMPLE")!;
    expect(def.kind).toBe("WORKED_EXAMPLE");
    expect(def.capabilities).toEqual(["demonstrable"]);
    expect(def.requiredPayloadFields).toEqual(["problem", "steps", "answer"]);
  });
});

describe("kind lookups are case-sensitive and not trimmed", () => {
  it("assetKind does not resolve a lower-cased or differently-cased kind", () => {
    expect(assetKind("misconception")).toBeUndefined();
    expect(assetKind("Analogy")).toBeUndefined();
    expect(assetKind("worked_example")).toBeUndefined();
  });

  it("assetKind does not resolve a whitespace-padded kind", () => {
    expect(assetKind(" MISCONCEPTION ")).toBeUndefined();
    expect(assetKind("ANALOGY\n")).toBeUndefined();
  });

  it("capabilitiesOf returns [] for a case-mismatched kind", () => {
    expect(capabilitiesOf("analogy")).toEqual([]);
  });

  it("hasCapability is false for a case-mismatched kind", () => {
    expect(hasCapability("misconception", "corrective")).toBe(false);
  });

  it("validateAssetPayload treats a case-mismatched kind as unknown and echoes it verbatim", () => {
    expect(
      validateAssetPayload("misconception", { misconception: "x", correction: "y" }),
    ).toEqual({
      validator: "V2",
      outcome: "discard",
      reason: "UNKNOWN_ASSET_KIND_misconception",
    });
  });
});

describe("hasCapability is consistent with capabilitiesOf for every registered kind", () => {
  it("is true for each declared capability and false for an undeclared one", () => {
    for (const key of ASSET_KINDS) {
      for (const cap of capabilitiesOf(key)) {
        expect(hasCapability(key, cap)).toBe(true);
      }
      // A capability no kind declares must never be reported present.
      expect(hasCapability(key, "__undeclared__" as AssetCapability)).toBe(false);
    }
  });

  it("does not leak a capability across kinds (each kind's set is distinct)", () => {
    // MISCONCEPTION is corrective-only; ANALOGY is analogical/explanatory; WORKED_EXAMPLE is
    // demonstrable-only. A cross-wiring mutant that shares one array would fail one of these.
    expect(hasCapability("MISCONCEPTION", "demonstrable")).toBe(false);
    expect(hasCapability("MISCONCEPTION", "analogical")).toBe(false);
    expect(hasCapability("WORKED_EXAMPLE", "corrective")).toBe(false);
    expect(hasCapability("WORKED_EXAMPLE", "explanatory")).toBe(false);
    expect(hasCapability("ANALOGY", "demonstrable")).toBe(false);
  });
});

describe("validateAssetPayload forwards the exact payload to the kind validator", () => {
  // Each asserts the dispatcher's verdict equals the kind's own verdict for the SAME payload —
  // so a mutant that passes `{}` (or any other object) to `def.validate` diverges and dies.
  it("matches misconceptionKind.validate for a partial MISCONCEPTION payload", () => {
    const payload = { misconception: "only this" };
    expect(validateAssetPayload("MISCONCEPTION", payload)).toEqual(
      misconceptionKind.validate(payload),
    );
  });

  it("matches analogyKind.validate for a fully-formed ANALOGY payload", () => {
    const payload = { source: "s", mapping: "m", breakdownPoint: "b" };
    expect(validateAssetPayload("ANALOGY", payload)).toEqual(analogyKind.validate(payload));
  });

  it("matches workedExampleKind.validate for a non-array `steps` payload", () => {
    const payload = { problem: "p", steps: "not-an-array", answer: "a" };
    expect(validateAssetPayload("WORKED_EXAMPLE", payload)).toEqual(
      workedExampleKind.validate(payload),
    );
  });
});

describe("validateAssetPayload — delegated edge payloads", () => {
  it("passes a MISCONCEPTION carrying extra keys beyond the required two", () => {
    expect(
      validateAssetPayload("MISCONCEPTION", {
        misconception: "m",
        correction: "c",
        extra: 42,
        note: "ignored",
      }),
    ).toEqual({ validator: "V2", outcome: "pass" });
  });

  it("discards a MISCONCEPTION whose required fields are whitespace-only", () => {
    expect(
      validateAssetPayload("MISCONCEPTION", { misconception: "   ", correction: "\t" }),
    ).toEqual({
      validator: "V2",
      outcome: "discard",
      reason: "MISCONCEPTION_NEEDS_MISCONCEPTION_AND_CORRECTION",
    });
  });

  it("discards a WORKED_EXAMPLE whose steps array is empty", () => {
    expect(
      validateAssetPayload("WORKED_EXAMPLE", { problem: "p", steps: [], answer: "a" }),
    ).toEqual({
      validator: "V2",
      outcome: "discard",
      reason: "WORKED_EXAMPLE_NEEDS_PROBLEM_STEPS_ANSWER",
    });
  });

  it("discards an ANALOGY whose breakdownPoint is whitespace-only via the V14 gate", () => {
    expect(
      validateAssetPayload("ANALOGY", { source: "s", mapping: "m", breakdownPoint: "   " }),
    ).toEqual({
      validator: "V14",
      outcome: "discard",
      reason: "ANALOGY_MISSING_BREAKDOWN_POINT",
    });
  });
});
