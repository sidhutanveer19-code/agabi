import { describe, it, expect, beforeEach } from "vitest";
import { useUiStore } from "@/stores/ui.store";

/**
 * ui.store — the chrome-level global UI store (a zustand store).
 *
 * Pure logic, no I/O edge: the only behaviour is the `commandOpen` seed and the
 * two reducers `setCommandOpen` (absolute set) and `toggleCommand` (flip). Every
 * assertion names the exact resulting boolean, never "it ran", so a mutated
 * reducer (dropped `!`, wrong assigned literal, seed flipped) goes red.
 *
 * Branches covered:
 *   initial slice        — commandOpen seeds to exactly `false`
 *   setCommandOpen(true)  — assigns the passed value verbatim (true)
 *   setCommandOpen(false) — assigns the passed value verbatim (false)
 *   setCommandOpen idempotence — setting the same value keeps it
 *   toggleCommand false→true — the `!s.commandOpen` negation (from seed)
 *   toggleCommand true→false — the `!s.commandOpen` negation (from open)
 *   toggleCommand parity     — two toggles return to origin; odd count flips
 *   immutability             — a new state object each call, prior read intact
 */

// Isolate every test: reset the slice to the documented seed (commandOpen:false)
// WITHOUT leaning on the reducers under test. setState merges, so this only
// touches the one field.
beforeEach(() => {
  useUiStore.setState({ commandOpen: false });
});

describe("useUiStore initial slice", () => {
  it("seeds commandOpen to exactly false", () => {
    expect(useUiStore.getState().commandOpen).toBe(false);
  });

  it("exposes both reducers as functions", () => {
    const { setCommandOpen, toggleCommand } = useUiStore.getState();
    expect(typeof setCommandOpen).toBe("function");
    expect(typeof toggleCommand).toBe("function");
  });
});

describe("setCommandOpen", () => {
  it("assigns true verbatim (open)", () => {
    useUiStore.getState().setCommandOpen(true);
    expect(useUiStore.getState().commandOpen).toBe(true);
  });

  it("assigns false verbatim (closed) after being opened", () => {
    useUiStore.getState().setCommandOpen(true);
    useUiStore.getState().setCommandOpen(false);
    expect(useUiStore.getState().commandOpen).toBe(false);
  });

  it("sets the passed value, not its negation (guards against a flipped assignment)", () => {
    // If the reducer negated its argument, passing `false` would land as `true`.
    useUiStore.getState().setCommandOpen(false);
    expect(useUiStore.getState().commandOpen).toBe(false);
  });

  it("is idempotent — setting the same value twice keeps it", () => {
    useUiStore.getState().setCommandOpen(true);
    useUiStore.getState().setCommandOpen(true);
    expect(useUiStore.getState().commandOpen).toBe(true);
  });

  it("overrides a prior toggle (absolute set wins over current state)", () => {
    useUiStore.getState().toggleCommand(); // false -> true
    useUiStore.getState().setCommandOpen(false); // forced closed regardless
    expect(useUiStore.getState().commandOpen).toBe(false);
  });
});

describe("toggleCommand", () => {
  it("flips false → true from the seed (the `!` negation)", () => {
    useUiStore.getState().toggleCommand();
    expect(useUiStore.getState().commandOpen).toBe(true);
  });

  it("flips true → false when already open", () => {
    useUiStore.getState().setCommandOpen(true);
    useUiStore.getState().toggleCommand();
    expect(useUiStore.getState().commandOpen).toBe(false);
  });

  it("returns to the origin after two toggles (even parity)", () => {
    useUiStore.getState().toggleCommand();
    useUiStore.getState().toggleCommand();
    expect(useUiStore.getState().commandOpen).toBe(false);
  });

  it("lands opposite the origin after three toggles (odd parity)", () => {
    useUiStore.getState().toggleCommand();
    useUiStore.getState().toggleCommand();
    useUiStore.getState().toggleCommand();
    expect(useUiStore.getState().commandOpen).toBe(true);
  });

  it("reads the LIVE state each call (toggle after an explicit set flips from that set value)", () => {
    useUiStore.getState().setCommandOpen(true);
    useUiStore.getState().toggleCommand(); // must see `true`, flip to false
    expect(useUiStore.getState().commandOpen).toBe(false);
  });
});

describe("immutability", () => {
  it("setCommandOpen produces a NEW state object (does not mutate the prior read)", () => {
    const before = useUiStore.getState();
    useUiStore.getState().setCommandOpen(true);
    const after = useUiStore.getState();
    expect(after).not.toBe(before);
    // The previously-read snapshot was not mutated in place.
    expect(before.commandOpen).toBe(false);
  });

  it("toggleCommand produces a NEW state object each call", () => {
    const before = useUiStore.getState();
    useUiStore.getState().toggleCommand();
    const after = useUiStore.getState();
    expect(after).not.toBe(before);
    expect(before.commandOpen).toBe(false);
  });
});
