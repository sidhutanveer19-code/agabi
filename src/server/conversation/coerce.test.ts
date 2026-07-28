import { describe, it, expect } from "vitest";
import { coerceSlot, hasMeaningfulPayload } from "@/server/conversation/coerce";

/**
 * coerceSlot (RUNG 4 repair + RUNG 5 minimal) + hasMeaningfulPayload.
 * PURE logic — no I/O, no clock, no db; the only imports are the pure `outline`
 * (isText / FALLBACK_VISUAL) + `blockTypes` sets, so NOTHING is mocked and every
 * branch is exercised for real. Each assertion names the EXACT returned block
 * (type + data + status), never "did not throw". Covered: the two internal
 * helpers asStr/obj (through the public fns), each type family, every clean /
 * repaired / minimal fork, the `?? ` fallbacks, ISO date scrubbing, ragged-row
 * padding & truncation, non-finite point filtering, label slicing & LaTeX
 * sanitisation, and the meaningful-payload predicate's every value shape.
 */

describe("hasMeaningfulPayload", () => {
  it("non-empty text string → true (data ignored)", () => {
    expect(hasMeaningfulPayload("hello", {})).toBe(true);
  });

  it("whitespace-only text + empty data → false", () => {
    expect(hasMeaningfulPayload("   ", {})).toBe(false);
  });

  it("non-string text is treated as empty; a number does NOT count as text", () => {
    // text = 42 (non-string) → t = "" → falls through to the (empty) data check
    expect(hasMeaningfulPayload(42, {})).toBe(false);
    // …but real data still rescues it
    expect(hasMeaningfulPayload(42, { a: "x" })).toBe(true);
  });

  it("null/undefined text → t=''; data with a meaningful string → true", () => {
    expect(hasMeaningfulPayload(null, { a: "content" })).toBe(true);
    expect(hasMeaningfulPayload(undefined, { a: "content" })).toBe(true);
  });

  it("data with a non-empty array → true", () => {
    expect(hasMeaningfulPayload("", { list: [1] })).toBe(true);
  });

  it("data with a finite number → true", () => {
    expect(hasMeaningfulPayload("", { n: 5 })).toBe(true);
  });

  it("data with a non-null object that has keys → true", () => {
    expect(hasMeaningfulPayload("", { nested: { b: 1 } })).toBe(true);
  });

  it("every value shape empty → false (whitespace str, empty array, null, empty obj)", () => {
    expect(hasMeaningfulPayload("", { s: "   ", a: [], z: null, o: {} })).toBe(false);
  });

  it("a non-finite number (NaN) does NOT count → false", () => {
    expect(hasMeaningfulPayload("", { n: NaN })).toBe(false);
    expect(hasMeaningfulPayload("", { n: Infinity })).toBe(false);
  });

  it("data itself is null / non-object → obj() coerces to {} → false", () => {
    expect(hasMeaningfulPayload("", null)).toBe(false);
    expect(hasMeaningfulPayload("", "not-an-object")).toBe(false);
  });
});

describe("coerceSlot — text family", () => {
  it("clean: data.text present → { text } clean", () => {
    expect(coerceSlot("paragraph", { text: "direct" }, "ignored", "foo")).toEqual({
      type: "paragraph",
      data: { text: "direct" },
      status: "clean",
    });
  });

  it("clean: data.text absent → falls back to the text arg via ??", () => {
    expect(coerceSlot("callout", {}, "hello world", "foo")).toEqual({
      type: "callout",
      data: { text: "hello world" },
      status: "clean",
    });
  });

  it("minimal: data.text = '' BLOCKS the ?? fallback (empty string is not null) → label used", () => {
    // ?? only falls back on null/undefined, so "" wins over the real text arg → minimal
    expect(coerceSlot("bullet", { text: "" }, "real text here", "the topic")).toEqual({
      type: "bullet",
      data: { text: "the topic" },
      status: "minimal",
    });
  });

  it("minimal: empty everything + empty intent → label defaults to 'this'", () => {
    expect(coerceSlot("heading", {}, "", "")).toEqual({
      type: "heading",
      data: { text: "this" },
      status: "minimal",
    });
  });

  it("minimal: label is sliced to 60 chars", () => {
    const long = "x".repeat(70);
    expect(coerceSlot("quote", {}, "", long)).toEqual({
      type: "quote",
      data: { text: "x".repeat(60) },
      status: "minimal",
    });
  });
});

describe("coerceSlot — math family", () => {
  it("clean: data.latex present", () => {
    expect(coerceSlot("formula", { latex: "E=mc^2" }, "", "energy")).toEqual({
      type: "formula",
      data: { latex: "E=mc^2" },
      status: "clean",
    });
  });

  it("clean: latex falls back to the text arg via ??", () => {
    expect(coerceSlot("equation", {}, "x^2 + 1", "poly")).toEqual({
      type: "equation",
      data: { latex: "x^2 + 1" },
      status: "clean",
    });
  });

  it("minimal: empty → \\text{<sanitised label>} (special chars → spaces)", () => {
    expect(coerceSlot("display-equation", {}, "", "a{b}c")).toEqual({
      type: "display-equation",
      data: { latex: "\\text{a b c}" },
      status: "minimal",
    });
  });

  it("minimal: label of only special chars collapses to '...'", () => {
    expect(coerceSlot("inline-equation", {}, "", "{}$&#")).toEqual({
      type: "inline-equation",
      data: { latex: "\\text{...}" },
      status: "minimal",
    });
  });
});

describe("coerceSlot — mindmap", () => {
  it("clean: data.markdown present", () => {
    expect(coerceSlot("mindmap", { markdown: "# Root\n## Leaf" }, "", "map")).toEqual({
      type: "mindmap",
      data: { markdown: "# Root\n## Leaf" },
      status: "clean",
    });
  });

  it("repaired: no markdown but text present → synthesised from label + text", () => {
    expect(coerceSlot("mindmap", {}, "some prose", "Topic")).toEqual({
      type: "mindmap",
      data: { markdown: "# Topic\n## some prose" },
      status: "repaired",
    });
  });

  it("minimal: no markdown, no text → just the label heading", () => {
    expect(coerceSlot("mindmap", {}, "", "Bare")).toEqual({
      type: "mindmap",
      data: { markdown: "# Bare" },
      status: "minimal",
    });
  });
});

describe("coerceSlot — timeline", () => {
  it("clean: one valid item, valid ISO date, nothing dropped, no id → id = index+1", () => {
    expect(coerceSlot("timeline", { items: [{ content: "Founded", start: "1990" }] }, "", "hist")).toEqual({
      type: "timeline",
      data: { items: [{ id: 1, content: "Founded", start: "1990" }] },
      status: "clean",
    });
  });

  it("clean: id (string) kept, content from io.text fallback, YYYY-MM date kept", () => {
    expect(
      coerceSlot("timeline", { items: [{ id: "evt-a", text: "viaText", start: "2020-05" }] }, "", "hist"),
    ).toEqual({
      type: "timeline",
      data: { items: [{ id: "evt-a", content: "viaText", start: "2020-05" }] },
      status: "clean",
    });
  });

  it("repaired: unparseable date is scrubbed to '' (changed=true)", () => {
    expect(coerceSlot("timeline", { items: [{ content: "E", start: "March 1990" }] }, "", "hist")).toEqual({
      type: "timeline",
      data: { items: [{ id: 1, content: "E", start: "" }] },
      status: "repaired",
    });
  });

  it("repaired: an item with no content is dropped (items.length !== raw.length)", () => {
    expect(
      coerceSlot(
        "timeline",
        { items: [{ content: "keep", start: "2000" }, { start: "2001" }] },
        "",
        "hist",
      ),
    ).toEqual({
      type: "timeline",
      data: { items: [{ id: 1, content: "keep", start: "2000" }] },
      status: "repaired",
    });
  });

  it("minimal: items not an array → single label item", () => {
    expect(coerceSlot("timeline", { items: "nope" }, "", "history")).toEqual({
      type: "timeline",
      data: { items: [{ id: 1, content: "history", start: "" }] },
      status: "minimal",
    });
  });
});

describe("coerceSlot — table", () => {
  it("clean: headers coerced to strings, rows already the right width", () => {
    expect(coerceSlot("table", { headers: [1, 2], rows: [["a", "b"]] }, "", "t")).toEqual({
      type: "table",
      data: { headers: ["1", "2"], rows: [["a", "b"]] },
      status: "clean",
    });
  });

  it("repaired: short row is PADDED with '' to header width", () => {
    expect(coerceSlot("table", { headers: ["A", "B"], rows: [["x"]] }, "", "t")).toEqual({
      type: "table",
      data: { headers: ["A", "B"], rows: [["x", ""]] },
      status: "repaired",
    });
  });

  it("repaired: long row is TRUNCATED to header width", () => {
    expect(coerceSlot("table", { headers: ["A"], rows: [["x", "y"]] }, "", "t")).toEqual({
      type: "table",
      data: { headers: ["A"], rows: [["x"]] },
      status: "repaired",
    });
  });

  it("clean: a non-array row becomes a single-cell row [asStr(r)]", () => {
    expect(coerceSlot("table", { headers: ["A"], rows: ["scalar"] }, "", "t")).toEqual({
      type: "table",
      data: { headers: ["A"], rows: [["scalar"]] },
      status: "clean",
    });
  });

  it("clean: rows not an array → empty rows", () => {
    expect(coerceSlot("table", { headers: ["A"], rows: "nope" }, "", "t")).toEqual({
      type: "table",
      data: { headers: ["A"], rows: [] },
      status: "clean",
    });
  });

  it("minimal: no headers → single label header + one empty cell", () => {
    expect(coerceSlot("table", {}, "", "Compare")).toEqual({
      type: "table",
      data: { headers: ["Compare"], rows: [[""]] },
      status: "minimal",
    });
  });
});

describe("coerceSlot — chart", () => {
  it("clean: valid kind + series + xKey kept, ≥2 finite points, nothing filtered", () => {
    expect(
      coerceSlot(
        "chart",
        { kind: "line", series: [{ key: "sales" }], xKey: "month", data: [{ month: 0, sales: 5 }, { month: 1, sales: 8 }] },
        "",
        "s",
      ),
    ).toEqual({
      type: "chart",
      data: {
        kind: "line",
        series: [{ key: "sales" }],
        data: [{ month: 0, sales: 5 }, { month: 1, sales: 8 }],
        xKey: "month",
      },
      status: "clean",
    });
  });

  it("clean: invalid kind → 'bar', absent series → default, no xKey", () => {
    expect(coerceSlot("chart", { kind: "wat", data: [{ value: 1 }, { value: 2 }] }, "", "s")).toEqual({
      type: "chart",
      data: { kind: "bar", series: [{ key: "value" }], data: [{ value: 1 }, { value: 2 }] },
      status: "clean",
    });
  });

  it("repaired: a point with no finite number is filtered → status repaired", () => {
    expect(
      coerceSlot("chart", { data: [{ value: 1 }, { value: 2 }, { label: "no-number" }] }, "", "s"),
    ).toEqual({
      type: "chart",
      data: { kind: "bar", series: [{ key: "value" }], data: [{ value: 1 }, { value: 2 }] },
      status: "repaired",
    });
  });

  it("minimal: fewer than 2 valid points → the placeholder two-bar chart", () => {
    expect(coerceSlot("chart", { data: [{ value: 1 }] }, "", "Revenue")).toEqual({
      type: "chart",
      data: {
        kind: "bar",
        series: [{ key: "value" }],
        data: [{ label: "Revenue", value: 1 }, { label: "—", value: 1 }],
        xKey: "label",
      },
      status: "minimal",
    });
  });

  it("minimal: data not an array at all → rawPts = [] → placeholder chart", () => {
    expect(coerceSlot("chart", { data: "not-an-array" }, "", "R")).toEqual({
      type: "chart",
      data: {
        kind: "bar",
        series: [{ key: "value" }],
        data: [{ label: "R", value: 1 }, { label: "—", value: 1 }],
        xKey: "label",
      },
      status: "minimal",
    });
  });

  it("minimal: NaN/string values are non-finite → filtered below the ≥2 bar", () => {
    expect(coerceSlot("chart", { data: [{ value: NaN }, { value: "3" }] }, "", "R")).toEqual({
      type: "chart",
      data: {
        kind: "bar",
        series: [{ key: "value" }],
        data: [{ label: "R", value: 1 }, { label: "—", value: 1 }],
        xKey: "label",
      },
      status: "minimal",
    });
  });
});

describe("coerceSlot — graph", () => {
  it("clean: fn from data.fn", () => {
    expect(coerceSlot("graph", { fn: "sin(x)" }, "", "wave")).toEqual({
      type: "graph",
      data: { fn: "sin(x)" },
      status: "clean",
    });
  });

  it("clean: fn falls back to data.expression via ??", () => {
    expect(coerceSlot("graph", { expression: "x^2" }, "", "parabola")).toEqual({
      type: "graph",
      data: { fn: "x^2" },
      status: "clean",
    });
  });

  it("minimal: no fn/expression → identity fn 'x'", () => {
    expect(coerceSlot("graph", {}, "", "g")).toEqual({
      type: "graph",
      data: { fn: "x" },
      status: "minimal",
    });
  });
});

describe("coerceSlot — geometry", () => {
  it("clean: ≥2 points → the whole data object is kept verbatim", () => {
    const data = { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], segments: [["A", "B"]] };
    expect(coerceSlot("geometry", data, "", "shape")).toEqual({
      type: "geometry",
      data,
      status: "clean",
    });
  });

  it("minimal: fewer than 2 points → DEFAULT_TRIANGLE", () => {
    expect(coerceSlot("geometry", { points: [{ x: 0, y: 0 }] }, "", "shape")).toEqual({
      type: "geometry",
      data: {
        points: [
          { id: "A", x: 0, y: 0, name: "A" },
          { id: "B", x: 4, y: 0, name: "B" },
          { id: "C", x: 2, y: 3, name: "C" },
        ],
        segments: [["A", "B"], ["B", "C"], ["C", "A"]],
      },
      status: "minimal",
    });
  });

  it("minimal: points not an array → DEFAULT_TRIANGLE", () => {
    const res = coerceSlot("geometry", { points: "nope" }, "", "shape");
    expect(res.status).toBe("minimal");
    expect(res.type).toBe("geometry");
    expect(res.data.segments).toEqual([["A", "B"], ["B", "C"], ["C", "A"]]);
  });
});

describe("coerceSlot — default (unknown visual types)", () => {
  it("clean: unknown type with any content is kept as-is", () => {
    expect(coerceSlot("flow", { nodes: ["a", "b"] }, "", "process")).toEqual({
      type: "flow",
      data: { nodes: ["a", "b"] },
      status: "clean",
    });
  });

  it("minimal: unknown type + empty data → downgraded to a mindmap block", () => {
    expect(coerceSlot("flow", {}, "", "The Process")).toEqual({
      type: "mindmap",
      data: { markdown: "# The Process" },
      status: "minimal",
    });
  });

  it("minimal: rawData null (obj() → {}) → mindmap fallback", () => {
    expect(coerceSlot("diagram", null, "", "X")).toEqual({
      type: "mindmap",
      data: { markdown: "# X" },
      status: "minimal",
    });
  });
});
