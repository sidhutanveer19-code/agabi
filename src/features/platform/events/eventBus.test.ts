import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { StudentEvent } from "@contract";

/**
 * eventBus — the best-effort observation batcher.
 * The only I/O edges are faked: `eventService.send` (the HTTP sink), the clock/timer
 * (`vi.useFakeTimers` drives Date.now + setTimeout), and — because this is a browser
 * module running in the `node` test env — the `window`/`document` globals for the
 * visibility-flush branch. Everything else is the module's OWN logic, asserted by
 * REAL RESULT (the exact batch handed to send), never "it ran".
 *
 * Branches covered:
 *   emit:     HAS_BACKEND false → total no-op · true → enqueue ·
 *             queue.length >= MAX_BATCH → immediate flush · below → schedule ·
 *             workspaceId/payload omitted → undefined in the event
 *   schedule: first emit sets the timer (!timer true) · later emits reuse it (!timer false)
 *   flush:    timer set → cleared (if timer true) · timer null (if timer false) ·
 *             empty queue → early return · send resolves → queue drained ·
 *             send REJECTS → swallowed, queue still drained
 *   module:   typeof window !== "undefined" true (stubbed) + false (node default) ·
 *             visibilitychange handler: hidden → flush · not-hidden → no flush
 */

const FAKE_NOW = 1_700_000_000_000;
const FLUSH_MS = 4000;
const MAX_BATCH = 20;

// Mutable HAS_BACKEND, read through a getter so each emit() sees the current value.
const cfg = vi.hoisted(() => ({ HAS_BACKEND: true }));
vi.mock("@/features/platform/config", () => ({
  get HAS_BACKEND() {
    return cfg.HAS_BACKEND;
  },
}));

// The single faked I/O edge: the network sink.
const h = vi.hoisted(() => ({
  send: vi.fn(async (_events: StudentEvent[]): Promise<void> => {}),
}));
vi.mock("@/features/platform/services/eventService", () => ({
  eventService: { send: (events: StudentEvent[]) => h.send(events) },
}));

// Captured browser globals for the visibility-flush branch.
let winListeners: Record<string, Array<() => void>> = {};
let doc: { visibilityState: string };

function fireVisibilityChange(): void {
  for (const cb of winListeners.visibilitychange ?? []) cb();
}

/** Advance 0ms under fake timers → flush pending microtasks (settles the async flush). */
async function tick(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

/** Fresh module (pristine queue/timer) with a chosen HAS_BACKEND and optional browser globals. */
async function loadBus(opts: { hasBackend?: boolean; withWindow?: boolean } = {}) {
  const { hasBackend = true, withWindow = false } = opts;
  vi.resetModules();
  cfg.HAS_BACKEND = hasBackend;
  if (withWindow) {
    winListeners = {};
    doc = { visibilityState: "visible" };
    vi.stubGlobal("window", {
      addEventListener: (type: string, cb: () => void) => {
        (winListeners[type] ??= []).push(cb);
      },
    });
    vi.stubGlobal("document", doc);
  }
  const mod = await import("@/features/platform/events/eventBus");
  return mod.eventBus;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FAKE_NOW));
  h.send.mockReset();
  h.send.mockImplementation(async () => {});
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("eventBus.emit — HAS_BACKEND gate", () => {
  it("HAS_BACKEND false → total no-op: nothing enqueued, no send even past batch + timer", async () => {
    const bus = await loadBus({ hasBackend: false });
    for (let i = 0; i < MAX_BATCH + 5; i++) bus.emit("topic_opened", { i });
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    expect(h.send).not.toHaveBeenCalled();
  });
});

describe("eventBus.emit — enqueue + scheduled flush", () => {
  it("one emit → NOT sent before FLUSH_MS, then flushed with the EXACT event at FLUSH_MS", async () => {
    const bus = await loadBus();
    bus.emit("lesson_started", { a: 1 }, "ws1");

    await vi.advanceTimersByTimeAsync(FLUSH_MS - 1);
    expect(h.send).not.toHaveBeenCalled(); // scheduled, not immediate

    await vi.advanceTimersByTimeAsync(1); // crosses the 4000ms boundary
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls[0][0]).toEqual([
      { type: "lesson_started", ts: FAKE_NOW, workspaceId: "ws1", payload: { a: 1 } },
    ]);
  });

  it("omitted workspaceId + payload → both present as undefined in the event", async () => {
    const bus = await loadBus();
    bus.emit("pan");
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    expect(h.send.mock.calls[0][0]).toEqual([
      { type: "pan", ts: FAKE_NOW, workspaceId: undefined, payload: undefined },
    ]);
  });

  it("many emits below MAX_BATCH coalesce into ONE flush (schedule reuses the timer)", async () => {
    const bus = await loadBus();
    bus.emit("a");
    bus.emit("b");
    bus.emit("c");

    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    expect(h.send).toHaveBeenCalledTimes(1); // one timer, one batch — not three
    expect(h.send.mock.calls[0][0]).toEqual([
      { type: "a", ts: FAKE_NOW, workspaceId: undefined, payload: undefined },
      { type: "b", ts: FAKE_NOW, workspaceId: undefined, payload: undefined },
      { type: "c", ts: FAKE_NOW, workspaceId: undefined, payload: undefined },
    ]);
  });
});

describe("eventBus.emit — MAX_BATCH immediate flush", () => {
  it("the 20th emit flushes immediately WITHOUT waiting for the timer; 21st re-schedules", async () => {
    const bus = await loadBus();
    for (let i = 0; i < MAX_BATCH; i++) bus.emit("evt", { i });
    await tick(); // settle the immediate flush's async send

    expect(h.send).toHaveBeenCalledTimes(1);
    const batch = h.send.mock.calls[0][0];
    expect(batch).toHaveLength(20);
    expect(batch[0]).toEqual({ type: "evt", ts: FAKE_NOW, workspaceId: undefined, payload: { i: 0 } });
    expect(batch[19]).toEqual({ type: "evt", ts: FAKE_NOW, workspaceId: undefined, payload: { i: 19 } });

    // queue was drained → the next emit starts a fresh batch flushed by the timer
    bus.emit("after");
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    expect(h.send).toHaveBeenCalledTimes(2);
    expect(h.send.mock.calls[1][0]).toEqual([
      { type: "after", ts: FAKE_NOW, workspaceId: undefined, payload: undefined },
    ]);
  });
});

describe("eventBus — flush failure is swallowed and the queue is still drained", () => {
  it("send REJECTS → no throw, and the failed batch is NOT resurrected on the next flush", async () => {
    const bus = await loadBus();
    h.send.mockRejectedValueOnce(new Error("network down"));

    bus.emit("q1");
    await vi.advanceTimersByTimeAsync(FLUSH_MS); // flush #1 rejects, swallowed
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls[0][0]).toEqual([
      { type: "q1", ts: FAKE_NOW, workspaceId: undefined, payload: undefined },
    ]);

    // flush #1 advanced the fake clock by FLUSH_MS, so q2 is emitted at that later instant —
    // its ts is emit-time, not flush-time. Assert that exact value.
    bus.emit("q2");
    await vi.advanceTimersByTimeAsync(FLUSH_MS); // flush #2 sees ONLY q2 (q1 was cleared pre-send)
    expect(h.send).toHaveBeenCalledTimes(2);
    expect(h.send.mock.calls[1][0]).toEqual([
      { type: "q2", ts: FAKE_NOW + FLUSH_MS, workspaceId: undefined, payload: undefined },
    ]);
  });
});

describe("eventBus — window visibilitychange flush", () => {
  it("hidden → flushes the trailing queue WITHOUT the timer firing", async () => {
    const bus = await loadBus({ withWindow: true });
    bus.emit("e1");
    bus.emit("e2");

    doc.visibilityState = "hidden";
    fireVisibilityChange();
    await tick();

    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls[0][0]).toEqual([
      { type: "e1", ts: FAKE_NOW, workspaceId: undefined, payload: undefined },
      { type: "e2", ts: FAKE_NOW, workspaceId: undefined, payload: undefined },
    ]);
  });

  it("visible (not hidden) → NO flush; the still-pending timer flushes later", async () => {
    const bus = await loadBus({ withWindow: true });
    bus.emit("e1");

    doc.visibilityState = "visible";
    fireVisibilityChange();
    await tick();
    expect(h.send).not.toHaveBeenCalled(); // the === "hidden" guard blocked it

    await vi.advanceTimersByTimeAsync(FLUSH_MS); // scheduled timer still fires
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls[0][0]).toEqual([
      { type: "e1", ts: FAKE_NOW, workspaceId: undefined, payload: undefined },
    ]);
  });

  it("hidden with an EMPTY queue → flush early-returns (timer null, no send)", async () => {
    await loadBus({ withWindow: true });
    doc.visibilityState = "hidden";
    fireVisibilityChange(); // flush(): if(timer) false, queue empty → return
    await tick();
    expect(h.send).not.toHaveBeenCalled();
  });
});
