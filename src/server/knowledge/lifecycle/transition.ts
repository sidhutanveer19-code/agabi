import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import type { ReviewEvent } from "@/server/knowledge/types";
import { mintId } from "@/server/knowledge/ids";
import { type LifecycleState, assertTransition, lifecycleOf } from "@/server/knowledge/lifecycle/lifecycle";
import { assertHumanActor } from "@/server/knowledge/review/actor";

/**
 * Governed lifecycle transitions (W8). Every transition is an ATOMIC APPEND: derive the current
 * state, reject an illegal move (`assertTransition`), then record a `ReviewEvent` whose decision
 * drives the derivation forward. APPROVED additionally promotes trust through the ONE atomic trust
 * writer (`commitReview`, §26.2). Nothing is ever deleted (L5); "rework" is a new version.
 */
const DECISION_FOR: Record<LifecycleState, string> = {
  DRAFT: "REWORK",
  IN_REVIEW: "REVIEW",
  APPROVED: "PROMOTE",
  PUBLISHED: "PUBLISH",
  DEPRECATED: "DEPRECATE",
  ARCHIVED: "ARCHIVE",
};

/** Derive a statement's current lifecycle state from the store (trust + review history). */
export async function statementLifecycle(store: KnowledgeStore, statementId: string): Promise<LifecycleState | null> {
  const s = await store.getStatementRaw(statementId);
  if (!s) return null;
  const events = await store.reviewEventsFor("Statement", statementId);
  return lifecycleOf({ trustLevel: s.trustLevel, superseded: false, decisions: events.map((e) => e.decision) });
}

export interface TransitionOutcome {
  from: LifecycleState;
  to: LifecycleState;
  eventId: string;
}

/** Move a statement to `to` — validated, audited, atomic. Illegal transitions throw. */
export async function transitionStatement(store: KnowledgeStore, statementId: string, to: LifecycleState, actorId: string, reason: string | null = null): Promise<TransitionOutcome> {
  // §26.2 — enforced, not asserted in a comment. APPROVED crosses the human floor via
  // commitReview below, so a machine or blank actor must be refused BEFORE any write.
  assertHumanActor(actorId, `lifecycle transition to ${to}`);

  const s = await store.getStatementRaw(statementId);
  if (!s) throw new Error(`statement ${statementId} not found`);
  const events = await store.reviewEventsFor("Statement", statementId);
  const from = lifecycleOf({ trustLevel: s.trustLevel, superseded: false, decisions: events.map((e) => e.decision) });
  assertTransition(from, to);

  const event: ReviewEvent = {
    id: mintId(),
    targetKind: "Statement",
    targetId: statementId,
    decision: DECISION_FOR[to],
    fromTrust: s.trustLevel,
    toTrust: to === "APPROVED" ? "COMMUNITY_REVIEWED" : null,
    actorId, // a human — guaranteed by assertHumanActor above (§26.2)
    before: null,
    after: null,
    reason,
    batchId: null,
    createdAt: new Date(),
  };

  if (to === "APPROVED") {
    // APPROVED crosses the human floor: promote trust atomically through the one trust writer.
    await store.commitReview(event, { targetKind: "Statement", targetId: statementId, trustLevel: "COMMUNITY_REVIEWED" });
  } else {
    await store.putReviewEvent(event);
  }
  return { from, to, eventId: event.id };
}
