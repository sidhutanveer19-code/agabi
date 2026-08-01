import { describe, it, expect } from "vitest";
import { runMigrations } from "@/features/workspace/serialization/migrations";
import { SCHEMA_VERSION } from "@/features/workspace/types";

/**
 * runMigrations — additive coverage suite (complements migrations.test.ts).
 *
 * The module is pure logic: no I/O, no globals, nothing to fake. `runMigrations`
 * walks a private, currently-EMPTY `migrations` map. Because that map has no
 * 0→1 / 1→2 / 2→3 entry, `migrations[version]` is always `undefined`, so the very
 * first loop turn hits `if (!migrate) break`. The observable contract is therefore
 * a strict PASS-THROUGH: the SAME input reference is returned, byte-for-byte,
 * `schemaVersion` never touched — whether the `while (version < SCHEMA_VERSION)`
 * guard skips the loop (version >= 3) or the body breaks on turn one (version < 3).
 *
 * Every assertion names the EXACT reference/value. The `.not.toThrow()` +
 * `toBe(doc)` pairs on loop-ENTERING inputs are the load-bearing mutation kills:
 * if `if (!migrate) break` were inverted / deleted, control would fall to
 * `doc = migrate(doc)` === `undefined(doc)` and throw a TypeError — these tests
 * would then go red. The pass-through equality checks are DESIGNED to fail the
 * instant a real migration is registered, forcing genuine migration tests then
 * (CLAUDE.md §H1.8). Do not weaken; only tighten.
 */

describe("runMigrations — contract constants pinned", () => {
  it("SCHEMA_VERSION is exactly 3 (drives every boundary below)", () => {
    expect(SCHEMA_VERSION).toBe(3);
  });

  it("no forward migration is registered: every pre-current version stays UNBUMPED", () => {
    // Observable proof the map has no 0/1/2 entry — none of these advance toward 3.
    for (const v of [0, 1, 2]) {
      const doc = { schemaVersion: v };
      const result = runMigrations(doc);
      expect(result).toBe(doc);
      expect(result.schemaVersion).toBe(v);
    }
  });
});

describe("runMigrations — numeric branch TRUE, guard skips loop (version >= SCHEMA_VERSION)", () => {
  it("version === SCHEMA_VERSION returns the SAME reference, unmodified, no deep clone", () => {
    const regions = [{ id: "r1", blocks: [{ id: "b1" }] }];
    const doc = { schemaVersion: SCHEMA_VERSION, id: "ws", regions };
    const result = runMigrations(doc);
    expect(result).toBe(doc); // guard false → loop body never runs
    expect(result.regions).toBe(regions); // nested refs preserved, not copied
    expect(result).toEqual({ schemaVersion: 3, id: "ws", regions: [{ id: "r1", blocks: [{ id: "b1" }] }] });
  });

  it("version === SCHEMA_VERSION + 1 (future doc) passes through untouched", () => {
    const doc = { schemaVersion: SCHEMA_VERSION + 1, topic: "x" };
    const result = runMigrations(doc);
    expect(result).toBe(doc);
    expect(result.schemaVersion).toBe(4); // downstream validation rejects, not this fn
    expect(result.topic).toBe("x");
  });

  it("a large future version (999) is left exactly as-is", () => {
    expect(runMigrations({ schemaVersion: 999 }).schemaVersion).toBe(999);
  });

  it("Infinity is typeof number and NOT < 3 → loop skipped, stays Infinity", () => {
    const result = runMigrations({ schemaVersion: Infinity });
    expect(result.schemaVersion).toBe(Infinity);
  });

  it("NaN is typeof number yet NaN < 3 is false → loop skipped, stays NaN", () => {
    const doc = { schemaVersion: NaN, keep: 1 };
    const result = runMigrations(doc);
    expect(result).toBe(doc);
    expect(Number.isNaN(result.schemaVersion as number)).toBe(true);
    expect(result.keep).toBe(1);
  });
});

describe("runMigrations — numeric branch TRUE, version < SCHEMA_VERSION enters loop then BREAKS", () => {
  it("version === SCHEMA_VERSION - 1 (boundary 2) enters, breaks, returns SAME ref unbumped", () => {
    const doc = { schemaVersion: SCHEMA_VERSION - 1, regions: [{ id: "r" }] };
    const result = runMigrations(doc);
    expect(result).toBe(doc);
    expect(result.schemaVersion).toBe(2); // critical: NOT advanced to 3
  });

  it("loop-entering input NEVER throws — proves `if (!migrate) break` fires before migrate(doc)", () => {
    // If the break were inverted/removed, `undefined(doc)` would throw here.
    const doc = { schemaVersion: 1, regions: [{ id: "r" }] };
    expect(() => runMigrations(doc)).not.toThrow();
    const result = runMigrations(doc);
    expect(result).toBe(doc);
    expect(result.schemaVersion).toBe(1);
  });

  it("explicit numeric 0 (distinct from a MISSING field) enters via numeric-true, breaks, stays 0", () => {
    const doc = { schemaVersion: 0, a: "b" };
    const result = runMigrations(doc);
    expect(result).toBe(doc);
    expect(result.schemaVersion).toBe(0);
    expect(result.a).toBe("b");
  });

  it("negative version (-5) is < 3 → enters, breaks, stays -5", () => {
    const result = runMigrations({ schemaVersion: -5 });
    expect(result.schemaVersion).toBe(-5);
  });

  it("-Infinity is < 3 → enters, breaks, stays -Infinity", () => {
    expect(runMigrations({ schemaVersion: -Infinity }).schemaVersion).toBe(-Infinity);
  });

  it("non-integer 2.999 is < 3 → enters, breaks, stays 2.999", () => {
    const result = runMigrations({ schemaVersion: 2.999 });
    expect(result.schemaVersion).toBe(2.999);
  });
});

describe("runMigrations — numeric branch FALSE, non-number version defaults to 0", () => {
  it("MISSING schemaVersion → treated as v0, enters+breaks, and NO version is fabricated", () => {
    const doc = { regions: [] as unknown[] };
    const result = runMigrations(doc);
    expect(result).toBe(doc);
    expect("schemaVersion" in result).toBe(false); // never invented
    expect(result).toEqual({ regions: [] });
  });

  it("empty object → same empty object back, still keyless", () => {
    const doc: Record<string, unknown> = {};
    const result = runMigrations(doc);
    expect(result).toBe(doc);
    expect(Object.keys(result)).toEqual([]);
  });

  it("explicit `undefined` schemaVersion → typeof 'undefined' → v0, value left undefined", () => {
    const doc = { schemaVersion: undefined, x: 9 };
    const result = runMigrations(doc);
    expect(result).toBe(doc);
    expect(result.schemaVersion).toBeUndefined();
    expect(result.x).toBe(9);
  });

  it("STRING '3' is not typeof number → v0, string left intact (never coerced)", () => {
    const doc = { schemaVersion: "3" };
    const result = runMigrations(doc);
    expect(result).toBe(doc);
    expect(result.schemaVersion).toBe("3");
    expect(typeof result.schemaVersion).toBe("string");
  });

  it("NULL schemaVersion (typeof 'object') → v0, stays null", () => {
    const doc = { schemaVersion: null };
    const result = runMigrations(doc);
    expect(result).toBe(doc);
    expect(result.schemaVersion).toBeNull();
  });

  it("BOOLEAN false schemaVersion → v0, stays false (not coerced to 0)", () => {
    const result = runMigrations({ schemaVersion: false });
    expect(result.schemaVersion).toBe(false);
  });

  it("BIGINT 3n is typeof 'bigint' not 'number' → v0, stays 3n", () => {
    const doc = { schemaVersion: BigInt(3) };
    const result = runMigrations(doc);
    expect(result).toBe(doc);
    expect(result.schemaVersion).toBe(BigInt(3));
  });

  it("non-number version STILL enters the loop and NEVER throws (break guards migrate)", () => {
    // v0 path also exercises the killable break; assert no throw + same ref.
    const doc = { schemaVersion: "not-a-number" };
    expect(() => runMigrations(doc)).not.toThrow();
    expect(runMigrations(doc)).toBe(doc);
  });
});

describe("runMigrations — purity: no mutation, no clone, key order preserved", () => {
  it("does not write to a deeply-frozen input and returns it by reference", () => {
    const deepFreeze = <T,>(o: T): T => {
      if (o && typeof o === "object") {
        Object.values(o as Record<string, unknown>).forEach((v) => deepFreeze(v));
        Object.freeze(o);
      }
      return o;
    };
    // A frozen object throws on any assignment in strict module mode, so a
    // passing toBe proves the function wrote nothing.
    const doc = deepFreeze({ schemaVersion: 1, regions: [{ id: "r", blocks: [{ id: "b" }] }] });
    expect(runMigrations(doc)).toBe(doc);
  });

  it("leaves the input structurally identical (deep snapshot equal)", () => {
    const doc = { schemaVersion: 2, regions: [{ id: "r", blocks: [] as unknown[] }], meta: { a: 1 } };
    const snapshot = structuredClone(doc);
    runMigrations(doc);
    expect(doc).toEqual(snapshot);
  });

  it("preserves insertion order of keys (no rebuild of the object)", () => {
    const doc = { z: 1, schemaVersion: 5, a: 2 };
    const result = runMigrations(doc);
    expect(Object.keys(result)).toEqual(["z", "schemaVersion", "a"]);
  });

  it("preserves a nested array reference (pass-through, not a copy)", () => {
    const blocks = [{ id: "b" }];
    const doc = { schemaVersion: 3, regions: [{ id: "r", blocks }] };
    const result = runMigrations(doc);
    expect((result.regions as { blocks: unknown }[])[0].blocks).toBe(blocks);
  });
});
