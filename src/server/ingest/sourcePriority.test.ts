import { describe, it, expect } from "vitest";
import { sourceRank, compareTiers, SOURCE_TIERS, type SourceTier } from "@/server/ingest/sourcePriority";

describe("source priority — ordering, not trust (ADR-2)", () => {
  it("ranks government curriculum highest, background lowest", () => {
    expect(sourceRank("GOVERNMENT_CURRICULUM")).toBe(0);
    expect(sourceRank("BACKGROUND")).toBe(SOURCE_TIERS.length - 1);
    expect(sourceRank("OFFICIAL_TEXTBOOK")).toBeLessThan(sourceRank("ENCYCLOPEDIA"));
  });

  it("sorts highest-trust first; unknown/undefined tiers last", () => {
    const tiers: (SourceTier | undefined)[] = ["BACKGROUND", "GOVERNMENT_CURRICULUM", undefined, "ACADEMIC"];
    const ordered = [...tiers].sort(compareTiers);
    expect(ordered[0]).toBe("GOVERNMENT_CURRICULUM");
    expect(ordered[1]).toBe("ACADEMIC");
    expect(ordered[ordered.length - 1]).toBeUndefined();
  });
});
