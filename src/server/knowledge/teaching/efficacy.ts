import type { AssetEfficacy } from "@/server/knowledge/types";

/**
 * Asset efficacy is OBSERVED, never authored (§13.4). There is no `quality` column — efficacy
 * accumulates from L6 observations: did learners who received this asset perform better
 * afterwards? An authored rating is an opinion; a measured one is evidence. This derives the
 * rollup from exposure/success counts (which the observation store supplies, M8) — it is a
 * pure computation over evidence, storing no conclusion.
 */
export function deriveEfficacy(assetId: string, contextId: string, exposures: number, subsequentSuccess: number, computedAt: Date): AssetEfficacy {
  return { assetId, contextId, exposures, subsequentSuccess, computedAt };
}

/** Success rate — the derived signal, computed on read. Zero exposures → 0 (no evidence yet). */
export function efficacyRate(e: AssetEfficacy): number {
  return e.exposures > 0 ? e.subsequentSuccess / e.exposures : 0;
}
