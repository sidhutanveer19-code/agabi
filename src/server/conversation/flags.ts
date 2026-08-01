/**
 * Phase 2 rollout flag (§I: off by default → turn on gradually; one flip back to normal).
 *
 * SOURCE_GROUNDING=1 turns ON the grounded, problem-first, evidence-verified teaching path
 * (Intent Object → Capability Router corpus gate → grounded outline → Evidence Verification).
 * UNSET/anything-else = today's Phase-1 behaviour, byte-identical — so a bad rollout is one env
 * flip away from safe, and CI's existing smoke/e2e keep exercising the proven default path.
 *
 * THIS MODULE IS THE SINGLE SOURCE OF TRUTH for the flag (Law 19): it declares the default and it
 * is the only production module that reads `process.env.SOURCE_GROUNDING`. `src/env.ts` imports
 * SOURCE_GROUNDING_DEFAULT for its boot-time schema so the value is written down exactly once.
 * Previously env.ts hardcoded `.default("1")` while this file effectively defaulted to OFF — and
 * because Zod defaults populate the PARSED object and are never written back to `process.env`, the
 * two disagreed whenever the variable was unset, with a test suite each asserting the opposite
 * default. `flags.sot.test.ts` pins ownership, agreement, and deterministic rollback.
 *
 * Deliberately dependency-free: this is deployment-safety infrastructure, so it must not drag
 * boot-time env validation (which throws by design) into every module that checks the flag.
 *
 * Read at CALL time (not module load) so a test can toggle it without re-importing the module.
 */

/**
 * The ONE default. `src/env.ts` derives its schema default from this; nothing else declares one.
 *
 * It is deliberately NOT consulted by the reader below: the reader enables the path only on an exact
 * "1", so an unset variable and "0" are already the same answer, and threading the constant through
 * would add a branch that no behaviour can distinguish. Its correctness is enforced instead by
 * `flags.sot.test.ts`, which fails if the parsed env view and this reader ever disagree — so setting
 * this to "1" without also changing the reader turns the build red.
 */
export const SOURCE_GROUNDING_DEFAULT = "0";

export function sourceGroundingEnabled(): boolean {
  return process.env.SOURCE_GROUNDING === "1";
}
