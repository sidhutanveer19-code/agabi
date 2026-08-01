import { describe, it, expect, vi, afterEach } from "vitest";
import { parseSlotJSON, ollamaJSON, ollamaStream } from "@/server/advisors/jsonFill";

/**
 * Mutation-kill tests for jsonFill.ts. Each test pins the EXACT behavior a
 * surviving Stryker mutant would flip, at the narrowest I/O edge (global fetch /
 * a hand-rolled ReadableStream reader). Assertions are on real values, never
 * "it ran". The sibling jsonFill.test.ts / jsonFill.io.test.ts stay untouched.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// parseSlotJSON — fence-strip regex + balanced-extraction mutants
// ---------------------------------------------------------------------------

describe("parseSlotJSON — regex/extraction mutants", () => {
  it("L14:33 \\s->\\S: a fence tag directly abutting the object still yields the object", () => {
    // Original strips just ` ```json `; the `\S*` mutant would greedily eat the
    // whole `{"a":1}` too, leaving nothing -> null.
    expect(parseSlotJSON('```json{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("L14:66 \\s->\\S (2nd regex): trailing junk before the fence does not swallow the object", () => {
    // Original strips only the trailing ```; the `\S*` mutant eats `{"a":1}xyz`
    // back to the ``` -> "" -> null.
    expect(parseSlotJSON('{"a":1}xyz```')).toEqual({ a: 1 });
  });

  it("L14:33 remove ^ / L14:66 remove $: a ``` INSIDE a string value is preserved verbatim", () => {
    // Both fence-strip regexes are anchored (^ / $) so a mid-string ``` is left
    // alone. Dropping either anchor lets the regex strip the backticks out of the
    // value -> {a:"x"} instead of {a:"```x"}.
    expect(parseSlotJSON('{"a":"```x"}')).toEqual({ a: "```x" });
  });

  it("L16:17 (start === -1 -> === +1): an object at index 1 is NOT rejected as not-found", () => {
    // Mutant checks `start === 1` and bails; the real code only bails on -1.
    expect(parseSlotJSON('x{"a":1}')).toEqual({ a: 1 });
  });

  it("L20:22 (esc = false -> esc = true): escape state resets so trailing junk is excluded", () => {
    // With esc stuck true after the first backslash, the string never closes, the
    // object never closes, end stays -1, candidate = whole string incl. ` X` ->
    // JSON.parse fails -> null. Real code closes the object and drops ` X`.
    expect(parseSlotJSON('{"k":"a\\"b"} X')).toEqual({ k: 'a"b' });
  });

  it("L30:29 (end === -1 -> === +1): balanced object at end index 1 slices to end+1, not to end", () => {
    // For `{}xyz`, end===1. Real code: `end === -1` is false -> slice(start, end+1)
    // = `{}` -> {}. Mutant: `end === +1` is TRUE -> slice(start) = `{}xyz` -> parse
    // fails -> null. So the empty-object result itself is the discriminator.
    expect(parseSlotJSON("{}xyz")).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// ollamaJSON — request headers + wall-clock timing
// ---------------------------------------------------------------------------

function jsonResponse(payload: unknown) {
  return { json: async () => payload } as unknown as Response;
}

describe("ollamaJSON — header + timing mutants", () => {
  it("L73:14 / L73:32: request carries an exact content-type header", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: { content: '{"ok":true}' }, eval_count: 1, eval_duration: 1_000_000 }));
    vi.stubGlobal("fetch", fetchMock);

    await ollamaJSON("http://h", "m", "s", "u", new AbortController().signal);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    // Kills L73:14 (headers -> {}) and L73:32 ("application/json" -> "").
    expect(init.headers).toEqual({ "content-type": "application/json" });
  });

  it("L94:63 (Date.now() - t0 -> + t0): wall-clock fallback ms stays small elapsed time", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: { content: "{}" } })); // no eval_duration
    vi.stubGlobal("fetch", fetchMock);

    const r = await ollamaJSON("http://h", "m", "s", "u", new AbortController().signal);
    // Real elapsed is a few ms; `Date.now() + t0` would be ~2 * epoch-ms (~3.4e12).
    expect(r.ms).toBeGreaterThanOrEqual(0);
    expect(r.ms).toBeLessThan(1_000_000);
  });
});

// ---------------------------------------------------------------------------
// ollamaStream — request shape, no-reader timing, decoder streaming, line trim
// ---------------------------------------------------------------------------

/** Reader that yields the given RAW byte chunks (lets us split a char mid-UTF-8). */
function byteStreamResponse(chunks: Uint8Array[]): Response {
  let i = 0;
  return {
    body: {
      getReader() {
        return {
          read() {
            if (i < chunks.length) return Promise.resolve({ done: false, value: chunks[i++] });
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    },
  } as unknown as Response;
}

/** Reader over string chunks (each re-encoded as UTF-8). */
function stringStreamResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  return byteStreamResponse(chunks.map((c) => enc.encode(c)));
}

describe("ollamaStream — request-shape mutants", () => {
  it("L109/L110/L111/L116-118: exact url, method, headers, and messages", async () => {
    const fetchMock = vi.fn().mockResolvedValue(stringStreamResponse(['{"message":{"content":"A"}}\n']));
    vi.stubGlobal("fetch", fetchMock);

    await ollamaStream("http://h", "qwen2.5:7b", "SYS", "USR", new AbortController().signal, () => {});

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://h/api/chat"); // L109:27 (`/api/chat` -> ``)
    expect(init.method).toBe("POST"); // L110:13 ("POST" -> "")
    expect(init.headers).toEqual({ "content-type": "application/json" }); // L111:14 / L111:32

    const body = JSON.parse(init.body as string);
    // L116:17 (messages -> []), L117:9/L118:9 ({} objects), L117:17/L118:17 (role strings).
    expect(body.messages).toEqual([
      { role: "system", content: "SYS" },
      { role: "user", content: "USR" },
    ]);
  });
});

describe("ollamaStream — timing + decoder + line-trim mutants", () => {
  it("L124:50 (Date.now() - t0 -> + t0): no-reader return ms is small elapsed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ body: null } as unknown as Response));

    const r = await ollamaStream("http://h", "m", "s", "u", new AbortController().signal, () => {});
    expect(r.text).toBe("");
    expect(r.ms).toBeGreaterThanOrEqual(0);
    expect(r.ms).toBeLessThan(1_000_000);
  });

  it("L146:36 (Date.now() - t0 -> + t0): normal return ms is small elapsed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(stringStreamResponse(['{"message":{"content":"A"}}\n'])));

    const r = await ollamaStream("http://h", "m", "s", "u", new AbortController().signal, () => {});
    expect(r.text).toBe("A");
    expect(r.ms).toBeGreaterThanOrEqual(0);
    expect(r.ms).toBeLessThan(1_000_000);
  });

  it("L130:30 / L130:40 ({stream:true} -> {} / false): a multi-byte char split across reads decodes intact", async () => {
    // "é" (U+00E9) = bytes C3 A9. Split so C3 ends chunk 1 and A9 starts chunk 2.
    // Streaming decode buffers the partial byte; without stream:true each half
    // becomes U+FFFD and the line's content is corrupted (not "é").
    const enc = new TextEncoder();
    const all = enc.encode('{"message":{"content":"é"}}\n');
    const mb = all.findIndex((b) => b >= 0x80); // index of 0xC3
    const c1 = all.slice(0, mb + 1); // ...":"  + 0xC3
    const c2 = all.slice(mb + 1); //   0xA9 + "}}\n
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(byteStreamResponse([c1, c2])));

    const r = await ollamaStream("http://h", "m", "s", "u", new AbortController().signal, () => {});
    expect(r.text).toBe("é");
  });

  it("L133:20 (drop .trim() on the line): a non-JSON-whitespace prefix is trimmed so the line parses", async () => {
    // U+00A0 (nbsp) is stripped by String.trim() but is NOT valid JSON whitespace,
    // so JSON.parse rejects it. Real code trims -> content "Z" survives. Dropping
    // .trim() -> JSON.parse(' {...}') throws -> line skipped -> text "".
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(stringStreamResponse([' {"message":{"content":"Z"}}\n'])));

    const seen: string[] = [];
    const r = await ollamaStream("http://h", "m", "s", "u", new AbortController().signal, (f) => seen.push(f));
    expect(seen).toEqual(["Z"]);
    expect(r.text).toBe("Z");
  });
});
