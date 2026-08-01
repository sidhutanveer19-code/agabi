import { describe, it, expect } from "vitest";

import type { Camera, Rect, Size, Vec2 } from "@/features/workspace/types";
import {
  MIN_SCALE,
  MAX_SCALE,
  clampScale,
  screenToWorld,
  worldToScreen,
  zoomAt,
  fitRect,
  visibleWorldRect,
} from "@/features/workspace/camera/cameraMath";

/**
 * Pure camera math — no React, no state, no I/O edge (nothing to mock; a fake here
 * would prove nothing, §H1.7). Every expected value below was computed by hand and
 * cross-checked against the real transforms; each came out an EXACT double, so we
 * assert the exact result (§H1.2 — name the outcome, assert THAT), never "returned
 * something". Branches covered:
 *   - clampScale: in-range · below-min · above-max · exact-min boundary · exact-max boundary
 *   - screenToWorld / worldToScreen: known camera + identity camera, and the inverse property
 *   - zoomAt: unclamped · clamped-high · clamped-low · k===1 (no-op) + the cursor-anchored invariant
 *   - fitRect: width-constrained vs height-constrained Math.min · clampScale→MAX · clampScale→MIN ·
 *     Math.max floor (viewport < 2·padding) vs value-wins · default padding vs explicit padding ·
 *     non-zero rect origin feeding cx/cy
 *   - visibleWorldRect: known camera + identity
 */

describe("scale range constants", () => {
  it("MIN_SCALE = 0.1, MAX_SCALE = 4", () => {
    expect(MIN_SCALE).toBe(0.1);
    expect(MAX_SCALE).toBe(4);
  });
});

describe("clampScale", () => {
  it("in-range value passes through unchanged", () => {
    expect(clampScale(0.5)).toBe(0.5);
    expect(clampScale(2)).toBe(2);
  });

  it("below MIN_SCALE clamps up to MIN_SCALE (0.1)", () => {
    expect(clampScale(0.05)).toBe(0.1);
    expect(clampScale(-3)).toBe(0.1);
  });

  it("above MAX_SCALE clamps down to MAX_SCALE (4)", () => {
    expect(clampScale(10)).toBe(4);
    expect(clampScale(4.0001)).toBe(4);
  });

  it("exact MIN boundary returns MIN (n < min is false, kept)", () => {
    expect(clampScale(0.1)).toBe(0.1);
  });

  it("exact MAX boundary returns MAX (n > max is false, kept)", () => {
    expect(clampScale(4)).toBe(4);
  });
});

describe("screenToWorld", () => {
  it("known camera: (screen - cam) / scale", () => {
    const cam: Camera = { x: 100, y: 50, scale: 2 };
    expect(screenToWorld(cam, { x: 300, y: 250 })).toEqual({ x: 100, y: 100 });
  });

  it("identity camera (x=0,y=0,scale=1) is a passthrough", () => {
    const cam: Camera = { x: 0, y: 0, scale: 1 };
    expect(screenToWorld(cam, { x: 42, y: -7 })).toEqual({ x: 42, y: -7 });
  });
});

describe("worldToScreen", () => {
  it("known camera: world * scale + cam", () => {
    const cam: Camera = { x: 100, y: 50, scale: 2 };
    expect(worldToScreen(cam, { x: 100, y: 100 })).toEqual({ x: 300, y: 250 });
  });

  it("identity camera is a passthrough", () => {
    const cam: Camera = { x: 0, y: 0, scale: 1 };
    expect(worldToScreen(cam, { x: 42, y: -7 })).toEqual({ x: 42, y: -7 });
  });

  it("is the exact inverse of screenToWorld (round-trip)", () => {
    const cam: Camera = { x: 100, y: 50, scale: 2 };
    const world: Vec2 = { x: 12.5, y: -3.5 };
    expect(screenToWorld(cam, worldToScreen(cam, world))).toEqual(world);
  });
});

describe("zoomAt", () => {
  const cam: Camera = { x: 100, y: 50, scale: 2 };
  const cursor: Vec2 = { x: 300, y: 250 };

  it("unclamped zoom-in (k = 1.5) recomputes translation exactly", () => {
    expect(zoomAt(cam, cursor, 3)).toEqual({ scale: 3, x: 0, y: -50 });
  });

  it("nextScale above MAX is clamped to 4 before computing k", () => {
    expect(zoomAt(cam, cursor, 100)).toEqual({ scale: 4, x: -100, y: -150 });
  });

  it("nextScale below MIN is clamped to 0.1 before computing k", () => {
    expect(zoomAt(cam, cursor, 0.01)).toEqual({ scale: 0.1, x: 290, y: 240 });
  });

  it("nextScale === current scale (k = 1) leaves the camera untouched", () => {
    expect(zoomAt(cam, cursor, 2)).toEqual({ scale: 2, x: 100, y: 50 });
  });

  it("INVARIANT: the world point under the cursor is unchanged after zooming", () => {
    const worldUnderCursorBefore = screenToWorld(cam, cursor);
    expect(worldUnderCursorBefore).toEqual({ x: 100, y: 100 });

    // holds for an ordinary zoom …
    const zoomed = zoomAt(cam, cursor, 3);
    expect(screenToWorld(zoomed, cursor)).toEqual(worldUnderCursorBefore);

    // … and even when nextScale is clamped
    const clampedLow = zoomAt(cam, cursor, 0.001);
    expect(screenToWorld(clampedLow, cursor)).toEqual(worldUnderCursorBefore);
  });
});

describe("fitRect", () => {
  it("height-constrained: Math.min picks availH/rect.h, centered with default padding", () => {
    const rect: Rect = { x: 0, y: 0, w: 1000, h: 1000 };
    const viewport: Size = { w: 960, h: 660 }; // availW=800→0.8, availH=500→0.5 ⇒ min 0.5
    expect(fitRect(rect, viewport)).toEqual({ scale: 0.5, x: 230, y: 80 });
  });

  it("width-constrained: Math.min picks availW/rect.w", () => {
    const rect: Rect = { x: 0, y: 0, w: 1000, h: 1000 };
    const viewport: Size = { w: 660, h: 960 }; // availW=500→0.5, availH=800→0.8 ⇒ min 0.5
    expect(fitRect(rect, viewport)).toEqual({ scale: 0.5, x: 80, y: 230 });
  });

  it("tiny rect in a large viewport clamps scale UP to MAX_SCALE (4)", () => {
    const rect: Rect = { x: 0, y: 0, w: 10, h: 10 };
    const viewport: Size = { w: 800, h: 800 }; // fitted scale would be 64 → clamped to 4
    expect(fitRect(rect, viewport)).toEqual({ scale: 4, x: 380, y: 380 });
  });

  it("huge rect in a small viewport clamps scale DOWN to MIN_SCALE (0.1)", () => {
    const rect: Rect = { x: 0, y: 0, w: 100000, h: 100000 };
    const viewport: Size = { w: 800, h: 800 }; // fitted scale would be 0.0064 → clamped to 0.1
    expect(fitRect(rect, viewport)).toEqual({ scale: 0.1, x: -4600, y: -4600 });
  });

  it("viewport smaller than 2·padding: Math.max floors avail dims to 1", () => {
    const rect: Rect = { x: 0, y: 0, w: 4, h: 2 };
    const viewport: Size = { w: 100, h: 100 }; // 100-160=-60 → max(1,-60)=1 for both axes
    // scale = clampScale(min(1/4, 1/2)) = 0.25
    expect(fitRect(rect, viewport)).toEqual({ scale: 0.25, x: 49.5, y: 49.75 });
  });

  it("explicit padding = 0 uses the full viewport (overrides the default 80)", () => {
    const rect: Rect = { x: 0, y: 0, w: 1000, h: 500 };
    const viewport: Size = { w: 1000, h: 1000 }; // availW=1000→1, availH=1000→2 ⇒ min 1
    expect(fitRect(rect, viewport, 0)).toEqual({ scale: 1, x: 0, y: 250 });
  });

  it("non-zero rect origin feeds cx/cy (center = rect.x + w/2, rect.y + h/2)", () => {
    const rect: Rect = { x: 100, y: 200, w: 1000, h: 1000 };
    const viewport: Size = { w: 960, h: 660 };
    // scale 0.5; cx=600, cy=700 ⇒ x=480-300=180, y=330-350=-20
    expect(fitRect(rect, viewport)).toEqual({ scale: 0.5, x: 180, y: -20 });
  });
});

describe("visibleWorldRect", () => {
  it("known camera: top-left via screenToWorld, size = viewport / scale", () => {
    const cam: Camera = { x: 100, y: 50, scale: 2 };
    const viewport: Size = { w: 800, h: 600 };
    expect(visibleWorldRect(cam, viewport)).toEqual({ x: -50, y: -25, w: 400, h: 300 });
  });

  it("identity camera: the visible rect equals the viewport at world origin", () => {
    const cam: Camera = { x: 0, y: 0, scale: 1 };
    const viewport: Size = { w: 1280, h: 800 };
    expect(visibleWorldRect(cam, viewport)).toEqual({ x: 0, y: 0, w: 1280, h: 800 });
  });
});
