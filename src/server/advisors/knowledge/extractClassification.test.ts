import { describe, it, expect } from "vitest";

import {
  splitParagraphs,
  extractClassification,
  alignLabels,
  labelHint,
} from "@/server/advisors/knowledge/extractClassification";
import { classificationPrompt, type ParagraphLabel } from "@/server/advisors/knowledge/prompts";
import type { JsonInvoke } from "@/server/advisors/knowledge/invoke";

/**
 * Pass-0 paragraph classification — splitParagraphs / extractClassification / alignLabels / labelHint.
 *
 * The ONE I/O edge is `invoke` (a model call), which the module already takes by injection; the test
 * supplies a fake JsonInvoke that returns fixture JSON and captures the (system,user) it was handed.
 * Everything else — the `\n{2,}` split, the by-INDEX alignment with its eight skip guards, the
 * `?? []` fallback, and the count-formatting hint — is REAL logic exercised with hostile input, and
 * every assertion names the EXACT outcome (never "returned something"). classificationPrompt and
 * advise are the real production functions, used for real.
 */

/** The narrowest fake at the I/O boundary: returns fixed `data`, records the prompt it received. */
function fakeInvoke(data: Record<string, unknown>, seen?: { system?: string; user?: string }): JsonInvoke {
  return async (system, user) => {
    if (seen) {
      seen.system = system;
      seen.user = user;
    }
    return { raw: JSON.stringify(data), data };
  };
}

/** The fixed tail labelHint appends after the composition list — copied from the source verbatim. */
const HINT_TAIL =
  ". Concepts and assertions live in CANONICAL, PRINCIPLE and PROOF text; EXAMPLE, PROBLEM, QUESTION and STORY text contains props and specifics that are NOT concepts.";

describe("splitParagraphs", () => {
  it("splits on two-or-more newlines, trims each, drops empties", () => {
    const text = "  First para  \n\nSecond para\n\n\n  Third  ";
    expect(splitParagraphs(text)).toEqual(["First para", "Second para", "Third"]);
  });

  it("keeps a SINGLE internal newline inside one paragraph (only blank lines split)", () => {
    expect(splitParagraphs("line one\nline two")).toEqual(["line one\nline two"]);
  });

  it("empty string → [] (the split yields one empty slot, filtered out)", () => {
    expect(splitParagraphs("")).toEqual([]);
  });

  it("whitespace-only chunks → [] (trim empties them, filter removes them)", () => {
    expect(splitParagraphs("   \n\n\t\n\n   ")).toEqual([]);
  });

  it("a lone paragraph with surrounding whitespace → one trimmed entry", () => {
    expect(splitParagraphs("   solo   ")).toEqual(["solo"]);
  });
});

describe("extractClassification — wiring + `?? []` fallback", () => {
  it("hands invoke EXACTLY classificationPrompt(paragraphs) and wraps data.paragraphs as advice", async () => {
    const paragraphs = ["A first paragraph.", "A second paragraph."];
    const modelAnswer = [
      { index: 0, label: "CANONICAL" },
      { index: 1, label: "EXAMPLE" },
    ];
    const seen: { system?: string; user?: string } = {};

    const result = await extractClassification(paragraphs, fakeInvoke({ paragraphs: modelAnswer }, seen));

    const expectedPrompt = classificationPrompt(paragraphs);
    expect(seen.system).toBe(expectedPrompt.system);
    expect(seen.user).toBe(expectedPrompt.user);
    // real advise() wrapper: brand + the exact model array as raw
    expect(result).toEqual({ __brand: "advice", raw: modelAnswer });
  });

  it("present-but-non-array `paragraphs` passes through untouched (left side of ??)", async () => {
    const weird = { not: "an array" };
    const result = await extractClassification(["p"], fakeInvoke({ paragraphs: weird }));
    expect(result.raw).toEqual(weird);
  });

  it("missing `paragraphs` key → raw falls back to [] (right side of ??)", async () => {
    const result = await extractClassification(["p"], fakeInvoke({ somethingElse: 1 }));
    expect(result).toEqual({ __brand: "advice", raw: [] });
  });

  it("`paragraphs: null` → nullish, so raw falls back to [] as well", async () => {
    const result = await extractClassification(["p"], fakeInvoke({ paragraphs: null }));
    expect(result.raw).toEqual([]);
  });
});

describe("alignLabels — by-index alignment and every skip guard", () => {
  it("raw is NOT an array → all slots null, every index reported unlabelled, no invalids", () => {
    expect(alignLabels(3, { paragraphs: "oops" })).toEqual({
      labels: [null, null, null],
      unlabelled: [0, 1, 2],
      invalid: [],
    });
  });

  it("count 0 with empty array → empty everything", () => {
    expect(alignLabels(0, [])).toEqual({ labels: [], unlabelled: [], invalid: [] });
  });

  it("valid entries: uppercase kept, lowercase/mixed upcased, boundary index accepted, order by INDEX", () => {
    const raw = [
      { index: 0, label: "CANONICAL" }, // already uppercase
      { index: 3, label: "proof" }, // lowercase → PROOF, boundary index = count-1
      { index: 1, label: "SuMmArY" }, // mixed case → SUMMARY
    ];
    expect(alignLabels(4, raw)).toEqual({
      labels: ["CANONICAL", "SUMMARY", null, "PROOF"],
      unlabelled: [2],
      invalid: [],
    });
  });

  it("out-of-vocabulary label → recorded in `invalid` with its original (un-upcased) value, slot stays null", () => {
    expect(alignLabels(1, [{ index: 0, label: "Foobar" }])).toEqual({
      labels: [null],
      unlabelled: [0],
      invalid: [{ index: 0, value: "Foobar" }],
    });
  });

  it("duplicate index → last valid label wins", () => {
    const raw = [
      { index: 0, label: "CANONICAL" },
      { index: 0, label: "EXAMPLE" },
    ];
    expect(alignLabels(2, raw)).toEqual({
      labels: ["EXAMPLE", null],
      unlabelled: [1],
      invalid: [],
    });
  });

  it("hostile mixed batch → hits ALL eight skip guards, keeps only the one good label + one invalid", () => {
    const raw: unknown[] = [
      null, // !entry
      undefined, // !entry
      0, // !entry (falsy) — also not an object
      "str", // typeof !== "object"
      42, // truthy, but typeof !== "object"
      [], // truthy object, but destructures index/label as undefined
      { index: "1", label: "CANONICAL" }, // index not a number
      { index: 1.5, label: "CANONICAL" }, // index not an integer
      { index: NaN, label: "CANONICAL" }, // NaN is not an integer
      { index: -1, label: "CANONICAL" }, // index < 0
      { index: 3, label: "CANONICAL" }, // index >= count
      { index: 0, label: 99 }, // label not a string
      { index: 1, label: "example" }, // the ONLY survivor → EXAMPLE
      { index: 2, label: "FOOBAR" }, // valid index, out-of-vocab label → invalid
    ];
    expect(alignLabels(3, raw)).toEqual({
      labels: [null, "EXAMPLE", null],
      unlabelled: [0, 2],
      invalid: [{ index: 2, value: "FOOBAR" }],
    });
  });
});

describe("labelHint — composition summary or empty", () => {
  it("no known labels (all null) → empty string", () => {
    expect(labelHint([null, null])).toBe("");
  });

  it("empty labels array → empty string", () => {
    expect(labelHint([])).toBe("");
  });

  it("a single known label → `1×LABEL` plus the fixed guidance tail", () => {
    const labels: (ParagraphLabel | null)[] = ["CANONICAL"];
    expect(labelHint(labels)).toBe(`Passage composition: 1×CANONICAL${HINT_TAIL}`);
  });

  it("counts by label in first-seen order, nulls ignored", () => {
    const labels: (ParagraphLabel | null)[] = ["CANONICAL", null, "CANONICAL", "EXAMPLE", null];
    expect(labelHint(labels)).toBe(`Passage composition: 2×CANONICAL, 1×EXAMPLE${HINT_TAIL}`);
  });
});
