import { describe, it, expect } from "vitest";
import {
  isVisual,
  isText,
  pickVisualFor,
  classifySubject,
  countVisuals,
  defaultOutline,
  repairOutline,
  FALLBACK_VISUAL,
  SLOT_STATES,
  type OutlineSlot,
} from "@/server/conversation/outline";

/**
 * outline.ts — the deterministic lesson-shape guarantee. PURE logic: its only
 * import is the constant block-type registry (blockTypes.ts), so there is NO I/O
 * edge (no prisma/network/clock/DOM) — nothing is faked; every branch is exercised
 * against the real code. Each assertion names the EXACT expected value, never
 * "returned something". Covered:
 *   - isVisual / isText membership incl. the "formula counts as visual, not text" rule
 *   - pickVisualFor: all 10 shape rules + the FALLBACK_VISUAL fall-through
 *   - classifySubject: all 10 subject rules + the "General" fall-through
 *   - countVisuals over mixed / empty outlines
 *   - defaultOutline: both ternary branches (primary table→mindmap, primary flow→chart) + fallback
 *   - repairOutline: non-array raw, filter drops (null / non-string type / unknown type),
 *     intent coercion (nullish→topic, number→String, ""→kept), 1200 clamp, maxSlots clamp,
 *     <5→default boundary, bookend forcing, earlier-summary demotion, long-run breaking,
 *     the last-slot "run>max but not convertible" short-circuit, visual-floor top-up with
 *     middle-of-longest-run selection, and the "nothing left to convert" (-1) break.
 */

// Build a loosely-typed raw outline (mirrors what an untrusted model returns:
// null holes, non-string types, unknown types are all deliberately allowed here).
function raw(rows: unknown[]): OutlineSlot[] {
  return rows as unknown as OutlineSlot[];
}

describe("SLOT_STATES", () => {
  it("is exactly the five lifecycle states in order", () => {
    expect(SLOT_STATES).toEqual(["PLANNED", "GENERATING", "READY", "FAILED", "SKIPPED"]);
  });
});

describe("isVisual / isText — membership + the formula rule", () => {
  it("isVisual is true for real visual/math types, false for text + unknown", () => {
    expect(isVisual("flow")).toBe(true);
    expect(isVisual("mindmap")).toBe(true);
    expect(isVisual("timeline")).toBe(true);
    expect(isVisual("formula")).toBe(true); // math counts as a visual (D1)
    expect(isVisual("divider")).toBe(true);
    expect(isVisual("paragraph")).toBe(false);
    expect(isVisual("heading")).toBe(false);
    expect(isVisual("summary")).toBe(false);
    expect(isVisual("banana")).toBe(false);
  });

  it("isText is true for prose/admonition/list, false for visuals incl. formula", () => {
    expect(isText("paragraph")).toBe(true);
    expect(isText("heading")).toBe(true);
    expect(isText("summary")).toBe(true);
    expect(isText("callout")).toBe(true);
    expect(isText("bullet")).toBe(true);
    expect(isText("flow")).toBe(false);
    expect(isText("formula")).toBe(false); // formula is NOT text
    expect(isText("image")).toBe(false);
    expect(isText("banana")).toBe(false);
  });
});

describe("pickVisualFor — every shape rule + fallback", () => {
  it("maps each intent SHAPE to its visual (first matching rule wins)", () => {
    expect(pickVisualFor("the steps to solve it")).toBe("flow");
    expect(pickVisualFor("compare cats and dogs")).toBe("table");
    expect(pickVisualFor("the 19th century")).toBe("timeline");
    expect(pickVisualFor("the growth trend of data")).toBe("chart");
    expect(pickVisualFor("derive the formula")).toBe("formula");
    expect(pickVisualFor("bisect the triangle")).toBe("geometry");
    expect(pickVisualFor("plot the curve")).toBe("graph");
    expect(pickVisualFor("the river in the region")).toBe("map");
    expect(pickVisualFor("the atom and its bond")).toBe("molecule");
    expect(pickVisualFor("the types and kinds")).toBe("mindmap");
  });

  it("a year like '300 bc' hits the timeline stem", () => {
    expect(pickVisualFor("built around 300 bc")).toBe("timeline");
  });

  it("no rule matches → FALLBACK_VISUAL (mindmap)", () => {
    expect(FALLBACK_VISUAL).toBe("mindmap");
    expect(pickVisualFor("an abstract notion")).toBe("mindmap");
    expect(pickVisualFor("")).toBe("mindmap");
  });
});

describe("classifySubject — every subject rule + fallback", () => {
  it("classifies each subject deterministically (first matching rule wins)", () => {
    expect(classifySubject("quadratic equations")).toBe("Mathematics");
    expect(classifySubject("newton's laws of motion")).toBe("Physics");
    expect(classifySubject("acids and bases")).toBe("Chemistry");
    expect(classifySubject("photosynthesis in plants")).toBe("Biology");
    expect(classifySubject("the 1857 revolt")).toBe("History");
    expect(classifySubject("the monsoon climate")).toBe("Geography");
    expect(classifySubject("a poem about nature")).toBe("English");
    expect(classifySubject("the constitution and democracy")).toBe("Law");
    expect(classifySubject("supply and demand in the market")).toBe("Economics");
    expect(classifySubject("a sorting algorithm in code")).toBe("Computer Science");
  });

  it("no rule matches → General", () => {
    expect(classifySubject("happiness and joy")).toBe("General");
    expect(classifySubject("")).toBe("General");
  });

  it("stems match inflections (leading \\b only, no trailing boundary)", () => {
    expect(classifySubject("molecular shapes")).toBe("Chemistry"); // "molecul"
    expect(classifySubject("agricultural land")).toBe("Geography"); // "agricultur"
  });
});

describe("countVisuals", () => {
  it("counts only visual/math slots, ignoring text/heading/summary", () => {
    const o: OutlineSlot[] = raw([
      { slot: 1, type: "heading", intent: "h" },
      { slot: 2, type: "flow", intent: "a" },
      { slot: 3, type: "formula", intent: "b" }, // math → visual
      { slot: 4, type: "paragraph", intent: "c" },
      { slot: 5, type: "summary", intent: "d" },
    ]);
    expect(countVisuals(o)).toBe(2);
  });

  it("empty outline → 0", () => {
    expect(countVisuals([])).toBe(0);
  });
});

describe("defaultOutline — 9 varied slots, both ternary branches", () => {
  it("fallback topic (primary=mindmap) → secondary table, tertiary flow", () => {
    expect(defaultOutline("topic")).toEqual([
      { slot: 1, type: "heading", intent: "topic" },
      { slot: 2, type: "paragraph", intent: "what topic is and why it matters" },
      { slot: 3, type: "mindmap", intent: "the core structure of topic" },
      { slot: 4, type: "paragraph", intent: "explain the main idea of topic" },
      { slot: 5, type: "table", intent: "the key cases or parts of topic" },
      { slot: 6, type: "paragraph", intent: "a worked example of topic" },
      { slot: 7, type: "flow", intent: "how topic works step by step" },
      { slot: 8, type: "callout", intent: "the one thing to remember about topic" },
      { slot: 9, type: "summary", intent: "recap of topic" },
    ]);
  });

  it("primary=table → secondary flips to mindmap, tertiary stays flow", () => {
    const o = defaultOutline("compare a and b");
    expect(o[2].type).toBe("table"); // primary
    expect(o[4].type).toBe("mindmap"); // secondary (table→mindmap branch)
    expect(o[6].type).toBe("flow"); // tertiary (primary!==flow)
  });

  it("primary=flow → tertiary flips to chart, secondary stays table", () => {
    const o = defaultOutline("the steps here");
    expect(o[2].type).toBe("flow"); // primary
    expect(o[4].type).toBe("table"); // secondary (primary!==table)
    expect(o[6].type).toBe("chart"); // tertiary (flow→chart branch)
  });
});

describe("repairOutline — degenerate inputs fall back to defaultOutline", () => {
  it("non-array raw → default outline for the topic, source=default, no changes", () => {
    const res = repairOutline(null as unknown as OutlineSlot[], "topic");
    expect(res.source).toBe("default");
    expect(res.changes).toEqual([]);
    expect(res.outline).toEqual(defaultOutline("topic"));
  });

  it("filter drops null / non-string type / unknown type; <5 survivors → default", () => {
    const res = repairOutline(
      raw([
        { slot: 1, type: "heading", intent: "a" }, // kept
        null, // dropped: falsy
        { slot: 2, type: "banana", intent: "b" }, // dropped: unknown type
        { type: 123, intent: "c" }, // dropped: non-string type
        { slot: 4, type: "paragraph", intent: "d" }, // kept
      ]),
      "topicX",
    );
    // only 2 survived → below the 5-slot floor → known-good default
    expect(res.source).toBe("default");
    expect(res.outline).toEqual(defaultOutline("topicX"));
  });

  it("exactly 4 valid slots is still below the floor → default (boundary)", () => {
    const res = repairOutline(
      raw([
        { type: "heading", intent: "a" },
        { type: "paragraph", intent: "b" },
        { type: "flow", intent: "c" },
        { type: "summary", intent: "d" },
      ]),
      "topicY",
    );
    expect(res.source).toBe("default");
    expect(res.outline).toHaveLength(9);
  });
});

describe("repairOutline — step 1 mapping (renumber, intent coercion, clamps)", () => {
  it("drops unknown but keeps >=5: renumbers, coerces intents, clamps to 1200; no shape change needed", () => {
    const res = repairOutline(
      raw([
        { type: "heading", intent: null }, // null → topic
        { type: "banana", intent: "x" }, // dropped
        { type: "paragraph", intent: 42 }, // number → "42"
        { type: "flow", intent: "" }, // "" kept (not nullish)
        { type: "table", intent: "keep me" },
        { type: "chart", intent: "A".repeat(2000) }, // clamp → 1200
        { type: "summary", intent: undefined }, // undefined → topic
      ]),
      "Photosynthesis",
    );
    expect(res.source).toBe("model");
    expect(res.changes).toEqual([]); // already 3 visuals, no long runs, bookends correct
    expect(res.outline.map((s) => s.slot)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(res.outline.map((s) => s.type)).toEqual([
      "heading", "paragraph", "flow", "table", "chart", "summary",
    ]);
    expect(res.outline[0].intent).toBe("Photosynthesis"); // null ?? topic
    expect(res.outline[1].intent).toBe("42"); // String(42)
    expect(res.outline[2].intent).toBe(""); // empty string preserved
    expect(res.outline[3].intent).toBe("keep me");
    expect(res.outline[4].intent).toBe("A".repeat(1200)); // sliced
    expect(res.outline[5].intent).toBe("Photosynthesis"); // undefined ?? topic
  });

  it("more than maxSlots → clamped to maxSlots and renumbered 1..N", () => {
    const res = repairOutline(
      raw([
        { type: "heading", intent: "h" },
        { type: "flow", intent: "a" },
        { type: "paragraph", intent: "b" },
        { type: "table", intent: "c" },
        { type: "paragraph", intent: "d" },
        { type: "chart", intent: "e" },
        { type: "paragraph", intent: "f" },
        { type: "mermaid", intent: "g" },
        { type: "paragraph", intent: "h2" },
        { type: "graph", intent: "i" },
        { type: "summary", intent: "j" }, // 11th — sliced off by maxSlots=10
        { type: "paragraph", intent: "k" }, // 12th — sliced off
      ]),
      "Clamp",
    );
    expect(res.source).toBe("model");
    expect(res.outline).toHaveLength(10);
    expect(res.outline.map((s) => s.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // the original summary was sliced away, so the last kept slot is forced to summary
    expect(res.outline[9].type).toBe("summary");
    expect(res.changes).toContainEqual({
      slot: 10, from: "graph", to: "summary", reason: "last slot must be a summary",
    });
  });
});

describe("repairOutline — already-valid outline is returned unchanged", () => {
  it("heading first, one summary last, 3 visuals, no long run → zero changes", () => {
    const input = raw([
      { type: "heading", intent: "Intro" },
      { type: "paragraph", intent: "a" },
      { type: "flow", intent: "steps" },
      { type: "paragraph", intent: "b" },
      { type: "table", intent: "compare" },
      { type: "paragraph", intent: "c" },
      { type: "chart", intent: "data" },
      { type: "summary", intent: "recap" },
    ]);
    const res = repairOutline(input, "Anything");
    expect(res.source).toBe("model");
    expect(res.changes).toEqual([]);
    expect(res.outline).toEqual([
      { slot: 1, type: "heading", intent: "Intro" },
      { slot: 2, type: "paragraph", intent: "a" },
      { slot: 3, type: "flow", intent: "steps" },
      { slot: 4, type: "paragraph", intent: "b" },
      { slot: 5, type: "table", intent: "compare" },
      { slot: 6, type: "paragraph", intent: "c" },
      { slot: 7, type: "chart", intent: "data" },
      { slot: 8, type: "summary", intent: "recap" },
    ]);
  });
});

describe("repairOutline — step 3 bookends + summary demotion", () => {
  it("first non-heading and last non-summary are forced, with recorded changes", () => {
    const res = repairOutline(
      raw([
        { type: "paragraph", intent: "opener" },
        { type: "flow", intent: "a" },
        { type: "table", intent: "b" },
        { type: "chart", intent: "c" },
        { type: "paragraph", intent: "closer" },
      ]),
      "Bookends",
    );
    expect(res.source).toBe("model");
    expect(res.outline.map((s) => s.type)).toEqual([
      "heading", "flow", "table", "chart", "summary",
    ]);
    expect(res.changes).toEqual([
      { slot: 1, from: "paragraph", to: "heading", reason: "first slot must be a heading" },
      { slot: 5, from: "paragraph", to: "summary", reason: "last slot must be a summary" },
    ]);
    // intents survive the type coercion
    expect(res.outline[0].intent).toBe("opener");
    expect(res.outline[4].intent).toBe("closer");
  });

  it("an earlier summary is demoted to paragraph (exactly one summary allowed)", () => {
    const res = repairOutline(
      raw([
        { type: "heading", intent: "H" },
        { type: "summary", intent: "the steps" }, // stray early summary
        { type: "flow", intent: "a" },
        { type: "table", intent: "b" },
        { type: "summary", intent: "recap" },
      ]),
      "Demote",
    );
    expect(res.source).toBe("model");
    // slot 2 demoted summary→paragraph, then (only 2 visuals) topped up back to a visual
    expect(res.outline[4].type).toBe("summary"); // the real, final summary
    expect(res.outline.filter((s) => s.type === "summary")).toHaveLength(1);
    expect(res.changes).toContainEqual({
      slot: 2, from: "summary", to: "paragraph", reason: "only one summary allowed",
    });
    // top-up converted the demoted slot; its intent "the steps" picks flow
    expect(res.changes).toContainEqual({
      slot: 2, from: "paragraph", to: "flow", reason: "below 3 visuals",
    });
    expect(res.outline[1].type).toBe("flow");
    expect(countVisuals(res.outline)).toBe(3);
  });
});

describe("repairOutline — step 4 breaks long prose runs", () => {
  it("a 3-in-a-row interior text run converts the 3rd via pickVisualFor; the last slot is NOT convertible", () => {
    const res = repairOutline(
      raw([
        { type: "heading", intent: "H" }, // index 0 → run starts at 1 here
        { type: "paragraph", intent: "one" }, // run 2
        { type: "paragraph", intent: "the steps of it" }, // run 3 → broken, shape=flow
        { type: "paragraph", intent: "four" },
        { type: "paragraph", intent: "five" },
        { type: "paragraph", intent: "recap" }, // run>max here too, but it's the last slot
      ]),
      "Runs",
    );
    expect(res.source).toBe("model");
    // slot 3 (index 2) broke the run → pickVisualFor("the steps of it") = flow (not a blind mindmap)
    expect(res.changes).toContainEqual({
      slot: 3, from: "paragraph", to: "flow", reason: "more than 2 text blocks in a row",
    });
    expect(res.outline[2].type).toBe("flow");
    // the last slot is forced to summary by step 3, never converted by the run-breaker
    expect(res.outline[5].type).toBe("summary");
    // no change with a run reason ever targets slot 6 (the last slot is not convertible)
    expect(
      res.changes.some((c) => c.slot === 6 && c.reason.startsWith("more than")),
    ).toBe(false);
  });

  it("custom maxTextRun=1 breaks after two text blocks and names the threshold", () => {
    const res = repairOutline(
      raw([
        { type: "heading", intent: "H" },
        { type: "paragraph", intent: "the steps to do it" }, // 2nd text in a row (heading counts) → converted
        { type: "paragraph", intent: "x" },
        { type: "flow", intent: "y" },
        { type: "summary", intent: "z" },
      ]),
      "Tight",
      { maxTextRun: 1, minVisuals: 1 },
    );
    expect(res.source).toBe("model");
    expect(res.changes).toContainEqual({
      slot: 2, from: "paragraph", to: "flow", reason: "more than 1 text blocks in a row",
    });
    expect(res.outline[1].type).toBe("flow");
    expect(countVisuals(res.outline)).toBeGreaterThanOrEqual(1);
  });
});

describe("repairOutline — step 5 tops up to the visual floor", () => {
  it("converts the MIDDLE of the longest text run until minVisuals is met", () => {
    const res = repairOutline(
      raw([
        { type: "heading", intent: "Topic" },
        { type: "paragraph", intent: "the parts of it" },
        { type: "paragraph", intent: "the parts of it" },
        { type: "paragraph", intent: "the parts of it" },
        { type: "paragraph", intent: "the parts of it" },
        { type: "paragraph", intent: "the parts of it" },
        { type: "paragraph", intent: "the parts of it" },
        { type: "summary", intent: "recap" },
      ]),
      "MidRun",
    );
    expect(res.source).toBe("model");
    // step 4 broke the two long runs (indices 2 & 5); step 5 topped up index 3 (middle of the
    // longest remaining run) — all conversions resolve to mindmap ("the parts of it").
    expect(res.outline.map((s) => s.type)).toEqual([
      "heading", "paragraph", "mindmap", "mindmap", "paragraph", "mindmap", "paragraph", "summary",
    ]);
    expect(res.changes).toEqual([
      { slot: 3, from: "paragraph", to: "mindmap", reason: "more than 2 text blocks in a row" },
      { slot: 6, from: "paragraph", to: "mindmap", reason: "more than 2 text blocks in a row" },
      { slot: 4, from: "paragraph", to: "mindmap", reason: "below 3 visuals" },
    ]);
    expect(countVisuals(res.outline)).toBe(3);
  });

  it("unreachable floor: converts everything convertible then breaks (idx===-1), never loops forever", () => {
    const res = repairOutline(
      raw([
        { type: "heading", intent: "T" },
        { type: "paragraph", intent: "the topic" },
        { type: "paragraph", intent: "the topic" },
        { type: "paragraph", intent: "the topic" },
        { type: "summary", intent: "the topic" },
      ]),
      "T",
      { minVisuals: 5 }, // impossible: only 3 interior slots exist
    );
    expect(res.source).toBe("model");
    // all three interior slots become visual; the loop then hits the -1 break instead of hanging
    expect(res.outline.map((s) => s.type)).toEqual([
      "heading", "mindmap", "mindmap", "mindmap", "summary",
    ]);
    expect(countVisuals(res.outline)).toBe(3);
    expect(res.outline[0].type).toBe("heading");
    expect(res.outline[4].type).toBe("summary");
  });
});
