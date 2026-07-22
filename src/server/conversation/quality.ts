import type { SlotState } from "@/server/conversation/outline";

/**
 * Lesson Quality — deterministic, backend-owned, computed ON READ from evidence
 * (invariant 2: never persisted). Inputs are the per-slot states (a cache rebuildable
 * from slot.filled/slot.failed events, invariant 8); the score is recomputed every
 * time, so a formula change reinterprets history rather than invalidating it.
 */
export type LessonOutcome = "COMPLETE" | "PARTIAL" | "FAILED";

export interface QualityReport {
  outcome: LessonOutcome;
  plannedCount: number;
  readyCount: number;
  failedIndices: number[]; // slot numbers that are FAILED/SKIPPED
  why: string;
}

/** A slot is "ready" unless it is explicitly FAILED/SKIPPED. (Pre-Stage-B rows normalize
 *  to READY upstream, so historical lessons score COMPLETE, never fabricated-degraded.) */
export function scoreLesson(slots: { slot?: number; state?: SlotState }[]): QualityReport {
  const planned = slots.length;
  const failed = slots.filter((s) => s.state === "FAILED" || s.state === "SKIPPED");
  const readyCount = planned - failed.length;
  const failedIndices = failed.map((s, i) => s.slot ?? i);

  let outcome: LessonOutcome;
  let why: string;
  if (planned === 0) { outcome = "FAILED"; why = "no slots planned"; }
  else if (readyCount === 0) { outcome = "FAILED"; why = "zero READY blocks (all-skeleton lesson)"; }
  else if (failed.length === 0) { outcome = "COMPLETE"; why = "all blocks READY"; }
  else { outcome = "PARTIAL"; why = `${failed.length} of ${planned} blocks could not be generated`; }

  return { outcome, plannedCount: planned, readyCount, failedIndices, why };
}
