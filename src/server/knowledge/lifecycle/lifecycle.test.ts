import { describe, it, expect } from "vitest";
import { createMemoryStore } from "@/server/knowledge/store/memory";
import { buildConcept } from "@/server/knowledge/concept";
import { buildStatement } from "@/server/knowledge/statement";
import { POLICIES } from "@/server/knowledge/trust/policy";
import { canTransition, assertTransition, lifecycleOf } from "@/server/knowledge/lifecycle/lifecycle";
import { transitionStatement, statementLifecycle } from "@/server/knowledge/lifecycle/transition";
import { listByState, stateCounts } from "@/server/knowledge/lifecycle/workspace";

async function seedStatement(store: ReturnType<typeof createMemoryStore>) {
  const c = buildConcept({ name: "Cell" });
  await store.putConcept(c);
  const ctx = await store.putContext({});
  const s = buildStatement({ kind: "FACT", form: "SPO", structure: { subjectId: c.id, predicate: "has", objectLit: "membrane" }, text: "a cell has a membrane", contextId: ctx.id });
  await store.putStatement(s);
  return s;
}

describe("lifecycle state machine (W8) — pure core", () => {
  it("permits only legal transitions; illegal throws", () => {
    expect(canTransition("DRAFT", "IN_REVIEW")).toBe(true);
    expect(canTransition("DRAFT", "PUBLISHED")).toBe(false); // may not skip review
    expect(canTransition("ARCHIVED", "PUBLISHED")).toBe(false); // terminal
    expect(() => assertTransition("DRAFT", "PUBLISHED")).toThrow(/illegal lifecycle transition/);
  });

  it("derives state from trust + supersession + review history", () => {
    expect(lifecycleOf({ trustLevel: "MACHINE_PROPOSED", superseded: false, decisions: [] })).toBe("DRAFT");
    expect(lifecycleOf({ trustLevel: "MACHINE_PROPOSED", superseded: false, decisions: ["REVIEW"] })).toBe("IN_REVIEW");
    expect(lifecycleOf({ trustLevel: "COMMUNITY_REVIEWED", superseded: false, decisions: ["PROMOTE"] })).toBe("APPROVED");
    expect(lifecycleOf({ trustLevel: "COMMUNITY_REVIEWED", superseded: false, decisions: ["PROMOTE", "PUBLISH"] })).toBe("PUBLISHED");
    expect(lifecycleOf({ trustLevel: "COMMUNITY_REVIEWED", superseded: false, decisions: ["PUBLISH", "ARCHIVE"] })).toBe("ARCHIVED");
    expect(lifecycleOf({ trustLevel: "AGABI_CANONICAL", superseded: true, decisions: [] })).toBe("DEPRECATED");
  });
});

describe("lifecycle transitions (W8) — governed, append-only, over the store", () => {
  it("walks DRAFT→IN_REVIEW→APPROVED→PUBLISHED and rejects an illegal jump", async () => {
    const store = createMemoryStore();
    const s = await seedStatement(store);
    expect(await statementLifecycle(store, s.id)).toBe("DRAFT");

    await expect(transitionStatement(store, s.id, "PUBLISHED", "human")).rejects.toThrow(/illegal/);

    await transitionStatement(store, s.id, "IN_REVIEW", "human");
    expect(await statementLifecycle(store, s.id)).toBe("IN_REVIEW");

    await transitionStatement(store, s.id, "APPROVED", "human", "checked against source");
    expect(await statementLifecycle(store, s.id)).toBe("APPROVED");
    expect((await store.getStatementRaw(s.id))?.trustLevel).toBe("COMMUNITY_REVIEWED"); // crossed the human floor

    await transitionStatement(store, s.id, "PUBLISHED", "human");
    expect(await statementLifecycle(store, s.id)).toBe("PUBLISHED");
  });

  // §26.2 — the invariant the whole trust ladder rests on. Until this test existed, a machine or
  // blank actor could promote a statement past the machine ceiling and all 332 tests still passed,
  // because none of them ever supplied a non-human actor.
  it("refuses promotion above AUTO_VALIDATED without a human actorId (§26.2)", async () => {
    const store = createMemoryStore();
    const s = await seedStatement(store);
    await transitionStatement(store, s.id, "IN_REVIEW", "human");

    for (const machine of ["", "   ", "system:ingest", "SYSTEM:cron"]) {
      await expect(transitionStatement(store, s.id, "APPROVED", machine)).rejects.toThrow(/human actorId/);
    }

    // nothing was written on any refused attempt — not the event, not the trust level
    expect(await store.reviewEventsFor("Statement", s.id)).toHaveLength(1); // the IN_REVIEW one only
    expect((await store.getStatementRaw(s.id))?.trustLevel).toBe("MACHINE_PROPOSED");

    // and a real reviewer still gets through
    await transitionStatement(store, s.id, "APPROVED", "reviewer:tanveer");
    expect((await store.getStatementRaw(s.id))?.trustLevel).toBe("COMMUNITY_REVIEWED");
  });

  // The legal branches nobody walked: only APPROVED→PUBLISHED was store-tested, so a divergence
  // between DECISION_FOR and the TRANSITIONS table on any other edge would have gone unnoticed.
  it("walks APPROVED→DEPRECATED→ARCHIVED through the store, not just the pure table", async () => {
    const store = createMemoryStore();
    const s = await seedStatement(store);
    await transitionStatement(store, s.id, "IN_REVIEW", "human");
    await transitionStatement(store, s.id, "APPROVED", "human");

    await transitionStatement(store, s.id, "DEPRECATED", "human", "superseded by a newer edition");
    expect(await statementLifecycle(store, s.id)).toBe("DEPRECATED");

    await transitionStatement(store, s.id, "ARCHIVED", "human");
    expect(await statementLifecycle(store, s.id)).toBe("ARCHIVED");

    // ARCHIVED is terminal — nothing legal follows it
    await expect(transitionStatement(store, s.id, "PUBLISHED", "human")).rejects.toThrow(/illegal/);
  });

  it("workspace groups objects by lifecycle state", async () => {
    const store = createMemoryStore();
    const s = await seedStatement(store);
    await transitionStatement(store, s.id, "IN_REVIEW", "human");

    const counts = await stateCounts(store, "PUBLIC", POLICIES.RND);
    expect(counts.IN_REVIEW).toBe(1);
    expect(counts.DRAFT).toBe(0);
    expect((await listByState(store, "PUBLIC", POLICIES.RND)).IN_REVIEW).toEqual([s.id]);
  });
});
