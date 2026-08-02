/**
 * The lesson state machine. Deterministic; advisors have NO access. `transition`
 * returns the next state or THROWS on an illegal move — a model can never drive a
 * transition because it never reaches this function.
 */
export type LessonState =
  | "IDLE" | "PLANNING" | "TEACHING" | "WAITING_FOR_STUDENT" | "SIMPLIFYING"
  | "COMPLETED" | "PARTIAL" | "FAILED";
export type LessonEvent =
  | "start" | "planned" | "chunkEmitted" | "continue" | "simplify" | "simplified"
  | "complete" | "partial" | "fail" | "retry";

// PARTIAL/FAILED are terminal like COMPLETED, reachable from TEACHING (a chunk that
// degraded / produced zero READY blocks). The score decides which; the machine only
// enforces that these are legal ends of TEACHING.
// Every edge here must correspond to something a STUDENT can actually do. The table previously
// defined 15 of 80 (state x event) pairs and threw on the other 65 — including moves the UI itself
// offers. Because `transitTo` passed a hardcoded literal as the current state rather than reading the
// row, those illegal moves silently succeeded instead of throwing; once the state is read from
// reality, a missing edge becomes a real crash ("The teacher hit a snag"). So the reachable ones are
// now defined:
//   - simplify from COMPLETED / PARTIAL / FAILED: "I finished it and still don't get it" is the most
//     natural moment to press Simpler, and the UI shows that button after the outcome banner.
//   - retry from WAITING_FOR_STUDENT: a chunk can fail mid-lesson, and `retryLesson` already guards
//     the no-failed-slots case with an early return.
// Simplify always lands in WAITING_FOR_STUDENT; a lesson whose cursor is spent is re-finished from
// there via the existing complete/partial/fail edges, so a terminal lesson can return to terminal.
const TABLE: Record<LessonState, Partial<Record<LessonEvent, LessonState>>> = {
  IDLE: { start: "PLANNING" },
  PLANNING: { planned: "TEACHING" },
  TEACHING: { chunkEmitted: "WAITING_FOR_STUDENT", complete: "COMPLETED", partial: "PARTIAL", fail: "FAILED" },
  WAITING_FOR_STUDENT: { continue: "TEACHING", simplify: "SIMPLIFYING", retry: "TEACHING", complete: "COMPLETED", partial: "PARTIAL", fail: "FAILED" },
  SIMPLIFYING: { simplified: "WAITING_FOR_STUDENT" },
  // Terminal states accept their OWN outcome again as a no-op: re-scoring a lesson that is already
  // PARTIAL must not crash the turn, and after a retry the outcome is recomputed from slot states.
  COMPLETED: { simplify: "SIMPLIFYING", complete: "COMPLETED" },
  // retry re-opens a degraded lesson to regenerate only its FAILED blocks.
  PARTIAL: { retry: "TEACHING", simplify: "SIMPLIFYING", partial: "PARTIAL", complete: "COMPLETED", fail: "FAILED" },
  FAILED: { retry: "TEACHING", simplify: "SIMPLIFYING", fail: "FAILED", complete: "COMPLETED", partial: "PARTIAL" },
};

/** Next state, or throws on an illegal (from,event). This is the guard. */
export function transition(from: LessonState, event: LessonEvent): LessonState {
  const next = TABLE[from]?.[event];
  if (!next) throw new Error(`Illegal lesson transition: ${from} --${event}-->`);
  return next;
}

export const isLessonState = (s: string): s is LessonState =>
  ["IDLE", "PLANNING", "TEACHING", "WAITING_FOR_STUDENT", "SIMPLIFYING", "COMPLETED", "PARTIAL", "FAILED"].includes(s);
