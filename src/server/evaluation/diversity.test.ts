import { describe, it, expect } from "vitest";
import { diversity, isSufficientlyDifferent, MIN_DIVERSITY } from "@/server/evaluation/diversity";

/**
 * Diversity KPI — a re-ask must be explained DIFFERENTLY. diversity = 1 − Jaccard(tokens(prev),
 * tokens(current)). Pure, total (both empty → 0, never NaN). Every assertion names the EXACT number
 * (§H1.2). The 0.3 floor is pinned as tightly as IEEE-754 allows — no fraction 1 − i/u equals the
 * double 0.3, so the boundary is the nearest reachable point ABOVE (true) straddled by one BELOW (false).
 */

describe("diversity — 1 − Jaccard over lowercased alphanumeric tokens", () => {
  it("identical non-empty strings → 0 (nothing changed)", () => {
    expect(diversity("the quick brown fox", "the quick brown fox")).toBe(0);
  });

  it("fully disjoint token sets → 1", () => {
    expect(diversity("cat dog", "fish bird")).toBe(1);
  });

  it("half-overlap → exact Jaccard 1/2 → diversity 0.5", () => {
    // tokens(prev)={red,blue}; tokens(current)={red,blue,green,yellow}
    // intersection 2, union 4 → Jaccard 0.5 → diversity 0.5 (exactly representable).
    expect(diversity("red blue", "red blue green yellow")).toBe(0.5);
  });

  it("both empty → 0 (union empty ⇒ nothing changed, never NaN)", () => {
    expect(diversity("", "")).toBe(0);
  });

  it("one empty, other non-empty → 1", () => {
    expect(diversity("", "hello world")).toBe(1);
    expect(diversity("hello world", "")).toBe(1);
  });

  it("case- and punctuation-insensitive tokenisation", () => {
    expect(diversity("Photosynthesis, explained!", "photosynthesis explained")).toBe(0);
  });
});

describe("isSufficientlyDifferent — the MIN_DIVERSITY = 0.3 floor", () => {
  // intersection 7, union 10 → Jaccard 0.7 → diversity = 1 − 0.7 = 0.30000000000000004,
  // the nearest reachable point AT/ABOVE the 0.3 floor → must count as sufficiently different.
  const atFloorPrev = "a1 a2 a3 a4 a5 a6 a7 x y";
  const atFloorCurr = "a1 a2 a3 a4 a5 a6 a7 z";
  // intersection 3, union 4 → Jaccard 0.75 → diversity 0.25 (< 0.3) → insufficient.
  const belowPrev = "a1 a2 a3 a4";
  const belowCurr = "a1 a2 a3";

  it("MIN_DIVERSITY is 0.3", () => {
    expect(MIN_DIVERSITY).toBe(0.3);
  });

  it("at the floor (nearest reachable above 0.3) → sufficiently different", () => {
    expect(diversity(atFloorPrev, atFloorCurr)).toBe(0.30000000000000004);
    expect(isSufficientlyDifferent(atFloorPrev, atFloorCurr)).toBe(true); // 0.30000000000000004 >= 0.3
  });

  it("just below the floor → NOT sufficiently different (guards the >= boundary)", () => {
    expect(diversity(belowPrev, belowCurr)).toBe(0.25);
    expect(isSufficientlyDifferent(belowPrev, belowCurr)).toBe(false); // 0.25 < 0.3
  });

  it("identical → 0 → never sufficiently different", () => {
    expect(isSufficientlyDifferent("same words here", "same words here")).toBe(false);
  });
});
