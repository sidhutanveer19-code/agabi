import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * animateCamera — a cubic-ease-out camera tween driven by requestAnimationFrame.
 *
 * The ONLY I/O edge is the browser scheduler (`requestAnimationFrame` /
 * `cancelAnimationFrame`), which does not exist in the node test env — so it is
 * stubbed here (and nothing else) with a deterministic driver: rAF captures the
 * callback + returns a spec-shaped positive handle, and `frame(ts)` fires the
 * pending callback at a timestamp WE choose. Every assertion checks the EXACT
 * camera object produced by the real easing math (easeOut(t) = 1 - (1-t)^3),
 * never "it called back with something".
 *
 * Branches under test:
 *   - early jump: `reducedMotion || ms <= 0` → onFrame(to) once, no rAF, noop cancel
 *       · reducedMotion=true (left operand true)
 *       · ms<=0 with reducedMotion=false (right operand true): ms=0 boundary AND ms<0
 *       · both false → real animation path
 *   - default params: `opts = {}`, `ms = 420`, `reducedMotion = false`
 *   - step(): `if (start < 0)` first-tick seed (true) vs later ticks (false)
 *   - step(): `Math.min(1, …)` clamp when elapsed overshoots ms
 *   - step(): `if (t < 1)` reschedule (true) vs final frame stop (false)
 *   - step(): `if (cancelled) return` guard (true after cancel; false during run)
 *   - cancel(): `if (raf)` truthy → cancelAnimationFrame called with the live handle
 */

import { animateCamera } from "@/features/workspace/camera/animateTo";
import type { Camera } from "@/features/workspace/types";

type FrameCb = (ts: number) => void;

// Deterministic rAF driver (the single faked I/O edge).
let scheduled: Array<{ id: number; cb: FrameCb }>;
let nextId: number;
let cancelledIds: number[];

/** Fire the oldest pending rAF callback at timestamp `ts`. */
function frame(ts: number): void {
  const next = scheduled.shift();
  if (!next) throw new Error("no rAF callback is scheduled");
  next.cb(ts);
}

/** The most-recently scheduled callback WITHOUT consuming it. */
function peekLast(): FrameCb {
  const last = scheduled.at(-1);
  if (!last) throw new Error("no rAF callback is scheduled");
  return last.cb;
}

beforeEach(() => {
  scheduled = [];
  nextId = 0;
  cancelledIds = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameCb): number => {
    nextId += 1; // real rAF handles are always > 0
    scheduled.push({ id: nextId, cb });
    return nextId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number): void => {
    cancelledIds.push(id);
    scheduled = scheduled.filter((s) => s.id !== id);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const FROM: Camera = { x: 0, y: 0, scale: 1 };
const TO: Camera = { x: 100, y: 200, scale: 3 };

describe("animateCamera — early jump (reducedMotion || ms <= 0)", () => {
  it("reducedMotion=true → onFrame called ONCE with the exact `to` object; no rAF; cancel is a noop", () => {
    const frames: Camera[] = [];
    const h = animateCamera(FROM, TO, (c) => frames.push(c), { reducedMotion: true });

    expect(frames).toHaveLength(1);
    expect(frames[0]).toBe(TO); // passes `to` by reference, not a computed copy
    expect(scheduled).toHaveLength(0); // never scheduled a frame
    expect(cancelledIds).toEqual([]);

    h.cancel(); // noop handle: no throw, no cancelAnimationFrame call
    expect(cancelledIds).toEqual([]);
  });

  it("ms=0 boundary (reducedMotion=false) → jumps straight to `to`, no rAF", () => {
    const frames: Camera[] = [];
    animateCamera(FROM, TO, (c) => frames.push(c), { ms: 0 });

    expect(frames).toHaveLength(1);
    expect(frames[0]).toBe(TO);
    expect(scheduled).toHaveLength(0);
  });

  it("ms<0 (negative) → also jumps straight to `to`", () => {
    const frames: Camera[] = [];
    animateCamera(FROM, TO, (c) => frames.push(c), { ms: -10 });

    expect(frames).toEqual([{ x: 100, y: 200, scale: 3 }]);
    expect(scheduled).toHaveLength(0);
  });
});

describe("animateCamera — default parameters", () => {
  it("no opts arg at all (opts = {}, ms = 420, reducedMotion = false) → animates, does NOT jump", () => {
    const frames: Camera[] = [];
    const h = animateCamera(FROM, TO, (c) => frames.push(c));

    // default reducedMotion=false and default ms=420 (>0) → animation path taken
    expect(frames).toHaveLength(0); // nothing painted synchronously
    expect(scheduled).toHaveLength(1); // one frame scheduled

    // prove the default ms of 420 is in effect: half of 420 = 210ms → t=0.5 → e=0.875
    frame(1000); // seed start
    expect(frames[0]).toEqual({ x: 0, y: 0, scale: 1 });
    frame(1210); // +210ms of 420 → t = 0.5
    expect(frames[1]).toEqual({ x: 87.5, y: 175, scale: 2.75 });

    h.cancel();
  });
});

describe("animateCamera — the real tween (easeOut math, exact values)", () => {
  it("seeds start on the first tick, eases mid-flight, lands exactly on `to`, then stops", () => {
    const frames: Camera[] = [];
    animateCamera(FROM, TO, (c) => frames.push(c), { ms: 420 });

    expect(scheduled).toHaveLength(1);

    // First tick: start < 0 → start = ts; t = 0 → easeOut(0) = 0 → exactly FROM.
    frame(1000);
    expect(frames[0]).toEqual({ x: 0, y: 0, scale: 1 });
    expect(scheduled).toHaveLength(1); // t<1 → rescheduled

    // Second tick: elapsed 210 of 420 → t = 0.5 → easeOut(0.5) = 1 - 0.5^3 = 0.875.
    // x: 0 + 100*0.875 = 87.5 · y: 0 + 200*0.875 = 175 · scale: 1 + 2*0.875 = 2.75
    frame(1210);
    expect(frames[1]).toEqual({ x: 87.5, y: 175, scale: 2.75 });
    expect(scheduled).toHaveLength(1);

    // Final tick: elapsed 420 of 420 → t = 1 → easeOut(1) = 1 → exactly TO. t<1 false → no reschedule.
    frame(1420);
    expect(frames[2]).toEqual({ x: 100, y: 200, scale: 3 });
    expect(frames[2]).not.toBe(TO); // it's the computed object, not the `to` reference
    expect(scheduled).toHaveLength(0); // animation finished, nothing rescheduled

    expect(frames).toHaveLength(3);
  });

  it("Math.min clamp: an overshooting timestamp pins t at 1 (never past `to`) and stops", () => {
    const frames: Camera[] = [];
    animateCamera(FROM, TO, (c) => frames.push(c), { ms: 100 });

    frame(0); // seed start = 0 → FROM
    expect(frames[0]).toEqual({ x: 0, y: 0, scale: 1 });

    // elapsed 9999 of 100 → raw ratio 99.99, clamped by Math.min(1, …) to 1 → exactly TO.
    frame(9999);
    expect(frames[1]).toEqual({ x: 100, y: 200, scale: 3 });
    expect(scheduled).toHaveLength(0); // t===1 → the `if (t < 1)` reschedule is skipped
  });

  it("negative from→to deltas ease correctly (direction-agnostic interpolation)", () => {
    const from: Camera = { x: 100, y: 50, scale: 4 };
    const to: Camera = { x: 0, y: -50, scale: 2 };
    const frames: Camera[] = [];
    animateCamera(from, to, (c) => frames.push(c), { ms: 200 });

    frame(500); // seed
    expect(frames[0]).toEqual({ x: 100, y: 50, scale: 4 });

    // +100 of 200 → t = 0.5 → e = 0.875
    // x: 100 + (0-100)*0.875 = 12.5 · y: 50 + (-50-50)*0.875 = -37.5 · scale: 4 + (2-4)*0.875 = 2.25
    frame(600);
    expect(frames[1]).toEqual({ x: 12.5, y: -37.5, scale: 2.25 });
  });
});

describe("animateCamera — cancellation", () => {
  it("cancel() sets the guard AND cancelAnimationFrame(handle); a late tick is ignored", () => {
    const frames: Camera[] = [];
    const h = animateCamera(FROM, TO, (c) => frames.push(c), { ms: 420 });

    // handle id 1 scheduled; run one real frame → it reschedules (id 2).
    frame(1000);
    expect(frames).toHaveLength(1);
    const pendingStep = peekLast(); // capture the still-scheduled step (id 2)
    const liveHandle = scheduled.at(-1)!.id;

    h.cancel();
    // `if (raf)` was truthy → cancelAnimationFrame called with the live handle.
    expect(cancelledIds).toEqual([liveHandle]);
    expect(scheduled).toHaveLength(0); // driver dropped the cancelled callback

    // If the browser still fired the captured callback, the `if (cancelled) return` guard
    // must swallow it — no extra frame is produced.
    pendingStep(2000);
    expect(frames).toHaveLength(1);
  });

  it("cancel() after the animation already finished still calls cancelAnimationFrame on the last handle (raf truthy)", () => {
    const frames: Camera[] = [];
    const h = animateCamera(FROM, TO, (c) => frames.push(c), { ms: 100 });

    frame(0); // seed
    frame(100); // t=1 → lands on TO, no reschedule
    expect(frames[1]).toEqual({ x: 100, y: 200, scale: 3 });
    expect(scheduled).toHaveLength(0);

    // raf still holds the LAST (positive) handle → `if (raf)` truthy → cancel is called.
    // Trace: initial rAF=1, first tick reschedules to rAF=2, final tick does not reschedule → raf=2.
    h.cancel();
    expect(cancelledIds).toEqual([2]);
  });
});
