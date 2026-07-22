import { type TrustLevel, type ReviewEvent, trustRank, HUMAN_FLOOR } from "@/server/knowledge/types";

/**
 * The trust ladder promotion function (§26.2) — deterministic, and the home of the
 * `trust-gate` invariant: ANYTHING above `AUTO_VALIDATED` requires a `ReviewEvent` with a
 * human `actorId`. No exception, no threshold, no override. A machine can carry a statement
 * to AUTO_VALIDATED by passing every validator; it can go no further without a person.
 *
 * `promote` computes the HIGHEST level the evidence justifies. Each rung above the human
 * floor is unlocked only by a matching human review (and, for the top domain rungs, the
 * reviewer's entitlement). Demotion (§26.3) and DISPUTED suspension (§26.5) are M6.
 */

export interface PromotionInputs {
  validatorsPass: boolean;
  independentSourceCount: number;
  hasOpenHigherTrustContradiction: boolean;
  reviewEvents: ReviewEvent[]; // decisions on THIS target
  designatedAuthorities: ReadonlySet<string>;
  authority?: string | null;
  reviewerReputation: (actorId: string) => number;
  isCredentialedExpert: (actorId: string) => boolean;
  communityThreshold: number;
}

const isHuman = (e: ReviewEvent) => e.actorId.trim().length > 0;

/** A human PROMOTE review targeting exactly `toTrust`. */
function humanPromoteTo(events: ReviewEvent[], toTrust: TrustLevel): ReviewEvent | undefined {
  return events.find((e) => e.decision === "PROMOTE" && e.toTrust === toTrust && isHuman(e));
}

export function promote(inputs: PromotionInputs): TrustLevel {
  const e = inputs.reviewEvents;

  // ── rungs above the human floor: each needs a human ReviewEvent ──
  if (humanPromoteTo(e, "AGABI_CANONICAL")) return "AGABI_CANONICAL"; // editorial decision

  const osv = humanPromoteTo(e, "OFFICIAL_SOURCE_VERIFIED");
  if (osv && inputs.authority && inputs.designatedAuthorities.has(inputs.authority)) {
    return "OFFICIAL_SOURCE_VERIFIED";
  }

  const expert = humanPromoteTo(e, "EXPERT_REVIEWED");
  if (expert && inputs.isCredentialedExpert(expert.actorId)) return "EXPERT_REVIEWED";

  // COMMUNITY_REVIEWED — Σ reputation of DISTINCT human reviewers who approved/promoted.
  const reviewers = new Map<string, number>();
  for (const ev of e) {
    if ((ev.decision === "APPROVE" || ev.decision === "PROMOTE") && isHuman(ev)) {
      reviewers.set(ev.actorId, inputs.reviewerReputation(ev.actorId));
    }
  }
  const reputation = [...reviewers.values()].reduce((a, b) => a + b, 0);
  if (reputation >= inputs.communityThreshold && reviewers.size > 0) return "COMMUNITY_REVIEWED";

  // ── the machine ceiling ──
  if (inputs.validatorsPass && inputs.independentSourceCount >= 1 && !inputs.hasOpenHigherTrustContradiction) {
    return "AUTO_VALIDATED";
  }
  return "MACHINE_PROPOSED";
}

/** True when a level may not be reached without a human review (§26.2). */
export function requiresHumanReview(level: TrustLevel): boolean {
  return trustRank(level) > trustRank(HUMAN_FLOOR);
}
