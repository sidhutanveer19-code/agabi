import { describe, it, expect, beforeEach } from "vitest";

import type { Camera, Rect, Size, Vec2 } from "@/features/workspace/types";
import { DEFAULT_CAMERA } from "@/features/workspace/types/defaults";
import { zoomAt as mathZoomAt, fitRect } from "@/features/workspace/camera/cameraMath";
import { useCameraStore, INITIAL_CAMERA } from "@/features/workspace/stores/camera.store";

/**
 * camera.store — the persistent {x,y,scale} zustand store. It is a thin state
 * shell over the pure cameraMath transforms, so these tests run the REAL store
 * (live `getState()`, real `set`/`get`) and the REAL math — nothing mocked, since
 * a fake over pure functions would prove nothing (§H1.7). Every expected value was
 * computed by hand from the model  s = w*scale + cam  and cross-checked against the
 * imported cameraMath helpers; each is an EXACT double, so we assert the exact
 * camera (§H1.2), never "it changed".
 *
 * Branches / seams covered:
 *   - INITIAL_CAMERA is the single re-export of DEFAULT_CAMERA (same reference)
 *   - setCamera: replaces the whole camera with the exact argument
 *   - panBy: reads the CURRENT camera, adds dx→x and dy→y independently, preserves scale (…c)
 *   - zoomAt: delegates to cameraMath.zoomAt against the live camera (unclamped + clamped)
 *   - zoomByFactor: multiplies the CURRENT scale by factor, clamps, then anchors at the point
 *     (factor in range · factor over MAX · factor under MIN · factor === 1 no-op)
 *   - fitToRect: forwards to fitRect with default padding (arg omitted) vs an explicit padding
 *   - reset: restores exactly INITIAL_CAMERA regardless of prior camera
 */

// A deliberately non-default starting camera so tests prove actions read LIVE state,
// not the INITIAL constant, and prove scale is carried through where it must be.
const BASE: Camera = { x: 100, y: 50, scale: 2 };

beforeEach(() => {
  // Reset only the mutable slice; actions are created once at store construction.
  useCameraStore.setState({ camera: { x: 0, y: 0, scale: 1 } });
});

describe("INITIAL_CAMERA", () => {
  it("is the identity camera {x:0,y:0,scale:1}", () => {
    expect(INITIAL_CAMERA).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it("is the very same object as DEFAULT_CAMERA (single source of truth, no copy)", () => {
    expect(INITIAL_CAMERA).toBe(DEFAULT_CAMERA);
  });

  it("is the store's out-of-the-box camera on creation", () => {
    // The store initialises `camera: INITIAL_CAMERA`; beforeEach set a fresh identity,
    // so assert value equality against the constant here.
    expect(useCameraStore.getState().camera).toEqual(INITIAL_CAMERA);
  });
});

describe("setCamera", () => {
  it("replaces the camera with the exact argument (all three fields)", () => {
    const next: Camera = { x: -12.5, y: 33, scale: 1.75 };
    useCameraStore.getState().setCamera(next);
    expect(useCameraStore.getState().camera).toEqual({ x: -12.5, y: 33, scale: 1.75 });
  });

  it("overwrites, not merges — a later setCamera does not retain prior fields", () => {
    useCameraStore.getState().setCamera({ x: 1, y: 2, scale: 3 });
    useCameraStore.getState().setCamera({ x: 9, y: 8, scale: 4 });
    expect(useCameraStore.getState().camera).toEqual({ x: 9, y: 8, scale: 4 });
  });
});

describe("panBy", () => {
  it("adds dx to x and dy to y against the CURRENT camera, preserving scale", () => {
    useCameraStore.setState({ camera: { ...BASE } });
    useCameraStore.getState().panBy(5, -3);
    // x: 100+5=105, y: 50+(-3)=47, scale untouched (…c) = 2
    expect(useCameraStore.getState().camera).toEqual({ x: 105, y: 47, scale: 2 });
  });

  it("uses dx on the x-axis and dy on the y-axis (axes not swapped)", () => {
    useCameraStore.setState({ camera: { x: 0, y: 0, scale: 1 } });
    useCameraStore.getState().panBy(7, 40);
    expect(useCameraStore.getState().camera).toEqual({ x: 7, y: 40, scale: 1 });
  });

  it("accumulates across successive calls (reads live state each time)", () => {
    useCameraStore.setState({ camera: { x: 0, y: 0, scale: 2 } });
    useCameraStore.getState().panBy(10, 10);
    useCameraStore.getState().panBy(5, -4);
    // (0+10)+5 = 15 ; (0+10)+(-4) = 6 ; scale preserved
    expect(useCameraStore.getState().camera).toEqual({ x: 15, y: 6, scale: 2 });
  });

  it("zero delta is a no-op on position and keeps scale", () => {
    useCameraStore.setState({ camera: { ...BASE } });
    useCameraStore.getState().panBy(0, 0);
    expect(useCameraStore.getState().camera).toEqual({ x: 100, y: 50, scale: 2 });
  });
});

describe("zoomAt", () => {
  const cursor: Vec2 = { x: 300, y: 250 };

  it("delegates to cameraMath.zoomAt against the live camera (exact translation)", () => {
    useCameraStore.setState({ camera: { ...BASE } });
    useCameraStore.getState().zoomAt(cursor, 3);
    // k = 3/2 = 1.5 → x = 300-(300-100)*1.5 = 0 ; y = 250-(250-50)*1.5 = -50
    expect(useCameraStore.getState().camera).toEqual({ scale: 3, x: 0, y: -50 });
  });

  it("matches the pure cameraMath.zoomAt for the same inputs", () => {
    useCameraStore.setState({ camera: { ...BASE } });
    useCameraStore.getState().zoomAt(cursor, 3);
    expect(useCameraStore.getState().camera).toEqual(mathZoomAt(BASE, cursor, 3));
  });

  it("clamps a too-large nextScale to MAX (4) via the shared math", () => {
    useCameraStore.setState({ camera: { ...BASE } });
    useCameraStore.getState().zoomAt(cursor, 100);
    // scale clamped to 4, k=2 → x=300-200*2=-100, y=250-200*2=-150
    expect(useCameraStore.getState().camera).toEqual({ scale: 4, x: -100, y: -150 });
  });

  it("keeps the world point under the cursor fixed (anchored zoom invariant)", () => {
    useCameraStore.setState({ camera: { ...BASE } });
    const worldBefore = {
      x: (cursor.x - BASE.x) / BASE.scale,
      y: (cursor.y - BASE.y) / BASE.scale,
    };
    useCameraStore.getState().zoomAt(cursor, 3.5);
    const cam = useCameraStore.getState().camera;
    const worldAfter = { x: (cursor.x - cam.x) / cam.scale, y: (cursor.y - cam.y) / cam.scale };
    expect(worldAfter).toEqual(worldBefore);
  });
});

describe("zoomByFactor", () => {
  const cursor: Vec2 = { x: 300, y: 250 };

  it("multiplies the current scale by factor, then anchors at the point", () => {
    useCameraStore.setState({ camera: { ...BASE } }); // scale 2
    useCameraStore.getState().zoomByFactor(cursor, 1.5);
    // nextScale = clampScale(2*1.5)=3 → same as zoomAt(...,3): {scale:3,x:0,y:-50}
    expect(useCameraStore.getState().camera).toEqual({ scale: 3, x: 0, y: -50 });
  });

  it("uses multiplication of the CURRENT scale (not addition/division)", () => {
    useCameraStore.setState({ camera: { x: 0, y: 0, scale: 1.5 } });
    useCameraStore.getState().zoomByFactor(cursor, 2);
    // 1.5*2 = 3 (add would give 3.5, divide 0.75) — assert the scale precisely
    expect(useCameraStore.getState().camera.scale).toBe(3);
  });

  it("clamps up: a factor pushing scale past MAX lands on 4", () => {
    useCameraStore.setState({ camera: { ...BASE } }); // scale 2
    useCameraStore.getState().zoomByFactor(cursor, 10);
    // clampScale(2*10)=4 → {scale:4,x:-100,y:-150}
    expect(useCameraStore.getState().camera).toEqual({ scale: 4, x: -100, y: -150 });
  });

  it("clamps down: a factor pushing scale below MIN lands on 0.1", () => {
    useCameraStore.setState({ camera: { ...BASE } }); // scale 2
    useCameraStore.getState().zoomByFactor(cursor, 0.001);
    // clampScale(2*0.001=0.002)=0.1 → k=0.05 → x=300-200*0.05=290, y=250-200*0.05=240
    expect(useCameraStore.getState().camera).toEqual({ scale: 0.1, x: 290, y: 240 });
  });

  it("factor 1 keeps scale but recentres identically (k=1 no-op)", () => {
    useCameraStore.setState({ camera: { ...BASE } });
    useCameraStore.getState().zoomByFactor(cursor, 1);
    expect(useCameraStore.getState().camera).toEqual({ scale: 2, x: 100, y: 50 });
  });
});

describe("fitToRect", () => {
  it("with padding omitted, forwards to fitRect's DEFAULT padding (80)", () => {
    const rect: Rect = { x: 0, y: 0, w: 1000, h: 1000 };
    const viewport: Size = { w: 960, h: 660 };
    useCameraStore.getState().fitToRect(rect, viewport);
    // availW=800→0.8, availH=500→0.5 ⇒ scale 0.5; center (500,500) ⇒ x=480-250=230, y=330-250=80
    expect(useCameraStore.getState().camera).toEqual({ scale: 0.5, x: 230, y: 80 });
    expect(useCameraStore.getState().camera).toEqual(fitRect(rect, viewport));
  });

  it("with an explicit padding, that padding overrides the default", () => {
    const rect: Rect = { x: 0, y: 0, w: 1000, h: 500 };
    const viewport: Size = { w: 1000, h: 1000 };
    useCameraStore.getState().fitToRect(rect, viewport, 0);
    // padding 0: availW=1000→1, availH=1000→2 ⇒ scale 1; center (500,250) ⇒ x=500-500=0, y=500-250=250
    expect(useCameraStore.getState().camera).toEqual({ scale: 1, x: 0, y: 250 });
    expect(useCameraStore.getState().camera).toEqual(fitRect(rect, viewport, 0));
  });

  it("explicit padding differs from the default for the same rect/viewport", () => {
    const rect: Rect = { x: 0, y: 0, w: 1000, h: 1000 };
    const viewport: Size = { w: 960, h: 660 };
    useCameraStore.getState().fitToRect(rect, viewport, 0);
    const withZero = useCameraStore.getState().camera;
    useCameraStore.getState().fitToRect(rect, viewport); // default 80
    const withDefault = useCameraStore.getState().camera;
    expect(withZero).not.toEqual(withDefault);
  });
});

describe("reset", () => {
  it("restores the identity camera after arbitrary mutation", () => {
    useCameraStore.setState({ camera: { x: 999, y: -42, scale: 3.3 } });
    useCameraStore.getState().reset();
    expect(useCameraStore.getState().camera).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it("restores exactly the INITIAL_CAMERA reference (single source of truth)", () => {
    useCameraStore.getState().panBy(123, 456);
    useCameraStore.getState().reset();
    expect(useCameraStore.getState().camera).toBe(INITIAL_CAMERA);
  });

  it("resets to identity even after a zoom (position AND scale restored)", () => {
    useCameraStore.setState({ camera: { ...BASE } });
    useCameraStore.getState().zoomByFactor({ x: 300, y: 250 }, 1.5); // scale→3, translated
    useCameraStore.getState().reset();
    expect(useCameraStore.getState().camera).toEqual({ x: 0, y: 0, scale: 1 });
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * Extended edge cases (appended). Same discipline: REAL store + REAL math,
 * every expected value hand-computed from  s = w*scale + cam  and clampScale
 * (MIN 0.1, MAX 4), asserted as an exact camera.
 * ───────────────────────────────────────────────────────────────────────── */

describe("setCamera (reference & immutability)", () => {
  it("stores the exact object passed in (no defensive copy)", () => {
    const next: Camera = { x: 4, y: 5, scale: 1.25 };
    useCameraStore.getState().setCamera(next);
    // `set({ camera })` keeps the same reference — proves it is not cloned.
    expect(useCameraStore.getState().camera).toBe(next);
  });
});

describe("panBy (fractions, negatives, immutability)", () => {
  it("applies fractional deltas exactly and preserves a fractional scale", () => {
    useCameraStore.setState({ camera: { x: 0, y: 0, scale: 1.5 } });
    useCameraStore.getState().panBy(2.5, -1.25);
    expect(useCameraStore.getState().camera).toEqual({ x: 2.5, y: -1.25, scale: 1.5 });
  });

  it("moves negatively on both axes when both deltas are negative", () => {
    useCameraStore.setState({ camera: { ...BASE } });
    useCameraStore.getState().panBy(-30, -60);
    // x: 100-30=70, y: 50-60=-10, scale carried
    expect(useCameraStore.getState().camera).toEqual({ x: 70, y: -10, scale: 2 });
  });

  it("produces a NEW camera object without mutating the previous one (…c spread)", () => {
    const prev: Camera = { x: 10, y: 20, scale: 2 };
    useCameraStore.setState({ camera: prev });
    useCameraStore.getState().panBy(1, 1);
    const now = useCameraStore.getState().camera;
    expect(now).not.toBe(prev); // fresh object
    expect(prev).toEqual({ x: 10, y: 20, scale: 2 }); // original untouched
    expect(now).toEqual({ x: 11, y: 21, scale: 2 });
  });
});

describe("zoomAt (low clamp, k=1, cursor on origin)", () => {
  it("clamps a below-MIN nextScale up to 0.1 and anchors at the cursor", () => {
    useCameraStore.setState({ camera: { ...BASE } }); // scale 2
    useCameraStore.getState().zoomAt({ x: 300, y: 250 }, 0.05);
    // clamp 0.05→0.1, k=0.1/2=0.05 → x=300-200*0.05=290, y=250-200*0.05=240
    expect(useCameraStore.getState().camera).toEqual({ scale: 0.1, x: 290, y: 240 });
  });

  it("nextScale equal to the current scale leaves translation unchanged (k=1)", () => {
    useCameraStore.setState({ camera: { ...BASE } }); // scale 2
    useCameraStore.getState().zoomAt({ x: 300, y: 250 }, 2);
    // k=1 → x=300-(300-100)=100, y=250-(250-50)=50 (identity translation)
    expect(useCameraStore.getState().camera).toEqual({ scale: 2, x: 100, y: 50 });
  });

  it("with the cursor exactly on the camera origin, translation stays put", () => {
    useCameraStore.setState({ camera: { ...BASE } }); // origin (100,50)
    useCameraStore.getState().zoomAt({ x: 100, y: 50 }, 3);
    // (screen - cam) = 0 on both axes → x=100, y=50, only scale changes
    expect(useCameraStore.getState().camera).toEqual({ scale: 3, x: 100, y: 50 });
  });
});

describe("zoomByFactor (anchor at origin, sub-1 factor within range)", () => {
  it("anchors at cursor (0,0): pulls the origin toward the corner", () => {
    useCameraStore.setState({ camera: { ...BASE } }); // scale 2
    useCameraStore.getState().zoomByFactor({ x: 0, y: 0 }, 1.5);
    // nextScale=3, k=1.5 → x=0-(0-100)*1.5=150, y=0-(0-50)*1.5=75
    expect(useCameraStore.getState().camera).toEqual({ scale: 3, x: 150, y: 75 });
  });

  it("a sub-1 factor that stays in range shrinks scale by exactly that factor", () => {
    useCameraStore.setState({ camera: { x: 0, y: 0, scale: 2 } });
    useCameraStore.getState().zoomByFactor({ x: 300, y: 250 }, 0.5);
    // 2*0.5=1 (in range) → k=0.5 → x=300-300*0.5=150, y=250-250*0.5=125
    expect(useCameraStore.getState().camera).toEqual({ scale: 1, x: 150, y: 125 });
  });
});

describe("fitToRect (non-zero rect origin, height-bound vs width-bound)", () => {
  it("centres a rect whose origin is non-zero (uses rect.x/rect.y for the centre)", () => {
    const rect: Rect = { x: 100, y: 200, w: 1000, h: 1000 };
    const viewport: Size = { w: 960, h: 660 };
    useCameraStore.getState().fitToRect(rect, viewport); // default padding 80
    // availW=800→0.8, availH=500→0.5 ⇒ scale 0.5 (height-bound)
    // cx=100+500=600, cy=200+500=700 ⇒ x=480-300=180, y=330-350=-20
    expect(useCameraStore.getState().camera).toEqual({ scale: 0.5, x: 180, y: -20 });
    expect(useCameraStore.getState().camera).toEqual(fitRect(rect, viewport));
  });

  it("forwarding an explicit `undefined` padding is identical to omitting it", () => {
    const rect: Rect = { x: 0, y: 0, w: 1000, h: 1000 };
    const viewport: Size = { w: 960, h: 660 };
    useCameraStore.getState().fitToRect(rect, viewport, undefined);
    const withUndef = useCameraStore.getState().camera;
    useCameraStore.getState().fitToRect(rect, viewport);
    const withOmitted = useCameraStore.getState().camera;
    // The store passes padding straight through; undefined lets fitRect's default (80) apply.
    expect(withUndef).toEqual(withOmitted);
    expect(withUndef).toEqual({ scale: 0.5, x: 230, y: 80 });
  });
});
