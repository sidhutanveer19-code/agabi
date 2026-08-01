import { mintId } from "@/server/knowledge/ids";
import type { ObservationStore } from "@/server/observation/store";
import type { NewObservation, Observation } from "@/server/observation/types";

/**
 * Record an observation (§17.1). `contextId` is REQUIRED — an observation with no context is
 * unapportionable if its concept is later split (§20.3), and "one column now, unrecoverable
 * later". Ids use the shared A-1 generator (knowledge/ids is a util, not the store — W4 only
 * bars knowledge/store). An observation is append-only; there is no update.
 */
export async function record(store: ObservationStore, obs: NewObservation): Promise<Observation> {
  if (!obs.contextId?.trim()) throw new Error("observation requires a contextId (§20.3 — makes a split resolvable)");
  const o: Observation = {
    id: mintId(),
    learnerId: obs.learnerId,
    taskId: obs.taskId ?? null,
    conceptIds: obs.conceptIds,
    contextId: obs.contextId,
    outcome: obs.outcome,
    bloomLevel: obs.bloomLevel ?? null,
    assetIds: obs.assetIds ?? [],
    releaseId: obs.releaseId,
    occurredAt: obs.occurredAt ?? new Date(),
  };
  await store.record(o);
  return o;
}
