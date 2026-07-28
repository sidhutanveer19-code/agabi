import { describe, it, expect } from "vitest";

import { skeletonData, buildSkeleton, type SkeletonBlock } from "@/server/conversation/skeleton";
import type { OutlineSlot } from "@/server/conversation/outline";

/**
 * skeletonData() + buildSkeleton() — the skeleton-first shell builder.
 *
 * This module has NO I/O edge (no db/network/clock) — it is pure branching over
 * `isText` + `coerceSlot`. Per §H1.7 those are LOGIC, so they are exercised for
 * REAL here, never mocked; every assertion names the EXACT resulting object and
 * asserts THAT (§H1.2), so a passing test means the real production shell is right.
 *
 * Branches under test:
 *  skeletonData:
 *    - heading (|| left true) and subheading (|| right true) → { text: topic }
 *    - text family (paragraph / admonition / list) caught by isText → { text: "" }
 *    - every visual family reached via coerceSlot: mindmap, flow(default-case),
 *      table, chart, graph, geometry, timeline, formula(math family)
 *    - the `(intent || "this")` label fallback, and the formula special-char → "..."
 *  buildSkeleton:
 *    - heading/subheading slot → streamText = topic (NOT "", proving heading is
 *      caught BEFORE the isText branch even though heading ∈ TEXT_ONLY_TYPES)
 *    - text slot → streamText = "", visual slot → NO streamText key at all
 *    - a visual coerce KEEPS its type (table) vs DOWNGRADES it (flow → mindmap)
 *    - empty outline → [], and a mixed outline mapped 1:1 in slot order
 */

const TOPIC = "Photosynthesis";
const DEFAULT_TRIANGLE = {
  points: [
    { id: "A", x: 0, y: 0, name: "A" },
    { id: "B", x: 4, y: 0, name: "B" },
    { id: "C", x: 2, y: 3, name: "C" },
  ],
  segments: [
    ["A", "B"],
    ["B", "C"],
    ["C", "A"],
  ],
};

describe("skeletonData — heading / subheading know the title", () => {
  it("heading (|| left branch) → { text: topic }", () => {
    expect(skeletonData("heading", "ignored intent", TOPIC)).toEqual({ text: TOPIC });
  });

  it("subheading (|| right branch, left false) → { text: topic }", () => {
    expect(skeletonData("subheading", "ignored intent", TOPIC)).toEqual({ text: TOPIC });
  });
});

describe("skeletonData — text family is blank until patched", () => {
  it("paragraph → { text: '' }", () => {
    expect(skeletonData("paragraph", "what a cell is", TOPIC)).toEqual({ text: "" });
  });

  it("admonition (callout) is isText → { text: '' }", () => {
    expect(skeletonData("callout", "remember this", TOPIC)).toEqual({ text: "" });
  });

  it("list (bullet) is isText → { text: '' } (real output, not the {items} runtime shape)", () => {
    expect(skeletonData("bullet", "key points", TOPIC)).toEqual({ text: "" });
  });
});

describe("skeletonData — visual families via coerceSlot (non-empty by construction)", () => {
  it("mindmap → minimal markdown heading of the intent", () => {
    expect(skeletonData("mindmap", "parts of a cell", TOPIC)).toEqual({ markdown: "# parts of a cell" });
  });

  it("flow (coerce default case) → downgraded DATA is minimal mindmap markdown", () => {
    // skeletonData returns only `.data`; the type downgrade is invisible here but
    // the data proves the default-case path ran (markdown, not flow nodes/edges).
    expect(skeletonData("flow", "how it works", TOPIC)).toEqual({ markdown: "# how it works" });
  });

  it("table → { headers: [intent], rows: [['']] }", () => {
    expect(skeletonData("table", "compare A and B", TOPIC)).toEqual({ headers: ["compare A and B"], rows: [[""]] });
  });

  it("chart → minimal VALID bar chart with two placeholder points", () => {
    expect(skeletonData("chart", "sales growth data", TOPIC)).toEqual({
      kind: "bar",
      series: [{ key: "value" }],
      data: [
        { label: "sales growth data", value: 1 },
        { label: "—", value: 1 },
      ],
      xKey: "label",
    });
  });

  it("graph → { fn: 'x' }", () => {
    expect(skeletonData("graph", "plot the curve", TOPIC)).toEqual({ fn: "x" });
  });

  it("geometry → the default triangle", () => {
    expect(skeletonData("geometry", "a triangle", TOPIC)).toEqual(DEFAULT_TRIANGLE);
  });

  it("timeline → one minimal item carrying the intent, empty start", () => {
    expect(skeletonData("timeline", "the 1857 revolt", TOPIC)).toEqual({
      items: [{ id: 1, content: "the 1857 revolt", start: "" }],
    });
  });

  it("formula (math family, before the switch) → LaTeX \\text{ intent }", () => {
    expect(skeletonData("formula", "the quadratic formula", TOPIC)).toEqual({
      latex: "\\text{the quadratic formula}",
    });
  });
});

describe("skeletonData — label edge cases (through the real coerce path)", () => {
  it("empty intent → label falls back to 'this' via (intent || 'this')", () => {
    expect(skeletonData("mindmap", "", TOPIC)).toEqual({ markdown: "# this" });
  });

  it("formula whose intent is all KaTeX-special chars → stripped to '...'", () => {
    // {}$&#%_^~\  are every char in the strip class → "" → falls back to "..."
    expect(skeletonData("formula", "{}$&#%_^~\\", TOPIC)).toEqual({ latex: "\\text{...}" });
  });
});

describe("buildSkeleton — heading / subheading slots stream the topic", () => {
  it("heading slot → streamText = topic (caught BEFORE isText, so NOT '')", () => {
    const out = buildSkeleton([{ slot: 1, type: "heading", intent: "irrelevant" }], TOPIC);
    expect(out).toEqual([{ type: "heading", data: { text: TOPIC }, streamText: TOPIC }]);
  });

  it("subheading slot (|| right branch) → streamText = topic", () => {
    const out = buildSkeleton([{ slot: 1, type: "subheading", intent: "irrelevant" }], TOPIC);
    expect(out).toEqual([{ type: "subheading", data: { text: TOPIC }, streamText: TOPIC }]);
  });
});

describe("buildSkeleton — text slots stream empty", () => {
  it("paragraph slot → { type, data:{text:''}, streamText:'' }", () => {
    const out = buildSkeleton([{ slot: 1, type: "paragraph", intent: "x" }], TOPIC);
    expect(out).toEqual([{ type: "paragraph", data: { text: "" }, streamText: "" }]);
  });

  it("admonition (summary) slot is isText → streamText ''", () => {
    const out = buildSkeleton([{ slot: 1, type: "summary", intent: "recap" }], TOPIC);
    expect(out).toEqual([{ type: "summary", data: { text: "" }, streamText: "" }]);
  });

  it("list (checklist) slot is isText → streamText ''", () => {
    const out = buildSkeleton([{ slot: 1, type: "checklist", intent: "todo" }], TOPIC);
    expect(out).toEqual([{ type: "checklist", data: { text: "" }, streamText: "" }]);
  });
});

describe("buildSkeleton — visual slots carry NO streamText key", () => {
  it("visual that KEEPS its type (table) → exactly { type, data }, no streamText", () => {
    const [block] = buildSkeleton([{ slot: 1, type: "table", intent: "compare X and Y" }], TOPIC);
    expect(block).toEqual({ type: "table", data: { headers: ["compare X and Y"], rows: [[""]] } });
    expect("streamText" in block).toBe(false);
    expect(Object.keys(block).sort()).toEqual(["data", "type"]);
  });

  it("visual that DOWNGRADES its type (flow → mindmap) locks the resolved type", () => {
    const [block] = buildSkeleton([{ slot: 1, type: "flow", intent: "the steps" }], TOPIC);
    // s.type was 'flow' but coerce could not natively build it → resolved type 'mindmap'
    expect(block.type).toBe("mindmap");
    expect(block).toEqual({ type: "mindmap", data: { markdown: "# the steps" } });
    expect("streamText" in block).toBe(false);
  });
});

describe("buildSkeleton — outline mapping", () => {
  it("empty outline → empty array", () => {
    expect(buildSkeleton([], TOPIC)).toEqual([]);
  });

  it("mixed outline maps 1:1 in slot order, mixing all three branches + a downgrade", () => {
    const outline: OutlineSlot[] = [
      { slot: 1, type: "heading", intent: "T" },
      { slot: 2, type: "paragraph", intent: "p" },
      { slot: 3, type: "table", intent: "compare X and Y" },
      { slot: 4, type: "flow", intent: "steps" },
      { slot: 5, type: "summary", intent: "recap" },
    ];
    const expected: SkeletonBlock[] = [
      { type: "heading", data: { text: TOPIC }, streamText: TOPIC },
      { type: "paragraph", data: { text: "" }, streamText: "" },
      { type: "table", data: { headers: ["compare X and Y"], rows: [[""]] } },
      { type: "mindmap", data: { markdown: "# steps" } },
      { type: "summary", data: { text: "" }, streamText: "" },
    ];
    expect(buildSkeleton(outline, TOPIC)).toEqual(expected);
  });
});
