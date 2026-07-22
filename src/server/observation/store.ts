import type { Observation } from "@/server/observation/types";

/**
 * The observation storage boundary (L6). Memory-first, like the knowledge store (§5.1) — and
 * it exposes the ONE delete path in the whole platform: `purgeUser`, for DPDP erasure (§27.2).
 * That delete is safe precisely because it is in a SEPARATE store (L6): erasing a learner
 * touches no knowledge. This interface never references the knowledge store (W4).
 */
export interface ObservationStore {
  record(observation: Observation): Promise<void>;
  byLearner(learnerId: string): Promise<Observation[]>;
  byConcept(conceptId: string): Promise<Observation[]>;
  forAsset(assetId: string): Promise<Observation[]>;
  all(): Promise<Observation[]>;
  /** DPDP erasure (§27.2): remove every observation for a learner. The one sanctioned delete. */
  purgeUser(learnerId: string): Promise<number>;
}

export function createMemoryObservationStore(): ObservationStore {
  const observations = new Map<string, Observation>();
  return {
    async record(o) {
      observations.set(o.id, o);
    },
    async byLearner(learnerId) {
      return [...observations.values()].filter((o) => o.learnerId === learnerId);
    },
    async byConcept(conceptId) {
      return [...observations.values()].filter((o) => o.conceptIds.includes(conceptId));
    },
    async forAsset(assetId) {
      return [...observations.values()].filter((o) => o.assetIds.includes(assetId));
    },
    async all() {
      return [...observations.values()];
    },
    async purgeUser(learnerId) {
      let removed = 0;
      for (const [id, o] of observations) {
        if (o.learnerId === learnerId) {
          observations.delete(id); // no-delete-ok: DPDP erasure on the observation store only (§27.2, L6)
          removed++;
        }
      }
      return removed;
    },
  };
}
