import { describe, it, expect, vi } from "vitest";
import { resolve, prerequisitesOf, dependentsOf, partsOf, reinforcementsOf } from "@/server/knowledge/search";
import { createMemoryStore } from "@/server/knowledge/store/memory";
import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import type {
  Concept,
  DependencyEdge,
  CompositionEdge,
  ReinforcementEdge,
  ReinforcementType,
  TrustPolicy,
} from "@/server/knowledge/types";

/**
 * search.ts (§15 resolve + §16 graph navigation). The ONLY I/O edge is the injected
 * KnowledgeStore, so it is faked surgically (each method a vi.fn returning exactly what a
 * branch needs). Everything asserted is the module's OWN logic run FOR REAL: rung ordering,
 * the strongest-rung dedup, the rung-3-only-when-empty gate, the kinds filter, the
 * deterministic (rung, then id) sort, and the real bounded-BFS traversals (traverse.ts /
 * dependency / composition / reinforcement are NOT mocked). A final block re-runs the same
 * paths against the REAL in-memory KnowledgeStore as a wiring / red-team proof.
 *
 * Adversarial inputs: empty query, empty text string, resolveSlug none/ambiguous (not
 * "concept"), alias present so trigram must NOT fire, slug+alias collision (dedup keeps the
 * stronger rung), kinds=[] vs kinds=[...], getConcept→null during the kinds filter, depth=0,
 * maxNodes truncation, reinforcement type filter with []/undefined/no-match, Set dedup.
 */

const TP: TrustPolicy = { minimum: "AUTO_VALIDATED", labelBelow: "AUTO_VALIDATED", refuseBelow: "MACHINE_PROPOSED" };

function concept(over: Partial<Concept> & { id: string }): Concept {
  return {
    slug: over.slug ?? over.id,
    name: over.name ?? over.id,
    kind: over.kind ?? "ENTITY",
    scope: over.scope ?? "PUBLIC",
    status: over.status ?? "ACTIVE",
    version: 1,
    supersedes: null,
    mergedInto: null,
    splitInto: [],
    createdAt: new Date("2020-01-01T00:00:00Z"),
    ...over,
  };
}

const dep = (fromId: string, toId: string): DependencyEdge => ({ fromId, toId, strength: 1, contextId: null, version: 1, supersedes: null });
const comp = (partId: string, wholeId: string): CompositionEdge => ({ partId, wholeId, ordinal: null, version: 1 });
const rein = (fromId: string, toId: string, type: ReinforcementType): ReinforcementEdge => ({ fromId, toId, type, strength: 1, earned: false, contextId: null, version: 1 });

type StorePart = Pick<
  KnowledgeStore,
  "resolveSlug" | "conceptsByAlias" | "trigramConcepts" | "getConcept" | "dependencyEdges" | "compositionEdges" | "reinforcementEdges"
>;

function makeStore(over: Partial<StorePart> = {}): KnowledgeStore {
  const s: StorePart = {
    resolveSlug: vi.fn(over.resolveSlug ?? (async () => ({ kind: "none" }) as const)),
    conceptsByAlias: vi.fn(over.conceptsByAlias ?? (async () => [])),
    trigramConcepts: vi.fn(over.trigramConcepts ?? (async () => [])),
    getConcept: vi.fn(over.getConcept ?? (async () => null)),
    dependencyEdges: vi.fn(over.dependencyEdges ?? (async () => [])),
    compositionEdges: vi.fn(over.compositionEdges ?? (async () => [])),
    reinforcementEdges: vi.fn(over.reinforcementEdges ?? (async () => [])),
  };
  return s as unknown as KnowledgeStore;
}

describe("resolve (§15) — rungs, dedup, kinds, deterministic sort", () => {
  it("no text and no kinds → [] and reads nothing", async () => {
    const store = makeStore();
    expect(await resolve(store, { trustPolicy: TP })).toEqual([]);
    expect(vi.mocked(store.resolveSlug)).not.toHaveBeenCalled();
    expect(vi.mocked(store.conceptsByAlias)).not.toHaveBeenCalled();
    expect(vi.mocked(store.trigramConcepts)).not.toHaveBeenCalled();
  });

  it("empty text ('') is falsy → no rung lookups run, returns []", async () => {
    const store = makeStore();
    expect(await resolve(store, { text: "", trustPolicy: TP })).toEqual([]);
    expect(vi.mocked(store.resolveSlug)).not.toHaveBeenCalled();
    expect(vi.mocked(store.conceptsByAlias)).not.toHaveBeenCalled();
  });

  it("rung 1 exact slug: lowercases the query for the store but keeps original case in matchedOn; scope defaults to PUBLIC; trigram is NOT consulted", async () => {
    const store = makeStore({ resolveSlug: async () => ({ kind: "concept", conceptId: "c_photo" }) });
    const hits = await resolve(store, { text: "Photosynthesis", trustPolicy: TP });
    expect(hits).toEqual([{ conceptId: "c_photo", score: 1, rung: 1, matchedOn: "slug:Photosynthesis" }]);
    expect(vi.mocked(store.resolveSlug)).toHaveBeenCalledWith("photosynthesis", "PUBLIC");
    expect(vi.mocked(store.trigramConcepts)).not.toHaveBeenCalled();
  });

  it("threads an explicit scope through every store read", async () => {
    const store = makeStore({
      resolveSlug: async () => ({ kind: "concept", conceptId: "c1" }),
      getConcept: async () => concept({ id: "c1", kind: "SKILL" }),
    });
    const hits = await resolve(store, { text: "term", trustPolicy: TP, scope: "tenant:acme", kinds: ["SKILL"] });
    expect(hits).toEqual([{ conceptId: "c1", score: 1, rung: 1, matchedOn: "slug:term" }]);
    expect(vi.mocked(store.resolveSlug)).toHaveBeenCalledWith("term", "tenant:acme");
    expect(vi.mocked(store.conceptsByAlias)).toHaveBeenCalledWith("term", "tenant:acme");
    expect(vi.mocked(store.getConcept)).toHaveBeenCalledWith("c1", "tenant:acme");
  });

  it("resolveSlug 'none' + no alias + no trigram → [] but trigram IS consulted (hits empty)", async () => {
    const store = makeStore();
    expect(await resolve(store, { text: "unknownterm", trustPolicy: TP })).toEqual([]);
    expect(vi.mocked(store.trigramConcepts)).toHaveBeenCalledWith("unknownterm", "PUBLIC");
  });

  it("resolveSlug 'ambiguous' is NOT a rung-1 hit → falls through to rung-3 trigram, re-sorted by (rung,id)", async () => {
    const store = makeStore({
      resolveSlug: async () => ({ kind: "ambiguous", candidates: ["x1", "x2"] }),
      trigramConcepts: async () => [
        { concept: concept({ id: "c_b" }), score: 0.42, matchedOn: "name:Beta" },
        { concept: concept({ id: "c_a" }), score: 0.9, matchedOn: "alias:Alph" },
      ],
    });
    expect(await resolve(store, { text: "alph", trustPolicy: TP })).toEqual([
      { conceptId: "c_a", score: 0.9, rung: 3, matchedOn: "alias:Alph" },
      { conceptId: "c_b", score: 0.42, rung: 3, matchedOn: "name:Beta" },
    ]);
  });

  it("rung 2 alias hits: score 0.8, matchedOn 'alias:<text>', sorted by id; an alias hit suppresses trigram", async () => {
    const store = makeStore({
      conceptsByAlias: async () => [concept({ id: "c_z" }), concept({ id: "c_a" })],
      trigramConcepts: async () => [{ concept: concept({ id: "c_must_not_appear" }), score: 1, matchedOn: "x" }],
    });
    expect(await resolve(store, { text: "syn", trustPolicy: TP })).toEqual([
      { conceptId: "c_a", score: 0.8, rung: 2, matchedOn: "alias:syn" },
      { conceptId: "c_z", score: 0.8, rung: 2, matchedOn: "alias:syn" },
    ]);
    expect(vi.mocked(store.trigramConcepts)).not.toHaveBeenCalled();
  });

  it("dedup: a concept hit by BOTH slug (rung 1) and alias (rung 2) keeps the stronger rung 1", async () => {
    const store = makeStore({
      resolveSlug: async () => ({ kind: "concept", conceptId: "c_dup" }),
      conceptsByAlias: async () => [concept({ id: "c_dup" }), concept({ id: "c_other" })],
    });
    expect(await resolve(store, { text: "dup", trustPolicy: TP })).toEqual([
      { conceptId: "c_dup", score: 1, rung: 1, matchedOn: "slug:dup" },
      { conceptId: "c_other", score: 0.8, rung: 2, matchedOn: "alias:dup" },
    ]);
  });

  it("kinds filter keeps matching kind, drops a non-matching kind, and drops a concept getConcept returns null for", async () => {
    const kindOf: Record<string, string> = { c_skill: "SKILL", c_entity: "ENTITY" };
    const store = makeStore({
      conceptsByAlias: async () => [concept({ id: "c_skill" }), concept({ id: "c_entity" }), concept({ id: "c_gone" })],
      getConcept: async (id) => (id === "c_gone" ? null : concept({ id, kind: kindOf[id] })),
    });
    expect(await resolve(store, { text: "q", trustPolicy: TP, kinds: ["SKILL"] })).toEqual([
      { conceptId: "c_skill", score: 0.8, rung: 2, matchedOn: "alias:q" },
    ]);
    expect(vi.mocked(store.getConcept)).toHaveBeenCalledTimes(3);
  });

  it("kinds = [] (empty) means NO filter → hit is kept and getConcept is never called", async () => {
    const store = makeStore({ conceptsByAlias: async () => [concept({ id: "c_a" })] });
    expect(await resolve(store, { text: "q", trustPolicy: TP, kinds: [] })).toEqual([
      { conceptId: "c_a", score: 0.8, rung: 2, matchedOn: "alias:q" },
    ]);
    expect(vi.mocked(store.getConcept)).not.toHaveBeenCalled();
  });

  it("sort puts the stronger rung first even when its id sorts LAST (rung beats id)", async () => {
    const store = makeStore({
      resolveSlug: async () => ({ kind: "concept", conceptId: "z_top" }),
      conceptsByAlias: async () => [concept({ id: "a_low" })],
    });
    expect(await resolve(store, { text: "q", trustPolicy: TP })).toEqual([
      { conceptId: "z_top", score: 1, rung: 1, matchedOn: "slug:q" },
      { conceptId: "a_low", score: 0.8, rung: 2, matchedOn: "alias:q" },
    ]);
  });

  it("within one rung, ties break by ascending concept id (both < and > directions)", async () => {
    const store = makeStore({ conceptsByAlias: async () => [concept({ id: "m" }), concept({ id: "a" }), concept({ id: "z" })] });
    const hits = await resolve(store, { text: "q", trustPolicy: TP });
    expect(hits.map((h) => h.conceptId)).toEqual(["a", "m", "z"]);
  });
});

describe("prerequisitesOf (§16, §18B) — forward REQUIRES closure, seed excluded, bounded", () => {
  const store = makeStore({ dependencyEdges: async () => [dep("A", "B"), dep("B", "C")] });

  it("returns prerequisites nearest-first with depth, excluding the seed (depth 2)", async () => {
    expect(await prerequisitesOf(store, "A", 2)).toEqual([
      { conceptId: "B", depth: 1 },
      { conceptId: "C", depth: 2 },
    ]);
  });

  it("depth 1 stops one hop out", async () => {
    expect(await prerequisitesOf(store, "A", 1)).toEqual([{ conceptId: "B", depth: 1 }]);
  });

  it("depth 0 expands nothing → [] (only the excluded seed was reached)", async () => {
    expect(await prerequisitesOf(store, "A", 0)).toEqual([]);
  });

  it("maxNodes cap truncates before the first neighbour is admitted → []", async () => {
    expect(await prerequisitesOf(store, "A", 5, 1)).toEqual([]);
  });

  it("a concept with no outgoing REQUIRES edge → []", async () => {
    expect(await prerequisitesOf(store, "ZZ", 3)).toEqual([]);
  });
});

describe("dependentsOf (§16) — reverse: who REQUIRES this one", () => {
  const store = makeStore({ dependencyEdges: async () => [dep("A", "B"), dep("C", "B"), dep("A", "X")] });

  it("returns every fromId whose edge points AT the concept, in edge order", async () => {
    expect(await dependentsOf(store, "B")).toEqual(["A", "C"]);
  });

  it("single dependent", async () => {
    expect(await dependentsOf(store, "X")).toEqual(["A"]);
  });

  it("nothing depends on it → []", async () => {
    expect(await dependentsOf(store, "NONE")).toEqual([]);
  });
});

describe("partsOf (§11.3, §18B) — reverse PART_OF closure, seed excluded, bounded", () => {
  const store = makeStore({ compositionEdges: async () => [comp("p1", "W"), comp("p2", "W"), comp("sub", "p1")] });

  it("returns the transitive component parts (default depth 3), excluding the seed", async () => {
    expect(await partsOf(store, "W")).toEqual(["p1", "p2", "sub"]);
  });

  it("depth 1 returns only the direct parts", async () => {
    expect(await partsOf(store, "W", 1)).toEqual(["p1", "p2"]);
  });

  it("a leaf whole with no parts → []", async () => {
    expect(await partsOf(store, "sub")).toEqual([]);
  });

  it("maxNodes cap truncates immediately → []", async () => {
    expect(await partsOf(store, "W", 3, 1)).toEqual([]);
  });
});

describe("reinforcementsOf (§11.2) — cyclic graph, optional type filter, Set-deduped", () => {
  const edges = [
    rein("X", "Y", "ENABLES"),
    rein("X", "Z", "REINFORCES"),
    rein("X", "Y", "COMMON_CONFUSION"),
    rein("W", "Q", "ENABLES"),
  ];
  const store = makeStore({ reinforcementEdges: async () => edges });

  it("no type filter → all outgoing neighbours, deduped (Y appears twice → once)", async () => {
    expect(await reinforcementsOf(store, "X")).toEqual(["Y", "Z"]);
  });

  it("empty type array is treated as NO filter (falls to the else branch)", async () => {
    expect(await reinforcementsOf(store, "X", [])).toEqual(["Y", "Z"]);
  });

  it("single type filter selects only that edge type", async () => {
    expect(await reinforcementsOf(store, "X", ["ENABLES"])).toEqual(["Y"]);
  });

  it("multiple types are unioned then Set-deduped (both point at Y → one Y)", async () => {
    expect(await reinforcementsOf(store, "X", ["ENABLES", "COMMON_CONFUSION"])).toEqual(["Y"]);
  });

  it("a type with no matching edge → []", async () => {
    expect(await reinforcementsOf(store, "X", ["TRANSFER_TO"])).toEqual([]);
  });

  it("a concept with no outgoing reinforcement edges → []", async () => {
    expect(await reinforcementsOf(store, "NOBODY")).toEqual([]);
  });
});

describe("wired against the REAL in-memory KnowledgeStore (§17 conformance impl — red-team)", () => {
  it("resolve rung 1 exact slug against the real store returns the concept's opaque id", async () => {
    const store = createMemoryStore();
    const photo = concept({ id: "cid_photo", slug: "photosynthesis", name: "Photosynthesis", kind: "SKILL" });
    await store.putConcept(photo);
    expect(await resolve(store, { text: "Photosynthesis", trustPolicy: TP })).toEqual([
      { conceptId: "cid_photo", score: 1, rung: 1, matchedOn: "slug:Photosynthesis" },
    ]);
  });

  it("resolve rung 2 alias against the real store (exact, case-sensitive alias index)", async () => {
    const store = createMemoryStore();
    const photo = concept({ id: "cid_photo", slug: "photosynthesis", name: "Photosynthesis", kind: "SKILL" });
    await store.putConcept(photo);
    await store.putConceptAlias({ conceptId: "cid_photo", alias: "Photo", language: "en", kind: "SYNONYM" });
    expect(await resolve(store, { text: "Photo", trustPolicy: TP })).toEqual([
      { conceptId: "cid_photo", score: 0.8, rung: 2, matchedOn: "alias:Photo" },
    ]);
  });

  it("kinds filter against the real store drops a non-matching kind and keeps a matching one", async () => {
    const store = createMemoryStore();
    await store.putConcept(concept({ id: "cid_photo", slug: "photosynthesis", name: "Photosynthesis", kind: "SKILL" }));
    expect(await resolve(store, { text: "Photosynthesis", trustPolicy: TP, kinds: ["ENTITY"] })).toEqual([]);
    expect(await resolve(store, { text: "Photosynthesis", trustPolicy: TP, kinds: ["SKILL"] })).toEqual([
      { conceptId: "cid_photo", score: 1, rung: 1, matchedOn: "slug:Photosynthesis" },
    ]);
  });

  it("graph navigation against the real store: prerequisitesOf + dependentsOf over a REQUIRES chain", async () => {
    const store = createMemoryStore();
    await store.putDependencyEdge(dep("calculus", "algebra"));
    await store.putDependencyEdge(dep("algebra", "arithmetic"));
    expect(await prerequisitesOf(store, "calculus", 5)).toEqual([
      { conceptId: "algebra", depth: 1 },
      { conceptId: "arithmetic", depth: 2 },
    ]);
    expect(await dependentsOf(store, "arithmetic")).toEqual(["algebra"]);
  });

  it("graph navigation against the real store: partsOf + reinforcementsOf", async () => {
    const store = createMemoryStore();
    await store.putCompositionEdge(comp("wall", "house"));
    await store.putCompositionEdge(comp("brick", "wall"));
    expect(await partsOf(store, "house")).toEqual(["wall", "brick"]);

    await store.putReinforcementEdge(rein("functions", "derivatives", "ENABLES"));
    await store.putReinforcementEdge(rein("functions", "optimisation", "REVISITS"));
    expect(await reinforcementsOf(store, "functions")).toEqual(["derivatives", "optimisation"]);
    expect(await reinforcementsOf(store, "functions", ["ENABLES"])).toEqual(["derivatives"]);
  });
});
