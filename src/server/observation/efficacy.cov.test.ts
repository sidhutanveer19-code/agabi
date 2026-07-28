import { describe, it, expect } from "vitest";
import { createMemoryObservationStore, type ObservationStore } from "@/server/observation/store";
import { record } from "@/server/observation/record";
import { efficacy } from "@/server/observation/efficacy";
import type { NewObservation } from "@/server/observation/types";

/**
 * §H1 coverage for `efficacy` (§13.4) — the pure "did learners who received this asset succeed
 * afterwards?" query. Every branch is pinned: the `if (contextId)` filter (both sides, plus the
 * empty-string falsy edge), the `contextId ?? null` fallback (present / undefined / ""), and the
 * `exposures > 0 ? rate : 0` division guard (zero-exposure and non-zero). Real memory store, real
 * `record` path — no mocks (only I/O would be mocked, and there is none here).
 */

const obs = (over: Partial<NewObservation>): NewObservation => ({
  learnerId: "L1",
  conceptIds: ["photosynthesis"],
  contextId: "ctx",
  outcome: { success: true },
  releaseId: "2026-01-01-01",
  ...over,
});

async function seed(store: ObservationStore, rows: Partial<NewObservation>[]): Promise<void> {
  for (const r of rows) await record(store, obs(r));
}

describe("efficacy (§13.4) — asset efficacy is derived, never authored", () => {
  it("no observations for the asset → zeroed estimate with a null context", async () => {
    const store = createMemoryObservationStore();
    // asset the store has never seen: forAsset returns [] → the exposures>0 guard's FALSE arm.
    const e = await efficacy(store, "never-seen");
    expect(e).toEqual({
      assetId: "never-seen",
      contextId: null,
      exposures: 0,
      subsequentSuccess: 0,
      rate: 0,
    });
  });

  it("mixed outcomes, no context filter → rate is successes / exposures", async () => {
    const store = createMemoryObservationStore();
    await seed(store, [
      { assetIds: ["a1"], outcome: { success: true } },
      { assetIds: ["a1"], outcome: { success: false } },
      { assetIds: ["a1"], outcome: { success: true } },
    ]);
    const e = await efficacy(store, "a1");
    expect(e).toEqual({
      assetId: "a1",
      contextId: null, // no contextId argument → the `?? null` fallback
      exposures: 3,
      subsequentSuccess: 2,
      rate: 2 / 3, // 2 successes over 3 exposures — kills a `*`/`+` swap for `/`
    });
  });

  it("all successes → rate is exactly 1", async () => {
    const store = createMemoryObservationStore();
    await seed(store, [
      { assetIds: ["a2"], outcome: { success: true } },
      { assetIds: ["a2"], outcome: { success: true } },
    ]);
    const e = await efficacy(store, "a2");
    expect(e.exposures).toBe(2);
    expect(e.subsequentSuccess).toBe(2);
    expect(e.rate).toBe(1); // kills a `success` → false mutant (would give 0)
  });

  it("all failures → exposures>0 but rate is exactly 0", async () => {
    const store = createMemoryObservationStore();
    await seed(store, [
      { assetIds: ["a3"], outcome: { success: false } },
      { assetIds: ["a3"], outcome: { success: false } },
    ]);
    const e = await efficacy(store, "a3");
    // distinct from the "no observations" case: here exposures is non-zero yet rate is 0.
    expect(e.exposures).toBe(2);
    expect(e.subsequentSuccess).toBe(0);
    expect(e.rate).toBe(0); // kills a `success` → true mutant (would give 2/2 = 1)
  });

  it("contextId narrows the population to that context (§13.4 per-context)", async () => {
    const store = createMemoryObservationStore();
    await seed(store, [
      { assetIds: ["a1"], contextId: "ctxA", outcome: { success: true } },
      { assetIds: ["a1"], contextId: "ctxA", outcome: { success: false } },
      { assetIds: ["a1"], contextId: "ctxB", outcome: { success: true } },
    ]);

    const scoped = await efficacy(store, "a1", "ctxA");
    expect(scoped).toEqual({
      assetId: "a1",
      contextId: "ctxA", // provided context is echoed back, not null
      exposures: 2, // ctxB observation is excluded by the filter
      subsequentSuccess: 1,
      rate: 0.5,
    });

    // Same asset, no filter → the ctxB row is counted, proving the filter actually removed it.
    const unscoped = await efficacy(store, "a1");
    expect(unscoped.exposures).toBe(3);
    expect(unscoped.subsequentSuccess).toBe(2);
    expect(unscoped.contextId).toBeNull();
  });

  it("contextId with zero matches → zeroed estimate but context still echoed (not null)", async () => {
    const store = createMemoryObservationStore();
    await seed(store, [{ assetIds: ["a1"], contextId: "ctxA", outcome: { success: true } }]);
    const e = await efficacy(store, "a1", "ctxZ");
    expect(e).toEqual({
      assetId: "a1",
      contextId: "ctxZ", // present-but-unmatched context is NOT collapsed to null
      exposures: 0,
      subsequentSuccess: 0,
      rate: 0,
    });
  });

  it("empty-string contextId is falsy → no filter, and `?? null` keeps the empty string", async () => {
    const store = createMemoryObservationStore();
    await seed(store, [
      { assetIds: ["a4"], contextId: "ctx1", outcome: { success: true } },
      { assetIds: ["a4"], contextId: "ctx2", outcome: { success: false } },
    ]);
    const e = await efficacy(store, "a4", "");
    // `if ("")` is false → both rows survive (a `!= null`/`!== undefined` guard would drop them).
    expect(e.exposures).toBe(2);
    expect(e.subsequentSuccess).toBe(1);
    expect(e.rate).toBe(0.5);
    // `"" ?? null` is "" — a `||` in place of `??` would have produced null here.
    expect(e.contextId).toBe("");
  });

  it("only the requested asset is counted — other assets are ignored", async () => {
    const store = createMemoryObservationStore();
    await seed(store, [
      { assetIds: ["a1"], outcome: { success: true } },
      { assetIds: ["a2"], outcome: { success: false } },
    ]);
    const e = await efficacy(store, "a1");
    expect(e.assetId).toBe("a1");
    expect(e.exposures).toBe(1); // the a2 observation must not leak in
    expect(e.rate).toBe(1);
  });

  it("an observation attached to multiple assets counts for each of them", async () => {
    const store = createMemoryObservationStore();
    await seed(store, [{ assetIds: ["a5", "a6"], outcome: { success: true } }]);
    expect((await efficacy(store, "a5")).exposures).toBe(1);
    expect((await efficacy(store, "a6")).exposures).toBe(1);
  });

  it("efficacy is POPULATION-wide, not learner-scoped — it aggregates across every learner", async () => {
    const store = createMemoryObservationStore();
    // three different learners all exposed to the same asset. efficacy (§13.4) asks "did learners
    // who received this asset succeed?", not "did THIS learner" — so all three must be counted.
    await seed(store, [
      { learnerId: "L1", assetIds: ["ax"], outcome: { success: true } },
      { learnerId: "L2", assetIds: ["ax"], outcome: { success: false } },
      { learnerId: "L3", assetIds: ["ax"], outcome: { success: true } },
    ]);
    const e = await efficacy(store, "ax");
    expect(e.exposures).toBe(3); // a learnerId filter would have collapsed this to 1
    expect(e.subsequentSuccess).toBe(2);
    expect(e.rate).toBe(2 / 3);
  });

  it("the boolean `outcome.success` drives the count — a high `score` on a failure never counts", async () => {
    const store = createMemoryObservationStore();
    // one failure carrying a high score, one success carrying a low score: only `success` matters.
    await seed(store, [
      { assetIds: ["ay"], outcome: { success: false, score: 0.99 } },
      { assetIds: ["ay"], outcome: { success: true, score: 0.01 } },
    ]);
    const e = await efficacy(store, "ay");
    expect(e.exposures).toBe(2);
    expect(e.subsequentSuccess).toBe(1); // NOT 2 (score ignored), NOT the high-score row
    expect(e.rate).toBe(0.5);
  });

  it("a single failing exposure → exposures is 1 (boundary) yet rate is 0", async () => {
    const store = createMemoryObservationStore();
    await seed(store, [{ assetIds: ["az"], outcome: { success: false } }]);
    const e = await efficacy(store, "az");
    // exposures === 1 exercises the exposures>0 guard right at its boundary while success is 0.
    expect(e.exposures).toBe(1);
    expect(e.subsequentSuccess).toBe(0);
    expect(e.rate).toBe(0);
  });

  it("three of four successes → rate is exactly 0.75 (pins the division direction)", async () => {
    const store = createMemoryObservationStore();
    await seed(store, [
      { assetIds: ["aw"], outcome: { success: true } },
      { assetIds: ["aw"], outcome: { success: true } },
      { assetIds: ["aw"], outcome: { success: true } },
      { assetIds: ["aw"], outcome: { success: false } },
    ]);
    const e = await efficacy(store, "aw");
    expect(e.exposures).toBe(4);
    expect(e.subsequentSuccess).toBe(3);
    // 3/4 = 0.75; a flipped `exposures/subsequentSuccess` would give 4/3 ≈ 1.333.
    expect(e.rate).toBe(0.75);
  });

  it("contextId filter keeps matches and drops non-matches within the SAME asset+learner", async () => {
    const store = createMemoryObservationStore();
    // both rows share asset + learner and differ only by context: proves the `===` filter (not `!==`).
    await seed(store, [
      { learnerId: "L1", assetIds: ["a7"], contextId: "keep", outcome: { success: true } },
      { learnerId: "L1", assetIds: ["a7"], contextId: "drop", outcome: { success: false } },
    ]);
    const e = await efficacy(store, "a7", "keep");
    expect(e.contextId).toBe("keep");
    expect(e.exposures).toBe(1); // a `!==` mutant would keep "drop" instead and report 1 failure
    expect(e.subsequentSuccess).toBe(1);
    expect(e.rate).toBe(1);
  });
});
