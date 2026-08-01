import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Camera, WorkspaceDoc } from "@/features/workspace/types";
import { SCHEMA_VERSION } from "@/features/workspace/types";
import { DEFAULT_CAMERA } from "@/features/workspace/types/defaults";
import { useWorkspaceStore } from "@/features/workspace/stores/workspace.store";
import { useCameraStore } from "@/features/workspace/stores/camera.store";
import { useWorkspacePersistence } from "@/features/workspace/persistence/useWorkspacePersistence";

/**
 * useWorkspacePersistence — the autosave/restore effect that wires the workspace +
 * camera singleton stores to the persistence provider.
 *
 * The whole hook body lives inside one `useEffect`, so the ONLY things stubbed are
 * the two real I/O edges: (a) React's `useEffect` scheduling primitive — replaced by
 * a synchronous harness so the effect runs and its cleanup is captured (this is the
 * render boundary, not the module's own logic); (b) `workspacePersistence` — the
 * localStorage-backed provider (external I/O, §H1.7). Everything asserted below is the
 * hook's OWN logic exercised through the REAL zustand stores and the REAL `debounce`:
 *   - mount RESETS both singleton stores first (so a stale canvas never bleeds through)
 *   - restore applies a saved doc/camera (each independently) and fires onLoad(hadDoc)
 *   - a cleanup that runs BEFORE the restore promise resolves ABORTS it (active flag)
 *   - doc/camera changes autosave (debounced); an unchanged reference does NOT save
 *   - maxWait persists mid-stream under a continuous change stream (the data-loss bug)
 *   - visibilitychange→hidden / pagehide / unmount all FLUSH the pending save
 *   - cleanup unsubscribes + removes both listeners
 */

// Hoisted above the vi.mock factories: the persistence spies + a slot to capture the
// effect cleanup that our mocked useEffect returns.
const h = vi.hoisted(() => ({
  saveDoc: vi.fn(),
  loadDoc: vi.fn(),
  saveCamera: vi.fn(),
  loadCamera: vi.fn(),
  cleanup: { current: undefined as (() => void) | undefined },
}));

vi.mock("@/features/platform/providers", () => ({
  workspacePersistence: {
    saveDoc: h.saveDoc,
    loadDoc: h.loadDoc,
    saveCamera: h.saveCamera,
    loadCamera: h.loadCamera,
  },
}));

// Replace ONLY useEffect: run the effect body synchronously and capture its cleanup.
// (Keeps every other real react export — zustand's internals stay untouched.)
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => {
      const c = effect();
      h.cleanup.current = typeof c === "function" ? c : undefined;
    },
  };
});

// ---- a minimal fake window/document with an inspectable listener registry ----
type Handler = () => void;
function makeTarget() {
  const listeners = new Map<string, Set<Handler>>();
  return {
    listeners,
    addEventListener(type: string, handler: Handler) {
      const set = listeners.get(type) ?? new Set<Handler>();
      set.add(handler);
      listeners.set(type, set);
    },
    removeEventListener(type: string, handler: Handler) {
      listeners.get(type)?.delete(handler);
    },
    dispatch(type: string) {
      for (const handler of [...(listeners.get(type) ?? [])]) handler();
    },
    count(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

const glob = globalThis as unknown as { window?: unknown; document?: unknown };
let fakeWindow: ReturnType<typeof makeTarget>;
let fakeDocument: ReturnType<typeof makeTarget> & { visibilityState: string };

function installDom() {
  fakeWindow = makeTarget();
  fakeDocument = Object.assign(makeTarget(), { visibilityState: "visible" });
  glob.window = fakeWindow;
  glob.document = fakeDocument;
}
function uninstallDom() {
  delete glob.window;
  delete glob.document;
}

const WS_ID = "canvas-42";

/** Drive the hook once ("mount"); returns the captured cleanup. */
function mount(id: string = WS_ID, onLoad?: (hadDoc: boolean) => void): () => void {
  // Deliberately invoked as a plain function: `useEffect` is mocked (above) to run the
  // effect body synchronously, so there is no React renderer and no dispatcher to break.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useWorkspacePersistence(id, onLoad);
  const cleanup = h.cleanup.current;
  if (!cleanup) throw new Error("effect did not return a cleanup");
  return cleanup;
}

/** Flush pending microtasks so the restore `Promise.all(...).then` runs (timers are faked). */
async function flushRestore() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

function makeDoc(id = "ws_restored"): WorkspaceDoc {
  return {
    id,
    schemaVersion: SCHEMA_VERSION,
    topic: "photosynthesis",
    regions: [
      {
        id: "region_7",
        title: "Restored",
        position: { x: 5, y: 6 },
        size: { w: 320, h: 240 },
        blocks: [],
        createdAt: 1,
      },
    ],
    createdAt: 1,
    updatedAt: 2,
  };
}

const CAM_A: Camera = { x: 111, y: 222, scale: 2.5 };

beforeEach(() => {
  vi.useFakeTimers();
  // reset the singleton stores to a known-empty baseline
  useWorkspaceStore.getState().reset();
  useCameraStore.getState().reset();
  // fresh call history; default: nothing saved
  h.saveDoc.mockClear();
  h.saveCamera.mockClear();
  h.loadDoc.mockReset().mockReturnValue(null);
  h.loadCamera.mockReset().mockReturnValue(null);
  h.cleanup.current = undefined;
  installDom();
});

afterEach(() => {
  // tear down any live subscription/listeners left by a mounted hook (idempotent)
  h.cleanup.current?.();
  uninstallDom();
  vi.useRealTimers();
});

describe("useWorkspacePersistence — restore on mount", () => {
  it("restores the saved doc AND camera, then fires onLoad(true)", async () => {
    const doc = makeDoc();
    h.loadDoc.mockReturnValue(doc);
    h.loadCamera.mockReturnValue(CAM_A);
    const onLoad = vi.fn();

    mount(WS_ID, onLoad);
    await flushRestore();

    expect(h.loadDoc).toHaveBeenCalledTimes(1);
    expect(h.loadDoc).toHaveBeenCalledWith(WS_ID);
    expect(h.loadCamera).toHaveBeenCalledWith(WS_ID);
    expect(useWorkspaceStore.getState().doc).toBe(doc);
    expect(useCameraStore.getState().camera).toBe(CAM_A);
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onLoad).toHaveBeenCalledWith(true);
  });

  it("RESETS both stores synchronously on mount and fires onLoad(false) when nothing is saved", async () => {
    // pre-seed a previous canvas' state that MUST be cleared
    useWorkspaceStore.getState().createRegion("stale");
    useCameraStore.getState().setCamera({ x: 9, y: 9, scale: 3 });
    expect(useWorkspaceStore.getState().doc.regions).toHaveLength(1);
    const onLoad = vi.fn();

    mount(WS_ID, onLoad);

    // reset happens in the effect body (synchronously), BEFORE the async restore
    expect(useWorkspaceStore.getState().doc.regions).toHaveLength(0);
    expect(useCameraStore.getState().camera).toEqual(DEFAULT_CAMERA);
    expect(onLoad).not.toHaveBeenCalled();

    await flushRestore();

    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onLoad).toHaveBeenCalledWith(false);
    // null restore never writes back
    expect(useWorkspaceStore.getState().doc.regions).toHaveLength(0);
    expect(useCameraStore.getState().camera).toEqual(DEFAULT_CAMERA);
    expect(h.saveDoc).not.toHaveBeenCalled();
    expect(h.saveCamera).not.toHaveBeenCalled();
  });

  it("restores the doc but leaves the camera at default when only the doc is saved", async () => {
    const doc = makeDoc();
    h.loadDoc.mockReturnValue(doc);
    h.loadCamera.mockReturnValue(null);
    const onLoad = vi.fn();

    mount(WS_ID, onLoad);
    await flushRestore();

    expect(useWorkspaceStore.getState().doc).toBe(doc);
    expect(useCameraStore.getState().camera).toEqual(DEFAULT_CAMERA);
    expect(onLoad).toHaveBeenCalledWith(true);
  });

  it("restores the camera but leaves the doc empty when only the camera is saved (onLoad false)", async () => {
    h.loadDoc.mockReturnValue(null);
    h.loadCamera.mockReturnValue(CAM_A);
    const onLoad = vi.fn();

    mount(WS_ID, onLoad);
    await flushRestore();

    expect(useWorkspaceStore.getState().doc.regions).toHaveLength(0);
    expect(useCameraStore.getState().camera).toBe(CAM_A);
    // Boolean(null) === false — a restored camera does NOT count as "had a doc"
    expect(onLoad).toHaveBeenCalledWith(false);
  });

  it("does not throw when onLoad is omitted", async () => {
    const doc = makeDoc();
    h.loadDoc.mockReturnValue(doc);

    expect(() => mount(WS_ID)).not.toThrow();
    await flushRestore();

    expect(useWorkspaceStore.getState().doc).toBe(doc);
  });

  it("supports async persistence that returns Promises", async () => {
    const doc = makeDoc("ws_async");
    h.loadDoc.mockReturnValue(Promise.resolve(doc));
    h.loadCamera.mockReturnValue(Promise.resolve(CAM_A));
    const onLoad = vi.fn();

    mount(WS_ID, onLoad);
    await flushRestore();

    expect(useWorkspaceStore.getState().doc).toBe(doc);
    expect(useCameraStore.getState().camera).toBe(CAM_A);
    expect(onLoad).toHaveBeenCalledWith(true);
  });

  it("ABORTS the restore when cleanup runs before the promise resolves (active flag)", async () => {
    const doc = makeDoc();
    h.loadDoc.mockReturnValue(doc);
    h.loadCamera.mockReturnValue(CAM_A);
    const onLoad = vi.fn();

    const cleanup = mount(WS_ID, onLoad);
    // unmount immediately — BEFORE the microtask restore has run
    cleanup();
    await flushRestore();

    // the resolved restore must be discarded: no write-back, no onLoad
    expect(onLoad).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().doc).not.toBe(doc); // never applied
    expect(useWorkspaceStore.getState().doc.regions).toHaveLength(0); // reset-empty
    expect(useCameraStore.getState().camera).not.toBe(CAM_A);
    expect(useCameraStore.getState().camera).toEqual(DEFAULT_CAMERA);
  });
});

describe("useWorkspacePersistence — autosave subscriptions", () => {
  it("saves the doc (debounced 400ms) with the current doc when the document changes", async () => {
    mount();
    await flushRestore();

    useWorkspaceStore.getState().createRegion("lesson");
    expect(h.saveDoc).not.toHaveBeenCalled(); // still within the debounce window

    vi.advanceTimersByTime(399);
    expect(h.saveDoc).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    const doc = useWorkspaceStore.getState().doc;
    expect(h.saveDoc).toHaveBeenCalledTimes(1);
    expect(h.saveDoc).toHaveBeenCalledWith(WS_ID, doc);
  });

  it("collapses several rapid doc changes into ONE save carrying the latest doc", async () => {
    mount();
    await flushRestore();

    const store = useWorkspaceStore.getState();
    store.createRegion("a");
    vi.advanceTimersByTime(100);
    store.createRegion("b");
    vi.advanceTimersByTime(100);
    store.createRegion("c");
    vi.advanceTimersByTime(400);

    expect(h.saveDoc).toHaveBeenCalledTimes(1);
    const doc = useWorkspaceStore.getState().doc;
    expect(doc.regions).toHaveLength(3);
    expect(h.saveDoc).toHaveBeenCalledWith(WS_ID, doc);
  });

  it("does NOT save when a store update leaves the doc reference unchanged", async () => {
    mount();
    await flushRestore();

    // a state write that keeps the SAME doc reference must not trigger a save
    useWorkspaceStore.setState((s) => ({ doc: s.doc }));
    vi.advanceTimersByTime(2000);

    expect(h.saveDoc).not.toHaveBeenCalled();
  });

  it("saves the camera (debounced 300ms) with the current camera when it changes", async () => {
    mount();
    await flushRestore();

    useCameraStore.getState().panBy(15, 25);
    vi.advanceTimersByTime(299);
    expect(h.saveCamera).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    const camera = useCameraStore.getState().camera;
    expect(h.saveCamera).toHaveBeenCalledTimes(1);
    expect(h.saveCamera).toHaveBeenCalledWith(WS_ID, camera);
    expect(camera).toEqual({ x: 15, y: 25, scale: 1 });
  });

  it("does NOT save the camera when the camera reference is unchanged", async () => {
    mount();
    await flushRestore();

    useCameraStore.setState((s) => ({ camera: s.camera }));
    vi.advanceTimersByTime(2000);

    expect(h.saveCamera).not.toHaveBeenCalled();
  });

  it("persists mid-stream via maxWait even while doc changes never stop arriving", async () => {
    mount();
    await flushRestore();

    const store = useWorkspaceStore.getState();
    // changes every 300ms stay INSIDE the 400ms trailing window, so a pure trailing
    // debounce would reset forever and never fire — only maxWait(2000) can save here.
    for (let i = 0; i < 8; i++) {
      store.createRegion(`stream-${i}`);
      vi.advanceTimersByTime(300);
    }

    expect(h.saveDoc).toHaveBeenCalled(); // fired mid-stream, before any quiet period
  });
});

describe("useWorkspacePersistence — flush on hide / pagehide", () => {
  it("flushes pending doc + camera saves immediately when the page becomes hidden", async () => {
    mount();
    await flushRestore();

    useWorkspaceStore.getState().createRegion("x");
    useCameraStore.getState().panBy(1, 1);
    expect(h.saveDoc).not.toHaveBeenCalled();
    expect(h.saveCamera).not.toHaveBeenCalled();

    fakeDocument.visibilityState = "hidden";
    fakeDocument.dispatch("visibilitychange");

    // flushed WITHOUT advancing any timer
    expect(h.saveDoc).toHaveBeenCalledTimes(1);
    expect(h.saveDoc).toHaveBeenCalledWith(WS_ID, useWorkspaceStore.getState().doc);
    expect(h.saveCamera).toHaveBeenCalledTimes(1);
    expect(h.saveCamera).toHaveBeenCalledWith(WS_ID, useCameraStore.getState().camera);
  });

  it("does NOT flush when visibility changes to a non-hidden state", async () => {
    mount();
    await flushRestore();

    useWorkspaceStore.getState().createRegion("x");
    fakeDocument.visibilityState = "visible";
    fakeDocument.dispatch("visibilitychange");

    expect(h.saveDoc).not.toHaveBeenCalled();
  });

  it("flushes pending saves on pagehide", async () => {
    mount();
    await flushRestore();

    useWorkspaceStore.getState().createRegion("x");
    useCameraStore.getState().panBy(2, 2);

    fakeWindow.dispatch("pagehide");

    expect(h.saveDoc).toHaveBeenCalledTimes(1);
    expect(h.saveCamera).toHaveBeenCalledTimes(1);
  });

  it("registers pagehide on window and visibilitychange on document", async () => {
    mount();
    await flushRestore();

    expect(fakeWindow.count("pagehide")).toBe(1);
    expect(fakeDocument.count("visibilitychange")).toBe(1);
  });
});

describe("useWorkspacePersistence — cleanup", () => {
  it("flushes pending doc + camera saves on unmount", async () => {
    const cleanup = mount();
    await flushRestore();

    useWorkspaceStore.getState().createRegion("x");
    useCameraStore.getState().panBy(3, 3);
    expect(h.saveDoc).not.toHaveBeenCalled();

    cleanup();

    expect(h.saveDoc).toHaveBeenCalledTimes(1);
    expect(h.saveCamera).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes so later store changes no longer save", async () => {
    const cleanup = mount();
    await flushRestore();

    cleanup();
    h.saveDoc.mockClear();
    h.saveCamera.mockClear();

    useWorkspaceStore.getState().createRegion("after-unmount");
    useCameraStore.getState().panBy(7, 7);
    vi.advanceTimersByTime(2000);

    expect(h.saveDoc).not.toHaveBeenCalled();
    expect(h.saveCamera).not.toHaveBeenCalled();
  });

  it("removes the window + document listeners on cleanup", async () => {
    const cleanup = mount();
    await flushRestore();
    expect(fakeWindow.count("pagehide")).toBe(1);
    expect(fakeDocument.count("visibilitychange")).toBe(1);

    cleanup();

    expect(fakeWindow.count("pagehide")).toBe(0);
    expect(fakeDocument.count("visibilitychange")).toBe(0);
  });
});
