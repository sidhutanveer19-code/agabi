import {
  extractClaims,
  gradeClaim,
  groundedness,
  releaseRule,
  type ClaimLabel,
  type ReleaseVerdict,
} from "@/server/conversation/evidence";

/**
 * Compose the Evidence Verification Engine into a single per-block judgement — the one thing the
 * teaching pipeline calls before a rendered block is allowed to stand as READY. Kept as its own
 * tested unit so the manager's verify hook is proven glue, not untested integration (§H1: no false
 * green). A block is DELIVERABLE only if it RELEASEs or WARNs; a REJECT (any contradiction) or a
 * REGENERATE (below the groundedness floor) is held back and the slot is marked FAILED.
 */
export interface BlockAssessment {
  groundedness: number;
  contradicted: number;
  verdict: ReleaseVerdict;
  labels: ClaimLabel[];
}

export function assessBlock(text: string, passages: string[], threshold = 0.95): BlockAssessment {
  const labels = extractClaims(text).map((claim) => gradeClaim(claim, passages));
  const g = groundedness(labels);
  const contradicted = labels.filter((l) => l === "CONTRADICTED").length;
  return { groundedness: g, contradicted, verdict: releaseRule(g, contradicted, threshold), labels };
}

/** RELEASE or WARN may reach the student; REGENERATE and REJECT must not. */
export function isDeliverable(a: BlockAssessment): boolean {
  return a.verdict === "RELEASE" || a.verdict === "WARN";
}
