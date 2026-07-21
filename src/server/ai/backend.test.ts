import { describe, it, expect } from "vitest";
import { buildTools } from "@/server/ai/blockTools";
import { BLOCK_TYPES, BLOCK_TYPE_SET } from "@/server/ai/blockTypes";
import { providerChain, isFallthroughError } from "@/server/ai/providers";
import { repairOutline, defaultOutline, pickVisualFor, isText, countVisuals, type OutlineSlot } from "@/server/ai/outline";
import { buildSlotTool } from "@/server/ai/slotTools";

type ExecTool = { execute: (input: unknown, options: unknown) => Promise<{ ok: boolean; error?: string }> };
const execOf = (slot: ReturnType<typeof buildSlotTool>) => Object.values(slot.tools)[0] as unknown as ExecTool;

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

describe("buildSlotTool — the never-a-hole guarantee (bug-4)", () => {
  it("a visual slot given {} STILL emits one block and records a note", async () => {
    let blocks = 0;
    let seenType = "";
    const slot = buildSlotTool("timeline", async (type) => { blocks++; seenType = type; });
    const r = await execOf(slot).execute({}, {}); // empty payload — would have failed a tight schema
    expect(r.ok).toBe(true);
    expect(slot.didEmit()).toBe(true);
    expect(blocks).toBe(1);
    expect(seenType).toBe("timeline");
    expect(slot.notes().length).toBe(1); // strict-inside recorded the shape mismatch
  });

  it("a second tool call is refused; exactly one block emits", async () => {
    let blocks = 0;
    const slot = buildSlotTool("mindmap", async () => { blocks++; });
    const first = await execOf(slot).execute({ markdown: "# Topic" }, {});
    const second = await execOf(slot).execute({ markdown: "# Again" }, {});
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(blocks).toBe(1);
  });

  it("no tool call → didEmit() false (the signal the route backfills on)", () => {
    const slot = buildSlotTool("chart", async () => {});
    expect(slot.didEmit()).toBe(false);
  });

  it("property: every slot yields exactly one block (model-emit OR backfill)", async () => {
    for (let n = 0; n < 50; n++) {
      const len = 5 + Math.floor(Math.random() * 5);
      const types = Array.from({ length: len }, () => (Math.random() < 0.5 ? "paragraph" : "timeline"));
      const outline = repairOutline(slots(types), "topic").outline;
      let blocks = 0;
      const onBlock = async () => { blocks++; };
      for (const s of outline) {
        const slot = buildSlotTool(s.type, onBlock);
        if (Math.random() < 0.5) await execOf(slot).execute({}, {}); // model emitted
        if (!slot.didEmit()) await onBlock(); // route backfill
      }
      expect(blocks).toBe(outline.length); // blocks === slots, ALWAYS
    }
  });
});

describe("blockTools / block registry mirror", () => {
  it("exposes emit_text and emit_visual tools", () => {
    const tools = buildTools(async () => {});
    expect(tools.emit_text).toBeDefined();
    expect(tools.emit_visual).toBeDefined();
  });

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
