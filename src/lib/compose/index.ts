import type { Lesson } from "@/lib/lesson";
import { matchLesson } from "@/lib/compose/registry";
import { layoutFromBrief } from "@/lib/compose/layout";
import { lessonBriefSchema, templateBrief } from "@/lib/compose/brief";

/**
 * Compose a lesson for any topic. Never throws, never returns blank:
 *   1. hand-authored lesson (registry)  — richest, instant
 *   2. AI-generated brief (/api/lesson) — real content when a key is set
 *   3. generic procedural skeleton      — always available, clean
 */
export async function composeLesson(topic: string): Promise<Lesson> {
  const authored = matchLesson(topic);
  if (authored) return authored;

  try {
    const res = await fetch("/api/lesson", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic }),
    });
    if (res.ok) {
      const data = await res.json();
      const parsed = lessonBriefSchema.safeParse(data?.brief);
      if (parsed.success) return layoutFromBrief(parsed.data);
    }
  } catch {
    // network/route unavailable — fall through to generic
  }

  return layoutFromBrief(templateBrief(topic));
}

/** Short topic-aware answer for the Quick Question screen. */
export function composeQuickAnswer(topic: string): string {
  const t = (topic || "this").trim();
  return `Here's the short version of ${t.toLowerCase()} — but this one really opens up once you can see it drawn and play with it yourself.`;
}
