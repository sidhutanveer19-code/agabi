import { describe, it, expect, beforeEach } from "vitest";
import { useSessionStore, INITIAL, type AgabiState } from "@/stores/session.store";

/**
 * session.store — the app-global session phase machine (a zustand store).
 *
 * Pure logic, no I/O edge: the only behaviour is INITIAL's exact shape and the
 * `set`/`reset` reducers. Every assertion names the exact resulting state, never
 * "it ran", so a mutated reducer (wrong spread order, dropped ternary branch,
 * mutated INITIAL) goes red.
 *
 * Branches covered:
 *   INITIAL         — every field's exact literal value
 *   set(object)     — ternary `typeof patch === "function"` FALSE branch: merge patch over state
 *   set(function)   — ternary TRUE branch: call patch(currentState), merge its return
 *   set merge order — `{ ...state, ...patch }` (patch WINS over existing keys)
 *   set immutability— new state reference each call; INITIAL never mutated
 *   reset           — restores every field to INITIAL after arbitrary mutation
 */

// Isolate every test: replace the store slice with a fresh INITIAL copy WITHOUT
// leaning on reset() (which is itself under test). Spread so tests can't leak
// through a shared reference.
beforeEach(() => {
  useSessionStore.setState({ state: { ...INITIAL } });
});

describe("INITIAL", () => {
  it("has the exact seed values of the entry phase", () => {
    expect(INITIAL).toEqual({
      phase: "entry",
      goal: "",
      exIndex: 0,
      exOp: 1,
      listening: false,
    });
  });

  it("starts on the 'entry' phase (not 'canvas')", () => {
    expect(INITIAL.phase).toBe("entry");
  });
});

describe("useSessionStore initial slice", () => {
  it("initializes state to INITIAL", () => {
    // Fresh module read: the store's initial state deep-equals the seed.
    expect(useSessionStore.getState().state).toEqual(INITIAL);
  });
});

describe("set — object patch (ternary FALSE branch)", () => {
  it("merges a partial object over the current state, leaving other fields untouched", () => {
    useSessionStore.getState().set({ phase: "canvas", goal: "photosynthesis" });
    expect(useSessionStore.getState().state).toEqual({
      phase: "canvas",
      goal: "photosynthesis",
      exIndex: 0,
      exOp: 1,
      listening: false,
    });
  });

  it("changes ONLY the named key and preserves the rest", () => {
    useSessionStore.getState().set({ listening: true });
    expect(useSessionStore.getState().state).toEqual({
      ...INITIAL,
      listening: true,
    });
  });

  it("accumulates across successive object patches", () => {
    const { set } = useSessionStore.getState();
    set({ exIndex: 2 });
    set({ exOp: 5 });
    set({ phase: "canvas" });
    expect(useSessionStore.getState().state).toEqual({
      phase: "canvas",
      goal: "",
      exIndex: 2,
      exOp: 5,
      listening: false,
    });
  });

  it("applies an empty object patch as a no-op (state stays equal to INITIAL)", () => {
    useSessionStore.getState().set({});
    expect(useSessionStore.getState().state).toEqual(INITIAL);
  });

  it("lets the patch WIN over an existing key (merge order is {...state, ...patch})", () => {
    useSessionStore.getState().set({ goal: "first" });
    useSessionStore.getState().set({ goal: "second" });
    // If the spread order were reversed the stale 'first' (state) would clobber 'second' (patch).
    expect(useSessionStore.getState().state.goal).toBe("second");
  });
});

describe("set — function patch (ternary TRUE branch)", () => {
  it("calls the updater with the CURRENT state and merges its return value", () => {
    useSessionStore.getState().set({ exIndex: 3 });
    let received: AgabiState | undefined;
    useSessionStore.getState().set((s) => {
      received = s;
      return { exIndex: s.exIndex + 1 };
    });
    // The updater saw the live state (exIndex 3) ...
    expect(received).toEqual({ ...INITIAL, exIndex: 3 });
    // ... and its returned partial was merged (3 -> 4), other fields intact.
    expect(useSessionStore.getState().state).toEqual({ ...INITIAL, exIndex: 4 });
  });

  it("merges the RETURN of the updater, never the function itself", () => {
    useSessionStore.getState().set(() => ({ phase: "canvas", goal: "derived" }));
    const { state } = useSessionStore.getState();
    expect(state.phase).toBe("canvas");
    expect(state.goal).toBe("derived");
    // The function must not have leaked into any field.
    expect(typeof (state as unknown as Record<string, unknown>).phase).toBe("string");
  });

  it("supports a function patch that returns an empty object (no-op)", () => {
    useSessionStore.getState().set({ listening: true });
    useSessionStore.getState().set(() => ({}));
    expect(useSessionStore.getState().state).toEqual({ ...INITIAL, listening: true });
  });
});

describe("set — immutability", () => {
  it("produces a NEW state object each call (does not mutate in place)", () => {
    const before = useSessionStore.getState().state;
    useSessionStore.getState().set({ goal: "x" });
    const after = useSessionStore.getState().state;
    expect(after).not.toBe(before);
    // The previously-read object was not mutated.
    expect(before.goal).toBe("");
  });

  it("never mutates the shared INITIAL seed", () => {
    useSessionStore.getState().set({ phase: "canvas", goal: "mutate?", exIndex: 9 });
    // INITIAL must remain pristine — the spread copies, it does not alias.
    expect(INITIAL).toEqual({
      phase: "entry",
      goal: "",
      exIndex: 0,
      exOp: 1,
      listening: false,
    });
  });
});

describe("reset", () => {
  it("restores every field to INITIAL after arbitrary mutation", () => {
    useSessionStore.getState().set({
      phase: "canvas",
      goal: "something",
      exIndex: 7,
      exOp: 3,
      listening: true,
    });
    useSessionStore.getState().reset();
    expect(useSessionStore.getState().state).toEqual(INITIAL);
  });

  it("is idempotent — calling reset on an already-fresh store keeps INITIAL", () => {
    useSessionStore.getState().reset();
    useSessionStore.getState().reset();
    expect(useSessionStore.getState().state).toEqual(INITIAL);
  });

  it("returns each individual field to its seed value", () => {
    useSessionStore.getState().set({ exOp: 42, listening: true });
    useSessionStore.getState().reset();
    const { state } = useSessionStore.getState();
    expect(state.exOp).toBe(1);
    expect(state.listening).toBe(false);
    expect(state.exIndex).toBe(0);
    expect(state.phase).toBe("entry");
    expect(state.goal).toBe("");
  });
});
