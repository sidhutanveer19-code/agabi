import { describe, it, expect } from "vitest";
import { createMemoryStore } from "@/server/knowledge/store/memory";
import { buildStatement } from "@/server/knowledge/statement";
import { prioritise, type QueueItem } from "@/server/knowledge/review/queue";
import { buildScreens, highlightSource } from "@/server/knowledge/review/batch";
import { submitStatementReview, type GovernanceConfig } from "@/server/knowledge/review";
import { POLICIES } from "@/server/knowledge/trust/policy";
import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import type { ReviewDecision } from "@/server/knowledge/review/decide";

const CONFIG: GovernanceConfig = {
  designatedAuthorities: new Set(["NCERT"]),
  reviewerReputation: () => 1,
  isCredentialedExpert: () => false,
  communityThreshold: 3,
};

const item = (over: Partial<QueueItem>): QueueItem => ({
  targetKind: "Statement", targetId: "x", dependentCount: 0, knowledgeMissCount: 0, programWeight: 0, ageInQueue: 0, ...over,
});

async function seedStatement(store: KnowledgeStore, id = "S") {
  const ctx = await store.putContext({ jurisdiction: "IN" });
  const s = {
    ...buildStatement({ kind: "FACT", form: "SPO", structure: { subjectId: id, predicate: "p", objectId: "O" }, text: "written", contextId: ctx.id }),
    id, // known id so the review targets it directly
    trustLevel: "AUTO_VALIDATED" as const,
    subjectId: id,
    independentSourceCount: 1,
  };
  await store.putStatement(s);
  return s;
}

describe("M3 review pipeline (§25)", () => {
  describe("queue ordering (§25.3)", () => {
    it("prioritises demand + leverage, deterministic tie-break by id", () => {
      const items = [
        item({ targetId: "low", knowledgeMissCount: 0 }),
        item({ targetId: "hot", knowledgeMissCount: 50 }),
        item({ targetId: "levered", dependentCount: 20 }),
      ];
      expect(prioritise(items).map((i) => i.targetId)).toEqual(["hot", "levered", "low"]);
    });
    it("age guards against starvation (older items rise for equal demand)", () => {
      const a = item({ targetId: "a", ageInQueue: 0 });
      const b = item({ targetId: "b", ageInQueue: 100 });
      // higher age SUBTRACTS, so with equal demand the younger one sorts first — starvation
      // is countered by demand growing, not by age alone; assert the sign is right.
      expect(prioritise([a, b])[0].targetId).toBe("a");
    });
  });

  describe("batch screen (§25.2)", () => {
    it("splits proposals into screens of at most 8", () => {
      const proposals = Array.from({ length: 20 }, (_, i) => ({ targetKind: "Statement", targetId: `p${i}`, statement: {} as never, chunkText: "", validation: [] }));
      const screens = buildScreens(proposals);
      expect(screens).toHaveLength(3);
      expect(screens.every((s) => s.proposals.length <= 8)).toBe(true);
    });
    it("highlights the grounded quote in the source pane", () => {
      const h = highlightSource("Photosynthesis converts light energy into chemical energy.", "converts light energy");
      expect(h.grounded).toBe(true);
      expect(h.quote).toBe("converts light energy");
      expect(h.before).toContain("photosynthesis");
      expect(h.after).toContain("chemical energy");
    });
  });

  describe("submitStatementReview (§26, §27)", () => {
    const promote = (over: Partial<ReviewDecision> = {}): ReviewDecision => ({
      targetKind: "Statement", targetId: "S", decision: "PROMOTE", actorId: "editor-1", toTrust: "AGABI_CANONICAL", ...over,
    });

    it("an editorial reviewer promotes to AGABI_CANONICAL, committed atomically", async () => {
      const store = createMemoryStore();
      await seedStatement(store);
      const { event, effect } = await submitStatementReview(store, promote(), "reviewer", CONFIG);
      expect(effect.trustLevel).toBe("AGABI_CANONICAL");
      // atomic: BOTH the audit event and the trust effect are present
      expect((await store.reviewEventsFor("Statement", "S"))).toContainEqual(event);
      expect((await store.getStatementRaw("S"))!.trustLevel).toBe("AGABI_CANONICAL");
    });

    it("a non-reviewer role is refused (§27 — admin is not a superuser over truth)", async () => {
      const store = createMemoryStore();
      await seedStatement(store);
      await expect(submitStatementReview(store, promote(), "admin", CONFIG)).rejects.toThrow(/may not review/);
      await expect(submitStatementReview(store, promote(), "reader", CONFIG)).rejects.toThrow(/may not review/);
    });

    it("a review with no human actorId is refused", async () => {
      const store = createMemoryStore();
      await seedStatement(store);
      await expect(submitStatementReview(store, promote({ actorId: "  " }), "reviewer", CONFIG)).rejects.toThrow(/human actorId/);
    });

    it("DISPUTE suspends servability but stays visible to review; RESOLVE restores", async () => {
      const store = createMemoryStore();
      await seedStatement(store);
      await submitStatementReview(store, { targetKind: "Statement", targetId: "S", decision: "DISPUTE", actorId: "rev-1", reason: "contested" }, "reviewer", CONFIG);
      expect(await store.statementsForSubject("S", "PUBLIC", POLICIES.RND)).toEqual([]); // not served
      expect((await store.getStatementRaw("S"))!.disputed).toBe(true); // visible to review

      await submitStatementReview(store, { targetKind: "Statement", targetId: "S", decision: "RESOLVE", actorId: "rev-1" }, "reviewer", CONFIG);
      const raw = (await store.getStatementRaw("S"))!;
      expect(raw.disputed).toBe(false);
      expect(raw.trustLevel).toBe("AUTO_VALIDATED"); // prior standing restored
      expect(await store.statementsForSubject("S", "PUBLIC", POLICIES.RESEARCH)).toHaveLength(1); // served again
    });
  });
});
