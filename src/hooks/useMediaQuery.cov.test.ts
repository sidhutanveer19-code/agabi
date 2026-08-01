import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * useMediaQuery is a `useSyncExternalStore` hook. Its ENTIRE contribution is the
 * three store functions it builds — `subscribe`, `getSnapshot`, `getServerSnapshot`
 * — and the order in which it hands them to React. The unit suite runs under the
 * node env (no DOM, no client renderer), so we cannot mount a component to drive a
 * real client render. Instead we treat React's store primitive as the framework
 * boundary (the narrowest possible seam): a thin `useSyncExternalStore` stand-in
 * captures the exact closures the hook constructs and returns the CLIENT snapshot,
 * mirroring what React does on the client's first render. Every assertion below then
 * exercises the hook's OWN real code against a real `window.matchMedia` fake — the
 * only browser-only global involved (same window-faking pattern as useSpeech.test.ts).
 *
 * What this pins (mutation targets): the "change" event name on both add + remove,
 * that a listener is actually attached and the cleanup detaches the SAME handler,
 * that the query string is threaded verbatim into `matchMedia`, that the live
 * `.matches` is re-read (not cached), that the server snapshot is a hard `false`
 * independent of window state, and that the closures are passed in the correct
 * (client-snapshot, server-snapshot) order.
 */

type StoreFns = {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => boolean;
  getServerSnapshot: () => boolean;
};

// vi.hoisted keeps this reference safe to touch inside the hoisted vi.mock factory.
const hoisted = vi.hoisted(() => ({ lastStore: null as StoreFns | null }));

vi.mock("react", async (importActual) => {
  const actual = await importActual<typeof import("react")>();
  return {
    ...actual,
    // Capture the three store functions the hook builds; return the CLIENT snapshot
    // (getSnapshot) — exactly what React yields on the client's initial render. This
    // makes arg-ORDER faithful: if the hook ever passed getServerSnapshot as the
    // client snapshot (arg 2), the returned value would flip and the tests below fail.
    useSyncExternalStore: (
      subscribe: (onChange: () => void) => () => void,
      getSnapshot: () => boolean,
      getServerSnapshot: () => boolean,
    ): boolean => {
      hoisted.lastStore = { subscribe, getSnapshot, getServerSnapshot };
      return getSnapshot();
    },
  };
});

// Imported AFTER the mock is registered so the hook binds to the stubbed primitive.
import { useMediaQuery } from "@/hooks/useMediaQuery";

type FakeMql = {
  matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

/**
 * Install a fake `window.matchMedia`. Returns a STABLE MediaQueryList per query so
 * that `subscribe` (which captures one mql) and `getSnapshot` (which re-reads) agree,
 * and so a test can flip `.matches` and observe a live re-read. Only the browser
 * global is faked — the hook's own logic runs for real.
 */
function installMatchMedia(matchesByQuery: Record<string, boolean>) {
  const instances = new Map<string, FakeMql>();
  const matchMedia = vi.fn((query: string): FakeMql => {
    let mql = instances.get(query);
    if (!mql) {
      mql = {
        matches: matchesByQuery[query] ?? false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      instances.set(query, mql);
    }
    return mql;
  });
  (globalThis as { window?: unknown }).window = { matchMedia };
  return { matchMedia, mqlFor: (q: string) => instances.get(q) };
}

beforeEach(() => {
  hoisted.lastStore = null;
});

afterEach(() => {
  hoisted.lastStore = null;
  delete (globalThis as { window?: unknown }).window;
});

describe("useMediaQuery — return value reflects the live match state", () => {
  it("returns true when the query currently matches", () => {
    installMatchMedia({ "(max-width: 767px)": true });
    expect(useMediaQuery("(max-width: 767px)")).toBe(true);
  });

  it("returns false when the query does not match", () => {
    installMatchMedia({ "(max-width: 767px)": false });
    expect(useMediaQuery("(max-width: 767px)")).toBe(false);
  });

  it("returns false for a query the environment has never heard of (default miss)", () => {
    installMatchMedia({}); // nothing registered → fake reports matches:false
    expect(useMediaQuery("(min-width: 99999px)")).toBe(false);
  });

  it("threads the exact query string through to window.matchMedia", () => {
    const { matchMedia } = installMatchMedia({ "(min-width: 1024px)": true });
    expect(useMediaQuery("(min-width: 1024px)")).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith("(min-width: 1024px)");
  });

  it("passes an empty query verbatim (arbitrary string, not munged)", () => {
    const { matchMedia } = installMatchMedia({ "": false });
    expect(useMediaQuery("")).toBe(false);
    expect(matchMedia).toHaveBeenCalledWith("");
  });
});

describe("useMediaQuery — getSnapshot reads the live match state on each call", () => {
  it("re-reads window.matchMedia().matches rather than caching the first value", () => {
    const query = "(prefers-color-scheme: dark)";
    const { mqlFor } = installMatchMedia({ [query]: false });
    useMediaQuery(query);
    const store = hoisted.lastStore;
    expect(store).not.toBeNull();
    // First read: currently false.
    expect(store!.getSnapshot()).toBe(false);
    // Flip the underlying media state; a fresh snapshot must reflect it.
    mqlFor(query)!.matches = true;
    expect(store!.getSnapshot()).toBe(true);
  });
});

describe("useMediaQuery — getServerSnapshot is a hard false", () => {
  it("returns false even when the client WOULD match (SSR must not read window)", () => {
    installMatchMedia({ "(max-width: 767px)": true });
    useMediaQuery("(max-width: 767px)");
    const store = hoisted.lastStore;
    expect(store).not.toBeNull();
    expect(store!.getServerSnapshot()).toBe(false);
  });
});

describe("useMediaQuery — subscribe wires a 'change' listener and cleans it up", () => {
  it("attaches the handler to the query's MediaQueryList and detaches the same one on cleanup", () => {
    const query = "(max-width: 767px)";
    const { matchMedia, mqlFor } = installMatchMedia({ [query]: true });
    useMediaQuery(query);
    const store = hoisted.lastStore;
    expect(store).not.toBeNull();

    // Isolate the subscribe path from the earlier getSnapshot read.
    matchMedia.mockClear();

    const onChange = vi.fn();
    const cleanup = store!.subscribe(onChange);

    // subscribe resolves the MediaQueryList for exactly this query, once.
    expect(matchMedia).toHaveBeenCalledTimes(1);
    expect(matchMedia).toHaveBeenCalledWith(query);

    const mql = mqlFor(query);
    expect(mql).toBeDefined();
    // The exact handler is registered on the "change" event, and nothing removed yet.
    expect(mql!.addEventListener).toHaveBeenCalledTimes(1);
    expect(mql!.addEventListener).toHaveBeenCalledWith("change", onChange);
    expect(mql!.removeEventListener).not.toHaveBeenCalled();

    // subscribe returns an unsubscribe fn that removes the SAME handler from the SAME list.
    expect(typeof cleanup).toBe("function");
    cleanup();
    expect(mql!.removeEventListener).toHaveBeenCalledTimes(1);
    expect(mql!.removeEventListener).toHaveBeenCalledWith("change", onChange);
    // Cleanup must not re-add anything.
    expect(mql!.addEventListener).toHaveBeenCalledTimes(1);
  });

  it("does not fire the caller's onChange during subscribe or cleanup (only real media events would)", () => {
    const query = "(orientation: portrait)";
    installMatchMedia({ [query]: false });
    useMediaQuery(query);
    const onChange = vi.fn();
    const cleanup = hoisted.lastStore!.subscribe(onChange);
    cleanup();
    expect(onChange).not.toHaveBeenCalled();
  });
});
