import { describe, it, expect } from "vitest";
import { createMemoryObservationStore } from "@/server/observation/store";
import { record } from "@/server/observation/record";
import { mastery } from "@/server/observation/mastery";
import { efficacy } from "@/server/observation/efficacy";
import { earnedEdges } from "@/server/observation/earn";
import { createMemoryStore } from "@/server/knowledge/store/memory";
import { buildConcept } from "@/server/knowledge/concept";
import type { NewObservation } from "@/server/observation/types";

const obs = (over: Partial<NewObservation>): NewObservation => ({
  learnerId: "L1", conceptIds: ["photosynthesis"], contextId: "ctx", outcome: { success: true }, releaseId: "2026-01-01-01", ...over,
});

describe("M8 observation store (L6, §17.1, §20.2, §27.2)", () => {
  it("record requires a contextId (§20.3 — split-resolvable)", async () => {
    const store = createMemoryObservationStore();
    await expect(record(store, obs({ contextId: "" }))).rejects.toThrow(/contextId/);
  });

  // mastery-purity (§20.2): the estimate is recomputed from observations, never a stored row.
  it("mastery is a pure query — it moves as observations accumulate", async () => {
    const store = createMemoryObservationStore();
    await record(store, obs({ outcome: { success: true } }));
    await record(store, obs({ outcome: { success: false } }));
    expect((await mastery(store, "L1", "photosynthesis")).estimate).toBeCloseTo(0.5);
    await record(store, obs({ outcome: { success: true } }));
    expect((await mastery(store, "L1", "photosynthesis")).estimate).toBeCloseTo(2 / 3);
    // asOf reinterprets history, never invalidates it
    expect((await mastery(store, "L1", "photosynthesis", undefined, new Date(0))).observations).toBe(0);
  });

  it("efficacy is derived from observations, not authored (§13.4)", async () => {
    const store = createMemoryObservationStore();
    await record(store, obs({ assetIds: ["a1"], outcome: { success: true } }));
    await record(store, obs({ assetIds: ["a1"], outcome: { success: false } }));
    const e = await efficacy(store, "a1");
    expect(e.exposures).toBe(2);
    expect(e.rate).toBeCloseTo(0.5);
  });

  // store-separation (§29, §17.1): the observation modules run with NO knowledge store —
  // nothing joins the two. (The import-level guarantee is W4 in architecture.test.)
  it("store-separation — all observation queries run without any knowledge store", async () => {
    const store = createMemoryObservationStore();
    await record(store, obs({}));
    // mastery/efficacy/earn take ONLY the observation store — there is no knowledge handle to pass.
    expect(await mastery(store, "L1", "photosynthesis")).toBeTruthy();
    expect(await efficacy(store, "a1")).toBeTruthy();
    expect(await earnedEdges(store)).toBeTruthy();
  });

  // erasure-leaves-knowledge-intact (§27.2): a DPDP purge on observations touches no knowledge.
  it("purgeUser erases a learner's observations and leaves knowledge intact", async () => {
    const obsStore = createMemoryObservationStore();
    const knowledge = createMemoryStore();
    await knowledge.putConcept(buildConcept({ name: "Photosynthesis", slug: "photosynthesis" }));
    await record(obsStore, obs({ learnerId: "L1" }));
    await record(obsStore, obs({ learnerId: "L2" }));

    const removed = await obsStore.purgeUser("L1");
    expect(removed).toBe(1);
    expect(await obsStore.byLearner("L1")).toEqual([]);
    expect(await obsStore.byLearner("L2")).toHaveLength(1); // other learners untouched
    // the knowledge graph is completely unaffected — separate store (L6)
    expect(await knowledge.resolveSlug("photosynthesis", "PUBLIC")).toMatchObject({ kind: "concept" });
  });

  // earned-edge-appears (§11.2): a consistent cross-learner pattern derives a REINFORCES edge.
  it("earnedEdges derives a REINFORCES edge from a repeated success pattern", async () => {
    const store = createMemoryObservationStore();
    const t = (ms: number) => new Date(1_000_000 + ms);
    for (const learnerId of ["L1", "L2"]) {
      await record(store, obs({ learnerId, conceptIds: ["X"], occurredAt: t(1), outcome: { success: true } }));
      await record(store, obs({ learnerId, conceptIds: ["Y"], occurredAt: t(2), outcome: { success: true } }));
    }
    const edges = await earnedEdges(store, 2);
    expect(edges).toContainEqual(expect.objectContaining({ fromId: "X", toId: "Y", type: "REINFORCES", earned: true }));
    // one learner alone is not enough evidence
    expect(await earnedEdges(store, 3)).toEqual([]);
  });
});
