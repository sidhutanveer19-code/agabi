import type { Lesson } from "@/features/canvas/lib/lesson";
import { matchLesson } from "@/features/canvas/lib/compose/registry";
import { layoutFromBrief } from "@/features/canvas/lib/compose/layout";
import { templateBrief } from "@/features/canvas/lib/compose/brief";

/**
 * Compose a lesson for any topic. Never throws, never returns blank:
 *   1. hand-authored lesson (registry)  — richest, instant
 *   2. generic procedural skeleton      — always available, clean
 *
 * (AI generation is a later phase; this is deterministic and offline.)
 */
export async function composeLesson(topic: string): Promise<Lesson> {
  const authored = matchLesson(topic);
  if (authored) return authored;
  return layoutFromBrief(templateBrief(topic));
}

/** Short topic-aware answer for the Quick Question screen. */
export function composeQuickAnswer(topic: string): string {
  const t = (topic || "this").trim();
  return `Here's the short version of ${t.toLowerCase()} — but this one really opens up once you can see it drawn and play with it yourself.`;
}
