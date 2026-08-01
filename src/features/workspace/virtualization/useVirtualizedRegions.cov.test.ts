import { describe, it, expect, vi } from "vitest";

/**
 * useVirtualizedRegions.ts — viewport culling: given every region + the camera,
 * return only the regions that intersect the (margin-inflated) visible world rect
 * and, per surviving region, only the blocks that themselves intersect it.
 *
 * The ONLY thing faked is the framework edge (§H1.7): React's `useMemo` is replaced
 * with a runner that invokes the factory synchronously, so the REAL culling body
 * executes — the REAL `visibleWorldRect` transform (cameraMath) and the REAL
 * `inflateRect`/`rectIntersects` geometry run against real regions/blocks. Every
 * expected value below is a hand-computed exact double asserted as the outcome
 * (§H1.2), never "it ran". Region and block object identities are asserted with
 * `.toBe` where it matters — the hook must pass the *same* references through.
 *
 * Reference viewport used across most cases: camera {0,0,scale 1}, viewport
 * {1000,1000}, default margin 300 →
 *   visibleWorldRect = {x:0,y:0,w:1000,h:1000}
 *   inflated view    = {x:-300,y:-300,w:1600,h:1600}  → spans x∈[-300,1300], y∈[-300,1300]
 * A positive-size rect `b` intersects that view iff  b.x ≤ 1300 ∧ b.y ≤ 1300
 * (its far edges are always ≥ -300), which is what makes the numbers below easy to verify.
 *
 * Branches covered:
 *   guard:            w===0 (→[]) · h===0 (→[]) · both 0 (→[]) · both non-zero (compute)
 *                     · `||` short-circuit (w=0,h≠0 and w≠0,h=0 each still →[])
 *   region loop:      !intersect → continue (culled) · intersect → pushed · order preserved · empty regions
 *   block filter:     block intersects → kept · block off-screen → dropped · empty blocks → []
 *   region-local→world: `region.pos + block.pos` on BOTH axes (flip-x and flip-y probes)
 *   camera transform: zoom (scale 2) shrinks the visible world · pan (cam.x) shifts it
 *   margin:           default 300 includes a far region that margin 0 culls · custom margin · default===explicit 300
 *   boundary:         touching the view's far edge counts as visible (< vs ≤)
 */

// ---- React edge: run the useMemo factory synchronously so the REAL body executes (§H1.7) -----------
vi.mock("react", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("react");
  return { ...actual, useMemo: <T>(fn: () => T) => fn() };
});

import { useVirtualizedRegions } from "./useVirtualizedRegions";
import type { BlockInstance, Camera, Region, Size } from "@/features/workspace/types";

// ---- Fixture builders ------------------------------------------------------------------------------
let seq = 0;
function mkBlock(x: number, y: number, w: number, h: number, id = `b${++seq}`): BlockInstance {
  return { id, type: "text", position: { x, y }, size: { w, h }, z: 0, data: null };
}
function mkRegion(
  x: number,
  y: number,
  w: number,
  h: number,
  blocks: BlockInstance[] = [],
  id = `r${++seq}`
): Region {
  return { id, title: id, position: { x, y }, size: { w, h }, blocks, createdAt: 0 };
}

const CAM: Camera = { x: 0, y: 0, scale: 1 };
const VP: Size = { w: 1000, h: 1000 };

// ===================================================================================================
describe("useVirtualizedRegions — empty-viewport guard", () => {
  // A region that WOULD be included if the guard were bypassed (origin sits inside the inflated
  // zero-rect), so a mutant that skips the early return returns [region] instead of [] → dies.
  const wouldShow = () => [mkRegion(0, 0, 100, 100, [mkBlock(10, 10, 20, 20)])];

  it("viewport.w === 0 → [] (and does NOT compute the visible set)", () => {
    expect(useVirtualizedRegions(wouldShow(), CAM, { w: 0, h: 600 })).toEqual([]);
  });

  it("viewport.h === 0 → [] (kills the `||` second operand independently)", () => {
    expect(useVirtualizedRegions(wouldShow(), CAM, { w: 800, h: 0 })).toEqual([]);
  });

  it("both dimensions 0 → []", () => {
    expect(useVirtualizedRegions(wouldShow(), CAM, { w: 0, h: 0 })).toEqual([]);
  });

  it("a normal viewport does NOT hit the guard (proves the guard isn't forced-true)", () => {
    const out = useVirtualizedRegions(wouldShow(), CAM, VP);
    expect(out).toHaveLength(1);
  });
});

describe("useVirtualizedRegions — region-level culling", () => {
  it("keeps intersecting regions, drops off-screen ones, and preserves input order", () => {
    const onScreenA = mkRegion(0, 0, 200, 200, [], "A");
    const offScreen = mkRegion(5000, 5000, 100, 100, [], "OFF"); // x=5000 > 1300 → culled
    const onScreenC = mkRegion(200, 200, 100, 100, [], "C");
    const out = useVirtualizedRegions([onScreenA, offScreen, onScreenC], CAM, VP);

    expect(out).toHaveLength(2);
    expect(out[0].region).toBe(onScreenA); // same reference passed through
    expect(out[1].region).toBe(onScreenC);
    expect(out.map((v) => v.region.id)).toEqual(["A", "C"]); // OFF removed, order kept
  });

  it("empty regions array → []", () => {
    expect(useVirtualizedRegions([], CAM, VP)).toEqual([]);
  });

  it("a region with no blocks is still included with visibleBlocks: []", () => {
    const r = mkRegion(100, 100, 50, 50, []);
    const out = useVirtualizedRegions([r], CAM, VP);
    expect(out).toEqual([{ region: r, visibleBlocks: [] }]);
    expect(out[0].region).toBe(r);
  });

  it("touching the view's far edge counts as visible; one pixel past is culled (≤ boundary)", () => {
    // view far-x edge = -300 + 1600 = 1300.
    const touching = mkRegion(1300, 0, 10, 10, [], "TOUCH"); // rRect.x === 1300 → intersects
    const past = mkRegion(1301, 0, 10, 10, [], "PAST"); // rRect.x === 1301 → 1300 >= 1301 is false
    const out = useVirtualizedRegions([touching, past], CAM, VP);
    expect(out.map((v) => v.region.id)).toEqual(["TOUCH"]);
  });
});

describe("useVirtualizedRegions — block-level culling within a surviving region", () => {
  it("returns only the blocks that intersect the view, dropping off-screen blocks", () => {
    const visible = mkBlock(100, 100, 50, 50, "vis"); // world (100,100) → in view
    const hidden = mkBlock(1900, 1900, 50, 50, "hid"); // world (1900,1900) → 1900 > 1300 → out
    const region = mkRegion(0, 0, 2000, 2000, [visible, hidden]);
    const out = useVirtualizedRegions([region], CAM, VP);

    expect(out).toHaveLength(1);
    expect(out[0].visibleBlocks).toHaveLength(1);
    expect(out[0].visibleBlocks[0]).toBe(visible); // exact block reference, not a copy
    expect(out[0].visibleBlocks.map((b) => b.id)).toEqual(["vis"]);
  });

  it("adds region origin to block-local coords on BOTH axes (world = region + block)", () => {
    // Region far bottom-right; its rRect {600,600,800,800} still intersects the view (600 ≤ 1300).
    const region = mkRegion(600, 600, 800, 800, [
      // local (100,100) → world (700,700): visible under the correct `+`; stays visible if an axis flips.
      mkBlock(100, 100, 50, 50, "in"),
      // local (800,100) → world (1400,700): x=1400 > 1300 → hidden. Flipping ONLY the x `+` to `-`
      // gives world (-200,700) → visible, so asserting it's DROPPED kills the x-axis arithmetic mutant.
      mkBlock(800, 100, 50, 50, "flipX"),
      // local (100,800) → world (700,1400): y=1400 > 1300 → hidden. Flipping ONLY the y `+` to `-`
      // gives world (700,-200) → visible, so asserting it's DROPPED kills the y-axis arithmetic mutant.
      mkBlock(100, 800, 50, 50, "flipY"),
    ]);
    const out = useVirtualizedRegions([region], CAM, VP);
    expect(out[0].visibleBlocks.map((b) => b.id)).toEqual(["in"]);
  });
});

describe("useVirtualizedRegions — camera transform feeds the visible rect", () => {
  it("zooming in (scale 2) shrinks the visible world so a formerly-visible region is culled", () => {
    // scale 2: visibleWorldRect = {0,0,500,500}; inflated view spans x∈[-300,800].
    const cam: Camera = { x: 0, y: 0, scale: 2 };
    const near = mkRegion(700, 0, 50, 50, [], "NEAR"); // 700 ≤ 800 → in
    const far = mkRegion(900, 0, 50, 50, [], "FAR"); // 900 > 800 → out (yet at scale 1 it would show)
    const zoomed = useVirtualizedRegions([near, far], cam, VP);
    expect(zoomed.map((v) => v.region.id)).toEqual(["NEAR"]);
    // Sanity: at scale 1 the same FAR region IS visible (900 ≤ 1300) — proves scale did the culling.
    const unzoomed = useVirtualizedRegions([near, far], CAM, VP);
    expect(unzoomed.map((v) => v.region.id)).toEqual(["NEAR", "FAR"]);
  });

  it("panning right (cam.x = -400) shifts the visible world and culls what fell off the left", () => {
    // cam.x -400: topLeft world x = 400; view spans x∈[100,1700].
    const cam: Camera = { x: -400, y: 0, scale: 1 };
    const left = mkRegion(0, 0, 50, 50, [], "LEFT"); // rRect far-x = 50 < 100 → out
    const inView = mkRegion(200, 0, 50, 50, [], "IN"); // 100 ≤ 250 and 200 ≤ 1700 → in
    const out = useVirtualizedRegions([left, inView], cam, VP);
    expect(out.map((v) => v.region.id)).toEqual(["IN"]);
  });
});

describe("useVirtualizedRegions — pre-render margin", () => {
  const farRegion = () => [mkRegion(1100, 0, 50, 50, [], "FAR")]; // rRect.x = 1100

  it("default margin (300) includes a region that margin 0 culls", () => {
    // margin 0 → view = {0,0,1000,1000}, far-x edge 1000; region x=1100 → 1000 >= 1100 false → culled.
    expect(useVirtualizedRegions(farRegion(), CAM, VP, 0)).toEqual([]);
    // default 300 → far-x edge 1300; region x=1100 → included.
    expect(useVirtualizedRegions(farRegion(), CAM, VP).map((v) => v.region.id)).toEqual(["FAR"]);
  });

  it("a custom margin widens the view: margin 150 keeps x=1100 but margin 50 drops it", () => {
    // margin 150 → far-x edge 1000+150 = 1150 ≥ 1100 → in.
    expect(useVirtualizedRegions(farRegion(), CAM, VP, 150).map((v) => v.region.id)).toEqual(["FAR"]);
    // margin 50 → far-x edge 1050 < 1100 → out.
    expect(useVirtualizedRegions(farRegion(), CAM, VP, 50)).toEqual([]);
  });

  it("omitting the margin arg is identical to passing exactly 300 (pins the default)", () => {
    const region = mkRegion(1200, 0, 50, 50, [mkBlock(10, 10, 20, 20)], "R");
    const viaDefault = useVirtualizedRegions([region], CAM, VP);
    const viaExplicit = useVirtualizedRegions([region], CAM, VP, 300);
    expect(viaDefault).toEqual(viaExplicit);
    expect(viaDefault.map((v) => v.region.id)).toEqual(["R"]); // 1200 ≤ 1300 → visible at margin 300
  });
});
