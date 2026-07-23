/**
 * The omission record (R1 — never silently skip).
 *
 * Every place the pipeline drops, rejects, collapses or skips something appends one of these. The
 * run report is assembled from them, so a count in a summary can always be expanded into the list
 * of individual things it stands for, each with its reason. A counter without a matching record is
 * a defect, not a summary.
 *
 * Pure data — no store, no IO. The orchestrator returns them; the population controller persists
 * them alongside its checkpoint.
 */

export type OmissionStage = "convert" | "accept" | "validate" | "resolve" | "persist" | "chapter";

export type OmissionKind =
  | "batch-discard" // the payload was not an array at all — nothing could be accepted
  | "element-discard" // ONE proposal failed the trust-boundary schema; the rest of the batch survived (A-6)
  | "statement-rejected" // a validation gate killed a statement proposal
  | "dependency-rejected" // a validation gate killed an edge proposal
  | "subject-unresolved" // a statement has no nameable subject concept
  | "duplicate-skipped" // collapsed into an existing object
  | "barren-chunk" // a chunk yielded no statement
  | "chapter-failed"; // a chapter threw and was NOT marked done

export interface Omission {
  stage: OmissionStage;
  kind: OmissionKind;
  chunkId?: string;
  targetId?: string; // statement/concept/source id when one exists
  reason: string; // human-readable, always populated
  data?: Record<string, unknown>; // gate id, zod path, collapsed-into id, …
}

/** Group omissions by kind for a report header. The detail list is never discarded. */
export function summariseOmissions(omissions: Omission[]): Record<string, number> {
  const by: Record<string, number> = {};
  for (const o of omissions) by[o.kind] = (by[o.kind] ?? 0) + 1;
  return by;
}
