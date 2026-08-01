import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * useReducedMotion is a one-line delegation to useMediaQuery with a FROZEN query
 * constant: `(prefers-reduced-motion: reduce)`. Its entire contribution is (a) that
 * EXACT media-feature string and (b) that it returns the underlying live match
 * boolean unchanged. Everything else (the useSyncExternalStore wiring, subscribe/
 * cleanup) belongs to useMediaQuery and is proven in useMediaQuery.cov.test.ts —
 * here we prove the delegation itself end to end.
 *
 * The unit suite runs under the node env (no DOM, no client renderer), so we cannot
 * mount a component. As in useMediaQuery.cov.test.ts we treat React's store primitive
 * as the framework boundary: a thin `useSyncExternalStore` stand-in captures the
 * closures the hook builds and returns the CLIENT snapshot (what React yields on the
 * client's first render). The hook's OWN real code then runs against a real
 * `window.matchMedia` fake — the only browser global involved.
 *
 * Mutation targets this pins: the query string being replaced with "" (Stryker string
 * mutator) — killed because we register `reduce → true` and `"" → false`, so an empty
 * string would flip true→false; the query being any string OTHER than
 * `(prefers-reduced-motion: reduce)`; and the return being dropped/negated — killed by
 * exact true/false assertions.
 */

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

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
    // (arg 2) — exactly what React yields on the client's initial render. This makes
    // arg-ORDER faithful: if the query were ever wired to the server snapshot instead,
    // the returned value would flip and these assertions fail.
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
import { useReducedMotion } from "@/hooks/useReducedMotion";

type FakeMql = {
  matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

/**
 * Install a fake `window.matchMedia`. Returns a STABLE MediaQueryList per query so
 * `subscribe` (captures one mql) and `getSnapshot` (re-reads) agree, and so a test can
 * flip `.matches` and observe a live re-read. Unregistered queries report matches:false
 * — which is exactly what makes the empty-string mutation observable.
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

describe("useReducedMotion — reflects the live prefers-reduced-motion state", () => {
  it("returns true when the user prefers reduced motion (query matches)", () => {
    installMatchMedia({ [REDUCE_QUERY]: true });
    expect(useReducedMotion()).toBe(true);
  });

  it("returns false when the user has no reduced-motion preference (query does not match)", () => {
    installMatchMedia({ [REDUCE_QUERY]: false });
    expect(useReducedMotion()).toBe(false);
  });

  it("returns false when the environment reports nothing for the query (default miss)", () => {
    installMatchMedia({}); // nothing registered → fake reports matches:false
    expect(useReducedMotion()).toBe(false);
  });
});

describe("useReducedMotion — uses the exact prefers-reduced-motion query constant", () => {
  it("threads '(prefers-reduced-motion: reduce)' verbatim to window.matchMedia", () => {
    const { matchMedia } = installMatchMedia({ [REDUCE_QUERY]: true });
    useReducedMotion();
    expect(matchMedia).toHaveBeenCalledWith(REDUCE_QUERY);
  });

  it("would break if the query were emptied: reduce matches true, empty string matches false", () => {
    // This is the guard against the string→"" mutation. Only the exact reduce query is
    // registered as true; an empty string (or any other query) resolves to false.
    const { matchMedia } = installMatchMedia({ [REDUCE_QUERY]: true, "": false });
    expect(useReducedMotion()).toBe(true);
    // Prove the distinction the assertion relies on is real, not incidental.
    expect(matchMedia).toHaveBeenCalledWith(REDUCE_QUERY);
    expect(matchMedia).not.toHaveBeenCalledWith("");
  });

  it("does not query any unrelated media feature (e.g. color-scheme / width)", () => {
    const { matchMedia } = installMatchMedia({ [REDUCE_QUERY]: false });
    useReducedMotion();
    const queried = matchMedia.mock.calls.map((c) => c[0]);
    expect(queried).toContain(REDUCE_QUERY);
    expect(queried.every((q) => q === REDUCE_QUERY)).toBe(true);
  });
});

describe("useReducedMotion — SSR-safe delegation (server snapshot is a hard false)", () => {
  it("exposes a getServerSnapshot that returns false even when the client WOULD match", () => {
    installMatchMedia({ [REDUCE_QUERY]: true });
    useReducedMotion();
    const store = hoisted.lastStore;
    expect(store).not.toBeNull();
    // Server render must never read window: hard false regardless of live match state.
    expect(store!.getServerSnapshot()).toBe(false);
  });

  it("re-reads the live match on getSnapshot rather than caching the first value", () => {
    const { mqlFor } = installMatchMedia({ [REDUCE_QUERY]: false });
    useReducedMotion();
    const store = hoisted.lastStore;
    expect(store).not.toBeNull();
    expect(store!.getSnapshot()).toBe(false);
    // Flip the underlying preference; a fresh snapshot must reflect it.
    mqlFor(REDUCE_QUERY)!.matches = true;
    expect(store!.getSnapshot()).toBe(true);
  });
});

describe("useReducedMotion — subscribe wires a 'change' listener on the reduce query and cleans it up", () => {
  it("attaches the handler to the reduce-motion MediaQueryList and detaches the same one on cleanup", () => {
    const { matchMedia, mqlFor } = installMatchMedia({ [REDUCE_QUERY]: true });
    useReducedMotion();
    const store = hoisted.lastStore;
    expect(store).not.toBeNull();

    // Isolate the subscribe path from the earlier getSnapshot read.
    matchMedia.mockClear();

    const onChange = vi.fn();
    const cleanup = store!.subscribe(onChange);

    // subscribe resolves the MediaQueryList for exactly the reduce query, once.
    expect(matchMedia).toHaveBeenCalledTimes(1);
    expect(matchMedia).toHaveBeenCalledWith(REDUCE_QUERY);

    const mql = mqlFor(REDUCE_QUERY);
    expect(mql).toBeDefined();
    expect(mql!.addEventListener).toHaveBeenCalledTimes(1);
    expect(mql!.addEventListener).toHaveBeenCalledWith("change", onChange);
    expect(mql!.removeEventListener).not.toHaveBeenCalled();

    // The unsubscribe fn removes the SAME handler from the SAME list.
    expect(typeof cleanup).toBe("function");
    cleanup();
    expect(mql!.removeEventListener).toHaveBeenCalledTimes(1);
    expect(mql!.removeEventListener).toHaveBeenCalledWith("change", onChange);
    expect(mql!.addEventListener).toHaveBeenCalledTimes(1); // cleanup re-adds nothing
  });

  it("does not fire the caller's onChange during subscribe or cleanup", () => {
    installMatchMedia({ [REDUCE_QUERY]: false });
    useReducedMotion();
    const onChange = vi.fn();
    const cleanup = hoisted.lastStore!.subscribe(onChange);
    cleanup();
    expect(onChange).not.toHaveBeenCalled();
  });
});
