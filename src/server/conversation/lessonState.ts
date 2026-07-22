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
  | "complete" | "partial" | "fail";

// PARTIAL/FAILED are terminal like COMPLETED, reachable from TEACHING (a chunk that
// degraded / produced zero READY blocks). The score decides which; the machine only
// enforces that these are legal ends of TEACHING.
const TABLE: Record<LessonState, Partial<Record<LessonEvent, LessonState>>> = {
  IDLE: { start: "PLANNING" },
  PLANNING: { planned: "TEACHING" },
  TEACHING: { chunkEmitted: "WAITING_FOR_STUDENT", complete: "COMPLETED", partial: "PARTIAL", fail: "FAILED" },
  WAITING_FOR_STUDENT: { continue: "TEACHING", simplify: "SIMPLIFYING", complete: "COMPLETED", partial: "PARTIAL", fail: "FAILED" },
  SIMPLIFYING: { simplified: "WAITING_FOR_STUDENT" },
  COMPLETED: {},
  PARTIAL: {},
  FAILED: {},
};

/** Next state, or throws on an illegal (from,event). This is the guard. */
export function transition(from: LessonState, event: LessonEvent): LessonState {
  const next = TABLE[from]?.[event];
  if (!next) throw new Error(`Illegal lesson transition: ${from} --${event}-->`);
  return next;
}

export const isLessonState = (s: string): s is LessonState =>
  ["IDLE", "PLANNING", "TEACHING", "WAITING_FOR_STUDENT", "SIMPLIFYING", "COMPLETED", "PARTIAL", "FAILED"].includes(s);
