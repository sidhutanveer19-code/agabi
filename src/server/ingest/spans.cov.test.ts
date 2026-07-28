import { describe, it, expect } from "vitest";
import { docText, pageOf, rangeOf, type Span, type Doc } from "@/server/ingest/spans";

/**
 * Span-preserving document model (§12.2). These helpers are pure and total, but every
 * branch matters: the empty-doc paths are what keep grounding/highlighting from throwing
 * on a cleaned-away chunk, and the index arithmetic in rangeOf is exactly what maps a
 * quote back to its ORIGINAL character range. Tests assert exact values (not shape) so a
 * mutated join/index/offset dies at the gate.
 */

// A span whose source range is deliberately offset from its position in the doc, and whose
// page is non-zero and varies, so index/offset mutants produce observably wrong output.
function span(text: string, start: number, end: number, page: number): Span {
  return { text, sourceRange: [start, end], page };
}

describe("docText — visible text, spans joined by newline", () => {
  it("returns the empty string for an empty doc", () => {
    expect(docText([])).toBe("");
  });

  it("returns the single span's text unchanged (no trailing separator)", () => {
    expect(docText([span("only", 0, 4, 3)])).toBe("only");
  });

  it("joins multiple spans with a single newline, preserving order", () => {
    const doc: Doc = [span("alpha", 0, 5, 1), span("beta", 6, 10, 1), span("gamma", 11, 16, 1)];
    expect(docText(doc)).toBe("alpha\nbeta\ngamma");
  });

  it("joins with newline specifically — not a space or empty separator", () => {
    const out = docText([span("a", 0, 1, 1), span("b", 1, 2, 1)]);
    expect(out).toBe("a\nb");
    expect(out).not.toBe("ab");
    expect(out).not.toBe("a b");
    expect(out.split("\n")).toHaveLength(2);
  });

  it("preserves inner text verbatim, including embedded newlines within a span", () => {
    expect(docText([span("line1\nline2", 0, 11, 2)])).toBe("line1\nline2");
  });
});

describe("pageOf — the page a span group belongs to", () => {
  it("returns 0 for an empty doc (the falsy-length branch)", () => {
    expect(pageOf([])).toBe(0);
  });

  it("returns the FIRST span's page, not a later one (index-0 branch)", () => {
    const doc: Doc = [span("x", 0, 1, 7), span("y", 1, 2, 9)];
    expect(pageOf(doc)).toBe(7);
  });

  it("returns a single span's page directly", () => {
    expect(pageOf([span("solo", 0, 4, 42)])).toBe(42);
  });

  it("can return a non-zero first page distinct from the empty-doc default", () => {
    // Guards the ternary: a mutant that always yields 0 would fail here.
    expect(pageOf([span("p", 0, 1, 5)])).not.toBe(0);
    expect(pageOf([span("p", 0, 1, 5)])).toBe(5);
  });
});

describe("rangeOf — [start,end) source range covered by a span group", () => {
  it("returns [0,0] for an empty doc", () => {
    expect(rangeOf([])).toEqual([0, 0]);
  });

  it("uses the first span's start and the last span's end", () => {
    const doc: Doc = [span("a", 10, 20, 1), span("b", 20, 35, 1), span("c", 35, 50, 1)];
    expect(rangeOf(doc)).toEqual([10, 50]);
  });

  it("returns the single span's own range when the group has one span", () => {
    expect(rangeOf([span("solo", 12, 27, 4)])).toEqual([12, 27]);
  });

  it("takes start from sourceRange[0] and end from sourceRange[1] (not swapped)", () => {
    // First start=100, last end=250; swapping the offset indices or the first/last span
    // would produce a different pair, so this pins the exact arithmetic.
    const doc: Doc = [span("first", 100, 140, 1), span("mid", 140, 200, 1), span("last", 200, 250, 1)];
    const [start, end] = rangeOf(doc);
    expect(start).toBe(100);
    expect(end).toBe(250);
    expect(start).toBeLessThan(end);
  });

  it("ignores the middle spans' ranges entirely", () => {
    const doc: Doc = [span("a", 5, 6, 1), span("huge", 6, 999, 1), span("z", 999, 1000, 1)];
    expect(rangeOf(doc)).toEqual([5, 1000]);
  });
});
