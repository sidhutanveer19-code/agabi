/**
 * The human-actor guard (§26.2, §27, ADR-10).
 *
 * "No level above `AUTO_VALIDATED` is reached without a human `ReviewEvent`" is the single invariant
 * the whole trust ladder rests on. It was enforced in exactly one place — `review/merge.ts` threw on
 * a blank actor — while the structurally identical lifecycle path
 * (`lifecycle/transition.ts` → `commitReview` on APPROVED) took any string at all and relied on a
 * code comment. A machine actor could therefore promote a statement past the machine ceiling, and
 * every test still passed, because no test supplied a non-human actor.
 *
 * One guard, used by every path that crosses the human floor, so the two cannot drift apart again.
 *
 * What counts as "not a human" is deliberately NOT a heuristic over arbitrary names — guessing that
 * "adminbot" is machine and "Roberta" is human is how a guard starts rejecting real reviewers. It is
 * the machine-actor namespace this codebase actually uses: the ingest orchestrator writes its events
 * as `system:ingest`, so `system:` is a reserved machine prefix, and blank is blank.
 */

/** Actor ids the platform itself writes. Reserved: never a valid reviewer. */
export const MACHINE_ACTOR_PREFIX = "system:";

export function isHumanActor(actorId: string): boolean {
  const id = actorId.trim();
  if (id.length === 0) return false;
  return !id.toLowerCase().startsWith(MACHINE_ACTOR_PREFIX);
}

/**
 * Throw unless `actorId` is a human. `action` names the caller so the message says what was refused
 * ("promotion to APPROVED requires a human actorId") rather than just that something failed.
 */
export function assertHumanActor(actorId: string, action: string): void {
  if (!isHumanActor(actorId)) {
    const shown = actorId.trim() || "(blank)";
    throw new Error(`${action} requires a human actorId (§26.2) — got ${shown}`);
  }
}
