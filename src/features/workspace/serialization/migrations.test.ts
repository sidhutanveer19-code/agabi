import { describe, it, expect } from "vitest";
import { runMigrations } from "@/features/workspace/serialization/migrations";
import { SCHEMA_VERSION } from "@/features/workspace/types";

/**
 * runMigrations — the forward-migration ladder for persisted workspace docs.
 *
 * There is NO I/O boundary to fake here: the module is pure logic over a plain
 * object plus the SCHEMA_VERSION constant. Every assertion below names the EXACT
 * returned reference/value — never "did not throw" / "returned something".
 *
 * CONTRACT FACT this suite pins: SCHEMA_VERSION === 3 and the module's private
 * `migrations` map is EMPTY (no 0→1 / 1→2 / 2→3 entry). Therefore, for every
 * REACHABLE input, runMigrations is a pure PASS-THROUGH: it returns the SAME
 * object reference, unmutated, with `schemaVersion` untouched — because the
 * `while` loop either never runs (version >= 3) or hits `if (!migrate) break`
 * on its first turn (version < 3, no registered migration).
 *
 * DELIBERATELY UNCOVERABLE branches (documented in the returned report, not
 * hidden): the `migrate` EXISTS path — line "doc = migrate(doc)", the second
 * `typeof doc.schemaVersion === "number"` ternary, and `next > version ? ...`.
 * They are dead code while `migrations` is empty, and the map is a module-
 * private const with no export/injection seam, so they cannot be reached without
 * editing the source (forbidden by the task). The "unmigrated pass-through"
 * assertions below are DESIGNED to go red the instant a real migration lands —
 * forcing whoever adds one to write true migration tests (CLAUDE.md §H1.8: guard
 * the whole class, not one instance). Do not weaken them; only make them stricter.
 */

// Recursively freeze so any in-place write attempt throws under module strict mode.
function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    Object.values(o as Record<string, unknown>).forEach((v) => deepFreeze(v));
    Object.freeze(o);
  }
  return o;
}

describe("runMigrations — contract pin (no forward migration registered)", () => {
  it("current build is SCHEMA_VERSION 3 and v0/v1/v2 docs pass through UNMIGRATED", () => {
    expect(SCHEMA_VERSION).toBe(3);
    // Observable proof the migrations map has no 0/1/2 entry: each older version
    // returns with its schemaVersion UNCHANGED (never bumped toward 3).
    expect(runMigrations({ schemaVersion: 0 }).schemaVersion).toBe(0);
    expect(runMigrations({ schemaVersion: 1 }).schemaVersion).toBe(1);
    expect(runMigrations({ schemaVersion: 2 }).schemaVersion).toBe(2);
  });
});

describe("runMigrations — at/beyond current version (numeric branch true, loop skipped)", () => {
  it("current-version doc (schemaVersion === SCHEMA_VERSION) returns by reference, byte-identical", () => {
    const doc = { schemaVersion: 3, id: "ws", regions: [{ id: "r1", blocks: [] }] };
    const result = runMigrations(doc);
    expect(result).toBe(doc); // same reference — loop body never executed
    expect(result).toEqual({ schemaVersion: 3, id: "ws", regions: [{ id: "r1", blocks: [] }] });
    expect(result.regions).toBe(doc.regions); // not deep-cloned
  });

  it("FUTURE-version doc (schemaVersion 5 > SCHEMA_VERSION) passes through untouched", () => {
    const doc = { schemaVersion: 5, topic: "x" };
    const result = runMigrations(doc);
    expect(result).toBe(doc);
    expect(result.schemaVersion).toBe(5); // downstream validation rejects it, not this fn
  });

  it("NaN is typeof 'number' yet NaN < 3 is false → loop skipped, doc unchanged", () => {
    const doc = { schemaVersion: NaN, k: 1 };
    const result = runMigrations(doc);
    expect(result).toBe(doc);
    expect(Number.isNaN(result.schemaVersion as number)).toBe(true);
    expect(result.k).toBe(1);
  });

  it("Infinity < 3 is false → loop skipped, schemaVersion stays Infinity", () => {
    expect(runMigrations({ schemaVersion: Infinity }).schemaVersion).toBe(Infinity);
  });
});

describe("runMigrations — older numeric versions enter loop then break (numeric branch true)", () => {
  it("schemaVersion 1 (< 3) enters loop, finds no migrations[1], breaks, returns UNCHANGED (not bumped)", () => {
    const doc = { schemaVersion: 1, regions: [{ id: "r" }] };
    const result = runMigrations(doc);
    expect(result).toBe(doc);
    expect(result.schemaVersion).toBe(1); // critical: NOT migrated to 2 or 3
    expect(result).toEqual({ schemaVersion: 1, regions: [{ id: "r" }] });
  });

  it("boundary schemaVersion 2 (= SCHEMA_VERSION - 1) still breaks, stays 2", () => {
    expect(runMigrations({ schemaVersion: 2 }).schemaVersion).toBe(2);
  });

  it("explicit numeric 0 (distinct from a MISSING field) enters loop via numeric-true branch, breaks, stays 0", () => {
    const doc = { schemaVersion: 0, a: "b" };
    const result = runMigrations(doc);
    expect(result).toBe(doc);
    expect(result.schemaVersion).toBe(0);
    expect(result.a).toBe("b");
  });

  it("negative version -1 (< 3) enters loop, breaks, stays -1", () => {
    expect(runMigrations({ schemaVersion: -1 }).schemaVersion).toBe(-1);
  });

  it("non-integer 2.5 (< 3) enters loop, breaks, stays 2.5", () => {
    expect(runMigrations({ schemaVersion: 2.5 }).schemaVersion).toBe(2.5);
  });
});

describe("runMigrations — non-number schemaVersion defaults to version 0 (numeric branch false)", () => {
  it("MISSING schemaVersion → treated as v0, loop+break, NO version fabricated", () => {
    const doc = { regions: [] };
    const result = runMigrations(doc);
    expect(result).toBe(doc);
    expect("schemaVersion" in result).toBe(false); // never invented one
    expect(result).toEqual({ regions: [] });
  });

  it("empty object → same empty object back, still no schemaVersion key", () => {
    const doc = {};
    const result = runMigrations(doc);
    expect(result).toBe(doc);
    expect(result).toEqual({});
  });

  it("STRING '3' is not a number → version 0, breaks, string left intact (not coerced to number)", () => {
    const doc = { schemaVersion: "3" };
    const result = runMigrations(doc);
    expect(result).toBe(doc);
    expect(result.schemaVersion).toBe("3");
  });

  it("NULL schemaVersion (typeof 'object') → version 0, breaks, stays null", () => {
    const doc = { schemaVersion: null };
    const result = runMigrations(doc);
    expect(result).toBe(doc);
    expect(result.schemaVersion).toBeNull();
  });

  it("BOOLEAN true schemaVersion → version 0, breaks, stays true", () => {
    expect(runMigrations({ schemaVersion: true }).schemaVersion).toBe(true);
  });
});

describe("runMigrations — purity: never mutates input, never deep-clones", () => {
  it("does not mutate a deeply-frozen input and returns it by reference", () => {
    const doc = deepFreeze({ schemaVersion: 1, regions: [{ id: "r", blocks: [{ id: "b" }] }] });
    // A frozen object throws on any assignment under strict mode, so a passing
    // toBe here proves the function wrote nothing.
    const result = runMigrations(doc);
    expect(result).toBe(doc);
  });

  it("leaves the original object structurally identical (deep snapshot equal)", () => {
    const doc = { schemaVersion: 2, regions: [{ id: "r", blocks: [] }], meta: { a: 1 } };
    const snapshot = structuredClone(doc);
    runMigrations(doc);
    expect(doc).toEqual(snapshot);
  });

  it("preserves nested references (pass-through, not a copy)", () => {
    const regions = [{ id: "r", blocks: [] }];
    const doc = { schemaVersion: 3, regions };
    expect(runMigrations(doc).regions).toBe(regions);
  });
});
