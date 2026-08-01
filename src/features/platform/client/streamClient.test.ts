import { describe, it, expect } from "vitest";
import { ndjsonStream } from "@/features/platform/client/streamClient";

/**
 * ndjsonStream — NDJSON reader over a chunked-fetch Response body.
 *
 * The ONLY I/O edge is the Response + its ReadableStream reader, so that is the
 * single thing faked here: a hand-built reader that yields caller-chosen chunks
 * (bytes, exactly as the network would) and records read/cancel calls. Everything
 * asserted below is the module's OWN logic — cross-chunk line buffering, the
 * `{stream:true}` multibyte reassembly, empty-line skipping, per-line and tail
 * JSON.parse-with-swallow, abort before/mid stream, and the always-cancel finally.
 * Every case names the EXACT array of parsed values it expects and asserts THAT,
 * never "it produced something".
 */

const encoder = new TextEncoder();

interface ReaderState {
  reads: number;
  cancelCalled: number;
}

interface StreamOpts {
  cancelThrows?: boolean;
  /** Fires at the START of each read() with the index of the chunk about to be served. */
  onBeforeRead?: (index: number) => void;
}

/** Build a fake Response whose reader serves `chunks` (strings encoded to UTF-8, or raw bytes). */
function makeStream(
  chunks: Array<string | Uint8Array>,
  opts: StreamOpts = {},
): { res: Response; state: ReaderState } {
  let i = 0;
  const state: ReaderState = { reads: 0, cancelCalled: 0 };
  const reader = {
    read: async (): Promise<{ done: boolean; value: Uint8Array | undefined }> => {
      state.reads++;
      opts.onBeforeRead?.(i);
      if (i < chunks.length) {
        const chunk = chunks[i];
        i++;
        const value = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
        return { done: false, value };
      }
      return { done: true, value: undefined };
    },
    cancel: async (): Promise<void> => {
      state.cancelCalled++;
      if (opts.cancelThrows) throw new Error("reader already closed");
    },
  };
  const res = { body: { getReader: () => reader } } as unknown as Response;
  return { res, state };
}

async function collect(gen: AsyncGenerator<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const v of gen) out.push(v);
  return out;
}

describe("ndjsonStream — no body (early return before any reader)", () => {
  it("body === null → yields nothing", async () => {
    const res = { body: null } as unknown as Response;
    expect(await collect(ndjsonStream(res))).toEqual([]);
  });

  it("body === undefined → yields nothing", async () => {
    const res = {} as unknown as Response;
    expect(await collect(ndjsonStream(res))).toEqual([]);
  });
});

describe("ndjsonStream — line parsing (inner while + JSON.parse)", () => {
  it("single complete line → the parsed object", async () => {
    const { res } = makeStream(['{"a":1}\n']);
    expect(await collect(ndjsonStream(res))).toEqual([{ a: 1 }]);
  });

  it("multiple complete lines in ONE chunk → each parsed, in order", async () => {
    const { res } = makeStream(['{"a":1}\n{"b":2}\n{"c":3}\n']);
    expect(await collect(ndjsonStream(res))).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it("a line split across two chunks is buffered then parsed once whole", async () => {
    const { res, state } = makeStream(['{"a":', "1}\n"]);
    expect(await collect(ndjsonStream(res))).toEqual([{ a: 1 }]);
    // 2 content reads + 1 terminating done read.
    expect(state.reads).toBe(3);
  });

  it("empty and whitespace-only lines are skipped by `if (line)`", async () => {
    const { res } = makeStream(['\n', '   \n', '{"a":1}\n', "\t\n"]);
    expect(await collect(ndjsonStream(res))).toEqual([{ a: 1 }]);
  });

  it("a malformed JSON line is swallowed; the stream keeps going", async () => {
    const { res } = makeStream(['not json\n{"a":1}\n']);
    expect(await collect(ndjsonStream(res))).toEqual([{ a: 1 }]);
  });

  it("falsy-but-valid JSON values (0, false, null, empty string) are still yielded", async () => {
    const { res } = makeStream(['5\n"hello"\n[1,2]\nnull\ntrue\n0\nfalse\n""\n']);
    expect(await collect(ndjsonStream(res))).toEqual([
      5,
      "hello",
      [1, 2],
      null,
      true,
      0,
      false,
      "",
    ]);
  });

  it("reassembles a multibyte char split across chunks (proves {stream:true})", async () => {
    // '{"c":"é"}\n' — é is 0xC3 0xA9; split the two bytes across the chunk boundary.
    const full = encoder.encode('{"c":"é"}\n');
    const splitAt = full.indexOf(0xa9); // second byte of é
    const first = full.slice(0, splitAt); // ends on the lone 0xC3
    const second = full.slice(splitAt); // starts with 0xA9
    const { res } = makeStream([first, second]);
    expect(await collect(ndjsonStream(res))).toEqual([{ c: "é" }]);
  });
});

describe("ndjsonStream — tail (post-loop) handling", () => {
  it("final line with NO trailing newline is flushed from the tail", async () => {
    const { res } = makeStream(['{"a":1}']); // no \n
    expect(await collect(ndjsonStream(res))).toEqual([{ a: 1 }]);
  });

  it("malformed tail is ignored (swallowed), earlier lines still returned", async () => {
    const { res } = makeStream(['{"a":1}\n', "trailing junk"]);
    expect(await collect(ndjsonStream(res))).toEqual([{ a: 1 }]);
  });

  it("whitespace-only tail after content yields no extra value", async () => {
    const { res } = makeStream(['{"a":1}\n', "   "]);
    expect(await collect(ndjsonStream(res))).toEqual([{ a: 1 }]);
  });

  it("empty stream (first read done) → yields nothing, no tail", async () => {
    const { res, state } = makeStream([]);
    expect(await collect(ndjsonStream(res))).toEqual([]);
    expect(state.reads).toBe(1); // one read, immediately done
  });
});

describe("ndjsonStream — abort signal", () => {
  it("aborted BEFORE the first read → yields nothing, never reads, but still cancels", async () => {
    const controller = new AbortController();
    controller.abort();
    const { res, state } = makeStream(['{"a":1}\n']);
    expect(await collect(ndjsonStream(res, controller.signal))).toEqual([]);
    expect(state.reads).toBe(0);
    expect(state.cancelCalled).toBe(1);
  });

  it("aborted MID-stream → first chunk's lines emitted, later chunk never read", async () => {
    const controller = new AbortController();
    // Abort during the first read: the iter-1 abort check already passed, so chunk 0
    // is served + yielded, then the iter-2 check short-circuits before chunk 1 is read.
    const { res, state } = makeStream(['{"n":1}\n', '{"n":2}\n'], {
      onBeforeRead: (index) => {
        if (index === 0) controller.abort();
      },
    });
    expect(await collect(ndjsonStream(res, controller.signal))).toEqual([{ n: 1 }]);
    expect(state.reads).toBe(1); // second chunk never fetched
    expect(state.cancelCalled).toBe(1);
  });

  it("signal present but never aborted → drains fully (false branch of signal?.aborted)", async () => {
    const controller = new AbortController();
    const { res } = makeStream(['{"a":1}\n{"b":2}\n']);
    expect(await collect(ndjsonStream(res, controller.signal))).toEqual([{ a: 1 }, { b: 2 }]);
    expect(controller.signal.aborted).toBe(false);
  });
});

describe("ndjsonStream — finally always cancels the reader", () => {
  it("cancels the reader after a normal drain", async () => {
    const { res, state } = makeStream(['{"a":1}\n']);
    await collect(ndjsonStream(res));
    expect(state.cancelCalled).toBe(1);
  });

  it("a throwing cancel() is swallowed — results are unaffected, no error escapes", async () => {
    const { res, state } = makeStream(['{"a":1}\n'], { cancelThrows: true });
    expect(await collect(ndjsonStream(res))).toEqual([{ a: 1 }]);
    expect(state.cancelCalled).toBe(1);
  });
});

describe("ndjsonStream — adversarial mixed stream", () => {
  it("interleaves split lines, a malformed line, and an unterminated tail", async () => {
    const { res } = makeStream(['{"x":', "1}\nbad line\n{\"y\":", '2}\n{"z":3}']);
    expect(await collect(ndjsonStream(res))).toEqual([{ x: 1 }, { y: 2 }, { z: 3 }]);
  });
});
