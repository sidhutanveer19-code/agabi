import { type TrustLevel, trustRank, TRUST_LEVELS } from "@/server/knowledge/types";

/**
 * Inference with recorded derivation (§26.6). A statement derived from premises inherits the
 * WEAKEST premise's trust level — a conclusion is never more trustworthy than its shakiest
 * input. The derivation chain is recorded (`derivedFrom`) so the inference is auditable and
 * re-checkable, and demotes automatically if a premise is later demoted (§26.3).
 */

/** The floor level across premises — the weakest link. Empty premises → MACHINE_PROPOSED. */
export function inferredTrust(premiseLevels: TrustLevel[]): TrustLevel {
  if (premiseLevels.length === 0) return "MACHINE_PROPOSED";
  let weakest = premiseLevels[0];
  for (const l of premiseLevels) if (trustRank(l) < trustRank(weakest)) weakest = l;
  return weakest;
}

export interface Inference {
  derivedFrom: string[];
  trustLevel: TrustLevel;
}

/** Build the derivation record for an inferred statement. */
export function buildInference(premiseIds: string[], premiseLevels: TrustLevel[]): Inference {
  return { derivedFrom: [...premiseIds], trustLevel: inferredTrust(premiseLevels) };
}

/** Sanity guard used in tests/promotion: a level is a valid ladder rung. */
export function isTrustLevel(v: string): v is TrustLevel {
  return (TRUST_LEVELS as readonly string[]).includes(v);
}
