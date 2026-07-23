import { describe, it, expect, vi } from "vitest";

// ollamaJSON is the network boundary; stub it so a "transient failure" is deterministic.
const jsonCall = vi.fn();
vi.mock("@/server/advisors/jsonFill", () => ({ ollamaJSON: (...a: unknown[]) => jsonCall(...a) }));

import { ollamaInvoker, isTransient, RETRY_DELAYS_MS, nativeOllamaBase } from "@/server/advisors/knowledge/invoke";

const ok = { raw: '{"x":1}', data: { x: 1 }, parsed: true, tokens: 1, ms: 1 };
const fetchFailed = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });

describe("extraction resilience — a transient blip must not cost a chapter", () => {
  it("classifies a dropped connection as transient, and a timeout/abort as NOT", () => {
    expect(isTransient(fetchFailed())).toBe(true);
    expect(isTransient(new Error("connect ECONNREFUSED 127.0.0.1:11434"))).toBe(true);
    expect(isTransient(new Error("socket hang up"))).toBe(true);

    // deliberate stops are not retried — retrying a timeout just burns the budget again
    expect(isTransient(Object.assign(new Error("timed out"), { name: "TimeoutError" }))).toBe(false);
    expect(isTransient(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(false);
    expect(isTransient(new Error("Unexpected token < in JSON"))).toBe(false); // a real bug: surface it
  });

  it("retries a dropped connection and succeeds — the exact failure that killed Real Numbers", async () => {
    vi.useFakeTimers();
    jsonCall.mockReset();
    jsonCall.mockRejectedValueOnce(fetchFailed()).mockResolvedValueOnce(ok);

    const seen: { attempt: number; delayMs: number; error: string }[] = [];
    const invoke = ollamaInvoker("http://localhost:11434", "m", new AbortController().signal, {
      onRetry: (i) => seen.push(i),
    });

    const p = invoke("sys", "user");
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
    await expect(p).resolves.toEqual({ raw: ok.raw, data: ok.data });

    expect(jsonCall).toHaveBeenCalledTimes(2);
    // R1: the retry is reported, never silent
    expect(seen).toEqual([{ attempt: 1, delayMs: RETRY_DELAYS_MS[0], error: "TypeError: fetch failed" }]);
    vi.useRealTimers();
  });

  it("gives up after the ladder and rethrows — a persistently dead Ollama is not hidden", async () => {
    vi.useFakeTimers();
    jsonCall.mockReset();
    jsonCall.mockRejectedValue(fetchFailed());

    const invoke = ollamaInvoker("http://localhost:11434", "m", new AbortController().signal);
    const p = invoke("sys", "user");
    const assertion = expect(p).rejects.toThrow(/fetch failed/);
    for (const d of RETRY_DELAYS_MS) await vi.advanceTimersByTimeAsync(d);
    await assertion;

    expect(jsonCall).toHaveBeenCalledTimes(RETRY_DELAYS_MS.length + 1); // first try + each retry
    vi.useRealTimers();
  });

  it("does NOT retry once the caller has aborted — Ctrl-C stops now", async () => {
    jsonCall.mockReset();
    jsonCall.mockRejectedValue(fetchFailed());
    const ac = new AbortController();
    ac.abort();

    await expect(ollamaInvoker("http://localhost:11434", "m", ac.signal)("s", "u")).rejects.toThrow();
    expect(jsonCall).toHaveBeenCalledTimes(1); // no retry ladder on a deliberate stop
  });

  it("strips the /v1 suffix — the OpenAI-compatible base 404s against the native endpoint", () => {
    expect(nativeOllamaBase("http://localhost:11434/v1")).toBe("http://localhost:11434");
    expect(nativeOllamaBase("http://localhost:11434/")).toBe("http://localhost:11434");
    expect(nativeOllamaBase(undefined)).toBe("http://localhost:11434");
  });
});
