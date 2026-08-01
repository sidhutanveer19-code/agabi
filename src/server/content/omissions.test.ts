import { describe, it, expect } from "vitest";

import {
  summariseOmissions,
  type Omission,
  type OmissionKind,
  type OmissionStage,
} from "@/server/content/omissions";

/**
 * summariseOmissions — the R1 report header roll-up (content/omissions.ts).
 * Pure data, zero I/O, so nothing is mocked; every assertion names the EXACT
 * Record<kind, count> the function must return. The only branches in the module are
 * the `for` loop (0 / 1 / many iterations) and the `by[o.kind] ?? 0` nullish-coalesce
 * (undefined branch on a kind's FIRST sighting, accumulated-number branch on repeats).
 * Both `??` arms are exercised, plus: absent kinds stay ABSENT (never 0), grouping keys
 * ONLY on `kind` (not stage/chunkId/reason/data), input is not mutated, and each call
 * returns a fresh object with no cross-call accumulation.
 */

function omission(kind: OmissionKind, over: Partial<Omission> = {}): Omission {
  return { stage: "accept", kind, reason: "dropped for a reason", ...over };
}

describe("summariseOmissions — loop iteration count", () => {
  it("empty array → {} exactly (zero-iteration loop, no keys)", () => {
    const result = summariseOmissions([]);
    expect(result).toEqual({});
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("single omission → { kind: 1 } and no other keys (one iteration, ?? undefined arm)", () => {
    const result = summariseOmissions([omission("statement-rejected")]);
    expect(result).toEqual({ "statement-rejected": 1 });
  });

  it("three of the SAME kind → 3 (?? falls to the accumulated value on repeats, not 0)", () => {
    const result = summariseOmissions([
      omission("chunk-failed"),
      omission("chunk-failed"),
      omission("chunk-failed"),
    ]);
    expect(result).toEqual({ "chunk-failed": 3 });
  });
});

describe("summariseOmissions — grouping semantics", () => {
  it("mixed kinds → exact per-kind counts; a kind never seen is ABSENT, not 0", () => {
    const result = summariseOmissions([
      omission("batch-discard"),
      omission("element-discard"),
      omission("element-discard"),
      omission("duplicate-skipped"),
      omission("duplicate-skipped"),
      omission("duplicate-skipped"),
    ]);
    expect(result).toEqual({
      "batch-discard": 1,
      "element-discard": 2,
      "duplicate-skipped": 3,
    });
    // absent kinds must be missing entirely — a 0 would be a fabricated summary line (R1)
    expect("chapter-failed" in result).toBe(false);
    expect(result["chapter-failed"]).toBeUndefined();
    expect(Object.keys(result).sort()).toEqual([
      "batch-discard",
      "duplicate-skipped",
      "element-discard",
    ]);
  });

  it("groups PURELY by kind — differing stage/chunkId/targetId/reason/data never split the count", () => {
    const stages: OmissionStage[] = ["resolve", "validate"];
    const result = summariseOmissions([
      omission("subject-unresolved", { stage: stages[0], chunkId: "c1", reason: "a" }),
      omission("subject-unresolved", {
        stage: stages[1],
        chunkId: "c2",
        targetId: "t9",
        data: { gate: "V3" },
      }),
    ]);
    expect(result).toEqual({ "subject-unresolved": 2 });
  });

  it("interleaved kinds accumulate correctly regardless of order", () => {
    const result = summariseOmissions([
      omission("asset-rejected"),
      omission("dependency-rejected"),
      omission("asset-rejected"),
      omission("dependency-rejected"),
      omission("asset-rejected"),
    ]);
    expect(result).toEqual({ "asset-rejected": 3, "dependency-rejected": 2 });
  });

  it("every one of the eleven OmissionKinds is counted under its own key", () => {
    const kinds: OmissionKind[] = [
      "batch-discard",
      "element-discard",
      "statement-rejected",
      "dependency-rejected",
      "asset-rejected",
      "item-rejected",
      "subject-unresolved",
      "duplicate-skipped",
      "chunk-failed",
      "barren-chunk",
      "chapter-failed",
    ];
    const result = summariseOmissions(kinds.map((k) => omission(k)));
    const expected: Record<string, number> = {};
    for (const k of kinds) expected[k] = 1;
    expect(result).toEqual(expected);
    expect(Object.keys(result)).toHaveLength(11);
  });
});

describe("summariseOmissions — purity", () => {
  it("does not mutate the input array (pure read)", () => {
    const input: Omission[] = [omission("barren-chunk"), omission("barren-chunk")];
    const snapshot = structuredClone(input);
    summariseOmissions(input);
    expect(input).toEqual(snapshot);
    expect(input).toHaveLength(2);
  });

  it("returns a FRESH object per call — no cross-call accumulation", () => {
    const a = summariseOmissions([omission("item-rejected")]);
    const b = summariseOmissions([omission("item-rejected")]);
    expect(a).not.toBe(b);
    expect(a).toEqual({ "item-rejected": 1 });
    expect(b).toEqual({ "item-rejected": 1 });
  });
});
