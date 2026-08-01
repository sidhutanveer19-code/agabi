import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TeachEvent, TeachRequest, TeachContext } from "@contract";

/**
 * useTeaching — the hook that turns the backend `/teach` async event stream into
 * append-only blocks in the workspace store while driving status/error/outcome and
 * the camera focus. This is the presentation-layer orchestrator; it generates
 * nothing itself (frontend law), so every branch is about how it REACTS to the
 * stream, the abort/supersede lifecycle, and the student-facing error/outcome state.
 *
 * WHY this can be a real node unit test (no jsdom / react-dom):
 *   - The only genuine I/O edges are (a) `provider.teach` (NDJSON network stream) and
 *     (b) `eventBus.emit` (observation → network). Per §H1.7 those are the narrowest
 *     external calls, so they are the ONLY things mocked — via a fully controllable
 *     async generator and a spy, both asserted for exact arguments.
 *   - Everything else runs FOR REAL: the real zustand `useWorkspaceStore`, the real
 *     `useTeachingContext`, the real `openRegion`/`addStreamedBlock` layout seam.
 *   - React's four hooks (`useRef/useState/useCallback/useEffect`) are re-implemented
 *     FAITHFULLY by a tiny host below (stable setters/refs, Object.is bailout, deps
 *     memoisation, post-commit effects with dep-change re-runs). React is infra, not
 *     the logic under test — the REAL `useTeaching` source executes, so the Stryker
 *     mutation gate (which mutates the source, never this harness) still bites.
 *
 * Every assertion names an EXACT value/id/geometry the hook must produce — never
 * "it ran". Branches covered are enumerated per-describe.
 */

// ─── hoisted holders (referenced inside vi.mock factories, so must be hoisted) ───
const mocks = vi.hoisted(() => ({
  teach: vi.fn(),
  emit: vi.fn(),
  // The current React-hook host the mocked hooks delegate to (set by mount()).
  host: { current: null as HookHost | null },
}));

// Mock the true I/O edges only.
vi.mock("@/features/platform/providers", () => ({
  teachingProvider: { teach: mocks.teach },
  workspacePersistence: {},
}));
vi.mock("@/features/platform/events/eventBus", () => ({
  eventBus: { emit: mocks.emit },
}));

// Faithful minimal React: keep everything real, override ONLY the four hooks
// useTeaching consumes, delegating them to the active HookHost.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useRef: (init: unknown) => mocks.host.current!.useRef(init),
    useState: (init: unknown) => mocks.host.current!.useState(init),
    useCallback: (fn: unknown, deps: unknown[]) => mocks.host.current!.useCallback(fn, deps),
    useEffect: (fn: () => void | (() => void), deps: unknown[] | undefined) =>
      mocks.host.current!.useEffect(fn, deps),
  };
});

// Real modules under test (imported AFTER the mocks are registered).
import { useTeaching } from "@/features/workspace/ai/useTeaching";
import { useWorkspaceStore, emptyDoc } from "@/features/workspace/stores/workspace.store";
import { useTeachingContext } from "@/features/workspace/ai/context";

// ─────────────────────────── the tiny faithful React ───────────────────────────

type Slot =
  | { current: unknown }
  | { value: unknown; setter: (v: unknown) => void }
  | { fn: unknown; deps: unknown[] }
  | { deps: unknown[] | undefined; cleanup: (() => void) | undefined };

function depsEqual(a: unknown[] | undefined, b: unknown[] | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  return a.every((x, i) => Object.is(x, b[i]));
}

class HookHost {
  private slots: Slot[] = [];
  private idx = 0;
  private effectQueue: { slot: number; fn: () => void | (() => void); deps: unknown[] | undefined }[] = [];
  renderFn: () => unknown = () => undefined;
  result: unknown;

  useRef(init: unknown): { current: unknown } {
    const i = this.idx++;
    if (this.slots[i] === undefined) this.slots[i] = { current: init };
    return this.slots[i] as { current: unknown };
  }

  useState(init: unknown): [unknown, (v: unknown) => void] {
    const i = this.idx++;
    if (this.slots[i] === undefined) {
      const value = typeof init === "function" ? (init as () => unknown)() : init;
      const setter = (v: unknown) => {
        const s = this.slots[i] as { value: unknown; setter: (v: unknown) => void };
        const next = typeof v === "function" ? (v as (p: unknown) => unknown)(s.value) : v;
        if (!Object.is(next, s.value)) {
          s.value = next;
          this.render(); // synchronous re-render, exactly what a committed setState triggers
        }
      };
      this.slots[i] = { value, setter };
    }
    const s = this.slots[i] as { value: unknown; setter: (v: unknown) => void };
    return [s.value, s.setter];
  }

  useCallback(fn: unknown, deps: unknown[]): unknown {
    const i = this.idx++;
    const prev = this.slots[i] as { fn: unknown; deps: unknown[] } | undefined;
    if (!prev || !depsEqual(prev.deps, deps)) this.slots[i] = { fn, deps };
    return (this.slots[i] as { fn: unknown }).fn;
  }

  useEffect(fn: () => void | (() => void), deps: unknown[] | undefined): void {
    const i = this.idx++;
    const prev = this.slots[i] as { deps: unknown[] | undefined; cleanup: (() => void) | undefined } | undefined;
    if (!prev) {
      this.slots[i] = { deps, cleanup: undefined };
      this.effectQueue.push({ slot: i, fn, deps });
    } else if (!depsEqual(prev.deps, deps)) {
      prev.deps = deps;
      this.effectQueue.push({ slot: i, fn, deps });
    }
  }

  render(): unknown {
    this.idx = 0;
    this.result = this.renderFn();
    const queued = this.effectQueue;
    this.effectQueue = [];
    for (const e of queued) {
      const s = this.slots[e.slot] as { deps: unknown[] | undefined; cleanup: (() => void) | undefined };
      if (s.cleanup) s.cleanup();
      const cleanup = e.fn();
      s.cleanup = typeof cleanup === "function" ? cleanup : undefined;
    }
    return this.result;
  }
}

// ─────────────────────────────── test harness ──────────────────────────────────

type TeachOpts = { canvasId: string; onFocusRegion: (regionId: string) => void };
type Api = ReturnType<typeof useTeaching>;

interface Mounted {
  readonly result: Api;
  rerender(opts: TeachOpts): void;
}

function mount(initial: TeachOpts): Mounted {
  const host = new HookHost();
  mocks.host.current = host;
  let opts = initial;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- deliberate: React is mocked; the hook is invoked in this test harness
  host.renderFn = () => useTeaching(opts);
  host.render();
  return {
    get result() {
      return host.result as Api;
    },
    rerender(next: TeachOpts) {
      opts = next;
      host.render();
    },
  };
}

/** Drains the entire microtask chain of a run() (all yields resolve synchronously). */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

interface TeachCall {
  req: TeachRequest;
  context: TeachContext;
  signal: AbortSignal;
  canvasId: string;
}

type StreamFactory = (signal: AbortSignal) => AsyncIterable<TeachEvent>;

/** Program the provider: one factory per teach() call (last one clamps/repeats). */
function program(...factories: StreamFactory[]): TeachCall[] {
  const calls: TeachCall[] = [];
  let i = 0;
  mocks.teach.mockImplementation(
    (req: TeachRequest, context: TeachContext, signal: AbortSignal, canvasId: string) => {
      calls.push({ req, context, signal, canvasId });
      const f = factories[Math.min(i, factories.length - 1)];
      i += 1;
      return f(signal);
    }
  );
  return calls;
}

const sync = (events: TeachEvent[]): StreamFactory => () =>
  (async function* () {
    for (const e of events) yield e;
  })();

const throwing = (err: unknown): StreamFactory => () =>
  (async function* () {
    throw err;
     
    yield undefined as unknown as TeachEvent;
  })();

/** Yields `pre`, then blocks forever until its signal aborts (then throws). */
const abortable = (pre: TeachEvent[]): StreamFactory => (signal) =>
  (async function* () {
    for (const e of pre) yield e;
    await new Promise<void>((_resolve, reject) => {
      if (signal.aborted) reject(new Error("aborted"));
      else signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  })();

function regions() {
  return useWorkspaceStore.getState().doc.regions;
}
function focus() {
  return vi.fn();
}

beforeEach(() => {
  mocks.teach.mockReset();
  mocks.emit.mockReset();
  mocks.host.current = null;
  useWorkspaceStore.setState({ doc: emptyDoc() });
  useTeachingContext.getState().reset();
});

// ────────────────────────────────── tests ──────────────────────────────────────

describe("useTeaching — initial state + returned surface", () => {
  it("mounts idle/not-streaming with no error/outcome and exposes the exact action set", () => {
    const api = mount({ canvasId: "cv", onFocusRegion: focus() }).result;

    expect(api.status).toBe("idle");
    expect(api.streaming).toBe(false);
    expect(api.error).toBeNull();
    expect(api.outcome).toBeNull();

    // The full public shape — a mutant that drops any field is caught here.
    expect(Object.keys(api).sort()).toEqual(
      [
        "status",
        "streaming",
        "error",
        "outcome",
        "startLesson",
        "sendCommand",
        "ask",
        "cancel",
        "retry",
        "dismissError",
        "dismissOutcome",
      ].sort()
    );
    for (const fn of ["startLesson", "sendCommand", "ask", "cancel", "retry", "dismissError", "dismissOutcome"]) {
      expect(typeof (api as unknown as Record<string, unknown>)[fn]).toBe("function");
    }
  });
});

describe("useTeaching — startLesson happy path (status·region·block·patch·outcome·done·finally)", () => {
  it("threads the full stream into the store, focuses the region, and reports the outcome", async () => {
    // Pre-seed conversation context: proves `context` is read from the store at run
    // start and is SEPARATE from the per-request topic argument.
    const preExp = { regionId: "pre", title: "Prior", kind: "concept" };
    useTeachingContext.getState().setTopic("Bio");
    useTeachingContext.getState().addExplanation(preExp);
    useTeachingContext.getState().setSelected("sel-1");

    const onFocus = vi.fn();
    const calls = program(
      sync([
        { t: "status", status: "planning" },
        { t: "status", status: "generating" }, // last-wins
        { t: "region", title: "Photosynthesis" },
        { t: "block", block: { type: "paragraph", data: { text: "sun → sugar" } } },
        { t: "block", block: { type: "heading", data: { level: 2 } } },
        { t: "patch", index: 0, data: { text: "PATCHED" } },
        { t: "outcome", outcome: "COMPLETE", failedIndices: [], plannedCount: 2, readyCount: 2 },
        { t: "done" },
      ])
    );

    const m = mount({ canvasId: "cv-1", onFocusRegion: onFocus });
    m.result.startLesson("Photosynthesis");
    await settle();

    // provider.teach invoked once with the exact request/context/canvasId.
    expect(mocks.teach).toHaveBeenCalledTimes(1);
    expect(calls[0].req).toEqual({ kind: "lesson", topic: "Photosynthesis" });
    expect(calls[0].context).toEqual({ topic: "Bio", explanations: [preExp], selectedRegionId: "sel-1" });
    expect(calls[0].canvasId).toBe("cv-1");
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
    expect(calls[0].signal.aborted).toBe(false);

    // Observation events emitted at start and on done, with exact payloads.
    expect(mocks.emit).toHaveBeenCalledWith("lesson_started", {
      topic: "Photosynthesis",
      command: undefined,
      text: undefined,
    });
    expect(mocks.emit).toHaveBeenCalledWith("lesson_completed", { topic: "Photosynthesis" });

    // State: last status, outcome object (exact), streaming ended false.
    expect(m.result.status).toBe("generating");
    expect(m.result.outcome).toEqual({
      outcome: "COMPLETE",
      failedIndices: [],
      plannedCount: 2,
      readyCount: 2,
    });
    expect(m.result.error).toBeNull();
    expect(m.result.streaming).toBe(false);

    // Store: one region titled Photosynthesis with two blocks; block 0 patched.
    const rs = regions();
    expect(rs).toHaveLength(1);
    const region = rs[0];
    expect(region.title).toBe("Photosynthesis");
    expect(region.blocks).toHaveLength(2);
    expect(region.blocks[0].type).toBe("paragraph");
    expect(region.blocks[0].data).toEqual({ text: "PATCHED" }); // patch applied to block index 0
    expect(region.blocks[1].type).toBe("heading");
    expect(region.blocks[1].data).toEqual({ level: 2 });
    // Cursor is reset to PAD on region-open then threaded across blocks: block 0 at
    // y=PAD(26), block 1 at y = 26 + paragraph-height(104) + GAP(16) = 146. Locks the
    // `cursor = PAD` reset and the `cursor = nextCursor` threading.
    expect(region.blocks[0].position).toEqual({ x: 26, y: 26 });
    expect(region.blocks[1].position).toEqual({ x: 26, y: 146 });

    // Camera flew to the new region id exactly once.
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledWith(region.id);

    // Conversation context appended the new explanation with kind = req.kind.
    expect(useTeachingContext.getState().explanations).toEqual([
      preExp,
      { regionId: region.id, title: "Photosynthesis", kind: "lesson" },
    ]);
  });
});

describe("useTeaching — status event in isolation", () => {
  it("sets status to the exact value carried by the event", async () => {
    program(sync([{ t: "status", status: "visualizing" }]));
    const m = mount({ canvasId: "cv", onFocusRegion: focus() });
    m.result.startLesson("T");
    await settle();
    expect(m.result.status).toBe("visualizing");
  });
});

describe("useTeaching — block before any region is dropped (regionId falsy branch)", () => {
  it("ignores a block that arrives with no open region and creates nothing", async () => {
    const onFocus = vi.fn();
    program(sync([{ t: "block", block: { type: "paragraph", data: { text: "orphan" } } }]));
    const m = mount({ canvasId: "cv", onFocusRegion: onFocus });
    m.result.startLesson("T");
    await settle();

    expect(regions()).toHaveLength(0);
    expect(onFocus).not.toHaveBeenCalled();
    expect(m.result.error).toBeNull();
    expect(m.result.streaming).toBe(false);
  });
});

describe("useTeaching — patch branches", () => {
  it("a patch with no open region is a no-op (outer regionId branch false)", async () => {
    program(sync([{ t: "patch", index: 0, data: { x: 1 } }]));
    const m = mount({ canvasId: "cv", onFocusRegion: focus() });
    m.result.startLesson("T");
    await settle();
    expect(regions()).toHaveLength(0);
    expect(m.result.error).toBeNull();
  });

  it("a patch whose index has no block id is a no-op (inner `if (bid)` false), block untouched", async () => {
    program(
      sync([
        { t: "region", title: "R" },
        { t: "block", block: { type: "paragraph", data: { text: "keep" } } },
        { t: "patch", index: 5, data: { text: "should-not-apply" } }, // out of range
      ])
    );
    const m = mount({ canvasId: "cv", onFocusRegion: focus() });
    m.result.startLesson("T");
    await settle();

    const region = regions()[0];
    expect(region.blocks).toHaveLength(1);
    expect(region.blocks[0].data).toEqual({ text: "keep" }); // unchanged
  });
});

describe("useTeaching — recoverable error keeps the stream going", () => {
  it("surfaces the recoverable error yet still processes subsequent events", async () => {
    program(
      sync([
        { t: "region", title: "R" },
        { t: "error", recoverable: true, message: "hiccup" },
        { t: "block", block: { type: "paragraph", data: { text: "after" } } },
      ])
    );
    const m = mount({ canvasId: "cv", onFocusRegion: focus() });
    m.result.startLesson("T");
    await settle();

    expect(m.result.error).toEqual({ recoverable: true, message: "hiccup" });
    // Loop continued → the block after the error was still appended.
    expect(regions()[0].blocks).toHaveLength(1);
    expect(regions()[0].blocks[0].data).toEqual({ text: "after" });
    expect(m.result.streaming).toBe(false); // normal loop completion
  });
});

describe("useTeaching — fatal error stops the stream", () => {
  it("sets the error, stops streaming, and processes nothing after the fatal event", async () => {
    program(
      sync([
        { t: "region", title: "R" },
        { t: "error", recoverable: false, message: "fatal" },
        { t: "block", block: { type: "paragraph", data: { text: "never" } } },
      ])
    );
    const m = mount({ canvasId: "cv", onFocusRegion: focus() });
    m.result.startLesson("T");
    await settle();

    expect(m.result.error).toEqual({ recoverable: false, message: "fatal" });
    expect(m.result.streaming).toBe(false);
    // `return` fired before the trailing block → region exists but stays empty.
    expect(regions()).toHaveLength(1);
    expect(regions()[0].blocks).toHaveLength(0);
    expect(m.result.outcome).toBeNull();
  });
});

describe("useTeaching — outcome event surfaces PARTIAL/FAILED honestly", () => {
  it("stores the outcome object exactly as received", async () => {
    program(
      sync([
        { t: "outcome", outcome: "PARTIAL", failedIndices: [1, 3], plannedCount: 4, readyCount: 2 },
      ])
    );
    const m = mount({ canvasId: "cv", onFocusRegion: focus() });
    m.result.startLesson("T");
    await settle();
    expect(m.result.outcome).toEqual({
      outcome: "PARTIAL",
      failedIndices: [1, 3],
      plannedCount: 4,
      readyCount: 2,
    });
  });
});

describe("useTeaching — thrown stream is caught (catch branch)", () => {
  it("an Error thrown by the stream becomes a recoverable error with its message", async () => {
    program(throwing(new Error("boom")));
    const m = mount({ canvasId: "cv", onFocusRegion: focus() });
    m.result.startLesson("T");
    await settle();
    expect(m.result.error).toEqual({ recoverable: true, message: "boom" });
    expect(m.result.streaming).toBe(false);
  });

  it("a non-Error throw falls back to the generic message", async () => {
    program(throwing("weird string reject"));
    const m = mount({ canvasId: "cv", onFocusRegion: focus() });
    m.result.startLesson("T");
    await settle();
    expect(m.result.error).toEqual({
      recoverable: true,
      message: "Something interrupted the lesson.",
    });
  });
});

describe("useTeaching — sendCommand / ask derive topic from the context store", () => {
  it("sendCommand issues a command request with the current context topic", async () => {
    useTeachingContext.getState().setTopic("Algebra");
    const calls = program(sync([{ t: "done" }]));
    const m = mount({ canvasId: "cv", onFocusRegion: focus() });
    m.result.sendCommand("zoom in");
    await settle();

    expect(calls[0].req).toEqual({ kind: "command", topic: "Algebra", command: "zoom in" });
    expect(mocks.emit).toHaveBeenCalledWith("command", {
      topic: "Algebra",
      command: "zoom in",
      text: undefined,
    });
  });

  it("ask issues a question request with the current context topic", async () => {
    useTeachingContext.getState().setTopic("Cells");
    const calls = program(sync([{ t: "done" }]));
    const m = mount({ canvasId: "cv", onFocusRegion: focus() });
    m.result.ask("why mitosis?");
    await settle();

    expect(calls[0].req).toEqual({ kind: "question", topic: "Cells", text: "why mitosis?" });
    expect(mocks.emit).toHaveBeenCalledWith("question", {
      topic: "Cells",
      command: undefined,
      text: "why mitosis?",
    });
  });
});

describe("useTeaching — cancel", () => {
  it("after a run, cancel aborts the live controller and forces cancelled/idle streaming off", async () => {
    const calls = program(sync([{ t: "status", status: "generating" }, { t: "done" }]));
    const m = mount({ canvasId: "cv", onFocusRegion: focus() });
    m.result.startLesson("T");
    await settle();
    expect(calls[0].signal.aborted).toBe(false);

    m.result.cancel();

    expect(calls[0].signal.aborted).toBe(true); // acRef.current?.abort() hit the non-null branch
    expect(m.result.status).toBe("cancelled");
    expect(m.result.streaming).toBe(false);
  });

  it("cancel before any run is a safe no-op on the null controller and still sets cancelled", () => {
    program(sync([{ t: "done" }]));
    const m = mount({ canvasId: "cv", onFocusRegion: focus() });

    expect(() => m.result.cancel()).not.toThrow(); // acRef.current is null → optional-chain no-op

    expect(mocks.teach).not.toHaveBeenCalled();
    expect(m.result.status).toBe("cancelled");
    expect(m.result.streaming).toBe(false);
  });
});

describe("useTeaching — retry", () => {
  it("retry before any run does nothing (lastReqRef null branch)", () => {
    program(sync([{ t: "done" }]));
    const m = mount({ canvasId: "cv", onFocusRegion: focus() });
    m.result.retry();
    expect(mocks.teach).not.toHaveBeenCalled();
    expect(m.result.status).toBe("idle");
  });

  it("retry re-runs the exact last request", async () => {
    useTeachingContext.getState().setTopic("Trig");
    const calls = program(sync([{ t: "done" }]));
    const m = mount({ canvasId: "cv", onFocusRegion: focus() });

    m.result.ask("prove it");
    await settle();
    expect(mocks.teach).toHaveBeenCalledTimes(1);

    m.result.retry();
    await settle();

    expect(mocks.teach).toHaveBeenCalledTimes(2);
    expect(calls[1].req).toEqual({ kind: "question", topic: "Trig", text: "prove it" });
  });
});

describe("useTeaching — dismissError / dismissOutcome", () => {
  it("dismissError clears a surfaced error back to null", async () => {
    program(sync([{ t: "error", recoverable: true, message: "temp" }]));
    const m = mount({ canvasId: "cv", onFocusRegion: focus() });
    m.result.startLesson("T");
    await settle();
    expect(m.result.error).toEqual({ recoverable: true, message: "temp" });

    m.result.dismissError();
    expect(m.result.error).toBeNull();
  });

  it("dismissOutcome clears a surfaced outcome back to null", async () => {
    program(sync([{ t: "outcome", outcome: "FAILED", failedIndices: [0], plannedCount: 1, readyCount: 0 }]));
    const m = mount({ canvasId: "cv", onFocusRegion: focus() });
    m.result.startLesson("T");
    await settle();
    expect(m.result.outcome).not.toBeNull();

    m.result.dismissOutcome();
    expect(m.result.outcome).toBeNull();
  });
});

describe("useTeaching — supersede: a new run aborts the in-flight one", () => {
  it("the second run aborts the first; the first's finally does NOT reset streaming and its abort sets no error", async () => {
    const calls = program(
      abortable([{ t: "status", status: "thinking" }]), // run 1: parks until aborted
      sync([{ t: "status", status: "finished" }, { t: "done" }]) // run 2: completes
    );
    const m = mount({ canvasId: "cv", onFocusRegion: focus() });

    // Run 1 is mid-flight: streaming true, status from its first event.
    m.result.startLesson("first");
    await settle();
    expect(m.result.streaming).toBe(true);
    expect(m.result.status).toBe("thinking");
    expect(calls[0].signal.aborted).toBe(false);

    // Run 2 supersedes → aborts run 1's controller (non-null abort branch).
    m.result.startLesson("second");
    await settle();

    expect(mocks.teach).toHaveBeenCalledTimes(2);
    expect(calls[0].signal.aborted).toBe(true); // run 1 was aborted
    expect(calls[1].signal.aborted).toBe(false); // run 2 owns the live controller

    // Run 1 threw via abort but signal.aborted → no error surfaced.
    expect(m.result.error).toBeNull();
    // Run 2 controls the final state (its finally set streaming false; last status wins).
    expect(m.result.status).toBe("finished");
    expect(m.result.streaming).toBe(false);
  });

  it("a superseded run's finally must NOT switch streaming off while the newer run is still live", async () => {
    // Both runs park. When run 2 aborts run 1, run 1's finally checks
    // `acRef.current === ac` — which is FALSE (acRef now holds run 2) — so it must
    // leave streaming ON. A mutant that drops that guard would wrongly kill streaming.
    const calls = program(
      abortable([{ t: "status", status: "thinking" }]),
      abortable([{ t: "status", status: "planning" }])
    );
    const m = mount({ canvasId: "cv", onFocusRegion: focus() });

    m.result.startLesson("first");
    await settle();
    expect(m.result.streaming).toBe(true);

    m.result.startLesson("second"); // aborts run 1; run 2 stays parked (live)
    await settle();

    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[1].signal.aborted).toBe(false);
    // Run 1's finally was correctly skipped → streaming remains ON for the live run 2.
    expect(m.result.streaming).toBe(true);
    expect(m.result.status).toBe("planning");
    expect(m.result.error).toBeNull();

    // Clean up the parked run 2 so no controller is left dangling.
    m.result.cancel();
    await settle();
    expect(calls[1].signal.aborted).toBe(true);
    expect(m.result.streaming).toBe(false);
  });
});

describe("useTeaching — effects keep canvasId and onFocusRegion refs current", () => {
  it("a re-render with a new canvasId is reflected in the next teach() call (canvasId effect)", async () => {
    const calls = program(sync([{ t: "done" }]));
    const m = mount({ canvasId: "cv-A", onFocusRegion: focus() });

    m.result.startLesson("a");
    await settle();
    expect(calls[0].canvasId).toBe("cv-A");

    m.rerender({ canvasId: "cv-B", onFocusRegion: focus() }); // effect updates canvasIdRef
    m.result.startLesson("b");
    await settle();
    expect(calls[1].canvasId).toBe("cv-B");
  });

  it("a re-render with a new onFocusRegion routes focus to the latest callback (focus effect)", async () => {
    const focusA = vi.fn();
    const focusB = vi.fn();
    program(sync([{ t: "region", title: "R" }]));
    const m = mount({ canvasId: "cv", onFocusRegion: focusA });

    m.rerender({ canvasId: "cv", onFocusRegion: focusB }); // effect updates focusRef

    m.result.startLesson("t");
    await settle();

    const region = regions()[0];
    expect(focusB).toHaveBeenCalledWith(region.id);
    expect(focusA).not.toHaveBeenCalled();
  });
});
