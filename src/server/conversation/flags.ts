/**
 * Phase 2 rollout flag (§I: off by default → turn on gradually; one flip back to normal).
 *
 * SOURCE_GROUNDING=1 turns ON the grounded, problem-first, evidence-verified teaching path
 * (Intent Object → Capability Router corpus gate → grounded outline → Evidence Verification).
 * UNSET/anything-else = today's Phase-1 behaviour, byte-identical — so a bad rollout is one env
 * flip away from safe, and CI's existing smoke/e2e keep exercising the proven default path.
 *
 * Read at CALL time (not module load) so a test can toggle it without re-importing the module.
 */
export function sourceGroundingEnabled(): boolean {
  return process.env.SOURCE_GROUNDING === "1";
}
