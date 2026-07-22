import { type TrustLevel, type ReviewEvent, type ReviewEffect } from "@/server/knowledge/types";
import { promote, type PromotionInputs } from "@/server/knowledge/trust/ladder";

export type { ReviewEffect };

/**
 * Review decisions (§25, §26, §27). `applyReview` is the ONLY place trust is written above
 * `AUTO_VALIDATED` (§27 — "No role writes above AUTO_VALIDATED outside applyReview"). It
 * produces a `ReviewEvent` (the audit) and a `ReviewEffect` (what to persist), which the
 * store commits ATOMICALLY. Promotion runs the deterministic ladder (§26.2), so the human
 * floor is enforced by construction, not by the reviewer remembering it.
 */

export type Role = "reader" | "reviewer" | "ingestor" | "admin";
/** Only a reviewer writes truth. admin handles releases/deprecation, NOT promotion (§27). */
export function canReview(role: Role): boolean {
  return role === "reviewer";
}

export type Decision = "APPROVE" | "REJECT" | "EDIT" | "PROMOTE" | "DISPUTE" | "RESOLVE";

export interface ReviewDecision {
  targetKind: string;
  targetId: string;
  decision: Decision;
  actorId: string; // a human — always (§27)
  toTrust?: TrustLevel; // for an explicit PROMOTE
  reason?: string;
  batchId?: string;
}

export interface ApplyContext {
  role: Role;
  current: { trustLevel: TrustLevel; disputed: boolean; priorTrustLevel: TrustLevel | null };
  /** Everything promote() needs except the event being applied — that is added here. */
  promotion: Omit<PromotionInputs, "reviewEvents"> & { priorReviewEvents: ReviewEvent[] };
  now: Date;
  mintId: () => string;
}

/**
 * Apply a decision. Throws if the actor is not a reviewer or has no id — a promotion
 * without a human is not a validation nit, it is the failure this whole layer prevents.
 */
export function applyReview(d: ReviewDecision, ctx: ApplyContext): { event: ReviewEvent; effect: ReviewEffect } {
  if (!canReview(ctx.role)) throw new Error(`role ${ctx.role} may not review (§27)`);
  if (d.actorId.trim().length === 0) throw new Error("review requires a human actorId (§27)");

  const eventDecision: ReviewEvent["decision"] = d.decision === "RESOLVE" ? "APPROVE" : d.decision;
  const event: ReviewEvent = {
    id: ctx.mintId(),
    targetKind: d.targetKind,
    targetId: d.targetId,
    decision: eventDecision,
    fromTrust: ctx.current.trustLevel,
    toTrust: d.toTrust ?? null,
    actorId: d.actorId,
    before: null,
    after: null,
    reason: d.reason ?? null,
    batchId: d.batchId ?? null,
    createdAt: ctx.now,
  };

  const effect: ReviewEffect = { targetKind: d.targetKind, targetId: d.targetId };

  switch (d.decision) {
    case "APPROVE":
    case "PROMOTE": {
      // Recompute trust with this event included — the ladder enforces entitlement + floor.
      effect.trustLevel = promote({ ...ctx.promotion, reviewEvents: [...ctx.promotion.priorReviewEvents, event] });
      break;
    }
    case "DISPUTE": {
      // Preserve the level; suspend servability (§26.5). priorTrustLevel is what restores.
      effect.dispute = { disputed: true, reason: d.reason ?? null, priorTrustLevel: ctx.current.trustLevel, at: ctx.now };
      break;
    }
    case "RESOLVE": {
      // Restore prior standing; clear the flag (§26.5).
      effect.dispute = { disputed: false, reason: null, priorTrustLevel: null, at: null };
      effect.trustLevel = ctx.current.priorTrustLevel ?? ctx.current.trustLevel;
      break;
    }
    case "EDIT": {
      // An edit clears a dispute (a new version supersedes the contested one, §26.5).
      if (ctx.current.disputed) effect.dispute = { disputed: false, reason: null, priorTrustLevel: null, at: null };
      break;
    }
    case "REJECT":
      // Records the event; no promotion. (Demotion of an already-stored row is M6.)
      break;
  }

  return { event, effect };
}
