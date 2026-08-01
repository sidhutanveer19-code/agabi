import { describe, it, expect } from "vitest";
import { normaliseText, normaliseDoc } from "@/server/ingest/normalise";
import type { Doc, Span } from "@/server/ingest/spans";

/**
 * normaliseText / normaliseDoc — the PURE 12.1 stage-4 normaliser.
 *
 * There is NO I/O edge here (no db / network / clock), so — per H1.7 —
 * nothing is mocked: every transformation is real logic exercised with real
 * and hostile input. Each assertion names the EXACT output string; never
 * "did not throw" / "returned something" (H1.2).
 *
 * Every code-point-sensitive literal is a \u escape on purpose: combining
 * marks, NBSP, EM SPACE and smart quotes are invisible/ambiguous as raw
 * glyphs, so escapes keep the assertions unambiguous and deterministic.
 *
 * Pipeline order under test (each a distinct transform to falsify):
 *   NFC  ->  smart single quotes -> '   ->  smart double quotes -> "
 *        ->  whitespace collapse (\s+ -> " ")  ->  trim.
 * For normaliseDoc: text is rewritten while sourceRange + page are preserved
 * EXACTLY, on NEW span objects, without mutating the input (12.2 span model).
 */

const LSQUO = "‘"; // LEFT SINGLE QUOTATION MARK
const RSQUO = "’"; // RIGHT SINGLE QUOTATION MARK
const LDQUO = "“"; // LEFT DOUBLE QUOTATION MARK
const RDQUO = "”"; // RIGHT DOUBLE QUOTATION MARK
const ACUTE = "́"; // COMBINING ACUTE ACCENT (NFD mark)
const NBSP = " "; // NO-BREAK SPACE
const EMSP = " "; // EM SPACE
const E_ACUTE = "é"; // é (NFC-composed)
const A_ACUTE = "Á"; // Á (NFC-composed)

function span(text: string, sourceRange: [number, number], page: number): Span {
  return { text, sourceRange, page };
}

describe("normaliseText — NFC composition", () => {
  it("composes NFD combining marks to NFC (cafe + U+0301 -> cafe-acute, 5 units -> 4)", () => {
    const decomposed = "cafe" + ACUTE;
    expect(decomposed.length).toBe(5);
    const out = normaliseText(decomposed);
    expect(out).toBe("caf" + E_ACUTE);
    expect(out.length).toBe(4);
  });

  it("composes a standalone base+mark (A + U+0301 -> A-acute, 2 units -> 1)", () => {
    const out = normaliseText("A" + ACUTE);
    expect(out).toBe(A_ACUTE);
    expect(out.length).toBe(1);
  });
});

describe("normaliseText — smart single quotes -> ASCII apostrophe", () => {
  it("both left and right single quotes become '", () => {
    expect(normaliseText(LSQUO + "hello" + RSQUO)).toBe("'hello'");
  });

  it("replacement is GLOBAL — every occurrence, not just the first", () => {
    // Falsifies a non-global regex: a non-global /.../ would replace only one.
    expect(normaliseText(RSQUO + RSQUO + RSQUO)).toBe("'''");
  });

  it("mid-word smart apostrophe becomes a straight apostrophe", () => {
    expect(normaliseText("don" + RSQUO + "t")).toBe("don't");
  });
});

describe("normaliseText — smart double quotes -> ASCII quote", () => {
  it("both left and right double quotes become \"", () => {
    expect(normaliseText(LDQUO + "hi" + RDQUO)).toBe('"hi"');
  });

  it("replacement is GLOBAL for double quotes too", () => {
    expect(normaliseText(LDQUO + LDQUO + RDQUO)).toBe('"""');
  });
});

describe("normaliseText — non-target chars are left untouched", () => {
  it("straight ASCII quotes pass through unchanged", () => {
    expect(normaliseText("it's a \"test\"")).toBe("it's a \"test\"");
  });

  it("quote-like chars OUTSIDE the four smart quotes are NOT rewritten", () => {
    // Falsifies an over-broad character class: guillemet U+00AB, prime U+2032.
    const other = "«x′";
    expect(normaliseText(other)).toBe(other);
  });
});

describe("normaliseText — whitespace collapse (\\s+ -> single ASCII space)", () => {
  it("runs of plain spaces collapse to one", () => {
    expect(normaliseText("a    b")).toBe("a b");
  });

  it("mixed tab/newline/CR/form-feed collapse to a single ASCII space", () => {
    // Falsifies collapsing only ' ' instead of the full \s class.
    expect(normaliseText("a\t\n\r\fb")).toBe("a b");
  });

  it("non-breaking space (U+00A0) is whitespace -> collapses to ASCII space", () => {
    const out = normaliseText("a" + NBSP + NBSP + "b");
    expect(out).toBe("a b");
    expect(out.length).toBe(3); // a + single ASCII 0x20 + b, no preserved NBSP
    expect(out.charCodeAt(1)).toBe(0x20);
  });

  it("Unicode space separator (U+2003 EM SPACE) also collapses", () => {
    expect(normaliseText("a" + EMSP + "b")).toBe("a b");
  });

  it("blank lines between paragraphs become a single space", () => {
    expect(normaliseText("line1\n\nline2")).toBe("line1 line2");
  });
});

describe("normaliseText — trim", () => {
  it("strips leading and trailing spaces", () => {
    expect(normaliseText("   hello   ")).toBe("hello");
  });

  it("strips leading/trailing tabs and newlines", () => {
    expect(normaliseText("\n\thello\t\n")).toBe("hello");
  });
});

describe("normaliseText — empty / whitespace-only edges", () => {
  it("empty string -> empty string", () => {
    expect(normaliseText("")).toBe("");
  });

  it("spaces-only -> empty (collapse to ' ' then trim to '')", () => {
    expect(normaliseText("   ")).toBe("");
  });

  it("mixed whitespace-only -> empty", () => {
    expect(normaliseText("\t\n\r\f")).toBe("");
  });

  it("single non-breaking space -> empty", () => {
    expect(normaliseText(NBSP)).toBe("");
  });
});

describe("normaliseText — no-op on already-clean text", () => {
  it("clean text passes through byte-for-byte", () => {
    expect(normaliseText("Hello world")).toBe("Hello world");
  });
});

describe("normaliseText — all transforms combined, order preserved", () => {
  it("NFC + both quote kinds + collapse + trim in one string", () => {
    const input =
      "  " + LDQUO + "Cafe" + ACUTE + RDQUO + "\t\tis  " + LSQUO + "open" + RSQUO + "  ";
    expect(normaliseText(input)).toBe('"Caf' + E_ACUTE + "\" is 'open'");
  });
});

describe("normaliseText — idempotency (12.3 reproducibility)", () => {
  it("normalising an already-normalised string is a fixed point", () => {
    const hostile = [
      "  " + LDQUO + "Cafe" + ACUTE + RDQUO + "\t\tis  " + LSQUO + "open" + RSQUO + "  ",
      "A" + ACUTE + " " + LSQUO + "x" + RSQUO,
      "line1\n\nline2",
      "",
      NBSP,
    ];
    for (const s of hostile) {
      const once = normaliseText(s);
      expect(normaliseText(once)).toBe(once);
    }
  });
});

describe("normaliseDoc", () => {
  it("normalises each span's text while preserving sourceRange + page EXACTLY", () => {
    const doc: Doc = [
      span("  " + LDQUO + "Hi" + RDQUO + "  ", [0, 10], 3),
      span("a\t\tb", [10, 14], 4),
    ];
    expect(normaliseDoc(doc)).toEqual([
      { text: '"Hi"', sourceRange: [0, 10], page: 3 },
      { text: "a b", sourceRange: [10, 14], page: 4 },
    ]);
  });

  it("returns NEW span objects but keeps the SAME sourceRange array reference (shallow spread)", () => {
    const range: [number, number] = [5, 9];
    const doc: Doc = [span(LSQUO + "x" + RSQUO, range, 1)];
    const out = normaliseDoc(doc);
    expect(out[0]).not.toBe(doc[0]); // new object per span
    expect(out[0].sourceRange).toBe(range); // offsets never rewritten — same array ref
    expect(out[0].text).toBe("'x'");
  });

  it("returns a NEW array and does NOT mutate the input doc", () => {
    const doc: Doc = [span("  spaced  ", [0, 10], 2)];
    const out = normaliseDoc(doc);
    expect(out).not.toBe(doc); // new array
    expect(out[0].text).toBe("spaced"); // normalised in the result
    expect(doc[0].text).toBe("  spaced  "); // original untouched
  });

  it("empty doc -> empty doc", () => {
    const out = normaliseDoc([]);
    expect(out).toEqual([]);
    expect(out.length).toBe(0);
  });

  it("preserves span order and count across a multi-span doc", () => {
    const doc: Doc = [
      span("first ", [0, 6], 1),
      span(" second", [6, 13], 1),
      span(LDQUO + "third" + RDQUO, [13, 20], 2),
    ];
    const out = normaliseDoc(doc);
    expect(out.map((s) => s.text)).toEqual(["first", "second", '"third"']);
    expect(out.map((s) => s.page)).toEqual([1, 1, 2]);
    expect(out.length).toBe(3);
  });

  it("a span needing no change still yields a new object with identical text", () => {
    const doc: Doc = [span("clean", [0, 5], 7)];
    const out = normaliseDoc(doc);
    expect(out[0]).not.toBe(doc[0]);
    expect(out[0].text).toBe("clean");
    expect(out[0].page).toBe(7);
  });
});
