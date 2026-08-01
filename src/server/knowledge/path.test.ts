import { describe, it, expect } from "vitest";
import { createMemoryStore } from "@/server/knowledge/store/memory";
import { buildConcept } from "@/server/knowledge/concept";
import { selectPath, cachedPrerequisites, outlineFrom } from "@/server/knowledge/path";
import { resolve, prerequisitesOf, partsOf, reinforcementsOf } from "@/server/knowledge/search";
import { curriculumFor, conceptsUnder } from "@/server/knowledge/curriculum";
import { POLICIES } from "@/server/knowledge/trust/policy";
import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import type { DependencyEdge } from "@/server/knowledge/types";

const dep = (fromId: string, toId: string): DependencyEdge => ({ fromId, toId, strength: 1, contextId: null, version: 1, supersedes: null });

// calculus REQUIRES algebra REQUIRES arithmetic
async function seedGraph(store: KnowledgeStore) {
  for (const name of ["arithmetic", "algebra", "calculus"]) await store.putConcept(buildConcept({ name, slug: name }));
  await store.putDependencyEdge(dep("algebra", "arithmetic"));
  await store.putDependencyEdge(dep("calculus", "algebra"));
}

const budget = { maxConcepts: 50 };

describe("M4 search + paths + curriculum (§15, §16, §18)", () => {
  describe("selectPath (§18B.3)", () => {
    it("orders prerequisites first, deterministically (snapshot)", async () => {
      const store = createMemoryStore();
      await seedGraph(store);
      const plan = await selectPath(store, { seeds: ["calculus"], policy: POLICIES.RESEARCH, budget });
      expect(plan.concepts).toEqual(["arithmetic", "algebra", "calculus"]);
      expect(plan.policyFloor).toBe("AUTO_VALIDATED");
      // determinism: identical graph + seeds → identical plan
      const again = await selectPath(store, { seeds: ["calculus"], policy: POLICIES.RESEARCH, budget });
      expect(again.concepts).toEqual(plan.concepts);
      expect(outlineFrom(plan)).toEqual(plan.concepts);
    });

    it("truncates and reports it when the closure exceeds the budget", async () => {
      const store = createMemoryStore();
      await seedGraph(store);
      const plan = await selectPath(store, { seeds: ["calculus"], policy: POLICIES.RESEARCH, budget: { maxConcepts: 2 } });
      expect(plan.concepts.length).toBeLessThanOrEqual(2);
      expect(plan.truncated).toBe(true);
    });
  });

  // curriculum-independence (§29, S1): the graph is teachable with NO curriculum, and adding
  // a mapping never changes a path — knowledge does not reference curriculum (L7).
  describe("curriculum-independence", () => {
    it("selectPath works with zero programs, and a mapping does not change it", async () => {
      const store = createMemoryStore();
      await seedGraph(store);
      const before = await selectPath(store, { seeds: ["calculus"], policy: POLICIES.RESEARCH, budget });

      await store.putProgram({ id: "p1", slug: "cbse", name: "CBSE", kind: "SCHOOL_BOARD", authority: "NCERT", jurisdiction: "IN", scope: "PUBLIC", version: "2026" });
      await store.putProgramNode({ id: "n1", programId: "p1", parentId: null, nodeKind: "UNIT", name: "Algebra", ordinal: 1, code: null });
      await store.putMapping({ programNodeId: "n1", conceptId: "algebra", depth: "MASTER", ordinal: 1, examWeight: 0.3, required: true });

      const after = await selectPath(store, { seeds: ["calculus"], policy: POLICIES.RESEARCH, budget });
      expect(after.concepts).toEqual(before.concepts); // curriculum did not perturb the path

      // the mapping layer is queryable, separately
      expect(await curriculumFor(store, "algebra")).toHaveLength(1);
      expect(await conceptsUnder(store, "n1")).toHaveLength(1);
    });
  });

  // cache-rebuild (§18, ADR-11): rebuildable, byte-identical after a clear.
  describe("closure cache", () => {
    it("rebuilds byte-identical after clear-all invalidation", async () => {
      const store = createMemoryStore();
      await seedGraph(store);
      const first = await cachedPrerequisites(store, "calculus", "2026-01-01-01", budget);
      expect(await store.getClosure("calculus", "2026-01-01-01")).not.toBeNull(); // it cached

      await store.clearClosures();
      expect(await store.getClosure("calculus", "2026-01-01-01")).toBeNull(); // cleared

      const rebuilt = await cachedPrerequisites(store, "calculus", "2026-01-01-01", budget);
      expect(rebuilt).toEqual(first); // byte-identical rebuild
    });
  });

  describe("search (§15)", () => {
    it("rung 1 resolves an exact slug; rung 2 resolves an alias", async () => {
      const store = createMemoryStore();
      const c = buildConcept({ name: "Chlorophyll" });
      await store.putConcept(c);
      await store.putConceptAlias({ conceptId: c.id, alias: "chlorophyl", language: "en", kind: "MISSPELLING" });

      const bySlug = await resolve(store, { text: "chlorophyll", trustPolicy: POLICIES.GENERAL_SCHOOL });
      expect(bySlug).toEqual([{ conceptId: c.id, score: 1, rung: 1, matchedOn: "slug:chlorophyll" }]);

      const byAlias = await resolve(store, { text: "chlorophyl", trustPolicy: POLICIES.GENERAL_SCHOOL });
      expect(byAlias[0]).toMatchObject({ conceptId: c.id, rung: 2 });
    });

    it("trustPolicy is REQUIRED — omitting it fails to compile", async () => {
      const store = createMemoryStore();
      // @ts-expect-error trustPolicy has no default (§15) — this must not type-check
      await resolve(store, { text: "x" });
    });

    it("graph navigation resolves the three graphs apart", async () => {
      const store = createMemoryStore();
      await seedGraph(store);
      await store.putCompositionEdge({ partId: "chapter", wholeId: "book", ordinal: 1, version: 1 });
      await store.putReinforcementEdge({ fromId: "calculus", toId: "physics", type: "TRANSFER_TO", strength: 1, earned: false, contextId: null, version: 1 });

      const prereqs = await prerequisitesOf(store, "calculus", 5);
      expect(prereqs.map((p) => p.conceptId).sort()).toEqual(["algebra", "arithmetic"]);
      expect(await partsOf(store, "book")).toEqual(["chapter"]);
      expect(await reinforcementsOf(store, "calculus", ["TRANSFER_TO"])).toEqual(["physics"]);
    });
  });
});
