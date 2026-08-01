import type { Intent } from "@/server/advisors/intent";

/**
 * Every message becomes exactly one ConversationAction BEFORE anything happens.
 * `resolveAction` is a PURE function — no model, no I/O — so every branch is unit
 * testable and the "hi got taught" bug dies here: greeting/smalltalk/unclear never
 * produce a teaching action, so the chunk advisor is never reached.
 *
 * `Answer` carries the active lesson's `topic` (null = none) rather than a raw
 * regionId: the answer writes a NEW region titled by that topic so title-grouping
 * flows it beneath the lesson (deviation from the spec's `regionId`, documented —
 * it fits the title-based placement and a null topic means "place freely").
 */
export type ConversationAction =
  | { kind: "Greet" }
  | { kind: "AskForTopic" }
  | { kind: "StartLesson"; topic: string }
  | { kind: "ContinueLesson"; lessonId: string }
  | { kind: "Simplify"; lessonId: string }
  | { kind: "RetryLesson"; lessonId: string }
  | { kind: "SwitchLesson"; lessonId: string }
  | { kind: "Answer"; text: string; topic: string | null }
  // Phase 2: the topic is off the Class-10 corpus (0 passage hits) → politely decline, never teach.
  // Produced ONLY by the Capability Router (conversation/router.ts) under its corpus gate; resolveAction
  // never yields it, so every existing routing test is unaffected (Wrong-Teaching-Rate stays measurable).
  | { kind: "RefuseOffSyllabus"; topic: string };

export interface LessonRef {
  id: string;
  topic: string;
  regionId: string;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * PURE. Given the validated intent (+ target for switch_topic), the message text,
 * the active lesson, and the list of existing lessons, decide the single action.
 * Every no-active-lesson branch is defined — nothing is left to be guessed.
 */
export function resolveAction(
  intent: Intent,
  text: string,
  target: string | undefined,
  activeLesson: LessonRef | null,
  lessons: LessonRef[],
): ConversationAction {
  switch (intent) {
    case "greeting":
    case "smalltalk":
    case "pause":
      return { kind: "Greet" };

    case "unclear":
      return { kind: "AskForTopic" };

    case "topic":
      return { kind: "StartLesson", topic: text.trim() };

    case "continue":
      return activeLesson ? { kind: "ContinueLesson", lessonId: activeLesson.id } : { kind: "AskForTopic" };

    case "clarification":
      return activeLesson ? { kind: "Simplify", lessonId: activeLesson.id } : { kind: "AskForTopic" };

    case "followup":
      return { kind: "Answer", text: text.trim(), topic: activeLesson?.topic ?? null };

    case "switch_topic": {
      const want = norm(target ?? text);
      const match = lessons.find((l) => norm(l.topic) === want || norm(l.topic).includes(want) || want.includes(norm(l.topic)));
      return match ? { kind: "SwitchLesson", lessonId: match.id } : { kind: "AskForTopic" };
    }
  }
}
