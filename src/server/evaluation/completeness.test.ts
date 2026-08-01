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

/**
 * MUTATION HARDENING — one focused, isolating test per detection expression.
 * Each test uses an outline that contains EXACTLY ONE required element so a mutated detector
 * (regex literal → "" or altered alternative, Set entry → "", `===` / `||` / `.has` / `.some`
 * flipped, conditional → true/false) changes the EXACT `missing` array we assert.
 */

// ── PROBLEM_INTENT = /problem|why|what happens|how (do|does)/i (line 37) ───────────────────────
// A test per regex alternative: dropping/altering that literal makes `problem` wrongly missing.
describe("teachingCompleteness — PROBLEM_INTENT, one regex alternative per test", () => {
  it("'/problem/' alone marks problem present → missing exactly ['example','recap','visual']", () => {
    const c = teachingCompleteness([{ type: "text", intent: "the core problem to solve" }]);
    expect(c.missing).toEqual(["example", "recap", "visual"]);
    expect(c.requiredPresent).toBe(false);
  });

  it("'/why/' alone marks problem present → missing exactly ['example','recap','visual']", () => {
    const c = teachingCompleteness([{ type: "text", intent: "why is the sky blue" }]);
    expect(c.missing).toEqual(["example", "recap", "visual"]);
    expect(c.requiredPresent).toBe(false);
  });

  it("'/what happens/' alone marks problem present → missing exactly ['example','recap','visual']", () => {
    const c = teachingCompleteness([{ type: "text", intent: "what happens to ice in the sun" }]);
    expect(c.missing).toEqual(["example", "recap", "visual"]);
    expect(c.requiredPresent).toBe(false);
  });

  it("'/how do/' alone marks problem present → missing exactly ['example','recap','visual']", () => {
    const c = teachingCompleteness([{ type: "text", intent: "how do plants make food" }]);
    expect(c.missing).toEqual(["example", "recap", "visual"]);
    expect(c.requiredPresent).toBe(false);
  });

  it("'/how does/' alone marks problem present → missing exactly ['example','recap','visual']", () => {
    const c = teachingCompleteness([{ type: "text", intent: "how does gravity work" }]);
    expect(c.missing).toEqual(["example", "recap", "visual"]);
    expect(c.requiredPresent).toBe(false);
  });
});

// ── EXAMPLE_INTENT = /example|worked|for instance|suppose/i (line 38) ──────────────────────────
describe("teachingCompleteness — EXAMPLE_INTENT, one regex alternative per test", () => {
  it("'/example/' alone marks example present → missing exactly ['problem','recap','visual']", () => {
    const c = teachingCompleteness([{ type: "text", intent: "here is an example" }]);
    expect(c.missing).toEqual(["problem", "recap", "visual"]);
    expect(c.requiredPresent).toBe(false);
  });

  it("'/worked/' alone marks example present → missing exactly ['problem','recap','visual']", () => {
    const c = teachingCompleteness([{ type: "text", intent: "a worked solution follows" }]);
    expect(c.missing).toEqual(["problem", "recap", "visual"]);
    expect(c.requiredPresent).toBe(false);
  });

  it("'/for instance/' alone marks example present → missing exactly ['problem','recap','visual']", () => {
    const c = teachingCompleteness([{ type: "text", intent: "for instance take two apples" }]);
    expect(c.missing).toEqual(["problem", "recap", "visual"]);
    expect(c.requiredPresent).toBe(false);
  });

  it("'/suppose/' alone marks example present → missing exactly ['problem','recap','visual']", () => {
    const c = teachingCompleteness([{ type: "text", intent: "suppose we have a set" }]);
    expect(c.missing).toEqual(["problem", "recap", "visual"]);
    expect(c.requiredPresent).toBe(false);
  });
});

// ── recap = s.type === "summary" || RECAP_INTENT.test(...) (line 46) ───────────────────────────
// Regex = /recap|summary|remember/i (line 39). Intent tests use a NON-summary type to isolate the
// regex side; the type test uses an intent that matches NO regex alternative to isolate `=== "summary"`.
describe("teachingCompleteness — recap detection (type-OR-intent), isolated", () => {
  it("'/recap/' intent alone (type 'text') → missing exactly ['problem','example','visual']", () => {
    const c = teachingCompleteness([{ type: "text", intent: "let us recap the lesson" }]);
    expect(c.missing).toEqual(["problem", "example", "visual"]);
    expect(c.requiredPresent).toBe(false);
  });

  it("'/summary/' intent alone (type 'text') → missing exactly ['problem','example','visual']", () => {
    const c = teachingCompleteness([{ type: "text", intent: "in summary we learned a lot" }]);
    expect(c.missing).toEqual(["problem", "example", "visual"]);
    expect(c.requiredPresent).toBe(false);
  });

  it("'/remember/' intent alone (type 'text') → missing exactly ['problem','example','visual']", () => {
    const c = teachingCompleteness([{ type: "text", intent: "remember these three steps" }]);
    expect(c.missing).toEqual(["problem", "example", "visual"]);
    expect(c.requiredPresent).toBe(false);
  });

  it("type === 'summary' alone (non-matching intent) → missing exactly ['problem','example','visual']", () => {
    // Isolates the `s.type === "summary"` branch: intent matches no RECAP alternative.
    const c = teachingCompleteness([{ type: "summary", intent: "closing thoughts" }]);
    expect(c.missing).toEqual(["problem", "example", "visual"]);
    expect(c.requiredPresent).toBe(false);
  });
});

// ── visual = VISUAL_TYPES.has(s.type) (line 47); Set entries lines 24-33 ───────────────────────
// One positive test per Set entry: mutating that literal to "" removes the type, so `visual`
// wrongly gains 'missing'. Intent "unlabelled figure" matches NO intent regex, so visual is the
// ONLY element found. Includes a negative (non-visual type) to pin `has` against an always-true flip.
describe("teachingCompleteness — every VISUAL_TYPES entry satisfies 'visual'", () => {
  const visualOnly = (type: string): Completeness =>
    teachingCompleteness([{ type, intent: "unlabelled figure" }]);

  const visualTypes = [
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
  ] as const;

  for (const t of visualTypes) {
    it(`type '${t}' → visual present, missing exactly ['problem','example','recap']`, () => {
      const c = visualOnly(t);
      expect(c.missing).toEqual(["problem", "example", "recap"]);
      expect(c.requiredPresent).toBe(false);
    });
  }

  it("a non-visual type ('text') leaves 'visual' missing → missing exactly ['problem','example','visual']", () => {
    const c = teachingCompleteness([{ type: "text", intent: "remember the recap" }]);
    expect(c.missing).toEqual(["problem", "example", "visual"]);
    expect(c.requiredPresent).toBe(false);
  });
});
