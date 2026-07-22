import type { ObservationStore } from "@/server/observation/store";
import type { MasteryEstimate } from "@/server/observation/types";

/**
 * Mastery is a QUERY (§20.2), never a stored row. Phase 2 computes a naive success rate — no
 * decay, no forgetting curve, no Bayesian tracing (X4/Phase 3). The point of computing on read
 * is that improving the estimator later REINTERPRETS all history instead of invalidating it; a
 * stored mastery row could not have been recomputed.
 */
export async function mastery(
  store: ObservationStore,
  learnerId: string,
  conceptId: string,
  atBloom?: string,
  asOf?: Date,
): Promise<MasteryEstimate> {
  let obs = (await store.byConcept(conceptId)).filter((o) => o.learnerId === learnerId);
  if (atBloom) obs = obs.filter((o) => o.bloomLevel === atBloom);
  if (asOf) obs = obs.filter((o) => o.occurredAt <= asOf);
  const n = obs.length;
  const successes = obs.filter((o) => o.outcome.success).length;
  return { learnerId, conceptId, estimate: n > 0 ? successes / n : 0, observations: n, atBloom: atBloom ?? null };
}
