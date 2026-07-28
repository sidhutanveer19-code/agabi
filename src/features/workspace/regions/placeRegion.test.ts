import { describe, it, expect } from "vitest";
import type { Region, Size, Vec2 } from "@/features/workspace/types";
import { placeRegion, DEFAULT_REGION_SIZE } from "@/features/workspace/regions/placeRegion";

/**
 * placeRegion — the non-overlapping slot finder for new explanation regions.
 *
 * A PURE function: no DB/network/clock, so there is NO I/O edge to fake — every
 * assertion runs the REAL geometry against `rectIntersects` and names the EXACT
 * world coordinate returned (never "returned something"). Module constants that
 * drive the math (must match the source): GAP=48, ROW_WIDTH=2400, STEP=40,
 * DEFAULT_REGION_SIZE={w:640,h:460}. Derived for the default size:
 *   colStep = w+GAP = 688 · rowHeight = h+GAP = 508 · maxCols = max(1, floor(2400/688)) = 3
 *
 * Branches under test:
 *   - existing.length === 0 → early-return {0,0}
 *   - non-empty: first-free-slot scan in reading order (col across, then row down)
 *   - collides true (skip) vs false (return); .some short-circuit both ways
 *   - inner col loop exhausts a full row → wrap to the next row
 *   - maxCols = Math.max(1, floor>0) [floor wins] AND Math.max(1, 0) [clamp wins]
 *   - the "unreachable" fallback (grid fully blocked) → {0, lowest+STEP}
 *   - the fallback's reduce: seed 0, and Math.max in BOTH directions (new>acc, acc>new)
 */

/** Build a Region at a world position with a footprint; only fields placeRegion reads matter. */
function region(x: number, y: number, w: number, h: number, id = "r"): Region {
  return {
    id,
    title: "t",
    position: { x, y },
    size: { w, h },
    blocks: [],
    createdAt: 0,
  };
}

/** A default-footprint region at a given column/row of the default packing grid. */
function defaultAt(col: number, row: number, id: string): Region {
  const colStep = DEFAULT_REGION_SIZE.w + 48; // 688
  const rowHeight = DEFAULT_REGION_SIZE.h + 48; // 508
  return region(col * colStep, row * rowHeight, DEFAULT_REGION_SIZE.w, DEFAULT_REGION_SIZE.h, id);
}

const SIZE: Size = DEFAULT_REGION_SIZE; // {w:640,h:460}

describe("placeRegion — empty canvas (early return)", () => {
  it("no existing regions → origin {0,0}, ignoring the requested size", () => {
    expect(placeRegion([], SIZE)).toEqual<Vec2>({ x: 0, y: 0 });
    // size is irrelevant on the empty path — a wildly different size still yields origin
    expect(placeRegion([], { w: 5, h: 5 })).toEqual<Vec2>({ x: 0, y: 0 });
  });
});

describe("placeRegion — reading-order packing (default size)", () => {
  it("one region AT the origin → next free slot is column 1: {688,0}", () => {
    expect(placeRegion([defaultAt(0, 0, "a")], SIZE)).toEqual<Vec2>({ x: 688, y: 0 });
  });

  it("non-empty but origin is FREE (region parked far away) → still {0,0}", () => {
    // Exercises length>0 entering the loop yet the very first candidate not colliding
    // (.some returns false), so the packed origin is returned.
    expect(placeRegion([region(5000, 5000, 640, 460, "far")], SIZE)).toEqual<Vec2>({ x: 0, y: 0 });
  });

  it("columns 0 and 1 taken → fills column 2: {1376,0}", () => {
    const existing = [defaultAt(0, 0, "a"), defaultAt(1, 0, "b")];
    expect(placeRegion(existing, SIZE)).toEqual<Vec2>({ x: 1376, y: 0 });
  });

  it("a GAP mid-row (cols 0 and 2 taken, col 1 free) → fills the gap: {688,0}", () => {
    // .some must be false for the col-1 candidate even though other regions exist:
    // proves both a false-then-continue and the final false-then-return.
    const existing = [defaultAt(0, 0, "a"), defaultAt(2, 0, "c")];
    expect(placeRegion(existing, SIZE)).toEqual<Vec2>({ x: 688, y: 0 });
  });

  it("row 0 completely full (cols 0,1,2) → WRAPS to row 1: {0,508}", () => {
    // Inner col loop exhausts all maxCols candidates in row 0, forcing row++ .
    const existing = [defaultAt(0, 0, "a"), defaultAt(1, 0, "b"), defaultAt(2, 0, "c")];
    expect(placeRegion(existing, SIZE)).toEqual<Vec2>({ x: 0, y: 508 });
  });

  it("rows 0 and 1 full → wraps to row 2: {0,1016}", () => {
    const existing = [
      defaultAt(0, 0, "a0"), defaultAt(1, 0, "b0"), defaultAt(2, 0, "c0"),
      defaultAt(0, 1, "a1"), defaultAt(1, 1, "b1"), defaultAt(2, 1, "c1"),
    ];
    expect(placeRegion(existing, SIZE)).toEqual<Vec2>({ x: 0, y: 1016 });
  });
});

describe("placeRegion — GAP separation & edge-touch collisions", () => {
  it("a region abutting the col-1 slot's LEFT edge counts as a collision → skips to col 2", () => {
    // rectIntersects treats touching edges as overlap. The col-1 candidate is
    // [688,1328]x[0,460]; place a region whose right edge is exactly x=688 and that
    // overlaps in y. That candidate must be rejected, landing at col 2 {1376,0}.
    const origin = defaultAt(0, 0, "a"); // blocks col 0
    const toucher = region(48, 0, 640, 460, "touch"); // spans x[48,688], right edge == 688
    expect(placeRegion([origin, toucher], SIZE)).toEqual<Vec2>({ x: 1376, y: 0 });
  });
});

describe("placeRegion — maxCols clamp (Math.max(1, ...))", () => {
  it("size wider than a row → maxCols clamps to 1, so packing goes straight DOWN", () => {
    // w+GAP = 3048 > ROW_WIDTH(2400) → floor(2400/3048)=0 → Math.max(1,0)=1.
    // With one column, a blocked row 0 forces row 1: rowHeight = 100+48 = 148.
    const wide: Size = { w: 3000, h: 100 };
    const existing = [region(0, 0, 3000, 100, "a")];
    expect(placeRegion(existing, wide)).toEqual<Vec2>({ x: 0, y: 148 });
  });

  it("clamp path: two stacked rows blocked → third row at {0,296}", () => {
    const wide: Size = { w: 3000, h: 100 };
    const existing = [region(0, 0, 3000, 100, "a"), region(0, 148, 3000, 100, "b")];
    expect(placeRegion(existing, wide)).toEqual<Vec2>({ x: 0, y: 296 });
  });
});

describe("placeRegion — fallback (grid fully saturated)", () => {
  it("one region blanketing the entire scan grid → fallback {0, lowest+STEP}", () => {
    // A region at {0,0} sized 10,000,000² covers every candidate (max candidate is
    // ~{1376, 5079492} for the default size over 10k rows × 3 cols), so EVERY slot
    // collides and the loop falls through. reduce: max(0, 0+1e7) = 1e7 → y = 1e7+40.
    const giant = region(0, 0, 10_000_000, 10_000_000, "giant");
    expect(placeRegion([giant], SIZE)).toEqual<Vec2>({ x: 0, y: 10_000_040 });
  });

  it("fallback reduce keeps the LARGER bottom edge (acc>new) across regions", () => {
    // Both regions blanket the grid → fallback. reduce over [tallerFirst, shorter]:
    //   0 → max(0, 0+2e7)=2e7 → max(2e7, 0+1e7)=2e7. Proves Math.max keeps the
    //   accumulator when the new region's bottom is lower. y = 2e7 + STEP.
    const tallerFirst = region(0, 0, 10_000_000, 20_000_000, "tall");
    const shorter = region(0, 0, 10_000_000, 10_000_000, "short");
    expect(placeRegion([tallerFirst, shorter], SIZE)).toEqual<Vec2>({ x: 0, y: 20_000_040 });
  });

  it("fallback reduce adopts a LATER, lower region (new>acc) → uses its bottom edge", () => {
    // reduce over [shorterFirst, taller]: 0 → max(0,1e7)=1e7 → max(1e7,3e7)=3e7.
    // Proves the other Math.max direction (new bottom edge wins). y = 3e7 + STEP.
    const shorterFirst = region(0, 0, 10_000_000, 10_000_000, "short");
    const taller = region(0, 0, 10_000_000, 30_000_000, "tall");
    expect(placeRegion([shorterFirst, taller], SIZE)).toEqual<Vec2>({ x: 0, y: 30_000_040 });
  });
});

describe("placeRegion — exported default footprint", () => {
  it("DEFAULT_REGION_SIZE is the fixed {640,460} the packing math assumes", () => {
    expect(DEFAULT_REGION_SIZE).toEqual<Size>({ w: 640, h: 460 });
  });
});
