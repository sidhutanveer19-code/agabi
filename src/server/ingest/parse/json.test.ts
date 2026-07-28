import { describe, it, expect } from "vitest";

import { parseJson } from "@/server/ingest/parse/json";
import type { Doc } from "@/server/ingest/spans";

/**
 * parseJson (W4) — JSON structured-source → canonical markdown → span-preserving Doc.
 * PURE: the only edge is `JSON.parse` (a language primitive, not I/O), so nothing is
 * mocked — every branch runs for real and every assertion names the EXACT Doc it must
 * produce (text + sourceRange offsets into the rendered markdown + page), never "did
 * not throw". Branches under test in jsonToMarkdown/parseJson:
 *   - Array.isArray(input) ternary: bare array → {blocks} vs object passthrough
 *   - doc.title truthy (rendered as `# `) vs falsy ("" / absent → skipped)
 *   - `doc.blocks ?? []`: array present vs undefined vs explicit null
 *   - per-block: heading truthy vs falsy ("" → skipped); text truthy vs falsy
 *   - level clamp `min(max(level ?? 2, 1), 6)`: default 2, low→1 (0 kept by ?? then
 *     clamped, proving ?? not ||), high→6, exact boundaries 1 & 6, mid 3
 *   - empty block / empty object / empty array → empty Doc
 *   - `page` default = 1 vs explicit override
 *   - JSON.parse failure (invalid) → SyntaxError; non-object primitives; null → TypeError
 *   - multiline text stays a single span (offset continuity)
 */

describe("parseJson — title / block rendering", () => {
  it("title only → single H1 span with exact source range", () => {
    // md = "# Hello World\n"
    const doc: Doc = parseJson('{"title":"Hello World"}');
    expect(doc).toEqual([{ text: "# Hello World", sourceRange: [0, 13], page: 1 }]);
  });

  it("title + block(heading default level 2 + text) → three spans, offsets survive blank lines", () => {
    // md = "# T\n\n## Intro\n\nSome body.\n"
    const doc = parseJson('{"title":"T","blocks":[{"heading":"Intro","text":"Some body."}]}');
    expect(doc).toEqual([
      { text: "# T", sourceRange: [0, 3], page: 1 },
      { text: "## Intro", sourceRange: [5, 13], page: 1 },
      { text: "Some body.", sourceRange: [15, 25], page: 1 },
    ]);
  });

  it("heading AND text in one block with mid level 3 → both if-branches fire", () => {
    // md = "### Sec\n\ncontent here\n"
    const doc = parseJson('{"blocks":[{"level":3,"heading":"Sec","text":"content here"}]}');
    expect(doc).toEqual([
      { text: "### Sec", sourceRange: [0, 7], page: 1 },
      { text: "content here", sourceRange: [9, 21], page: 1 },
    ]);
  });
});

describe("parseJson — bare array input (Array.isArray true branch)", () => {
  it("array of blocks is wrapped as {blocks}, no title", () => {
    // md = "## A\n\npara\n"
    const doc = parseJson('[{"heading":"A"},{"text":"para"}]');
    expect(doc).toEqual([
      { text: "## A", sourceRange: [0, 4], page: 1 },
      { text: "para", sourceRange: [6, 10], page: 1 },
    ]);
  });
});

describe("parseJson — heading level clamp min(max(level ?? 2,1),6)", () => {
  it("level 0 clamps UP to 1 (proves `?? 2` keeps 0, then clamp — not `|| 2`)", () => {
    // md = "# Low\n" (one hash, NOT two)
    const doc = parseJson('{"blocks":[{"level":0,"heading":"Low"}]}');
    expect(doc).toEqual([{ text: "# Low", sourceRange: [0, 5], page: 1 }]);
  });

  it("level 99 clamps DOWN to 6", () => {
    // md = "###### Deep\n"
    const doc = parseJson('{"blocks":[{"level":99,"heading":"Deep"}]}');
    expect(doc).toEqual([{ text: "###### Deep", sourceRange: [0, 11], page: 1 }]);
  });

  it("boundaries level 1 and level 6 both pass through unclamped", () => {
    // md = "# One\n\n###### Six\n"
    const doc = parseJson('{"blocks":[{"level":1,"heading":"One"},{"level":6,"heading":"Six"}]}');
    expect(doc).toEqual([
      { text: "# One", sourceRange: [0, 5], page: 1 },
      { text: "###### Six", sourceRange: [7, 17], page: 1 },
    ]);
  });
});

describe("parseJson — falsy-guard branches skip parts", () => {
  it("title === '' (falsy) is skipped; only the text block renders", () => {
    // md = "x\n"
    const doc = parseJson('{"title":"","blocks":[{"text":"x"}]}');
    expect(doc).toEqual([{ text: "x", sourceRange: [0, 1], page: 1 }]);
  });

  it("heading === '' (falsy) is skipped, text kept", () => {
    // md = "only text\n"
    const doc = parseJson('{"blocks":[{"heading":"","text":"only text"}]}');
    expect(doc).toEqual([{ text: "only text", sourceRange: [0, 9], page: 1 }]);
  });

  it("text === '' (falsy) is skipped, heading kept", () => {
    // md = "## Head\n"
    const doc = parseJson('{"blocks":[{"heading":"Head","text":""}]}');
    expect(doc).toEqual([{ text: "## Head", sourceRange: [0, 7], page: 1 }]);
  });

  it("blocks === null → `?? []` yields no iteration; title still rendered", () => {
    // md = "# T\n"
    const doc = parseJson('{"title":"T","blocks":null}');
    expect(doc).toEqual([{ text: "# T", sourceRange: [0, 3], page: 1 }]);
  });
});

describe("parseJson — empty renderings produce an empty Doc", () => {
  it("block with neither heading nor text → md is just '\\n' → []", () => {
    expect(parseJson('{"blocks":[{}]}')).toEqual([]);
  });

  it("empty object {} → []", () => {
    expect(parseJson("{}")).toEqual([]);
  });

  it("empty array [] → []", () => {
    expect(parseJson("[]")).toEqual([]);
  });
});

describe("parseJson — page parameter", () => {
  it("default page = 1 when omitted", () => {
    // md = "# P\n"
    expect(parseJson('{"title":"P"}')).toEqual([{ text: "# P", sourceRange: [0, 3], page: 1 }]);
  });

  it("explicit page is stamped onto every span", () => {
    expect(parseJson('{"title":"P"}', 5)).toEqual([{ text: "# P", sourceRange: [0, 3], page: 5 }]);
  });
});

describe("parseJson — multiline text stays a single span", () => {
  it("a text block containing a newline is NOT split (offsets stay contiguous)", () => {
    // JSON "line1\nline2" → md "line1\nline2\n"; parseMarkdown keeps runs across single \n
    const doc = parseJson('{"blocks":[{"text":"line1\\nline2"}]}');
    expect(doc).toEqual([{ text: "line1\nline2", sourceRange: [0, 11], page: 1 }]);
  });
});

describe("parseJson — JSON.parse / primitive edges", () => {
  it("invalid JSON throws SyntaxError (JSON.parse propagates)", () => {
    expect(() => parseJson("not json {")).toThrow(SyntaxError);
  });

  it("JSON string primitive → no title/blocks props → empty Doc", () => {
    expect(parseJson('"hi"')).toEqual([]);
  });

  it("JSON number primitive → empty Doc", () => {
    expect(parseJson("7")).toEqual([]);
  });

  it("JSON null → doc is null, reading `.title` throws TypeError (unguarded)", () => {
    expect(() => parseJson("null")).toThrow(TypeError);
  });
});
