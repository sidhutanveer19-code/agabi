import { describe, it, expect } from "vitest";
import { createMemoryObservationStore, type ObservationStore } from "@/server/observation/store";
import { record } from "@/server/observation/record";
import { mastery } from "@/server/observation/mastery";
import type { NewObservation } from "@/server/observation/types";

/**
 * §H1 coverage for `mastery` (§20.2) — the pure "what fraction did this learner get right?" query,
 * recomputed on read, never a stored row. Every branch is pinned:
 *  - the per-learner filter (`o.learnerId === learnerId`, both arms + the wrong-learner leak),
 *  - `if (atBloom)` (undefined / non-empty / empty-string falsy) and its `bloomLevel === atBloom`,
 *  - `if (asOf)` and the `occurredAt <= asOf` boundary (before / exactly-at / after the cutoff),
 *  - the `n > 0 ? successes / n : 0` division guard (zero-evidence → 0, not NaN), and
 *  - the `atBloom ?? null` echo (present / undefined / "").
 * Real memory store, real `record` path — no mocks (the module does no external I/O to mock).
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

describe("mastery (§20.2) — a pure query over observations, never a stored row", () => {
  it("no observations → estimate 0, observations 0, atBloom null (the n>0 FALSE arm)", async () => {
    const store = createMemoryObservationStore();
    const m = await mastery(store, "L1", "photosynthesis");
    expect(m).toEqual({
      learnerId: "L1",
      conceptId: "photosynthesis",
      estimate: 0, // must be exactly 0 — a `n >= 0` mutant would compute 0/0 = NaN here
      observations: 0,
      atBloom: null, // undefined atBloom → null (kills dropping the `?? null`)
    });
    expect(Number.isNaN(m.estimate)).toBe(false);
  });

  it("mixed outcomes → estimate is successes / observations", async () => {
    const store = createMemoryObservationStore();
    await seed(store, [{ outcome: { success: true } }, { outcome: { success: false } }]);
    const m = await mastery(store, "L1", "photosynthesis");
    expect(m.observations).toBe(2);
    // 1 of 2 → 0.5, distinct from *,+,-,% of (1,2): kills any operator swap for `/`
    expect(m.estimate).toBe(0.5);
  });

  it("a three-observation run yields the exact 2/3 rate", async () => {
    const store = createMemoryObservationStore();
    await seed(store, [
      { outcome: { success: true } },
      { outcome: { success: false } },
      { outcome: { success: true } },
    ]);
    const m = await mastery(store, "L1", "photosynthesis");
    expect(m.observations).toBe(3);
    expect(m.estimate).toBeCloseTo(2 / 3, 12);
  });

  it("all successes → estimate exactly 1", async () => {
    const store = createMemoryObservationStore();
    await seed(store, [{ outcome: { success: true } }, { outcome: { success: true } }]);
    const m = await mastery(store, "L1", "photosynthesis");
    expect(m.observations).toBe(2);
    expect(m.estimate).toBe(1); // kills a `success` → false mutant (would give 0)
  });

  it("all failures → observations > 0 yet estimate is exactly 0 (distinct from empty)", async () => {
    const store = createMemoryObservationStore();
    await seed(store, [{ outcome: { success: false } }, { outcome: { success: false } }]);
    const m = await mastery(store, "L1", "photosynthesis");
    // separates from the no-observations case: here n is non-zero (n>0 TRUE arm) but rate is 0.
    expect(m.observations).toBe(2);
    expect(m.estimate).toBe(0); // kills a `success` → true mutant (would give 2/2 = 1)
  });

  it("only the queried learner's observations count — other learners never leak in", async () => {
    const store = createMemoryObservationStore();
    await seed(store, [
      { learnerId: "L1", outcome: { success: true } },
      { learnerId: "L2", outcome: { success: false } }, // same concept, different learner
      { learnerId: "L2", outcome: { success: false } },
    ]);
    const m = await mastery(store, "L1", "photosynthesis");
    // a `===` → `!==` mutant would count the two L2 rows and drop L1's → observations 2, estimate 0.
    expect(m.observations).toBe(1);
    expect(m.estimate).toBe(1);
    expect(m.learnerId).toBe("L1");
    // and L2 sees only its own two failures — proves the rows really are in the store.
    const m2 = await mastery(store, "L2", "photosynthesis");
    expect(m2.observations).toBe(2);
    expect(m2.estimate).toBe(0);
  });

  it("mastery is scoped to the requested concept only", async () => {
    const store = createMemoryObservationStore();
    await seed(store, [
      { conceptIds: ["photosynthesis"], outcome: { success: true } },
      { conceptIds: ["mitosis"], outcome: { success: false } },
    ]);
    const m = await mastery(store, "L1", "photosynthesis");
    expect(m.observations).toBe(1); // the mitosis observation must not be counted
    expect(m.conceptId).toBe("photosynthesis");
    expect(m.estimate).toBe(1);
  });

  it("an observation tagged with multiple concepts contributes to each", async () => {
    const store = createMemoryObservationStore();
    await seed(store, [{ conceptIds: ["a", "b"], outcome: { success: true } }]);
    expect((await mastery(store, "L1", "a")).observations).toBe(1);
    expect((await mastery(store, "L1", "b")).observations).toBe(1);
  });

  it("atBloom narrows to observations at that Bloom level and echoes the level", async () => {
    const store = createMemoryObservationStore();
    await seed(store, [
      { bloomLevel: "apply", outcome: { success: true } },
      { bloomLevel: "apply", outcome: { success: false } },
      { bloomLevel: "understand", outcome: { success: true } },
      { bloomLevel: undefined, outcome: { success: true } }, // stored as null
    ]);
    const scoped = await mastery(store, "L1", "photosynthesis", "apply");
    expect(scoped.observations).toBe(2); // only the two "apply" rows survive the filter
    expect(scoped.estimate).toBe(0.5); // a `===` → `!==` mutant would keep the other two rows
    expect(scoped.atBloom).toBe("apply"); // provided level echoed, not null

    // Unscoped counts all four — proving the atBloom filter actually removed rows.
    const all = await mastery(store, "L1", "photosynthesis");
    expect(all.observations).toBe(4);
    expect(all.atBloom).toBeNull();
  });

  it("atBloom with no matching level → zeroed estimate but the level is still echoed (not null)", async () => {
    const store = createMemoryObservationStore();
    await seed(store, [{ bloomLevel: "apply", outcome: { success: true } }]);
    const m = await mastery(store, "L1", "photosynthesis", "create");
    expect(m.observations).toBe(0);
    expect(m.estimate).toBe(0);
    expect(m.atBloom).toBe("create"); // present-but-unmatched is NOT collapsed to null
  });

  it("empty-string atBloom is falsy → no Bloom filter, and '' is preserved (not null)", async () => {
    const store = createMemoryObservationStore();
    await seed(store, [
      { bloomLevel: "apply", outcome: { success: true } },
      { bloomLevel: "understand", outcome: { success: false } },
    ]);
    const m = await mastery(store, "L1", "photosynthesis", "");
    // `if ("")` is false → both rows survive; a mutant that always runs the filter (bloom === "")
    // would match zero rows → observations 0. Two rows proves the guard's FALSE arm ran.
    expect(m.observations).toBe(2);
    expect(m.estimate).toBe(0.5);
    // `"" ?? null` is "" — a `||` in place of `??` would have produced null here.
    expect(m.atBloom).toBe("");
  });

  it("asOf includes observations at or before the cutoff and excludes later ones (<= boundary)", async () => {
    const store = createMemoryObservationStore();
    const t1 = new Date("2026-01-01T00:00:00.000Z");
    const t2 = new Date("2026-01-02T00:00:00.000Z"); // the cutoff, exactly
    const t3 = new Date("2026-01-03T00:00:00.000Z");
    await seed(store, [
      { occurredAt: t1, outcome: { success: true } }, // before → kept
      { occurredAt: t2, outcome: { success: true } }, // exactly at cutoff → kept (kills <= → <)
      { occurredAt: t3, outcome: { success: false } }, // after → dropped (kills <= → always-true)
    ]);
    const m = await mastery(store, "L1", "photosynthesis", undefined, t2);
    expect(m.observations).toBe(2); // t3 excluded; if `<` had been used t2 would drop → 1
    // both kept rows are successes → 1. A `<=` → `>=` mutant would keep {t2,t3} instead and the
    // t3 failure would drag the estimate to 0.5, so the exact 1 pins the comparison direction.
    expect(m.estimate).toBe(1);
  });

  it("asOf before every observation → everything excluded, zeroed estimate", async () => {
    const store = createMemoryObservationStore();
    await seed(store, [{ occurredAt: new Date("2026-06-01T00:00:00.000Z"), outcome: { success: true } }]);
    const m = await mastery(store, "L1", "photosynthesis", undefined, new Date(0));
    expect(m.observations).toBe(0);
    expect(m.estimate).toBe(0);
  });

  it("atBloom and asOf compose — both filters apply together", async () => {
    const store = createMemoryObservationStore();
    const early = new Date("2026-01-01T00:00:00.000Z");
    const late = new Date("2026-03-01T00:00:00.000Z");
    const cutoff = new Date("2026-02-01T00:00:00.000Z");
    await seed(store, [
      { bloomLevel: "apply", occurredAt: early, outcome: { success: true } }, // survives both
      { bloomLevel: "apply", occurredAt: late, outcome: { success: false } }, // dropped by asOf
      { bloomLevel: "understand", occurredAt: early, outcome: { success: false } }, // dropped by bloom
    ]);
    const m = await mastery(store, "L1", "photosynthesis", "apply", cutoff);
    expect(m.observations).toBe(1);
    expect(m.estimate).toBe(1);
    expect(m.atBloom).toBe("apply");
  });
});
