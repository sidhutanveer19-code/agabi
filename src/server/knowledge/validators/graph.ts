import type { RawDependency } from "@/server/knowledge/extraction/types";
import type { DependencyEdge, CompositionEdge } from "@/server/knowledge/types";
import { wouldViolateAcyclicity as depWouldCycle } from "@/server/knowledge/graph/dependency";
import { wouldViolateAcyclicity as compWouldCycle } from "@/server/knowledge/graph/composition";
import { wouldConflict } from "@/server/knowledge/graph/conflict";
import { pass, type ValidationResult } from "@/server/knowledge/validators/types";

/**
 * Graph-integrity gates V7–V10 (§14). These are the ones that keep the DAG honest: a
 * proposed edge that would close a cycle is REJECTED with the offending cycle shown (§11.1),
 * and an edge already present in the dependency graph cannot be re-added as reinforcement
 * in the same direction (§11.5). Edge classification itself (V9) is ALWAYS human — no trust
 * level lets a machine decide prerequisite vs reinforcement vs composition.
 *
 * The proposal carries names; the caller resolves them to ids before these run.
 */
export interface ResolvedEdge {
  fromId: string;
  toId: string;
}

/** V7 — a proposed REQUIRES must close no cycle in the dependency graph. */
export function v7DependencyAcyclic(edge: ResolvedEdge, existing: DependencyEdge[]): ValidationResult {
  if (depWouldCycle(existing, edge.fromId, edge.toId)) {
    return { validator: "V7", outcome: "reject", reason: "WOULD_CLOSE_DEPENDENCY_CYCLE", detail: edge };
  }
  return pass("V7");
}

/** V8 — a proposed PART_OF must close no cycle in the composition graph. */
export function v8CompositionAcyclic(edge: ResolvedEdge, existing: CompositionEdge[]): ValidationResult {
  if (compWouldCycle(existing, edge.fromId, edge.toId)) {
    return { validator: "V8", outcome: "reject", reason: "WOULD_CLOSE_COMPOSITION_CYCLE", detail: edge };
  }
  return pass("V8");
}

/** V9 — edge classification (prereq / composition / reinforcement) is ALWAYS human-confirmed. */
export function v9EdgeClassification(dep: RawDependency): ValidationResult {
  return { validator: "V9", outcome: "human", reason: `CLASSIFY_${dep.classification}_NEEDS_HUMAN` };
}

/** V10 — a proposed reinforcement pair must not already be a REQUIRES in the same direction (§11.5). */
export function v10GraphConflict(edge: ResolvedEdge, dependency: DependencyEdge[]): ValidationResult {
  if (wouldConflict(dependency, edge.fromId, edge.toId)) {
    return { validator: "V10", outcome: "reject", reason: "PAIR_ALREADY_REQUIRES", detail: edge };
  }
  return pass("V10");
}
