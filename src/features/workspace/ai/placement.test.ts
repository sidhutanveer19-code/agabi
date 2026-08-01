import { describe, it, expect, beforeEach } from "vitest";
import type { Region, Size } from "@/features/workspace/types";
import { useWorkspaceStore, emptyDoc } from "@/features/workspace/stores/workspace.store";
import { placeExplanation } from "@/features/workspace/ai/placement";

/**
 * placeExplanation(size) — reads the LIVE workspace document's regions from the
 * real zustand store and delegates to the pure `placeRegion` reading-order scanner.
 *
 * There is no I/O boundary to fake here (no db/network/clock): the store is an
 * in-memory container, so it and `placeRegion` are exercised FOR REAL. The only
 * thing set up per test is the store's region geometry; every assertion names the
 * EXACT world-space slot the real algorithm must return and checks THAT value.
 *
 * The geometry constants that drive the expected numbers (from placeRegion.ts):
 *   DEFAULT size = {w:640,h:460}, GAP=48, ROW_WIDTH=2400, STEP=40.
 *   colStep = w+GAP = 688,  rowHeight = h+GAP = 508,
 *   maxCols = max(1, floor(2400/688)) = 3.
 * rectIntersects treats TOUCHING edges as overlap (<= / >=).
 *
 * Branches covered through the real path: empty-doc early return; first-slot free;
 * a collision pushing to the next column; a gap between occupied columns; a full
 * row wrapping to the next row; a custom size that forces the `max(1, …)` column
 * guard; the "no free slot in 10 000 rows" fallback + its `reduce`; and a live
 * re-read proving each call sees fresh store state.
 */

const DEFAULT: Size = { w: 640, h: 460 };

function region(id: string, x: number, y: number, w: number, h: number): Region {
  return { id, title: id, position: { x, y }, size: { w, h }, blocks: [], createdAt: 1 };
}

/** Replace the live document with one whose regions are exactly `regions`. */
function setRegions(regions: Region[]): void {
  useWorkspaceStore.setState({ doc: { ...emptyDoc(), regions } });
}

beforeEach(() => {
  // A genuinely empty document before every case (isolation).
  useWorkspaceStore.setState({ doc: emptyDoc() });
});

describe("placeExplanation — empty document (early return)", () => {
  it("no regions → origin {0,0}", () => {
    expect(useWorkspaceStore.getState().doc.regions).toHaveLength(0);
    expect(placeExplanation(DEFAULT)).toEqual({ x: 0, y: 0 });
  });
});

describe("placeExplanation — reading-order placement across columns", () => {
  it("one region at the origin → next free slot is column 1 {688,0}", () => {
    setRegions([region("r0", 0, 0, 640, 460)]);
    expect(placeExplanation(DEFAULT)).toEqual({ x: 688, y: 0 });
  });

  it("columns 0 and 1 filled → column 2 {1376,0}", () => {
    setRegions([region("r0", 0, 0, 640, 460), region("r1", 688, 0, 640, 460)]);
    expect(placeExplanation(DEFAULT)).toEqual({ x: 1376, y: 0 });
  });

  it("a GAP between occupied columns is filled: cols 0 and 2 taken → column 1 {688,0}", () => {
    // col1 candidate (x=688) touches neither r0 (right edge 640 < 688) nor r2
    // (left edge 1376 > candidate right 1328) → it is the first free slot.
    setRegions([region("r0", 0, 0, 640, 460), region("r2", 1376, 0, 640, 460)]);
    expect(placeExplanation(DEFAULT)).toEqual({ x: 688, y: 0 });
  });

  it("a full first row (3 cols) wraps to the next row {0,508}", () => {
    setRegions([
      region("r0", 0, 0, 640, 460),
      region("r1", 688, 0, 640, 460),
      region("r2", 1376, 0, 640, 460),
    ]);
    expect(placeExplanation(DEFAULT)).toEqual({ x: 0, y: 508 });
  });
});

describe("placeExplanation — custom size drives the column-count guard", () => {
  it("a wide size (2400) makes floor(2400/2448)=0, so max(1,…) clamps to a single column → stacks below at {0,148}", () => {
    const wide: Size = { w: 2400, h: 100 };
    setRegions([region("w0", 0, 0, 2400, 100)]);
    // maxCols clamps to 1; rowHeight = 100+48 = 148; only column 0 exists, so the
    // next free slot is row 1 → {0,148}. (Differs from the DEFAULT-size result.)
    expect(placeExplanation(wide)).toEqual({ x: 0, y: 148 });
  });
});

describe("placeExplanation — exhausted-scan fallback (+ reduce over regions)", () => {
  it("two regions taller than the entire 10 000-row scan → fallback stacks below the LOWEST bottom", () => {
    // Both regions blanket every candidate (x∈{0,688,1376} ≤ 2000; y up to
    // 9999*508 = 5 079 492 ≤ their heights), so no slot is ever free and the loop
    // falls through. `reduce` picks the greater bottom: max(6_000_000, 7_000_000).
    setRegions([
      region("g1", 0, 0, 2000, 6_000_000),
      region("g2", 0, 0, 2000, 7_000_000),
    ]);
    expect(placeExplanation(DEFAULT)).toEqual({ x: 0, y: 7_000_000 + 40 });
  });
});

describe("placeExplanation — reads LIVE store state on every call", () => {
  it("same size returns different slots as the document changes underneath it", () => {
    expect(placeExplanation(DEFAULT)).toEqual({ x: 0, y: 0 });
    setRegions([region("r0", 0, 0, 640, 460)]);
    expect(placeExplanation(DEFAULT)).toEqual({ x: 688, y: 0 });
  });
});
