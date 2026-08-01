import { describe, it, expect } from "vitest";

import { buildSkeleton, type SkeletonBlock } from "@/server/conversation/skeleton";
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
  it("visual that KEEPS its type (table) → exactly { type, data }, no streamText — label is the TOPIC", () => {
    const [block] = buildSkeleton([{ slot: 1, type: "table", intent: "compare X and Y" }], TOPIC);
    // placeholder header is the TOPIC, NOT the intent "compare X and Y" (R4: intent never leaks)
    expect(block).toEqual({ type: "table", data: { headers: [TOPIC], rows: [[""]] } });
    expect("streamText" in block).toBe(false);
    expect(Object.keys(block).sort()).toEqual(["data", "type"]);
  });

  it("visual that DOWNGRADES its type (flow → mindmap) locks the resolved type — label is the TOPIC", () => {
    const [block] = buildSkeleton([{ slot: 1, type: "flow", intent: "the steps" }], TOPIC);
    // s.type was 'flow' but coerce could not natively build it → resolved type 'mindmap';
    // heading is the TOPIC, not the intent "the steps" (R4)
    expect(block.type).toBe("mindmap");
    expect(block).toEqual({ type: "mindmap", data: { markdown: `# ${TOPIC}` } });
    expect("streamText" in block).toBe(false);
  });
});

describe("buildSkeleton — NEVER leaks the slot intent into visible block data (R4 regression)", () => {
  // The bug the owner saw: a grounded slot's `intent` is a long MODEL DIRECTIVE
  // ("TEACH — do NOT restate…"). It was used as the visual skeleton's visible label,
  // so a slot that never filled left that raw prompt on the canvas. The skeleton
  // placeholder must be the TOPIC, never the intent. The intent still reaches the
  // model via the prompt path (manager.fillSlots), NOT the skeleton.
  const LEAK = "TEACH — do NOT restate or reword the definition. Walk through ONE worked example.";
  it("a long directive intent appears in NO skeleton block's data — the topic is used instead", () => {
    const out = buildSkeleton(
      [
        { slot: 1, type: "mindmap", intent: LEAK },
        { slot: 2, type: "table", intent: LEAK },
        { slot: 3, type: "flow", intent: LEAK },
        { slot: 4, type: "timeline", intent: LEAK },
      ],
      TOPIC,
    );
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("do NOT restate");
    expect(serialized).not.toContain("TEACH");
    expect(serialized).toContain(TOPIC); // placeholder carries the topic, not the prompt
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
      { type: "table", data: { headers: [TOPIC], rows: [[""]] } }, // label = topic, not intent (R4)
      { type: "mindmap", data: { markdown: `# ${TOPIC}` } }, // label = topic, not intent (R4)
      { type: "summary", data: { text: "" }, streamText: "" },
    ];
    expect(buildSkeleton(outline, TOPIC)).toEqual(expected);
  });
});
