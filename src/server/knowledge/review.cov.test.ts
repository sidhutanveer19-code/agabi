import { describe, it, expect, vi } from "vitest";
import { createMemoryStore } from "@/server/knowledge/store/memory";
import { buildStatement } from "@/server/knowledge/statement";
import {
  submitStatementReview,
  type GovernanceConfig,
  // re-exported surface (§ facade `export *`) — imported from the facade on purpose
  canReview,
  prioritise,
  buildScreens,
} from "@/server/knowledge/review";
import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import type { ReviewDecision } from "@/server/knowledge/review/decide";
import type { Statement } from "@/server/knowledge/types";

/**
 * Coverage for the review facade `submitStatementReview` (§25/§26/§27). Uses the REAL
 * in-memory KnowledgeStore and the REAL decide/ladder — only the deployment-supplied
 * GovernanceConfig knobs are stubbed (they are pure functions the caller injects, not I/O).
 * Every branch of the facade is exercised through observable trust/dispute outcomes.
 */

const baseConfig = (over: Partial<GovernanceConfig> = {}): GovernanceConfig => ({
  designatedAuthorities: new Set<string>(),
  reviewerReputation: () => 0,
  isCredentialedExpert: () => false,
  communityThreshold: 100,
  ...over,
});

async function seed(store: KnowledgeStore, over: Partial<Statement> = {}): Promise<Statement> {
  const ctx = await store.putContext({ jurisdiction: "IN" });
  const base = buildStatement({
    kind: "FACT",
    form: "SPO",
    structure: { subjectId: "SUBJ", predicate: "p", objectId: "OBJ" },
    text: "written",
    contextId: ctx.id,
  });
  const s: Statement = { ...base, id: "S1", ...over };
  await store.putStatement(s);
  return s;
}

const approve = (over: Partial<ReviewDecision> = {}): ReviewDecision => ({
  targetKind: "Statement",
  targetId: "S1",
  decision: "APPROVE",
  actorId: "rev-1",
  ...over,
});

describe("submitStatementReview facade (§25/§26/§27)", () => {
  describe("target existence guard", () => {
    it("throws naming the missing target when the statement does not exist", async () => {
      const store = createMemoryStore();
      await expect(
        submitStatementReview(store, approve({ targetId: "missing-9" }), "reviewer", baseConfig()),
      ).rejects.toThrow("statement missing-9 not found");
    });

    it("does not throw the not-found error once the target exists", async () => {
      const store = createMemoryStore();
      await seed(store, { trustLevel: "AUTO_VALIDATED", independentSourceCount: 1 });
      // the guard's other side: a real target proceeds to a committed effect
      const { effect } = await submitStatementReview(store, approve(), "reviewer", baseConfig());
      expect(effect.trustLevel).toBe("AUTO_VALIDATED");
    });
  });

  describe("atomic commit + returned audit", () => {
    it("commits the event and effect together and returns them with exact fields", async () => {
      const store = createMemoryStore();
      await seed(store, { trustLevel: "AUTO_VALIDATED", independentSourceCount: 1 });
      const now = new Date("2026-01-02T03:04:05.000Z");
      const decision: ReviewDecision = {
        targetKind: "Statement",
        targetId: "S1",
        decision: "PROMOTE",
        actorId: "editor-9",
        toTrust: "AGABI_CANONICAL",
        reason: "canonical",
        batchId: "b-1",
      };
      const { event, effect } = await submitStatementReview(store, decision, "reviewer", baseConfig(), now);

      expect(effect).toMatchObject({ targetKind: "Statement", targetId: "S1", trustLevel: "AGABI_CANONICAL" });
      expect(event).toMatchObject({
        targetKind: "Statement",
        targetId: "S1",
        decision: "PROMOTE",
        fromTrust: "AUTO_VALIDATED",
        toTrust: "AGABI_CANONICAL",
        actorId: "editor-9",
        reason: "canonical",
        batchId: "b-1",
        before: null,
        after: null,
      });
      expect(event.createdAt).toBe(now);
      expect(typeof event.id).toBe("string");
      expect(event.id.length).toBeGreaterThan(0);

      // atomic: BOTH the audit row and the trust effect are persisted
      expect(await store.reviewEventsFor("Statement", "S1")).toContainEqual(event);
      expect((await store.getStatementRaw("S1"))!.trustLevel).toBe("AGABI_CANONICAL");
    });

    it("defaults createdAt to the current time when `now` is omitted", async () => {
      const store = createMemoryStore();
      await seed(store, { trustLevel: "AUTO_VALIDATED", independentSourceCount: 1 });
      const before = Date.now();
      const { event } = await submitStatementReview(store, approve(), "reviewer", baseConfig());
      const after = Date.now();
      expect(event.createdAt).toBeInstanceOf(Date);
      expect(event.createdAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(event.createdAt.getTime()).toBeLessThanOrEqual(after);
    });
  });

  describe("validatorsPass is derived from the human floor", () => {
    it("a statement AT the floor is treated as validators-passed (approve holds AUTO_VALIDATED)", async () => {
      const store = createMemoryStore();
      await seed(store, { trustLevel: "AUTO_VALIDATED", independentSourceCount: 1 });
      const { effect } = await submitStatementReview(store, approve(), "reviewer", baseConfig());
      expect(effect.trustLevel).toBe("AUTO_VALIDATED");
    });

    it("a statement BELOW the floor is treated as validators-failed (stays MACHINE_PROPOSED)", async () => {
      const store = createMemoryStore();
      await seed(store, { trustLevel: "MACHINE_PROPOSED", independentSourceCount: 1 });
      const { effect } = await submitStatementReview(store, approve(), "reviewer", baseConfig());
      expect(effect.trustLevel).toBe("MACHINE_PROPOSED");
    });

    it("threads the target's independentSourceCount: zero sources blocks AUTO_VALIDATED", async () => {
      const store = createMemoryStore();
      await seed(store, { trustLevel: "AUTO_VALIDATED", independentSourceCount: 0 });
      const { effect } = await submitStatementReview(store, approve(), "reviewer", baseConfig());
      expect(effect.trustLevel).toBe("MACHINE_PROPOSED");
    });
  });

  describe("hasOpenHigherTrustContradiction knob", () => {
    it("defaults to false when the knob is not supplied (promotion allowed)", async () => {
      const store = createMemoryStore();
      await seed(store, { trustLevel: "AUTO_VALIDATED", independentSourceCount: 1 });
      const config = baseConfig();
      expect(config.hasOpenHigherTrustContradiction).toBeUndefined();
      const { effect } = await submitStatementReview(store, approve(), "reviewer", config);
      expect(effect.trustLevel).toBe("AUTO_VALIDATED");
    });

    it("is called with the target id and blocks the machine ceiling when it returns true", async () => {
      const store = createMemoryStore();
      await seed(store, { trustLevel: "AUTO_VALIDATED", independentSourceCount: 1 });
      const spy = vi.fn((_id: string) => true);
      const { effect } = await submitStatementReview(
        store,
        approve(),
        "reviewer",
        baseConfig({ hasOpenHigherTrustContradiction: spy }),
      );
      expect(spy).toHaveBeenCalledWith("S1");
      expect(effect.trustLevel).toBe("MACHINE_PROPOSED");
    });

    it("allows the machine ceiling when the knob returns false", async () => {
      const store = createMemoryStore();
      await seed(store, { trustLevel: "AUTO_VALIDATED", independentSourceCount: 1 });
      const spy = vi.fn(() => false);
      const { effect } = await submitStatementReview(
        store,
        approve(),
        "reviewer",
        baseConfig({ hasOpenHigherTrustContradiction: spy }),
      );
      expect(spy).toHaveBeenCalledWith("S1");
      expect(effect.trustLevel).toBe("AUTO_VALIDATED");
    });
  });

  describe("governance knobs are threaded into promotion", () => {
    it("promotes to OFFICIAL_SOURCE_VERIFIED when the target's authority is designated", async () => {
      const store = createMemoryStore();
      await seed(store, { trustLevel: "AUTO_VALIDATED", independentSourceCount: 1, authority: "NCERT" });
      const { effect } = await submitStatementReview(
        store,
        approve({ decision: "PROMOTE", toTrust: "OFFICIAL_SOURCE_VERIFIED" }),
        "reviewer",
        baseConfig({ designatedAuthorities: new Set(["NCERT"]) }),
      );
      expect(effect.trustLevel).toBe("OFFICIAL_SOURCE_VERIFIED");
    });

    it("does NOT reach OFFICIAL_SOURCE_VERIFIED when the authority is not designated", async () => {
      const store = createMemoryStore();
      await seed(store, { trustLevel: "AUTO_VALIDATED", independentSourceCount: 1, authority: "RANDOM" });
      const { effect } = await submitStatementReview(
        store,
        approve({ decision: "PROMOTE", toTrust: "OFFICIAL_SOURCE_VERIFIED" }),
        "reviewer",
        baseConfig({ designatedAuthorities: new Set(["NCERT"]) }),
      );
      expect(effect.trustLevel).toBe("AUTO_VALIDATED"); // falls back to the machine ceiling
    });

    it("promotes to EXPERT_REVIEWED when the reviewer is a credentialed expert", async () => {
      const store = createMemoryStore();
      await seed(store, { trustLevel: "AUTO_VALIDATED", independentSourceCount: 1 });
      const { effect } = await submitStatementReview(
        store,
        approve({ decision: "PROMOTE", actorId: "dr-house", toTrust: "EXPERT_REVIEWED" }),
        "reviewer",
        baseConfig({ isCredentialedExpert: (id) => id === "dr-house" }),
      );
      expect(effect.trustLevel).toBe("EXPERT_REVIEWED");
    });

    it("does NOT reach EXPERT_REVIEWED when the reviewer is not credentialed", async () => {
      const store = createMemoryStore();
      await seed(store, { trustLevel: "AUTO_VALIDATED", independentSourceCount: 1 });
      const { effect } = await submitStatementReview(
        store,
        approve({ decision: "PROMOTE", actorId: "nobody", toTrust: "EXPERT_REVIEWED" }),
        "reviewer",
        baseConfig({ isCredentialedExpert: () => false }),
      );
      expect(effect.trustLevel).toBe("AUTO_VALIDATED");
    });

    it("accumulates reputation across PRIOR review events to reach COMMUNITY_REVIEWED", async () => {
      const store = createMemoryStore();
      await seed(store, { trustLevel: "AUTO_VALIDATED", independentSourceCount: 1 });
      const config = baseConfig({ reviewerReputation: () => 1, communityThreshold: 2 });

      // first distinct reviewer: reputation 1 < 2 → still AUTO_VALIDATED
      const first = await submitStatementReview(store, approve({ actorId: "rev-A" }), "reviewer", config);
      expect(first.effect.trustLevel).toBe("AUTO_VALIDATED");

      // second distinct reviewer: prior event is fetched and included → 2 distinct reviewers, rep 2 ≥ 2
      const second = await submitStatementReview(store, approve({ actorId: "rev-B" }), "reviewer", config);
      expect(second.effect.trustLevel).toBe("COMMUNITY_REVIEWED");

      // ids are minted fresh per event
      expect(second.event.id).not.toBe(first.event.id);
    });
  });

  describe("dispute lifecycle effects committed by the facade", () => {
    it("DISPUTE suspends the statement and records the prior standing", async () => {
      const store = createMemoryStore();
      await seed(store, { trustLevel: "AUTO_VALIDATED", independentSourceCount: 1 });
      const now = new Date("2026-03-03T00:00:00.000Z");
      const { effect } = await submitStatementReview(
        store,
        { targetKind: "Statement", targetId: "S1", decision: "DISPUTE", actorId: "rev-1", reason: "contested" },
        "reviewer",
        baseConfig(),
        now,
      );
      expect(effect.trustLevel).toBeUndefined();
      expect(effect.dispute).toEqual({ disputed: true, reason: "contested", priorTrustLevel: "AUTO_VALIDATED", at: now });
      const raw = (await store.getStatementRaw("S1"))!;
      expect(raw.disputed).toBe(true);
      expect(raw.priorTrustLevel).toBe("AUTO_VALIDATED");
      expect(raw.disputeReason).toBe("contested");
    });

    it("RESOLVE clears the dispute and restores prior standing", async () => {
      const store = createMemoryStore();
      await seed(store, { trustLevel: "AUTO_VALIDATED", independentSourceCount: 1 });
      await submitStatementReview(
        store,
        { targetKind: "Statement", targetId: "S1", decision: "DISPUTE", actorId: "rev-1", reason: "x" },
        "reviewer",
        baseConfig(),
      );
      const { event, effect } = await submitStatementReview(
        store,
        { targetKind: "Statement", targetId: "S1", decision: "RESOLVE", actorId: "rev-1" },
        "reviewer",
        baseConfig(),
      );
      expect(event.decision).toBe("APPROVE"); // RESOLVE is recorded as an APPROVE audit
      expect(effect.dispute).toEqual({ disputed: false, reason: null, priorTrustLevel: null, at: null });
      expect(effect.trustLevel).toBe("AUTO_VALIDATED");
      const raw = (await store.getStatementRaw("S1"))!;
      expect(raw.disputed).toBe(false);
      expect(raw.trustLevel).toBe("AUTO_VALIDATED");
    });

    it("EDIT clears an existing dispute", async () => {
      const store = createMemoryStore();
      await seed(store, {
        trustLevel: "AUTO_VALIDATED",
        independentSourceCount: 1,
        disputed: true,
        priorTrustLevel: "AUTO_VALIDATED",
        disputeReason: "old",
      });
      const { effect } = await submitStatementReview(
        store,
        { targetKind: "Statement", targetId: "S1", decision: "EDIT", actorId: "rev-1" },
        "reviewer",
        baseConfig(),
      );
      expect(effect.dispute).toEqual({ disputed: false, reason: null, priorTrustLevel: null, at: null });
      expect((await store.getStatementRaw("S1"))!.disputed).toBe(false);
    });

    it("EDIT on a NON-disputed statement produces no dispute or trust effect", async () => {
      const store = createMemoryStore();
      await seed(store, { trustLevel: "AUTO_VALIDATED", independentSourceCount: 1, disputed: false });
      const { effect } = await submitStatementReview(
        store,
        { targetKind: "Statement", targetId: "S1", decision: "EDIT", actorId: "rev-1" },
        "reviewer",
        baseConfig(),
      );
      expect(effect.dispute).toBeUndefined();
      expect(effect.trustLevel).toBeUndefined();
    });

    it("REJECT records the audit event without changing trust or dispute", async () => {
      const store = createMemoryStore();
      await seed(store, { trustLevel: "AUTO_VALIDATED", independentSourceCount: 1 });
      const { event, effect } = await submitStatementReview(
        store,
        approve({ decision: "REJECT", reason: "bad" }),
        "reviewer",
        baseConfig(),
      );
      expect(effect.trustLevel).toBeUndefined();
      expect(effect.dispute).toBeUndefined();
      expect(event.decision).toBe("REJECT");
      const raw = (await store.getStatementRaw("S1"))!;
      expect(raw.trustLevel).toBe("AUTO_VALIDATED");
      expect(await store.reviewEventsFor("Statement", "S1")).toContainEqual(event);
    });
  });

  describe("authorization is enforced before any commit", () => {
    it("refuses a non-reviewer role and writes nothing", async () => {
      const store = createMemoryStore();
      await seed(store, { trustLevel: "AUTO_VALIDATED", independentSourceCount: 1 });
      await expect(submitStatementReview(store, approve(), "admin", baseConfig())).rejects.toThrow(/may not review/);
      await expect(submitStatementReview(store, approve(), "reader", baseConfig())).rejects.toThrow(/may not review/);
      await expect(submitStatementReview(store, approve(), "ingestor", baseConfig())).rejects.toThrow(/may not review/);
      // the refusal happens before commitReview — nothing persisted
      expect(await store.reviewEventsFor("Statement", "S1")).toHaveLength(0);
      expect((await store.getStatementRaw("S1"))!.trustLevel).toBe("AUTO_VALIDATED");
    });

    it("refuses a review whose actorId is blank", async () => {
      const store = createMemoryStore();
      await seed(store, { trustLevel: "AUTO_VALIDATED", independentSourceCount: 1 });
      await expect(
        submitStatementReview(store, approve({ actorId: "   " }), "reviewer", baseConfig()),
      ).rejects.toThrow(/human actorId/);
      expect(await store.reviewEventsFor("Statement", "S1")).toHaveLength(0);
    });
  });

  describe("re-exported facade surface", () => {
    it("re-exports the decide/queue/batch functions from the single facade module", () => {
      expect(canReview("reviewer")).toBe(true);
      expect(canReview("admin")).toBe(false);
      expect(prioritise([])).toEqual([]);
      expect(buildScreens([])).toEqual([]);
    });
  });
});
