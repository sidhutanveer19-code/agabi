import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TeachRequest, TeachContext, TeachEvent } from "@contract";

/**
 * teachingService.teach — the real backend teaching relay.
 *
 * The ONLY I/O edge is the network POST (`apiClient.postStream`); it is stubbed to
 * return a real `Response` whose body is a real `ReadableStream` of NDJSON bytes.
 * Everything else runs for real: the real `ndjsonStream` reader AND the real
 * `teachEventSchema.safeParse`. So every assertion proves the WHOLE production
 * pipeline — bytes → lines → JSON → schema filter → yielded TeachEvent — not a stand-in.
 *
 * Branches under test in teachingService itself:
 *   - request construction: path via ENDPOINTS.canvasTeach (encodeURIComponent applied),
 *     body = { request, context }, the caller's signal threaded through unchanged.
 *   - `if (parsed.success) yield parsed.data` TRUE branch  → valid events are yielded.
 *   - `if (parsed.success) …` FALSE branch (comment: "malformed events are dropped, not
 *     fatal") → schema-invalid raw objects are silently dropped, stream continues.
 *   - the `for await` loop with 0 iterations (no body / blank-only body / aborted signal).
 * Plus the yielded value is the PARSED (sanitized) data, not the raw wire object.
 */

// vi.hoisted so the mock factory can close over the stub before imports resolve.
// Typed with the real postStream signature so `mock.calls[i]` is a [path, body, signal] tuple.
const h = vi.hoisted(() => ({
  postStream: vi.fn(
    async (_path: string, _body: unknown, _signal: AbortSignal): Promise<Response> => new Response(),
  ),
}));

vi.mock("@/features/platform/client/apiClient", () => ({
  apiClient: { postStream: h.postStream },
}));

// Real teachingService, real ndjsonStream, real teachEventSchema — nothing else faked.
const { teachingService } = await import("@/features/platform/services/teachingService");

const REQ: TeachRequest = { kind: "lesson", topic: "gravity" };
const CTX: TeachContext = {
  topic: "gravity",
  explanations: [{ regionId: "r1", title: "Intro", kind: "lesson" }],
  selectedRegionId: null,
};

/** Build a real Response whose body is a real ReadableStream emitting the given byte chunks. */
function streamResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const ch of chunks) controller.enqueue(enc.encode(ch));
      controller.close();
    },
  });
  return new Response(stream);
}

/** One NDJSON payload: each value JSON.stringify'd on its own line, trailing newline. */
function ndjson(...events: unknown[]): Response {
  return streamResponse([events.map((e) => JSON.stringify(e)).join("\n") + "\n"]);
}

/** Drain the async generator into an array. */
async function collect(gen: AsyncIterable<TeachEvent>): Promise<TeachEvent[]> {
  const out: TeachEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

beforeEach(() => {
  h.postStream.mockReset();
  h.postStream.mockResolvedValue(new Response()); // safe default: null body → yields nothing
});

describe("teachingService — request construction (the I/O call args)", () => {
  it("POSTs to the canvasTeach path with body {request, context} and the exact caller signal", async () => {
    h.postStream.mockResolvedValue(ndjson({ t: "done" }));
    const signal = new AbortController().signal;

    await collect(teachingService.teach(REQ, CTX, signal, "c-abc"));

    expect(h.postStream).toHaveBeenCalledTimes(1);
    const [path, body, passedSignal] = h.postStream.mock.calls[0];
    expect(path).toBe("/api/canvas/c-abc/teach");
    expect(body).toEqual({ request: REQ, context: CTX });
    expect(passedSignal).toBe(signal); // same instance, not a copy
  });

  it("encodeURIComponent is applied to a canvasId with slashes/spaces", async () => {
    h.postStream.mockResolvedValue(ndjson({ t: "done" }));

    await collect(teachingService.teach(REQ, CTX, new AbortController().signal, "canvas 1/x?y"));

    expect(h.postStream.mock.calls[0][0]).toBe("/api/canvas/canvas%201%2Fx%3Fy/teach");
  });

  it("does NOT call postStream until the generator is iterated (lazy async generator)", async () => {
    h.postStream.mockResolvedValue(ndjson({ t: "done" }));
    const gen = teachingService.teach(REQ, CTX, new AbortController().signal, "c1");
    expect(h.postStream).not.toHaveBeenCalled(); // creating the generator does no work
    await collect(gen);
    expect(h.postStream).toHaveBeenCalledTimes(1);
  });
});

describe("teachingService — success branch (valid events yielded)", () => {
  it("yields every variant of TeachEvent, in stream order, with exact parsed values", async () => {
    const events: TeachEvent[] = [
      { t: "status", status: "thinking" },
      { t: "region", title: "Newton's First Law" },
      { t: "block", block: { type: "text", data: { md: "hi" } } },
      { t: "patch", index: 0, data: { streamText: "gravity is" } },
      { t: "outcome", outcome: "COMPLETE", failedIndices: [], plannedCount: 3, readyCount: 3 },
      { t: "error", recoverable: true, message: "retryable" },
      { t: "done" },
    ];
    h.postStream.mockResolvedValue(ndjson(...events));

    const got = await collect(teachingService.teach(REQ, CTX, new AbortController().signal, "c1"));
    expect(got).toEqual(events); // exact set, exact order, exact values
  });

  it("preserves the optional wire-version field v:1 on a valid event", async () => {
    h.postStream.mockResolvedValue(ndjson({ t: "status", v: 1, status: "generating" }));
    const got = await collect(teachingService.teach(REQ, CTX, new AbortController().signal, "c1"));
    expect(got).toEqual([{ t: "status", v: 1, status: "generating" }]);
  });

  it("yields the PARSED (sanitized) data, not the raw wire object — unknown keys are stripped", async () => {
    // Zod strips unknown keys; teachingService must relay parsed.data, not the raw line.
    h.postStream.mockResolvedValue(
      ndjson({ t: "region", title: "Kept", junk: "SHOULD_BE_STRIPPED", nested: { a: 1 } }),
    );
    const got = await collect(teachingService.teach(REQ, CTX, new AbortController().signal, "c1"));
    expect(got).toEqual([{ t: "region", title: "Kept" }]);
    expect("junk" in got[0]).toBe(false);
    expect("nested" in got[0]).toBe(false);
  });

  it("relays a single event (boundary: exactly one line)", async () => {
    h.postStream.mockResolvedValue(ndjson({ t: "done" }));
    const got = await collect(teachingService.teach(REQ, CTX, new AbortController().signal, "c1"));
    expect(got).toEqual([{ t: "done" }]);
  });
});

describe("teachingService — drop branch (parsed.success === false)", () => {
  it("drops schema-invalid raw objects but keeps valid ones around them, in order", async () => {
    h.postStream.mockResolvedValue(
      ndjson(
        { t: "status", status: "thinking" }, // valid
        { t: "nonsense" }, // invalid discriminator
        { t: "region" }, // valid discriminator, MISSING required title
        { t: "error", message: "no recoverable field" }, // missing `recoverable`
        { foo: "bar" }, // no discriminator at all
        { t: "done" }, // valid
      ),
    );

    const got = await collect(teachingService.teach(REQ, CTX, new AbortController().signal, "c1"));
    expect(got).toEqual([{ t: "status", status: "thinking" }, { t: "done" }]);
  });

  it("an all-invalid stream yields nothing (drop branch only) — not fatal", async () => {
    h.postStream.mockResolvedValue(ndjson({ t: "bogus" }, { t: "patch" }, {}));
    const got = await collect(teachingService.teach(REQ, CTX, new AbortController().signal, "c1"));
    expect(got).toEqual([]);
  });

  it("drops an outcome event missing v-agnostic required fields, keeps a well-formed outcome", async () => {
    h.postStream.mockResolvedValue(
      ndjson(
        { t: "outcome", outcome: "PARTIAL", failedIndices: [1] }, // missing plannedCount/readyCount
        { t: "outcome", outcome: "FAILED", failedIndices: [0, 2], plannedCount: 4, readyCount: 2 }, // valid
      ),
    );
    const got = await collect(teachingService.teach(REQ, CTX, new AbortController().signal, "c1"));
    expect(got).toEqual([
      { t: "outcome", outcome: "FAILED", failedIndices: [0, 2], plannedCount: 4, readyCount: 2 },
    ]);
  });
});

describe("teachingService — malformed JSON lines (dropped by the reader, stream survives)", () => {
  it("a non-JSON line is skipped; valid events before and after still come through", async () => {
    // Hand-craft raw bytes: a broken line in the middle of two good ones.
    h.postStream.mockResolvedValue(
      streamResponse([
        JSON.stringify({ t: "status", status: "planning" }) + "\n",
        "{not valid json at all\n",
        JSON.stringify({ t: "done" }) + "\n",
      ]),
    );
    const got = await collect(teachingService.teach(REQ, CTX, new AbortController().signal, "c1"));
    expect(got).toEqual([{ t: "status", status: "planning" }, { t: "done" }]);
  });
});

describe("teachingService — empty / no-op streams (loop runs 0 times)", () => {
  it("no response body (Response() with null body) → yields nothing", async () => {
    h.postStream.mockResolvedValue(new Response());
    const got = await collect(teachingService.teach(REQ, CTX, new AbortController().signal, "c1"));
    expect(got).toEqual([]);
  });

  it("body of only blank lines / whitespace → yields nothing", async () => {
    h.postStream.mockResolvedValue(streamResponse(["\n   \n\n \t \n"]));
    const got = await collect(teachingService.teach(REQ, CTX, new AbortController().signal, "c1"));
    expect(got).toEqual([]);
  });
});

describe("teachingService — streaming mechanics relayed faithfully", () => {
  it("reassembles an event split across chunk boundaries and reads a newline-less tail", async () => {
    const a = JSON.stringify({ t: "region", title: "Split Across Chunks" });
    const b = JSON.stringify({ t: "done" }); // no trailing newline → exercises the tail branch
    h.postStream.mockResolvedValue(
      streamResponse([a.slice(0, 5), a.slice(5) + "\n", b.slice(0, 4), b.slice(4)]),
    );
    const got = await collect(teachingService.teach(REQ, CTX, new AbortController().signal, "c1"));
    expect(got).toEqual([{ t: "region", title: "Split Across Chunks" }, { t: "done" }]);
  });

  it("an already-aborted signal yields nothing even though data is available", async () => {
    const ac = new AbortController();
    ac.abort();
    h.postStream.mockResolvedValue(ndjson({ t: "status", status: "thinking" }, { t: "done" }));

    const got = await collect(teachingService.teach(REQ, CTX, ac.signal, "c1"));
    expect(got).toEqual([]); // ndjsonStream returns immediately on an aborted signal
    // …but the aborted signal was still handed to the network call.
    expect(h.postStream.mock.calls[0][2]).toBe(ac.signal);
  });

  it("each teach() call returns an independent generator (no shared state)", async () => {
    h.postStream.mockResolvedValue(ndjson({ t: "done" }));
    const first = await collect(teachingService.teach(REQ, CTX, new AbortController().signal, "c1"));
    h.postStream.mockResolvedValue(ndjson({ t: "status", status: "finished" }));
    const second = await collect(teachingService.teach(REQ, CTX, new AbortController().signal, "c2"));
    expect(first).toEqual([{ t: "done" }]);
    expect(second).toEqual([{ t: "status", status: "finished" }]);
    expect(h.postStream).toHaveBeenCalledTimes(2);
  });
});
