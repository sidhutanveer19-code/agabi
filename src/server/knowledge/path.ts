import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import type { TrustPolicy, TrustLevel } from "@/server/knowledge/types";
import { prerequisiteClosure, learningOrder } from "@/server/knowledge/graph/dependency";

/**
 * Path selection (§16, §18B.3). Given seed concepts, produce a DETERMINISTIC learning
 * order: prerequisites first, Kahn with tie-break by id, so identical graph + seeds always
 * yield the identical plan (that is what makes a lesson replayable). `selectPath` takes NO
 * learner input by design (§4) — personalisation is Phase 3; the `learner` slot exists so
 * the signature is stable, and is deliberately unused here.
 *
 * `trustPolicy` is required and echoed as `policyFloor`: the plan is a sequence of concepts,
 * and the content fetched per concept (M5) must honour this floor — the caller cannot forget
 * it because it cannot construct a plan without it.
 */
export interface PathBudget {
  maxConcepts: number;
}

export interface LessonPlan {
  concepts: string[]; // ordered: prerequisites before dependents
  truncated: boolean; // hit the budget before covering the full closure
  policyFloor: TrustLevel; // the trust floor content fetches must respect (M5)
}

export interface SelectPathOptions {
  seeds: string[];
  policy: TrustPolicy;
  budget: PathBudget;
  objective?: string;
  learner?: unknown; // unused by design (§4) — no personalisation in Phase 2
  releaseId?: string; // when set, prerequisite closures are cached (§18)
}

export async function selectPath(store: KnowledgeStore, opts: SelectPathOptions): Promise<LessonPlan> {
  const edges = await store.dependencyEdges();

  // Bounded prerequisite closure over all seeds (§18B) — maxNodes = the concept budget.
  const closure = prerequisiteClosure(edges, opts.seeds, opts.budget.maxConcepts, opts.budget.maxConcepts);
  const inScope = new Set(closure.nodes.map((n) => n.id));
  for (const s of opts.seeds) inScope.add(s);

  // Order only the edges within the closure, then Kahn (deterministic).
  const scopedEdges = edges.filter((e) => inScope.has(e.fromId) && inScope.has(e.toId));
  const { order } = learningOrder(scopedEdges);

  // Concepts with no edges never enter Kahn's node set — append them deterministically.
  const ordered = order.filter((id) => inScope.has(id));
  const isolated = [...inScope].filter((id) => !order.includes(id)).sort();
  const concepts = [...ordered, ...isolated].slice(0, opts.budget.maxConcepts);

  return { concepts, truncated: closure.truncated || inScope.size > opts.budget.maxConcepts, policyFloor: opts.policy.minimum };
}

/**
 * A cached prerequisite closure (§18, ADR-11). Rebuildable and never authoritative: if a
 * cache entry exists for (concept, release) it is returned; otherwise it is computed and
 * stored. Any review commit clears the whole cache (`store.clearClosures`), and a rebuild
 * is byte-identical — the `cache-rebuild` invariant.
 */
export async function cachedPrerequisites(
  store: KnowledgeStore,
  conceptId: string,
  releaseId: string,
  budget: PathBudget,
): Promise<string[]> {
  const cached = await store.getClosure(conceptId, releaseId);
  if (cached) return cached.closure;

  const edges = await store.dependencyEdges();
  const closure = prerequisiteClosure(edges, [conceptId], budget.maxConcepts, budget.maxConcepts);
  const inScope = new Set(closure.nodes.map((n) => n.id));
  inScope.add(conceptId);
  const scopedEdges = edges.filter((e) => inScope.has(e.fromId) && inScope.has(e.toId));
  const ordered = learningOrder(scopedEdges).order.filter((id) => inScope.has(id));

  await store.putClosure({ conceptId, releaseId, closure: ordered, computedAt: new Date() });
  return ordered;
}

/**
 * An outline seed for the teaching bridge (M5): the ordered concept ids a lesson will cover.
 * The Teaching Engine turns these into a lesson; when the path is empty it falls back to a
 * default outline and records `knowledge.miss` (M5).
 */
export function outlineFrom(plan: LessonPlan): string[] {
  return plan.concepts;
}
