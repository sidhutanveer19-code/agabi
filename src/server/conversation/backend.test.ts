import { describe, it, expect } from "vitest";
import { BLOCK_TYPES, BLOCK_TYPE_SET } from "@/server/conversation/blockTypes";
import { providerChain, isFallthroughError } from "@/server/advisors/providers";
import { repairOutline, defaultOutline, pickVisualFor, isText, countVisuals, type OutlineSlot } from "@/server/conversation/outline";
import { BATCH_FIELD_DESCRIPTIONS } from "@/server/advisors/tools";
import { coerceSlot, hasMeaningfulPayload } from "@/server/conversation/coerce";
import { buildSkeleton, skeletonData } from "@/server/conversation/skeleton";
import { adaptBlock } from "@/server/conversation/validateBlock";

const slots = (types: string[]): OutlineSlot[] =>
  types.map((type, i) => ({ slot: i + 1, type, intent: `slot ${i} intent` }));

// Interior text run (excludes the heading + summary bookends, which are always
// text by design). This is the invariant repairOutline actually guarantees: a
// closing `summary` after two content blocks is acceptable, not a violation.
const maxTextRun = (o: OutlineSlot[]): number => {
  let best = 0, run = 0;
  for (let i = 1; i < o.length - 1; i++) {
    if (isText(o[i].type)) { run++; best = Math.max(best, run); } else run = 0;
  }
  return best;
};

describe("repairOutline — THE GUARANTEE", () => {
  it("an all-text outline of 9 slots gets >= 3 visuals", () => {
    const r = repairOutline(slots(["heading", "paragraph", "paragraph", "paragraph", "paragraph", "paragraph", "paragraph", "paragraph", "summary"]), "photosynthesis");
    expect(countVisuals(r.outline)).toBeGreaterThanOrEqual(3);
  });

  it("an empty array returns defaultOutline with >= 3 visuals", () => {
    const r = repairOutline([], "gravity");
    expect(r.outline.length).toBe(defaultOutline("gravity").length);
    expect(countVisuals(r.outline)).toBeGreaterThanOrEqual(3);
  });

  it("garbage types return defaultOutline", () => {
    const r = repairOutline(slots(["blah", "nope", "xyz"]), "atoms");
    expect(r.outline.length).toBe(defaultOutline("atoms").length);
    expect(countVisuals(r.outline)).toBeGreaterThanOrEqual(3);
  });

  it("first slot is always heading, last is always exactly one summary", () => {
    const r = repairOutline(slots(["paragraph", "chart", "summary", "table", "paragraph", "summary"]), "trade");
    expect(r.outline[0].type).toBe("heading");
    expect(r.outline[r.outline.length - 1].type).toBe("summary");
    expect(r.outline.filter((s) => s.type === "summary").length).toBe(1);
  });

  it("never more than 2 text slots in a row", () => {
    const r = repairOutline(slots(["heading", "paragraph", "paragraph", "paragraph", "paragraph", "paragraph", "paragraph", "summary"]), "cells");
    expect(maxTextRun(r.outline)).toBeLessThanOrEqual(2);
  });

  it("an outline that already satisfies everything is returned unchanged", () => {
    const good = slots(["heading", "formula", "paragraph", "chart", "paragraph", "table", "mindmap", "summary"]);
    const r = repairOutline(good, "algebra");
    expect(r.changes).toEqual([]);
    expect(r.outline.map((s) => s.type)).toEqual(good.map((s) => s.type));
  });

  it("pickVisualFor maps intent by SHAPE", () => {
    expect(pickVisualFor("steps of photosynthesis")).toBe("flow");
    expect(pickVisualFor("compare rural and urban")).toBe("table");
    expect(pickVisualFor("the 1857 revolt")).toBe("timeline");
    expect(pickVisualFor("the essence of a good story")).toBe("mindmap"); // no keyword -> fallback
  });

  it("property: 200 random realistic outlines ALWAYS end with >= 3 visuals", () => {
    const pool = [...BLOCK_TYPES, "blah", "nope"]; // include garbage
    for (let n = 0; n < 200; n++) {
      const len = 5 + Math.floor(Math.random() * 8); // 5..12 (real outlines are 7-9)
      const types = Array.from({ length: len }, () => pool[Math.floor(Math.random() * pool.length)]);
      const r = repairOutline(slots(types), "topic");
      expect(countVisuals(r.outline)).toBeGreaterThanOrEqual(3);
      expect(r.outline[0].type).toBe("heading");
      expect(r.outline[r.outline.length - 1].type).toBe("summary");
      expect(maxTextRun(r.outline)).toBeLessThanOrEqual(2);
    }
  });

  it("source is 'model' for a valid outline, 'default' with no changes for junk", () => {
    const valid = repairOutline(slots(["heading", "formula", "paragraph", "chart", "paragraph", "table", "mindmap", "summary"]), "algebra");
    expect(valid.source).toBe("model");
    const junk = repairOutline(slots(["blah", "nope"]), "atoms");
    expect(junk.source).toBe("default");
    expect(junk.changes).toEqual([]);
  });

  it("defaultOutline is topic-aware (timeline for a date topic, formula for maths)", () => {
    expect(defaultOutline("the 1857 revolt").some((s) => s.type === "timeline")).toBe(true);
    expect(defaultOutline("quadratic equations").some((s) => s.type === "formula")).toBe(true);
  });
});

describe("empty-payload gate — conversation's accept step (an empty fill is NOT authored)", () => {
  it("hasMeaningfulPayload: {} / whitespace / {markdown:''} are empty; real content passes", () => {
    expect(hasMeaningfulPayload("", {})).toBe(false);
    expect(hasMeaningfulPayload("   ", {})).toBe(false);
    expect(hasMeaningfulPayload("", { markdown: "" })).toBe(false);
    expect(hasMeaningfulPayload("", { markdown: "# Real" })).toBe(true);
    expect(hasMeaningfulPayload("some prose", {})).toBe(true);
    expect(hasMeaningfulPayload("", { items: [{ id: 1 }] })).toBe(true);
  });

  it("batch-tool field descriptions are non-empty (weak models refuse a tool they can't see)", () => {
    for (const key of ["slot", "data", "text"] as const) {
      expect(BATCH_FIELD_DESCRIPTIONS[key].length).toBeGreaterThan(10);
    }
  });
});

describe("coerceSlot — RUNG 4 repair + RUNG 5 minimal visual (never a paragraph)", () => {
  it("timeline: keeps items with content, drops an unparseable date", () => {
    const c = coerceSlot("timeline", { items: [{ id: 1, content: "Revolt", start: "Late 19th century" }, { id: 2, content: "Reform", start: "1905" }] }, "", "the revolt");
    expect(c.type).toBe("timeline");
    const items = c.data.items as Array<{ content: string; start: string }>;
    expect(items[0].content).toBe("Revolt");
    expect(items[0].start).toBe(""); // bad date dropped, content kept
    expect(items[1].start).toBe("1905"); // valid ISO-ish year kept
    expect(c.status).toBe("repaired");
  });

  it("chart: drops non-numeric points, keeps the rest when >= 2 remain", () => {
    const c = coerceSlot("chart", { kind: "bar", series: [{ key: "value" }], data: [{ label: "A", value: 3 }, { label: "B", value: "oops" }, { label: "C", value: 5 }] }, "", "growth");
    const data = c.data.data as Array<{ value: unknown }>;
    expect(data.length).toBe(2);
    expect(c.status).toBe("repaired");
  });

  it("table: pads ragged rows to the header width", () => {
    const c = coerceSlot("table", { headers: ["A", "B", "C"], rows: [["1"], ["1", "2", "3"]] }, "", "compare");
    const rows = c.data.rows as string[][];
    expect(rows[0]).toEqual(["1", "", ""]);
    expect(c.status).toBe("repaired");
  });

  it("mindmap: wraps stray text into markdown", () => {
    const c = coerceSlot("mindmap", {}, "roots absorb water", "the plant");
    expect(String(c.data.markdown)).toContain("# the plant");
    expect(String(c.data.markdown)).toContain("roots absorb water");
    expect(c.status).toBe("repaired");
  });

  it("formula: keeps latex when present; empty → minimal latex, type stays formula", () => {
    expect(coerceSlot("formula", { latex: "a^2+b^2=c^2" }, "", "pythagoras").data.latex).toBe("a^2+b^2=c^2");
    const c = coerceSlot("formula", {}, "", "pythagoras");
    expect(c.type).toBe("formula");
    expect(c.status).toBe("minimal");
    expect(String(c.data.latex).length).toBeGreaterThan(0);
  });

  it("empty visual → a minimal VISUAL, never a paragraph", () => {
    for (const t of ["timeline", "table", "chart", "graph", "geometry", "basic-diagram", "mindmap", "formula"]) {
      const c = coerceSlot(t, {}, "", "the topic");
      expect(c.status).toBe("minimal");
      expect(c.type).not.toBe("paragraph"); // the whole point
      expect(Object.keys(c.data).length).toBeGreaterThan(0);
    }
  });

  it("empty TEXT slot may fall back to prose (from intent)", () => {
    const c = coerceSlot("paragraph", {}, "", "why it matters");
    expect(c.type).toBe("paragraph");
    expect(c.data.text).toBe("why it matters");
  });
});

describe("skeleton-first — instant lesson shell + patch-index mapping", () => {
  const VIS = new Set(["chart", "basic-diagram", "flow", "mermaid", "graph", "geometry", "timeline", "mindmap", "table", "formula", "map", "molecule"]);

  it("buildSkeleton emits exactly outline.length blocks; text types kept, visuals stay visual", () => {
    const outline = repairOutline(defaultOutline("the causes of world war one"), "the causes of world war one").outline;
    const sk = buildSkeleton(outline, "the causes of world war one");
    expect(sk.length).toBe(outline.length);
    outline.forEach((s, i) => {
      if (isText(s.type)) {
        expect(sk[i].type).toBe(s.type);
      } else {
        expect(sk[i].type === s.type || VIS.has(sk[i].type)).toBe(true); // visual, possibly downgraded
        expect(sk[i].type).not.toBe("paragraph"); // a visual slot never becomes prose
      }
    });
  });

  it("every skeleton block is a valid minimal payload — NO empty-data visuals", () => {
    const outline = repairOutline(defaultOutline("photosynthesis"), "photosynthesis").outline;
    for (const b of buildSkeleton(outline, "photosynthesis")) {
      if (b.type === "heading") expect(String(b.data.text)).toBe("photosynthesis");
      else if (isText(b.type)) expect("text" in b.data).toBe(true); // text may be blank
      else expect(Object.keys(b.data).length).toBeGreaterThan(0); // a visual is NEVER empty-data
    }
  });

  it("skeletonData: visual shells are non-empty, text shells blank, heading = topic", () => {
    expect(skeletonData("heading", "x", "Algebra").text).toBe("Algebra");
    expect(skeletonData("paragraph", "why it matters", "Algebra").text).toBe("");
    expect(Object.keys(skeletonData("timeline", "the war", "History")).length).toBeGreaterThan(0);
    expect(Object.keys(skeletonData("table", "compare", "History")).length).toBeGreaterThan(0);
  });

  it("patch index maps as slot-1: slots are contiguous 1..N, one block each", () => {
    const outline = repairOutline(defaultOutline("acids and bases"), "acids and bases").outline;
    const sk = buildSkeleton(outline, "acids and bases");
    expect(sk.length).toBe(outline.length);
    outline.forEach((s, i) => {
      expect(s.slot).toBe(i + 1); // so patch{index:i} lands on slot i+1
      expect(sk[i]).toBeDefined();
    });
  });

  it("property: 50 default outlines → blocks===slots, ≥3 visuals, no empty-data visual", () => {
    const topics = ["the water cycle", "quadratic equations", "the human heart", "the 1857 revolt", "acids and bases"];
    for (let n = 0; n < 50; n++) {
      const topic = topics[n % topics.length] + " " + n;
      const outline = repairOutline(defaultOutline(topic), topic).outline;
      const sk = buildSkeleton(outline, topic);
      expect(sk.length).toBe(outline.length);
      expect(sk.filter((b) => VIS.has(b.type)).length).toBeGreaterThanOrEqual(3);
      for (const b of sk) {
        if (!isText(b.type)) expect(Object.keys(b.data).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("adaptBlock — a visual slot never collapses to a paragraph", () => {
  it("empty/invalid visual data → a visual block (mindmap), never paragraph", () => {
    for (const t of ["chart", "table", "timeline", "mermaid", "molecule", "basic-diagram", "formula"]) {
      const r = adaptBlock(t, {}, "some intent text");
      expect(r.type).not.toBe("paragraph");
    }
  });
});

describe("block registry mirror", () => {
  it("covers the full block catalog with unique, non-empty type names", () => {
    expect(BLOCK_TYPES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(BLOCK_TYPES).size).toBe(BLOCK_TYPES.length); // no dupes
    for (const t of BLOCK_TYPES) {
      expect(typeof t).toBe("string");
      expect(t.length).toBeGreaterThan(0);
      expect(BLOCK_TYPE_SET.has(t)).toBe(true);
    }
  });
});

describe("provider chain (D2)", () => {
  it("returns an ordered array (empty when no keys configured)", () => {
    expect(Array.isArray(providerChain())).toBe(true);
  });

  it("treats 429/500/rate-limit as fall-through, real errors as fatal", () => {
    expect(isFallthroughError({ statusCode: 429 })).toBe(true);
    expect(isFallthroughError({ statusCode: 503 })).toBe(true);
    expect(isFallthroughError(new Error("rate limit exceeded"))).toBe(true);
    expect(isFallthroughError(new Error("model is overloaded"))).toBe(true);
    expect(isFallthroughError(new Error("invalid api key"))).toBe(false);
    expect(isFallthroughError({ statusCode: 400 })).toBe(false);
  });
});
