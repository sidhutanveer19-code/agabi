import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import { applyReview, type ReviewDecision, type Role } from "@/server/knowledge/review/decide";
import { mintId } from "@/server/knowledge/ids";
import { trustRank, HUMAN_FLOOR, type ReviewEvent, type ReviewEffect } from "@/server/knowledge/types";

/**
 * The review facade (§25). Ties the pieces together: fetch the target's current state and
 * prior reviews, run the decision through `applyReview` (which enforces role + human floor),
 * then commit the event and its effect ATOMICALLY through the store. This is the sanctioned
 * entry point a CLI or API calls; it never lets a caller write trust directly.
 *
 * Re-exports the queue/batch/decide surface so callers import one module.
 */
export * from "@/server/knowledge/review/queue";
export * from "@/server/knowledge/review/batch";
export * from "@/server/knowledge/review/decide";

/** Governance knobs (§26.2) supplied by the deployment, not guessed by the reviewer. */
export interface GovernanceConfig {
  designatedAuthorities: ReadonlySet<string>;
  reviewerReputation: (actorId: string) => number;
  isCredentialedExpert: (actorId: string) => boolean;
  communityThreshold: number;
  /** Contradiction detection is M6; until then it defaults false, documented. */
  hasOpenHigherTrustContradiction?: (targetId: string) => boolean;
}

export async function submitStatementReview(
  store: KnowledgeStore,
  decision: ReviewDecision,
  role: Role,
  config: GovernanceConfig,
  now: Date = new Date(),
): Promise<{ event: ReviewEvent; effect: ReviewEffect }> {
  const current = await store.getStatementRaw(decision.targetId);
  if (!current) throw new Error(`statement ${decision.targetId} not found`);
  const priorReviewEvents = await store.reviewEventsFor("Statement", decision.targetId);

  const { event, effect } = applyReview(decision, {
    role,
    current: { trustLevel: current.trustLevel, disputed: current.disputed, priorTrustLevel: current.priorTrustLevel },
    promotion: {
      // Reaching at least the human floor means the validators had passed (§26.2).
      validatorsPass: trustRank(current.trustLevel) >= trustRank(HUMAN_FLOOR),
      independentSourceCount: current.independentSourceCount,
      hasOpenHigherTrustContradiction: config.hasOpenHigherTrustContradiction?.(decision.targetId) ?? false,
      designatedAuthorities: config.designatedAuthorities,
      authority: current.authority,
      reviewerReputation: config.reviewerReputation,
      isCredentialedExpert: config.isCredentialedExpert,
      communityThreshold: config.communityThreshold,
      priorReviewEvents,
    },
    now,
    mintId,
  });

  await store.commitReview(event, effect);
  return { event, effect };
}
