import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RefObject } from "react";
import type { Size } from "@/features/workspace/types";

/**
 * useViewport is a browser-only React hook: it holds a `Size` in useState and, in a
 * single useEffect keyed on `[ref]`, reads `ref.current`, bails when it is null,
 * otherwise wires a ResizeObserver that on each entry pushes the measured
 * width/height into state (returning the SAME object when unchanged to skip a render)
 * and disconnects on cleanup. The core unit suite runs under the `node` env — no DOM,
 * no ResizeObserver, no React client renderer — so we drive the hook through a
 * faithful minimal hooks dispatcher (the narrowest framework seam) plus a fake
 * ResizeObserver (the one true browser I/O edge). REAL useState/useEffect semantics:
 * initial state, function-updater application, synchronous re-render on setState,
 * effect run-on-mount / re-run-when-deps-change / cleanup-on-unmount. The hook's OWN
 * logic then executes for real: the `!el` guard, the observer callback loop, the
 * `prev.w === width && prev.h === height` identity guard, the produced `{ w, h }`
 * object, the `[ref]` deps, and the disconnect cleanup. Every assertion pins a
 * concrete value/shape/identity so any source mutation flips a red test.
 */

// ---------------------------------------------------------------------------
// Minimal React hooks dispatcher (the mocked framework boundary).
// ---------------------------------------------------------------------------

interface HooksApi {
  useState<S>(init: S | (() => S)): [S, (next: S | ((prev: S) => S)) => void];
  useEffect(fn: () => void | (() => void), deps?: readonly unknown[]): void;
}

const bridge = vi.hoisted(() => ({ current: null as HooksApi | null }));

vi.mock("react", async (importActual) => {
  const actual = await importActual<typeof import("react")>();
  return {
    ...actual,
    useState: <S>(init: S | (() => S)) => bridge.current!.useState(init),
    useEffect: (fn: () => void | (() => void), deps?: readonly unknown[]) =>
      bridge.current!.useEffect(fn, deps),
  };
});

// Imported AFTER the mock is registered so the hook binds to the stubbed primitives.
import { useViewport } from "@/features/workspace/viewport/useViewport";

function depsEqual(a: readonly unknown[] | undefined, b: readonly unknown[] | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

type EffectSlot = { deps: readonly unknown[] | undefined; cleanup: (() => void) | undefined };
type PendingEffect = { fn: () => void | (() => void); deps: readonly unknown[] | undefined };

class HookHost<T> implements HooksApi {
  private readonly states: unknown[] = [];
  private readonly effects: EffectSlot[] = [];
  private pending: PendingEffect[] = [];
  private si = 0;
  private ei = 0;
  private mounted = false;
  private readonly renderFn: () => T;
  latest!: T;

  constructor(renderFn: () => T) {
    this.renderFn = renderFn;
  }

  useState<S>(init: S | (() => S)): [S, (next: S | ((prev: S) => S)) => void] {
    const i = this.si++;
    if (!this.mounted) {
      this.states[i] = typeof init === "function" ? (init as () => S)() : init;
    }
    const setState = (next: S | ((prev: S) => S)) => {
      const prev = this.states[i] as S;
      const value = typeof next === "function" ? (next as (p: S) => S)(prev) : next;
      // Faithful React: a setState that returns the SAME reference bails out of the
      // re-render. We still store it (identical) but only re-render when it changed —
      // which is exactly the optimisation the source's identity guard is exercising.
      this.states[i] = value;
      if (!Object.is(value, prev)) this.render();
    };
    return [this.states[i] as S, setState];
  }

  useEffect(fn: () => void | (() => void), deps?: readonly unknown[]): void {
    this.pending[this.ei++] = { fn, deps };
  }

  private commit(): void {
    for (let i = 0; i < this.pending.length; i++) {
      const p = this.pending[i];
      const prev = this.effects[i];
      const run = prev === undefined || p.deps === undefined || !depsEqual(prev.deps, p.deps);
      if (run) {
        prev?.cleanup?.();
        const cleanup = p.fn();
        this.effects[i] = {
          deps: p.deps,
          cleanup: typeof cleanup === "function" ? cleanup : undefined,
        };
      }
    }
  }

  render(): T {
    this.si = 0;
    this.ei = 0;
    this.pending = [];
    bridge.current = this;
    this.latest = this.renderFn();
    this.mounted = true;
    this.commit();
    return this.latest;
  }

  unmount(): void {
    for (const e of this.effects) e?.cleanup?.();
    this.effects.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Fake ResizeObserver (the one true browser I/O edge).
// ---------------------------------------------------------------------------

interface RORecord {
  callback: (entries: ReadonlyArray<{ contentRect: { width: number; height: number } }>) => void;
  observed: unknown[];
  disconnected: boolean;
}

let ros: RORecord[] = [];

class FakeResizeObserver {
  private readonly rec: RORecord;
  constructor(
    cb: (entries: ReadonlyArray<{ contentRect: { width: number; height: number } }>) => void,
  ) {
    this.rec = { callback: cb, observed: [], disconnected: false };
    ros.push(this.rec);
  }
  observe(el: unknown): void {
    this.rec.observed.push(el);
  }
  unobserve(): void {}
  disconnect(): void {
    this.rec.disconnected = true;
  }
}

/** Fire the most-recently-constructed observer with one entry of the given size. */
function fire(width: number, height: number): void {
  const ro = ros[ros.length - 1];
  if (!ro) throw new Error("no ResizeObserver has been constructed");
  ro.callback([{ contentRect: { width, height } }]);
}

function fakeEl(tag: string): HTMLElement {
  return { tag } as unknown as HTMLElement;
}

function makeRef(el: HTMLElement | null): RefObject<HTMLElement | null> {
  return { current: el };
}

// ---------------------------------------------------------------------------
// Mount engine — renderFn reads the ref out of a mutable holder so a re-render
// can swap the ref object (to exercise the `[ref]` effect dependency).
// ---------------------------------------------------------------------------

function mount(initialRef: RefObject<HTMLElement | null>) {
  const holder = { ref: initialRef };
  const host = new HookHost<Size>(() => useViewport(holder.ref));
  host.render();
  return { host, holder };
}

beforeEach(() => {
  ros = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  bridge.current = null;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Return value + initial state.
//    Kills: L13 body -> {} (returns undefined), L14 useState init {w:0,h:0} -> {}.
// ---------------------------------------------------------------------------

describe("useViewport — initial size + return", () => {
  it("returns the exact { w: 0, h: 0 } seed before any measurement", () => {
    const { host } = mount(makeRef(fakeEl("el")));
    // L13 BlockStatement -> {} would make the function return undefined.
    // L14 ObjectLiteral -> {} would seed state as {} (no w/h) instead of {w:0,h:0}.
    expect(host.latest).toEqual({ w: 0, h: 0 });
    expect(host.latest.w).toBe(0);
    expect(host.latest.h).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Effect wiring + the `!el` guard (both branches).
//    Kills: L16 body -> {} (no observer), L18 `!el` -> `el`,
//    L18 condition -> true (always return), L18 condition -> false (never return).
// ---------------------------------------------------------------------------

describe("useViewport — effect setup + null guard", () => {
  it("constructs a ResizeObserver and observes ref.current when the element is present", () => {
    const el = fakeEl("present");
    mount(makeRef(el));
    // L16 body -> {} : no observer at all.  L18 -> el / -> true : early return, no observer.
    expect(ros.length).toBe(1);
    expect(ros[0].observed).toEqual([el]);
  });

  it("does NOT construct or observe anything when ref.current is null (guard returns early)", () => {
    mount(makeRef(null));
    // Real: `if (!el) return;` bails before `new ResizeObserver`.
    // L18 condition -> false : falls through and does `new ResizeObserver(...).observe(null)`.
    // L18 `!el` -> `el`      : el is null (falsy) -> also falls through and observes null.
    expect(ros.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Observer callback pushes the measured size into state.
//    Kills: L20 callback body -> {}, L21 for-body -> {}, L23 arrow -> ()=>undefined,
//    L23 result object -> {}, and the ternary condition -> true (returns stale prev).
// ---------------------------------------------------------------------------

describe("useViewport — measurement updates state", () => {
  it("sets the exact measured { w, h } on the first observer fire", () => {
    const { host } = mount(makeRef(fakeEl("el")));
    fire(800, 600);
    // L20 / L21 emptied: setSize never runs -> stays {0,0}.
    // L23 arrow -> ()=>undefined: state becomes undefined.
    // L23 object -> {}: state becomes {} (no w/h).
    // L23 condition -> true: returns prev {0,0} even though dims changed.
    expect(host.latest).toEqual({ w: 800, h: 600 });
    expect(host.latest.w).toBe(800);
    expect(host.latest.h).toBe(600);
  });
});

// ---------------------------------------------------------------------------
// 4. Identity guard — unchanged dimensions keep the SAME object (no re-render).
//    Kills: L23 condition -> false (always new object), L23:28 `===` -> `!==` on w,
//    L23:48 `===` -> `!==` on h.  Each of those makes the guard fail on an EQUAL
//    measurement, producing a fresh object where the real code returns `prev`.
// ---------------------------------------------------------------------------

describe("useViewport — identity preservation on unchanged size", () => {
  it("returns the SAME size object when re-fired with identical dimensions", () => {
    const { host } = mount(makeRef(fakeEl("el")));
    fire(800, 600);
    const first = host.latest;
    expect(first).toEqual({ w: 800, h: 600 });

    fire(800, 600); // identical -> real guard is true -> returns prev (same reference)
    // L23 condition -> false: new object each time (value equal but reference differs).
    // L23:28 `prev.w !== width`: 800!==800 -> false -> whole guard false -> new object.
    // L23:48 `prev.h !== height`: 600!==600 -> false -> whole guard false -> new object.
    expect(host.latest).toBe(first);
  });
});

// ---------------------------------------------------------------------------
// 5. Guard operator specifics — a change in EITHER axis must update state.
//    Kills: L23 `&&` -> `||`, L23:48 right operand -> true, L23:28 left operand -> true.
// ---------------------------------------------------------------------------

describe("useViewport — per-axis change detection", () => {
  it("updates when only the height changes (kills && -> || and h-operand -> true)", () => {
    const { host } = mount(makeRef(fakeEl("el")));
    fire(800, 600);
    fire(800, 999); // width same, height changed
    // Real: (800===800 && 600===999) = false -> new {800,999}.
    // `&&` -> `||`: (true || false) = true -> keeps stale {800,600}.
    // right `prev.h === height` -> true: guard = (prev.w === width) = true -> keeps {800,600}.
    expect(host.latest).toEqual({ w: 800, h: 999 });
  });

  it("updates when only the width changes (kills w-operand -> true)", () => {
    const { host } = mount(makeRef(fakeEl("el")));
    fire(800, 600);
    fire(111, 600); // height same, width changed
    // Real: (800===111 && 600===600) = false -> new {111,600}.
    // left `prev.w === width` -> true: guard = (prev.h === height) = (600===600) = true -> keeps {800,600}.
    expect(host.latest).toEqual({ w: 111, h: 600 });
  });
});

// ---------------------------------------------------------------------------
// 6. Cleanup disconnects the observer.
//    Kills: L27 cleanup arrow `() => ro.disconnect()` -> `() => undefined`.
// ---------------------------------------------------------------------------

describe("useViewport — cleanup", () => {
  it("disconnects the ResizeObserver on unmount", () => {
    const { host } = mount(makeRef(fakeEl("el")));
    expect(ros.length).toBe(1);
    expect(ros[0].disconnected).toBe(false);

    host.unmount();
    // L27 arrow -> ()=>undefined: cleanup runs but never calls disconnect().
    expect(ros[0].disconnected).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Effect dependency `[ref]` — a new ref object must re-run the effect.
//    Kills: L28 deps `[ref]` -> `[]` (effect would never re-run, so a new element
//    is never observed and the stale observer is never disconnected).
// ---------------------------------------------------------------------------

describe("useViewport — [ref] dependency re-subscribes", () => {
  it("disconnects the old observer and observes the new element when ref changes", () => {
    const el1 = fakeEl("el1");
    const { host, holder } = mount(makeRef(el1));
    expect(ros.length).toBe(1);
    expect(ros[0].observed).toEqual([el1]);

    const el2 = fakeEl("el2");
    holder.ref = makeRef(el2); // brand-new ref OBJECT
    host.render();

    // Real deps [ref]: ref identity changed -> cleanup (disconnect ro0) + re-run (ro1.observe(el2)).
    // L28 deps [] : effect never re-runs -> ro0 stays, el2 is never observed.
    expect(ros.length).toBe(2);
    expect(ros[0].disconnected).toBe(true);
    expect(ros[1].observed).toEqual([el2]);
  });
});
