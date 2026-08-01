import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { accept } from "@/server/advisors/advice";
import type { ProviderEntry } from "@/server/advisors/providers";
import type { ChunkSink } from "@/server/advisors/sink";
import type { ChunkSlot, ChunkPrompts } from "@/server/advisors/chunk";

/**
 * fillChunk — the chunk advisor (the ONLY place teaching content is model-generated).
 *
 * The ONLY things stubbed are the real I/O edges: `streamText` (the AI SDK batch
 * model call) and `ollamaStream` / `ollamaJSON` (native `fetch`), plus `Date.now`
 * (the per-chunk budget clock). Everything else runs FOR REAL — the real
 * `buildBatchTool` boundary (its `tool()` executor is driven directly by the fake
 * streamText, exactly as the SDK would), the real `advise()` wrapper, the real
 * `nonEmpty` emptiness rule, dedup, provider-ladder routing, and the exported
 * `RawSlot` zod schemas via the real `accept()`.
 *
 * Every assertion names the EXACT collected `RawSlot[]`, sink calls, provider/model/
 * token/ms/later/retry telemetry, and I/O arguments — never "it ran".
 *
 * Branch inventory exercised: tool path (text-fill / data-fill / empty-skip /
 * whitespace-trim), tool-stream throw → fall-through vs abort → break, ollama JSON
 * (parsed vs raw-fallback vs empty-then-retry), ollama text (streamed vs empty-then-
 * retry), attempt-throw caught, retry gated by abort and by budget, per-slot budget
 * break (inner + outer loop), pre-aborted signal, duplicate-index continue, missing-
 * prompt continue, dead provider (neither tools nor ollama) skipped, remaining==0
 * break, empty slots, empty chain, and `later` first-vs-mop-up.
 */

// Mutable per-test behaviour, hoisted above the vi.mock factories.
const h = vi.hoisted(() => ({
  streamText: ((_a: Record<string, unknown>) => ({ consumeStream: async () => {} })) as (
    a: Record<string, unknown>,
  ) => { consumeStream: () => Promise<void> },
  ollamaStream: (async () => ({ text: "", tokens: 0, ms: 0 })) as (
    ...a: unknown[]
  ) => Promise<{ text: string; tokens: number; ms: number }>,
  ollamaJSON: (async () => ({ data: {}, raw: "", parsed: false, tokens: 0, ms: 0 })) as (
    ...a: unknown[]
  ) => Promise<{ data: Record<string, unknown>; raw: string; parsed: boolean; tokens: number; ms: number }>,
}));

// Keep the REAL `tool` + `stepCountIs` (buildBatchTool depends on them); fake ONLY the network call.
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText: vi.fn((a: Record<string, unknown>) => h.streamText(a)) };
});
vi.mock("@/server/advisors/jsonFill", () => ({
  ollamaJSON: vi.fn((...a: unknown[]) => h.ollamaJSON(...a)),
  ollamaStream: vi.fn((...a: unknown[]) => h.ollamaStream(...a)),
}));

const { fillChunk, RawSlotSchema, RawSlotArraySchema } = await import("@/server/advisors/chunk");
const { streamText } = await import("ai");
const { ollamaJSON, ollamaStream } = await import("@/server/advisors/jsonFill");
const streamTextMock = streamText as unknown as ReturnType<typeof vi.fn>;
const ollamaJSONMock = ollamaJSON as unknown as ReturnType<typeof vi.fn>;
const ollamaStreamMock = ollamaStream as unknown as ReturnType<typeof vi.fn>;

// ---------- fakes / builders ----------

type ToolExec = (input: Record<string, unknown>) => Promise<unknown>;
/** Reach the single real `emit_block` executor the advisor handed to streamText. */
function toolExec(a: Record<string, unknown>): ToolExec {
  return (a.tools as { emit_block: { execute: ToolExec } }).emit_block.execute;
}

function toolProvider(name = "groq:llama-3.3-70b"): ProviderEntry {
  return { name, model: { __fake: name } as unknown as ProviderEntry["model"], caps: { supportsTools: true, supportsJSON: true } };
}
function ollamaProvider(name = "ollama:qwen2.5:3b", modelId = "qwen2.5:3b"): ProviderEntry {
  return {
    name,
    model: { __fake: name } as unknown as ProviderEntry["model"],
    caps: { supportsTools: false, supportsJSON: true },
    ollama: { nativeBase: "http://localhost:11434", modelId },
  };
}
/** Neither tool-capable nor ollama-backed → both branches are skipped. */
function deadProvider(name = "dead:noop"): ProviderEntry {
  return { name, model: { __fake: name } as unknown as ProviderEntry["model"], caps: { supportsTools: false, supportsJSON: false } };
}

function slotPrompt() {
  return { jsonSystem: "js", jsonUser: "ju", textSystem: "ts", textUser: "tu" };
}
function prompts(perSlot: ChunkPrompts["perSlot"] = {}): ChunkPrompts {
  return { batchSystem: "SYS", batchUser: "USER", perSlot };
}

function makeSink() {
  const texts: Array<{ index: number; full: string }> = [];
  const slots: Array<{ index: number; payload: unknown }> = [];
  const errors: Array<{ provider: string; error: unknown }> = [];
  const sink: ChunkSink = {
    onText: (index, full) => texts.push({ index, full }),
    onSlot: (index, payload) => slots.push({ index, payload }),
    onError: (provider, error) => errors.push({ provider, error }),
  };
  return { sink, texts, slots, errors };
}

// ---------- clock control (per-chunk budget) ----------

let nowMs = 0;
let nowSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  nowMs = 0;
  nowSpy = vi.spyOn(Date, "now").mockImplementation(() => nowMs);
  h.streamText = () => ({ consumeStream: async () => {} });
  h.ollamaStream = async () => ({ text: "", tokens: 0, ms: 0 });
  h.ollamaJSON = async () => ({ data: {}, raw: "", parsed: false, tokens: 0, ms: 0 });
});
afterEach(() => nowSpy.mockRestore());

const fresh = () => new AbortController().signal;

// =====================================================================================
describe("fillChunk — TOOL path (batch streamText → emit_block executor)", () => {
  it("routes text→onText, data→onSlot, skips empty & whitespace-only; records EXACT telemetry", async () => {
    const p = toolProvider();
    const { sink, texts, slots } = makeSink();
    // The fake stream replays 4 model tool-calls through the REAL executor.
    h.streamText = (a) => ({
      consumeStream: async () => {
        const exec = toolExec(a);
        await exec({ slot: 0, text: "Hello world" }); // text slot
        await exec({ slot: 1, data: { rows: [[1, 2]] } }); // data slot
        await exec({ slot: 2, data: {} }); // empty → nonEmpty false → skipped
        await exec({ slot: 3, text: "   ", data: {} }); // whitespace text → trim length 0 → skipped
      },
    });

    const chunkSlots: ChunkSlot[] = [
      { index: 0, type: "paragraph", isText: true },
      { index: 1, type: "table", isText: false },
      { index: 2, type: "image", isText: false },
      { index: 3, type: "callout", isText: true },
    ];
    const res = await fillChunk(chunkSlots, [p], prompts(), sink, fresh());

    // raw advice wrapper is the REAL advise() shape
    expect(res.__brand).toBe("advice");
    const collected = accept(res, RawSlotArraySchema);
    expect(collected).toEqual([
      { index: 0, text: "Hello world", provider: "groq:llama-3.3-70b", model: "groq:llama-3.3-70b", tokens: 0, ms: 0, later: false, retry: false },
      { index: 1, data: { rows: [[1, 2]] }, provider: "groq:llama-3.3-70b", model: "groq:llama-3.3-70b", tokens: 0, ms: 0, later: false, retry: false },
    ]);
    // streamed exactly once each, only for the accepted slots
    expect(texts).toEqual([{ index: 0, full: "Hello world" }]);
    expect(slots).toEqual([{ index: 1, payload: { rows: [[1, 2]] } }]);
  });

  it("forwards the EXACT streamText call shape (model/system/prompt/toolChoice/temperature/maxRetries/abortSignal/tools)", async () => {
    const p = toolProvider("groq:X");
    h.streamText = (a) => ({ consumeStream: async () => { await toolExec(a)({ slot: 0, text: "hi" }); } });

    await fillChunk([{ index: 0, type: "paragraph", isText: true }], [p], prompts(), makeSink().sink, fresh());

    expect(streamTextMock).toHaveBeenCalledTimes(1);
    const arg = streamTextMock.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.model).toBe(p.model);
    expect(arg.system).toBe("SYS");
    expect(arg.prompt).toBe("USER");
    expect(arg.toolChoice).toBe("required");
    expect(arg.temperature).toBe(0.7);
    expect(arg.maxRetries).toBe(1);
    expect(arg.abortSignal).toBeInstanceOf(AbortSignal);
    expect(arg.stopWhen).toBeDefined();
    expect(Object.keys(arg.tools as object)).toEqual(["emit_block"]);
  });

  it("stream throw (not aborted) is caught → reported LOUD via sink.onError, then falls through to the next provider (later:true)", async () => {
    const { sink, errors } = makeSink();
    h.streamText = () => ({ consumeStream: async () => { throw new Error("stream 500"); } });
    h.ollamaJSON = async () => ({ data: { k: "v" }, raw: "", parsed: true, tokens: 5, ms: 9 });

    const res = await fillChunk(
      [{ index: 0, type: "table", isText: false }],
      [toolProvider(), ollamaProvider()],
      prompts({ 0: slotPrompt() }),
      sink,
      fresh(),
    );

    expect(streamTextMock).toHaveBeenCalledTimes(1);
    expect(ollamaJSONMock).toHaveBeenCalledTimes(1);
    // Law 11 — the tool-call failure is NEVER swallowed: it is surfaced to production with the real error.
    expect(errors).toEqual([{ provider: "groq:llama-3.3-70b", error: new Error("stream 500") }]);
    expect(accept(res, RawSlotArraySchema)).toEqual([
      { index: 0, data: { k: "v" }, provider: "ollama:qwen2.5:3b", model: "qwen2.5:3b", tokens: 5, ms: 9, later: true, retry: false },
    ]);
  });

  it("stream throw WHILE aborted → breaks the ladder; the next provider is never tried", async () => {
    const ctrl = new AbortController();
    h.streamText = () => ({ consumeStream: async () => { ctrl.abort(); throw new Error("aborted mid-stream"); } });

    const res = await fillChunk(
      [{ index: 0, type: "table", isText: false }],
      [toolProvider(), ollamaProvider()],
      prompts({ 0: slotPrompt() }),
      makeSink().sink,
      ctrl.signal,
    );

    expect(streamTextMock).toHaveBeenCalledTimes(1);
    expect(ollamaJSONMock).not.toHaveBeenCalled();
    expect(accept(res, RawSlotArraySchema)).toEqual([]);
  });
});

// =====================================================================================
describe("fillChunk — OLLAMA JSON path (visual slots)", () => {
  it("parsed JSON → onSlot + records provider/model/tokens/ms and passes native args", async () => {
    const { sink, slots } = makeSink();
    h.ollamaJSON = async () => ({ data: { cells: [[1]] }, raw: '{"cells":[[1]]}', parsed: true, tokens: 42, ms: 7 });

    const res = await fillChunk(
      [{ index: 0, type: "table", isText: false }],
      [ollamaProvider("ollama:qwen2.5:7b", "qwen2.5:7b")],
      prompts({ 0: slotPrompt() }),
      sink,
      fresh(),
    );

    expect(accept(res, RawSlotArraySchema)).toEqual([
      { index: 0, data: { cells: [[1]] }, provider: "ollama:qwen2.5:7b", model: "qwen2.5:7b", tokens: 42, ms: 7, later: false, retry: false },
    ]);
    expect(slots).toEqual([{ index: 0, payload: { cells: [[1]] } }]);

    const [base, modelId, sys, user, signal] = ollamaJSONMock.mock.calls[0];
    expect(base).toBe("http://localhost:11434");
    expect(modelId).toBe("qwen2.5:7b");
    expect(sys).toBe("js");
    expect(user).toBe("ju");
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("UNPARSED JSON → raw text handed on as {text: raw} (RUNG-4) and still recorded", async () => {
    const { sink, slots } = makeSink();
    h.ollamaJSON = async () => ({ data: {}, raw: "not json but prose", parsed: false, tokens: 3, ms: 1 });

    const res = await fillChunk(
      [{ index: 0, type: "table", isText: false }],
      [ollamaProvider()],
      prompts({ 0: slotPrompt() }),
      sink,
      fresh(),
    );

    expect(accept(res, RawSlotArraySchema)).toEqual([
      { index: 0, data: { text: "not json but prose" }, provider: "ollama:qwen2.5:3b", model: "qwen2.5:3b", tokens: 3, ms: 1, later: false, retry: false },
    ]);
    expect(slots).toEqual([{ index: 0, payload: { text: "not json but prose" } }]);
  });

  it("empty parsed object → first attempt rejected, SAME-provider retry succeeds (retry:true)", async () => {
    let n = 0;
    h.ollamaJSON = async () => {
      n += 1;
      return n === 1
        ? { data: {}, raw: "", parsed: true, tokens: 0, ms: 0 } // {} → nonEmpty false
        : { data: { v: 1 }, raw: "", parsed: true, tokens: 8, ms: 4 };
    };

    const res = await fillChunk(
      [{ index: 0, type: "table", isText: false }],
      [ollamaProvider()],
      prompts({ 0: slotPrompt() }),
      makeSink().sink,
      fresh(),
    );

    expect(ollamaJSONMock).toHaveBeenCalledTimes(2);
    expect(accept(res, RawSlotArraySchema)).toEqual([
      { index: 0, data: { v: 1 }, provider: "ollama:qwen2.5:3b", model: "qwen2.5:3b", tokens: 8, ms: 4, later: false, retry: true },
    ]);
  });

  it("ollamaJSON THROWS → caught (attempt=false), retried, still empty → nothing collected", async () => {
    h.ollamaJSON = async () => { throw new Error("ECONNREFUSED"); };

    const res = await fillChunk(
      [{ index: 0, type: "table", isText: false }],
      [ollamaProvider()],
      prompts({ 0: slotPrompt() }),
      makeSink().sink,
      fresh(),
    );

    expect(ollamaJSONMock).toHaveBeenCalledTimes(2); // first + retry
    expect(accept(res, RawSlotArraySchema)).toEqual([]);
  });
});

// =====================================================================================
describe("fillChunk — OLLAMA TEXT path (prose slots)", () => {
  it("streamed prose → onText fires with each accumulated string; record uses stream tokens/ms", async () => {
    const { sink, texts } = makeSink();
    h.ollamaStream = async (...a: unknown[]) => {
      const onText = a[5] as (full: string) => void;
      onText("The");
      onText("The quadratic");
      return { text: "The quadratic", tokens: 12, ms: 3 };
    };

    const res = await fillChunk(
      [{ index: 0, type: "paragraph", isText: true }],
      [ollamaProvider()],
      prompts({ 0: slotPrompt() }),
      sink,
      fresh(),
    );

    expect(texts).toEqual([
      { index: 0, full: "The" },
      { index: 0, full: "The quadratic" },
    ]);
    expect(accept(res, RawSlotArraySchema)).toEqual([
      { index: 0, text: "The quadratic", provider: "ollama:qwen2.5:3b", model: "qwen2.5:3b", tokens: 12, ms: 3, later: false, retry: false },
    ]);

    const [base, modelId, sys, user, signal] = ollamaStreamMock.mock.calls[0];
    expect(base).toBe("http://localhost:11434");
    expect(modelId).toBe("qwen2.5:3b");
    expect(sys).toBe("ts");
    expect(user).toBe("tu");
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("whitespace-only prose → rejected, retried; second returns real prose (retry:true)", async () => {
    let n = 0;
    h.ollamaStream = async () => {
      n += 1;
      return n === 1 ? { text: "   \n  ", tokens: 0, ms: 0 } : { text: "real", tokens: 2, ms: 1 };
    };

    const res = await fillChunk(
      [{ index: 0, type: "paragraph", isText: true }],
      [ollamaProvider()],
      prompts({ 0: slotPrompt() }),
      makeSink().sink,
      fresh(),
    );

    expect(ollamaStreamMock).toHaveBeenCalledTimes(2);
    expect(accept(res, RawSlotArraySchema)).toEqual([
      { index: 0, text: "real", provider: "ollama:qwen2.5:3b", model: "qwen2.5:3b", tokens: 2, ms: 1, later: false, retry: true },
    ]);
  });
});

// =====================================================================================
describe("fillChunk — abort & per-chunk budget", () => {
  it("pre-aborted signal → outer loop breaks immediately, no I/O, empty advice", async () => {
    const res = await fillChunk(
      [{ index: 0, type: "table", isText: false }],
      [ollamaProvider()],
      prompts({ 0: slotPrompt() }),
      makeSink().sink,
      AbortSignal.abort(),
    );
    expect(ollamaJSONMock).not.toHaveBeenCalled();
    expect(streamTextMock).not.toHaveBeenCalled();
    expect(accept(res, RawSlotArraySchema)).toEqual([]);
  });

  it("abort DURING slot 0 → inner loop breaks on slot 1 (slot 1 never attempted)", async () => {
    const ctrl = new AbortController();
    let n = 0;
    h.ollamaJSON = async () => {
      n += 1;
      if (n === 1) ctrl.abort(); // abort after entering slot-0's attempt, which still succeeds
      return { data: { i: n }, raw: "", parsed: true, tokens: 0, ms: 0 };
    };

    const res = await fillChunk(
      [
        { index: 0, type: "table", isText: false },
        { index: 1, type: "table", isText: false },
      ],
      [ollamaProvider()],
      prompts({ 0: slotPrompt(), 1: slotPrompt() }),
      makeSink().sink,
      ctrl.signal,
    );

    expect(ollamaJSONMock).toHaveBeenCalledTimes(1); // slot 1 broke before any call
    expect(accept(res, RawSlotArraySchema)).toEqual([
      { index: 0, data: { i: 1 }, provider: "ollama:qwen2.5:3b", model: "qwen2.5:3b", tokens: 0, ms: 0, later: false, retry: false },
    ]);
  });

  it("budget exceeded during slot 0 → inner loop breaks (slot 1) AND outer loop breaks (provider 2)", async () => {
    h.ollamaJSON = async () => {
      nowMs = 91_000; // now - start (0) > 90_000 → budgetSpent()
      return { data: { ok: 1 }, raw: "", parsed: true, tokens: 0, ms: 0 };
    };

    const res = await fillChunk(
      [
        { index: 0, type: "table", isText: false },
        { index: 1, type: "table", isText: false },
      ],
      [ollamaProvider("ollama:a"), ollamaProvider("ollama:b")],
      prompts({ 0: slotPrompt(), 1: slotPrompt() }),
      makeSink().sink,
      fresh(),
    );

    expect(ollamaJSONMock).toHaveBeenCalledTimes(1); // only slot 0 of provider 1
    expect(accept(res, RawSlotArraySchema)).toEqual([
      { index: 0, data: { ok: 1 }, provider: "ollama:a", model: "qwen2.5:3b", tokens: 0, ms: 0, later: false, retry: false },
    ]);
  });

  it("budget exceeded during a FAILED first attempt → retry is suppressed", async () => {
    h.ollamaJSON = async () => {
      nowMs = 91_000;
      return { data: {}, raw: "", parsed: true, tokens: 0, ms: 0 }; // empty → attempt false
    };

    const res = await fillChunk(
      [{ index: 0, type: "table", isText: false }],
      [ollamaProvider()],
      prompts({ 0: slotPrompt() }),
      makeSink().sink,
      fresh(),
    );

    expect(ollamaJSONMock).toHaveBeenCalledTimes(1); // no retry: budget spent
    expect(accept(res, RawSlotArraySchema)).toEqual([]);
  });

  it("abort during a FAILED first attempt → retry is suppressed", async () => {
    const ctrl = new AbortController();
    h.ollamaJSON = async () => {
      ctrl.abort();
      return { data: {}, raw: "", parsed: true, tokens: 0, ms: 0 }; // empty → attempt false
    };

    const res = await fillChunk(
      [{ index: 0, type: "table", isText: false }],
      [ollamaProvider()],
      prompts({ 0: slotPrompt() }),
      makeSink().sink,
      ctrl.signal,
    );

    expect(ollamaJSONMock).toHaveBeenCalledTimes(1); // no retry: aborted
    expect(accept(res, RawSlotArraySchema)).toEqual([]);
  });
});

// =====================================================================================
describe("fillChunk — provider ladder routing & dedup", () => {
  it("dead provider (no tools, no ollama) is skipped; the next provider fills with later:true", async () => {
    h.ollamaJSON = async () => ({ data: { d: 1 }, raw: "", parsed: true, tokens: 0, ms: 0 });

    const res = await fillChunk(
      [{ index: 0, type: "table", isText: false }],
      [deadProvider(), ollamaProvider()],
      prompts({ 0: slotPrompt() }),
      makeSink().sink,
      fresh(),
    );

    expect(streamTextMock).not.toHaveBeenCalled();
    expect(ollamaJSONMock).toHaveBeenCalledTimes(1);
    expect(accept(res, RawSlotArraySchema)).toEqual([
      { index: 0, data: { d: 1 }, provider: "ollama:qwen2.5:3b", model: "qwen2.5:3b", tokens: 0, ms: 0, later: true, retry: false },
    ]);
  });

  it("all slots done after provider 1 → provider 2 breaks on remaining==0 (never called)", async () => {
    h.streamText = (a) => ({ consumeStream: async () => { await toolExec(a)({ slot: 0, text: "done" }); } });

    const res = await fillChunk(
      [{ index: 0, type: "paragraph", isText: true }],
      [toolProvider(), toolProvider("groq:second")],
      prompts(),
      makeSink().sink,
      fresh(),
    );

    expect(streamTextMock).toHaveBeenCalledTimes(1); // provider 2 never invoked
    expect(accept(res, RawSlotArraySchema)).toEqual([
      { index: 0, text: "done", provider: "groq:llama-3.3-70b", model: "groq:llama-3.3-70b", tokens: 0, ms: 0, later: false, retry: false },
    ]);
  });

  it("duplicate slot index → the second occurrence hits the done-guard `continue` (one fill only)", async () => {
    h.ollamaJSON = async () => ({ data: { once: true }, raw: "", parsed: true, tokens: 0, ms: 0 });

    const res = await fillChunk(
      [
        { index: 0, type: "table", isText: false },
        { index: 0, type: "table", isText: false },
      ],
      [ollamaProvider()],
      prompts({ 0: slotPrompt() }),
      makeSink().sink,
      fresh(),
    );

    expect(ollamaJSONMock).toHaveBeenCalledTimes(1);
    expect(accept(res, RawSlotArraySchema)).toEqual([
      { index: 0, data: { once: true }, provider: "ollama:qwen2.5:3b", model: "qwen2.5:3b", tokens: 0, ms: 0, later: false, retry: false },
    ]);
  });

  it("slot with no matching perSlot prompt → skipped (`if (!pr) continue`), no I/O", async () => {
    const res = await fillChunk(
      [{ index: 5, type: "table", isText: false }],
      [ollamaProvider()],
      prompts({}), // perSlot has no key 5
      makeSink().sink,
      fresh(),
    );
    expect(ollamaJSONMock).not.toHaveBeenCalled();
    expect(accept(res, RawSlotArraySchema)).toEqual([]);
  });

  it("empty slots array → immediate break (remaining==0), empty advice, no I/O", async () => {
    const res = await fillChunk([], [ollamaProvider()], prompts(), makeSink().sink, fresh());
    expect(ollamaJSONMock).not.toHaveBeenCalled();
    expect(accept(res, RawSlotArraySchema)).toEqual([]);
  });

  it("empty provider chain → loop body never runs, empty advice", async () => {
    const res = await fillChunk(
      [{ index: 0, type: "table", isText: false }],
      [],
      prompts({ 0: slotPrompt() }),
      makeSink().sink,
      fresh(),
    );
    expect(ollamaJSONMock).not.toHaveBeenCalled();
    expect(streamTextMock).not.toHaveBeenCalled();
    expect(accept(res, RawSlotArraySchema)).toEqual([]);
  });
});

// =====================================================================================
describe("RawSlot schemas — the exported trust-boundary contract", () => {
  it("RawSlotSchema accepts a well-formed slot and REJECTS a malformed index", () => {
    const good = { index: 0, provider: "p", model: "m", tokens: 1, ms: 2, later: false, retry: false };
    expect(RawSlotSchema.safeParse(good).success).toBe(true);
    expect(RawSlotSchema.safeParse({ ...good, index: "0" }).success).toBe(false);
    expect(RawSlotSchema.safeParse({ ...good, later: "no" }).success).toBe(false);
    expect(RawSlotArraySchema.safeParse([good, good]).success).toBe(true);
  });

  it("accept() returns null (not a throw) when the collected raw is not a RawSlot[]", async () => {
    // A garbage advice payload must be refused by the boundary, never coerced.
    const { advise } = await import("@/server/advisors/advice");
    expect(accept(advise([{ index: "bad" }]), RawSlotArraySchema)).toBeNull();
  });
});
