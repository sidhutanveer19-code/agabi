import type { ObservationStore } from "@/server/observation/store";
import type { EfficacyEstimate } from "@/server/observation/types";

/**
 * Asset efficacy from observations (§13.4) — did learners who received this asset succeed
 * afterwards? A pure query; no `quality` column, no stored rollup. An authored rating is an
 * opinion; this is evidence.
 */
export async function efficacy(store: ObservationStore, assetId: string, contextId?: string): Promise<EfficacyEstimate> {
  let obs = await store.forAsset(assetId);
  if (contextId) obs = obs.filter((o) => o.contextId === contextId);
  const exposures = obs.length;
  const subsequentSuccess = obs.filter((o) => o.outcome.success).length;
  return { assetId, contextId: contextId ?? null, exposures, subsequentSuccess, rate: exposures > 0 ? subsequentSuccess / exposures : 0 };
}
