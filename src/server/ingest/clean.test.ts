import { describe, it, expect } from "vitest";
import { cleanDoc } from "@/server/ingest/clean";
import type { Doc, Span } from "@/server/ingest/spans";

/**
 * cleanDoc — §12.1 stage 3 boilerplate cleaner (PURE, §12.2). No I/O edge exists to
 * fake: the module imports only a compile-time `type`, so every branch is exercised for
 * real with hand-built docs. Each test names the EXACT surviving Doc and asserts THAT
 * (deep toEqual), never "returned something".
 *
 * Branch map under test:
 *   - default param `opts = {}` (omitted) vs `opts` supplied
 *   - `opts.drop ?? []` — drop present / opts.drop === undefined / opts === {}
 *   - filter: `t.length === 0` true (empty text, whitespace-only) and false
 *   - `PAGE_NUMBER.test(t)` true (1..4 digits, whitespace-wrapped) and false (5 digits,
 *     interior space, alnum) — boundary of `\d{1,4}`
 *   - `drop.some(re => re.test(t))` true (1st match, 2nd match) and false (non-empty, no match)
 *   - `return true` survivor
 *   - THE INVARIANT: a dropped span never shifts a survivor's sourceRange/page; survivors
 *     are the ORIGINAL objects (returned by identity), input doc is never mutated.
 */

function span(text: string, sourceRange: [number, number], page = 1): Span {
  return { text, sourceRange, page };
}

describe("cleanDoc — empty / trivial docs", () => {
  it("empty doc, opts omitted (default {} + drop ?? []) → []", () => {
    expect(cleanDoc([])).toEqual([]);
  });

  it("single content span, opts omitted → survives with sourceRange + page intact", () => {
    const doc: Doc = [span("Photosynthesis converts light", [0, 29], 1)];
    expect(cleanDoc(doc)).toEqual([span("Photosynthesis converts light", [0, 29], 1)]);
  });
});

describe("cleanDoc — empty-text branch (t.length === 0)", () => {
  it("drops a truly empty span, keeps the content span", () => {
    const doc: Doc = [span("", [0, 0], 1), span("Keep me", [0, 7], 1)];
    expect(cleanDoc(doc)).toEqual([span("Keep me", [0, 7], 1)]);
  });

  it("drops a whitespace-only span (trims to empty), keeps content", () => {
    const doc: Doc = [span("   \n\t ", [0, 6], 1), span("Keep", [6, 10], 1)];
    expect(cleanDoc(doc)).toEqual([span("Keep", [6, 10], 1)]);
  });
});

describe("cleanDoc — PAGE_NUMBER branch", () => {
  it("drops page-number-only spans: 1 digit, 2 digit, 4 digit, whitespace-wrapped", () => {
    const doc: Doc = [
      span("7", [0, 1], 1),
      span("42", [1, 3], 1),
      span("1234", [3, 7], 2),
      span("  15  ", [7, 13], 2), // trimmed to "15" first, then matched
      span("Body text", [13, 22], 2),
    ];
    expect(cleanDoc(doc)).toEqual([span("Body text", [13, 22], 2)]);
  });

  it("keeps numeric-looking spans that are NOT page numbers (5 digits, interior space, alnum)", () => {
    const doc: Doc = [
      span("10000", [0, 5], 1), // 5 digits > \d{1,4} → no match
      span("1 2", [5, 8], 1), // interior space breaks the ^...$ anchor
      span("12a", [8, 11], 1), // trailing letter
    ];
    expect(cleanDoc(doc)).toEqual([
      span("10000", [0, 5], 1),
      span("1 2", [5, 8], 1),
      span("12a", [8, 11], 1),
    ]);
  });
});

describe("cleanDoc — caller drop patterns (drop.some)", () => {
  it("drops a span matching a caller drop pattern; content survives", () => {
    const doc: Doc = [
      span("Chapter 3", [0, 9], 1),
      span("The mitochondria is the powerhouse", [9, 43], 1),
    ];
    expect(cleanDoc(doc, { drop: [/^Chapter \d+$/] })).toEqual([
      span("The mitochondria is the powerhouse", [9, 43], 1),
    ]);
  });

  it("drop list present but NO pattern matches → span survives (drop.some === false)", () => {
    const doc: Doc = [span("Real content", [0, 12], 1)];
    expect(cleanDoc(doc, { drop: [/^FOOTER$/] })).toEqual([span("Real content", [0, 12], 1)]);
  });

  it("the SECOND drop pattern matches (some iterates past the first)", () => {
    const doc: Doc = [
      span("HEADER", [0, 6], 1),
      span("FOOTER", [6, 12], 1),
      span("body", [12, 16], 1),
    ];
    expect(cleanDoc(doc, { drop: [/^HEADER$/, /^FOOTER$/] })).toEqual([span("body", [12, 16], 1)]);
  });
});

describe("cleanDoc — opts.drop ?? [] nullish branch", () => {
  it("opts object with no drop key → empty drop list, only page-number rule applies", () => {
    const doc: Doc = [span("keep", [0, 4], 1), span("3", [4, 5], 1)];
    expect(cleanDoc(doc, {})).toEqual([span("keep", [0, 4], 1)]);
  });

  it("explicit drop: undefined → nullish-coalesces to [] (span survives)", () => {
    const doc: Doc = [span("survivor", [0, 8], 1)];
    expect(cleanDoc(doc, { drop: undefined })).toEqual([span("survivor", [0, 8], 1)]);
  });
});

describe("cleanDoc — every span is boilerplate → []", () => {
  it("only empties + whitespace + page numbers → returns []", () => {
    const doc: Doc = [
      span("", [0, 0], 1),
      span("  ", [0, 2], 1),
      span("9", [2, 3], 1),
      span("999", [3, 6], 1),
    ];
    expect(cleanDoc(doc)).toEqual([]);
  });
});

describe("cleanDoc — §12.2 offset invariant", () => {
  it("dropping spans NEVER shifts a survivor's sourceRange or page", () => {
    const doc: Doc = [
      span("1", [0, 1], 1), // page number → dropped
      span("Real content here", [1, 18], 1), // survives; range must stay [1,18]
      span("   ", [18, 21], 1), // whitespace → dropped
      span("More text", [21, 30], 2), // survives; range must stay [21,30]
      span("Running footer", [30, 44], 2), // caller drop → dropped
    ];
    const result = cleanDoc(doc, { drop: [/^Running footer$/] });

    expect(result).toEqual([
      span("Real content here", [1, 18], 1),
      span("More text", [21, 30], 2),
    ]);
    // offsets preserved verbatim — not recomputed, not compacted after the drops
    expect(result.map((s) => s.sourceRange)).toEqual([
      [1, 18],
      [21, 30],
    ]);
    expect(result.map((s) => s.page)).toEqual([1, 2]);
  });

  it("does not mutate the input doc and returns survivors by IDENTITY (fresh array)", () => {
    const doc: Doc = [span("keep", [0, 4], 1), span("5", [4, 5], 1)];
    const snapshot: Doc = JSON.parse(JSON.stringify(doc)) as Doc;

    const result = cleanDoc(doc);

    expect(result).not.toBe(doc); // filter returns a new array
    expect(result[0]).toBe(doc[0]); // survivor is the ORIGINAL span object, not a copy
    expect(doc).toEqual(snapshot); // input left untouched
    expect(result).toEqual([span("keep", [0, 4], 1)]);
  });
});
