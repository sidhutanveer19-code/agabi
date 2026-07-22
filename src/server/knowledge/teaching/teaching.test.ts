import { describe, it, expect } from "vitest";
import { createMemoryStore } from "@/server/knowledge/store/memory";
import { buildAsset } from "@/server/knowledge/teaching/asset";
import { assetsFor, withCapability } from "@/server/knowledge/teaching/select";
import { validateAssetPayload, hasCapability, capabilitiesOf, ASSET_KINDS } from "@/server/knowledge/teaching/registry";
import { deriveEfficacy, efficacyRate } from "@/server/knowledge/teaching/efficacy";
import { POLICIES } from "@/server/knowledge/trust/policy";
import type { TeachingAsset } from "@/server/knowledge/types";

describe("M7 teaching-knowledge layer (§13, §18C.1)", () => {
  it("Phase 2 populates exactly three asset kinds (D6)", () => {
    expect(ASSET_KINDS.sort()).toEqual(["ANALOGY", "MISCONCEPTION", "WORKED_EXAMPLE"]);
  });

  describe("analogy-breakdown (V14, §13.3)", () => {
    it("an analogy without a breakdown point is discarded", () => {
      expect(validateAssetPayload("ANALOGY", { source: "water in a pipe", mapping: "current is flow" }).outcome).toBe("discard");
    });
    it("an analogy WITH a breakdown point passes", () => {
      const ok = validateAssetPayload("ANALOGY", { source: "water in a pipe", mapping: "current is flow", breakdownPoint: "fails at capacitance" });
      expect(ok.outcome).toBe("pass");
    });
    it("buildAsset surfaces the validation verdict", () => {
      const { asset, validation } = buildAsset({ kind: "ANALOGY", conceptId: "c", payload: { source: "s", mapping: "m" }, contextId: "ctx" });
      expect(asset.trustLevel).toBe("MACHINE_PROPOSED"); // never self-asserts trust (ADR-2)
      expect(validation.outcome).toBe("discard"); // missing breakdownPoint
    });
  });

  describe("capability dispatch (§18C.1) — never switch on kind", () => {
    it("kinds declare capabilities; consumers ask by capability", () => {
      expect(capabilitiesOf("MISCONCEPTION")).toContain("corrective");
      expect(capabilitiesOf("ANALOGY")).toContain("analogical");
      expect(capabilitiesOf("WORKED_EXAMPLE")).toContain("demonstrable");
      expect(hasCapability("ANALOGY", "corrective")).toBe(false);
    });
  });

  describe("assetsFor respects policy + context", () => {
    async function seed() {
      const store = createMemoryStore();
      const ctx = await store.putContext({ jurisdiction: "IN" });
      const other = await store.putContext({ jurisdiction: "US" });
      const mk = (over: Partial<TeachingAsset>): TeachingAsset => ({
        ...buildAsset({ kind: "MISCONCEPTION", conceptId: "photosynthesis", payload: { misconception: "plants eat sunlight", correction: "they convert it" }, contextId: ctx.id }).asset,
        ...over,
      });
      await store.putTeachingAsset(mk({ trustLevel: "MACHINE_PROPOSED" })); // below the school floor
      await store.putTeachingAsset(mk({ id: "a2", trustLevel: "COMMUNITY_REVIEWED" })); // servable
      await store.putTeachingAsset(mk({ id: "a3", trustLevel: "COMMUNITY_REVIEWED", contextId: other.id })); // other context
      return { store, ctx };
    }

    it("trust-gates assets and prefers the matching context", async () => {
      const { store, ctx } = await seed();
      const { assets, miss } = await assetsFor(store, ["photosynthesis"], "PUBLIC", POLICIES.GENERAL_SCHOOL, ctx.id);
      expect(miss).toBe(false);
      // the MACHINE_PROPOSED one is refused by the school policy
      expect(assets.every((a) => a.trustLevel === "COMMUNITY_REVIEWED")).toBe(true);
      // the matching-context asset ranks first
      expect(assets[0].contextId).toBe(ctx.id);
      // capability filter selects the corrective one, by capability not kind
      expect(withCapability(assets, "corrective").length).toBeGreaterThan(0);
    });

    it("reports a miss when nothing is servable", async () => {
      const store = createMemoryStore();
      const { miss } = await assetsFor(store, ["unknown"], "PUBLIC", POLICIES.GENERAL_SCHOOL);
      expect(miss).toBe(true);
    });
  });

  describe("efficacy is derived, never authored (§13.4)", () => {
    it("computes a success rate from observed counts", () => {
      const e = deriveEfficacy("a1", "ctx", 10, 7, new Date());
      expect(efficacyRate(e)).toBeCloseTo(0.7);
      expect(efficacyRate(deriveEfficacy("a1", "ctx", 0, 0, new Date()))).toBe(0); // no evidence yet
    });
  });
});
