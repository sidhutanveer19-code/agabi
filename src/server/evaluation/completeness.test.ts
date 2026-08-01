import { describe, it, expect } from "vitest";
import {
  teachingCompleteness,
  type OutlineLike,
  type Completeness,
} from "@/server/evaluation/completeness";

/**
 * Teaching-Completeness KPI — does a lesson outline contain the required problem-first arc? (L1: the arc
 * is a measured checklist.) Pure, total detection over outline slots. A missing element is NAMED
 * (Law 11: never fail silently). Every assertion names the EXACT missing list (§H1.2).
 */

// A full problem-first arc: a why-question, a worked example, a summary slot, and a visual block.
const fullArc: OutlineLike[] = [
  { type: "text", intent: "Why does the sky look blue?" }, // problem  (/why/)
  { type: "text", intent: "For instance, consider a prism." }, // example  (/for instance/)
  { type: "summary", intent: "wrap up the key idea" }, // recap    (type === "summary")
  { type: "mindmap", intent: "map of the ideas" }, // visual   (type in VISUAL set)
];

describe("teachingCompleteness — the required problem-first arc", () => {
  it("a full arc (problem+example+summary+mindmap) → requiredPresent, nothing missing", () => {
    const c: Completeness = teachingCompleteness(fullArc);
    expect(c.missing).toEqual([]);
    expect(c.requiredPresent).toBe(true);
  });

  it("drop the example slot → requiredPresent false, missing exactly ['example']", () => {
    const noExample = fullArc.filter((s) => !/for instance/i.test(s.intent));
    const c = teachingCompleteness(noExample);
    expect(c.missing).toEqual(["example"]);
    expect(c.requiredPresent).toBe(false);
  });

  it("empty slots → all four missing (canonical order)", () => {
    const c = teachingCompleteness([]);
    expect(c.missing).toEqual(["problem", "example", "recap", "visual"]);
    expect(c.requiredPresent).toBe(false);
  });

  it("a definition-only outline (no problem) → missing includes 'problem'", () => {
    // Has example + recap + visual, but no problem framing → only "problem" is missing.
    const definitionOnly: OutlineLike[] = [
      { type: "text", intent: "Definition: a triangle has three straight sides." },
      { type: "text", intent: "For example, an equilateral triangle." },
      { type: "summary", intent: "quick recap of triangles" },
      { type: "table", intent: "types of triangles" },
    ];
    const c = teachingCompleteness(definitionOnly);
    expect(c.missing).toContain("problem");
    expect(c.missing).toEqual(["problem"]);
    expect(c.requiredPresent).toBe(false);
  });

  it("recap is satisfied by intent alone (non-summary type) — guards the type-OR-intent branch", () => {
    const c = teachingCompleteness([{ type: "text", intent: "remember the three laws" }]);
    expect(c.missing).not.toContain("recap"); // /remember/ matched, no "summary" type present
    expect(c.missing).toEqual(["problem", "example", "visual"]);
  });

  it("problem matches 'what happens' and 'how does'; visual matched by type only", () => {
    const c = teachingCompleteness([
      { type: "text", intent: "what happens when we heat ice" }, // problem
      { type: "geometry", intent: "unlabelled figure" }, // visual by type, intent irrelevant
    ]);
    expect(c.missing).toEqual(["example", "recap"]);
    const c2 = teachingCompleteness([{ type: "text", intent: "how does gravity pull objects" }]);
    expect(c2.missing).not.toContain("problem");
  });
});
