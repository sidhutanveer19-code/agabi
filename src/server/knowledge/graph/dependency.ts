import type { DependencyEdge } from "@/server/knowledge/types";
import {
  type Edge,
  detectCycle,
  wouldCreateCycle,
  boundedTraverse,
  adjacencyFrom,
  kahnTopoSort,
} from "@/server/knowledge/graph/traverse";

/**
 * The dependency graph — `REQUIRES`, ACYCLIC (§11.1). `A REQUIRES B` (edge from=A, to=B)
 * means B is a prerequisite of A. Acyclicity is argued, not asserted: a genuine cycle
 * would make a subject unlearnable, so an apparent cycle is a reinforcement relationship
 * misfiled as a prerequisite (§11.1). This is the ONLY graph that is ever topologically
 * sorted (§18B.3).
 *
 * W6: this file MUST NOT import graph/reinforcement.ts. Shared primitives come from the
 * neutral traverse.ts, never from another graph module.
 */

const edgesOf = (deps: DependencyEdge[]): Edge[] => deps.map((d) => ({ from: d.fromId, to: d.toId }));

/** `dependency-dag` invariant: REQUIRES is acyclic. Returns a cycle path if not. */
export function findCycle(deps: DependencyEdge[]): string[] | null {
  return detectCycle(edgesOf(deps));
}
export function isAcyclic(deps: DependencyEdge[]): boolean {
  return findCycle(deps) === null;
}

/** V7 — a proposed `A REQUIRES B` must close no cycle. */
export function wouldViolateAcyclicity(deps: DependencyEdge[], fromId: string, toId: string): boolean {
  return wouldCreateCycle(edgesOf(deps), fromId, toId);
}

/**
 * Prerequisite closure of `seeds`, bounded (§18B). Following REQUIRES forward (A→B)
 * yields prerequisites. maxDepth/maxNodes are mandatory; truncation is reported.
 */
export function prerequisiteClosure(deps: DependencyEdge[], seeds: string[], maxDepth: number, maxNodes: number) {
  return boundedTraverse(seeds, adjacencyFrom(edgesOf(deps), "forward"), maxDepth, maxNodes);
}

/**
 * A learning order: prerequisites before dependents, deterministic (§18B.3). Since
 * `A REQUIRES B` means B first, the precedence edge is B→A. Tie-break defaults to id
 * order; a program's `Mapping.ordinal` is threaded in by the caller at M4.
 */
export function learningOrder(deps: DependencyEdge[], tieBreak?: (a: string, b: string) => number) {
  const precedence: Edge[] = deps.map((d) => ({ from: d.toId, to: d.fromId }));
  return kahnTopoSort(precedence, tieBreak);
}
