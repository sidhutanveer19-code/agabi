import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * useSpeech is a browser-only React hook: it composes useSyncExternalStore (the
 * SSR-safe `supported` flag) with useState (listening/denied), useRef (the live
 * recognition instance + the onText/onEnd callback refs), two useEffects (ref-sync
 * on every render + an unmount cleanup) and two useCallbacks (start/stop), all
 * wrapped around the Web Speech API. The core unit suite runs under the `node` env
 * — no DOM, no React client renderer — so we cannot mount a component to drive it.
 *
 * Instead we drive the hook through a faithful minimal hooks dispatcher (the
 * framework boundary — the narrowest possible seam). A tiny mount/re-render engine
 * provides REAL useState/useRef/useEffect/useCallback/useSyncExternalStore
 * semantics (stable refs across renders, memoised callbacks by deps, effects that
 * run on mount / re-run when deps change / clean up on unmount, setState that
 * re-renders and re-commits effects). The hook's OWN logic then executes for real:
 * start()/stop(), the onresult concatenation + trim guard, onend/onerror teardown,
 * the ref-sync effect, and the unmount stop(). The only things faked are the two
 * true browser externals: `window` and the `SpeechRecognition` constructor — every
 * assertion pins a concrete result (exact prop values, exact callback arguments,
 * state transitions, call counts), so a mutation in the source flips a red test.
 *
 * Sister file `useSpeech.test.ts` already pins `probeSpeechCtor` + the SSR constant;
 * this file pins the hook body. The two are independent and do not overlap.
 */

// ---------------------------------------------------------------------------
// Minimal React hooks dispatcher (the mocked framework boundary).
// ---------------------------------------------------------------------------

interface HooksApi {
  useState<S>(init: S | (() => S)): [S, (next: S | ((prev: S) => S)) => void];
  useRef<R>(init: R): { current: R };
  useCallback<F>(fn: F, deps: readonly unknown[]): F;
  useEffect(fn: () => void | (() => void), deps?: readonly unknown[]): void;
}

type CapturedStore = {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => unknown;
  getServerSnapshot: () => unknown;
};

// Hoisted so the (hoisted) vi.mock factory can reach the live dispatcher pointer +
// the captured useSyncExternalStore args.
const bridge = vi.hoisted(() => ({
  current: null as HooksApi | null,
  store: null as CapturedStore | null,
}));

vi.mock("react", async (importActual) => {
  const actual = await importActual<typeof import("react")>();
  return {
    ...actual,
    useState: <S>(init: S | (() => S)) => bridge.current!.useState(init),
    useRef: <R>(init: R) => bridge.current!.useRef(init),
    useCallback: <F>(fn: F, deps: readonly unknown[]) => bridge.current!.useCallback(fn, deps),
    useEffect: (fn: () => void | (() => void), deps?: readonly unknown[]) =>
      bridge.current!.useEffect(fn, deps),
    useSyncExternalStore: <V>(
      subscribe: (onChange: () => void) => () => void,
      getSnapshot: () => V,
      getServerSnapshot: () => V,
    ): V => {
      bridge.store = { subscribe, getSnapshot, getServerSnapshot };
      return getSnapshot(); // client's initial render uses the client snapshot (arg 2)
    },
  };
});

// Imported AFTER the mock is registered so the hook binds to the stubbed primitives.
import { useSpeech } from "@/hooks/useSpeech";

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
  private readonly states: unknown[] = [];
  private readonly refs: { current: unknown }[] = [];
  private readonly callbacks: CallbackSlot[] = [];
  private readonly effects: EffectSlot[] = [];
  private pending: PendingEffect[] = [];
  private si = 0;
  private ri = 0;
  private ci = 0;
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
      if (!Object.is(value, this.states[i])) {
        this.states[i] = value;
        this.render(); // synchronous re-render + effect re-commit (faithful end state)
      }
    };
    return [this.states[i] as S, setState];
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
      // No deps array (undefined) => run every render; deps array => run only when it changed.
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
    this.ri = 0;
    this.ci = 0;
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

type SpeechReturn = ReturnType<typeof useSpeech>;

function renderHook(fn: () => SpeechReturn): HookHost<SpeechReturn> {
  const host = new HookHost(fn);
  host.render();
  return host;
}

// ---------------------------------------------------------------------------
// Faked Web Speech API.
// ---------------------------------------------------------------------------

interface FakeRec {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
}

function installSpeech(kind: "standard" | "webkit" = "standard") {
  const instances: FakeRec[] = [];
  class Recognition {
    lang = "";
    interimResults = false;
    continuous = false;
    start = vi.fn();
    stop = vi.fn();
    onresult: FakeRec["onresult"] = null;
    onend: FakeRec["onend"] = null;
    onerror: FakeRec["onerror"] = null;
    constructor() {
      instances.push(this as unknown as FakeRec);
    }
  }
  const key = kind === "standard" ? "SpeechRecognition" : "webkitSpeechRecognition";
  (globalThis as { window?: unknown }).window = { [key]: Recognition };
  return {
    Recognition,
    instances,
    last(): FakeRec {
      const rec = instances[instances.length - 1];
      if (!rec) throw new Error("expected a recognition instance to have been created");
      return rec;
    },
  };
}

/** Build an onresult event from a list of transcript strings (one top alternative each). */
function resultEvent(transcripts: string[]) {
  return { results: transcripts.map((t) => [{ transcript: t }]) };
}

afterEach(() => {
  bridge.current = null;
  bridge.store = null;
  delete (globalThis as { window?: unknown }).window;
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// supported / initial state.
// ---------------------------------------------------------------------------

describe("useSpeech — supported flag + initial state", () => {
  it("reports supported=true and idle state when the browser exposes SpeechRecognition", () => {
    installSpeech("standard");
    const host = renderHook(() => useSpeech(() => {}));
    expect(host.latest.supported).toBe(true);
    expect(host.latest.listening).toBe(false);
    expect(host.latest.denied).toBe(false);
    expect(typeof host.latest.start).toBe("function");
    expect(typeof host.latest.stop).toBe("function");
  });

  it("reports supported=true via the webkit-prefixed constructor too", () => {
    installSpeech("webkit");
    const host = renderHook(() => useSpeech(() => {}));
    expect(host.latest.supported).toBe(true);
  });

  it("reports supported=false when window exists but the Speech API is absent (Firefox)", () => {
    (globalThis as { window?: unknown }).window = {};
    const host = renderHook(() => useSpeech(() => {}));
    expect(host.latest.supported).toBe(false);
  });

  it("reports supported=false on the server (no window)", () => {
    expect(typeof window).toBe("undefined");
    const host = renderHook(() => useSpeech(() => {}));
    expect(host.latest.supported).toBe(false);
  });

  it("wires the store with a constant-false SERVER snapshot and the real CLIENT probe (SSR-safe)", () => {
    installSpeech("standard");
    renderHook(() => useSpeech(() => {}));
    const store = bridge.store;
    expect(store).not.toBeNull();
    // Client snapshot reads the real capability (window has the ctor -> true)...
    expect(store!.getSnapshot()).toBe(true);
    // ...but the server / first-hydration snapshot is a hard false that never reads window.
    expect(store!.getServerSnapshot()).toBe(false);
    // subscribe is the stable no-op: it returns an unsubscribe function and fires nothing.
    const unsub = store!.subscribe(() => {
      throw new Error("subscribe must never invoke onChange");
    });
    expect(typeof unsub).toBe("function");
    expect(() => unsub()).not.toThrow();
  });

  it("getServerSnapshot stays false even while the client would match (no window read on server path)", () => {
    installSpeech("standard");
    renderHook(() => useSpeech(() => {}));
    expect(bridge.store!.getServerSnapshot()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// start() — configuration + guards.
// ---------------------------------------------------------------------------

describe("useSpeech — start()", () => {
  it("creates a recognition instance configured for en-US interim non-continuous and begins listening", () => {
    const speech = installSpeech("standard");
    const host = renderHook(() => useSpeech(() => {}));

    host.latest.start();

    expect(speech.instances).toHaveLength(1);
    const rec = speech.last();
    expect(rec.lang).toBe("en-US");
    expect(rec.interimResults).toBe(true);
    expect(rec.continuous).toBe(false);
    expect(rec.start).toHaveBeenCalledTimes(1);
    expect(host.latest.listening).toBe(true);
    expect(host.latest.denied).toBe(false);
  });

  it("is a no-op when the Speech API is unavailable — no instance, stays idle", () => {
    (globalThis as { window?: unknown }).window = {}; // supported=false, probe returns null
    const host = renderHook(() => useSpeech(() => {}));

    expect(() => host.latest.start()).not.toThrow();
    expect(host.latest.listening).toBe(false);
  });

  it("ignores a second start() while already running (no duplicate instance, start() not re-called)", () => {
    const speech = installSpeech("standard");
    const host = renderHook(() => useSpeech(() => {}));

    host.latest.start();
    host.latest.start(); // recRef is set -> early return

    expect(speech.instances).toHaveLength(1);
    expect(speech.last().start).toHaveBeenCalledTimes(1);
    expect(host.latest.listening).toBe(true);
  });

  it("allows a fresh start() after the previous session ended (recRef cleared on end)", () => {
    const speech = installSpeech("standard");
    const host = renderHook(() => useSpeech(() => {}));

    host.latest.start();
    speech.last().onend!(); // clears recRef, listening -> false
    expect(host.latest.listening).toBe(false);

    host.latest.start(); // recRef null again -> creates a second instance
    expect(speech.instances).toHaveLength(2);
    expect(host.latest.listening).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// onresult — transcript concatenation, trim guard, top alternative.
// ---------------------------------------------------------------------------

describe("useSpeech — onresult", () => {
  it("concatenates every result's top alternative and forwards the trimmed transcript", () => {
    const onText = vi.fn();
    const speech = installSpeech("standard");
    const host = renderHook(() => useSpeech(onText));
    host.latest.start();

    speech.last().onresult!(resultEvent(["hello ", "world", " again"]));

    expect(onText).toHaveBeenCalledTimes(1);
    expect(onText).toHaveBeenCalledWith("hello world again");
  });

  it("trims surrounding whitespace from the delivered transcript", () => {
    const onText = vi.fn();
    const speech = installSpeech("standard");
    const host = renderHook(() => useSpeech(onText));
    host.latest.start();

    speech.last().onresult!(resultEvent(["   hi there   "]));

    expect(onText).toHaveBeenCalledWith("hi there");
  });

  it("uses the FIRST (top) alternative of each result", () => {
    const onText = vi.fn();
    const speech = installSpeech("standard");
    const host = renderHook(() => useSpeech(onText));
    host.latest.start();

    // Two alternatives per result; only index [0] should be read.
    speech.last().onresult!({
      results: [
        [{ transcript: "keep" }, { transcript: "DROP" }],
        [{ transcript: "-this" }, { transcript: "DROP" }],
      ],
    });

    expect(onText).toHaveBeenCalledWith("keep-this");
  });

  it("does NOT call onText when the combined transcript is only whitespace", () => {
    const onText = vi.fn();
    const speech = installSpeech("standard");
    const host = renderHook(() => useSpeech(onText));
    host.latest.start();

    speech.last().onresult!(resultEvent(["   ", "\t", "\n"]));

    expect(onText).not.toHaveBeenCalled();
  });

  it("does NOT call onText when there are zero results", () => {
    const onText = vi.fn();
    const speech = installSpeech("standard");
    const host = renderHook(() => useSpeech(onText));
    host.latest.start();

    speech.last().onresult!(resultEvent([]));

    expect(onText).not.toHaveBeenCalled();
  });

  it("forwards to the LATEST onText after a re-render (ref-sync effect keeps the callback current)", () => {
    const first = vi.fn();
    const second = vi.fn();
    const props = { onText: first as (t: string) => void };
    const speech = installSpeech("standard");
    const host = renderHook(() => useSpeech(props.onText));
    host.latest.start();

    // Swap the prop and re-render: the ref-sync effect must repoint onTextRef.
    props.onText = second;
    host.render();

    speech.last().onresult!(resultEvent(["updated"]));

    expect(second).toHaveBeenCalledWith("updated");
    expect(first).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// onend — teardown + optional callback.
// ---------------------------------------------------------------------------

describe("useSpeech — onend", () => {
  it("clears the instance, stops listening, and invokes the onEnd callback", () => {
    const onEnd = vi.fn();
    const speech = installSpeech("standard");
    const host = renderHook(() => useSpeech(() => {}, onEnd));
    host.latest.start();
    expect(host.latest.listening).toBe(true);

    speech.last().onend!();

    expect(host.latest.listening).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("does not throw when onEnd was not provided (optional callback)", () => {
    const speech = installSpeech("standard");
    const host = renderHook(() => useSpeech(() => {})); // no onEnd
    host.latest.start();

    expect(() => speech.last().onend!()).not.toThrow();
    expect(host.latest.listening).toBe(false);
  });

  it("invokes the LATEST onEnd after a re-render (ref-sync keeps onEnd current)", () => {
    const firstEnd = vi.fn();
    const secondEnd = vi.fn();
    const props = { onEnd: firstEnd as () => void };
    const speech = installSpeech("standard");
    const host = renderHook(() => useSpeech(() => {}, props.onEnd));
    host.latest.start();

    props.onEnd = secondEnd;
    host.render();

    speech.last().onend!();

    expect(secondEnd).toHaveBeenCalledTimes(1);
    expect(firstEnd).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// onerror — teardown + permission denial classification.
// ---------------------------------------------------------------------------

describe("useSpeech — onerror", () => {
  it("marks denied=true and stops on a 'not-allowed' error", () => {
    const speech = installSpeech("standard");
    const host = renderHook(() => useSpeech(() => {}));
    host.latest.start();

    speech.last().onerror!({ error: "not-allowed" });

    expect(host.latest.denied).toBe(true);
    expect(host.latest.listening).toBe(false);
  });

  it("marks denied=true and stops on a 'service-not-allowed' error", () => {
    const speech = installSpeech("standard");
    const host = renderHook(() => useSpeech(() => {}));
    host.latest.start();

    speech.last().onerror!({ error: "service-not-allowed" });

    expect(host.latest.denied).toBe(true);
    expect(host.latest.listening).toBe(false);
  });

  it("stops without marking denied on an unrelated error (e.g. 'no-speech')", () => {
    const speech = installSpeech("standard");
    const host = renderHook(() => useSpeech(() => {}));
    host.latest.start();

    speech.last().onerror!({ error: "no-speech" });

    expect(host.latest.denied).toBe(false);
    expect(host.latest.listening).toBe(false);
  });

  it("stops without marking denied when the error object carries no error code", () => {
    const speech = installSpeech("standard");
    const host = renderHook(() => useSpeech(() => {}));
    host.latest.start();

    speech.last().onerror!({}); // e.error === undefined

    expect(host.latest.denied).toBe(false);
    expect(host.latest.listening).toBe(false);
  });

  it("does not throw and does not deny when the error argument itself is missing (defensive e?.error)", () => {
    const speech = installSpeech("standard");
    const host = renderHook(() => useSpeech(() => {}));
    host.latest.start();

    const rec = speech.last();
    expect(() => (rec.onerror as (e?: { error?: string }) => void)(undefined)).not.toThrow();
    expect(host.latest.denied).toBe(false);
    expect(host.latest.listening).toBe(false);
  });

  it("clears the instance so a subsequent start() opens a fresh session after an error", () => {
    const speech = installSpeech("standard");
    const host = renderHook(() => useSpeech(() => {}));
    host.latest.start();
    speech.last().onerror!({ error: "not-allowed" });

    host.latest.start();
    expect(speech.instances).toHaveLength(2);
    expect(host.latest.listening).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// stop() and unmount cleanup.
// ---------------------------------------------------------------------------

describe("useSpeech — stop() and unmount cleanup", () => {
  it("stop() calls the running instance's stop()", () => {
    const speech = installSpeech("standard");
    const host = renderHook(() => useSpeech(() => {}));
    host.latest.start();

    host.latest.stop();

    expect(speech.last().stop).toHaveBeenCalledTimes(1);
  });

  it("stop() is a safe no-op when nothing is running (recRef null)", () => {
    installSpeech("standard");
    const host = renderHook(() => useSpeech(() => {}));

    expect(() => host.latest.stop()).not.toThrow();
    expect(host.latest.listening).toBe(false);
  });

  it("unmount stops the running instance (cleanup effect)", () => {
    const speech = installSpeech("standard");
    const host = renderHook(() => useSpeech(() => {}));
    host.latest.start();
    expect(speech.last().stop).not.toHaveBeenCalled();

    host.unmount();

    expect(speech.last().stop).toHaveBeenCalledTimes(1);
  });

  it("unmount is a safe no-op when nothing is running", () => {
    installSpeech("standard");
    const host = renderHook(() => useSpeech(() => {}));

    expect(() => host.unmount()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// onresult — trim boundary details (outer-only trim; combined-guard; empty).
// These pin that the guard + delivery operate on the FULL concatenation and that
// only the OUTER whitespace is stripped (internal whitespace is preserved).
// ---------------------------------------------------------------------------

describe("useSpeech — onresult trim boundary", () => {
  it("strips only the OUTER whitespace, preserving whitespace INSIDE the transcript", () => {
    const onText = vi.fn();
    const speech = installSpeech("standard");
    const host = renderHook(() => useSpeech(onText));
    host.latest.start();

    // Leading/trailing spaces removed; the three interior spaces stay intact.
    speech.last().onresult!(resultEvent(["  keep   internal  "]));

    expect(onText).toHaveBeenCalledTimes(1);
    expect(onText).toHaveBeenCalledWith("keep   internal");
  });

  it("evaluates the guard against the COMBINED transcript — leading/trailing blank chunks don't block content", () => {
    const onText = vi.fn();
    const speech = installSpeech("standard");
    const host = renderHook(() => useSpeech(onText));
    host.latest.start();

    // "   " + "hello" + "   " -> "   hello   " -> trimmed "hello"; a blank first
    // chunk must NOT short-circuit the guard.
    speech.last().onresult!(resultEvent(["   ", "hello", "   "]));

    expect(onText).toHaveBeenCalledTimes(1);
    expect(onText).toHaveBeenCalledWith("hello");
  });

  it("keeps a single interior space between two content chunks (raw concatenation, no join separator)", () => {
    const onText = vi.fn();
    const speech = installSpeech("standard");
    const host = renderHook(() => useSpeech(onText));
    host.latest.start();

    // Concatenation adds NO separator: "one" + "two" -> "onetwo" (not "one two").
    speech.last().onresult!(resultEvent(["one", "two"]));

    expect(onText).toHaveBeenCalledWith("onetwo");
  });

  it("does NOT call onText when the sole result is an empty string (guard falsy on \"\")", () => {
    const onText = vi.fn();
    const speech = installSpeech("standard");
    const host = renderHook(() => useSpeech(onText));
    host.latest.start();

    speech.last().onresult!(resultEvent([""]));

    expect(onText).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// State stickiness across sessions — start() clears NEITHER recRef-via-stop NOR
// the denied flag. Pins that only onend/onerror flip listening false, and that
// denied is never reset by the hook (a fresh start does not silently clear it).
// ---------------------------------------------------------------------------

describe("useSpeech — session state stickiness", () => {
  it("stop() calls the instance's stop() but does NOT clear recRef — so listening stays true until onend fires", () => {
    const speech = installSpeech("standard");
    const host = renderHook(() => useSpeech(() => {}));
    host.latest.start();

    host.latest.stop();

    // stop() forwards to the instance but leaves recRef live and listening true —
    // the browser reports the real end asynchronously through onend.
    expect(speech.last().stop).toHaveBeenCalledTimes(1);
    expect(host.latest.listening).toBe(true);
  });

  it("a second start() after stop() (before onend) is ignored — recRef still set, no new instance", () => {
    const speech = installSpeech("standard");
    const host = renderHook(() => useSpeech(() => {}));
    host.latest.start();
    host.latest.stop(); // does not clear recRef

    host.latest.start(); // recRef still set -> early return

    expect(speech.instances).toHaveLength(1);
    expect(speech.last().start).toHaveBeenCalledTimes(1);
    expect(host.latest.listening).toBe(true);
  });

  it("denied stays true after a fresh start() — the hook never resets the permission flag", () => {
    const speech = installSpeech("standard");
    const host = renderHook(() => useSpeech(() => {}));
    host.latest.start();
    speech.last().onerror!({ error: "not-allowed" }); // denied -> true, recRef cleared
    expect(host.latest.denied).toBe(true);

    host.latest.start(); // fresh session

    expect(speech.instances).toHaveLength(2);
    expect(host.latest.listening).toBe(true);
    expect(host.latest.denied).toBe(true); // sticky — not silently cleared by start()
  });
});
