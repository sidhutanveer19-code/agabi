import { describe, it, expect } from "vitest";

/**
 * blockTypes — the server-safe block registry (the authoritative source of truth
 * the model's tool description is built from, and that validateBlock/outline route
 * on). It has NO I/O, NO functions, NO branches: it is pure exported data, so there
 * is nothing to fake — every assertion below pins the EXACT real value or a real
 * structural INVARIANT that downstream code relies on:
 *   - exact contents + order of each group array (prompt.ts joins BLOCK_TYPES verbatim)
 *   - BLOCK_TYPES is precisely the concatenation of the five groups, no duplicates
 *   - BLOCK_TYPE_SET membership matches BLOCK_TYPES exactly (outline.ts filters on it)
 *   - the emit_text vs emit_visual split (TEXT_ONLY / VISUAL_ONLY) is a true PARTITION
 *     of BLOCK_TYPES — disjoint, and their union is every type (no block reachable by
 *     both tools, none reachable by neither); `formula` sits on the VISUAL side by design
 *   - HEADING/SUBHEADING are real subsets of TEXT_TYPES
 *   - BLOCK_HINTS is well-formed (every value a non-empty string) with exact known values,
 *     and its grouped keys resolve to a hint for every block type EXCEPT the two freeform
 *     drawing canvases (excalidraw, tldraw), which intentionally carry no shape hint.
 */

import {
  TEXT_TYPES,
  HEADING_TYPES,
  SUBHEADING_TYPES,
  ADMONITION_TYPES,
  LIST_TYPES,
  MATH_TYPES,
  VISUAL_TYPES,
  BLOCK_TYPES,
  BLOCK_TYPE_SET,
  BLOCK_HINTS,
  TEXT_ONLY_TYPES,
  VISUAL_ONLY_TYPES,
} from "@/server/conversation/blockTypes";

// The exact expected group contents, spelled out independently of the module so a
// silent edit to the source (add/remove/reorder a type) turns this suite red.
const EXPECT_TEXT = ["paragraph", "richtext", "heading", "subheading", "quote", "notes", "caption"];
const EXPECT_ADMONITION = ["callout", "tip", "warning", "summary", "definition", "example"];
const EXPECT_LIST = ["bullet", "numbered", "checklist"];
const EXPECT_MATH = ["formula", "equation", "inline-equation", "display-equation"];
const EXPECT_VISUAL = [
  "divider", "image", "table", "chart", "basic-diagram", "flow", "mermaid", "excalidraw",
  "tldraw", "graph", "monaco", "geometry", "mathfield", "threed", "physics", "molecule",
  "figure", "map", "timeline", "mindmap", "video", "audio", "gallery", "document", "embed",
];

describe("blockTypes — group arrays (exact contents + order)", () => {
  it("TEXT_TYPES is exactly the 7 prose/title types in order", () => {
    expect([...TEXT_TYPES]).toEqual(EXPECT_TEXT);
    expect(TEXT_TYPES.length).toBe(7);
  });

  it("ADMONITION_TYPES is exactly the 6 highlighted-note types in order", () => {
    expect([...ADMONITION_TYPES]).toEqual(EXPECT_ADMONITION);
    expect(ADMONITION_TYPES.length).toBe(6);
  });

  it("LIST_TYPES is exactly bullet/numbered/checklist", () => {
    expect([...LIST_TYPES]).toEqual(EXPECT_LIST);
    expect(LIST_TYPES.length).toBe(3);
  });

  it("MATH_TYPES is exactly the 4 KaTeX types in order", () => {
    expect([...MATH_TYPES]).toEqual(EXPECT_MATH);
    expect(MATH_TYPES.length).toBe(4);
  });

  it("VISUAL_TYPES is exactly the 25 visual types in order", () => {
    expect([...VISUAL_TYPES]).toEqual(EXPECT_VISUAL);
    expect(VISUAL_TYPES.length).toBe(25);
  });
});

describe("blockTypes — HEADING/SUBHEADING sets", () => {
  it("HEADING_TYPES contains only 'heading'", () => {
    expect([...HEADING_TYPES].sort()).toEqual(["heading"]);
    expect(HEADING_TYPES.has("heading")).toBe(true);
    expect(HEADING_TYPES.has("subheading")).toBe(false);
    expect(HEADING_TYPES.size).toBe(1);
  });

  it("SUBHEADING_TYPES contains only 'subheading'", () => {
    expect([...SUBHEADING_TYPES].sort()).toEqual(["subheading"]);
    expect(SUBHEADING_TYPES.has("subheading")).toBe(true);
    expect(SUBHEADING_TYPES.has("heading")).toBe(false);
    expect(SUBHEADING_TYPES.size).toBe(1);
  });

  it("both heading sets are genuine subsets of TEXT_TYPES", () => {
    const text = new Set<string>(TEXT_TYPES);
    for (const t of HEADING_TYPES) expect(text.has(t)).toBe(true);
    for (const t of SUBHEADING_TYPES) expect(text.has(t)).toBe(true);
  });
});

describe("blockTypes — BLOCK_TYPES is the concatenation of the five groups", () => {
  const expectedConcat = [
    ...EXPECT_TEXT, ...EXPECT_ADMONITION, ...EXPECT_LIST, ...EXPECT_MATH, ...EXPECT_VISUAL,
  ];

  it("equals TEXT ++ ADMONITION ++ LIST ++ MATH ++ VISUAL, in that exact order", () => {
    expect([...BLOCK_TYPES]).toEqual(expectedConcat);
  });

  it("has 45 entries = 7 + 6 + 3 + 4 + 25", () => {
    expect(BLOCK_TYPES.length).toBe(45);
    expect(BLOCK_TYPES.length).toBe(
      TEXT_TYPES.length + ADMONITION_TYPES.length + LIST_TYPES.length + MATH_TYPES.length + VISUAL_TYPES.length,
    );
  });

  it("contains NO duplicate type name (a dup would double-route a block)", () => {
    expect(new Set(BLOCK_TYPES).size).toBe(BLOCK_TYPES.length);
  });

  it("boundary: first entry is 'paragraph', last entry is 'embed'", () => {
    expect(BLOCK_TYPES[0]).toBe("paragraph");
    expect(BLOCK_TYPES[BLOCK_TYPES.length - 1]).toBe("embed");
  });
});

describe("blockTypes — BLOCK_TYPE_SET membership mirrors BLOCK_TYPES exactly", () => {
  it("size equals BLOCK_TYPES length and every type is a member", () => {
    expect(BLOCK_TYPE_SET.size).toBe(45);
    for (const t of BLOCK_TYPES) expect(BLOCK_TYPE_SET.has(t)).toBe(true);
  });

  it("rejects non-members: unknown name, empty string, and a wrong-case variant", () => {
    expect(BLOCK_TYPE_SET.has("nope")).toBe(false);
    expect(BLOCK_TYPE_SET.has("")).toBe(false);
    expect(BLOCK_TYPE_SET.has("Paragraph")).toBe(false); // membership is case-sensitive
    expect(BLOCK_TYPE_SET.has("headings")).toBe(false);  // near-miss plural
  });
});

describe("blockTypes — emit_text / emit_visual split is a true partition", () => {
  it("TEXT_ONLY_TYPES = TEXT ++ ADMONITION ++ LIST (16 types, exact order)", () => {
    expect([...TEXT_ONLY_TYPES]).toEqual([...EXPECT_TEXT, ...EXPECT_ADMONITION, ...EXPECT_LIST]);
    expect(TEXT_ONLY_TYPES.length).toBe(16);
  });

  it("VISUAL_ONLY_TYPES = MATH ++ VISUAL (29 types, exact order)", () => {
    expect([...VISUAL_ONLY_TYPES]).toEqual([...EXPECT_MATH, ...EXPECT_VISUAL]);
    expect(VISUAL_ONLY_TYPES.length).toBe(29);
  });

  it("the two tool sides are DISJOINT (no block reachable by both tools)", () => {
    const textSet = new Set<string>(TEXT_ONLY_TYPES);
    const overlap = [...VISUAL_ONLY_TYPES].filter((t) => textSet.has(t));
    expect(overlap).toEqual([]);
  });

  it("their union is EXACTLY BLOCK_TYPES (no block reachable by neither tool)", () => {
    const union = new Set<string>([...TEXT_ONLY_TYPES, ...VISUAL_ONLY_TYPES]);
    expect(union.size).toBe(BLOCK_TYPES.length);
    for (const t of BLOCK_TYPES) expect(union.has(t)).toBe(true);
    // and nothing extra sneaks in
    expect(TEXT_ONLY_TYPES.length + VISUAL_ONLY_TYPES.length).toBe(BLOCK_TYPES.length);
  });

  it("'formula' is on the VISUAL side, NOT the text side (maths blocks are visuals)", () => {
    expect(new Set<string>(VISUAL_ONLY_TYPES).has("formula")).toBe(true);
    expect(new Set<string>(TEXT_ONLY_TYPES).has("formula")).toBe(false);
  });
});

describe("blockTypes — BLOCK_HINTS integrity", () => {
  it("is a plain record of 28 entries, every value a non-empty string", () => {
    const entries = Object.entries(BLOCK_HINTS);
    expect(entries.length).toBe(28);
    for (const [, v] of entries) {
      expect(typeof v).toBe("string");
      expect(v.length).toBeGreaterThan(0);
    }
  });

  it("carries the exact known hint text for a spread of keys", () => {
    expect(BLOCK_HINTS.mermaid).toBe("{ source: string } — valid Mermaid syntax (e.g. 'graph TD; A-->B')");
    expect(BLOCK_HINTS.table).toBe("{ headers: string[], rows: string[][] }");
    expect(BLOCK_HINTS.divider).toBe("{} — a horizontal rule");
    expect(BLOCK_HINTS.chart).toBe(
      "{ kind: 'bar'|'line'|'area'|'pie'|'scatter', series: [{key:string}], data: [{label:string, value:number}], xKey?: string }",
    );
    expect(BLOCK_HINTS["bullet/numbered/checklist"]).toBe("{ items: [{ text: string, checked?: boolean }] }");
  });

  it("every block type resolves to a hint EXCEPT the two freeform canvases", () => {
    // Mirrors prompt.ts's resolveHint: direct key, else a grouped key that lists or
    // contains the type. Pins the real current reachability of model guidance (D1/I1).
    const resolveHint = (type: string): boolean => {
      if (BLOCK_HINTS[type]) return true;
      return Object.keys(BLOCK_HINTS).some((k) => k.split("/").includes(type) || k.includes(type));
    };
    const unresolved = [...BLOCK_TYPES].filter((t) => !resolveHint(t));
    expect(unresolved).toEqual(["excalidraw", "tldraw"]);
    expect([...BLOCK_TYPES].filter((t) => resolveHint(t)).length).toBe(43);
  });
});
