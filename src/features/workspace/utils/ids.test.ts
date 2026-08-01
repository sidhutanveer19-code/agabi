import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * ids.ts — monotonic session id generation for regions/blocks.
 *
 * Pure logic, NO I/O edge to fake (no db/clock/network) — but the module owns a
 * mutable `seq` counter, so each test re-imports a FRESH module (vi.resetModules)
 * to get a deterministic `seq = 0` start and assert EXACT values, never "returned
 * something". Every branch is exercised:
 *   - nextSeq: the +1 increment, asserted as exact monotonic 1,2,3…
 *   - createId: `${prefix}_${nextSeq()}` composition, shared counter across prefixes,
 *     empty-prefix edge
 *   - idSuffix: BOTH ternary arms — regex `/_(\d+)$/` match (→ Number) vs no match (→ 0),
 *     with hostile/edge inputs (trailing digits only, leading zeros, digits-not-at-end,
 *     empty string, underscore-with-no-digit, multiple underscore groups)
 *   - ensureSeqAbove: BOTH arms of `if (n > seq)` — raises when above, no-op when equal,
 *     no-op (never lowers) when below, plus the restore-collision guarantee it exists for
 */

type IdsModule = typeof import("@/features/workspace/utils/ids");

let ids: IdsModule;

beforeEach(async () => {
  // Fresh module → `seq` resets to 0, so every test starts from a known counter.
  vi.resetModules();
  ids = await import("@/features/workspace/utils/ids");
});

describe("nextSeq", () => {
  it("returns a strictly monotonic 1,2,3… from a fresh module", () => {
    expect(ids.nextSeq()).toBe(1);
    expect(ids.nextSeq()).toBe(2);
    expect(ids.nextSeq()).toBe(3);
  });

  it("increments by exactly 1 across many calls (catches +2 / off-by-one mutations)", () => {
    const seen: number[] = [];
    for (let i = 0; i < 100; i += 1) seen.push(ids.nextSeq());
    // exact sequence 1..100, contiguous, no gaps or repeats
    expect(seen).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
  });
});

describe("createId", () => {
  it("composes `${prefix}_${nextSeq()}` with the first sequence number", () => {
    expect(ids.createId("region")).toBe("region_1");
  });

  it("shares ONE counter across every prefix (block_2 follows region_1)", () => {
    expect(ids.createId("region")).toBe("region_1");
    expect(ids.createId("block")).toBe("block_2");
    expect(ids.createId("region")).toBe("region_3");
  });

  it("empty prefix → `_1` (no special-casing of the prefix)", () => {
    expect(ids.createId("")).toBe("_1");
  });

  it("advances the shared counter so nextSeq sees the createId consumption", () => {
    expect(ids.createId("block")).toBe("block_1");
    expect(ids.nextSeq()).toBe(2);
  });
});

describe("idSuffix — ternary match arm (returns Number of the trailing group)", () => {
  it("`region_7` → 7", () => {
    expect(ids.idSuffix("region_7")).toBe(7);
  });

  it("`block_42` → 42 (multi-digit)", () => {
    expect(ids.idSuffix("block_42")).toBe(42);
  });

  it("`region_1` → 1 (single digit boundary)", () => {
    expect(ids.idSuffix("region_1")).toBe(1);
  });

  it("leading zeros are parsed as a decimal number: `node_007` → 7", () => {
    expect(ids.idSuffix("node_007")).toBe(7);
  });

  it("only the TRAILING `_<digits>` group is taken: `foo_12_34` → 34", () => {
    expect(ids.idSuffix("foo_12_34")).toBe(34);
  });

  it("leading underscore-number `_5` → 5", () => {
    expect(ids.idSuffix("_5")).toBe(5);
  });

  it("round-trips a createId value back to its sequence number", () => {
    const id = ids.createId("region"); // region_1
    expect(ids.idSuffix(id)).toBe(1);
  });
});

describe("idSuffix — ternary no-match arm (returns 0)", () => {
  it("no underscore-digit suffix at all → 0 (`region`)", () => {
    expect(ids.idSuffix("region")).toBe(0);
  });

  it("underscore present but NO digit after it → 0 (`foo_`)", () => {
    expect(ids.idSuffix("foo_")).toBe(0);
  });

  it("underscore followed by non-digits → 0 (`foo_bar`)", () => {
    expect(ids.idSuffix("foo_bar")).toBe(0);
  });

  it("digits NOT at the end (not anchored) → 0 (`region_3x`)", () => {
    expect(ids.idSuffix("region_3x")).toBe(0);
  });

  it("bare digits with no preceding underscore → 0 (`12`)", () => {
    expect(ids.idSuffix("12")).toBe(0);
  });

  it("empty string → 0", () => {
    expect(ids.idSuffix("")).toBe(0);
  });
});

describe("ensureSeqAbove — if (n > seq) true arm (raises the counter)", () => {
  it("raises seq to n when n > seq; next id continues from n+1", () => {
    ids.ensureSeqAbove(42);
    expect(ids.nextSeq()).toBe(43);
    expect(ids.createId("region")).toBe("region_44");
  });

  it("prevents collision with a restored id after reload (the whole reason it exists)", () => {
    // Simulate restoring a persisted doc whose highest id was region_9 / block_9.
    const restored = ["region_1", "block_9", "region_4"];
    const maxSuffix = Math.max(...restored.map((id) => ids.idSuffix(id))); // 9
    ids.ensureSeqAbove(maxSuffix);
    // New ids must not re-issue 1..9 — first new id is 10.
    expect(ids.createId("region")).toBe("region_10");
  });
});

describe("ensureSeqAbove — if (n > seq) false arm (never lowers)", () => {
  it("n === seq → no-op (boundary; `>` not `>=` has same observable value here)", () => {
    ids.nextSeq(); // seq = 1
    ids.nextSeq(); // seq = 2
    ids.ensureSeqAbove(2); // 2 > 2 is false → unchanged
    expect(ids.nextSeq()).toBe(3);
  });

  it("n < seq → must NOT lower the counter (would re-issue ids)", () => {
    ids.ensureSeqAbove(10); // seq = 10
    ids.ensureSeqAbove(3); // 3 > 10 false → stays 10
    expect(ids.nextSeq()).toBe(11);
  });

  it("n = 0 on a fresh (seq=0) module → no-op, first id is still 1", () => {
    ids.ensureSeqAbove(0); // 0 > 0 false
    expect(ids.nextSeq()).toBe(1);
  });

  it("negative n → no-op (never below the current counter)", () => {
    ids.nextSeq(); // seq = 1
    ids.ensureSeqAbove(-5); // -5 > 1 false
    expect(ids.nextSeq()).toBe(2);
  });
});
