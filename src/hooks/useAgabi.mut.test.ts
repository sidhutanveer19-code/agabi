import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgabiState } from "@/stores/session.store";

/**
 * useAgabi is the entry-screen controller hook. It owns the rotating-examples
 * timer loop (two chained setTimeouts on `window`), the entry input state, and the
 * "mint a canvas + navigate" action. It composes useRef + useEffect + useCallback
 * over the zustand session store and the Next router. The core unit suite runs under
 * the `node` env — no DOM, no React client renderer — so we drive the hook through a
 * faithful minimal hooks dispatcher (the same technique as useSpeech.cov.test.ts):
 * REAL useRef/useEffect/useCallback semantics (stable refs, memoised callbacks by
 * deps, effects that run on mount / re-run when deps change / clean up on unmount).
 *
 * The hook's OWN logic then executes for real — the clear() guard, the loopEx guard
 * chain, the exIndex wrap arithmetic, pick()'s trim/fallback, enterCanvas's URL
 * composition, and every action. The only faked externals are the three true I/O
 * edges: `window.setTimeout/clearTimeout` (a controllable timer registry so we can
 * fire/cancel and inspect exactly which timer was cancelled), `crypto.randomUUID`
 * (a fixed id for a deterministic URL), and the router/store modules. Every
 * assertion pins a concrete result, so any source mutation flips a red test.
 */

// ---------------------------------------------------------------------------
// Minimal React hooks dispatcher (the mocked framework boundary).
// ---------------------------------------------------------------------------

interface HooksApi {
  useRef<R>(init: R): { current: R };
  useCallback<F>(fn: F, deps: readonly unknown[]): F;
  useEffect(fn: () => void | (() => void), deps?: readonly unknown[]): void;
}

const hostBridge = vi.hoisted(() => ({ current: null as HooksApi | null }));

vi.mock("react", async (importActual) => {
  const actual = await importActual<typeof import("react")>();
  return {
    ...actual,
    useRef: <R>(init: R) => hostBridge.current!.useRef(init),
    useCallback: <F>(fn: F, deps: readonly unknown[]) => hostBridge.current!.useCallback(fn, deps),
    useEffect: (fn: () => void | (() => void), deps?: readonly unknown[]) =>
      hostBridge.current!.useEffect(fn, deps),
  };
});

// ---- session store: a real minimal store whose `set` mutates a shared snapshot. ----
type Patch = Partial<AgabiState> | ((s: AgabiState) => Partial<AgabiState>);
const store = vi.hoisted(() => ({
  state: null as unknown as AgabiState,
  setCalls: [] as Patch[],
}));

vi.mock("@/stores/session.store", () => {
  const set = (patch: Patch) => {
    store.setCalls.push(patch);
    const p = typeof patch === "function" ? patch(store.state) : patch;
    store.state = { ...store.state, ...p };
  };
  return {
    useSessionStore: (selector: (s: { state: AgabiState; set: (p: Patch) => void }) => unknown) =>
      selector({ state: store.state, set }),
  };
});

// ---- next router: capture push() calls. ----
const nav = vi.hoisted(() => ({ push: null as unknown as ReturnType<typeof vi.fn> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push }) }));

// Imported AFTER the mocks are registered so the hook binds to the stubs.
import { useAgabi } from "@/hooks/useAgabi";
import { EXAMPLES } from "@/constants/examples";

// ---------------------------------------------------------------------------
// Hook host (mount / re-render / unmount engine).
// ---------------------------------------------------------------------------

function depsEqual(a: readonly unknown[] | undefined, b: readonly unknown[] | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

type CallbackSlot = { fn: unknown; deps: readonly unknown[] };
type EffectSlot = { deps: readonly unknown[] | undefined; cleanup: (() => void) | undefined };
type PendingEffect = { fn: () => void | (() => void); deps: readonly unknown[] | undefined };

class HookHost<T> implements HooksApi {
  private readonly refs: { current: unknown }[] = [];
  private readonly callbacks: CallbackSlot[] = [];
  private readonly effects: EffectSlot[] = [];
  private pending: PendingEffect[] = [];
  private ri = 0;
  private ci = 0;
  private ei = 0;
  private mounted = false;
  private readonly renderFn: () => T;
  latest!: T;

  constructor(renderFn: () => T) {
    this.renderFn = renderFn;
  }

  useRef<R>(init: R): { current: R } {
    const i = this.ri++;
    if (!this.mounted) this.refs[i] = { current: init };
    return this.refs[i] as { current: R };
  }

  useCallback<F>(fn: F, deps: readonly unknown[]): F {
    const i = this.ci++;
    const existing = this.callbacks[i];
    if (existing && depsEqual(existing.deps, deps)) return existing.fn as F;
    this.callbacks[i] = { fn, deps };
    return fn;
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
        this.effects[i] = { deps: p.deps, cleanup: typeof cleanup === "function" ? cleanup : undefined };
      }
    }
  }

  render(): T {
    this.ri = 0;
    this.ci = 0;
    this.ei = 0;
    this.pending = [];
    hostBridge.current = this;
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

type AgabiReturn = ReturnType<typeof useAgabi>;

function renderHook(): HookHost<AgabiReturn> {
  const host = new HookHost<AgabiReturn>(() => useAgabi());
  host.render();
  return host;
}

// ---------------------------------------------------------------------------
// Controllable timer registry backing window.setTimeout / clearTimeout.
// ---------------------------------------------------------------------------

interface FakeTimer {
  id: number;
  fn: () => void;
  delay: number;
  cancelled: boolean;
  fired: boolean;
}
let timerSeq = 0;
let timers: FakeTimer[] = [];
let clearCalls: number[] = [];

const win = {
  setTimeout: (fn: () => void, delay: number) => {
    const id = ++timerSeq; // ids start at 1 -> always truthy & != null (matches real handles)
    timers.push({ id, fn, delay, cancelled: false, fired: false });
    return id;
  },
  clearTimeout: (id: number) => {
    clearCalls.push(id);
    const t = timers.find((x) => x.id === id);
    if (t) t.cancelled = true;
  },
};

function lastTimer(): FakeTimer {
  const t = timers[timers.length - 1];
  if (!t) throw new Error("no timer has been scheduled");
  return t;
}
function pendingWithDelay(d: number): FakeTimer[] {
  return timers.filter((t) => t.delay === d && !t.cancelled && !t.fired);
}
function countPending(d: number): number {
  return pendingWithDelay(d).length;
}
function createdWithDelay(d: number): number {
  return timers.filter((t) => t.delay === d).length; // total ever scheduled (incl. cancelled/fired)
}
function firePending(d: number): void {
  const list = pendingWithDelay(d);
  const t = list[list.length - 1];
  if (!t) throw new Error(`no pending timer with delay ${d}`);
  t.fired = true;
  t.fn();
}
function fireId(id: number): void {
  const t = timers.find((x) => x.id === id);
  if (t && !t.cancelled && !t.fired) {
    t.fired = true;
    t.fn();
  }
}
function isCancelled(id: number): boolean {
  const t = timers.find((x) => x.id === id);
  return !!t && t.cancelled;
}

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

function seed(overrides: Partial<AgabiState> = {}): void {
  store.state = { phase: "entry", goal: "", exIndex: 0, exOp: 1, listening: false, ...overrides };
}

beforeEach(() => {
  timerSeq = 0;
  timers = [];
  clearCalls = [];
  store.setCalls = [];
  seed();
  nav.push = vi.fn();
  (globalThis as { window?: unknown }).window = win;
  vi.stubGlobal("crypto", { randomUUID: () => "fixed-id" });
});

afterEach(() => {
  hostBridge.current = null;
  delete (globalThis as { window?: unknown }).window;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Returned surface: state passthrough, example, mic, actions.
//    Kills: L14 body, L15/L16 selectors, L69 actions object, the mic ternaries +
//    string literals, and `example: EXAMPLES[state.exIndex]`.
// ---------------------------------------------------------------------------

describe("useAgabi — returned surface", () => {
  it("passes the exact store state through and exposes every action + derived value", () => {
    seed({ goal: "seeded", exIndex: 3 });
    const host = renderHook();

    // state passthrough is the live store snapshot (selector (s) => s.state must NOT be () => undefined)
    expect(host.latest.state).toBe(store.state);
    expect(host.latest.state.goal).toBe("seeded");
    // example is indexed by exIndex (not a constant, not index 0)
    expect(host.latest.example).toBe(EXAMPLES[3]);
    expect(host.latest.example).toBe("Explain DNA replication");
    // ...actions spread must be present (L69 ObjectLiteral -> {} drops them all)
    for (const key of ["onGoal", "onKeyEnter", "learn", "quick", "back", "toggleMic", "setListening"]) {
      expect(typeof (host.latest as unknown as Record<string, unknown>)[key]).toBe("function");
    }
  });

  it("computes the IDLE mic palette exactly when not listening", () => {
    seed({ listening: false });
    const host = renderHook();
    expect(host.latest.mic).toEqual({
      border: "rgba(255,255,255,.14)",
      bg: "transparent",
      color: "#B8B0A2",
      hint: "or say it out loud",
      hintColor: "#8b8579",
    });
  });

  it("computes the LISTENING mic palette exactly when listening", () => {
    seed({ listening: true });
    const host = renderHook();
    expect(host.latest.mic).toEqual({
      border: "rgba(56,189,248,.5)",
      bg: "rgba(56,189,248,.1)",
      color: "#38BDF8",
      hint: "listening — just speak",
      hintColor: "#7DD3FC",
    });
  });

  it("example reads index 0 by default", () => {
    seed({ exIndex: 0 });
    const host = renderHook();
    expect(host.latest.example).toBe("Teach me quadratic equations");
  });
});

// ---------------------------------------------------------------------------
// 2. Mount loop scheduling + the loopEx guard chain + wrap arithmetic.
//    Kills: L31/L46 bodies, L47 loopExRef assign, L48 loopEx() call, L34 guard
//    (all variants), L35/L38 nested setTimeouts, L37 set({exOp:0}), L36 inner guard,
//    L39 arithmetic (+ and %), L40 loopExRef re-invoke, L21 effect deps.
// ---------------------------------------------------------------------------

describe("useAgabi — rotating examples loop", () => {
  it("schedules the fade-out timer (3400ms) on mount when on entry with no goal", () => {
    seed({ phase: "entry", goal: "" });
    renderHook();
    expect(countPending(3400)).toBe(1);
  });

  it("does NOT schedule when a goal is present (guard || short-circuits)", () => {
    seed({ phase: "entry", goal: "already typing" });
    renderHook();
    expect(countPending(3400)).toBe(0);
  });

  it("does NOT schedule when the phase is not 'entry' (guard !== branch)", () => {
    seed({ phase: "canvas", goal: "" });
    renderHook();
    expect(countPending(3400)).toBe(0);
  });

  it("fires the full cycle: fade-out sets exOp=0 + schedules the 440ms swap, which advances exIndex, restores exOp=1, and re-arms the loop", () => {
    seed({ phase: "entry", goal: "", exIndex: 0, exOp: 1 });
    renderHook();

    const bId = lastTimer().id; // the 3400ms fade-out
    firePending(3400);
    expect(store.state.exOp).toBe(0); // L37 set({exOp:0}) — not set({})
    expect(countPending(440)).toBe(1); // L38 inner setTimeout scheduled

    firePending(440);
    expect(store.state.exIndex).toBe(1); // (0 + 1) % 7 = 1 — kills + -> - (-1) and % -> * (7)
    expect(store.state.exOp).toBe(1); // restored
    // loopExRef.current() re-armed the loop -> a fresh 3400ms timer exists (L47 assign + L40 call)
    expect(countPending(3400)).toBe(1);
    // the original timers are spent, not lingering-pending
    expect(pendingWithDelay(3400).some((t) => t.id === bId)).toBe(false);
  });

  it("wraps exIndex back to 0 from the last example (modulo, not multiply/subtract)", () => {
    seed({ phase: "entry", goal: "", exIndex: EXAMPLES.length - 1 });
    renderHook();
    firePending(3400);
    firePending(440);
    expect(store.state.exIndex).toBe(0); // (6 + 1) % 7 = 0
  });

  it("re-checks the guard when the fade-out fires: a goal typed in the meantime aborts the fade (inner guard)", () => {
    seed({ phase: "entry", goal: "" });
    const host = renderHook();
    expect(countPending(3400)).toBe(1);

    // Simulate the user having typed a goal + React re-rendering (ref-sync effect updates ref.current).
    store.state = { ...store.state, goal: "typed while waiting" };
    host.render();

    firePending(3400);
    expect(store.state.exOp).toBe(1); // inner guard returned -> exOp NOT set to 0
    expect(countPending(440)).toBe(0); // and the swap timer was NOT scheduled
  });

  it("does nothing on mount / never advances when the mount effect never ran loopEx (a spent loop leaves no re-armed timer if loopExRef was not set)", () => {
    // A second, independent guarantee for L47/L48: after a full cycle the loop must
    // keep re-arming; here we run TWO cycles and confirm exIndex advances each time.
    seed({ phase: "entry", goal: "", exIndex: 0 });
    renderHook();
    firePending(3400);
    firePending(440);
    expect(store.state.exIndex).toBe(1);
    // second cycle off the re-armed timer
    firePending(3400);
    firePending(440);
    expect(store.state.exIndex).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. clear(): the != null guard + the "a"/"b" slot literals.
//    Kills: L25 body, L26 (-> true / -> false / == null), L32/L33 loopEx clears.
// ---------------------------------------------------------------------------

describe("useAgabi — clear() timer guard", () => {
  it("does NOT call window.clearTimeout when the slot is empty (!= null guard is real)", () => {
    seed({ phase: "entry", goal: "has goal" }); // loopEx early-returns => no timers armed
    const host = renderHook();
    expect(countPending(3400)).toBe(0);
    clearCalls = [];

    host.latest.learn(); // enterCanvas -> clear("a"), clear("b") on two empty slots

    expect(clearCalls).toEqual([]); // real: guard false -> no clear; mutant true/==null -> clears undefined
  });

  it("cancels the pending fade-out when an action clears it (guard true path + real clearTimeout)", () => {
    seed({ phase: "entry", goal: "" });
    const host = renderHook();
    const bId = lastTimer().id;
    expect(countPending(3400)).toBe(1);

    host.latest.learn(); // enterCanvas clears "a" and "b" -> cancels the fade-out

    expect(isCancelled(bId)).toBe(true);
    // the cancelled timer must not run
    fireId(bId);
    expect(store.state.exOp).toBe(1); // never faded (would be 0 if the timer had run)
  });

  it("loopEx clears the previously-armed fade-out before re-arming (L33 clear(\"b\"))", () => {
    seed({ phase: "entry", goal: "" });
    const host = renderHook();
    const b1 = lastTimer().id; // first fade-out

    host.latest.back(); // schedules a 0ms re-loop
    firePending(0); // runs loopEx -> clear("a"), clear("b") then re-arms a fresh fade-out

    expect(isCancelled(b1)).toBe(true); // the stale fade-out was cancelled
    fireId(b1);
    expect(store.state.exOp).toBe(1); // stale timer inert
    expect(countPending(3400)).toBe(1); // exactly one fresh fade-out armed
  });

  it("loopEx clears a pending swap timer before re-arming (L32 clear(\"a\"))", () => {
    seed({ phase: "entry", goal: "", exIndex: 0 });
    const host = renderHook();
    firePending(3400); // fade-out fires -> arms the 440ms swap
    const a1 = lastTimer().id;
    expect(countPending(440)).toBe(1);

    host.latest.back();
    firePending(0); // loopEx clears "a" -> cancels the pending swap

    expect(isCancelled(a1)).toBe(true);
    fireId(a1);
    expect(store.state.exIndex).toBe(0); // swap never ran -> index unchanged
  });
});

// ---------------------------------------------------------------------------
// 4. pick(): trim, empty-fallback to the current example, and the || precedence.
//    Kills: L56 arrow, the two logical ops, the trim MethodExpression, and the
//    "" -> "Stryker" literal — all observed through the composed navigation URL.
// ---------------------------------------------------------------------------

describe("useAgabi — pick() topic resolution", () => {
  it("uses the trimmed typed goal when present (goal beats example)", () => {
    seed({ goal: "  photosynthesis  ", exIndex: 0 });
    const host = renderHook();
    host.latest.learn();
    expect(nav.push).toHaveBeenCalledWith("/c/fixed-id?goal=photosynthesis");
  });

  it("falls back to the CURRENT example when the goal is empty", () => {
    seed({ goal: "", exIndex: 2 });
    const host = renderHook();
    host.latest.learn();
    expect(nav.push).toHaveBeenCalledWith(`/c/fixed-id?goal=${encodeURIComponent(EXAMPLES[2])}`);
    expect(EXAMPLES[2]).toBe("Help me master Newton's laws");
  });

  it("falls back to the example when the goal is only whitespace (pick trims before the || fallback)", () => {
    seed({ goal: "     ", exIndex: 1 });
    const host = renderHook();
    host.latest.learn();
    expect(nav.push).toHaveBeenCalledWith(`/c/fixed-id?goal=${encodeURIComponent(EXAMPLES[1])}`);
  });
});

// ---------------------------------------------------------------------------
// 5. enterCanvas(): clears timers, mints the id, composes the URL.
//    Kills: L64 nullish chain (goal ?? ref.goal), L66 template literals (path,
//    ?goal= segment). enterCanvas is reached through learn/quick/onKeyEnter.
// ---------------------------------------------------------------------------

describe("useAgabi — enterCanvas() navigation", () => {
  it("navigates to /c/<uuid> with the goal query segment for a typed topic", () => {
    seed({ goal: "gradient descent", exIndex: 0 });
    const host = renderHook();
    host.latest.onKeyEnter();
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenCalledWith("/c/fixed-id?goal=gradient%20descent");
  });

  it("prefers the explicit topic argument over ref.current.goal (nullish chain, first ?? kept)", () => {
    // goal is empty in the store, so pick() returns the example; enterCanvas receives
    // that example as its explicit arg. The store goal ("") must NOT override it.
    seed({ goal: "", exIndex: 4 });
    const host = renderHook();
    host.latest.learn();
    expect(nav.push).toHaveBeenCalledWith(`/c/fixed-id?goal=${encodeURIComponent(EXAMPLES[4])}`);
    expect(EXAMPLES[4]).toBe("Prepare me for tomorrow's physics exam");
  });

  it("builds the path as /c/<id> (template literal is real, not empty)", () => {
    seed({ goal: "x", exIndex: 0 });
    const host = renderHook();
    host.latest.learn();
    const url = nav.push.mock.calls[0][0] as string;
    expect(url.startsWith("/c/fixed-id")).toBe(true);
    expect(url).toContain("?goal=x");
  });
});

// ---------------------------------------------------------------------------
// 6. onGoal(): store write + the two conditional side-effects.
//    Kills: L70 body, L72 set({goal}), L73 (guard variants) + L74/L75 clears,
//    L77 (guard variants) + L78 set({exOp:1}) + L79 deferred loopEx.
// ---------------------------------------------------------------------------

describe("useAgabi — onGoal()", () => {
  it("writes the typed value into the store (set({ goal: value }))", () => {
    seed({ goal: "" });
    const host = renderHook();
    host.latest.onGoal("half-life");
    expect(store.state.goal).toBe("half-life");
  });

  it("cancels the running loop the first time a goal is typed (!was && value -> clear a+b)", () => {
    seed({ phase: "entry", goal: "" });
    const host = renderHook();
    const bId = lastTimer().id;

    host.latest.onGoal("newton"); // was "" , value truthy -> enters the clear block

    expect(isCancelled(bId)).toBe(true);
    fireId(bId);
    expect(store.state.exOp).toBe(1); // fade-out never ran
    expect(countPending(0)).toBe(0); // second guard (was && !value) did NOT fire
  });

  it("cancels the pending SWAP timer too when a goal is first typed (L74 clear(\"a\"))", () => {
    seed({ phase: "entry", goal: "", exIndex: 0 });
    const host = renderHook();
    firePending(3400); // arm the 440ms swap
    const aId = lastTimer().id;

    host.latest.onGoal("newton"); // was "" (ref not re-rendered) , value truthy -> clear("a")

    expect(isCancelled(aId)).toBe(true);
    fireId(aId);
    expect(store.state.exIndex).toBe(0); // swap cancelled -> index unchanged
  });

  it("does NOT clear timers when clearing an already-empty goal (guard is !was && value, real)", () => {
    // was "" AND value "" -> neither block runs. The armed fade-out survives and fires.
    seed({ phase: "entry", goal: "" });
    const host = renderHook();
    expect(countPending(3400)).toBe(1);

    host.latest.onGoal(""); // was "" , value "" -> both guards false

    // real: fade-out still pending -> firing it fades (exOp 0). A mutated guard that
    // fired the clear block (-> true / !was || value) would have cancelled it.
    firePending(3400);
    expect(store.state.exOp).toBe(0);
  });

  it("restores examples + re-arms the loop when a goal is cleared back to empty (was && !value)", () => {
    seed({ phase: "entry", goal: "einstein", exOp: 0 });
    const host = renderHook();
    expect(countPending(3400)).toBe(0); // had a goal on mount -> loop idle

    host.latest.onGoal(""); // was truthy, value "" -> set({exOp:1}) + deferred loopEx
    expect(store.state.exOp).toBe(1); // L78 set({exOp:1}) not set({})
    expect(countPending(0)).toBe(1); // L79 deferred loopEx scheduled

    host.render(); // React re-renders after set -> ref.current.goal syncs to ""
    firePending(0); // the deferred loopEx runs
    expect(countPending(3400)).toBe(1); // loop re-armed
  });

  it("does NOT restore/re-arm when replacing one non-empty goal with another (was && !value stays false)", () => {
    seed({ phase: "entry", goal: "einstein", exOp: 0 });
    const host = renderHook();

    host.latest.onGoal("newton"); // was truthy, value truthy -> second guard false

    expect(store.state.exOp).toBe(0); // NOT bumped to 1
    expect(countPending(0)).toBe(0); // no deferred loopEx (kills was || !value)
  });
});

// ---------------------------------------------------------------------------
// 7. onKeyEnter / learn / quick all navigate (distinct arrow bodies).
// ---------------------------------------------------------------------------

describe("useAgabi — enter actions", () => {
  it.each(["onKeyEnter", "learn", "quick"] as const)(
    "%s() navigates via enterCanvas(pick())",
    (action) => {
      seed({ goal: "topic-" + action, exIndex: 0 });
      const host = renderHook();
      (host.latest[action] as () => void)();
      expect(nav.push).toHaveBeenCalledWith(`/c/fixed-id?goal=topic-${action}`);
    },
  );
});

// ---------------------------------------------------------------------------
// 8. mic toggles + back().
//    Kills: L91 toggleMic (flip), L92 setListening (assign), L87/L88/L89 back.
// ---------------------------------------------------------------------------

describe("useAgabi — mic actions", () => {
  it("toggleMic flips listening in both directions", () => {
    seed({ listening: false });
    const host = renderHook();
    host.latest.toggleMic();
    expect(store.state.listening).toBe(true);
    host.latest.toggleMic();
    expect(store.state.listening).toBe(false);
  });

  it("setListening writes the exact boolean given", () => {
    seed({ listening: false });
    const host = renderHook();
    host.latest.setListening(true);
    expect(store.state.listening).toBe(true);
    host.latest.setListening(false);
    expect(store.state.listening).toBe(false);
  });
});

describe("useAgabi — back()", () => {
  it("restores exOp=1 and re-arms the rotating loop", () => {
    seed({ phase: "entry", goal: "", exOp: 0 });
    const host = renderHook();
    // run one full cycle first so a fade-out is already pending; back() must still work
    firePending(3400);
    firePending(440);
    store.state = { ...store.state, exOp: 0 };
    const fadesBefore = createdWithDelay(3400);

    host.latest.back();
    expect(store.state.exOp).toBe(1); // L88 set({exOp:1}) — not set({})
    expect(countPending(0)).toBe(1); // L89 deferred loopEx scheduled

    firePending(0);
    // the deferred loopEx must have armed exactly one MORE fade-out (a pre-existing one
    // would otherwise mask a no-op deferred call)
    expect(createdWithDelay(3400)).toBe(fadesBefore + 1);
  });
});

// ---------------------------------------------------------------------------
// 9. Mount/unmount effects: ref-sync (L19/L21) + cleanup (L46/L50/L51/L52).
// ---------------------------------------------------------------------------

describe("useAgabi — effects", () => {
  it("ref-sync effect keeps enterCanvas reading the LATEST goal after a re-render (L19 body + L21 deps)", () => {
    seed({ goal: "old", exIndex: 0 });
    const host = renderHook();

    store.state = { ...store.state, goal: "brand-new" };
    host.render(); // ref-sync effect must re-run (deps [state]) and update ref.current

    host.latest.onKeyEnter();
    expect(nav.push).toHaveBeenCalledWith("/c/fixed-id?goal=brand-new");
  });

  it("unmount cancels a still-pending SWAP timer held in the t.a slot (L50 body + L51 clear(t.a))", () => {
    seed({ phase: "entry", goal: "", exIndex: 0 });
    const host = renderHook();
    firePending(3400); // fade-out fires -> the 440ms swap is now armed in the t.a slot
    const swapId = lastTimer().id;
    expect(countPending(440)).toBe(1);

    host.unmount(); // cleanup must clear t.a

    expect(isCancelled(swapId)).toBe(true);
    fireId(swapId);
    expect(store.state.exIndex).toBe(0); // swap never ran -> index unchanged
  });

  it("unmount does NOT call clearTimeout when no timers are live (L51/L52 -> true would clear undefined)", () => {
    seed({ phase: "entry", goal: "has goal" }); // nothing armed
    const host = renderHook();
    clearCalls = [];
    host.unmount();
    expect(clearCalls).toEqual([]);
  });

  it("unmount cancels a still-pending fade-out scheduled on mount (L52 clear(t.b))", () => {
    seed({ phase: "entry", goal: "" });
    const host = renderHook();
    const bId = lastTimer().id;
    expect(countPending(3400)).toBe(1);

    host.unmount();

    expect(isCancelled(bId)).toBe(true);
    fireId(bId);
    expect(store.state.exOp).toBe(1); // never faded
  });
});

// ---------------------------------------------------------------------------
// 10. enterCanvas() empty-topic fallback path — the branch no other test reaches.
//     When exIndex points past EXAMPLES, EXAMPLES[exIndex] is undefined, so pick()
//     yields undefined and enterCanvas falls through to `ref.current.goal`. This is
//     the ONLY route that feeds an untrimmed / empty value into enterCanvas's own
//     `(goal ?? ref.current.goal ?? "").trim()`, and the only route that makes the
//     resolved topic empty so the URL builder takes its `: ""` else-branch.
//     Kills: L64:15 (.trim() on the ref.current.goal fallback) and L66:67 (the empty
//     else-segment of the `g ? \`?goal=…\` : ""` template).
// ---------------------------------------------------------------------------

describe("useAgabi — enterCanvas() empty-topic fallback", () => {
  it("trims a whitespace-only stored goal down to nothing and navigates WITHOUT a ?goal= segment", () => {
    // pick() -> ("   ").trim() === "" -> || EXAMPLES[7] (undefined) -> undefined.
    // enterCanvas(undefined) -> (undefined ?? "   " ?? "").trim() === "" -> bare URL.
    seed({ phase: "entry", goal: "   ", exIndex: EXAMPLES.length });
    const host = renderHook();

    host.latest.learn();

    // Real: trimmed to "" -> the `g ? … : ""` else-branch -> exactly "/c/fixed-id".
    // Mutant L64:15 (no .trim()): g === "   " (truthy) -> "/c/fixed-id?goal=%20%20%20".
    // Mutant L66:67 (else -> "Stryker was here!"): "/c/fixed-idStryker was here!".
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenCalledWith("/c/fixed-id");
  });

  it("omits the ?goal= segment entirely when the resolved topic is empty (URL builder else-branch is '')", () => {
    // Empty stored goal + no example at exIndex -> pick() undefined -> enterCanvas(undefined)
    // -> (undefined ?? "" ?? "").trim() === "" -> the topic is empty.
    seed({ phase: "entry", goal: "", exIndex: EXAMPLES.length });
    const host = renderHook();

    host.latest.learn();

    // The bare path with NO query string is the exact real output; the L66:67 mutant
    // would append "Stryker was here!" to the else-branch instead of "".
    expect(nav.push).toHaveBeenCalledWith("/c/fixed-id");
    const url = nav.push.mock.calls[0][0] as string;
    expect(url.includes("?goal=")).toBe(false);
  });
});
