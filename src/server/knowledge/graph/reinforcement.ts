import type { ReinforcementEdge, ReinforcementType } from "@/server/knowledge/types";
import { type Edge, boundedTraverse, adjacencyFrom } from "@/server/knowledge/graph/traverse";

/**
 * The reinforcement graph — cyclic BY DESIGN (§11.2). `Functions → Derivatives →
 * Optimisation → Functions` is legal and true. There is DELIBERATELY no acyclicity
 * check here: the `reinforcement-cycles-pass` invariant asserts that a cycle in this
 * graph does NOT fail. `COMMON_CONFUSION` is load-bearing for teaching (what to
 * disambiguate before a conflation forms). `earned` distinguishes authored from
 * observation-derived edges.
 *
 * W6/W7: no other graph module imports this one, and this imports none of them —
 * only the neutral traverse.ts. That structural separation is what stops someone
 * running a topological sort over cyclic edges (§11.4).
 */

const edgesOf = (reins: ReinforcementEdge[]): Edge[] => reins.map((r) => ({ from: r.fromId, to: r.toId }));

/** Reinforcement neighbours of `seeds`, bounded (§18B). Cycles terminate via the visited set. */
export function reinforcementClosure(reins: ReinforcementEdge[], seeds: string[], maxDepth: number, maxNodes: number) {
  return boundedTraverse(seeds, adjacencyFrom(edgesOf(reins), "forward"), maxDepth, maxNodes);
}

/** Direct edges of a given type from a concept — e.g. every COMMON_CONFUSION for X. */
export function edgesOfType(reins: ReinforcementEdge[], fromId: string, type: ReinforcementType): ReinforcementEdge[] {
  return reins.filter((r) => r.fromId === fromId && r.type === type);
}
