import type { CompositionEdge } from "@/server/knowledge/types";
import {
  type Edge,
  detectCycle,
  wouldCreateCycle,
  boundedTraverse,
  adjacencyFrom,
} from "@/server/knowledge/graph/traverse";

/**
 * The composition graph — `PART_OF`, ACYCLIC (§11.3, C2). `part PART_OF whole`
 * (edge from=part, to=whole). Structural containment, not prerequisite and not
 * reinforcement — needed for aggregation and progress rollup ("4 of 7 parts covered").
 * Acyclic for the obvious reason: a thing cannot be transitively part of itself.
 *
 * W7: this file MUST NOT import graph/dependency.ts OR graph/reinforcement.ts.
 */

const edgesOf = (comp: CompositionEdge[]): Edge[] => comp.map((c) => ({ from: c.partId, to: c.wholeId }));

/** `composition-dag` invariant: PART_OF is acyclic. Returns a cycle path if not. */
export function findCycle(comp: CompositionEdge[]): string[] | null {
  return detectCycle(edgesOf(comp));
}
export function isAcyclic(comp: CompositionEdge[]): boolean {
  return findCycle(comp) === null;
}

/** V8 — a proposed `part PART_OF whole` must close no cycle. */
export function wouldViolateAcyclicity(comp: CompositionEdge[], partId: string, wholeId: string): boolean {
  return wouldCreateCycle(edgesOf(comp), partId, wholeId);
}

/** The wholes that `seeds` are (transitively) part of — bounded (§18B). */
export function containingWholes(comp: CompositionEdge[], seeds: string[], maxDepth: number, maxNodes: number) {
  return boundedTraverse(seeds, adjacencyFrom(edgesOf(comp), "forward"), maxDepth, maxNodes);
}

/** The parts that make up `seeds` — bounded reverse traversal. */
export function componentParts(comp: CompositionEdge[], seeds: string[], maxDepth: number, maxNodes: number) {
  return boundedTraverse(seeds, adjacencyFrom(edgesOf(comp), "reverse"), maxDepth, maxNodes);
}
