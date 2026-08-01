import { describe, it, expect, vi } from "vitest";
import { buildBatchTool, BATCH_FIELD_DESCRIPTIONS, type BatchTool } from "@/server/advisors/tools";

/**
 * buildBatchTool — the Groq/tool-calling batch-fill advisor boundary.
 *
 * This module has NO I/O edge (it imports only `ai` + `zod`), so nothing is
 * mocked: every assertion below drives the module's OWN real logic — the
 * slot-number parse (number vs parseInt-of-string vs nullish), the two reject
 * branches (unknown slot, already-filled), the `?? {}` / `typeof text` payload
 * normalisation, the per-slot dedup counter, and the real zod boundary schema.
 * Each path asserts the EXACT returned value / onFill arguments, never merely
 * "it ran". `ai`'s `tool()` is a pure identity type-helper (verified: it stores
 * `execute` verbatim), so we invoke the real executor directly.
 */

type FillResult = { ok: true; filled: number } | { ok: false; error: string };
type ExecFn = (input: Record<string, unknown>) => Promise<FillResult>;

/** Reach the single real executor the advisor exposes under `emit_block`. */
function execOf(bt: BatchTool): ExecFn {
  return (bt.tools.emit_block as unknown as { execute: ExecFn }).execute;
}
function schemaOf(bt: BatchTool) {
  return (bt.tools.emit_block as unknown as {
    inputSchema: { parse: (v: unknown) => unknown; safeParse: (v: unknown) => { success: boolean } };
  }).inputSchema;
}

/** onFill spy that records the RAW (slot, data, text) triples it receives. */
function recorder() {
  const calls: Array<{ slot: number; data: Record<string, unknown>; text: string }> = [];
  const onFill = vi.fn((slot: number, data: Record<string, unknown>, text: string) => {
    calls.push({ slot, data, text });
  });
  return { calls, onFill };
}

const PLAN = [{ slot: 1 }, { slot: 2 }, { slot: 3 }];

describe("buildBatchTool — tool wiring / structure", () => {
  it("exposes exactly one tool named `emit_block` with description, schema and executor", () => {
    const { onFill } = recorder();
    const bt = buildBatchTool(PLAN, onFill);

    expect(Object.keys(bt.tools)).toEqual(["emit_block"]);
    const t = bt.tools.emit_block as unknown as { description: string; inputSchema: unknown; execute: unknown };
    expect(t.description).toBe(
      "Fill the lesson's blocks. Call this tool ONCE PER SLOT listed in the plan, " +
        "passing that slot's number and its content. Stop when every slot is filled.",
    );
    expect(typeof t.execute).toBe("function");
    expect(t.inputSchema).toBeDefined();
  });

  it("field descriptions are the exact mandatory weak-model hints (never silently drop them)", () => {
    // Per the module comment these are MANDATORY (Ollama qwen2.5:7b refuses a
    // schema whose fields it can't see). Guard the exact strings.
    expect(BATCH_FIELD_DESCRIPTIONS).toEqual({
      slot: "The slot number from the lesson plan you are filling.",
      data: "The block content. Shape depends on this slot's type — see the plan.",
      text: "For text blocks (heading, paragraph, callout, summary): the prose.",
    });
  });
});

describe("inputSchema — permissive boundary (captures whatever the model sends)", () => {
  it("parses & PASSES THROUGH unknown top-level keys and nested data keys", () => {
    const { onFill } = recorder();
    const schema = schemaOf(buildBatchTool(PLAN, onFill));
    expect(schema.parse({ slot: 2, data: { x: 1 }, extra: "keep" })).toEqual({
      slot: 2,
      data: { x: 1 },
      extra: "keep",
    });
  });

  it("accepts a string slot, rejects a boolean slot, rejects a missing slot", () => {
    const { onFill } = recorder();
    const schema = schemaOf(buildBatchTool(PLAN, onFill));
    expect(schema.safeParse({ slot: "5" }).success).toBe(true);
    expect(schema.safeParse({ slot: true }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });
});

describe("execute — success path", () => {
  it("numeric slot fills once: onFill gets (n, data-by-reference, text); returns {ok, filled:1}", async () => {
    const { calls, onFill } = recorder();
    const data = { tone: "warm" };
    const res = await execOf(buildBatchTool(PLAN, onFill))({ slot: 1, data, text: "Hello" });

    expect(res).toEqual({ ok: true, filled: 1 });
    expect(onFill).toHaveBeenCalledTimes(1);
    expect(calls[0].slot).toBe(1);
    expect(calls[0].data).toBe(data); // forwarded RAW, not cloned
    expect(calls[0].text).toBe("Hello");
  });

  it("string-numeric slot is coerced to a NUMBER before onFill (\"2\" → 2)", async () => {
    const { calls, onFill } = recorder();
    const res = await execOf(buildBatchTool(PLAN, onFill))({ slot: "2" });
    expect(res).toEqual({ ok: true, filled: 1 });
    expect(calls[0].slot).toBe(2); // strict: number 2, not string "2"
  });

  it("parseInt leniency: a trailing-garbage string like \"3xyz\" still resolves to slot 3", async () => {
    const { calls, onFill } = recorder();
    const res = await execOf(buildBatchTool(PLAN, onFill))({ slot: "3xyz" });
    expect(res).toEqual({ ok: true, filled: 1 });
    expect(calls[0].slot).toBe(3);
  });

  it("slot 0 is a REAL slot, not treated as falsy-missing", async () => {
    const { calls, onFill } = recorder();
    const res = await execOf(buildBatchTool([{ slot: 0 }], onFill))({ slot: 0 });
    expect(res).toEqual({ ok: true, filled: 1 });
    expect(calls[0].slot).toBe(0);
  });

  it("omitted data → onFill receives a fresh {} ; omitted text → onFill receives \"\"", async () => {
    const { calls, onFill } = recorder();
    const res = await execOf(buildBatchTool(PLAN, onFill))({ slot: 1 });
    expect(res).toEqual({ ok: true, filled: 1 });
    expect(calls[0].data).toEqual({});
    expect(calls[0].text).toBe("");
  });

  it("non-string text (raw payload) is normalised to \"\"", async () => {
    const { calls, onFill } = recorder();
    // The executor is permissive at runtime; a non-string text collapses to "".
    await execOf(buildBatchTool(PLAN, onFill))({ slot: 1, text: 42 as unknown as string });
    expect(calls[0].text).toBe("");
  });

  it("distinct slots each increment the filled counter (filled.size)", async () => {
    const { onFill } = recorder();
    const exec = execOf(buildBatchTool(PLAN, onFill));
    expect(await exec({ slot: 1 })).toEqual({ ok: true, filled: 1 });
    expect(await exec({ slot: 3 })).toEqual({ ok: true, filled: 2 });
    expect(await exec({ slot: 2 })).toEqual({ ok: true, filled: 3 });
    expect(onFill).toHaveBeenCalledTimes(3);
  });

  it("AWAITS an async onFill — execute stays pending until onFill resolves", async () => {
    let releaseFill!: () => void;
    const gate = new Promise<void>((r) => { releaseFill = r; });
    let fillDone = false;
    const onFill = vi.fn(async () => { await gate; fillDone = true; });

    const exec = execOf(buildBatchTool(PLAN, onFill));
    let settled = false;
    const p = exec({ slot: 1 }).then((r) => { settled = true; return r; });

    await Promise.resolve(); // flush microtasks the executor could resolve on
    expect(onFill).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false); // proves `await onFill(...)` — not fire-and-forget

    releaseFill();
    const res = await p;
    expect(settled).toBe(true);
    expect(fillDone).toBe(true);
    expect(res).toEqual({ ok: true, filled: 1 });
  });
});

describe("execute — rejection branches (raw proposals still get slot-validated)", () => {
  it("non-numeric string → NaN → unknown-slot; onFill NOT called; counter untouched", async () => {
    const { onFill } = recorder();
    const exec = execOf(buildBatchTool(PLAN, onFill));

    const res = await exec({ slot: "abc" });
    expect(res).toEqual({ ok: false, error: "Unknown slot. Fill one of: 1, 2, 3." });
    expect(onFill).not.toHaveBeenCalled();

    // rejected call must not have consumed a slot: a real fill still reports filled:1
    expect(await exec({ slot: 1 })).toEqual({ ok: true, filled: 1 });
  });

  it("nullish slot (null / undefined) → unknown-slot (the `?? \"\"` fallback path)", async () => {
    const { onFill } = recorder();
    const exec = execOf(buildBatchTool(PLAN, onFill));
    expect(await exec({ slot: null as unknown as number })).toEqual({
      ok: false,
      error: "Unknown slot. Fill one of: 1, 2, 3.",
    });
    expect(await exec({})).toEqual({ ok: false, error: "Unknown slot. Fill one of: 1, 2, 3." });
    expect(onFill).not.toHaveBeenCalled();
  });

  it("finite number NOT in the plan → unknown-slot (isFinite true, valid.has false)", async () => {
    const { onFill } = recorder();
    const exec = execOf(buildBatchTool(PLAN, onFill));
    expect(await exec({ slot: 99 })).toEqual({ ok: false, error: "Unknown slot. Fill one of: 1, 2, 3." });
    // a non-integer that isn't an exact plan member is also rejected
    expect(await exec({ slot: 1.5 })).toEqual({ ok: false, error: "Unknown slot. Fill one of: 1, 2, 3." });
    expect(onFill).not.toHaveBeenCalled();
  });

  it("repeat slot → already-filled error; onFill fires only once", async () => {
    const { onFill } = recorder();
    const exec = execOf(buildBatchTool(PLAN, onFill));

    expect(await exec({ slot: 1 })).toEqual({ ok: true, filled: 1 });
    expect(await exec({ slot: 1 })).toEqual({ ok: false, error: "Slot 1 already filled. Move to another slot." });
    // string form of the same slot also dedups (both resolve to number 1)
    expect(await exec({ slot: "1" })).toEqual({ ok: false, error: "Slot 1 already filled. Move to another slot." });
    expect(onFill).toHaveBeenCalledTimes(1);
  });

  it("empty plan → every slot is unknown, with an empty allowed-list", async () => {
    const { onFill } = recorder();
    const res = await execOf(buildBatchTool([], onFill))({ slot: 1 });
    expect(res).toEqual({ ok: false, error: "Unknown slot. Fill one of: ." });
    expect(onFill).not.toHaveBeenCalled();
  });
});
