import { describe, it, expect } from "vitest";
import { promote, requiresHumanReview, type PromotionInputs } from "@/server/knowledge/trust/ladder";
import type { ReviewEvent } from "@/server/knowledge/types";

function review(over: Partial<ReviewEvent>): ReviewEvent {
  return {
    id: "r", targetKind: "Statement", targetId: "s", decision: "PROMOTE",
    fromTrust: null, toTrust: null, actorId: "human-1", before: null, after: null,
    reason: null, batchId: null, createdAt: new Date(), ...over,
  };
}

function inputs(over: Partial<PromotionInputs> = {}): PromotionInputs {
  return {
    validatorsPass: true,
    independentSourceCount: 1,
    hasOpenHigherTrustContradiction: false,
    reviewEvents: [],
    designatedAuthorities: new Set(),
    authority: null,
    reviewerReputation: () => 1,
    isCredentialedExpert: () => false,
    communityThreshold: 3,
    ...over,
  };
}

describe("trust ladder promotion (§26.2)", () => {
  // trust-gate (§29): nothing above AUTO_VALIDATED without a HUMAN ReviewEvent.
  it("clean validators + a source + no contradiction → AUTO_VALIDATED, and no higher without review", () => {
    expect(promote(inputs())).toBe("AUTO_VALIDATED");
  });

  it("a non-human review (empty actorId) can NOT promote above the floor", () => {
    const fake = review({ toTrust: "AGABI_CANONICAL", actorId: "  " });
    expect(promote(inputs({ reviewEvents: [fake] }))).toBe("AUTO_VALIDATED");
  });

  it("an editorial human review reaches AGABI_CANONICAL", () => {
    const editorial = review({ toTrust: "AGABI_CANONICAL", actorId: "editor-1" });
    expect(promote(inputs({ reviewEvents: [editorial] }))).toBe("AGABI_CANONICAL");
  });

  it("OFFICIAL_SOURCE_VERIFIED needs a human review AND a designated authority", () => {
    const r = review({ toTrust: "OFFICIAL_SOURCE_VERIFIED", actorId: "verifier-1" });
    expect(promote(inputs({ reviewEvents: [r], authority: "NCERT", designatedAuthorities: new Set(["NCERT"]) }))).toBe("OFFICIAL_SOURCE_VERIFIED");
    // without the designated authority it does not reach that rung
    expect(promote(inputs({ reviewEvents: [r], authority: "randomblog", designatedAuthorities: new Set(["NCERT"]) }))).toBe("AUTO_VALIDATED");
  });

  it("EXPERT_REVIEWED needs a credentialed expert", () => {
    const r = review({ toTrust: "EXPERT_REVIEWED", actorId: "dr-who" });
    expect(promote(inputs({ reviewEvents: [r], isCredentialedExpert: (id) => id === "dr-who" }))).toBe("EXPERT_REVIEWED");
    expect(promote(inputs({ reviewEvents: [r], isCredentialedExpert: () => false }))).toBe("AUTO_VALIDATED");
  });

  it("COMMUNITY_REVIEWED needs distinct reviewers meeting the reputation threshold", () => {
    const a = review({ id: "a", decision: "APPROVE", actorId: "u1", toTrust: null });
    const b = review({ id: "b", decision: "APPROVE", actorId: "u2", toTrust: null });
    expect(promote(inputs({ reviewEvents: [a, b], reviewerReputation: () => 2, communityThreshold: 3 }))).toBe("COMMUNITY_REVIEWED");
    // one reviewer's reputation counted once, below threshold → stays AUTO_VALIDATED
    expect(promote(inputs({ reviewEvents: [a, a], reviewerReputation: () => 2, communityThreshold: 3 }))).toBe("AUTO_VALIDATED");
  });

  // provenance (§29): no source (independentSourceCount 0) → cannot even auto-validate.
  it("without an independent source it stays MACHINE_PROPOSED", () => {
    expect(promote(inputs({ independentSourceCount: 0 }))).toBe("MACHINE_PROPOSED");
  });

  it("an open contradiction with higher trust blocks auto-validation", () => {
    expect(promote(inputs({ hasOpenHigherTrustContradiction: true }))).toBe("MACHINE_PROPOSED");
  });

  it("failing validators stays MACHINE_PROPOSED", () => {
    expect(promote(inputs({ validatorsPass: false }))).toBe("MACHINE_PROPOSED");
  });

  it("requiresHumanReview marks everything above AUTO_VALIDATED", () => {
    expect(requiresHumanReview("AUTO_VALIDATED")).toBe(false);
    expect(requiresHumanReview("COMMUNITY_REVIEWED")).toBe(true);
    expect(requiresHumanReview("AGABI_CANONICAL")).toBe(true);
  });
});
