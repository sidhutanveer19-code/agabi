import { describe, it, expect } from "vitest";

import { fitAllCamera, regionCamera } from "@/features/workspace/navigation/navigation";
import type { Camera, Region } from "@/features/workspace/types";

/**
 * navigation.ts — fitAllCamera / regionCamera. PURE geometry: the only collaborators
 * are fitRect (cameraMath) and unionRects (geometry), both pure, so there is NO I/O
 * edge to fake — every branch is exercised against the REAL math and the EXACT camera
 * it must produce is asserted (never "returned something").
 *
 * fitRect model (verified against camera/cameraMath.ts):
 *   availW = max(1, viewport.w - padding*2), availH = max(1, viewport.h - padding*2)
 *   scale  = clamp(min(availW/rect.w, availH/rect.h), 0.1, 4)   // MIN_SCALE..MAX_SCALE
 *   cx = rect.x + rect.w/2, cy = rect.y + rect.h/2
 *   camera = { scale, x: viewport.w/2 - cx*scale, y: viewport.h/2 - cy*scale }
 *
 * Branches covered:
 *   fitAllCamera — empty regions (!rect) → null; non-empty + viewport.w===0 → null;
 *     viewport.h===0 does NOT short-circuit (guard is on .w only) → real camera;
 *     default padding (96) vs explicit padding; single vs multi-region union;
 *     negative world coords; MAX_SCALE clamp; MIN_SCALE clamp; availW/availH floor at 1.
 *   regionCamera — default padding (120) vs explicit; non-origin mapping; MAX clamp.
 */

/** Build a fully-valid Region touching only the fields navigation reads. */
function makeRegion(x: number, y: number, w: number, h: number): Region {
  return {
    id: "r",
    title: "t",
    position: { x, y },
    size: { w, h },
    blocks: [],
    createdAt: 0,
  };
}

/** Assert scale EXACTLY and x/y to 10 decimals (kills FP dust from *0.1, keeps it hard). */
function expectCamera(cam: Camera, scale: number, x: number, y: number): void {
  expect(cam.scale).toBe(scale);
  expect(cam.x).toBeCloseTo(x, 10);
  expect(cam.y).toBeCloseTo(y, 10);
}

describe("fitAllCamera — null branches", () => {
  it("empty regions → unionRects null → !rect branch → returns null", () => {
    expect(fitAllCamera([], { w: 1000, h: 800 })).toBeNull();
  });

  it("non-empty regions but viewport.w === 0 → second || operand → returns null", () => {
    const cam = fitAllCamera([makeRegion(0, 0, 100, 100)], { w: 0, h: 800 });
    expect(cam).toBeNull();
  });

  it("viewport.h === 0 does NOT short-circuit (guard is on .w only) → real camera", () => {
    // availW = max(1, 1000)=1000, availH = max(1, 0)=1 → scale = clamp(min(10, 0.01)) = 0.1
    // cx=cy=50 → x = 500 - 5 = 495, y = 0 - 5 = -5
    const cam = fitAllCamera([makeRegion(0, 0, 100, 100)], { w: 1000, h: 0 }, 0);
    expect(cam).not.toBeNull();
    expectCamera(cam!, 0.1, 495, -5);
  });
});

describe("fitAllCamera — success paths", () => {
  it("single region, DEFAULT padding=96 → exact camera (pins the 96 default)", () => {
    // rect {0,0,2000,2000}, viewport 1192 → availW=1000 → scale 0.5; cx=1000 → x=596-500=96
    // (a default of 120 would give scale 0.476/x 120, so this uniquely pins 96)
    const cam = fitAllCamera([makeRegion(0, 0, 2000, 2000)], { w: 1192, h: 1192 });
    expect(cam).toEqual({ scale: 0.5, x: 96, y: 96 });
  });

  it("multiple regions → union framed, EXPLICIT padding=200", () => {
    // R1 [0..1000], R2 [1000..2000] → union {0,0,2000,2000}
    // viewport 1400, padding 200 → availW=1000 → scale 0.5; cx=1000 → x=700-500=200
    const cam = fitAllCamera(
      [makeRegion(0, 0, 1000, 1000), makeRegion(1000, 1000, 1000, 1000)],
      { w: 1400, h: 1400 },
      200
    );
    expect(cam).toEqual({ scale: 0.5, x: 200, y: 200 });
  });

  it("negative world coordinates union correctly", () => {
    // R1 spans [-500..0], R2 spans [500..1000] → union {-500,-500,1500,1500}
    // viewport 1000, padding 125 → availW=750 → scale 0.5; cx=250 → x=500-125=375
    const cam = fitAllCamera(
      [makeRegion(-500, -500, 500, 500), makeRegion(500, 500, 500, 500)],
      { w: 1000, h: 1000 },
      125
    );
    expect(cam).toEqual({ scale: 0.5, x: 375, y: 375 });
  });

  it("tiny region, huge viewport → scale clamps to MAX_SCALE (4)", () => {
    // availW=2000, rect w=100 → 20 → clamp 4; cx=50 → x=1000-200=800
    const cam = fitAllCamera([makeRegion(0, 0, 100, 100)], { w: 2000, h: 2000 }, 0);
    expect(cam).toEqual({ scale: 4, x: 800, y: 800 });
  });

  it("giant region, small viewport → scale clamps to MIN_SCALE (0.1)", () => {
    // availW=max(1,500-100)=400, rect w=10000 → 0.04 → clamp 0.1; cx=5000 → x=250-500=-250
    const cam = fitAllCamera([makeRegion(0, 0, 10000, 10000)], { w: 500, h: 500 }, 50);
    expect(cam).not.toBeNull();
    expectCamera(cam!, 0.1, -250, -250);
  });

  it("padding larger than half the viewport → availW/availH floor at 1", () => {
    // DEFAULT padding 96 → viewport 100 - 192 = -92 → max(1,-92)=1; scale=clamp(min(0.01,0.01))=0.1
    // cx=50 → x=50-5=45
    const cam = fitAllCamera([makeRegion(0, 0, 100, 100)], { w: 100, h: 100 });
    expect(cam).not.toBeNull();
    expectCamera(cam!, 0.1, 45, 45);
  });
});

describe("regionCamera", () => {
  it("DEFAULT padding=120 → exact camera (pins the 120 default)", () => {
    // rect {0,0,2000,2000}, viewport 1240 → availW=1000 → scale 0.5; cx=1000 → x=620-500=120
    // (a default of 96 would give scale 0.524/x 96, so this uniquely pins 120)
    const cam = regionCamera(makeRegion(0, 0, 2000, 2000), { w: 1240, h: 1240 });
    expect(cam).toEqual({ scale: 0.5, x: 120, y: 120 });
  });

  it("non-origin region, EXPLICIT padding=200 → mapped exactly", () => {
    // rect {100,200,1000,1000}, viewport 1400, padding 200 → availW=1000 → scale 1
    // cx=600 → x=700-600=100; cy=700 → y=700-700=0
    const cam = regionCamera(makeRegion(100, 200, 1000, 1000), { w: 1400, h: 1400 }, 200);
    expect(cam).toEqual({ scale: 1, x: 100, y: 0 });
  });

  it("tiny region → scale clamps to MAX_SCALE (4)", () => {
    const cam = regionCamera(makeRegion(0, 0, 100, 100), { w: 2000, h: 2000 }, 0);
    expect(cam).toEqual({ scale: 4, x: 800, y: 800 });
  });
});
