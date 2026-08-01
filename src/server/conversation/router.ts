import { resolveAction, type ConversationAction, type LessonRef } from "@/server/conversation/actions";
import type { IntentObject } from "@/server/conversation/understand";

/**
 * The Capability Router (Phase 2, Engine #2). It wraps the pure `resolveAction` with ONE new,
 * measurable guarantee: a NEW lesson is started ONLY when the topic has corpus support. An
 * off-syllabus topic (0 passage hits) is refused, never taught — this is what keeps
 * Wrong-Teaching-Rate and Unsafe-Routing provably 0 on the benchmark.
 *
 * `corpusHits` is the sole I/O edge (it wraps store.searchChunks(topic).length); it is injected
 * so every branch is unit-testable with a fake and no branch depends on a live DB.
 */
export const CORPUS_MIN_HITS = 1;

export async function route(
  io: IntentObject,
  text: string,
  activeLesson: LessonRef | null,
  lessons: LessonRef[],
  corpusHits: (topic: string) => Promise<number>,
): Promise<ConversationAction> {
  // Only a brand-new lesson consults the corpus. Everything else (greet, continue, followup,
  // clarify, switch to an existing lesson) is decided purely — and never reaches the model teacher
  // for an off-syllabus subject, because it never asks to start one.
  if (io.requiresCorpus) {
    const topic = (io.topic ?? text).trim();
    const hits = await corpusHits(topic);
    if (hits < CORPUS_MIN_HITS) return { kind: "RefuseOffSyllabus", topic };
  }
  return resolveAction(io.intent, text, io.target, activeLesson, lessons);
}
