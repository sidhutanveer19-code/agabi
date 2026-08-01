import { describe, it, expect } from "vitest";
import type { RawStatement, RawDependency } from "@/server/knowledge/extraction/types";
import type { DependencyEdge, CompositionEdge } from "@/server/knowledge/types";
import type { ContextDimension } from "@/server/knowledge/context/registry";
import type { ValidationResult, Outcome } from "@/server/knowledge/validators/types";
import type { StatementCtx, DependencyCtx } from "@/server/knowledge/validators/index";
import {
  validateStatement,
  validateAsset,
  validateDependency,
  summarise,
  validatorsPass,
  hasSecurityAlert,
  v13Scope,
  n,
} from "@/server/knowledge/validators/index";

/**
 * HARD unit test for the validation RUNNER (`validators/index.ts`) — the orchestration
 * that decides which gates apply to a proposal and folds their outcomes into a
 * `BatchStatus`. This targets index.ts's OWN branching, not the individual gates
 * (those are covered in validators.test.ts, which this file does not touch):
 *   - validateDependency's REQUIRES / PART_OF / REINFORCEMENT arms (which gates get run),
 *   - summarise's reject-vs-discard `||` and its reject > human > flag > pass precedence,
 *   - validatorsPass / hasSecurityAlert over pass, non-pass, alert and EMPTY inputs.
 *
 * index.ts reaches NO I/O boundary — it is pure logic over in-memory proposals and pure
 * validator functions (no prisma/db/network/clock is transitively reachable). Per §H1.7
 * ("fake ONLY at the I/O edge") there is nothing to stub: every gate runs for real against
 * hostile input, and each path is asserted by its EXACT ValidationResult / BatchStatus,
 * never "did not throw" (§H1.2).
 */

const CHUNK = "Photosynthesis converts light energy into chemical energy stored in glucose.";
const REGISTRY: Record<string, ContextDimension> = { jurisdiction: {} as ContextDimension };

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

function depEdge(fromId: string, toId: string): DependencyEdge {
  return { fromId, toId, strength: 1, contextId: null, version: 1, supersedes: null };
}
function compEdge(partId: string, wholeId: string): CompositionEdge {
  return { partId, wholeId, ordinal: null, version: 1 };
}
/** A synthetic gate result, for driving summarise/validatorsPass/hasSecurityAlert directly. */
function R(outcome: Outcome, over: Partial<ValidationResult> = {}): ValidationResult {
  return { validator: "Vx", outcome, ...over };
}

describe("validateStatement — runs every applicable gate, in gate order", () => {
  it("a clean statement yields EXACTLY the 7 gate passes, with V3's char range", () => {
    const ctx: StatementCtx = { chunkText: CHUNK, registry: REGISTRY };
    const results = validateStatement(stmt(), ctx);

    // The quote begins right after "photosynthesis " (15 chars) and is 42 chars long.
    expect(results).toEqual([
      { validator: "V2", outcome: "pass" },
      { validator: "V3", outcome: "pass", detail: [15, 57] },
      { validator: "V4", outcome: "pass" },
      { validator: "V5", outcome: "pass" },
      { validator: "V11", outcome: "pass" },
      { validator: "V12", outcome: "pass" },
      { validator: "V15", outcome: "pass" },
    ]);

    // Independently prove the asserted range is the real span of the normalised quote.
    expect(n(CHUNK).slice(15, 57)).toBe(n("converts light energy into chemical energy"));

    expect(summarise(results)).toBe("AUTO_VALIDATED");
    expect(validatorsPass(results)).toBe(true);
    expect(hasSecurityAlert(results)).toBe(false);
  });

  it("a fabricated quote is forwarded as a V3 discard → whole statement REJECTED", () => {
    const ctx: StatementCtx = { chunkText: CHUNK, registry: REGISTRY };
    const results = validateStatement(stmt({ quote: "plants literally eat the sun for breakfast" }), ctx);

    expect(results[1]).toEqual({ validator: "V3", outcome: "discard", reason: "QUOTE_NOT_IN_SOURCE" });
    expect(summarise(results)).toBe("REJECTED");
    expect(validatorsPass(results)).toBe(false);
    expect(hasSecurityAlert(results)).toBe(false);
  });

  it("a text that copies the source flags (V5) but nothing worse → FLAGGED, not auto-validated", () => {
    const ctx: StatementCtx = { chunkText: CHUNK, registry: REGISTRY };
    const results = validateStatement(stmt({ text: "converts light energy" }), ctx);

    expect(results[3]).toEqual({ validator: "V5", outcome: "flag", reason: "TEXT_COPIES_SOURCE" });
    expect(summarise(results)).toBe("FLAGGED");
    expect(validatorsPass(results)).toBe(false);
  });
});

describe("validateAsset — only V14 (analogy breakdown) applies", () => {
  it("an ANALOGY with a breakdown point passes cleanly", () => {
    const results = validateAsset({ kind: "ANALOGY", payload: { breakdownPoint: "breaks at high current" } });
    expect(results).toEqual([{ validator: "V14", outcome: "pass" }]);
    expect(summarise(results)).toBe("AUTO_VALIDATED");
  });

  it("an ANALOGY with no breakdown point is DISCARDED (installs a misconception, §13.3)", () => {
    const results = validateAsset({ kind: "ANALOGY", payload: {} });
    expect(results).toEqual([{ validator: "V14", outcome: "discard", reason: "ANALOGY_MISSING_BREAKDOWN_POINT" }]);
    expect(summarise(results)).toBe("REJECTED");
  });

  it("a non-analogy asset skips the breakdown requirement (V14 passes)", () => {
    const results = validateAsset({ kind: "WORKED_EXAMPLE", payload: {} });
    expect(results).toEqual([{ validator: "V14", outcome: "pass" }]);
    expect(summarise(results)).toBe("AUTO_VALIDATED");
  });
});

describe("validateDependency — classification decides which gates run (V9 is ALWAYS present)", () => {
  it("REQUIRES with no cycle → V9(human) + V7(pass) + V10(pass) → NEEDS_HUMAN", () => {
    const dep: RawDependency = { fromName: "A", toName: "Z", classification: "REQUIRES" };
    const ctx: DependencyCtx = { edge: { fromId: "A", toId: "Z" }, dependency: [], composition: [] };

    const results = validateDependency(dep, ctx);
    expect(results).toEqual([
      { validator: "V9", outcome: "human", reason: "CLASSIFY_REQUIRES_NEEDS_HUMAN" },
      { validator: "V7", outcome: "pass" },
      { validator: "V10", outcome: "pass" },
    ]);
    expect(summarise(results)).toBe("NEEDS_HUMAN");
  });

  it("REQUIRES that would close a dependency cycle → V7 rejects → REJECTED", () => {
    // A REQUIRES B, B REQUIRES C already exist; proposing C REQUIRES A closes the loop.
    const deps = [depEdge("A", "B"), depEdge("B", "C")];
    const dep: RawDependency = { fromName: "C", toName: "A", classification: "REQUIRES" };
    const ctx: DependencyCtx = { edge: { fromId: "C", toId: "A" }, dependency: deps, composition: [] };

    const results = validateDependency(dep, ctx);
    expect(results).toEqual([
      { validator: "V9", outcome: "human", reason: "CLASSIFY_REQUIRES_NEEDS_HUMAN" },
      { validator: "V7", outcome: "reject", reason: "WOULD_CLOSE_DEPENDENCY_CYCLE", detail: { fromId: "C", toId: "A" } },
      { validator: "V10", outcome: "pass" },
    ]);
    expect(summarise(results)).toBe("REJECTED");
  });

  it("PART_OF runs V9 + V8 ONLY (no V7/V10) → NEEDS_HUMAN when acyclic", () => {
    const dep: RawDependency = { fromName: "b", toName: "a", classification: "PART_OF" };
    const ctx: DependencyCtx = { edge: { fromId: "b", toId: "a" }, dependency: [], composition: [] };

    const results = validateDependency(dep, ctx);
    expect(results).toEqual([
      { validator: "V9", outcome: "human", reason: "CLASSIFY_PART_OF_NEEDS_HUMAN" },
      { validator: "V8", outcome: "pass" },
    ]);
    expect(summarise(results)).toBe("NEEDS_HUMAN");
  });

  it("PART_OF that would close a composition cycle → V8 rejects → REJECTED", () => {
    const comp = [compEdge("a", "b")]; // a PART_OF b exists; proposing b PART_OF a closes it.
    const dep: RawDependency = { fromName: "b", toName: "a", classification: "PART_OF" };
    const ctx: DependencyCtx = { edge: { fromId: "b", toId: "a" }, dependency: [], composition: comp };

    const results = validateDependency(dep, ctx);
    expect(results).toEqual([
      { validator: "V9", outcome: "human", reason: "CLASSIFY_PART_OF_NEEDS_HUMAN" },
      { validator: "V8", outcome: "reject", reason: "WOULD_CLOSE_COMPOSITION_CYCLE", detail: { fromId: "b", toId: "a" } },
    ]);
    expect(summarise(results)).toBe("REJECTED");
  });

  it("REINFORCEMENT (the else arm) runs V9 + V10 ONLY (no V7/V8) → NEEDS_HUMAN when unconflicted", () => {
    const dep: RawDependency = { fromName: "A", toName: "B", classification: "REINFORCEMENT", type: "REINFORCES" };
    const ctx: DependencyCtx = { edge: { fromId: "A", toId: "B" }, dependency: [], composition: [] };

    const results = validateDependency(dep, ctx);
    expect(results).toEqual([
      { validator: "V9", outcome: "human", reason: "CLASSIFY_REINFORCEMENT_NEEDS_HUMAN" },
      { validator: "V10", outcome: "pass" },
    ]);
    expect(summarise(results)).toBe("NEEDS_HUMAN");
  });

  it("REINFORCEMENT over a pair that is already a REQUIRES → V10 rejects (§11.5) → REJECTED", () => {
    const deps = [depEdge("A", "B")]; // A REQUIRES B already exists in the same direction.
    const dep: RawDependency = { fromName: "A", toName: "B", classification: "REINFORCEMENT", type: "REINFORCES" };
    const ctx: DependencyCtx = { edge: { fromId: "A", toId: "B" }, dependency: deps, composition: [] };

    const results = validateDependency(dep, ctx);
    expect(results).toEqual([
      { validator: "V9", outcome: "human", reason: "CLASSIFY_REINFORCEMENT_NEEDS_HUMAN" },
      { validator: "V10", outcome: "reject", reason: "PAIR_ALREADY_REQUIRES", detail: { fromId: "A", toId: "B" } },
    ]);
    expect(summarise(results)).toBe("REJECTED");
  });
});

describe("summarise — precedence reject/discard > human > flag > pass", () => {
  it("empty results → AUTO_VALIDATED (no gate objected)", () => {
    expect(summarise([])).toBe("AUTO_VALIDATED");
  });

  it("all passes → AUTO_VALIDATED", () => {
    expect(summarise([R("pass"), R("pass")])).toBe("AUTO_VALIDATED");
  });

  it("a flag (and nothing worse) → FLAGGED", () => {
    expect(summarise([R("pass"), R("flag")])).toBe("FLAGGED");
  });

  it("a human outcome outranks a flag → NEEDS_HUMAN", () => {
    expect(summarise([R("flag"), R("human")])).toBe("NEEDS_HUMAN");
  });

  it("a reject outranks everything (left side of the ||) → REJECTED", () => {
    expect(summarise([R("flag"), R("human"), R("reject")])).toBe("REJECTED");
  });

  it("a discard alone also → REJECTED (right side of the ||)", () => {
    expect(summarise([R("flag"), R("human"), R("discard")])).toBe("REJECTED");
  });

  it("a lone human → NEEDS_HUMAN", () => {
    expect(summarise([R("human")])).toBe("NEEDS_HUMAN");
  });
});

describe("validatorsPass — the AUTO_VALIDATED precondition (§26.2)", () => {
  it("empty → true (vacuously every gate passed)", () => {
    expect(validatorsPass([])).toBe(true);
  });
  it("all pass → true", () => {
    expect(validatorsPass([R("pass"), R("pass")])).toBe(true);
  });
  it("any non-pass (even a flag) → false", () => {
    expect(validatorsPass([R("pass"), R("flag")])).toBe(false);
    expect(validatorsPass([R("pass"), R("human")])).toBe(false);
    expect(validatorsPass([R("pass"), R("discard")])).toBe(false);
  });
});

describe("hasSecurityAlert — any gate that raised securityAlert", () => {
  it("empty → false", () => {
    expect(hasSecurityAlert([])).toBe(false);
  });
  it("no alert flag present → false", () => {
    expect(hasSecurityAlert([R("pass"), R("flag"), R("discard")])).toBe(false);
  });
  it("a real V13 cross-tenant discard raises the alert → true", () => {
    const v13 = v13Scope("tenant:a", ["tenant:b"]);
    expect(v13).toEqual({
      validator: "V13",
      outcome: "discard",
      reason: "CROSS_TENANT_REFERENCE",
      securityAlert: true,
      detail: "tenant:b",
    });
    expect(hasSecurityAlert([R("pass"), v13])).toBe(true);
  });
});
