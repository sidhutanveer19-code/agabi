import { describe, it, expect } from "vitest";
import { parseMarkdown } from "@/server/ingest/parse/markdown";
import type { Doc, Span } from "@/server/ingest/spans";

/**
 * parseMarkdown — §12.1 stage 2, a PURE span-splitter. It has no I/O edge (no
 * db/network/clock), so nothing is mocked: every branch is real logic exercised
 * with real input. Each assertion names the EXACT resulting Doc (text +
 * [start,end) sourceRange + page), never "returned something".
 *
 * Branches under test:
 *   - default `page = 1` (param omitted) vs. an explicit page value
 *   - the `while` loop body runs (≥1 block) vs. never runs (empty / all-blank input)
 *   - blank-line ("\n\n") splitting; leading/trailing/repeated blanks collapse
 *   - a multi-line block keeps its internal "\n" and stays ONE span
 *   - a whitespace-only line is NON-blank → does NOT split a block
 *
 * Load-bearing invariant (§12.2 offset preservation): for every span,
 * raw.slice(start, end) === span.text. A slip of even one offset breaks grounding,
 * so it is asserted on every fixture below.
 */

/** Falsification guard: the sourceRange must actually index back to the span text. */
function assertRangesMapBack(raw: string, doc: Doc): void {
  for (const span of doc) {
    const [start, end] = span.sourceRange;
    expect(raw.slice(start, end)).toBe(span.text);
    expect(end).toBe(start + span.text.length);
  }
}

describe("parseMarkdown — empty / no-match input (loop body never runs)", () => {
  it("empty string → empty Doc, not a one-element array", () => {
    const doc = parseMarkdown("");
    expect(doc).toEqual<Doc>([]);
    expect(doc).toHaveLength(0);
  });

  it("a string of only blank lines has no non-blank run → empty Doc", () => {
    // "\n\n\n" contains no [^\n]+ run, so re.exec is null on the first call.
    expect(parseMarkdown("\n\n\n")).toEqual<Doc>([]);
  });
});

describe("parseMarkdown — single block (loop body runs once)", () => {
  it("one line → one span with exact [0,length) range and default page 1", () => {
    const raw = "hello world";
    const doc = parseMarkdown(raw);
    expect(doc).toEqual<Doc>([
      { text: "hello world", sourceRange: [0, 11], page: 1 },
    ]);
    assertRangesMapBack(raw, doc);
  });

  it("a whitespace-only string is a NON-blank run → one span, not dropped", () => {
    const raw = "   ";
    expect(parseMarkdown(raw)).toEqual<Doc>([
      { text: "   ", sourceRange: [0, 3], page: 1 },
    ]);
  });

  it("consecutive non-blank lines are ONE block; internal \\n is preserved", () => {
    const raw = "l1\nl2";
    const doc = parseMarkdown(raw);
    expect(doc).toEqual<Doc>([
      { text: "l1\nl2", sourceRange: [0, 5], page: 1 },
    ]);
    // proves it did not split on a plain (non-blank) newline
    expect(doc).toHaveLength(1);
    expect(doc[0].text.includes("\n")).toBe(true);
    assertRangesMapBack(raw, doc);
  });

  it("a line containing only spaces does NOT separate blocks", () => {
    // "x\n \ny": the middle line is " " (non-empty) → all one block.
    const raw = "x\n \ny";
    const doc = parseMarkdown(raw);
    expect(doc).toEqual<Doc>([
      { text: "x\n \ny", sourceRange: [0, 5], page: 1 },
    ]);
    expect(doc).toHaveLength(1);
    assertRangesMapBack(raw, doc);
  });
});

describe("parseMarkdown — multiple blocks split on blank lines (loop body runs N times)", () => {
  it("two paragraphs → two spans; the SECOND range skips the blank gap", () => {
    const raw = "aaa\n\nbbb";
    const doc = parseMarkdown(raw);
    expect(doc).toEqual<Doc>([
      { text: "aaa", sourceRange: [0, 3], page: 1 },
      { text: "bbb", sourceRange: [5, 8], page: 1 },
    ]);
    // the second block's start (5) is past the "\n\n" gap, not adjacent to the first end (3)
    expect(doc[1].sourceRange[0]).toBeGreaterThan(doc[0].sourceRange[1]);
    assertRangesMapBack(raw, doc);
  });

  it("leading, trailing and repeated blank lines all collapse (they yield no spans)", () => {
    const raw = "\n\nA\n\n\nB\n";
    const doc = parseMarkdown(raw);
    expect(doc).toEqual<Doc>([
      { text: "A", sourceRange: [2, 3], page: 1 },
      { text: "B", sourceRange: [6, 7], page: 1 },
    ]);
    assertRangesMapBack(raw, doc);
  });
});

describe("parseMarkdown — the page parameter", () => {
  it("explicit page is stamped on every span (default branch NOT taken)", () => {
    const raw = "hi";
    expect(parseMarkdown(raw, 42)).toEqual<Doc>([
      { text: "hi", sourceRange: [0, 2], page: 42 },
    ]);
  });

  it("explicit page applies to ALL spans in a multi-block doc", () => {
    const doc = parseMarkdown("aaa\n\nbbb", 7);
    expect(doc.map((s: Span) => s.page)).toEqual([7, 7]);
  });

  it("omitting page defaults to 1 (default-parameter branch taken)", () => {
    const doc = parseMarkdown("only");
    expect(doc[0].page).toBe(1);
  });
});

describe("parseMarkdown — determinism (§ identical bytes → identical Doc)", () => {
  it("the same input parsed twice is deeply equal (no cross-call regex state leak)", () => {
    const raw = "para one\nwith two lines\n\npara two";
    expect(parseMarkdown(raw)).toEqual(parseMarkdown(raw));
  });

  it("CRLF blank line is NOT treated as a separator (\\r keeps the line non-blank)", () => {
    // Documents real behaviour: "\r\n\r\n" does not split because "\r" is a non-\n char.
    const raw = "a\r\n\r\nb";
    const doc = parseMarkdown(raw);
    expect(doc).toEqual<Doc>([
      { text: "a\r\n\r\nb", sourceRange: [0, 6], page: 1 },
    ]);
    assertRangesMapBack(raw, doc);
  });
});
