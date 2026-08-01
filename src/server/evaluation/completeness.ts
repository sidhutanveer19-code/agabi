/**
 * Teaching-Completeness KPI — does a lesson outline contain the required problem-first arc? (L1: the arc
 * is a measured checklist, not a vibe; L5: the ONE place this KPI is computed.) No I/O, no model — pure,
 * total detection over outline slots. A missing element is NAMED (Law 11: never fail silently), never a
 * bare boolean. Total: no slots → every required element reported missing.
 */

export interface OutlineLike {
  type: string; // the slot's block/visual kind (e.g. "summary", "mindmap", "text")
  intent: string; // the slot's teaching intent, in prose (matched case-insensitively)
}

export interface Completeness {
  requiredPresent: boolean; // true iff every required arc element was found
  missing: string[]; // the required elements NOT found, in canonical order
}

// The problem-first teaching arc every lesson must contain, in canonical order.
const REQUIRED = ["problem", "example", "recap", "visual"] as const;
type RequiredElement = (typeof REQUIRED)[number];

// Slot `type`s that render as a visual — any one of these satisfies the "visual" element.
const VISUAL_TYPES = new Set<string>([
  "mindmap",
  "flow",
  "table",
  "timeline",
  "chart",
  "formula",
  "geometry",
  "graph",
  "map",
  "molecule",
]);

// Intent-prose signals. "recap" is ALSO satisfied structurally by a slot whose type is "summary".
const PROBLEM_INTENT = /problem|why|what happens|how (do|does)/i;
const EXAMPLE_INTENT = /example|worked|for instance|suppose/i;
const RECAP_INTENT = /recap|summary|remember/i;

/** Which required arc elements a set of outline slots contains, and which are missing (Law 11). */
export function teachingCompleteness(slots: OutlineLike[]): Completeness {
  const found: Record<RequiredElement, boolean> = {
    problem: slots.some((s) => PROBLEM_INTENT.test(s.intent)),
    example: slots.some((s) => EXAMPLE_INTENT.test(s.intent)),
    recap: slots.some((s) => s.type === "summary" || RECAP_INTENT.test(s.intent)),
    visual: slots.some((s) => VISUAL_TYPES.has(s.type)),
  };

  const missing = REQUIRED.filter((element) => !found[element]);
  return { requiredPresent: missing.length === 0, missing };
}
