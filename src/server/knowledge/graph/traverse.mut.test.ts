import { describe, it, expect } from "vitest";
import {
  type Edge,
  adjacencyFrom,
  boundedTraverse,
  detectCycle,
  wouldCreateCycle,
  kahnTopoSort,
} from "@/server/knowledge/graph/traverse";

/**
 * Mutation-killing coverage for the neutral graph primitives that the graph-module tests reach
 * only through their happy path. The uncovered/surviving logic lives in:
 *   · kahnTopoSort — the tie-break comparator ARMS, the ready-init sort, the insertion-splice
 *     `else` branch, and the CYCLIC branch (`order.length !== nodes.size`). learningOrder only
 *     ever feeds it a tie-free acyclic chain, so none of those run.
 *   · detectCycle — the deterministic START-NODE `.sort()`: which node the DFS begins from
 *     decides WHICH representation of a 2-cycle is returned.
 * Each test names the exact order/cycle so the mutation goes red (§H1.2/.3/.5).
 */

const e = (from: string, to: string): Edge => ({ from, to });

describe("kahnTopoSort — tie-breaking, insertion order and the cyclic branch", () => {
  it("sorts multiple independent roots by the DEFAULT comparator (ascending id)", () => {
    // b,c,a all indeg 0 → the ready-init sort must yield a,b,c (not insertion order b,c,a).
    const { order, hasCycle } = kahnTopoSort([e("b", "x"), e("c", "x"), e("a", "x")]);
    expect(order).toEqual(["a", "b", "c", "x"]);
    expect(hasCycle).toBe(false);
  });

  it("keeps `ready` sorted via the insertion SPLICE — a freed small-id node jumps ahead", () => {
    // Process `other` first (frees x → ready [start, x]); then process `start` which frees `mid`.
    // mid < x, so the findIndex hits index 0 and the `else` splice inserts mid AHEAD of x.
    const { order } = kahnTopoSort([e("start", "mid"), e("other", "x")]);
    expect(order).toEqual(["other", "start", "mid", "x"]);
  });

  it("honours a CUSTOM tie-break (proves the param is threaded, not the default)", () => {
    const desc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);
    const { order } = kahnTopoSort([e("b", "x"), e("a", "x")], desc);
    expect(order).toEqual(["b", "a", "x"]); // default would give ["a","b","x"]
  });

  it("a 2-cycle → hasCycle true and an EMPTY partial order (order.length !== nodes.size)", () => {
    const { order, hasCycle } = kahnTopoSort([e("a", "b"), e("b", "a")]);
    expect(order).toEqual([]);
    expect(hasCycle).toBe(true);
  });

  it("emits the acyclic prefix then stops at a cycle, reporting hasCycle true", () => {
    // a→b, b→c, c→b : only `a` ever reaches indeg 0.
    const { order, hasCycle } = kahnTopoSort([e("a", "b"), e("b", "c"), e("c", "b")]);
    expect(order).toEqual(["a"]);
    expect(hasCycle).toBe(true);
  });

  it("a pure chain topo-sorts fully with hasCycle false (order.length === nodes.size)", () => {
    const { order, hasCycle } = kahnTopoSort([e("a", "b"), e("b", "c")]);
    expect(order).toEqual(["a", "b", "c"]);
    expect(hasCycle).toBe(false);
  });
});

describe("detectCycle — deterministic start node decides which 2-cycle representation returns", () => {
  it("starts from the sorted-first node: b↔a reports [a,b,a], not [b,a,b]", () => {
    // Node insertion order is [b,a]; the `.sort()` makes the DFS begin at 'a'.
    expect(detectCycle([e("b", "a"), e("a", "b")])).toEqual(["a", "b", "a"]);
  });

  it("a shared sink reachable from two roots is NOT a cycle (BLACK node is skipped)", () => {
    // a→c and b→c: after c is finished (BLACK), visiting it again from b must not report a cycle.
    expect(detectCycle([e("a", "c"), e("b", "c")])).toBeNull();
  });

  it("returns the full cycle path for a 3-cycle beginning at the sorted-first node", () => {
    expect(detectCycle([e("c", "a"), e("a", "b"), e("b", "c")])).toEqual(["a", "b", "c", "a"]);
  });
});

describe("wouldCreateCycle — self-loop, back-edge and independent-node guards", () => {
  it("a self edge always closes a cycle", () => {
    expect(wouldCreateCycle([], "x", "x")).toBe(true);
  });
  it("adding a back edge onto a chain closes the loop", () => {
    // a→b→c exists; adding c→a (from=c,to=a) — a already reaches c → true.
    expect(wouldCreateCycle([e("a", "b"), e("b", "c")], "c", "a")).toBe(true);
  });
  it("a forward edge on the same chain closes nothing", () => {
    expect(wouldCreateCycle([e("a", "b"), e("b", "c")], "a", "c")).toBe(false);
  });
  it("brand-new unconnected ids never cycle", () => {
    expect(wouldCreateCycle([e("a", "b")], "p", "q")).toBe(false);
  });
});

describe("adjacencyFrom — forward vs reverse neighbour maps", () => {
  it("forward yields out-neighbours; reverse yields in-neighbours; unknown → []", () => {
    const edges = [e("a", "b"), e("a", "c"), e("d", "b")];
    const fwd = adjacencyFrom(edges, "forward");
    const rev = adjacencyFrom(edges, "reverse");
    expect(fwd("a").sort()).toEqual(["b", "c"]);
    expect(rev("b").sort()).toEqual(["a", "d"]);
    expect(fwd("b")).toEqual([]); // no out-edges
    expect(rev("a")).toEqual([]); // no in-edges
  });
});

describe("boundedTraverse — dedupes seeds and reports truncation only on the node cap", () => {
  it("duplicate seeds are visited once (seed dedup)", () => {
    const r = boundedTraverse(["a", "a"], adjacencyFrom([e("a", "b")], "forward"), 10, 100);
    expect(r.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(r.nodes.filter((n) => n.id === "a")).toHaveLength(1);
    expect(r.truncated).toBe(false);
  });

  it("a maxDepth cap stops expansion WITHOUT flagging truncation", () => {
    const chain = [e("a", "b"), e("b", "c")];
    const r = boundedTraverse(["a"], adjacencyFrom(chain, "forward"), 1, 100);
    expect(r.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(r.truncated).toBe(false);
  });

  it("a maxNodes cap truncates AND flags it", () => {
    const chain = [e("a", "b"), e("b", "c"), e("c", "d")];
    const r = boundedTraverse(["a"], adjacencyFrom(chain, "forward"), 100, 2);
    expect(r.nodes).toHaveLength(2);
    expect(r.truncated).toBe(true);
  });
});
