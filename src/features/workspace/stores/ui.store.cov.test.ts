import { describe, it, expect, beforeEach } from "vitest";
import { useUiStore, type InteractionKind } from "@/features/workspace/stores/ui.store";

/**
 * ui.store (workspace) — the TRANSIENT canvas-interaction zustand store:
 * selection, hover, focus, and the active interaction gesture. Pure logic, no
 * I/O edge, so every reducer runs for REAL against the real store and every
 * assertion names the exact resulting value/array (§H1.2), never "it ran".
 *
 * Exports covered: `useUiStore`, the `InteractionKind` type, and all six
 * reducers (select, clearSelection, isSelected, setHover, setFocus,
 * setInteraction).
 *
 * Branches covered:
 *   initial slice     — selectedIds [] · hoverId null · focusId null · interaction "idle"
 *   select non-add    — opts undefined (opts?.additive falsy) → {selectedIds:[id], focusId:id}
 *   select non-add    — opts={} (additive key absent → undefined → falsy) → same non-additive path
 *   select non-add    — opts={additive:false} (falsy explicit) → non-additive path
 *   select non-add    — REPLACES a prior multi-selection with exactly [id]; sets focusId=id
 *   select non-add    — does NOT touch hoverId (merge keeps it)
 *   select additive   — includes(id) FALSE → appends id at the END ([...prev, id])
 *   select additive   — includes(id) TRUE  → filter removes exactly that id (toggle off)
 *   select additive   — does NOT change focusId (only selectedIds returned)
 *   select additive   — accumulates multiple distinct ids, order preserved
 *   select additive   — toggling the same id twice returns to the prior set
 *   select additive   — removes only the matching id, other ids + order intact
 *   clearSelection    — resets selectedIds to [] (leaves focus/hover/interaction)
 *   isSelected        — true when present · false when absent · false on empty
 *   setHover          — assigns a string · assigns null · does not touch selection/focus
 *   setFocus          — assigns a string · assigns null · does not touch selection/hover
 *   setInteraction    — assigns each of the 4 kinds verbatim
 *   immutability      — select/clearSelection produce NEW arrays, prior read intact
 */

// Isolate every test: reset the transient slice to the documented seed WITHOUT
// leaning on the reducers under test. setState merges, so this touches only the
// four data fields and leaves the reducer methods in place.
beforeEach(() => {
  useUiStore.setState({
    selectedIds: [],
    hoverId: null,
    focusId: null,
    interaction: "idle",
  });
});

describe("useUiStore initial slice", () => {
  it("seeds selectedIds to an empty array", () => {
    expect(useUiStore.getState().selectedIds).toEqual([]);
  });

  it("seeds hoverId to null", () => {
    expect(useUiStore.getState().hoverId).toBeNull();
  });

  it("seeds focusId to null", () => {
    expect(useUiStore.getState().focusId).toBeNull();
  });

  it("seeds interaction to exactly 'idle'", () => {
    expect(useUiStore.getState().interaction).toBe("idle");
  });

  it("exposes every reducer as a function", () => {
    const s = useUiStore.getState();
    expect(typeof s.select).toBe("function");
    expect(typeof s.clearSelection).toBe("function");
    expect(typeof s.isSelected).toBe("function");
    expect(typeof s.setHover).toBe("function");
    expect(typeof s.setFocus).toBe("function");
    expect(typeof s.setInteraction).toBe("function");
  });
});

describe("select — non-additive (replace) path", () => {
  it("with no opts sets selectedIds to exactly [id] and focusId to id", () => {
    useUiStore.getState().select("a");
    const s = useUiStore.getState();
    expect(s.selectedIds).toEqual(["a"]);
    expect(s.focusId).toBe("a");
  });

  it("with opts={} (additive key absent → undefined → falsy) takes the non-additive path", () => {
    useUiStore.getState().select("a", {});
    const s = useUiStore.getState();
    expect(s.selectedIds).toEqual(["a"]);
    expect(s.focusId).toBe("a");
  });

  it("with opts={additive:false} takes the non-additive path (falsy explicit)", () => {
    useUiStore.getState().select("a", { additive: false });
    const s = useUiStore.getState();
    expect(s.selectedIds).toEqual(["a"]);
    expect(s.focusId).toBe("a");
  });

  it("REPLACES a prior multi-selection with just [id] (drops the others)", () => {
    useUiStore.setState({ selectedIds: ["x", "y", "z"] });
    useUiStore.getState().select("only");
    expect(useUiStore.getState().selectedIds).toEqual(["only"]);
  });

  it("sets focusId to the newly selected id even if a different id was focused", () => {
    useUiStore.setState({ focusId: "old" });
    useUiStore.getState().select("new");
    expect(useUiStore.getState().focusId).toBe("new");
  });

  it("does NOT touch hoverId (merge preserves it)", () => {
    useUiStore.setState({ hoverId: "hovered" });
    useUiStore.getState().select("a");
    expect(useUiStore.getState().hoverId).toBe("hovered");
  });
});

describe("select — additive path", () => {
  it("appends a NOT-yet-selected id at the END of the array", () => {
    useUiStore.setState({ selectedIds: ["a", "b"] });
    useUiStore.getState().select("c", { additive: true });
    expect(useUiStore.getState().selectedIds).toEqual(["a", "b", "c"]);
  });

  it("adds the first id to an empty selection", () => {
    useUiStore.getState().select("a", { additive: true });
    expect(useUiStore.getState().selectedIds).toEqual(["a"]);
  });

  it("toggles OFF an already-selected id (filter removes exactly it)", () => {
    useUiStore.setState({ selectedIds: ["a", "b", "c"] });
    useUiStore.getState().select("b", { additive: true });
    expect(useUiStore.getState().selectedIds).toEqual(["a", "c"]);
  });

  it("removes ONLY the matching id, leaving the others and their order intact", () => {
    useUiStore.setState({ selectedIds: ["a", "b", "a2"] });
    useUiStore.getState().select("a", { additive: true });
    expect(useUiStore.getState().selectedIds).toEqual(["b", "a2"]);
  });

  it("does NOT change focusId (additive branch only returns selectedIds)", () => {
    useUiStore.setState({ focusId: "kept" });
    useUiStore.getState().select("a", { additive: true });
    expect(useUiStore.getState().focusId).toBe("kept");
  });

  it("accumulates multiple distinct ids in insertion order", () => {
    const { select } = useUiStore.getState();
    select("a", { additive: true });
    select("b", { additive: true });
    select("c", { additive: true });
    expect(useUiStore.getState().selectedIds).toEqual(["a", "b", "c"]);
  });

  it("toggling the same id twice returns to the prior set (add then remove)", () => {
    useUiStore.setState({ selectedIds: ["x"] });
    const { select } = useUiStore.getState();
    select("y", { additive: true }); // -> ["x","y"]
    select("y", { additive: true }); // -> ["x"]
    expect(useUiStore.getState().selectedIds).toEqual(["x"]);
  });

  it("additive add does NOT set focusId (stays at the seed null)", () => {
    useUiStore.getState().select("a", { additive: true });
    expect(useUiStore.getState().focusId).toBeNull();
  });
});

describe("clearSelection", () => {
  it("resets a non-empty selection to []", () => {
    useUiStore.setState({ selectedIds: ["a", "b"] });
    useUiStore.getState().clearSelection();
    expect(useUiStore.getState().selectedIds).toEqual([]);
  });

  it("leaves an already-empty selection empty", () => {
    useUiStore.getState().clearSelection();
    expect(useUiStore.getState().selectedIds).toEqual([]);
  });

  it("does NOT clear focusId or hoverId (only selectedIds is set)", () => {
    useUiStore.setState({ selectedIds: ["a"], focusId: "f", hoverId: "h" });
    useUiStore.getState().clearSelection();
    const s = useUiStore.getState();
    expect(s.selectedIds).toEqual([]);
    expect(s.focusId).toBe("f");
    expect(s.hoverId).toBe("h");
  });
});

describe("isSelected", () => {
  it("returns true for an id present in the selection", () => {
    useUiStore.setState({ selectedIds: ["a", "b"] });
    expect(useUiStore.getState().isSelected("b")).toBe(true);
  });

  it("returns false for an id absent from the selection", () => {
    useUiStore.setState({ selectedIds: ["a", "b"] });
    expect(useUiStore.getState().isSelected("z")).toBe(false);
  });

  it("returns false on an empty selection", () => {
    expect(useUiStore.getState().isSelected("a")).toBe(false);
  });

  it("reflects a live select() — becomes true right after selecting", () => {
    useUiStore.getState().select("live");
    expect(useUiStore.getState().isSelected("live")).toBe(true);
  });
});

describe("setHover", () => {
  it("assigns a string hover id", () => {
    useUiStore.getState().setHover("node-1");
    expect(useUiStore.getState().hoverId).toBe("node-1");
  });

  it("assigns null (clears hover)", () => {
    useUiStore.setState({ hoverId: "node-1" });
    useUiStore.getState().setHover(null);
    expect(useUiStore.getState().hoverId).toBeNull();
  });

  it("does NOT touch selectedIds or focusId", () => {
    useUiStore.setState({ selectedIds: ["s"], focusId: "f" });
    useUiStore.getState().setHover("h");
    const s = useUiStore.getState();
    expect(s.selectedIds).toEqual(["s"]);
    expect(s.focusId).toBe("f");
  });
});

describe("setFocus", () => {
  it("assigns a string focus id", () => {
    useUiStore.getState().setFocus("node-2");
    expect(useUiStore.getState().focusId).toBe("node-2");
  });

  it("assigns null (clears focus)", () => {
    useUiStore.setState({ focusId: "node-2" });
    useUiStore.getState().setFocus(null);
    expect(useUiStore.getState().focusId).toBeNull();
  });

  it("does NOT touch selectedIds or hoverId", () => {
    useUiStore.setState({ selectedIds: ["s"], hoverId: "h" });
    useUiStore.getState().setFocus("f");
    const s = useUiStore.getState();
    expect(s.selectedIds).toEqual(["s"]);
    expect(s.hoverId).toBe("h");
  });
});

describe("setInteraction", () => {
  const kinds: InteractionKind[] = ["idle", "panning", "zooming", "dragging"];

  for (const kind of kinds) {
    it(`assigns '${kind}' verbatim`, () => {
      // Start from a different kind so the assertion proves the assignment, not the seed.
      useUiStore.setState({ interaction: kind === "idle" ? "panning" : "idle" });
      useUiStore.getState().setInteraction(kind);
      expect(useUiStore.getState().interaction).toBe(kind);
    });
  }

  it("does NOT touch selectedIds, hoverId, or focusId", () => {
    useUiStore.setState({ selectedIds: ["s"], hoverId: "h", focusId: "f" });
    useUiStore.getState().setInteraction("dragging");
    const s = useUiStore.getState();
    expect(s.selectedIds).toEqual(["s"]);
    expect(s.hoverId).toBe("h");
    expect(s.focusId).toBe("f");
  });
});

describe("immutability", () => {
  it("non-additive select produces a NEW selectedIds array (prior read intact)", () => {
    const before = useUiStore.getState().selectedIds;
    useUiStore.getState().select("a");
    const after = useUiStore.getState().selectedIds;
    expect(after).not.toBe(before);
    expect(before).toEqual([]);
  });

  it("additive append produces a NEW array, not a mutation of the prior one", () => {
    useUiStore.setState({ selectedIds: ["a"] });
    const before = useUiStore.getState().selectedIds;
    useUiStore.getState().select("b", { additive: true });
    const after = useUiStore.getState().selectedIds;
    expect(after).not.toBe(before);
    expect(before).toEqual(["a"]); // untouched
    expect(after).toEqual(["a", "b"]);
  });

  it("additive toggle-off produces a NEW filtered array", () => {
    useUiStore.setState({ selectedIds: ["a", "b"] });
    const before = useUiStore.getState().selectedIds;
    useUiStore.getState().select("a", { additive: true });
    const after = useUiStore.getState().selectedIds;
    expect(after).not.toBe(before);
    expect(before).toEqual(["a", "b"]); // untouched
    expect(after).toEqual(["b"]);
  });

  it("clearSelection installs a fresh empty array", () => {
    useUiStore.setState({ selectedIds: ["a"] });
    const before = useUiStore.getState().selectedIds;
    useUiStore.getState().clearSelection();
    const after = useUiStore.getState().selectedIds;
    expect(after).not.toBe(before);
    expect(after).toEqual([]);
  });
});

/**
 * Extension cases — boundary + falsy-value edges the mutation gate probes:
 *   additive toggle-off of the SOLE id      → filter empties to exactly []
 *   non-additive re-select is idempotent    → still [id], focusId re-set to id
 *   non-additive AFTER additive-left-null    → collapses to [id] AND sets focusId
 *   empty-string id ""                       → treated as a real distinct entry
 *   cross-field independence                 → four setters leave four fields intact
 */
describe("select — extension boundaries", () => {
  it("additive toggle-off of the ONLY selected id empties to exactly []", () => {
    useUiStore.setState({ selectedIds: ["solo"] });
    useUiStore.getState().select("solo", { additive: true });
    expect(useUiStore.getState().selectedIds).toEqual([]);
  });

  it("non-additive re-select of the already-sole id stays [id] and keeps focusId=id", () => {
    useUiStore.getState().select("a"); // -> ["a"], focus "a"
    useUiStore.getState().select("a"); // idempotent replace
    const s = useUiStore.getState();
    expect(s.selectedIds).toEqual(["a"]);
    expect(s.focusId).toBe("a");
  });

  it("non-additive select AFTER an additive multi-select collapses to [id] and SETS focusId (was null)", () => {
    const { select } = useUiStore.getState();
    select("a", { additive: true }); // ["a"], focus null
    select("b", { additive: true }); // ["a","b"], focus null
    expect(useUiStore.getState().focusId).toBeNull(); // additive never touched focus
    select("c"); // non-additive: collapse + focus
    const s = useUiStore.getState();
    expect(s.selectedIds).toEqual(["c"]);
    expect(s.focusId).toBe("c");
  });

  it("additive add accepts the empty-string id '' as a distinct entry", () => {
    useUiStore.getState().select("", { additive: true });
    expect(useUiStore.getState().selectedIds).toEqual([""]);
  });

  it("additive toggle-off works on the empty-string id '' too", () => {
    useUiStore.setState({ selectedIds: ["", "x"] });
    useUiStore.getState().select("", { additive: true });
    expect(useUiStore.getState().selectedIds).toEqual(["x"]);
  });
});

describe("isSelected — empty-string edge", () => {
  it("returns true for a stored empty-string id ''", () => {
    useUiStore.setState({ selectedIds: [""] });
    expect(useUiStore.getState().isSelected("")).toBe(true);
  });

  it("returns false for '' when it is absent", () => {
    useUiStore.setState({ selectedIds: ["a"] });
    expect(useUiStore.getState().isSelected("")).toBe(false);
  });
});

describe("cross-field independence", () => {
  it("four independent setters each leave the others at their own last-set value", () => {
    const st = useUiStore.getState();
    st.select("sel"); // selectedIds ["sel"], focusId "sel"
    st.setHover("hov"); // hoverId "hov" only
    st.setFocus("foc"); // focusId "foc" only (overrides select's focus)
    st.setInteraction("dragging"); // interaction only
    const s = useUiStore.getState();
    expect(s.selectedIds).toEqual(["sel"]);
    expect(s.hoverId).toBe("hov");
    expect(s.focusId).toBe("foc");
    expect(s.interaction).toBe("dragging");
  });
});
