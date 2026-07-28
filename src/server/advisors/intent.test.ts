import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * classifyIntent — the untrusted intent advisor.
 *
 * The ONLY things stubbed are the real I/O edges: `providerChain` (constructs live
 * AI SDK / network handles), `generateText` (the AI SDK HTTP call), and `ollamaJSON`
 * (a native `fetch`). Everything asserted here is the module's OWN logic, exercised
 * for real: provider-path selection (`p.ollama` → native vs SDK), the `{…}` extraction
 * regex against prose-wrapped / newline / greedy-double-object output, `JSON.parse`,
 * the try/catch fall-through across the chain, the empty-chain skip, and the fact that
 * the returned `Advice` carries RAW UNVALIDATED output (never coerced to a decision).
 * `advise()` is the real function from advice.ts — the wrapper shape is asserted, not faked.
 *
 * Adversarial inputs: no-brace text, greedy two-object text (invalid JSON), a thrown
 * network call, a thrown parse followed by a good provider, an out-of-enum label,
 * empty user text, and an empty provider chain.
 */

// Mutable per-test behaviour, hoisted above the vi.mock factories.
const h = vi.hoisted(() => ({
  chain: [] as Array<Record<string, unknown>>,
  gen: (async () => ({ text: "" })) as (a: unknown) => Promise<{ text: string }>,
  oll: (async () => ({ raw: "" })) as (...a: unknown[]) => Promise<{ raw: string }>,
}));

vi.mock("@/server/advisors/providers", () => ({
  providerChain: vi.fn(() => h.chain),
}));
vi.mock("ai", () => ({
  generateText: vi.fn((a: unknown) => h.gen(a)),
}));
vi.mock("@/server/advisors/jsonFill", () => ({
  ollamaJSON: vi.fn((...a: unknown[]) => h.oll(...a)),
}));

const { classifyIntent } = await import("@/server/advisors/intent");
const { generateText } = await import("ai");
const { ollamaJSON } = await import("@/server/advisors/jsonFill");
const gen = generateText as unknown as ReturnType<typeof vi.fn>;
const oll = ollamaJSON as unknown as ReturnType<typeof vi.fn>;

// Fake provider entries. A tool provider has NO `ollama` field → the SDK (generateText)
// path; an ollama provider carries `{ nativeBase, modelId }` → the native ollamaJSON path.
function toolProvider(over: Record<string, unknown> = {}) {
  return {
    name: "google:gemini-2.0-flash",
    model: { __fake: "gemini-model", ...(over.model as object) },
    caps: { supportsTools: true, supportsJSON: true },
    ...over,
  };
}
function ollamaProvider(over: Record<string, unknown> = {}) {
  return {
    name: "ollama:qwen2.5:3b",
    model: { __fake: "ollama-model" },
    caps: { supportsTools: false, supportsJSON: true },
    ollama: { nativeBase: "http://localhost:11434", modelId: "qwen2.5:3b" },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.chain = [];
  h.gen = async () => ({ text: "" });
  h.oll = async () => ({ raw: "" });
});

describe("classifyIntent — SDK (non-ollama) provider path", () => {
  it("forwards model/system/prompt to generateText and returns the parsed label as raw advice", async () => {
    const prov = toolProvider();
    h.chain = [prov];
    h.gen = async () => ({ text: '{"intent":"greeting"}' });

    const res = await classifyIntent("hi");

    // real `advise()` shape — untrusted RAW parse, nothing else
    expect(res).toEqual({ __brand: "advice", raw: { intent: "greeting" } });

    expect(oll).not.toHaveBeenCalled();
    expect(gen).toHaveBeenCalledTimes(1);
    const arg = gen.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.model).toBe(prov.model); // exact model handle forwarded
    expect(arg.prompt).toBe("hi");
    expect(arg.maxRetries).toBe(0);
    expect(arg.abortSignal).toBeInstanceOf(AbortSignal);
    expect(typeof arg.system).toBe("string");
    // load-bearing routing rules must reach the model
    expect(arg.system).toContain("switch_topic");
    expect(arg.system).toContain("followup");
    expect(arg.system).toContain("Reply with ONLY JSON");
  });

  it("extracts JSON embedded in surrounding prose (regex, not a bare parse)", async () => {
    h.chain = [toolProvider()];
    h.gen = async () => ({ text: 'Sure thing! {"intent":"smalltalk"} hope that helped.' });
    expect(await classifyIntent("thanks")).toEqual({ __brand: "advice", raw: { intent: "smalltalk" } });
  });

  it("keeps the switch_topic target field through extraction", async () => {
    h.chain = [toolProvider()];
    h.gen = async () => ({ text: '{"intent":"switch_topic","target":"quadratics"}' });
    expect(await classifyIntent("go back to quadratics")).toEqual({
      __brand: "advice",
      raw: { intent: "switch_topic", target: "quadratics" },
    });
  });

  it("handles multi-line JSON ([\\s\\S] spans newlines)", async () => {
    h.chain = [toolProvider()];
    h.gen = async () => ({ text: '{\n  "intent": "followup"\n}' });
    expect(await classifyIntent("why is that true?")).toEqual({ __brand: "advice", raw: { intent: "followup" } });
  });
});

describe("classifyIntent — native ollama provider path", () => {
  it("routes through ollamaJSON with (nativeBase, modelId, system, text, AbortSignal) and reads r.raw", async () => {
    const prov = ollamaProvider();
    h.chain = [prov];
    h.oll = async () => ({ raw: '{"intent":"topic"}', data: {}, parsed: true, tokens: 0, ms: 0 });

    const res = await classifyIntent("teach me algebra");

    expect(res).toEqual({ __brand: "advice", raw: { intent: "topic" } });
    expect(gen).not.toHaveBeenCalled();
    expect(oll).toHaveBeenCalledTimes(1);
    const [base, modelId, system, user, signal] = oll.mock.calls[0];
    expect(base).toBe("http://localhost:11434");
    expect(modelId).toBe("qwen2.5:3b");
    expect(user).toBe("teach me algebra");
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(typeof system).toBe("string");
    expect(system).toContain("switch_topic");
  });

  it("both provider paths are handed the IDENTICAL system prompt", async () => {
    // ollama first returns no-brace text → falls through to the SDK provider.
    h.chain = [ollamaProvider(), toolProvider()];
    h.oll = async () => ({ raw: "no json here" });
    h.gen = async () => ({ text: '{"intent":"greeting"}' });

    await classifyIntent("hi");

    const ollamaSystem = oll.mock.calls[0][2];
    const sdkSystem = (gen.mock.calls[0][0] as { system: string }).system;
    expect(ollamaSystem).toBe(sdkSystem);
  });
});

describe("classifyIntent — untrusted output is NOT validated here", () => {
  it("an out-of-enum label is returned raw (coercion is a downstream accept() concern)", async () => {
    h.chain = [toolProvider()];
    h.gen = async () => ({ text: '{"intent":"banana","target":42}' });
    // classifyIntent must NOT coerce to unclear — it returns raw untrusted advice.
    expect(await classifyIntent("???")).toEqual({ __brand: "advice", raw: { intent: "banana", target: 42 } });
  });

  it("an empty object is returned as-is (boundary: valid JSON, no label)", async () => {
    h.chain = [toolProvider()];
    h.gen = async () => ({ text: "{}" });
    expect(await classifyIntent("x")).toEqual({ __brand: "advice", raw: {} });
  });

  it("empty user text is still forwarded to the provider (no input guard)", async () => {
    h.chain = [toolProvider()];
    h.gen = async () => ({ text: '{"intent":"unclear"}' });
    const res = await classifyIntent("");
    expect(res).toEqual({ __brand: "advice", raw: { intent: "unclear" } });
    expect((gen.mock.calls[0][0] as { prompt: string }).prompt).toBe("");
  });
});

describe("classifyIntent — fall-through across the provider chain", () => {
  it("no-brace output (regex miss) falls through to the next provider", async () => {
    // provider 1 = ollama, returns prose with no braces → m is null → continue.
    h.chain = [ollamaProvider(), toolProvider()];
    h.oll = async () => ({ raw: "I think this is a greeting" });
    h.gen = async () => ({ text: '{"intent":"greeting"}' });

    expect(await classifyIntent("hello there")).toEqual({ __brand: "advice", raw: { intent: "greeting" } });
    expect(oll).toHaveBeenCalledTimes(1);
    expect(gen).toHaveBeenCalledTimes(1);
  });

  it("a thrown provider call is caught and the next provider is tried", async () => {
    h.chain = [ollamaProvider(), toolProvider()];
    h.oll = async () => { throw new Error("ECONNREFUSED"); };
    h.gen = async () => ({ text: '{"intent":"clarification"}' });

    expect(await classifyIntent("i don't get it")).toEqual({ __brand: "advice", raw: { intent: "clarification" } });
    expect(oll).toHaveBeenCalledTimes(1);
    expect(gen).toHaveBeenCalledTimes(1);
  });

  it("a thrown JSON.parse (greedy two-object match) is caught, next provider recovers", async () => {
    let n = 0;
    h.chain = [toolProvider({ name: "p1" }), toolProvider({ name: "p2" })];
    h.gen = async () => {
      n += 1;
      // 1st call: greedy /\{[\s\S]*\}/ grabs the WHOLE span → invalid JSON → JSON.parse throws.
      return n === 1 ? { text: '{"intent":"greeting"} noise {"y":1}' } : { text: '{"intent":"topic"}' };
    };
    expect(await classifyIntent("photosynthesis")).toEqual({ __brand: "advice", raw: { intent: "topic" } });
    expect(gen).toHaveBeenCalledTimes(2);
  });
});

describe("classifyIntent — exhausted / empty chain → unclear fallback", () => {
  it("every provider misses → final advice is raw {intent:'unclear'}", async () => {
    h.chain = [toolProvider({ name: "p1" }), toolProvider({ name: "p2" })];
    h.gen = async () => ({ text: "no json at all" }); // both miss the regex
    expect(await classifyIntent("...")).toEqual({ __brand: "advice", raw: { intent: "unclear" } });
    expect(gen).toHaveBeenCalledTimes(2); // full chain walked
  });

  it("greedy-invalid-then-exhausted → unclear (catch reaches the final return)", async () => {
    h.chain = [toolProvider()];
    h.gen = async () => ({ text: '{"intent":"greeting"} x {"z":2}' }); // JSON.parse throws, no next provider
    expect(await classifyIntent("q")).toEqual({ __brand: "advice", raw: { intent: "unclear" } });
  });

  it("empty provider chain → loop body never runs, no I/O, unclear fallback", async () => {
    h.chain = [];
    expect(await classifyIntent("anything")).toEqual({ __brand: "advice", raw: { intent: "unclear" } });
    expect(gen).not.toHaveBeenCalled();
    expect(oll).not.toHaveBeenCalled();
  });
});
