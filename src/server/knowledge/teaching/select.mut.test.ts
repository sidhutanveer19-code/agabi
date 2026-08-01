import { describe, it, expect } from "vitest";
import { createMemoryStore } from "@/server/knowledge/store/memory";
import { buildAsset } from "@/server/knowledge/teaching/asset";
import { assetsFor, withCapability } from "@/server/knowledge/teaching/select";
import { POLICIES } from "@/server/knowledge/trust/policy";
import type { TeachingAsset, Labelled } from "@/server/knowledge/types";

/**
 * §H1 mutation coverage for teaching/select.ts (§13, §18C.1). The M7 test asserted ranking only
 * loosely — its context-match asset also happened to win the id tie-break, so the whole `rank`
 * expression AND the version/id tie-break chain in the sort comparator survived. These tests drive
 * the three-key ordering (context → version → id) with each key deliberately in TENSION with the
 * others (the correct winner has the WORSE id/version), and pin `withCapability` to prove it filters.
 */

const store = createMemoryStore();

/** A servable asset with fully-controlled id / contextId / version, stored under concept "c1". */
async function seed(over: Partial<TeachingAsset>): Promise<void> {
  const base = buildAsset({
    kind: "MISCONCEPTION",
    conceptId: "c1",
    payload: { misconception: "m", correction: "c" },
    contextId: "ctx-x",
  }).asset;
  await store.putTeachingAsset({ ...base, trustLevel: "AUTO_VALIDATED", ...over });
}

function fresh() {
  return createMemoryStore();
}

async function seedInto(s: ReturnType<typeof createMemoryStore>, over: Partial<TeachingAsset>): Promise<void> {
  const base = buildAsset({ kind: "MISCONCEPTION", conceptId: "c1", payload: { misconception: "m", correction: "c" }, contextId: "ctx-x" }).asset;
  await s.putTeachingAsset({ ...base, trustLevel: "AUTO_VALIDATED", ...over });
}

describe("assetsFor — context match ranks FIRST even with a worse id (kills the `rank` mutants)", () => {
  it("prefers the query-context asset over a higher-id non-match at equal version", async () => {
    const s = fresh();
    // Non-match has the SMALLER id, so an id-only sort would put it first.
    await seedInto(s, { id: "a-other", contextId: "ctx-other", version: 1 });
    await seedInto(s, { id: "z-match", contextId: "ctx-match", version: 1 });

    const { assets, miss } = await assetsFor(s, ["c1"], "PUBLIC", POLICIES.RESEARCH, "ctx-match");
    expect(miss).toBe(false);
    expect(assets.map((a) => a.id)).toEqual(["z-match", "a-other"]);
    expect(assets[0].contextId).toBe("ctx-match");
  });

  it("orders match-first regardless of insertion order (both permutations agree)", async () => {
    const s = fresh();
    await seedInto(s, { id: "z-match", contextId: "ctx-match", version: 1 });
    await seedInto(s, { id: "a-other", contextId: "ctx-other", version: 1 });

    const { assets } = await assetsFor(s, ["c1"], "PUBLIC", POLICIES.RESEARCH, "ctx-match");
    expect(assets.map((a) => a.id)).toEqual(["z-match", "a-other"]);
  });

  it("with NO query context, no asset ranks ahead on context — order falls to version then id", async () => {
    const s = fresh();
    await seedInto(s, { id: "b", contextId: "ctx-1", version: 1 });
    await seedInto(s, { id: "a", contextId: "ctx-2", version: 1 });
    // no queryContextId → rank is 1 for both → equal → version equal → id ascending.
    const { assets } = await assetsFor(s, ["c1"], "PUBLIC", POLICIES.RESEARCH);
    expect(assets.map((a) => a.id)).toEqual(["a", "b"]);
  });
});

describe("assetsFor — newer VERSION wins the tie after context (kills the version term)", () => {
  it("a higher version sorts first even with a larger id, at equal context rank", async () => {
    const s = fresh();
    // v2 has the LARGER id "z"; v1 has "a". Version must beat id.
    await seedInto(s, { id: "a", contextId: "ctx-x", version: 1 });
    await seedInto(s, { id: "z", contextId: "ctx-x", version: 2 });

    const { assets } = await assetsFor(s, ["c1"], "PUBLIC", POLICIES.RESEARCH);
    expect(assets.map((a) => a.id)).toEqual(["z", "a"]); // z is v2 → first
    expect(assets.map((a) => a.version)).toEqual([2, 1]);
  });
});

describe("assetsFor — id breaks the final tie ascending (kills the id ternary)", () => {
  it("equal context rank AND equal version → ascending id, independent of insertion order", async () => {
    const s = fresh();
    await seedInto(s, { id: "b", contextId: "ctx-x", version: 1 });
    await seedInto(s, { id: "a", contextId: "ctx-x", version: 1 });

    const { assets } = await assetsFor(s, ["c1"], "PUBLIC", POLICIES.RESEARCH);
    expect(assets.map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("three equal-rank equal-version assets come out fully id-sorted", async () => {
    const s = fresh();
    await seedInto(s, { id: "m", contextId: "ctx-x", version: 1 });
    await seedInto(s, { id: "a", contextId: "ctx-x", version: 1 });
    await seedInto(s, { id: "z", contextId: "ctx-x", version: 1 });

    const { assets } = await assetsFor(s, ["c1"], "PUBLIC", POLICIES.RESEARCH);
    expect(assets.map((a) => a.id)).toEqual(["a", "m", "z"]);
  });
});

describe("assetsFor — combined: context beats version beats id in one shot", () => {
  it("ranks a worse-versioned, worse-id context match ahead of a newer non-match", async () => {
    const s = fresh();
    await seedInto(s, { id: "z-match", contextId: "ctx-match", version: 1 });
    await seedInto(s, { id: "a-other", contextId: "ctx-other", version: 9 });
    const { assets } = await assetsFor(s, ["c1"], "PUBLIC", POLICIES.RESEARCH, "ctx-match");
    expect(assets.map((a) => a.id)).toEqual(["z-match", "a-other"]);
  });
});

describe("assetsFor — miss flag", () => {
  it("miss is true and assets empty when nothing is servable", async () => {
    const s = fresh();
    const { assets, miss } = await assetsFor(s, ["nope"], "PUBLIC", POLICIES.RESEARCH);
    expect(assets).toEqual([]);
    expect(miss).toBe(true);
  });

  it("miss is false the moment one asset is servable", async () => {
    const s = fresh();
    await seedInto(s, { id: "only", contextId: "ctx-x", version: 1 });
    const { miss } = await assetsFor(s, ["c1"], "PUBLIC", POLICIES.RESEARCH);
    expect(miss).toBe(false);
  });

  it("gathers assets across MULTIPLE concept ids", async () => {
    const s = fresh();
    await seedInto(s, { id: "one", conceptId: "c1", contextId: "ctx-x", version: 1 });
    const base = buildAsset({ kind: "MISCONCEPTION", conceptId: "c2", payload: { misconception: "m", correction: "c" }, contextId: "ctx-x" }).asset;
    await s.putTeachingAsset({ ...base, id: "two", trustLevel: "AUTO_VALIDATED" });
    const { assets } = await assetsFor(s, ["c1", "c2"], "PUBLIC", POLICIES.RESEARCH);
    expect(assets.map((a) => a.id).sort()).toEqual(["one", "two"]);
  });
});

describe("withCapability — filters by capability, never by kind (kills `return assets`)", () => {
  const labelled = (kind: string, id: string): Labelled<TeachingAsset> =>
    ({
      id,
      kind,
      conceptId: "c1",
      statementId: null,
      payload: {},
      contextId: "ctx-x",
      trustLevel: "AUTO_VALIDATED",
      scope: "PUBLIC",
      version: 1,
      supersedes: null,
      labelled: false,
    }) as Labelled<TeachingAsset>;

  const assets = [
    labelled("MISCONCEPTION", "mis"),
    labelled("WORKED_EXAMPLE", "we"),
    labelled("ANALOGY", "ana"),
  ];

  it("selects ONLY the corrective asset for `corrective`", () => {
    const out = withCapability(assets, "corrective");
    expect(out.map((a) => a.id)).toEqual(["mis"]);
  });

  it("selects ONLY the demonstrable asset for `demonstrable`", () => {
    expect(withCapability(assets, "demonstrable").map((a) => a.id)).toEqual(["we"]);
  });

  it("selects ONLY the analogical asset for `analogical`", () => {
    expect(withCapability(assets, "analogical").map((a) => a.id)).toEqual(["ana"]);
  });

  it("returns an EMPTY list when no asset has the capability (proves it filters, not passes through)", () => {
    expect(withCapability([labelled("WORKED_EXAMPLE", "we")], "corrective")).toEqual([]);
  });

  it("keeps every matching asset when several share the capability (analogy is also explanatory)", () => {
    const out = withCapability(assets, "explanatory");
    expect(out.map((a) => a.id)).toEqual(["ana"]);
  });
});

// touch the module-level store export so an unused-var lint never trips; also a smoke check.
describe("assetsFor — shared-store smoke", () => {
  it("returns a miss on the empty shared store", async () => {
    const { miss } = await assetsFor(store, ["absent"], "PUBLIC", POLICIES.RESEARCH);
    expect(miss).toBe(true);
    await seed({ id: "smoke", contextId: "ctx-x", version: 1 });
    expect((await assetsFor(store, ["c1"], "PUBLIC", POLICIES.RESEARCH)).miss).toBe(false);
  });
});
