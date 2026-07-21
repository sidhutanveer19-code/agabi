import { describe, it, expect } from "vitest";
import { buildTools } from "@/server/ai/blockTools";
import { BLOCK_TYPES, BLOCK_TYPE_SET } from "@/server/ai/blockTypes";
import { providerChain, isFallthroughError } from "@/server/ai/providers";
import { repairOutline, defaultOutline, pickVisualFor, isText, countVisuals, type OutlineSlot } from "@/server/ai/outline";
import { buildSlotTool } from "@/server/ai/slotTools";
import { buildBatchTool, BATCH_FIELD_DESCRIPTIONS } from "@/server/ai/blockTools";
import { coerceSlot } from "@/server/ai/coerce";
import { OrderedFiller } from "@/server/ai/fill";
import { adaptBlock } from "@/server/ai/validateBlock";

type ExecTool = { execute: (input: unknown, options: unknown) => Promise<{ ok: boolean; error?: string }> };
const execOf = (t: { tools: Record<string, unknown> }) => Object.values(t.tools)[0] as unknown as ExecTool;

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

describe("empty-payload refusal — an empty fill must NOT count as authored", () => {
  it("buildSlotTool: {} / whitespace / {markdown:''} are refused, nothing emits", async () => {
    for (const bad of [{}, { text: "   " }, { markdown: "" }]) {
      let blocks = 0;
      const slot = buildSlotTool("mindmap", async () => { blocks++; });
      const r = await execOf(slot).execute(bad, {});
      expect(r.ok).toBe(false);
      expect(slot.didEmit()).toBe(false);
      expect(blocks).toBe(0);
    }
  });

  it("buildSlotTool: a MEANINGFUL payload emits once; a second call is refused", async () => {
    let blocks = 0;
    const slot = buildSlotTool("mindmap", async () => { blocks++; });
    const first = await execOf(slot).execute({ markdown: "# Topic" }, {});
    const second = await execOf(slot).execute({ markdown: "# Again" }, {});
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(blocks).toBe(1);
  });

  it("buildBatchTool: every field carries a non-empty description (mandatory for weak models)", () => {
    for (const key of ["slot", "data", "text"] as const) {
      expect(BATCH_FIELD_DESCRIPTIONS[key].length).toBeGreaterThan(10);
    }
  });

  it("buildBatchTool: empty payload records NOTHING; meaningful records; repeat refused", async () => {
    const recorded: number[] = [];
    const batch = buildBatchTool(slots(["heading", "mindmap", "table"]).map((s) => ({ slot: s.slot, type: s.type })), async (n) => { recorded.push(n); });
    const ex = execOf(batch);
    expect((await ex.execute({ slot: 1, data: {} }, {})).ok).toBe(false);
    expect((await ex.execute({ slot: 1, text: "   " }, {})).ok).toBe(false);
    expect((await ex.execute({ slot: 1, data: { markdown: "" } }, {})).ok).toBe(false);
    expect(recorded).toEqual([]); // nothing recorded on empties
    expect((await ex.execute({ slot: 1, text: "Photosynthesis" }, {})).ok).toBe(true);
    expect((await ex.execute({ slot: 1, text: "again" }, {})).ok).toBe(false); // repeat slot
    expect(recorded).toEqual([1]);
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

  it("empty visual → a minimal VISUAL, never a paragraph", () => {
    for (const t of ["timeline", "table", "chart", "graph", "geometry", "basic-diagram", "mindmap"]) {
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

describe("OrderedFiller — incremental in-order flush", () => {
  it("emits 1,2,3 even when slots resolve out of order (3, then 1, then 2)", async () => {
    const out: number[] = [];
    const f = new OrderedFiller((b) => { out.push(b.data.n as number); });
    await f.place(3, { type: "x", data: { n: 3 } });
    expect(out).toEqual([]); // held — slot 1 not ready
    await f.place(1, { type: "x", data: { n: 1 } });
    expect(out).toEqual([1]); // slot 1 flushes; 2 still missing holds 3
    await f.place(2, { type: "x", data: { n: 2 } });
    expect(out).toEqual([1, 2, 3]);
  });

  it("head-of-line force: slot 1 forced → 2 and 3 flush right behind it, order 1,2,3", async () => {
    const out: number[] = [];
    const f = new OrderedFiller((b) => { out.push(b.data.n as number); });
    await f.place(2, { type: "x", data: { n: 2 } });
    await f.place(3, { type: "x", data: { n: 3 } });
    expect(out).toEqual([]); // both held behind the missing head
    await f.place(1, { type: "mindmap", data: { n: 1 } }); // the forced RUNG-5 fill
    expect(out).toEqual([1, 2, 3]);
    expect(f.emitted).toBe(3);
  });

  it("placing the same slot twice is ignored (first content wins)", async () => {
    const out: string[] = [];
    const f = new OrderedFiller((b) => { out.push(b.type); });
    await f.place(1, { type: "first", data: {} });
    await f.place(1, { type: "second", data: {} });
    expect(out).toEqual(["first"]);
  });
});

describe("adaptBlock — a visual slot never collapses to a paragraph", () => {
  it("empty/invalid visual data → a visual block (mindmap), never paragraph", () => {
    for (const t of ["chart", "table", "timeline", "mermaid", "molecule", "basic-diagram"]) {
      const r = adaptBlock(t, {}, "some intent text");
      expect(r.type).not.toBe("paragraph");
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
