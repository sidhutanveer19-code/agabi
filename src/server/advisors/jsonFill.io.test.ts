import { describe, it, expect, vi, afterEach } from "vitest";
import { parseSlotJSON, ollamaJSON, ollamaStream } from "@/server/advisors/jsonFill";

/**
 * HARD tests for the Ollama native-API fill path. The parseSlotJSON pure-logic
 * cases live in jsonFill.test.ts; this file attacks the two fetch-driven exports
 * (ollamaJSON, ollamaStream) at the narrowest I/O edge (global fetch), asserting
 * exact request bodies, exact result shapes, and the streaming line-buffer logic
 * with adversarial chunk boundaries. Plus extra hostile parseSlotJSON inputs.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---- adversarial parseSlotJSON (branches not covered by the sibling file) ----

describe("parseSlotJSON — extra hostile inputs", () => {
  it("takes the FIRST balanced object when two objects appear", () => {
    expect(parseSlotJSON('{"a":1} {"b":2}')).toEqual({ a: 1 });
  });

  it("handles nested braces and closes at the correct depth", () => {
    expect(parseSlotJSON('{"outer":{"inner":{"n":3}},"k":"v"}')).toEqual({
      outer: { inner: { n: 3 } },
      k: "v",
    });
  });

  it("an escaped quote inside a string does not end the string early", () => {
    expect(parseSlotJSON('{"q":"she said \\"hi}\\" ok","n":7}')).toEqual({
      q: 'she said "hi}" ok',
      n: 7,
    });
  });

  it("unbalanced (never-closing) object slices to end and fails to parse -> null", () => {
    expect(parseSlotJSON('prefix {"a":1, "b":2 no close here')).toBeNull();
  });

  it("uppercase fence ```JSON is stripped", () => {
    expect(parseSlotJSON("```JSON\n{\"x\":1}\n```")).toEqual({ x: 1 });
  });

  it("returns null on null/undefined (falsy guard)", () => {
    // @ts-expect-error hostile input
    expect(parseSlotJSON(null)).toBeNull();
    // @ts-expect-error hostile input
    expect(parseSlotJSON(undefined)).toBeNull();
  });

  it("a JSON string/number/boolean primitive at top level is rejected", () => {
    // start is at first '{' — a bare primitive has none -> null
    expect(parseSlotJSON('"just a string"')).toBeNull();
    expect(parseSlotJSON("42")).toBeNull();
    // an object whose parse yields a non-object could not happen, but null literal value inside:
    expect(parseSlotJSON("{}")).toEqual({});
  });
});

// ---- ollamaJSON: one-shot JSON request ----

function jsonResponse(payload: unknown) {
  return { json: async () => payload } as unknown as Response;
}

describe("ollamaJSON — request shape + result mapping", () => {
  it("sends native /api/chat with format:json, default temp 0.4, no seed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        message: { content: '{"markdown":"# Real"}' },
        eval_count: 12,
        eval_duration: 2_000_000, // ns -> 2 ms
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const ac = new AbortController();
    const r = await ollamaJSON("http://host:11434", "qwen2.5:3b", "SYS", "USR", ac.signal);

    expect(r).toEqual({
      data: { markdown: "# Real" },
      raw: '{"markdown":"# Real"}',
      parsed: true,
      tokens: 12,
      ms: 2, // Math.round(2_000_000 / 1e6)
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://host:11434/api/chat");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).signal).toBe(ac.signal);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("qwen2.5:3b");
    expect(body.stream).toBe(false);
    expect(body.format).toBe("json");
    expect(body.options).toEqual({ temperature: 0.4 }); // no seed key at all
    expect("seed" in body.options).toBe(false);
    expect(body.messages).toEqual([
      { role: "system", content: "SYS" },
      { role: "user", content: "USR" },
    ]);
  });

  it("honors sampling overrides: temperature 0 AND seed 0 are included (not dropped as falsy)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ message: { content: "{}" }, eval_count: 0, eval_duration: 0 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await ollamaJSON("http://h", "m", "s", "u", new AbortController().signal, {
      temperature: 0,
      seed: 0,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.options).toEqual({ temperature: 0, seed: 0 });
  });

  it("falls back to wall-clock ms when eval_duration is absent, and tokens 0 when eval_count absent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ message: { content: '{"ok":true}' } }), // no eval_* fields
    );
    vi.stubGlobal("fetch", fetchMock);

    const r = await ollamaJSON("http://h", "m", "s", "u", new AbortController().signal);
    expect(r.data).toEqual({ ok: true });
    expect(r.parsed).toBe(true);
    expect(r.tokens).toBe(0);
    expect(r.ms).toBeGreaterThanOrEqual(0); // wall-clock branch (Date.now()-t0)
    expect(Number.isFinite(r.ms)).toBe(true);
  });

  it("unparseable content -> data:{} parsed:false, but raw is preserved verbatim", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ message: { content: "sorry, no json for you" }, eval_count: 3 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const r = await ollamaJSON("http://h", "m", "s", "u", new AbortController().signal);
    expect(r.data).toEqual({});
    expect(r.parsed).toBe(false);
    expect(r.raw).toBe("sorry, no json for you");
    expect(r.tokens).toBe(3);
  });

  it("missing message.content -> raw is empty string, data {}, parsed false", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ eval_count: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    const r = await ollamaJSON("http://h", "m", "s", "u", new AbortController().signal);
    expect(r.raw).toBe("");
    expect(r.data).toEqual({});
    expect(r.parsed).toBe(false);
  });
});

// ---- ollamaStream: NDJSON streaming ----

/** Build a Response whose body.getReader() yields the given byte chunks in order. */
function streamResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  let i = 0;
  return {
    body: {
      getReader() {
        return {
          read() {
            if (i < chunks.length) {
              return Promise.resolve({ done: false, value: enc.encode(chunks[i++]) });
            }
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    },
  } as unknown as Response;
}

describe("ollamaStream — line-buffered NDJSON accumulation", () => {
  it("accumulates content across chunk boundaries and calls onText with FULL text each time", async () => {
    // A line is deliberately split across two reads to exercise the buffer.
    const chunks = [
      '{"message":{"content":"Hello"}}\n{"mess',
      'age":{"content":" world"},"eval_count":5,"done":true}\n',
    ];
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(chunks));
    vi.stubGlobal("fetch", fetchMock);

    const seen: string[] = [];
    const r = await ollamaStream(
      "http://h",
      "m",
      "s",
      "u",
      new AbortController().signal,
      (full) => seen.push(full),
    );

    expect(seen).toEqual(["Hello", "Hello world"]); // full accumulated text each call
    expect(r.text).toBe("Hello world");
    expect(r.tokens).toBe(5);
    expect(r.ms).toBeGreaterThanOrEqual(0);

    // request shape: streaming, temp 0.6, no json format
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.stream).toBe(true);
    expect(body.options).toEqual({ temperature: 0.6 });
    expect(body.format).toBeUndefined();
  });

  it("skips blank lines and malformed (non-JSON) lines without throwing", async () => {
    const chunks = [
      "\n", // blank -> continue
      "this is not json\n", // JSON.parse throws -> caught/skipped
      '{"message":{"content":"A"}}\n',
      '{"message":{"content":"B"},"eval_count":9}\n',
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse(chunks)));

    const seen: string[] = [];
    const r = await ollamaStream("http://h", "m", "s", "u", new AbortController().signal, (f) =>
      seen.push(f),
    );

    expect(seen).toEqual(["A", "AB"]);
    expect(r.text).toBe("AB");
    expect(r.tokens).toBe(9);
  });

  it("empty-content deltas do NOT trigger onText (only non-empty d appends)", async () => {
    const chunks = [
      '{"message":{"content":""}}\n', // d === "" -> no onText, no append
      '{"done":true,"eval_count":2}\n', // no message at all
      '{"message":{"content":"X"}}\n',
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse(chunks)));

    const seen: string[] = [];
    const r = await ollamaStream("http://h", "m", "s", "u", new AbortController().signal, (f) =>
      seen.push(f),
    );

    expect(seen).toEqual(["X"]); // only the one real delta
    expect(r.text).toBe("X");
    expect(r.tokens).toBe(2);
  });

  it("returns empty result (no reader) when the response body is null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ body: null } as unknown as Response));

    const onText = vi.fn();
    const r = await ollamaStream("http://h", "m", "s", "u", new AbortController().signal, onText);

    expect(onText).not.toHaveBeenCalled();
    expect(r.text).toBe("");
    expect(r.tokens).toBe(0);
    expect(r.ms).toBeGreaterThanOrEqual(0);
  });
});
