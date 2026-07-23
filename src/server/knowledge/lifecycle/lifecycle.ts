import { type TrustLevel, trustRank } from "@/server/knowledge/types";

/**
 * The content-lifecycle state machine (W8) — the Knowledge Authoring Workspace, backend. It governs
 * how a knowledge object moves from draft to published to archived, ORTHOGONALLY to the trust ladder
 * (trust = "how sure are we?"; lifecycle = "where is it in the publishing pipeline?").
 *
 * It is DERIVED, never stored (ADR-11): a pure function of an object's trust, its review decisions,
 * and whether it was superseded. No new column, no new table — the review-event audit trail IS the
 * transition history. `DISPUTED` (§26.5) is a lateral flag, not a state.
 */
export const LIFECYCLE_STATES = ["DRAFT", "IN_REVIEW", "APPROVED", "PUBLISHED", "DEPRECATED", "ARCHIVED"] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

/**
 * Legal transitions — monotonic-forward, because the derivation is over an append-only history
 * (§L5): there is no "un-review". Nothing skips review; nothing publishes unapproved; ARCHIVED is
 * terminal. Rework is a NEW version (a fresh DRAFT that supersedes), not a backward edge.
 */
export const TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  DRAFT: ["IN_REVIEW"],
  IN_REVIEW: ["APPROVED"],
  APPROVED: ["PUBLISHED", "DEPRECATED"],
  PUBLISHED: ["DEPRECATED"],
  DEPRECATED: ["ARCHIVED"],
  ARCHIVED: [],
};

export function canTransition(from: LifecycleState, to: LifecycleState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Throw on an illegal transition — the governance guard every transition passes through. */
export function assertTransition(from: LifecycleState, to: LifecycleState): void {
  if (!canTransition(from, to)) {
    throw new Error(`illegal lifecycle transition ${from} → ${to} (legal: ${TRANSITIONS[from].join(", ") || "none"})`);
  }
}

/** The review decisions that drive lifecycle (a superset of the trust decisions). */
export type LifecycleDecision = "PROMOTE" | "APPROVE" | "PUBLISH" | "DEPRECATE" | "DEMOTE" | "ARCHIVE";

export interface LifecycleInputs {
  trustLevel: TrustLevel;
  superseded: boolean; // a newer version supersedes this one
  decisions: string[]; // ReviewEvent.decision history for this object (any order)
}

const HUMAN_FLOOR = trustRank("AUTO_VALIDATED");

/**
 * Derive the lifecycle state purely from trust + supersession + review history — no stored state.
 * Precedence: ARCHIVE decision → ARCHIVED; superseded/DEPRECATE → DEPRECATED; PUBLISH → PUBLISHED;
 * human-approved trust → APPROVED; any review touched it → IN_REVIEW; otherwise DRAFT.
 */
export function lifecycleOf(input: LifecycleInputs): LifecycleState {
  const d = new Set(input.decisions);
  if (d.has("ARCHIVE")) return "ARCHIVED";
  if (input.superseded || d.has("DEPRECATE") || d.has("DEMOTE")) return "DEPRECATED";
  if (d.has("PUBLISH")) return "PUBLISHED";
  if (trustRank(input.trustLevel) > HUMAN_FLOOR) return "APPROVED"; // human ReviewEvent lifted it (§26.2)
  if (input.decisions.length > 0) return "IN_REVIEW"; // a reviewer has looked
  return "DRAFT"; // freshly proposed, untouched
}
