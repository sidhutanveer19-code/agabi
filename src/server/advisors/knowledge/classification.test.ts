import { describe, it, expect } from "vitest";
import { splitParagraphs, alignLabels, labelHint } from "@/server/advisors/knowledge/extractClassification";
import { classificationPrompt, PARAGRAPH_LABELS } from "@/server/advisors/knowledge/prompts";

const CHUNK = ["Prime factorisation expresses a number as primes.", "Example: factorise 96.", "Exercise 1.2: try 404."].join("\n\n");

describe("paragraph classification (2b) — indexed, advisory, never silently misaligned", () => {
  it("splits a chunk the same way the prompt numbers it", () => {
    expect(splitParagraphs(CHUNK)).toHaveLength(3);
    expect(classificationPrompt(splitParagraphs(CHUNK)).user).toContain("[2] Exercise 1.2");
  });

  it("aligns by INDEX, so a short or reordered answer cannot shift every label", () => {
    // the measured failure: fewer labels than paragraphs, arriving out of order
    const out = alignLabels(3, [{ index: 2, label: "PROBLEM" }, { index: 0, label: "CANONICAL" }]);
    expect(out.labels).toEqual(["CANONICAL", null, "PROBLEM"]);
    expect(out.unlabelled).toEqual([1]); // reported, not guessed from position
  });

  it("reports a label outside the vocabulary instead of coercing it", () => {
    const out = alignLabels(2, [{ index: 0, label: "DIAGRAM" }, { index: 1, label: "canonical" }]);
    expect(out.invalid).toEqual([{ index: 0, value: "DIAGRAM" }]);
    expect(out.labels).toEqual([null, "CANONICAL"]); // case-insensitive, but only for real labels
  });

  it("survives a malformed answer without throwing or inventing labels", () => {
    for (const bad of [null, "not json", [{ nope: 1 }], [{ index: 99, label: "CANONICAL" }], [{ index: 0 }]]) {
      const out = alignLabels(2, bad);
      expect(out.labels).toEqual([null, null]);
      expect(out.unlabelled).toEqual([0, 1]);
    }
  });

  it("the hint summarises composition and never asks the extractor to skip text", () => {
    const hint = labelHint(["CANONICAL", "EXAMPLE", "EXAMPLE", null]);
    expect(hint).toContain("1×CANONICAL");
    expect(hint).toContain("2×EXAMPLE");
    expect(hint).not.toMatch(/ignore|skip|discard/i); // advisory context, not a filter
    expect(labelHint([null, null])).toBe(""); // no labels → no hint, rather than a misleading one
  });

  it("the prompt lists every label it will accept", () => {
    const system = classificationPrompt(["a"]).system;
    for (const label of PARAGRAPH_LABELS) expect(system).toContain(label);
  });
});
