import type { RawStatement, RawDependency } from "@/server/knowledge/extraction/types";
import type { DependencyEdge, CompositionEdge } from "@/server/knowledge/types";
import type { DimensionRegistry } from "@/server/knowledge/context/registry";
import type { ValidationResult } from "@/server/knowledge/validators/types";
import { v3Grounding, v4QuoteLength, v5Originality } from "@/server/knowledge/validators/grounding";
import { v2Kind, v11ContextValidity, v12Units, v14AnalogyBreakdown, v15SelfReference } from "@/server/knowledge/validators/structure";
import { v7DependencyAcyclic, v8CompositionAcyclic, v9EdgeClassification, v10GraphConflict, type ResolvedEdge } from "@/server/knowledge/validators/graph";

export * from "@/server/knowledge/validators/types";
export * from "@/server/knowledge/validators/grounding";
export * from "@/server/knowledge/validators/graph";
export * from "@/server/knowledge/validators/scope";
export * from "@/server/knowledge/validators/structure";

/**
 * The validation runner (§14). Applies the gates applicable to each proposal kind and
 * aggregates. "Passing every applicable gate IS `AUTO_VALIDATED`" (§14) — a defined
 * epistemic state, not a waiting room — so `validatorsPass` here is exactly the input the
 * trust ladder needs for its AUTO_VALIDATED rung (§26.2). A `discard`/`reject` kills the
 * proposal; a `flag`/`human` keeps it but denies auto-validation (it needs a person).
 */
export type BatchStatus = "REJECTED" | "FLAGGED" | "NEEDS_HUMAN" | "AUTO_VALIDATED";

export interface StatementCtx {
  chunkText: string;
  registry: DimensionRegistry;
}

/** Run every gate applicable to a statement, in gate order. */
export function validateStatement(statement: RawStatement, ctx: StatementCtx): ValidationResult[] {
  return [
    v2Kind(statement),
    v3Grounding(statement, ctx.chunkText),
    v4QuoteLength(statement),
    v5Originality(statement),
    v11ContextValidity(statement.contextDimensions, ctx.registry),
    v12Units(statement),
    v15SelfReference(statement),
  ];
}

/**
 * Gates applicable to a proposed teaching asset. V14 is the one that matters: §13.3 — an ANALOGY
 * that does not say where it breaks down INSTALLS a misconception, which is worse than teaching
 * nothing. The gate existed and was tested from M7, but nothing ran it: the orchestrator persisted
 * assets straight from extraction, so an analogy with no breakdown point reached the graph.
 */
export function validateAsset(asset: { kind: string; payload: Record<string, unknown> }): ValidationResult[] {
  return [v14AnalogyBreakdown(asset)];
}

export interface DependencyCtx {
  edge: ResolvedEdge;
  dependency: DependencyEdge[];
  composition: CompositionEdge[];
}

/** Run the gates applicable to a proposed edge by its classification. V9 is ALWAYS present. */
export function validateDependency(dep: RawDependency, ctx: DependencyCtx): ValidationResult[] {
  const results: ValidationResult[] = [v9EdgeClassification(dep)];
  if (dep.classification === "REQUIRES") {
    results.push(v7DependencyAcyclic(ctx.edge, ctx.dependency));
    results.push(v10GraphConflict(ctx.edge, ctx.dependency));
  } else if (dep.classification === "PART_OF") {
    results.push(v8CompositionAcyclic(ctx.edge, ctx.composition));
  } else {
    // REINFORCEMENT — the pair must not already be a REQUIRES in the same direction.
    results.push(v10GraphConflict(ctx.edge, ctx.dependency));
  }
  return results;
}

/** Aggregate a proposal's gate results into a status. */
export function summarise(results: ValidationResult[]): BatchStatus {
  if (results.some((r) => r.outcome === "reject" || r.outcome === "discard")) return "REJECTED";
  if (results.some((r) => r.outcome === "human")) return "NEEDS_HUMAN";
  if (results.some((r) => r.outcome === "flag")) return "FLAGGED";
  return "AUTO_VALIDATED";
}

/** True iff every applicable gate passed cleanly — the AUTO_VALIDATED precondition (§26.2). */
export function validatorsPass(results: ValidationResult[]): boolean {
  return results.every((r) => r.outcome === "pass");
}

/** Any V13 (or other) security alert raised across a proposal's gates. */
export function hasSecurityAlert(results: ValidationResult[]): boolean {
  return results.some((r) => r.securityAlert === true);
}
