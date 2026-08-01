import { describe, it, expect } from "vitest";
import {
  applyReview,
  canReview,
  type Role,
  type ReviewDecision,
  type ApplyContext,
} from "@/server/knowledge/review/decide";
import type { ReviewEvent } from "@/server/knowledge/types";

/**
 * applyReview / canReview — the ONLY place trust is written above AUTO_VALIDATED (§27).
 *
 * decide.ts has NO prisma/db/network import. Its two side-effect edges — the clock
 * (`ctx.now`) and the id generator (`ctx.mintId`) — are already injected through
 * ApplyContext, so the correct "fake only at the I/O edge" here is a deterministic
 * `now`/`mintId` passed in directly; there is nothing for `vi.mock` to intercept.
 * `promote` (trust/ladder) is PURE branching logic, so it runs FOR REAL — every
 * assertion below names the exact TrustLevel it must return and asserts THAT, which
 * also proves decide.ts threads the new event + priorReviewEvents + authority set
 * into the ladder correctly (drop any and the level would collapse to the machine floor).
 */

const NOW = new Date("2020-06-15T12:00:00Z");

function basePromotion(): ApplyContext["promotion"] {
  return {
    validatorsPass: false,
    independentSourceCount: 0,
    hasOpenHigherTrustContradiction: false,
    designatedAuthorities: new Set<string>(),
    authority: null,
    reviewerReputation: () => 0,
    isCredentialedExpert: () => false,
    communityThreshold: 100,
    priorReviewEvents: [],
  };
}

function makeCtx(
  over: {
    role?: Role;
    current?: Partial<ApplyContext["current"]>;
    promotion?: Partial<ApplyContext["promotion"]>;
    now?: Date;
    mintId?: () => string;
  } = {},
): ApplyContext {
  return {
    role: over.role ?? "reviewer",
    current: { trustLevel: "MACHINE_PROPOSED", disputed: false, priorTrustLevel: null, ...over.current },
    promotion: { ...basePromotion(), ...over.promotion },
    now: over.now ?? NOW,
    mintId: over.mintId ?? (() => "evt-mint-1"),
  };
}

function dec(over: Partial<ReviewDecision> = {}): ReviewDecision {
  return { targetKind: "Statement", targetId: "S", decision: "REJECT", actorId: "rev-1", ...over };
}

function priorEvent(over: Partial<ReviewEvent> = {}): ReviewEvent {
  return {
    id: "prior-1",
    targetKind: "Statement",
    targetId: "S",
    decision: "APPROVE",
    fromTrust: "AUTO_VALIDATED",
    toTrust: null,
    actorId: "rev-prior",
    before: null,
    after: null,
    reason: null,
    batchId: null,
    createdAt: new Date("2020-01-01T00:00:00Z"),
    ...over,
  };
}

describe("canReview (§27 — only a reviewer writes truth)", () => {
  it("a reviewer may review", () => {
    expect(canReview("reviewer")).toBe(true);
  });
  it("admin / reader / ingestor may NOT review (admin is not a superuser over truth)", () => {
    expect(canReview("admin")).toBe(false);
    expect(canReview("reader")).toBe(false);
    expect(canReview("ingestor")).toBe(false);
  });
});

describe("applyReview — human-gate guards (§27)", () => {
  it("a non-reviewer role is refused with the §27 message, for every non-reviewer role", () => {
    for (const role of ["admin", "reader", "ingestor"] as const) {
      expect(() => applyReview(dec({ decision: "APPROVE" }), makeCtx({ role }))).toThrow(
        `role ${role} may not review (§27)`,
      );
    }
  });

  it("an empty actorId is refused", () => {
    expect(() => applyReview(dec({ actorId: "" }), makeCtx())).toThrow(
      "review requires a human actorId (§27)",
    );
  });

  it("a whitespace-only actorId is refused (proves .trim() runs, not just length)", () => {
    expect(() => applyReview(dec({ actorId: "   \t\n " }), makeCtx())).toThrow(
      "review requires a human actorId (§27)",
    );
  });

  it("guards short-circuit: role is checked BEFORE actorId (bad role + empty id → role error)", () => {
    expect(() => applyReview(dec({ actorId: "" }), makeCtx({ role: "admin" }))).toThrow(
      "role admin may not review (§27)",
    );
  });
});

describe("applyReview — event field mapping (the audit record)", () => {
  it("maps EXACT event fields, all optionals PRESENT, fromTrust=current, id=mintId, createdAt=now", () => {
    const mintId = () => "evt-xyz";
    const { event, effect } = applyReview(
      dec({ decision: "REJECT", toTrust: "COMMUNITY_REVIEWED", reason: "bad grounding", batchId: "b-9" }),
      makeCtx({ current: { trustLevel: "AUTO_VALIDATED" }, mintId }),
    );
    expect(event).toEqual({
      id: "evt-xyz",
      targetKind: "Statement",
      targetId: "S",
      decision: "REJECT",
      fromTrust: "AUTO_VALIDATED",
      toTrust: "COMMUNITY_REVIEWED",
      actorId: "rev-1",
      before: null,
      after: null,
      reason: "bad grounding",
      batchId: "b-9",
      createdAt: NOW,
    });
    // REJECT records the event only — no trust write, no dispute (§26 demotion is M6).
    expect(effect).toEqual({ targetKind: "Statement", targetId: "S" });
  });

  it("absent optionals default to null: toTrust ?? null, reason ?? null, batchId ?? null", () => {
    const { event } = applyReview(dec({ decision: "REJECT" }), makeCtx());
    expect(event.toTrust).toBeNull();
    expect(event.reason).toBeNull();
    expect(event.batchId).toBeNull();
    expect(event.fromTrust).toBe("MACHINE_PROPOSED"); // still copied from current
  });
});

describe("applyReview — APPROVE (runs the real ladder)", () => {
  it("machine ceiling: validators pass + 1 source + no contradiction → AUTO_VALIDATED", () => {
    const { event, effect } = applyReview(
      dec({ decision: "APPROVE", actorId: "rev-1" }),
      makeCtx({
        promotion: { validatorsPass: true, independentSourceCount: 1, reviewerReputation: () => 1, communityThreshold: 100 },
      }),
    );
    expect(event.decision).toBe("APPROVE");
    expect(effect).toEqual({ targetKind: "Statement", targetId: "S", trustLevel: "AUTO_VALIDATED" });
  });

  it("priorReviewEvents ARE threaded in: prior human approve + this approve reach the community threshold", () => {
    // Without the prior, one reviewer's reputation (1) is below the threshold (2) and
    // validators fail → MACHINE_PROPOSED. Getting COMMUNITY_REVIEWED proves decide.ts
    // appended THIS event to ctx.promotion.priorReviewEvents before calling promote().
    const { effect } = applyReview(
      dec({ decision: "APPROVE", actorId: "rev-2" }),
      makeCtx({
        promotion: {
          validatorsPass: false,
          reviewerReputation: () => 1,
          communityThreshold: 2,
          priorReviewEvents: [priorEvent({ id: "p1", decision: "APPROVE", actorId: "rev-1" })],
        },
      }),
    );
    expect(effect.trustLevel).toBe("COMMUNITY_REVIEWED");
  });

  it("the NEW event alone is not enough when it cannot clear the threshold → MACHINE_PROPOSED", () => {
    const { effect } = applyReview(
      dec({ decision: "APPROVE", actorId: "rev-solo" }),
      makeCtx({ promotion: { validatorsPass: false, reviewerReputation: () => 1, communityThreshold: 2 } }),
    );
    expect(effect.trustLevel).toBe("MACHINE_PROPOSED");
  });
});

describe("applyReview — PROMOTE (needs a human ReviewEvent per rung)", () => {
  it("PROMOTE→AGABI_CANONICAL: the newly-built event unlocks the top rung", () => {
    // priorReviewEvents is empty and validators fail, so ONLY the new PROMOTE event can
    // reach AGABI_CANONICAL — this proves the event decide.ts builds is fed into promote().
    const { event, effect } = applyReview(
      dec({ decision: "PROMOTE", actorId: "editor-1", toTrust: "AGABI_CANONICAL" }),
      makeCtx(),
    );
    expect(event.decision).toBe("PROMOTE");
    expect(event.toTrust).toBe("AGABI_CANONICAL");
    expect(effect.trustLevel).toBe("AGABI_CANONICAL");
    expect(effect.dispute).toBeUndefined();
  });

  it("PROMOTE→OFFICIAL_SOURCE_VERIFIED honours the authority+designatedAuthorities threaded from ctx", () => {
    const { effect } = applyReview(
      dec({ decision: "PROMOTE", actorId: "auth-rev", toTrust: "OFFICIAL_SOURCE_VERIFIED" }),
      makeCtx({ promotion: { authority: "NCERT", designatedAuthorities: new Set(["NCERT"]) } }),
    );
    expect(effect.trustLevel).toBe("OFFICIAL_SOURCE_VERIFIED");
  });

  it("PROMOTE→OFFICIAL_SOURCE_VERIFIED is DENIED when the authority is not designated", () => {
    const { effect } = applyReview(
      dec({ decision: "PROMOTE", actorId: "auth-rev", toTrust: "OFFICIAL_SOURCE_VERIFIED" }),
      makeCtx({ promotion: { authority: "RANDOM_BLOG", designatedAuthorities: new Set(["NCERT"]) } }),
    );
    expect(effect.trustLevel).toBe("MACHINE_PROPOSED");
  });
});

describe("applyReview — DISPUTE (§26.5 suspend servability, keep the level)", () => {
  it("with a reason: preserves the current level as priorTrustLevel and stamps `at` with now", () => {
    const { event, effect } = applyReview(
      dec({ decision: "DISPUTE", reason: "contradicts textbook" }),
      makeCtx({ current: { trustLevel: "EXPERT_REVIEWED" } }),
    );
    expect(event.decision).toBe("DISPUTE");
    expect(effect).toEqual({
      targetKind: "Statement",
      targetId: "S",
      dispute: { disputed: true, reason: "contradicts textbook", priorTrustLevel: "EXPERT_REVIEWED", at: NOW },
    });
    // A dispute never writes trust — it only suspends.
    expect(effect.trustLevel).toBeUndefined();
  });

  it("without a reason: dispute.reason falls back to null", () => {
    const { effect } = applyReview(
      dec({ decision: "DISPUTE" }),
      makeCtx({ current: { trustLevel: "COMMUNITY_REVIEWED" } }),
    );
    expect(effect.dispute).toEqual({
      disputed: true,
      reason: null,
      priorTrustLevel: "COMMUNITY_REVIEWED",
      at: NOW,
    });
  });
});

describe("applyReview — RESOLVE (§26.5 clear the flag, restore standing)", () => {
  it("maps decision to APPROVE for the audit, clears the dispute, restores priorTrustLevel", () => {
    const { event, effect } = applyReview(
      dec({ decision: "RESOLVE" }),
      makeCtx({ current: { trustLevel: "MACHINE_PROPOSED", disputed: true, priorTrustLevel: "EXPERT_REVIEWED" } }),
    );
    // §26.5 ternary in event build: RESOLVE is audited as APPROVE.
    expect(event.decision).toBe("APPROVE");
    expect(effect).toEqual({
      targetKind: "Statement",
      targetId: "S",
      dispute: { disputed: false, reason: null, priorTrustLevel: null, at: null },
      trustLevel: "EXPERT_REVIEWED",
    });
  });

  it("with no priorTrustLevel, restores to the CURRENT level (?? fallback)", () => {
    const { effect } = applyReview(
      dec({ decision: "RESOLVE" }),
      makeCtx({ current: { trustLevel: "AUTO_VALIDATED", disputed: true, priorTrustLevel: null } }),
    );
    expect(effect.trustLevel).toBe("AUTO_VALIDATED");
    expect(effect.dispute).toEqual({ disputed: false, reason: null, priorTrustLevel: null, at: null });
  });
});

describe("applyReview — EDIT (§26.5 a new version supersedes a contested one)", () => {
  it("when the target IS disputed, an edit clears the dispute", () => {
    const { event, effect } = applyReview(
      dec({ decision: "EDIT" }),
      makeCtx({ current: { trustLevel: "COMMUNITY_REVIEWED", disputed: true } }),
    );
    expect(event.decision).toBe("EDIT");
    expect(effect).toEqual({
      targetKind: "Statement",
      targetId: "S",
      dispute: { disputed: false, reason: null, priorTrustLevel: null, at: null },
    });
    // An edit never promotes.
    expect(effect.trustLevel).toBeUndefined();
  });

  it("when the target is NOT disputed, an edit leaves the effect bare (no dispute key)", () => {
    const { effect } = applyReview(
      dec({ decision: "EDIT" }),
      makeCtx({ current: { trustLevel: "COMMUNITY_REVIEWED", disputed: false } }),
    );
    expect(effect).toEqual({ targetKind: "Statement", targetId: "S" });
    expect(effect.dispute).toBeUndefined();
  });
});

describe("applyReview — REJECT (records the event, writes nothing to the target)", () => {
  it("produces a REJECT audit event and an effect with neither trust nor dispute", () => {
    const { event, effect } = applyReview(
      dec({ decision: "REJECT", reason: "not grounded" }),
      makeCtx({ current: { trustLevel: "AUTO_VALIDATED" } }),
    );
    expect(event.decision).toBe("REJECT");
    expect(event.reason).toBe("not grounded");
    expect(effect).toEqual({ targetKind: "Statement", targetId: "S" });
    expect(effect.trustLevel).toBeUndefined();
    expect(effect.dispute).toBeUndefined();
  });
});
