import { describe, it, expect, vi, beforeEach } from "vitest";
import { type RefObject } from "react";

/**
 * Unit tests for `useWorkspaceKeyboard` — the canvas keyboard map (arrows pan,
 * +/- zoom centered, `0` fits, Tab/Shift+Tab cycle regions, Escape clears selection).
 *
 * The whole hook lives inside a single `useEffect`, and the unit suite runs in a
 * `node` environment (no jsdom, no React renderer). So we override React's
 * `useEffect` to run the effect body synchronously and capture its cleanup — that
 * removes ONLY React's async scheduling, never the logic under test. Everything
 * exercised is real: the real `onKey`/`centerZoom` closures, the real `camera.store`
 * and `ui.store` (real zustand), and the real `cameraMath` (`zoomAt`/`clampScale`).
 * The DOM element is a tiny fake that faithfully registers/dispatches/removes
 * listeners and returns a fixed bounding rect.
 */

const hoisted = vi.hoisted(() => ({ cleanup: undefined as (() => void) | undefined }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    // Run the effect eagerly and stash its cleanup; deps are irrelevant here since
    // each test mounts exactly once. The effect returns a destructor on the normal
    // path and `undefined` on the early return (null ref) — preserve that distinction.
    useEffect: (fn: () => void | (() => void)) => {
      const destructor = fn();
      hoisted.cleanup = typeof destructor === "function" ? destructor : undefined;
    },
  };
});

const { useWorkspaceKeyboard } = await import("./useWorkspaceKeyboard");
const { useCameraStore } = await import("@/features/workspace/stores/camera.store");
const { useUiStore } = await import("@/features/workspace/stores/ui.store");
const { MIN_SCALE, MAX_SCALE } = await import("@/features/workspace/camera/cameraMath");
import type { Region } from "@/features/workspace/types";

// ---- fakes ---------------------------------------------------------------

interface FakeEl {
  getBoundingClientRect(): { width: number; height: number };
  addEventListener(type: string, fn: (e: KeyboardEvent) => void): void;
  removeEventListener(type: string, fn: (e: KeyboardEvent) => void): void;
  dispatch(type: string, e: KeyboardEvent): void;
  count(type: string): number;
}

function makeEl(width = 800, height = 600): FakeEl {
  const listeners = new Map<string, Set<(e: KeyboardEvent) => void>>();
  return {
    getBoundingClientRect: () => ({ width, height }),
    addEventListener(type, fn) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(type, e) {
      for (const fn of listeners.get(type) ?? []) fn(e);
    },
    count(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

interface Opts {
  onFit: ReturnType<typeof vi.fn>;
  onGoToRegion: ReturnType<typeof vi.fn>;
  getRegions: ReturnType<typeof vi.fn>;
}

function makeOpts(regions: Region[] = []): Opts {
  return {
    onFit: vi.fn(),
    onGoToRegion: vi.fn(),
    getRegions: vi.fn(() => regions),
  };
}

function region(id: string): Region {
  return { id, title: id, position: { x: 0, y: 0 }, size: { w: 10, h: 10 }, blocks: [], createdAt: 0 };
}

function mount(
  opts: Opts,
  width = 800,
  height = 600,
): { el: FakeEl; cleanup: (() => void) | undefined } {
  const el = makeEl(width, height);
  const ref = { current: el as unknown as HTMLElement } as RefObject<HTMLElement | null>;
  hoisted.cleanup = undefined;
  // Deliberately invoked as a plain function: `useEffect` is mocked to run
  // synchronously, so this is a test harness, not a React render.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useWorkspaceKeyboard(ref, opts as unknown as Parameters<typeof useWorkspaceKeyboard>[1]);
  return { el, cleanup: hoisted.cleanup };
}

/** Dispatch a keydown and return the spy for that event's preventDefault. */
function press(el: FakeEl, key: string, shiftKey = false) {
  const preventDefault = vi.fn();
  el.dispatch("keydown", { key, shiftKey, preventDefault } as unknown as KeyboardEvent);
  return preventDefault;
}

const cam = () => useCameraStore.getState().camera;

beforeEach(() => {
  useCameraStore.setState({ camera: { x: 0, y: 0, scale: 1 } });
  useUiStore.setState({ selectedIds: [], hoverId: null, focusId: null, interaction: "idle" });
});

// ---- lifecycle -----------------------------------------------------------

describe("useWorkspaceKeyboard — effect lifecycle", () => {
  it("registers exactly one keydown listener on mount", () => {
    const { el } = mount(makeOpts());
    expect(el.count("keydown")).toBe(1);
  });

  it("cleanup removes the keydown listener", () => {
    const { el, cleanup } = mount(makeOpts());
    expect(typeof cleanup).toBe("function");
    cleanup!();
    expect(el.count("keydown")).toBe(0);
  });

  it("after cleanup, keydowns no longer affect state", () => {
    const { el, cleanup } = mount(makeOpts());
    cleanup!();
    press(el, "ArrowLeft");
    expect(cam()).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it("no-ops and returns no cleanup when ref.current is null (early return)", () => {
    hoisted.cleanup = undefined;
    const ref = { current: null } as RefObject<HTMLElement | null>;
    const opts = makeOpts();
    expect(() =>
      useWorkspaceKeyboard(ref, opts as unknown as Parameters<typeof useWorkspaceKeyboard>[1]),
    ).not.toThrow();
    // The early return yields no cleanup fn; the normal path always returns one.
    expect(hoisted.cleanup).toBeUndefined();
  });
});

// ---- panning -------------------------------------------------------------

describe("useWorkspaceKeyboard — arrow panning", () => {
  it("ArrowLeft pans +80 on x and prevents default", () => {
    const { el } = mount(makeOpts());
    const pd = press(el, "ArrowLeft");
    expect(cam()).toEqual({ x: 80, y: 0, scale: 1 });
    expect(pd).toHaveBeenCalledTimes(1);
  });

  it("ArrowRight pans -80 on x", () => {
    const { el } = mount(makeOpts());
    const pd = press(el, "ArrowRight");
    expect(cam()).toEqual({ x: -80, y: 0, scale: 1 });
    expect(pd).toHaveBeenCalledTimes(1);
  });

  it("ArrowUp pans +80 on y", () => {
    const { el } = mount(makeOpts());
    const pd = press(el, "ArrowUp");
    expect(cam()).toEqual({ x: 0, y: 80, scale: 1 });
    expect(pd).toHaveBeenCalledTimes(1);
  });

  it("ArrowDown pans -80 on y", () => {
    const { el } = mount(makeOpts());
    const pd = press(el, "ArrowDown");
    expect(cam()).toEqual({ x: 0, y: -80, scale: 1 });
    expect(pd).toHaveBeenCalledTimes(1);
  });

  it("arrows are additive across presses", () => {
    const { el } = mount(makeOpts());
    press(el, "ArrowLeft");
    press(el, "ArrowUp");
    press(el, "ArrowUp");
    expect(cam()).toEqual({ x: 80, y: 160, scale: 1 });
  });
});

// ---- zooming -------------------------------------------------------------

describe("useWorkspaceKeyboard — centered zoom", () => {
  it("'+' zooms in by 1.2 about the viewport center", () => {
    const { el } = mount(makeOpts()); // 800x600 → center (400,300)
    const pd = press(el, "+");
    expect(cam().scale).toBe(1.2);
    expect(cam().x).toBeCloseTo(-80, 6);
    expect(cam().y).toBeCloseTo(-60, 6);
    expect(pd).toHaveBeenCalledTimes(1);
  });

  it("'=' is an alias for '+'", () => {
    const { el } = mount(makeOpts());
    press(el, "=");
    expect(cam().scale).toBe(1.2);
    expect(cam().x).toBeCloseTo(-80, 6);
    expect(cam().y).toBeCloseTo(-60, 6);
  });

  it("'-' zooms out by 1/1.2 about the viewport center", () => {
    const { el } = mount(makeOpts());
    const pd = press(el, "-");
    expect(cam().scale).toBeCloseTo(1 / 1.2, 12);
    expect(cam().x).toBeCloseTo(66.66666666666663, 6);
    expect(cam().y).toBe(50);
    expect(pd).toHaveBeenCalledTimes(1);
  });

  it("'_' is an alias for '-'", () => {
    const { el } = mount(makeOpts());
    press(el, "_");
    expect(cam().scale).toBeCloseTo(1 / 1.2, 12);
    expect(cam().x).toBeCloseTo(66.66666666666663, 6);
    expect(cam().y).toBe(50);
  });

  it("zoom is centered on the element rect, not the origin (non-zero camera)", () => {
    useCameraStore.setState({ camera: { x: 10, y: 20, scale: 1 } });
    const { el } = mount(makeOpts());
    press(el, "+");
    // x = 400 - (400-10)*1.2 = -68 ; y = 300 - (300-20)*1.2 = -36
    expect(cam().x).toBeCloseTo(-68, 6);
    expect(cam().y).toBeCloseTo(-36, 6);
  });

  it("factor multiplies the CURRENT scale (start at 2 → 2.4)", () => {
    useCameraStore.setState({ camera: { x: 0, y: 0, scale: 2 } });
    const { el } = mount(makeOpts());
    press(el, "+");
    expect(cam().scale).toBe(2.4);
  });

  it("uses the actual rect size for the center (400x300 rect → center 200,150)", () => {
    const { el } = mount(makeOpts(), 400, 300); // center (200,150)
    press(el, "+");
    // x = 200 - (200-0)*1.2 = -40 ; y = 150 - 150*1.2 = -30
    expect(cam().x).toBeCloseTo(-40, 6);
    expect(cam().y).toBeCloseTo(-30, 6);
  });

  it("zoom-in is clamped to MAX_SCALE", () => {
    useCameraStore.setState({ camera: { x: 0, y: 0, scale: MAX_SCALE } });
    const { el } = mount(makeOpts());
    press(el, "+");
    expect(cam().scale).toBe(MAX_SCALE);
    expect(cam()).toEqual({ x: 0, y: 0, scale: 4 });
  });

  it("zoom-out is clamped to MIN_SCALE", () => {
    useCameraStore.setState({ camera: { x: 0, y: 0, scale: MIN_SCALE } });
    const { el } = mount(makeOpts());
    press(el, "-");
    expect(cam().scale).toBe(MIN_SCALE);
    expect(cam()).toEqual({ x: 0, y: 0, scale: 0.1 });
  });
});

// ---- fitToRect -----------------------------------------------------------------

describe("useWorkspaceKeyboard — '0' fits", () => {
  it("'0' invokes onFit and touches nothing else", () => {
    const opts = makeOpts([region("r0")]);
    const { el } = mount(opts);
    const pd = press(el, "0");
    expect(opts.onFit).toHaveBeenCalledTimes(1);
    expect(opts.onGoToRegion).not.toHaveBeenCalled();
    expect(cam()).toEqual({ x: 0, y: 0, scale: 1 });
    expect(pd).toHaveBeenCalledTimes(1);
  });
});

// ---- Tab cycling ---------------------------------------------------------

describe("useWorkspaceKeyboard — Tab region cycling", () => {
  it("Tab with no regions returns early: no focus, no navigation, no preventDefault", () => {
    const opts = makeOpts([]);
    const { el } = mount(opts);
    const pd = press(el, "Tab");
    expect(opts.onGoToRegion).not.toHaveBeenCalled();
    expect(opts.onFit).not.toHaveBeenCalled();
    expect(useUiStore.getState().focusId).toBeNull();
    expect(pd).not.toHaveBeenCalled();
  });

  it("Tab cycles forward through regions and wraps (0,1,2,0)", () => {
    const regions = [region("r0"), region("r1"), region("r2")];
    const opts = makeOpts(regions);
    const { el } = mount(opts);

    const pd0 = press(el, "Tab");
    expect(useUiStore.getState().focusId).toBe("r0");
    expect(opts.onGoToRegion).toHaveBeenLastCalledWith(regions[0]);
    expect(pd0).toHaveBeenCalledTimes(1);

    press(el, "Tab");
    expect(useUiStore.getState().focusId).toBe("r1");
    expect(opts.onGoToRegion).toHaveBeenLastCalledWith(regions[1]);

    press(el, "Tab");
    expect(useUiStore.getState().focusId).toBe("r2");
    expect(opts.onGoToRegion).toHaveBeenLastCalledWith(regions[2]);

    press(el, "Tab");
    expect(useUiStore.getState().focusId).toBe("r0"); // wrapped
    expect(opts.onGoToRegion).toHaveBeenLastCalledWith(regions[0]);

    expect(opts.onGoToRegion).toHaveBeenCalledTimes(4);
  });

  it("Shift+Tab cycles backward from the initial cursor and wraps (1,0,2)", () => {
    const regions = [region("r0"), region("r1"), region("r2")];
    const opts = makeOpts(regions);
    const { el } = mount(opts);

    // cycle starts at -1: ( -1 - 1 + 3 ) % 3 = 1
    press(el, "Tab", true);
    expect(useUiStore.getState().focusId).toBe("r1");
    expect(opts.onGoToRegion).toHaveBeenLastCalledWith(regions[1]);

    press(el, "Tab", true); // ( 1 - 1 + 3 ) % 3 = 0
    expect(useUiStore.getState().focusId).toBe("r0");

    press(el, "Tab", true); // ( 0 - 1 + 3 ) % 3 = 2  (wrapped)
    expect(useUiStore.getState().focusId).toBe("r2");
  });

  it("forward then backward reverses one step", () => {
    const regions = [region("r0"), region("r1"), region("r2")];
    const opts = makeOpts(regions);
    const { el } = mount(opts);

    press(el, "Tab"); // -1 -> 0  => r0
    press(el, "Tab"); //  0 -> 1  => r1
    expect(useUiStore.getState().focusId).toBe("r1");
    press(el, "Tab", true); // 1 -> 0 => r0
    expect(useUiStore.getState().focusId).toBe("r0");
  });

  it("single-region cycling stays put on repeated Tab / Shift+Tab", () => {
    const regions = [region("only")];
    const opts = makeOpts(regions);
    const { el } = mount(opts);
    press(el, "Tab"); // (-1+1)%1 = 0
    expect(useUiStore.getState().focusId).toBe("only");
    press(el, "Tab"); // (0+1)%1 = 0
    expect(useUiStore.getState().focusId).toBe("only");
    press(el, "Tab", true); // (0-1+1)%1 = 0
    expect(useUiStore.getState().focusId).toBe("only");
    expect(opts.onGoToRegion).toHaveBeenCalledTimes(3);
    expect(opts.onGoToRegion).toHaveBeenLastCalledWith(regions[0]);
  });
});

// ---- Escape + default ----------------------------------------------------

describe("useWorkspaceKeyboard — Escape and unknown keys", () => {
  it("Escape clears the selection and does NOT prevent default", () => {
    useUiStore.getState().select("blk-1");
    expect(useUiStore.getState().selectedIds).toEqual(["blk-1"]);
    const { el } = mount(makeOpts());
    const pd = press(el, "Escape");
    expect(useUiStore.getState().selectedIds).toEqual([]);
    expect(pd).not.toHaveBeenCalled();
  });

  it("an unknown key hits the default branch: no state change, no preventDefault", () => {
    const opts = makeOpts([region("r0")]);
    const { el } = mount(opts);
    const pd = press(el, "a");
    expect(cam()).toEqual({ x: 0, y: 0, scale: 1 });
    expect(useUiStore.getState().focusId).toBeNull();
    expect(opts.onFit).not.toHaveBeenCalled();
    expect(opts.onGoToRegion).not.toHaveBeenCalled();
    expect(pd).not.toHaveBeenCalled();
  });
});
