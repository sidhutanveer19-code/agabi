import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, type Mock } from "vitest";

/**
 * usePanZoom.ts — the pointer/wheel/trackpad/touch pan+zoom controller bound to the
 * canvas container. It is a `useEffect` hook wrapping a browser-only closure, so the
 * ONLY things faked are the framework/I/O edges (§H1.7): React's `useEffect` is
 * replaced with a synchronous runner so the effect body executes for real, and the
 * three browser globals it reaches for (`requestAnimationFrame`, `cancelAnimationFrame`,
 * `HTMLElement`) are shimmed with controllable stand-ins. Everything ABOVE that edge —
 * the rAF coalescing, the pan/zoom accumulation math, the event routing, the
 * background hit-test, the pointer-capture lifecycle, the pinch state machine — runs
 * for REAL against the REAL camera + ui zustand stores and the REAL `cameraMath`
 * transforms. Every expected value below is a hand-computed exact/near-exact double,
 * asserted as the outcome (§H1.2), never "it ran".
 *
 * Branches covered:
 *   usePanZoom:        ref.current null (early return, no cleanup) · present (full bind)
 *   flush:             pan-only · zoom-only · both · neither (both `if`s false) · clampScale applied
 *   schedule:          first queue schedules · second queue in-frame deduped (`!rafId` false)
 *   queuePan:          accumulation across two queues in one frame
 *   queueZoom:         first factor (`zoom?.factor ?? 1`) · multiplied second factor · point = latest
 *   onWheel:           preventDefault always · ctrlKey→zoom · metaKey→zoom · plain→pan(neg deltas)
 *   localPoint:        rect.left/top offset subtracted (non-zero origin)
 *   isBackground:      not-HTMLElement → false · HTMLElement wrong dataset → false · match → true
 *   onPointerDown:     mouse+non-zero button return · button 0 start · non-mouse+non-zero passes ·
 *                      non-background return · capture + setInteraction("panning") + clearSelection
 *   onPointerMove:     not-panning return · panning queues delta + advances last{X,Y}
 *   endPan:            not-panning return · normal release → idle · releasePointerCapture throws (catch)
 *   touchDist/touchMid:hypot of the two points · localePoint of the midpoint
 *   onTouchStart:      2 touches sets pinchDist · !=2 leaves it 0
 *   onTouchMove:       !=2 early return (no preventDefault) · pinchDist>0 zoom · pinchDist 0 skip-zoom
 *   onTouchEnd:        <2 resets pinchDist · >=2 keeps it
 *   cleanup:           removes every listener · cancels a pending frame (rafId set) · no-cancel when 0
 */

// ---- React edge: run the effect body synchronously and capture its cleanup (§H1.7) ----------------
const hoisted = vi.hoisted(() => ({ lastCleanup: undefined as undefined | (() => void) }));
vi.mock("react", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("react");
  return {
    ...actual,
    useEffect: (fn: () => void | (() => void)) => {
      hoisted.lastCleanup = fn() as undefined | (() => void);
    },
  };
});

import { usePanZoom } from "./usePanZoom";
import { useCameraStore } from "@/features/workspace/stores/camera.store";
import { useUiStore } from "@/features/workspace/stores/ui.store";

// ---- Browser-global shims (the I/O edge — nothing above them is faked) -----------------------------
const g = globalThis as unknown as {
  requestAnimationFrame?: unknown;
  cancelAnimationFrame?: unknown;
  HTMLElement?: unknown;
};
const saved = {
  raf: g.requestAnimationFrame,
  caf: g.cancelAnimationFrame,
  html: g.HTMLElement,
};

class FakeHTMLElement {} // instanceof target for isBackground

let rafSeq = 0;
let rafCallbacks: Map<number, FrameRequestCallback>;
const rafSpy = vi.fn((cb: FrameRequestCallback): number => {
  const id = ++rafSeq;
  rafCallbacks.set(id, cb);
  return id;
});
const cancelSpy = vi.fn((id: number) => {
  rafCallbacks.delete(id);
});

/** Drain every pending frame callback (mirrors the browser firing rAF). */
function runFrame() {
  const pending = [...rafCallbacks.values()];
  rafCallbacks = new Map();
  for (const cb of pending) cb(0);
}

beforeAll(() => {
  g.requestAnimationFrame = rafSpy;
  g.cancelAnimationFrame = cancelSpy;
  g.HTMLElement = FakeHTMLElement;
});
afterAll(() => {
  g.requestAnimationFrame = saved.raf;
  g.cancelAnimationFrame = saved.caf;
  g.HTMLElement = saved.html;
});

// ---- Fake canvas element: captures listeners, lets us fire synthetic DOM events --------------------
interface FakeEl {
  __listeners: Map<string, Set<(e: unknown) => void>>;
  getBoundingClientRect: () => { left: number; top: number };
  addEventListener: (type: string, fn: (e: unknown) => void) => void;
  removeEventListener: (type: string, fn: (e: unknown) => void) => void;
  setPointerCapture: ReturnType<typeof vi.fn>;
  releasePointerCapture: ReturnType<typeof vi.fn>;
  fire: (type: string, event: unknown) => void;
  listenerCount: (type: string) => number;
}

function makeEl(rect: { left: number; top: number } = { left: 0, top: 0 }): FakeEl {
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  return {
    __listeners: listeners,
    getBoundingClientRect: () => ({ left: rect.left, top: rect.top }),
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    fire(type, event) {
      listeners.get(type)?.forEach((fn) => fn(event));
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

/** A target that passes `instanceof HTMLElement` with the given dataset. */
function domTarget(dataset: Record<string, string>): unknown {
  return Object.assign(Object.create(FakeHTMLElement.prototype), { dataset });
}
const bg = () => domTarget({ wsBg: "1" });

function mount(el: FakeEl) {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- deliberate: React is mocked; the hook is invoked as a plain function inside this test harness
  usePanZoom({ current: el as unknown as HTMLElement });
  return hoisted.lastCleanup!;
}

// ---- Store spies: wrap the REAL zustand actions so we get call-args AND real state mutation --------
const REAL = useCameraStore.getState();
const realPanBy = REAL.panBy;
const realZoomAt = REAL.zoomAt;
let panBySpy: Mock<(dx: number, dy: number) => void>;
let zoomAtSpy: Mock<(screenPoint: { x: number; y: number }, nextScale: number) => void>;

function cam() {
  return useCameraStore.getState().camera;
}

beforeEach(() => {
  rafSeq = 0;
  rafCallbacks = new Map();
  rafSpy.mockClear();
  cancelSpy.mockClear();
  hoisted.lastCleanup = undefined;

  panBySpy = vi.fn((dx: number, dy: number) => realPanBy(dx, dy));
  zoomAtSpy = vi.fn((p: { x: number; y: number }, s: number) => realZoomAt(p, s));
  useCameraStore.setState({ camera: { x: 0, y: 0, scale: 1 }, panBy: panBySpy, zoomAt: zoomAtSpy });
  useUiStore.setState({ selectedIds: [], hoverId: null, focusId: null, interaction: "idle" });
});

// ---- Synthetic event builders ---------------------------------------------------------------------
function wheel(o: Partial<{ ctrlKey: boolean; metaKey: boolean; clientX: number; clientY: number; deltaX: number; deltaY: number }>) {
  return {
    preventDefault: vi.fn(),
    ctrlKey: false,
    metaKey: false,
    clientX: 0,
    clientY: 0,
    deltaX: 0,
    deltaY: 0,
    ...o,
  };
}
function pointer(o: Partial<{ button: number; pointerType: string; target: unknown; clientX: number; clientY: number; pointerId: number }>) {
  return { button: 0, pointerType: "mouse", target: bg(), clientX: 0, clientY: 0, pointerId: 7, ...o };
}
function touches(pts: Array<{ clientX: number; clientY: number }>) {
  return { preventDefault: vi.fn(), touches: pts };
}

// ===================================================================================================

describe("usePanZoom — mount / unmount", () => {
  it("ref.current === null → effect returns early, no cleanup, no listeners bound", () => {
    usePanZoom({ current: null });
    expect(hoisted.lastCleanup).toBeUndefined();
  });

  it("ref present → binds all eight listeners with the documented event names", () => {
    const el = makeEl();
    mount(el);
    for (const t of ["wheel", "pointerdown", "pointermove", "pointerup", "pointercancel", "touchstart", "touchmove", "touchend"]) {
      expect(el.listenerCount(t)).toBe(1);
    }
  });

  it("cleanup removes every listener (a fired wheel afterwards is inert)", () => {
    const el = makeEl();
    const cleanup = mount(el);
    cleanup();
    for (const t of ["wheel", "pointerdown", "pointermove", "pointerup", "pointercancel", "touchstart", "touchmove", "touchend"]) {
      expect(el.listenerCount(t)).toBe(0);
    }
    el.fire("wheel", wheel({ deltaX: 9, deltaY: 9 }));
    runFrame();
    expect(cam()).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it("cleanup cancels a still-pending frame (rafId truthy branch)", () => {
    const el = makeEl();
    const cleanup = mount(el);
    el.fire("wheel", wheel({ deltaX: 5, deltaY: 5 })); // schedules a frame
    expect(rafCallbacks.size).toBe(1);
    cleanup();
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(rafCallbacks.size).toBe(0);
  });

  it("cleanup with no pending frame does NOT cancel (rafId === 0 branch)", () => {
    const el = makeEl();
    const cleanup = mount(el);
    cleanup();
    expect(cancelSpy).not.toHaveBeenCalled();
  });
});

describe("onWheel — pan vs zoom routing", () => {
  it("always calls preventDefault (plain and modifier paths)", () => {
    const el = makeEl();
    mount(el);
    const plain = wheel({ deltaX: 1 });
    el.fire("wheel", plain);
    expect(plain.preventDefault).toHaveBeenCalledTimes(1);
    const zoomEv = wheel({ ctrlKey: true, deltaY: -10 });
    el.fire("wheel", zoomEv);
    expect(zoomEv.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("plain wheel pans by the NEGATED deltas, applied once on the next frame", () => {
    const el = makeEl();
    mount(el);
    el.fire("wheel", wheel({ deltaX: 30, deltaY: 40 }));
    expect(panBySpy).not.toHaveBeenCalled(); // coalesced, not applied yet
    runFrame();
    expect(panBySpy).toHaveBeenCalledTimes(1);
    expect(panBySpy).toHaveBeenCalledWith(-30, -40);
    expect(cam()).toEqual({ x: -30, y: -40, scale: 1 });
  });

  it("ctrl+wheel zooms anchored at the cursor (exact integer clamp to MAX_SCALE)", () => {
    const el = makeEl();
    mount(el);
    // deltaY -1000 → factor e^1.5 ≈ 4.4817 → clampScale → exactly 4
    el.fire("wheel", wheel({ ctrlKey: true, deltaY: -1000, clientX: 100, clientY: 100 }));
    runFrame();
    expect(zoomAtSpy).toHaveBeenCalledTimes(1);
    expect(zoomAtSpy.mock.calls[0][0]).toEqual({ x: 100, y: 100 });
    expect(zoomAtSpy.mock.calls[0][1]).toBe(4); // clampScale(1 * 4.4817) === 4
    expect(cam()).toEqual({ x: -300, y: -300, scale: 4 }); // k=4: 100 - 100*4
  });

  it("meta+wheel also zooms (⌘ trackpad pinch path)", () => {
    const el = makeEl();
    mount(el);
    el.fire("wheel", wheel({ metaKey: true, deltaY: -100, clientX: 200, clientY: 100 }));
    runFrame();
    // factor = e^(0.15) = 1.161834242728283 ; k = factor ; anchored at (200,100)
    const c = cam();
    expect(c.scale).toBeCloseTo(1.161834242728283, 10);
    expect(c.x).toBeCloseTo(-32.3668485456566, 8);
    expect(c.y).toBeCloseTo(-16.1834242728283, 8);
  });

  it("localPoint subtracts the element's rect origin before anchoring the zoom", () => {
    const el = makeEl({ left: 50, top: 20 });
    mount(el);
    el.fire("wheel", wheel({ ctrlKey: true, deltaY: -100, clientX: 200, clientY: 120 }));
    runFrame();
    // localPoint = (200-50, 120-20) = (150,100)
    expect(zoomAtSpy.mock.calls[0][0]).toEqual({ x: 150, y: 100 });
    const k = Math.exp(0.15);
    expect(cam().x).toBeCloseTo(150 - 150 * k, 8);
    expect(cam().y).toBeCloseTo(100 - 100 * k, 8);
  });
});

describe("rAF coalescing (schedule / queuePan / queueZoom / flush)", () => {
  it("two pans in one frame schedule ONE rAF and sum (schedule `!rafId` false path)", () => {
    const el = makeEl();
    mount(el);
    el.fire("wheel", wheel({ deltaX: 10, deltaY: 20 }));
    el.fire("wheel", wheel({ deltaX: 5, deltaY: 5 }));
    expect(rafSpy).toHaveBeenCalledTimes(1);
    expect(rafCallbacks.size).toBe(1);
    runFrame();
    expect(panBySpy).toHaveBeenCalledTimes(1);
    expect(panBySpy).toHaveBeenCalledWith(-15, -25);
    expect(cam()).toEqual({ x: -15, y: -25, scale: 1 });
  });

  it("a fresh queue after a flush schedules a NEW rAF (`!rafId` true again)", () => {
    const el = makeEl();
    mount(el);
    el.fire("wheel", wheel({ deltaX: 1, deltaY: 0 }));
    runFrame(); // rafId reset to 0
    expect(rafSpy).toHaveBeenCalledTimes(1);
    el.fire("wheel", wheel({ deltaX: 2, deltaY: 0 }));
    expect(rafSpy).toHaveBeenCalledTimes(2);
    runFrame();
    expect(cam()).toEqual({ x: -3, y: 0, scale: 1 });
  });

  it("two ctrl+wheels in one frame MULTIPLY their factors and use the LAST point", () => {
    const el = makeEl();
    mount(el);
    // f1 = e^0.06, f2 = e^0.045 ; combined e^0.105 ≈ 1.11071, in range
    el.fire("wheel", wheel({ ctrlKey: true, deltaY: -40, clientX: 10, clientY: 10 }));
    el.fire("wheel", wheel({ ctrlKey: true, deltaY: -30, clientX: 80, clientY: 90 }));
    expect(rafSpy).toHaveBeenCalledTimes(1);
    runFrame();
    expect(zoomAtSpy).toHaveBeenCalledTimes(1);
    expect(zoomAtSpy.mock.calls[0][0]).toEqual({ x: 80, y: 90 }); // latest point
    const factor = Math.exp(0.06) * Math.exp(0.045);
    expect(zoomAtSpy.mock.calls[0][1]).toBeCloseTo(factor, 10); // clampScale(1 * f1*f2)
  });

  it("flush applies BOTH a pan and a zoom queued in the same frame", () => {
    const el = makeEl();
    mount(el);
    el.fire("wheel", wheel({ deltaX: 12, deltaY: 8 })); // pan
    el.fire("wheel", wheel({ ctrlKey: true, deltaY: -100, clientX: 0, clientY: 0 })); // zoom @ origin
    runFrame();
    expect(panBySpy).toHaveBeenCalledWith(-12, -8);
    expect(zoomAtSpy).toHaveBeenCalledTimes(1);
    // pan first → cam (-12,-8,1); then zoom @ (0,0) k=e^0.15 : x = 0-(0-(-12))*k = 12*k
    const k = Math.exp(0.15);
    const c = cam();
    expect(c.scale).toBeCloseTo(k, 10);
    expect(c.x).toBeCloseTo(0 - (0 - -12) * k, 8);
    expect(c.y).toBeCloseTo(0 - (0 - -8) * k, 8);
  });

  it("a zero-delta wheel schedules a frame that touches NEITHER store action", () => {
    const el = makeEl();
    mount(el);
    el.fire("wheel", wheel({ deltaX: 0, deltaY: 0 })); // queuePan(0,0): schedules but panX/panY stay 0
    expect(rafCallbacks.size).toBe(1);
    runFrame();
    expect(panBySpy).not.toHaveBeenCalled(); // `panX!==0 || panY!==0` is false
    expect(zoomAtSpy).not.toHaveBeenCalled(); // `zoom` is null
    expect(cam()).toEqual({ x: 0, y: 0, scale: 1 });
  });
});

describe("pointer drag panning (isBackground / down / move / endPan)", () => {
  it("primary button on background starts panning: captures, sets interaction, clears selection", () => {
    useUiStore.getState().select("blk-1");
    expect(useUiStore.getState().selectedIds).toEqual(["blk-1"]);
    const el = makeEl();
    mount(el);
    el.fire("pointerdown", pointer({ button: 0, pointerType: "mouse", clientX: 100, clientY: 100, pointerId: 42 }));
    expect(el.setPointerCapture).toHaveBeenCalledWith(42);
    expect(useUiStore.getState().interaction).toBe("panning");
    expect(useUiStore.getState().selectedIds).toEqual([]);
  });

  it("mouse with a non-primary button is ignored (first guard returns)", () => {
    const el = makeEl();
    mount(el);
    el.fire("pointerdown", pointer({ button: 2, pointerType: "mouse" }));
    expect(el.setPointerCapture).not.toHaveBeenCalled();
    expect(useUiStore.getState().interaction).toBe("idle");
  });

  it("non-mouse pointer with a non-zero button still starts (guard's 2nd operand false)", () => {
    const el = makeEl();
    mount(el);
    el.fire("pointerdown", pointer({ button: -1, pointerType: "touch", pointerId: 3 }));
    expect(el.setPointerCapture).toHaveBeenCalledWith(3);
    expect(useUiStore.getState().interaction).toBe("panning");
  });

  it("pointerdown NOT on the background is ignored (second guard returns)", () => {
    const el = makeEl();
    mount(el);
    el.fire("pointerdown", pointer({ button: 0, target: domTarget({ wsBg: "0" }) }));
    expect(el.setPointerCapture).not.toHaveBeenCalled();
    expect(useUiStore.getState().interaction).toBe("idle");
  });

  it("isBackground is false when the target is not an HTMLElement (plain object)", () => {
    const el = makeEl();
    mount(el);
    el.fire("pointerdown", pointer({ button: 0, target: { dataset: { wsBg: "1" } } }));
    expect(el.setPointerCapture).not.toHaveBeenCalled();
    expect(useUiStore.getState().interaction).toBe("idle");
  });

  it("pointermove before any down is ignored (`!panning` return, nothing queued)", () => {
    const el = makeEl();
    mount(el);
    el.fire("pointermove", pointer({ clientX: 50, clientY: 50 }));
    expect(rafCallbacks.size).toBe(0);
    expect(panBySpy).not.toHaveBeenCalled();
  });

  it("during a drag, moves queue the delta and advance last{X,Y}", () => {
    const el = makeEl();
    mount(el);
    el.fire("pointerdown", pointer({ button: 0, clientX: 100, clientY: 100 }));
    el.fire("pointermove", pointer({ clientX: 130, clientY: 120 })); // dx 30, dy 20
    el.fire("pointermove", pointer({ clientX: 135, clientY: 118 })); // dx 5, dy -2 from new last
    runFrame();
    expect(panBySpy).toHaveBeenCalledTimes(1);
    expect(panBySpy).toHaveBeenCalledWith(35, 18); // summed in one frame
    expect(cam()).toEqual({ x: 35, y: 18, scale: 1 });
  });

  it("pointerup ends a drag: releases capture and returns interaction to idle", () => {
    const el = makeEl();
    mount(el);
    el.fire("pointerdown", pointer({ button: 0, pointerId: 9 }));
    el.fire("pointerup", pointer({ pointerId: 9 }));
    expect(el.releasePointerCapture).toHaveBeenCalledWith(9);
    expect(useUiStore.getState().interaction).toBe("idle");
  });

  it("pointercancel also ends the drag (same endPan handler)", () => {
    const el = makeEl();
    mount(el);
    el.fire("pointerdown", pointer({ button: 0, pointerId: 11 }));
    el.fire("pointercancel", pointer({ pointerId: 11 }));
    expect(el.releasePointerCapture).toHaveBeenCalledWith(11);
    expect(useUiStore.getState().interaction).toBe("idle");
  });

  it("pointerup with no drag in progress is a no-op (`!panning` return)", () => {
    const el = makeEl();
    mount(el);
    el.fire("pointerup", pointer({ pointerId: 1 }));
    expect(el.releasePointerCapture).not.toHaveBeenCalled();
    expect(useUiStore.getState().interaction).toBe("idle");
  });

  it("a throwing releasePointerCapture is swallowed; interaction still goes idle (catch branch)", () => {
    const el = makeEl();
    el.releasePointerCapture = vi.fn(() => {
      throw new Error("capture already gone");
    });
    mount(el);
    el.fire("pointerdown", pointer({ button: 0, pointerId: 5 }));
    expect(() => el.fire("pointerup", pointer({ pointerId: 5 }))).not.toThrow();
    expect(useUiStore.getState().interaction).toBe("idle");
  });

  it("after a drag ends, a later move no longer pans (panning was reset)", () => {
    const el = makeEl();
    mount(el);
    el.fire("pointerdown", pointer({ button: 0, clientX: 0, clientY: 0 }));
    el.fire("pointerup", pointer({}));
    el.fire("pointermove", pointer({ clientX: 500, clientY: 500 }));
    expect(rafCallbacks.size).toBe(0);
    expect(panBySpy).not.toHaveBeenCalled();
  });
});

describe("two-finger touch pinch (touchStart / touchMove / touchEnd)", () => {
  it("pinch out zooms by dist/pinchDist, anchored at the midpoint", () => {
    const el = makeEl();
    mount(el);
    el.fire("touchstart", touches([{ clientX: 0, clientY: 0 }, { clientX: 0, clientY: 100 }])); // pinchDist 100
    const mv = touches([{ clientX: 0, clientY: 0 }, { clientX: 0, clientY: 150 }]); // dist 150
    el.fire("touchmove", mv);
    expect(mv.preventDefault).toHaveBeenCalledTimes(1);
    runFrame();
    // factor 1.5 @ midpoint (0,75): x = 0 ; y = 75 - 75*1.5 = -37.5
    expect(zoomAtSpy.mock.calls[0][0]).toEqual({ x: 0, y: 75 });
    expect(cam()).toEqual({ x: 0, y: -37.5, scale: 1.5 });
  });

  it("a one-finger touchmove returns early: no preventDefault, no zoom", () => {
    const el = makeEl();
    mount(el);
    const mv = touches([{ clientX: 0, clientY: 0 }]);
    el.fire("touchmove", mv);
    expect(mv.preventDefault).not.toHaveBeenCalled();
    expect(rafCallbacks.size).toBe(0);
    expect(zoomAtSpy).not.toHaveBeenCalled();
  });

  it("touchstart with !=2 fingers leaves pinchDist 0, so the first 2-finger move can't zoom yet", () => {
    const el = makeEl();
    mount(el);
    el.fire("touchstart", touches([{ clientX: 0, clientY: 0 }])); // 1 finger → pinchDist stays 0
    const first = touches([{ clientX: 0, clientY: 0 }, { clientX: 0, clientY: 100 }]); // dist 100
    el.fire("touchmove", first);
    expect(first.preventDefault).toHaveBeenCalledTimes(1); // preventDefault precedes the pinchDist>0 gate
    expect(zoomAtSpy).not.toHaveBeenCalled(); // pinchDist was 0 → skip queueZoom
    // pinchDist is now 100; the NEXT move zooms
    const second = touches([{ clientX: 0, clientY: 0 }, { clientX: 0, clientY: 200 }]); // dist 200 → factor 2
    el.fire("touchmove", second);
    runFrame();
    expect(zoomAtSpy).toHaveBeenCalledTimes(1);
    expect(cam().scale).toBe(2);
  });

  it("touchend that drops below two fingers resets pinchDist (no zoom on the next 2-finger move)", () => {
    const el = makeEl();
    mount(el);
    el.fire("touchstart", touches([{ clientX: 0, clientY: 0 }, { clientX: 0, clientY: 100 }])); // pinchDist 100
    el.fire("touchend", { touches: [] }); // length 0 < 2 → reset to 0
    const mv = touches([{ clientX: 0, clientY: 0 }, { clientX: 0, clientY: 300 }]); // dist 300
    el.fire("touchmove", mv);
    runFrame();
    expect(zoomAtSpy).not.toHaveBeenCalled(); // pinchDist was 0 again
    expect(cam().scale).toBe(1);
  });

  it("touchend with >=2 fingers KEEPS pinchDist (next move still zooms off it)", () => {
    const el = makeEl();
    mount(el);
    el.fire("touchstart", touches([{ clientX: 0, clientY: 0 }, { clientX: 0, clientY: 100 }])); // pinchDist 100
    el.fire("touchend", { touches: [{ clientX: 0, clientY: 0 }, { clientX: 0, clientY: 0 }] }); // len 2 → keep
    const mv = touches([{ clientX: 0, clientY: 0 }, { clientX: 0, clientY: 200 }]); // dist 200 → factor 2
    el.fire("touchmove", mv);
    runFrame();
    expect(zoomAtSpy).toHaveBeenCalledTimes(1);
    expect(cam().scale).toBe(2); // used the retained pinchDist of 100
  });

  it("touchDist is Euclidean (diagonal): pinchDist = hypot(dx,dy)", () => {
    const el = makeEl();
    mount(el);
    // start diagonal 3-4-5 scaled: (0,0)-(30,40) → dist 50 ; move (0,0)-(60,80) → dist 100 → factor 2
    el.fire("touchstart", touches([{ clientX: 0, clientY: 0 }, { clientX: 30, clientY: 40 }]));
    el.fire("touchmove", touches([{ clientX: 0, clientY: 0 }, { clientX: 60, clientY: 80 }]));
    runFrame();
    expect(zoomAtSpy).toHaveBeenCalledTimes(1);
    expect(zoomAtSpy.mock.calls[0][0]).toEqual({ x: 30, y: 40 }); // midpoint of (0,0)&(60,80)
    expect(cam().scale).toBe(2);
  });
});
