import { describe, it, expect } from "vitest";
import { contradicts, anyContradiction, type ContradictionInput } from "@/server/knowledge/trust/contradiction";
import { corroboration } from "@/server/knowledge/trust/corroboration";
import { inferredTrust, buildInference } from "@/server/knowledge/trust/inference";
import { recomputeTrust, demotesBelow, disposition, type RecomputeInputs } from "@/server/knowledge/trust/promote";
import type { Provenance } from "@/server/knowledge/types";

const spo = (over: Partial<ContradictionInput>): ContradictionInput => ({ form: "SPO", contextId: "ctx", subjectId: "water", predicate: "boilsAt", objectLit: "100C", structure: {}, ...over });

describe("M6 trust automation", () => {
  describe("contradiction per form (§14.4)", () => {
    it("SPO — same subject+predicate, different object, same context", () => {
      expect(contradicts(spo({}), spo({ objectLit: "90C" })).conflict).toBe(true);
      expect(contradicts(spo({}), spo({ objectLit: "100C" })).conflict).toBe(false);
      expect(contradicts(spo({}), spo({ objectLit: "90C", contextId: "other" })).conflict).toBe(false); // no overlap
    });
    it("DEFINITIONAL — same definiendum, different definiens is always a conflict", () => {
      const a: ContradictionInput = { form: "DEFINITIONAL", contextId: "c", structure: { definiendum: "force", definiens: "mass×accel" } };
      const b: ContradictionInput = { form: "DEFINITIONAL", contextId: "c", structure: { definiendum: "force", definiens: "a push" } };
      expect(contradicts(a, b).conflict).toBe(true);
    });
    it("PROBABILISTIC — disjoint confidence intervals conflict; overlapping do not", () => {
      const mk = (interval: number[]): ContradictionInput => ({ form: "PROBABILISTIC", contextId: "c", structure: { quantity: "g", interval } });
      expect(contradicts(mk([9.7, 9.8]), mk([9.9, 10.0])).conflict).toBe(true);
      expect(contradicts(mk([9.7, 9.9]), mk([9.8, 10.0])).conflict).toBe(false);
    });
    it("anyContradiction flags a candidate against a higher-trust set", () => {
      expect(anyContradiction(spo({ objectLit: "90C" }), [spo({})])).toBe(true);
    });
  });

  describe("corroboration by publisher independence (§26.6)", () => {
    const prov = (sourceId: string): Provenance => ({ statementId: "s", sourceId, chunkId: "c", locator: {}, quote: "q", extractorVersion: "1", promptVersion: "1", modelId: "m", extractedAt: new Date() });
    it("counts distinct PUBLISHERS, not documents", () => {
      const publisherOf = (id: string) => ({ s1: "NCERT", s2: "NCERT", s3: "OpenStax" })[id];
      const c = corroboration({ provenanceOf: [prov("s1"), prov("s2"), prov("s3")], publisherOf });
      expect(c.corroborationCount).toBe(3); // three sources
      expect(c.independentSourceCount).toBe(2); // two publishers
    });
  });

  describe("inference inherits the weakest premise (§26.6)", () => {
    it("takes the minimum trust across premises", () => {
      expect(inferredTrust(["EXPERT_REVIEWED", "AUTO_VALIDATED"])).toBe("AUTO_VALIDATED");
      expect(inferredTrust([])).toBe("MACHINE_PROPOSED");
      expect(buildInference(["a", "b"], ["AGABI_CANONICAL", "COMMUNITY_REVIEWED"])).toMatchObject({ derivedFrom: ["a", "b"], trustLevel: "COMMUNITY_REVIEWED" });
    });
  });

  describe("recompute + demotion (§14.3, §26.3)", () => {
    const base = (over: Partial<RecomputeInputs> = {}): RecomputeInputs => ({
      validatorsPass: true, independentSourceCount: 1, reviewEvents: [], designatedAuthorities: new Set(),
      authority: null, reviewerReputation: () => 1, isCredentialedExpert: () => false, communityThreshold: 3, ...over,
    });
    it("a contradiction with higher-trust blocks AUTO_VALIDATED", () => {
      expect(recomputeTrust(base())).toBe("AUTO_VALIDATED");
      const contradicted = base({ candidate: spo({ objectLit: "90C" }), higherTrust: [spo({})] });
      expect(recomputeTrust(contradicted)).toBe("MACHINE_PROPOSED");
    });
    it("losing the last source demotes below AUTO_VALIDATED (trust is not a ratchet)", () => {
      const recomputed = recomputeTrust(base({ independentSourceCount: 0 }));
      expect(demotesBelow("AUTO_VALIDATED", recomputed)).toBe(true);
    });
    it("a contradiction DISPUTES a human-reviewed statement but DEMOTES a machine one (§26.3 vs §26.5)", () => {
      expect(disposition("OFFICIAL_SOURCE_VERIFIED", "CONTRADICTION")).toEqual({ kind: "dispute", trigger: "CONTRADICTION" });
      expect(disposition("AUTO_VALIDATED", "CONTRADICTION")).toEqual({ kind: "demote", to: "MACHINE_PROPOSED" });
    });
  });
});
