import { describe, it, expect } from "vitest";
import type { Rect } from "@/features/workspace/types";
import { clamp, rectIntersects, inflateRect, unionRects } from "@/features/workspace/utils/geometry";

/**
 * geometry.ts — pure world-coordinate math for the infinite canvas. No I/O edge
 * exists (no db/clock/network), so nothing is mocked: every branch is exercised
 * for real and the EXACT numeric result is asserted, never "returned something".
 * Branches under test:
 *   - clamp:          n<min → min · n>max → max · in-range → n · both boundaries (===min, ===max)
 *   - rectIntersects: each of the 4 &&-terms driven true AND false (short-circuit), all-true,
 *                     and the touching-edge boundary (edges count as overlap)
 *   - inflateRect:    positive / zero / negative margin (straight-line, exact geometry)
 *   - unionRects:     empty → null early-return; and each of the 4 loop conditionals taken AND skipped
 */

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

describe("clamp — 3-way ternary + boundaries", () => {
  it("value inside the range is returned unchanged (else branch)", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("value below min → clamped up to min (first branch)", () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });

  it("value above max → clamped down to max (second branch)", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("value exactly === min is kept (not < min, so it passes through)", () => {
    expect(clamp(0, 0, 10)).toBe(0);
  });

  it("value exactly === max is kept (not > max, so it passes through)", () => {
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it("works with negative ranges and fractional values", () => {
    expect(clamp(-7.5, -10, -5)).toBe(-7.5);
    expect(clamp(-12, -10, -5)).toBe(-10);
    expect(clamp(-1, -10, -5)).toBe(-5);
  });
});

describe("rectIntersects — the 4-term && chain", () => {
  const a = rect(0, 0, 10, 10);

  it("clearly overlapping rects → true (all four terms true)", () => {
    expect(rectIntersects(a, rect(5, 5, 10, 10))).toBe(true);
  });

  it("term 1 false: a entirely to the RIGHT of b (a.x > b.x+b.w) → false", () => {
    // a.x(20) <= b.x+b.w(10) is false → short-circuits at the first term
    expect(rectIntersects(rect(20, 0, 5, 5), rect(0, 0, 10, 10))).toBe(false);
  });

  it("term 2 false: a entirely to the LEFT of b (a.x+a.w < b.x) → false", () => {
    // term1 true (0 <= 25), term2 false (10 >= 20 is false)
    expect(rectIntersects(a, rect(20, 0, 5, 5))).toBe(false);
  });

  it("term 3 false: a entirely BELOW b (a.y > b.y+b.h) → false", () => {
    // terms 1&2 true, term3 false (20 <= 5 is false)
    expect(rectIntersects(rect(0, 20, 10, 10), rect(0, 0, 10, 5))).toBe(false);
  });

  it("term 4 false: a entirely ABOVE b (a.y+a.h < b.y) → false", () => {
    // terms 1,2,3 true, term4 false (5 >= 20 is false)
    expect(rectIntersects(rect(0, 0, 10, 5), rect(0, 20, 10, 10))).toBe(false);
  });

  it("touching edges count as overlap (boundary: a.x+a.w === b.x) → true", () => {
    // a right edge (x=10) exactly meets b left edge (x=10): 10 >= 10 holds
    expect(rectIntersects(a, rect(10, 0, 5, 5))).toBe(true);
  });

  it("touching at a single corner (a.x+a.w===b.x AND a.y+a.h===b.y) → true", () => {
    expect(rectIntersects(a, rect(10, 10, 3, 3))).toBe(true);
  });
});

describe("inflateRect — grow/shrink on every side", () => {
  it("positive margin grows origin back by m and size by 2m", () => {
    expect(inflateRect(rect(10, 20, 30, 40), 5)).toEqual({ x: 5, y: 15, w: 40, h: 50 });
  });

  it("zero margin returns identical geometry", () => {
    expect(inflateRect(rect(1, 2, 3, 4), 0)).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });

  it("negative margin shrinks the rect (origin in, size down by 2|m|)", () => {
    expect(inflateRect(rect(10, 10, 20, 20), -3)).toEqual({ x: 13, y: 13, w: 14, h: 14 });
  });
});

describe("unionRects — bounding box of many rects", () => {
  it("empty array → null (the length-0 early return)", () => {
    expect(unionRects([])).toBeNull();
  });

  it("single rect → an equal rect (first iteration sets all four extents from Infinity)", () => {
    expect(unionRects([rect(3, 4, 5, 6)])).toEqual({ x: 3, y: 4, w: 5, h: 6 });
  });

  it("exercises every loop conditional both taken and skipped", () => {
    // A: seeds all four extents (minX=10,minY=10,maxX=15,maxY=15).
    // B: extends min-x and min-y only (x<minX T, y<minY T, x+w>maxX F, y+h>maxY F).
    // C: extends max-x and max-y only (x<minX F, y<minY F, x+w>maxX T, y+h>maxY T).
    const a = rect(10, 10, 5, 5);
    const b = rect(0, 0, 1, 1);
    const c = rect(100, 0, 5, 100);
    // minX=0, minY=0, maxX=105, maxY=100 → w=105, h=100
    expect(unionRects([a, b, c])).toEqual({ x: 0, y: 0, w: 105, h: 100 });
  });

  it("a rect fully contained in the running box updates nothing (all four conditionals skipped)", () => {
    const big = rect(0, 0, 100, 100);
    const inside = rect(10, 10, 5, 5); // x>=minX, y>=minY, x+w<=maxX, y+h<=maxY
    expect(unionRects([big, inside])).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  it("handles negative world coordinates correctly", () => {
    expect(unionRects([rect(-50, -30, 10, 10), rect(-10, -10, 5, 5)])).toEqual({
      x: -50,
      y: -30,
      w: 45,
      h: 25,
    });
  });
});
