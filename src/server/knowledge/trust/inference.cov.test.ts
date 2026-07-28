import { describe, it, expect } from "vitest";
import { inferredTrust, buildInference, isTrustLevel } from "@/server/knowledge/trust/inference";
import { TRUST_LEVELS, trustRank, type TrustLevel } from "@/server/knowledge/types";

describe("inferredTrust — weakest-link floor (§26.6)", () => {
  it("empty premises → MACHINE_PROPOSED (the early-return floor)", () => {
    expect(inferredTrust([])).toBe("MACHINE_PROPOSED");
  });

  it("a single premise returns that exact level (not the empty floor)", () => {
    // A non-empty, non-MACHINE_PROPOSED result proves the length===0 guard did NOT fire.
    expect(inferredTrust(["AUTO_VALIDATED"])).toBe("AUTO_VALIDATED");
    expect(inferredTrust(["AGABI_CANONICAL"])).toBe("AGABI_CANONICAL");
  });

  it("weakest is at index 0, stronger follows → keeps index 0 (false branch of the compare)", () => {
    // If the compare were always-true, the loop would overwrite to the last (stronger) element.
    expect(inferredTrust(["MACHINE_PROPOSED", "AGABI_CANONICAL"])).toBe("MACHINE_PROPOSED");
  });

  it("weakest is at the LAST index → loop must update past the seed (true branch of the compare)", () => {
    // If the compare were always-false, the seed (AGABI_CANONICAL) would wrongly win.
    expect(inferredTrust(["AGABI_CANONICAL", "MACHINE_PROPOSED"])).toBe("MACHINE_PROPOSED");
  });

  it("weakest sits in the MIDDLE of three → still found", () => {
    expect(inferredTrust(["COMMUNITY_REVIEWED", "AUTO_VALIDATED", "EXPERT_REVIEWED"])).toBe(
      "AUTO_VALIDATED",
    );
  });

  it("picks the true minimum, not the maximum (kills a flipped `<`→`>` comparison)", () => {
    // With `>` the fold would return the STRONGEST premise; assert we get the weakest.
    const levels: TrustLevel[] = ["EXPERT_REVIEWED", "OFFICIAL_SOURCE_VERIFIED", "COMMUNITY_REVIEWED"];
    const result = inferredTrust(levels);
    expect(result).toBe("COMMUNITY_REVIEWED");
    // And it is genuinely the min by rank across every input.
    const minRank = Math.min(...levels.map(trustRank));
    expect(trustRank(result)).toBe(minRank);
  });

  it("all premises equal → returns that shared level", () => {
    expect(inferredTrust(["EXPERT_REVIEWED", "EXPERT_REVIEWED", "EXPERT_REVIEWED"])).toBe(
      "EXPERT_REVIEWED",
    );
  });

  it("the full ladder in one call resolves to the very bottom rung", () => {
    expect(inferredTrust([...TRUST_LEVELS])).toBe("MACHINE_PROPOSED");
  });

  it("does not mutate the caller's array", () => {
    const input: TrustLevel[] = ["EXPERT_REVIEWED", "MACHINE_PROPOSED"];
    const snapshot = [...input];
    inferredTrust(input);
    expect(input).toEqual(snapshot);
  });
});

describe("buildInference — recorded derivation (§26.6)", () => {
  it("records the premise ids and the inferred (weakest) trust level", () => {
    const inf = buildInference(
      ["s1", "s2"],
      ["EXPERT_REVIEWED", "AUTO_VALIDATED"],
    );
    expect(inf.derivedFrom).toEqual(["s1", "s2"]);
    expect(inf.trustLevel).toBe("AUTO_VALIDATED");
  });

  it("derivedFrom is a COPY — not the same array reference, and immune to later caller mutation", () => {
    const ids = ["a", "b", "c"];
    const inf = buildInference(ids, ["AGABI_CANONICAL", "AGABI_CANONICAL", "AGABI_CANONICAL"]);
    // Kills a "drop the spread" mutant: without the copy this would be reference-equal.
    expect(inf.derivedFrom).not.toBe(ids);
    ids.push("d");
    expect(inf.derivedFrom).toEqual(["a", "b", "c"]);
  });

  it("empty premises → empty derivation chain and the MACHINE_PROPOSED floor", () => {
    const inf = buildInference([], []);
    expect(inf.derivedFrom).toEqual([]);
    expect(inf.trustLevel).toBe("MACHINE_PROPOSED");
  });

  it("trustLevel tracks inferredTrust exactly for the same premise set", () => {
    const levels: TrustLevel[] = ["OFFICIAL_SOURCE_VERIFIED", "COMMUNITY_REVIEWED", "AGABI_CANONICAL"];
    const inf = buildInference(["x", "y", "z"], levels);
    expect(inf.trustLevel).toBe(inferredTrust(levels));
    expect(inf.trustLevel).toBe("COMMUNITY_REVIEWED");
  });

  it("carries every id through (kills an `[...ids]`→`[]` mutant)", () => {
    const inf = buildInference(["only-one"], ["AUTO_VALIDATED"]);
    expect(inf.derivedFrom).toHaveLength(1);
    expect(inf.derivedFrom[0]).toBe("only-one");
  });
});

describe("isTrustLevel — ladder-rung guard", () => {
  it("returns true for EVERY real ladder rung", () => {
    for (const level of TRUST_LEVELS) {
      expect(isTrustLevel(level)).toBe(true);
    }
  });

  it("returns false for a plausible-but-wrong string", () => {
    expect(isTrustLevel("EXPERT")).toBe(false);
    expect(isTrustLevel("machine_proposed")).toBe(false); // case-sensitive
    expect(isTrustLevel("DISPUTED")).toBe(false); // a flag, not a rung (§26.5)
  });

  it("returns false for the empty string", () => {
    expect(isTrustLevel("")).toBe(false);
  });

  it("narrows the type so a matched value is usable as a TrustLevel", () => {
    const v: string = "AGABI_CANONICAL";
    if (isTrustLevel(v)) {
      // Compile-time proof of narrowing; runtime proof of the exact value.
      const narrowed: TrustLevel = v;
      expect(narrowed).toBe("AGABI_CANONICAL");
    } else {
      throw new Error("expected AGABI_CANONICAL to be a valid trust level");
    }
  });
});
