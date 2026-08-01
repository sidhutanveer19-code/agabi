import { describe, it, expect } from "vitest";
import { createMemoryStore } from "@/server/knowledge/store/memory";
import { selectPath, cachedPrerequisites } from "@/server/knowledge/path";
import { POLICIES } from "@/server/knowledge/trust/policy";
import type { DependencyEdge } from "@/server/knowledge/types";

// `A REQUIRES B` (B is a prerequisite of A) — edge from=A, to=B.
const dep = (fromId: string, toId: string): DependencyEdge => ({
  fromId,
  toId,
  strength: 1,
  contextId: null,
  version: 1,
  supersedes: null,
});

/**
 * Mutation-killing tests for src/server/knowledge/path.ts. Each test pins the EXACT
 * observable output the mutation would change; comments name the mutant(s) killed.
 */
describe("path.ts — mutation kills", () => {
  describe("selectPath — scoped-edge filter (L44)", () => {
    // Two seeds a,b whose closure is budget-capped to exactly {a,b}; the graph also holds
    // an out-of-scope node z on the path a→z→b. With the correct `&&` filter both edges
    // (a→z, z→b) are dropped, so a and b are isolated and sort to ["a","b"]. Any mutation
    // that keeps those edges — predicate → true, `&&` → `||`, or dropping `.filter`
    // entirely (→ `edges`) — routes a before/after z into Kahn and yields ["b","a"].
    it("drops edges touching out-of-scope nodes, keeping isolated seeds sorted", async () => {
      const store = createMemoryStore();
      await store.putDependencyEdge(dep("a", "z")); // a REQUIRES z (z is out of the capped scope)
      await store.putDependencyEdge(dep("z", "b")); // z REQUIRES b

      const plan = await selectPath(store, {
        seeds: ["a", "b"],
        policy: POLICIES.RESEARCH,
        budget: { maxConcepts: 2 }, // cap so z never enters the closure
      });

      // Correct: z is out of scope → both edges filtered → a,b isolated → sorted.
      expect(plan.concepts).toEqual(["a", "b"]);
    });
  });

  describe("selectPath — isolated concepts sorted (L49)", () => {
    // No edges at all: every seed is isolated. The Set preserves insertion order [c,a,b];
    // only the `.sort()` turns that into ["a","b","c"]. Dropping `.sort()` yields ["c","a","b"].
    it("sorts isolated concepts deterministically regardless of seed order", async () => {
      const store = createMemoryStore();

      const plan = await selectPath(store, {
        seeds: ["c", "a", "b"],
        policy: POLICIES.RESEARCH,
        budget: { maxConcepts: 50 },
      });

      expect(plan.concepts).toEqual(["a", "b", "c"]);
    });
  });

  describe("selectPath — budget slice + truncated flag (L50, L52)", () => {
    // Three seeds but a 2-concept budget. Seeds are always admitted to `inScope` (even past
    // the budget), so inScope.size (3) exceeds maxConcepts (2) while the BFS closure itself
    // is NOT truncated. This isolates two behaviours:
    //   L50  `.slice(0, maxConcepts)` — without it concepts would be ["a","b","c"].
    //   L52  `closure.truncated || inScope.size > maxConcepts` — the RIGHT operand is the
    //        only thing true here, so `|| false` (ConditionalExpression → false) flips it.
    it("truncates to the budget and reports truncation from oversized scope", async () => {
      const store = createMemoryStore();

      const plan = await selectPath(store, {
        seeds: ["a", "b", "c"],
        policy: POLICIES.RESEARCH,
        budget: { maxConcepts: 2 },
      });

      expect(plan.concepts).toEqual(["a", "b"]); // sliced to 2
      expect(plan.truncated).toBe(true); // driven solely by inScope.size > maxConcepts
    });
  });

  describe("selectPath — not-truncated cases (L52 boundary)", () => {
    // A real chain well within budget: closure not truncated, inScope.size (3) < budget (50).
    // truncated must be false. Kills:
    //   L52:33 ConditionalExpression → true (would force truncated=true),
    //   L52:54 EqualityOperator `>` → `<=` (3 <= 50 is true, flipping truncated to true).
    it("reports truncated=false when the whole closure fits the budget", async () => {
      const store = createMemoryStore();
      await store.putDependencyEdge(dep("algebra", "arithmetic"));
      await store.putDependencyEdge(dep("calculus", "algebra"));

      const plan = await selectPath(store, {
        seeds: ["calculus"],
        policy: POLICIES.RESEARCH,
        budget: { maxConcepts: 50 },
      });

      expect(plan.concepts).toEqual(["arithmetic", "algebra", "calculus"]);
      expect(plan.truncated).toBe(false);
    });

    // Boundary: inScope.size (2) EXACTLY equals the budget (2), nothing truncated.
    // With correct `>`, 2 > 2 is false → truncated=false. Kills:
    //   L52:54 EqualityOperator `>` → `>=` (2 >= 2 is true, flipping truncated to true),
    //   and re-covers the `<=` / →true mutations at the equality boundary.
    it("reports truncated=false when scope size equals the budget exactly", async () => {
      const store = createMemoryStore();

      const plan = await selectPath(store, {
        seeds: ["a", "b"], // no edges → 2 isolated concepts, exactly the budget
        policy: POLICIES.RESEARCH,
        budget: { maxConcepts: 2 },
      });

      expect(plan.concepts).toEqual(["a", "b"]);
      expect(plan.truncated).toBe(false);
    });
  });

  describe("cachedPrerequisites — cache-hit short-circuit (L68)", () => {
    // A cache entry that could NOT have come from a recompute (the graph is empty, so a
    // recompute would return []). The correct `if (cached) return cached.closure` returns the
    // stored value verbatim; `if (false)` (ConditionalExpression → false) recomputes [] instead.
    it("returns the cached closure verbatim on a hit, never recomputing", async () => {
      const store = createMemoryStore();
      await store.putClosure({
        conceptId: "solo",
        releaseId: "rel-hit",
        closure: ["CACHED_SENTINEL"],
        computedAt: new Date(),
      });

      const result = await cachedPrerequisites(store, "solo", "rel-hit", { maxConcepts: 5 });

      expect(result).toEqual(["CACHED_SENTINEL"]);
    });
  });

  describe("cachedPrerequisites — cache-miss recompute (L71, L72, L74, L75)", () => {
    // Fresh store (miss) with a budget that caps the closure so `mid` stays out of scope but
    // its edges (a→mid, mid→b) exist. Correct output is ["a","b","top"]:
    //   L71 seeds `[conceptId]` → `[]`            : empty closure → result [].
    //   L72 `closure.nodes.map((n)=>n.id)` gutted : inScope loses real ids → result [].
    //   L74 scoped-edge filter (→edges / →true / →|| / arrow→undefined / →false):
    //        keeping a→mid & mid→b (or dropping all) reorders a,b to ["b","a",...] or [].
    //   L75 final `.filter((id)=>inScope.has(id))` arrow → undefined : keeps nothing → [].
    it("recomputes the exact ordered closure, honouring the scope filter", async () => {
      const store = createMemoryStore();
      await store.putDependencyEdge(dep("top", "a")); // top REQUIRES a
      await store.putDependencyEdge(dep("top", "b")); // top REQUIRES b
      await store.putDependencyEdge(dep("a", "mid")); // a REQUIRES mid (mid capped out of scope)
      await store.putDependencyEdge(dep("mid", "b")); // mid REQUIRES b

      const result = await cachedPrerequisites(store, "top", "rel1", { maxConcepts: 3 });

      expect(result).toEqual(["a", "b", "top"]);

      // it also stored exactly that ordered closure under (top, rel1)
      const stored = await store.getClosure("top", "rel1");
      expect(stored?.closure).toEqual(["a", "b", "top"]);
    });
  });
});
