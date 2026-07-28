import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * invoke.ts — the retrying JSON invoker for knowledge extraction.
 * The ONLY I/O edge (`ollamaJSON` from jsonFill, which does the fetch) is stubbed;
 * every other line asserted here is the module's OWN logic:
 *   - nativeOllamaBase: trailing-slash strip THEN /v1 strip, ?? default, empty-string edge
 *   - isTransient: Abort/Timeout short-circuit, message vs cause.code vs ?? cause fallback,
 *     Error vs non-Error stringification, regex hit/miss
 *   - ollamaInvoker: base normalization, EXTRACTION_SAMPLING passthrough, {raw,data}-only
 *     mapping (extra fields stripped), transient retry + backoff sequence, non-transient
 *     immediate throw, already-aborted signal short-circuit, retry exhaustion, optional
 *     onRetry chaining, timeoutMs ?? default flowing into AbortSignal.timeout.
 * Retry sleeps use real setTimeout(2s/8s/30s) → driven with fake timers, never real waits.
 */

type JsonResult = { raw: string; data: Record<string, unknown>; parsed: boolean; tokens: number; ms: number };
type RetryInfo = { attempt: number; delayMs: number; error: string };

// Mutable per-test behaviour for the stubbed I/O edge, hoisted above the vi.mock factory.
const h = vi.hoisted(() => ({
  json: (async () => ({ raw: "", data: {} as Record<string, unknown>, parsed: true, tokens: 0, ms: 0 })) as
    (base: string, modelId: string, system: string, user: string, signal: AbortSignal, sampling: unknown) => Promise<JsonResult>,
}));

vi.mock("@/server/advisors/jsonFill", () => ({
  ollamaJSON: vi.fn((base: string, modelId: string, system: string, user: string, signal: AbortSignal, sampling: unknown) =>
    h.json(base, modelId, system, user, signal, sampling)),
}));

const {
  nativeOllamaBase,
  isTransient,
  ollamaInvoker,
  EXTRACTION_SAMPLING,
  EXTRACTION_TIMEOUT_MS,
  RETRY_DELAYS_MS,
} = await import("@/server/advisors/knowledge/invoke");
const { ollamaJSON } = await import("@/server/advisors/jsonFill");
const jsonCall = ollamaJSON as unknown as ReturnType<typeof vi.fn>;

let onRetry: ReturnType<typeof vi.fn<(info: RetryInfo) => void>>;

beforeEach(() => {
  vi.clearAllMocks();
  onRetry = vi.fn<(info: RetryInfo) => void>();
  h.json = async () => ({ raw: "", data: {}, parsed: true, tokens: 0, ms: 0 });
});
afterEach(() => vi.useRealTimers());

const freshSignal = () => new AbortController().signal;

describe("nativeOllamaBase", () => {
  it("undefined → localhost default (?? branch)", () => {
    expect(nativeOllamaBase(undefined)).toBe("http://localhost:11434");
  });
  it("strips the /v1 OpenAI-compat suffix", () => {
    expect(nativeOllamaBase("http://host:11434/v1")).toBe("http://host:11434");
  });
  it("strips trailing slashes FIRST, then /v1 (order matters)", () => {
    expect(nativeOllamaBase("http://host:11434/v1///")).toBe("http://host:11434");
  });
  it("strips trailing slashes when there is no /v1", () => {
    expect(nativeOllamaBase("http://host:11434/")).toBe("http://host:11434");
  });
  it("leaves an already-clean base untouched", () => {
    expect(nativeOllamaBase("http://host:11434")).toBe("http://host:11434");
  });
  it("only strips /v1 at the END, not mid-path (anchored regex)", () => {
    expect(nativeOllamaBase("http://host/v1/api")).toBe("http://host/v1/api");
  });
  it("empty string is kept as-is (?? only catches null/undefined)", () => {
    expect(nativeOllamaBase("")).toBe("");
  });
});

describe("isTransient", () => {
  it("AbortError → false (deliberate abort, never retried)", () => {
    const e = new Error("aborted");
    e.name = "AbortError";
    expect(isTransient(e)).toBe(false);
  });
  it("TimeoutError → false (deliberate timeout, never retried)", () => {
    const e = new Error("timed out");
    e.name = "TimeoutError";
    expect(isTransient(e)).toBe(false);
  });
  it("Error whose message says 'fetch failed' → true (cause absent → '' branch)", () => {
    expect(isTransient(new Error("fetch failed"))).toBe(true);
  });
  it("benign Error message → false (regex miss)", () => {
    expect(isTransient(new Error("bad prompt shape"))).toBe(false);
  });
  it("Error with cause.code ECONNRESET but benign message → true via cause.code", () => {
    expect(isTransient(new Error("boom", { cause: { code: "ECONNRESET" } }))).toBe(true);
  });
  it("Error with string cause 'network glitch' (no .code) → true via ?? cause fallback", () => {
    expect(isTransient(new Error("boom", { cause: "network glitch" }))).toBe(true);
  });
  it("Error with cause object lacking .code + benign → false (fallback → '[object Object]')", () => {
    expect(isTransient(new Error("boom", { cause: { foo: 1 } }))).toBe(false);
  });
  it("non-Error string containing EPIPE → true (String(err) path)", () => {
    expect(isTransient("write EPIPE")).toBe(true);
  });
  it("non-Error string benign → false", () => {
    expect(isTransient("all good here")).toBe(false);
  });
  it("non-Error number 503 → true (String(503) matches the 5xx clause)", () => {
    expect(isTransient(503)).toBe(true);
  });
  it("non-Error plain object → '[object Object]' → false", () => {
    expect(isTransient({})).toBe(false);
  });
});

describe("extraction constants", () => {
  it("EXTRACTION_SAMPLING pins temperature 0 + seed 7 (deterministic)", () => {
    expect(EXTRACTION_SAMPLING).toEqual({ temperature: 0, seed: 7 });
  });
  it("EXTRACTION_TIMEOUT_MS is 6 minutes", () => {
    expect(EXTRACTION_TIMEOUT_MS).toBe(360_000);
  });
  it("RETRY_DELAYS_MS is exactly [2s, 8s, 30s]", () => {
    expect(RETRY_DELAYS_MS).toEqual([2_000, 8_000, 30_000]);
  });
});

describe("ollamaInvoker — success path", () => {
  it("first-try success → returns ONLY {raw,data}, normalizes base, forwards EXTRACTION_SAMPLING + an AbortSignal", async () => {
    h.json = async () => ({ raw: "RAW", data: { concept: "x" }, parsed: true, tokens: 42, ms: 100 });

    const res = await ollamaInvoker("http://box:11434/v1/", "qwen2.5:7b", freshSignal())("SYS", "USR");

    // tokens/ms/parsed are dropped — the invoker maps to {raw,data} only.
    expect(res).toEqual({ raw: "RAW", data: { concept: "x" } });
    expect(jsonCall).toHaveBeenCalledTimes(1);

    const [base, modelId, system, user, sig, sampling] = jsonCall.mock.calls[0];
    expect(base).toBe("http://box:11434"); // /v1/ trailing → normalized inside the invoker
    expect(modelId).toBe("qwen2.5:7b");
    expect(system).toBe("SYS");
    expect(user).toBe("USR");
    expect(sig).toBeInstanceOf(AbortSignal);
    expect(sampling).toBe(EXTRACTION_SAMPLING);
    expect(sampling).toEqual({ temperature: 0, seed: 7 });
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("uses opts.timeoutMs for AbortSignal.timeout, and falls back to EXTRACTION_TIMEOUT_MS otherwise", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    h.json = async () => ({ raw: "a", data: {}, parsed: true, tokens: 0, ms: 0 });

    await ollamaInvoker("b", "m", freshSignal(), { timeoutMs: 1234 })("s", "u");
    expect(spy).toHaveBeenLastCalledWith(1234);

    spy.mockClear();
    await ollamaInvoker("b", "m", freshSignal())("s", "u"); // no opts → ?? default
    expect(spy).toHaveBeenLastCalledWith(EXTRACTION_TIMEOUT_MS);

    spy.mockRestore();
  });
});

describe("ollamaInvoker — retry behaviour", () => {
  it("transient failure then success → retries once, calls onRetry with exact info, sleeps 2s", async () => {
    vi.useFakeTimers();
    let n = 0;
    h.json = async () => {
      n += 1;
      if (n === 1) throw new Error("fetch failed");
      return { raw: "OK", data: { x: 1 }, parsed: true, tokens: 3, ms: 9 };
    };

    const p = ollamaInvoker("http://h/v1", "m", freshSignal(), { onRetry })("sys", "usr");
    await vi.advanceTimersByTimeAsync(2_000);
    const res = await p;

    expect(res).toEqual({ raw: "OK", data: { x: 1 } });
    expect(jsonCall).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith({ attempt: 1, delayMs: 2_000, error: "Error: fetch failed" });
  });

  it("non-Error transient throw → onRetry.error uses String(err), retry still succeeds", async () => {
    vi.useFakeTimers();
    let n = 0;
    h.json = async () => {
      n += 1;
      if (n === 1) throw "ECONNRESET"; // non-Error transient
      return { raw: "Z", data: {}, parsed: true, tokens: 0, ms: 0 };
    };

    const p = ollamaInvoker("b", "m", freshSignal(), { onRetry })("s", "u");
    await vi.advanceTimersByTimeAsync(2_000);

    expect(await p).toEqual({ raw: "Z", data: {} });
    expect(onRetry).toHaveBeenCalledWith({ attempt: 1, delayMs: 2_000, error: "ECONNRESET" });
  });

  it("all attempts transient → throws the LAST error after 3 retries; onRetry fired 3× with the exact delay ladder", async () => {
    vi.useFakeTimers();
    h.json = async () => {
      throw new Error("ECONNRESET");
    };

    const settled = ollamaInvoker("b", "m", freshSignal(), { onRetry })("s", "u")
      .then(() => "RESOLVED_UNEXPECTEDLY" as const)
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(50_000); // 2s + 8s + 30s of sleeps, with headroom
    const out = await settled;

    expect(out).toBeInstanceOf(Error);
    expect((out as Error).message).toBe("ECONNRESET");
    expect(jsonCall).toHaveBeenCalledTimes(4); // initial + 3 retries
    expect(onRetry.mock.calls.map((c) => c[0])).toEqual([
      { attempt: 1, delayMs: 2_000, error: "Error: ECONNRESET" },
      { attempt: 2, delayMs: 8_000, error: "Error: ECONNRESET" },
      { attempt: 3, delayMs: 30_000, error: "Error: ECONNRESET" },
    ]);
  });

  it("missing onRetry (3-arg call, default opts) → still retries via optional chaining and succeeds", async () => {
    vi.useFakeTimers();
    let n = 0;
    h.json = async () => {
      n += 1;
      if (n === 1) throw new Error("socket hang up");
      return { raw: "Y", data: {}, parsed: true, tokens: 0, ms: 0 };
    };

    const p = ollamaInvoker("b", "m", freshSignal())("s", "u"); // opts defaulted to {}
    await vi.advanceTimersByTimeAsync(2_000);

    expect(await p).toEqual({ raw: "Y", data: {} });
    expect(jsonCall).toHaveBeenCalledTimes(2);
  });
});

describe("ollamaInvoker — no-retry short circuits", () => {
  it("non-transient error → throws immediately, no retry, onRetry untouched", async () => {
    h.json = async () => {
      throw new Error("invalid prompt schema");
    };

    await expect(ollamaInvoker("b", "m", freshSignal(), { onRetry })("s", "u")).rejects.toThrow(
      "invalid prompt schema",
    );
    expect(jsonCall).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("already-aborted signal → throws even for a transient error, no retry", async () => {
    const ac = new AbortController();
    ac.abort();
    h.json = async () => {
      throw new Error("fetch failed"); // transient, but signal.aborted wins
    };

    await expect(ollamaInvoker("b", "m", ac.signal, { onRetry })("s", "u")).rejects.toThrow("fetch failed");
    expect(jsonCall).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });
});
