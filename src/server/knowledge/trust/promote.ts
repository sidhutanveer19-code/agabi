import { type TrustLevel, trustRank, HUMAN_FLOOR } from "@/server/knowledge/types";
import { promote as ladderPromote, type PromotionInputs } from "@/server/knowledge/trust/ladder";
import { anyContradiction, type ContradictionInput } from "@/server/knowledge/trust/contradiction";

/**
 * Trust recomputation + demotion (§14.3, §26.3). Wraps the deterministic ladder (§26.2) with
 * contradiction handling: a candidate that conflicts with a higher-trust statement in an
 * overlapping context cannot reach AUTO_VALIDATED (§14.3). Demotion is automatic and immediate
 * (§26.3) — trust is NOT a ratchet; the failure being prevented is that nobody gets around to it.
 */
export interface RecomputeInputs extends Omit<PromotionInputs, "hasOpenHigherTrustContradiction"> {
  candidate?: ContradictionInput;
  higherTrust?: ContradictionInput[];
}

export function recomputeTrust(inputs: RecomputeInputs): TrustLevel {
  const contradicted =
    inputs.candidate && inputs.higherTrust ? anyContradiction(inputs.candidate, inputs.higherTrust) : false;
  return ladderPromote({ ...inputs, hasOpenHigherTrustContradiction: contradicted });
}

/** Whether a recomputed level is strictly lower than the current — i.e. a demotion happened. */
export function demotesBelow(current: TrustLevel, recomputed: TrustLevel): boolean {
  return trustRank(recomputed) < trustRank(current);
}

export type DemotionTrigger = "CONTRADICTION" | "SOURCE_RETRACTED" | "DISPUTE_OPENED" | "VALIDATOR_FAILED";

/**
 * How a demotion trigger disposes of a statement (§26.3 vs §26.5). A human-reviewed statement
 * (above the floor) is SUSPENDED via a dispute — its level is preserved so resolution is one
 * decision, not a re-verification (§26.5). A machine-level statement is simply DEMOTED to
 * MACHINE_PROPOSED, losing its automatic validation. Either way it stops being served at once.
 */
export function disposition(current: TrustLevel, trigger: DemotionTrigger): { kind: "dispute"; trigger: DemotionTrigger } | { kind: "demote"; to: TrustLevel } {
  if (trustRank(current) > trustRank(HUMAN_FLOOR)) return { kind: "dispute", trigger };
  return { kind: "demote", to: "MACHINE_PROPOSED" };
}
