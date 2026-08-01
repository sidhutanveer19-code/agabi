import { describe, it, expect, beforeEach, vi } from "vitest";

import type { Camera, Region, Size } from "@/features/workspace/types";

/**
 * useCameraNavigation.ts — the animated fitAll / fly-to-region controller. It is a
 * pure ORCHESTRATION hook: it reads the live camera, computes a target with the REAL
 * `navigation` geometry, cancels any in-flight tween, and hands the tween off to
 * `animateCamera` with the reduced-motion flag. So the only things faked are the
 * framework/I/O edges (§H1.7):
 *   - React's `useRef`/`useCallback`/`useEffect` are replaced with a synchronous host
 *     so the hook body (and its cleanup) executes for real, exactly once per "mount".
 *   - `useReducedMotion` (which reaches `window.matchMedia`) is a controllable boolean.
 *   - `animateCamera` (the rAF tween driver — its OWN module, covered by animateTo.test)
 *     is a spy returning a cancelable handle, so we can assert the EXACT four arguments
 *     the hook forwards and observe the cancel wiring.
 * Everything ABOVE that edge runs for REAL: the `useCameraStore` zustand store (live
 * `getState().camera` + real `setCamera`) and the `fitAllCamera`/`regionCamera` math,
 * whose exact outputs are asserted (§H1.2), never "it ran".
 *
 * Branches / mutants covered:
 *   flyTo:   anim.current?.cancel() — null on first call (optional-chain guard, no throw,
 *            no cancel) · present on a second call (prior handle cancelled exactly once) ·
 *            forwards LIVE getState().camera as `from` (read at call time, not mount) ·
 *            forwards the target as `to` · onFrame sink writes straight to setCamera ·
 *            forwards { reducedMotion: reduced } for BOTH reduced=false and reduced=true.
 *   fitAll:  target truthy → flyTo(fitAllCamera union target) · target null (empty regions
 *            AND zero-width viewport) → `if (target)` false → NO animation · viewport honored.
 *   goTo:    always flies to regionCamera(region, viewport) · viewport honored.
 *   cleanup: unmount cancels an in-flight handle · unmount with nothing in flight is a
 *            no-op that does not throw (optional-chain guard on line 45).
 *   return:  exactly { fitAll, goTo }, both callable.
 */

// ---- React edge: run useRef/useCallback/useEffect synchronously, once per mount (§H1.7) -----------
const host = vi.hoisted(() => ({
  refs: [] as { current: unknown }[],
  refCursor: 0,
  effects: [] as Array<() => void | (() => void)>,
}));

vi.mock("react", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("react");
  return {
    ...actual,
    useRef: (init: unknown) => {
      const i = host.refCursor++;
      if (!(i in host.refs)) host.refs[i] = { current: init };
      return host.refs[i];
    },
    useCallback: (fn: unknown) => fn,
    useEffect: (fn: () => void | (() => void)) => {
      host.effects.push(fn);
    },
  };
});

// ---- reduced-motion: the browser (matchMedia) I/O edge --------------------------------------------
const rm = vi.hoisted(() => ({ reduced: false }));
vi.mock("@/hooks/useReducedMotion", () => ({
  useReducedMotion: () => rm.reduced,
}));

// ---- animateCamera: the rAF tween-driver I/O edge (own module / own test) -------------------------
const anim = vi.hoisted(() => {
  const handles: { cancel: ReturnType<typeof vi.fn> }[] = [];
  const animateCamera = vi.fn(() => {
    const handle = { cancel: vi.fn() };
    handles.push(handle);
    return handle;
  });
  return { animateCamera, handles };
});
vi.mock("@/features/workspace/camera/animateTo", () => ({
  animateCamera: anim.animateCamera,
}));

import { useCameraNavigation } from "./useCameraNavigation";
import { useCameraStore } from "@/features/workspace/stores/camera.store";
import { fitAllCamera, regionCamera } from "@/features/workspace/navigation/navigation";

// ---- helpers --------------------------------------------------------------------------------------

/** Render the hook once and run its effects, returning the API and an unmount trigger. */
function mount(viewport: Size) {
  host.refs = [];
  host.refCursor = 0;
  host.effects = [];
  // eslint-disable-next-line react-hooks/rules-of-hooks -- deliberate: React is mocked; the hook is invoked in this test harness
  const api = useCameraNavigation(viewport);
  const cleanups = host.effects.map((e) => e());
  return {
    api,
    unmount: () =>
      cleanups.forEach((c) => {
        if (typeof c === "function") c();
      }),
  };
}

/** A fully-valid Region touching only the fields navigation reads. */
function makeRegion(x: number, y: number, w: number, h: number): Region {
  return { id: "r", title: "t", position: { x, y }, size: { w, h }, blocks: [], createdAt: 0 };
}

/** Positional args of the Nth animateCamera call, typed. */
function callArgs(n: number): [Camera, Camera, (cam: Camera) => void, { reducedMotion?: boolean }] {
  return anim.animateCamera.mock.calls[n] as unknown as [
    Camera,
    Camera,
    (cam: Camera) => void,
    { reducedMotion?: boolean },
  ];
}

const VP: Size = { w: 1240, h: 1240 };

beforeEach(() => {
  anim.animateCamera.mockClear();
  anim.handles.length = 0;
  rm.reduced = false;
  useCameraStore.setState({ camera: { x: 0, y: 0, scale: 1 } });
});

// ==================================================================================================

describe("useCameraNavigation — shape", () => {
  it("returns exactly { fitAll, goTo }, both callable", () => {
    const { api } = mount(VP);
    expect(Object.keys(api).sort()).toEqual(["fitAll", "goTo"]);
    expect(typeof api.fitAll).toBe("function");
    expect(typeof api.goTo).toBe("function");
  });
});

describe("goTo — fly to a single region", () => {
  it("forwards (liveCamera, regionCamera(region,viewport), setCameraSink, {reducedMotion:false})", () => {
    useCameraStore.setState({ camera: { x: 7, y: 11, scale: 1.5 } });
    const region = makeRegion(0, 0, 1000, 1000);
    const { api } = mount(VP);

    api.goTo(region);

    expect(anim.animateCamera).toHaveBeenCalledTimes(1);
    const [from, to, onFrame, opts] = callArgs(0);
    // `from` is the LIVE store camera, not a mount-time snapshot
    expect(from).toEqual({ x: 7, y: 11, scale: 1.5 });
    // `to` is the REAL region-framing camera; pin its exact value too
    expect(to).toEqual(regionCamera(region, VP));
    expect(to).toEqual({ scale: 1, x: 120, y: 120 });
    expect(opts).toEqual({ reducedMotion: false });

    // the onFrame sink writes each tween frame straight through to the store's setCamera
    onFrame({ x: 3, y: 4, scale: 2 });
    expect(useCameraStore.getState().camera).toEqual({ x: 3, y: 4, scale: 2 });
  });

  it("reads the camera at CALL time, not at mount time", () => {
    useCameraStore.setState({ camera: { x: 1, y: 1, scale: 1 } });
    const { api } = mount(VP);
    // camera moves AFTER mount but BEFORE the fly
    useCameraStore.setState({ camera: { x: 99, y: 88, scale: 3 } });

    api.goTo(makeRegion(0, 0, 1000, 1000));

    expect(callArgs(0)[0]).toEqual({ x: 99, y: 88, scale: 3 });
  });

  it("honors the current viewport when framing the region", () => {
    const region = makeRegion(0, 0, 1000, 1000);
    const wide: Size = { w: 2000, h: 2000 };
    const { api } = mount(wide);

    api.goTo(region);

    expect(callArgs(0)[1]).toEqual(regionCamera(region, wide));
    // a different viewport frames differently — proves the viewport is actually threaded through
    expect(callArgs(0)[1]).not.toEqual(regionCamera(region, VP));
  });

  it("forwards { reducedMotion: true } when the user prefers reduced motion", () => {
    rm.reduced = true;
    const { api } = mount(VP);

    api.goTo(makeRegion(0, 0, 1000, 1000));

    expect(callArgs(0)[3]).toEqual({ reducedMotion: true });
  });
});

describe("fitAll — frame every region", () => {
  it("flies to the fitAllCamera union target when regions are present", () => {
    const regions = [makeRegion(0, 0, 2000, 2000)];
    const vp: Size = { w: 1192, h: 1192 };
    const { api } = mount(vp);

    api.fitAll(regions);

    expect(anim.animateCamera).toHaveBeenCalledTimes(1);
    expect(callArgs(0)[1]).toEqual(fitAllCamera(regions, vp));
    expect(callArgs(0)[1]).toEqual({ scale: 0.5, x: 96, y: 96 });
  });

  it("frames the UNION of multiple regions (default padding 96)", () => {
    const regions = [makeRegion(0, 0, 1000, 1000), makeRegion(1000, 1000, 1000, 1000)];
    const vp: Size = { w: 1192, h: 1192 };
    const { api } = mount(vp);

    api.fitAll(regions);

    expect(callArgs(0)[1]).toEqual(fitAllCamera(regions, vp));
    expect(callArgs(0)[1]).toEqual({ scale: 0.5, x: 96, y: 96 });
  });

  it("empty regions → null target → `if (target)` false → does NOT animate", () => {
    const { api } = mount(VP);

    api.fitAll([]);

    expect(anim.animateCamera).not.toHaveBeenCalled();
  });

  it("zero-width viewport → fitAllCamera null even with regions → no animation", () => {
    const { api } = mount({ w: 0, h: 800 });

    api.fitAll([makeRegion(0, 0, 100, 100)]);

    expect(anim.animateCamera).not.toHaveBeenCalled();
  });
});

describe("flyTo — cancel-before-restart wiring", () => {
  it("the FIRST fly does not cancel anything (anim.current null — optional-chain guard)", () => {
    const { api } = mount(VP);

    expect(() => api.goTo(makeRegion(0, 0, 1000, 1000))).not.toThrow();

    expect(anim.animateCamera).toHaveBeenCalledTimes(1);
    expect(anim.handles[0].cancel).not.toHaveBeenCalled();
  });

  it("a SECOND fly cancels the first in-flight handle exactly once before starting the next", () => {
    const { api } = mount(VP);

    api.goTo(makeRegion(0, 0, 1000, 1000)); // handle 0
    api.fitAll([makeRegion(0, 0, 2000, 2000)]); // handle 1, must cancel handle 0 first

    expect(anim.handles).toHaveLength(2);
    expect(anim.handles[0].cancel).toHaveBeenCalledTimes(1);
    expect(anim.handles[1].cancel).not.toHaveBeenCalled();
  });
});

describe("cleanup — cancel on unmount", () => {
  it("unmount cancels the in-flight animation", () => {
    const { api, unmount } = mount(VP);
    api.goTo(makeRegion(0, 0, 1000, 1000));
    expect(anim.handles[0].cancel).not.toHaveBeenCalled();

    unmount();

    expect(anim.handles[0].cancel).toHaveBeenCalledTimes(1);
  });

  it("unmount with nothing in flight is a no-op and does not throw (optional-chain guard)", () => {
    const { unmount } = mount(VP);

    expect(() => unmount()).not.toThrow();
    expect(anim.animateCamera).not.toHaveBeenCalled();
  });
});
