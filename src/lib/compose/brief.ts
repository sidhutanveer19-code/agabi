import { z } from "zod";
import type { VariantKey, VariantSlots } from "@/lib/lesson";

/**
 * A LessonBrief is the compact, text-only description of a lesson. It is easy
 * for a language model to produce reliably (no SVG coordinates), and the
 * deterministic layout engine (layout.ts) turns it into a full handwritten
 * board. The generic fallback and the optional AI route both emit briefs.
 */
export interface LessonBrief {
  title: string;
  subject: string;
  subtitle: string;
  keyIdea: string;
  points: [string, string];
  note1: [string, string];
  note2: [string, string];
  definitionLabel: string;
  definitionBody: string;
}

/** Zod schema used to validate untrusted (AI) briefs at the boundary. */
export const lessonBriefSchema = z.object({
  title: z.string().min(1).max(80),
  subject: z.string().min(1).max(40),
  subtitle: z.string().min(1).max(120),
  keyIdea: z.string().min(1).max(120),
  points: z.tuple([z.string().max(40), z.string().max(40)]),
  note1: z.tuple([z.string().max(40), z.string().max(40)]),
  note2: z.tuple([z.string().max(40), z.string().max(40)]),
  definitionLabel: z.string().min(1).max(30),
  definitionBody: z.string().min(1).max(120),
});

function titleCase(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** A clean, honest generic brief for any unmatched topic (never fake-specific). */
export function templateBrief(topic: string): LessonBrief {
  const t = topic.trim() || "this idea";
  const T = titleCase(t);
  return {
    title: T,
    subject: "General",
    subtitle: `Let's build a clear picture of ${t.toLowerCase()}.`,
    keyIdea: `${t} makes sense once you see the one idea it is built on`,
    points: ["Start simple —", "one idea first."],
    note1: ["Each part connects", "to the whole."],
    note2: ["Then we make it", "precise together."],
    definitionLabel: "Definition",
    definitionBody: `${T}: the core idea, explained step by step.`,
  };
}

/** Derive the 5 teaching variants (8 slots each) from a single brief. */
export function makeVariants(b: LessonBrief): Record<VariantKey, VariantSlots> {
  return {
    normal: {
      subtitle: b.subtitle,
      cA0: b.points[0],
      cA1: b.points[1],
      keyTail: `: ${b.keyIdea}.`,
      n1a: b.note1[0],
      n1b: b.note1[1],
      n2a: b.note2[0],
      n2b: b.note2[1],
    },
    again1: {
      subtitle: "Same idea, from another angle.",
      cA0: b.points[1],
      cA1: b.points[0],
      keyTail: ": seen from a new direction.",
      n1a: b.note2[0],
      n1b: b.note2[1],
      n2a: b.note1[0],
      n2b: b.note1[1],
    },
    again2: {
      subtitle: "One more way to see it.",
      cA0: "Focus on",
      cA1: "the core.",
      keyTail: ": strip it down to the essentials.",
      n1a: b.note1[0],
      n1b: b.note1[1],
      n2a: b.note2[0],
      n2b: b.note2[1],
    },
    simpler: {
      subtitle: "Let's keep this really simple.",
      cA0: "In plain words:",
      cA1: b.points[0],
      keyTail: ": it comes down to one idea.",
      n1a: b.note1[0],
      n1b: b.note1[1],
      n2a: "That's the",
      n2b: "whole story.",
    },
    deeper: {
      subtitle: "Now let's be precise about it.",
      cA0: b.points[0],
      cA1: b.points[1],
      keyTail: `: ${b.keyIdea}.`,
      n1a: "Look closer at",
      n1b: "the details.",
      n2a: b.note2[0],
      n2b: b.note2[1],
    },
  };
}
