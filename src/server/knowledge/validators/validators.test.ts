import { describe, it, expect } from "vitest";
import type { RawStatement, RawDependency } from "@/server/knowledge/extraction/types";
import type { DependencyEdge, CompositionEdge } from "@/server/knowledge/types";
import type { ContextDimension } from "@/server/knowledge/context/registry";
import {
  v3Grounding, v4QuoteLength, v5Originality,
  v2Kind, v11ContextValidity, v14AnalogyBreakdown, v15SelfReference,
  v7DependencyAcyclic, v8CompositionAcyclic, v9EdgeClassification, v10GraphConflict,
  v13Scope,
  validateStatement, validateDependency, summarise, validatorsPass, hasSecurityAlert,
} from "@/server/knowledge/validators";

const CHUNK = "Photosynthesis converts light energy into chemical energy stored in glucose.";

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

describe("validators V1–V15 (§14)", () => {
  describe("grounding (V3–V5)", () => {
    it("V3 passes an exact quote and returns its range", () => {
      const r = v3Grounding(stmt(), CHUNK);
      expect(r.outcome).toBe("pass");
      expect(r.detail).toBeDefined();
    });
    it("V3 DISCARDS a fabricated quote (paraphrase-as-quote)", () => {
      const r = v3Grounding(stmt({ quote: "plants literally eat the sun for breakfast" }), CHUNK);
      expect(r.outcome).toBe("discard");
      expect(r.reason).toBe("QUOTE_NOT_IN_SOURCE");
    });
    it("V4 discards a too-short quote", () => {
      expect(v4QuoteLength(stmt({ quote: "short" })).outcome).toBe("discard");
      expect(v4QuoteLength(stmt()).outcome).toBe("pass");
    });
    it("V5 flags text that copies the source (copyright)", () => {
      expect(v5Originality(stmt({ text: "converts light energy into chemical energy" })).outcome).toBe("flag");
      expect(v5Originality(stmt()).outcome).toBe("pass");
    });
  });

  describe("structure (V2, V11, V14, V15)", () => {
    it("V2 discards an unregistered kind", () => {
      expect(v2Kind(stmt({ kind: "VIBES" })).outcome).toBe("discard");
      expect(v2Kind(stmt()).outcome).toBe("pass");
    });
    it("V11 discards an unregistered context dimension", () => {
      const registry = { jurisdiction: {} as ContextDimension };
      expect(v11ContextValidity({ jurisdiction: "IN" }, registry).outcome).toBe("pass");
      expect(v11ContextValidity({ madeUp: "x" }, registry).outcome).toBe("discard");
    });
    it("V14 discards an analogy with no breakdown point", () => {
      expect(v14AnalogyBreakdown({ kind: "ANALOGY", payload: {} }).outcome).toBe("discard");
      expect(v14AnalogyBreakdown({ kind: "ANALOGY", payload: { breakdownPoint: "breaks at capacitance" } }).outcome).toBe("pass");
      expect(v14AnalogyBreakdown({ kind: "WORKED_EXAMPLE", payload: {} }).outcome).toBe("pass");
    });
    it("V15 discards a self-referential SPO", () => {
      expect(v15SelfReference(stmt({ subject: "x", object: "x" })).outcome).toBe("discard");
      expect(v15SelfReference(stmt()).outcome).toBe("pass");
    });
  });

  describe("graph (V7–V10)", () => {
    const deps: DependencyEdge[] = [
      { fromId: "B", toId: "A", strength: 1, contextId: null, version: 1, supersedes: null },
      { fromId: "C", toId: "B", strength: 1, contextId: null, version: 1, supersedes: null },
    ];
    const comp: CompositionEdge[] = [{ partId: "b", wholeId: "a", ordinal: null, version: 1 }];
    it("V7 rejects a REQUIRES that would close a cycle", () => {
      expect(v7DependencyAcyclic({ fromId: "A", toId: "C" }, deps).outcome).toBe("reject");
      expect(v7DependencyAcyclic({ fromId: "A", toId: "Z" }, deps).outcome).toBe("pass");
    });
    it("V8 rejects a PART_OF that would close a cycle", () => {
      expect(v8CompositionAcyclic({ fromId: "a", toId: "b" }, comp).outcome).toBe("reject");
    });
    it("V9 is ALWAYS human", () => {
      const dep: RawDependency = { fromName: "A", toName: "B", classification: "REQUIRES" };
      expect(v9EdgeClassification(dep).outcome).toBe("human");
    });
    it("V10 rejects a reinforcement pair already present as REQUIRES", () => {
      expect(v10GraphConflict({ fromId: "B", toId: "A" }, deps).outcome).toBe("reject"); // B REQUIRES A exists
      expect(v10GraphConflict({ fromId: "A", toId: "B" }, deps).outcome).toBe("pass"); // reverse is fine
    });
  });

  describe("scope (V13)", () => {
    it("discards a cross-tenant reference and raises a security alert", () => {
      const r = v13Scope("tenant:a", ["tenant:b"]);
      expect(r.outcome).toBe("discard");
      expect(r.securityAlert).toBe(true);
    });
    it("allows a tenant referencing public, but not public referencing a tenant", () => {
      expect(v13Scope("tenant:a", ["PUBLIC"]).outcome).toBe("pass");
      expect(v13Scope("PUBLIC", ["tenant:a"]).outcome).toBe("discard");
    });
  });

  describe("runner", () => {
    const registry = { jurisdiction: {} as ContextDimension };
    it("a clean statement is AUTO_VALIDATED (passing every gate IS the state)", () => {
      const results = validateStatement(stmt(), { chunkText: CHUNK, registry });
      expect(summarise(results)).toBe("AUTO_VALIDATED");
      expect(validatorsPass(results)).toBe(true);
    });
    it("a fabricated quote makes the whole statement REJECTED", () => {
      const results = validateStatement(stmt({ quote: "not in the chunk at all here" }), { chunkText: CHUNK, registry });
      expect(summarise(results)).toBe("REJECTED");
      expect(validatorsPass(results)).toBe(false);
    });
    it("a proposed edge always NEEDS_HUMAN (V9)", () => {
      const dep: RawDependency = { fromName: "A", toName: "Z", classification: "REQUIRES" };
      const results = validateDependency(dep, { edge: { fromId: "A", toId: "Z" }, dependency: [], composition: [] });
      expect(summarise(results)).toBe("NEEDS_HUMAN");
    });
    it("a cross-tenant statement surfaces a security alert", () => {
      expect(hasSecurityAlert([v13Scope("tenant:a", ["tenant:b"])])).toBe(true);
    });
  });
});
