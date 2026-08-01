import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import {
  vec2Schema,
  sizeSchema,
  cameraSchema,
  blockSchema,
  regionSchema,
  workspaceDocSchema,
  type WorkspaceDocInput,
} from "@/features/workspace/serialization/schema";

/**
 * schema.ts — the zod trust boundary for persisted workspace documents. Unknown
 * JSON read back from disk is parsed HERE before it can become a live document, so
 * corrupt/hostile data must be rejected with precise, structured errors rather than
 * crashing the workspace. This module is pure validation LOGIC over untrusted input
 * (CLAUDE.md §H1.7) — there is NO I/O edge to fake; every schema is exercised for
 * real with valid AND hostile input, and every assertion names the EXACT parsed
 * value or the EXACT rejection (issue `code` + `path`), never "did not throw".
 *
 * Real zod@4.4.3 behaviour pinned by this suite (verified empirically, not from
 * memory — these are the branch decisions the parser makes):
 *   - `z.number()` REJECTS NaN, Infinity, booleans and numeric strings (no coercion).
 *   - `z.object` STRIPS unknown keys from its output (extra props dropped, not error).
 *   - `.optional()` absent  → key OMITTED from output; present-as-`undefined` → key KEPT.
 *   - `z.unknown()` (block `data`) requires the key to be PRESENT (missing → invalid_type,
 *     expected "nonoptional") but accepts any value incl. `undefined` / `null` / nested.
 *   - Every type mismatch surfaces `code: "invalid_type"` at the precise nested `path`.
 */

// --- narrowing helpers: turn a discriminated safeParse result into data | error ---
type Parsed<T> = { success: true; data: T } | { success: false; error: ZodError };

function ok<T>(res: Parsed<T>): T {
  expect(res.success, "expected schema to ACCEPT this input").toBe(true);
  if (!res.success) throw new Error(`parse failed: ${JSON.stringify(res.error.issues)}`);
  return res.data;
}

function fail<T>(res: Parsed<T>): ZodError {
  expect(res.success, "expected schema to REJECT this input").toBe(false);
  if (res.success) throw new Error("parse unexpectedly succeeded");
  return res.error;
}

/** All issue paths, for asserting multi-error collection. */
function paths(err: ZodError): ReadonlyArray<ReadonlyArray<PropertyKey>> {
  return err.issues.map((i) => i.path);
}

// --- reusable VALID fixtures (fresh copy each call so mutations never leak) ---
const makeBlock = () => ({
  id: "b1",
  type: "text",
  position: { x: 10, y: 20 },
  size: { w: 100, h: 40 },
  z: 0,
  data: { text: "hi" },
});
const makeRegion = () => ({
  id: "r1",
  title: "Explanation",
  position: { x: 0, y: 0 },
  size: { w: 400, h: 300 },
  blocks: [makeBlock()],
  createdAt: 1500,
  accent: "#abc",
});
const makeDoc = () => ({
  id: "ws",
  schemaVersion: 3,
  topic: "photosynthesis",
  regions: [makeRegion()],
  createdAt: 1000,
  updatedAt: 2000,
});

describe("vec2Schema", () => {
  it("accepts a valid point and returns it verbatim", () => {
    expect(ok(vec2Schema.safeParse({ x: 1.5, y: -2 }))).toEqual({ x: 1.5, y: -2 });
  });

  it("accepts zero, negative and float coordinates (all real numbers)", () => {
    expect(ok(vec2Schema.safeParse({ x: 0, y: 0 }))).toEqual({ x: 0, y: 0 });
    expect(ok(vec2Schema.safeParse({ x: -3.14, y: 999999 }))).toEqual({ x: -3.14, y: 999999 });
  });

  it("STRIPS unknown keys from the output (z, foo dropped)", () => {
    const parsed = ok(vec2Schema.safeParse({ x: 1, y: 2, z: 3, foo: "bar" }));
    expect(parsed).toEqual({ x: 1, y: 2 });
    expect(Object.keys(parsed).sort()).toEqual(["x", "y"]);
  });

  it("rejects a missing y with invalid_type at path ['y']", () => {
    const err = fail(vec2Schema.safeParse({ x: 1 }));
    expect(err.issues[0].code).toBe("invalid_type");
    expect(err.issues[0].path).toEqual(["y"]);
  });

  it("reports BOTH missing coordinates when the object is empty", () => {
    const err = fail(vec2Schema.safeParse({}));
    expect(err.issues).toHaveLength(2);
    expect(paths(err)).toEqual([["x"], ["y"]]);
  });

  it("rejects a string coordinate (no coercion) at path ['x']", () => {
    const err = fail(vec2Schema.safeParse({ x: "1", y: 2 }));
    expect(err.issues[0].code).toBe("invalid_type");
    expect(err.issues[0].path).toEqual(["x"]);
  });

  it("rejects NaN as x (typeof number, but not a valid number)", () => {
    const err = fail(vec2Schema.safeParse({ x: NaN, y: 0 }));
    expect(err.issues[0].code).toBe("invalid_type");
    expect(err.issues[0].path).toEqual(["x"]);
    expect(err.issues[0].message).toMatch(/NaN/);
  });

  it("rejects Infinity and boolean as coordinates", () => {
    expect(fail(vec2Schema.safeParse({ x: Infinity, y: 0 })).issues[0].path).toEqual(["x"]);
    expect(fail(vec2Schema.safeParse({ x: 1, y: true })).issues[0].path).toEqual(["y"]);
  });

  it("rejects a non-object top value (null) with invalid_type at the ROOT path []", () => {
    const err = fail(vec2Schema.safeParse(null));
    expect(err.issues[0].code).toBe("invalid_type");
    expect(err.issues[0].path).toEqual([]);
  });

  it("rejects an array in place of the object", () => {
    expect(fail(vec2Schema.safeParse([1, 2])).issues[0].code).toBe("invalid_type");
  });
});

describe("sizeSchema", () => {
  it("accepts a valid size and returns it verbatim", () => {
    expect(ok(sizeSchema.safeParse({ w: 800, h: 600 }))).toEqual({ w: 800, h: 600 });
  });

  it("rejects a missing h at path ['h']", () => {
    expect(fail(sizeSchema.safeParse({ w: 10 })).issues[0].path).toEqual(["h"]);
  });

  it("rejects a string width at path ['w']", () => {
    const err = fail(sizeSchema.safeParse({ w: "wide", h: 1 }));
    expect(err.issues[0].code).toBe("invalid_type");
    expect(err.issues[0].path).toEqual(["w"]);
  });
});

describe("cameraSchema", () => {
  it("accepts a full camera {x,y,scale} verbatim", () => {
    expect(ok(cameraSchema.safeParse({ x: 12, y: -8, scale: 1.5 }))).toEqual({ x: 12, y: -8, scale: 1.5 });
  });

  it("STRIPS unknown keys but keeps x/y/scale", () => {
    const parsed = ok(cameraSchema.safeParse({ x: 0, y: 0, scale: 1, dragging: true }));
    expect(Object.keys(parsed).sort()).toEqual(["scale", "x", "y"]);
  });

  it("rejects a missing scale at path ['scale']", () => {
    expect(fail(cameraSchema.safeParse({ x: 1, y: 2 })).issues[0].path).toEqual(["scale"]);
  });

  it("rejects a non-numeric scale", () => {
    const err = fail(cameraSchema.safeParse({ x: 1, y: 2, scale: "2x" }));
    expect(err.issues[0].code).toBe("invalid_type");
    expect(err.issues[0].path).toEqual(["scale"]);
  });
});

describe("blockSchema", () => {
  it("accepts a full valid block and preserves the opaque `data` payload verbatim", () => {
    const input = makeBlock();
    input.data = { text: "keep", nested: { arr: [1, 2, { deep: true }] } } as never;
    const parsed = ok(blockSchema.safeParse(input));
    expect(parsed).toEqual(input);
    expect(parsed.data).toEqual({ text: "keep", nested: { arr: [1, 2, { deep: true }] } });
  });

  it("keeps `data` as null / number / string unchanged (z.unknown accepts any value)", () => {
    expect(ok(blockSchema.safeParse({ ...makeBlock(), data: null })).data).toBeNull();
    expect(ok(blockSchema.safeParse({ ...makeBlock(), data: 42 })).data).toBe(42);
    expect(ok(blockSchema.safeParse({ ...makeBlock(), data: "raw" })).data).toBe("raw");
  });

  it("REQUIRES the `data` key to be present — missing it fails at path ['data'] (zod v4 nonoptional)", () => {
    const { data: _drop, ...noData } = makeBlock();
    void _drop;
    const err = fail(blockSchema.safeParse(noData));
    expect(err.issues[0].code).toBe("invalid_type");
    expect(err.issues[0].path).toEqual(["data"]);
  });

  it("accepts `data: undefined` when the key is explicitly present, keeping the key", () => {
    const parsed = ok(blockSchema.safeParse({ ...makeBlock(), data: undefined }));
    expect("data" in parsed).toBe(true);
    expect(parsed.data).toBeUndefined();
  });

  it("rejects a missing nested position sub-object at path ['position']", () => {
    const { position: _p, ...noPos } = makeBlock();
    void _p;
    expect(fail(blockSchema.safeParse(noPos)).issues[0].path).toEqual(["position"]);
  });

  it("rejects a bad nested coordinate at the deep path ['position','x']", () => {
    const bad = makeBlock();
    bad.position = { x: "NOPE", y: 0 } as never;
    const err = fail(blockSchema.safeParse(bad));
    expect(err.issues[0].code).toBe("invalid_type");
    expect(err.issues[0].path).toEqual(["position", "x"]);
  });

  it("rejects a bad nested size dimension at the deep path ['size','h']", () => {
    const bad = makeBlock();
    bad.size = { w: 10, h: "tall" } as never;
    expect(fail(blockSchema.safeParse(bad)).issues[0].path).toEqual(["size", "h"]);
  });

  it("rejects a missing z-order at path ['z']", () => {
    const { z: _z, ...noZ } = makeBlock();
    void _z;
    expect(fail(blockSchema.safeParse(noZ)).issues[0].path).toEqual(["z"]);
  });

  it("rejects a non-string id at path ['id'] and a non-string type at path ['type']", () => {
    expect(fail(blockSchema.safeParse({ ...makeBlock(), id: 7 })).issues[0].path).toEqual(["id"]);
    expect(fail(blockSchema.safeParse({ ...makeBlock(), type: null })).issues[0].path).toEqual(["type"]);
  });
});

describe("regionSchema", () => {
  it("accepts a full valid region (with accent + one block) verbatim", () => {
    const input = makeRegion();
    expect(ok(regionSchema.safeParse(input))).toEqual(input);
  });

  it("accepts a region with an EMPTY blocks array", () => {
    const parsed = ok(regionSchema.safeParse({ ...makeRegion(), blocks: [] }));
    expect(parsed.blocks).toEqual([]);
  });

  it("OMITS optional accent from output when absent", () => {
    const { accent: _a, ...noAccent } = makeRegion();
    void _a;
    const parsed = ok(regionSchema.safeParse(noAccent));
    expect("accent" in parsed).toBe(false);
  });

  it("KEEPS optional accent key when present as undefined", () => {
    const parsed = ok(regionSchema.safeParse({ ...makeRegion(), accent: undefined }));
    expect("accent" in parsed).toBe(true);
    expect(parsed.accent).toBeUndefined();
  });

  it("rejects a non-string accent at path ['accent']", () => {
    const err = fail(regionSchema.safeParse({ ...makeRegion(), accent: 123 }));
    expect(err.issues[0].code).toBe("invalid_type");
    expect(err.issues[0].path).toEqual(["accent"]);
  });

  it("rejects blocks that is not an array at path ['blocks']", () => {
    const err = fail(regionSchema.safeParse({ ...makeRegion(), blocks: "nope" }));
    expect(err.issues[0].code).toBe("invalid_type");
    expect(err.issues[0].path).toEqual(["blocks"]);
  });

  it("validates EACH block element — a broken block[0] fails at ['blocks',0,'size','w']", () => {
    const region = makeRegion();
    region.blocks[0].size = { w: "big", h: 1 } as never;
    expect(fail(regionSchema.safeParse(region)).issues[0].path).toEqual(["blocks", 0, "size", "w"]);
  });

  it("reports the correct index for a broken block deeper in the array", () => {
    const region = makeRegion();
    region.blocks = [makeBlock(), makeBlock()];
    region.blocks[1].id = 99 as never;
    expect(fail(regionSchema.safeParse(region)).issues[0].path).toEqual(["blocks", 1, "id"]);
  });

  it("rejects a missing title at ['title'] and a missing createdAt at ['createdAt']", () => {
    const { title: _t, ...noTitle } = makeRegion();
    void _t;
    expect(fail(regionSchema.safeParse(noTitle)).issues[0].path).toEqual(["title"]);
    const { createdAt: _c, ...noCreated } = makeRegion();
    void _c;
    expect(fail(regionSchema.safeParse(noCreated)).issues[0].path).toEqual(["createdAt"]);
  });
});

describe("workspaceDocSchema", () => {
  it("accepts a complete document and round-trips it verbatim", () => {
    const input = makeDoc();
    const parsed = ok(workspaceDocSchema.safeParse(input));
    expect(parsed).toEqual(input);
    expect(parsed.regions[0].blocks[0].id).toBe("b1");
  });

  it("accepts a document with an EMPTY regions array", () => {
    const parsed = ok(workspaceDocSchema.safeParse({ ...makeDoc(), regions: [] }));
    expect(parsed.regions).toEqual([]);
  });

  it("OMITS optional topic from output when absent", () => {
    const { topic: _t, ...noTopic } = makeDoc();
    void _t;
    const parsed = ok(workspaceDocSchema.safeParse(noTopic));
    expect("topic" in parsed).toBe(false);
  });

  it("KEEPS optional topic key when present as undefined", () => {
    const parsed = ok(workspaceDocSchema.safeParse({ ...makeDoc(), topic: undefined }));
    expect("topic" in parsed).toBe(true);
    expect(parsed.topic).toBeUndefined();
  });

  it("STRIPS unknown top-level keys (e.g. a rogue `camera`)", () => {
    const parsed = ok(workspaceDocSchema.safeParse({ ...makeDoc(), camera: { x: 1, y: 2, scale: 1 } }));
    expect("camera" in parsed).toBe(false);
    expect(Object.keys(parsed).sort()).toEqual(["createdAt", "id", "regions", "schemaVersion", "topic", "updatedAt"]);
  });

  it("rejects a non-numeric schemaVersion at path ['schemaVersion']", () => {
    const err = fail(workspaceDocSchema.safeParse({ ...makeDoc(), schemaVersion: "3" }));
    expect(err.issues[0].code).toBe("invalid_type");
    expect(err.issues[0].path).toEqual(["schemaVersion"]);
  });

  it("rejects regions that is not an array at path ['regions']", () => {
    expect(fail(workspaceDocSchema.safeParse({ ...makeDoc(), regions: {} })).issues[0].path).toEqual(["regions"]);
  });

  it("rejects a missing updatedAt at path ['updatedAt']", () => {
    const { updatedAt: _u, ...noUpdated } = makeDoc();
    void _u;
    expect(fail(workspaceDocSchema.safeParse(noUpdated)).issues[0].path).toEqual(["updatedAt"]);
  });

  it("surfaces a DEEPLY nested block error at ['regions',0,'blocks',0,'position','x']", () => {
    const doc = makeDoc();
    doc.regions[0].blocks[0].position = { x: "BAD", y: 0 } as never;
    const err = fail(workspaceDocSchema.safeParse(doc));
    expect(err.issues[0].code).toBe("invalid_type");
    expect(err.issues[0].path).toEqual(["regions", 0, "blocks", 0, "position", "x"]);
  });

  it("collects MULTIPLE independent errors from a maximally-broken document", () => {
    const err = fail(
      workspaceDocSchema.safeParse({ id: 1, schemaVersion: "x", regions: "no", createdAt: {}, updatedAt: [] }),
    );
    const flat = paths(err).map((p) => p.join("."));
    expect(flat).toEqual(
      expect.arrayContaining(["id", "schemaVersion", "regions", "createdAt", "updatedAt"]),
    );
    expect(err.issues.length).toBeGreaterThanOrEqual(5);
  });

  it("rejects a null document at the ROOT path []", () => {
    expect(fail(workspaceDocSchema.safeParse(null)).issues[0].path).toEqual([]);
  });
});

describe("workspaceDocSchema.parse (throwing variant) + WorkspaceDocInput type", () => {
  it("returns the parsed document on valid input, typed as WorkspaceDocInput", () => {
    const doc: WorkspaceDocInput = workspaceDocSchema.parse(makeDoc());
    expect(doc.id).toBe("ws");
    expect(doc.schemaVersion).toBe(3);
    expect(doc.regions[0].blocks[0].data).toEqual({ text: "hi" });
  });

  it("THROWS a ZodError (not a silent null) on invalid input", () => {
    expect(() => workspaceDocSchema.parse({ id: "x" })).toThrow(ZodError);
  });
});
