import { describe, it, expect } from "vitest";

import { parseHtml } from "@/server/ingest/parse/html";

/**
 * parseHtml — HTML → Doc block-span extractor (§12.1 stage 2, PURE).
 *
 * This module has NO I/O edge (no prisma/db/network/fetch/clock/fs): it is a pair of
 * const regexes plus string transforms. Per §H1.7 ("fake ONLY at the I/O edge — parsing
 * untrusted input is LOGIC, test it for real with hostile input") there is nothing to
 * mock — every assertion below drives the REAL regex/decoder and names the EXACT output
 * (text + [start,end) source range + page), never "returned something".
 *
 * Branches / behaviours under test (target: 90%+ of branches):
 *  - default param `page = 1` vs an explicit page, threaded onto every span
 *  - the while-loop: 0 matches (→ []), 1 match, N matches (global regex)
 *  - `if (!text) continue`: BOTH the skip branch (empty/tag-only/whitespace-only block)
 *    and the push branch, incl. a skip-then-push sequence proving `continue` keeps looping
 *  - the block-tag alternation `p|h[1-6]|li|blockquote|pre|section|article|div`, the
 *    `h[1-6]` char-class boundaries (h0/h7 reject, h1/h6 accept), and the `\b` word
 *    boundary rejecting prefix false-matches (<paragraph>, <link>)
 *  - inline TAG stripping, `\s+` whitespace collapse, and `.trim()`
 *  - decodeEntities — all 6 replacements (&amp; &lt; &gt; &quot; &#39; &nbsp;), the
 *    order quirk (nbsp decoded AFTER collapse → not re-collapsed), and entity-encoded
 *    tags surviving as literal text (decode runs after tag-strip)
 *  - exact source-range offsets (start = m.index, end = m.index + m[0].length, tags incl.)
 *  - non-greedy `[\s\S]*?` + backreference `\1`: nested outer consumes inner, siblings
 *    stay separate, unclosed/mismatched-close → no match, case-insensitive open/close
 *  - the shared module-level `/g` regex is drained to null every call → repeat calls safe
 */

describe("parseHtml — basic extraction, source range, and page", () => {
  it("single <p> → exact span: text, [start,end) over the WHOLE block incl. tags, page 1", () => {
    expect(parseHtml("<p>Hello</p>")).toEqual([
      { text: "Hello", sourceRange: [0, 12], page: 1 },
    ]);
  });

  it("default param page = 1 when the arg is omitted", () => {
    expect(parseHtml("<p>x</p>")[0].page).toBe(1);
  });

  it("explicit page is threaded onto the span (not the default)", () => {
    expect(parseHtml("<p>Hi</p>", 5)).toEqual([
      { text: "Hi", sourceRange: [0, 9], page: 5 },
    ]);
  });

  it("range is offset by leading noise: prefix bytes push start/end forward", () => {
    // "zz" (2 bytes) then "<p>Hi</p>" (9 bytes) → block found at index 2, ends at 11.
    expect(parseHtml("zz<p>Hi</p>")).toEqual([
      { text: "Hi", sourceRange: [2, 11], page: 1 },
    ]);
  });

  it("N blocks → N spans with contiguous, non-overlapping ranges (global regex loops)", () => {
    expect(parseHtml("<h1>A</h1><p>B</p>")).toEqual([
      { text: "A", sourceRange: [0, 10], page: 1 },
      { text: "B", sourceRange: [10, 18], page: 1 },
    ]);
  });

  it("attributes are allowed by [^>]* and the range still spans the full opening tag", () => {
    const raw = '<p class="intro" data-id="7">Hello</p>';
    expect(parseHtml(raw)).toEqual([
      { text: "Hello", sourceRange: [0, raw.length], page: 1 },
    ]);
  });
});

describe("parseHtml — block-tag alternation & boundaries", () => {
  const accepted: Array<[string, string, string]> = [
    ["p", "<p>Para</p>", "Para"],
    ["h1", "<h1>H1</h1>", "H1"],
    ["h6", "<h6>H6</h6>", "H6"],
    ["li", "<li>Item</li>", "Item"],
    ["blockquote", "<blockquote>Q</blockquote>", "Q"],
    ["pre", "<pre>code</pre>", "code"],
    ["section", "<section>S</section>", "S"],
    ["article", "<article>Art</article>", "Art"],
    ["div", "<div>D</div>", "D"],
  ];
  it.each(accepted)("<%s> is a recognised block → one span with that text", (_tag, html, text) => {
    const doc = parseHtml(html);
    expect(doc).toHaveLength(1);
    expect(doc[0].text).toBe(text);
  });

  const rejected: Array<[string, string]> = [
    ["h0 is below the h[1-6] range", "<h0>x</h0>"],
    ["h7 is above the h[1-6] range", "<h7>x</h7>"],
    ["span is not a block tag", "<span>text</span>"],
    ["\\b rejects the <p> prefix of <paragraph>", "<paragraph>text</paragraph>"],
    ["\\b rejects the <li> prefix of <link>", "<link>text</link>"],
  ];
  it.each(rejected)("%s → no span", (_why, html) => {
    expect(parseHtml(html)).toEqual([]);
  });
});

describe("parseHtml — the !text skip branch", () => {
  it("empty block <p></p> → skipped, no span", () => {
    expect(parseHtml("<p></p>")).toEqual([]);
  });

  it("tag-only block (no visible text) → stripped to '' → skipped", () => {
    expect(parseHtml("<p><img src='x'/><br/></p>")).toEqual([]);
  });

  it("whitespace-only block collapses/trims to '' → skipped", () => {
    expect(parseHtml("<div>   \n\t  </div>")).toEqual([]);
  });

  it("skip-then-push: an empty block is `continue`d, the loop keeps going to the real one", () => {
    // "<p></p>" (7 bytes) is skipped; "<p>real</p>" starts at index 7, length 11.
    expect(parseHtml("<p></p><p>real</p>")).toEqual([
      { text: "real", sourceRange: [7, 18], page: 1 },
    ]);
  });
});

describe("parseHtml — inline stripping, whitespace collapse, trim", () => {
  it("inline markup inside a block is stripped, text kept", () => {
    expect(parseHtml("<p>Hello <b>brave</b> <i>world</i></p>")[0].text).toBe("Hello brave world");
  });

  it("newlines/tabs/multi-spaces collapse to a single space", () => {
    expect(parseHtml("<p>a\n\n\t  b   c</p>")[0].text).toBe("a b c");
  });

  it("leading/trailing whitespace is trimmed", () => {
    expect(parseHtml("<p>   trimmed   </p>")[0].text).toBe("trimmed");
  });

  it("<pre> whitespace is ALSO collapsed (this parser does not preserve it)", () => {
    expect(parseHtml("<pre>line1\n    line2</pre>")[0].text).toBe("line1 line2");
  });
});

describe("parseHtml — decodeEntities (all six replacements)", () => {
  const entities: Array<[string, string, string]> = [
    ["&amp;", "<p>A &amp; B</p>", "A & B"],
    ["&lt;", "<p>1 &lt; 2</p>", "1 < 2"],
    ["&gt;", "<p>3 &gt; 2</p>", "3 > 2"],
    ["&quot;", "<p>&quot;q&quot;</p>", '"q"'],
    ["&#39;", "<p>it&#39;s</p>", "it's"],
    ["&nbsp;", "<p>x&nbsp;y</p>", "x y"],
  ];
  it.each(entities)("%s is decoded", (_name, html, decoded) => {
    expect(parseHtml(html)[0].text).toBe(decoded);
  });

  it("all six in one block decode together in a single pass", () => {
    const raw = "<p>Tom &amp; Jerry &lt;3 &gt; &quot;hi&quot; it&#39;s&nbsp;ok</p>";
    expect(parseHtml(raw)[0].text).toBe('Tom & Jerry <3 > "hi" it\'s ok');
  });

  it("order quirk: &nbsp; is decoded AFTER \\s+ collapse, so nbsp-spaces are NOT re-collapsed", () => {
    // "a&nbsp;&nbsp;b" has no real whitespace to collapse; the two nbsp become TWO spaces.
    expect(parseHtml("<p>a&nbsp;&nbsp;b</p>")[0].text).toBe("a  b");
  });

  it("entity-encoded tags survive as literal text (decode runs AFTER tag-strip)", () => {
    // No real '<' exists to strip; &lt;/&gt; decode to a literal, un-stripped <script>…</script>.
    expect(parseHtml("<div>&lt;script&gt;alert(1)&lt;/script&gt;</div>")[0].text).toBe(
      "<script>alert(1)</script>",
    );
  });
});

describe("parseHtml — non-greedy, backreference, case-insensitivity", () => {
  it("nested block: the OUTER tag consumes the inner one → a single span over the whole outer", () => {
    // "<div><p>inner</p></div>" is 23 bytes; the div match swallows the inner <p>.
    expect(parseHtml("<div><p>inner</p></div>")).toEqual([
      { text: "inner", sourceRange: [0, 23], page: 1 },
    ]);
  });

  it("sibling same-tag blocks stay separate (non-greedy stops at the FIRST close)", () => {
    expect(parseHtml("<p>one</p><p>two</p>")).toEqual([
      { text: "one", sourceRange: [0, 10], page: 1 },
      { text: "two", sourceRange: [10, 20], page: 1 },
    ]);
  });

  it("unclosed block → no close tag → no match", () => {
    expect(parseHtml("<p>no close here")).toEqual([]);
  });

  it("mismatched close (backreference \\1 requires the SAME tag) → no match", () => {
    expect(parseHtml("<p>abc</div>")).toEqual([]);
  });

  it("case-insensitive open+close via the /i flag and case-insensitive backreference", () => {
    expect(parseHtml("<DIV>hi</div>")[0].text).toBe("hi");
    expect(parseHtml("<H2>Head</h2>")).toEqual([
      { text: "Head", sourceRange: [0, 13], page: 1 },
    ]);
  });
});

describe("parseHtml — empty input & shared /g regex state", () => {
  it("empty string → []", () => {
    expect(parseHtml("")).toEqual([]);
  });

  it("no block tags at all → []", () => {
    expect(parseHtml("plain text, no tags")).toEqual([]);
  });

  it("repeat calls are independent: the module-level /g regex is drained to null each time", () => {
    // A leftover lastIndex from a prior multi-match call must NOT corrupt the next call.
    const first = parseHtml("<p>a</p><p>b</p>");
    expect(first.map((s) => s.text)).toEqual(["a", "b"]);
    const second = parseHtml("<p>c</p>");
    expect(second).toEqual([{ text: "c", sourceRange: [0, 8], page: 1 }]);
    // and re-running the exact first input yields the exact same result (no drift).
    expect(parseHtml("<p>a</p><p>b</p>")).toEqual(first);
  });
});
