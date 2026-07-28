import { describe, it, expect } from "vitest";
import type { CompositionEdge } from "@/server/knowledge/types";
import {
  findCycle,
  isAcyclic,
  wouldViolateAcyclicity,
  containingWholes,
  componentParts,
} from "@/server/knowledge/graph/composition";

/**
 * Branch- and mutation-focused coverage for the composition graph (§11.3, C2 — PART_OF, acyclic).
 *
 * The load-bearing detail this file owns is the edge mapping `partId -> from`, `wholeId -> to`
 * and the traversal DIRECTION each query uses (forward = "the wholes I'm part of";
 * reverse = "the parts that make me up"). Every test below is written to DIE if the source
 * swaps part/whole, flips forward/reverse, or drops a passthrough argument (maxDepth/maxNodes).
 */

// Build a CompositionEdge. ordinal/version are irrelevant to graph shape (edgesOf ignores them),
// so we set realistic-but-non-default values to prove they are NOT read.
const ce = (partId: string, wholeId: string, ordinal: number | null = 3, version = 7): CompositionEdge => ({
  partId,
  wholeId,
  ordinal,
  version,
});

// A clean 3-level containment DAG: atom PART_OF molecule PART_OF matter.
const chain: CompositionEdge[] = [ce("atom", "molecule"), ce("molecule", "matter")];

const depthMap = (r: { nodes: { id: string; depth: number }[] }) =>
  new Map(r.nodes.map((n) => [n.id, n.depth] as const));

describe("composition.findCycle (§11.3 composition-dag) — coverage", () => {
  it("returns null for an acyclic edge set (visit completes, outer loop exhausts)", () => {
    expect(findCycle(chain)).toBeNull();
  });

  it("returns null for empty input (no nodes, nothing to visit)", () => {
    expect(findCycle([])).toBeNull();
  });

  it("returns the exact cycle path a->b->c->a for a 3-cycle", () => {
    // a PART_OF b, b PART_OF c, c PART_OF a  ⇒ edges a->b->c->a
    const cyclic = [ce("a", "b"), ce("b", "c"), ce("c", "a")];
    expect(findCycle(cyclic)).toEqual(["a", "b", "c", "a"]);
  });

  it("detects a self-loop (a PART_OF a) as the cycle [a, a]", () => {
    expect(findCycle([ce("a", "a")])).toEqual(["a", "a"]);
  });

  it("finds a cycle sitting in a SECOND, disconnected component", () => {
    // x->y is acyclic; p<->q is a cycle. Sorted node order is p,q,x,y so p is visited first.
    const edges = [ce("x", "y"), ce("p", "q"), ce("q", "p")];
    expect(findCycle(edges)).toEqual(["p", "q", "p"]);
  });

  it("maps part->from / whole->to: cycle direction follows PART_OF, not the reverse", () => {
    // If edgesOf swapped part/whole, the reported cycle would traverse in the opposite order.
    // one PART_OF two, two PART_OF one ⇒ edges one->two->one.
    expect(findCycle([ce("one", "two"), ce("two", "one")])).toEqual(["one", "two", "one"]);
  });
});

describe("composition.isAcyclic — coverage (both sides of the null comparison)", () => {
  it("true when there is no cycle", () => {
    expect(isAcyclic(chain)).toBe(true);
  });

  it("true for empty input", () => {
    expect(isAcyclic([])).toBe(true);
  });

  it("false when a cycle exists", () => {
    expect(isAcyclic([ce("a", "b"), ce("b", "a")])).toBe(false);
  });

  it("false for a self-loop", () => {
    expect(isAcyclic([ce("a", "a")])).toBe(false);
  });
});

describe("composition.wouldViolateAcyclicity (V8) — coverage", () => {
  // Existing: a PART_OF b, b PART_OF c  ⇒ edges a->b->c.
  const existing = [ce("a", "b"), ce("b", "c")];

  it("true — closing the back-edge (c PART_OF a) would create a cycle", () => {
    // Propose c PART_OF a: edge c->a. `a` is reachable from `c` (c->...? no) — check via the real fn.
    // Semantics: from=partId=c, to=wholeId=a; c reachable from a (a->b->c) ⇒ adding closes a loop.
    expect(wouldViolateAcyclicity(existing, "c", "a")).toBe(true);
  });

  it("false — a forward edge (a PART_OF c) closes nothing", () => {
    expect(wouldViolateAcyclicity(existing, "a", "c")).toBe(false);
  });

  it("true — a self-edge (x PART_OF x) always violates", () => {
    expect(wouldViolateAcyclicity(existing, "x", "x")).toBe(true);
  });

  it("false — a proposal touching brand-new, unconnected ids", () => {
    expect(wouldViolateAcyclicity(existing, "newPart", "newWhole")).toBe(false);
  });

  it("false — the very first edge into an empty graph can never cycle", () => {
    expect(wouldViolateAcyclicity([], "atom", "molecule")).toBe(false);
  });

  it("part/whole direction: proposing whole PART_OF part on a real chain is the violating one", () => {
    // atom PART_OF molecule already exists. Proposing molecule PART_OF atom (part=molecule, whole=atom)
    // must violate; the reverse (atom PART_OF molecule again) must not.
    const g = [ce("atom", "molecule")];
    expect(wouldViolateAcyclicity(g, "molecule", "atom")).toBe(true);
    expect(wouldViolateAcyclicity(g, "atom", "molecule")).toBe(false);
  });
});

describe("composition.containingWholes (forward — the wholes seeds are part of) — coverage", () => {
  it("walks part->whole: from atom reaches molecule then matter with correct depths", () => {
    const r = containingWholes(chain, ["atom"], 10, 100);
    expect(r.truncated).toBe(false);
    const d = depthMap(r);
    expect(d.get("atom")).toBe(0);
    expect(d.get("molecule")).toBe(1);
    expect(d.get("matter")).toBe(2);
    expect(r.nodes).toHaveLength(3);
  });

  it("DIRECTION guard: a mid-chain seed reaches only its wholes, never its parts", () => {
    // From "molecule": forward reaches matter (its whole) but NOT atom (its part).
    const r = containingWholes(chain, ["molecule"], 10, 100);
    const ids = r.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["matter", "molecule"]);
    expect(ids).not.toContain("atom");
  });

  it("a top-level whole (matter) has no containing wholes — only itself", () => {
    const r = containingWholes(chain, ["matter"], 10, 100);
    expect(r.nodes).toEqual([{ id: "matter", depth: 0 }]);
    expect(r.truncated).toBe(false);
  });

  it("maxDepth is passed through: depth 1 stops before matter", () => {
    const r = containingWholes(chain, ["atom"], 1, 100);
    const ids = r.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["atom", "molecule"]);
    expect(r.truncated).toBe(false); // a depth cap does not flag truncation
  });

  it("maxNodes is passed through: cap of 2 truncates a 4-node chain", () => {
    const longChain = [ce("a", "b"), ce("b", "c"), ce("c", "d")];
    const r = containingWholes(longChain, ["a"], 10, 2);
    expect(r.truncated).toBe(true);
    expect(r.nodes).toHaveLength(2);
    expect(r.nodes.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("unknown seed yields just the seed at depth 0", () => {
    const r = containingWholes(chain, ["ghost"], 10, 100);
    expect(r.nodes).toEqual([{ id: "ghost", depth: 0 }]);
    expect(r.truncated).toBe(false);
  });

  it("empty composition + empty seeds ⇒ no nodes", () => {
    const r = containingWholes([], [], 10, 100);
    expect(r.nodes).toEqual([]);
    expect(r.truncated).toBe(false);
  });
});

describe("composition.componentParts (reverse — the parts that make up seeds) — coverage", () => {
  it("walks whole->part: from matter reaches molecule then atom with correct depths", () => {
    const r = componentParts(chain, ["matter"], 10, 100);
    expect(r.truncated).toBe(false);
    const d = depthMap(r);
    expect(d.get("matter")).toBe(0);
    expect(d.get("molecule")).toBe(1);
    expect(d.get("atom")).toBe(2);
    expect(r.nodes).toHaveLength(3);
  });

  it("DIRECTION guard: a mid-chain seed reaches only its parts, never its wholes", () => {
    // From "molecule": reverse reaches atom (its part) but NOT matter (its whole).
    const r = componentParts(chain, ["molecule"], 10, 100);
    const ids = r.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["atom", "molecule"]);
    expect(ids).not.toContain("matter");
  });

  it("a leaf part (atom) has no components — only itself", () => {
    const r = componentParts(chain, ["atom"], 10, 100);
    expect(r.nodes).toEqual([{ id: "atom", depth: 0 }]);
    expect(r.truncated).toBe(false);
  });

  it("maxDepth is passed through in reverse: depth 1 stops before atom", () => {
    const r = componentParts(chain, ["matter"], 1, 100);
    const ids = r.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["matter", "molecule"]);
    expect(r.truncated).toBe(false);
  });

  it("maxNodes is passed through in reverse: cap of 2 truncates", () => {
    const longChain = [ce("a", "b"), ce("b", "c"), ce("c", "d")];
    const r = componentParts(longChain, ["d"], 10, 2);
    expect(r.truncated).toBe(true);
    expect(r.nodes).toHaveLength(2);
    expect(r.nodes.map((n) => n.id)).toEqual(["d", "c"]);
  });

  it("forward vs reverse are genuinely opposite on the same graph and seed", () => {
    // Seed atom: forward (containingWholes) climbs to matter; reverse (componentParts) finds nothing.
    const fwd = containingWholes(chain, ["atom"], 10, 100).nodes.map((n) => n.id).sort();
    const rev = componentParts(chain, ["atom"], 10, 100).nodes.map((n) => n.id);
    expect(fwd).toEqual(["atom", "matter", "molecule"]);
    expect(rev).toEqual(["atom"]);
  });
});
