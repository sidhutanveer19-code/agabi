import { describe, it, expect } from "vitest";

import { parsePdf } from "@/server/ingest/parse/pdf";

/**
 * parsePdf — the deferred PDF stub (E8/G6). This module has NO I/O edge to fake: its
 * entire body is a single unconditional `throw new Error(...)`, so the REAL RESULT of
 * every call is that specific Error. These tests assert the EXACT thrown message (not
 * "it threw"), that a fresh Error is constructed per call, and — as falsification — that
 * NO input (empty/large/binary bytes, present/absent/falsy/negative/NaN page) ever
 * diverts it into returning a Doc or changing the message. Branch coverage is trivially
 * 100% (one statement, zero conditionals); the point here is that the loud-fail contract
 * is real and byte-exact, because a silent empty parse would drop a whole source (§R1).
 */

// The exact message, reconstructed from the two concatenated string literals in the source.
// The seam is "(G6); " + "until then," → a SINGLE space; the assertions below guard that seam.
const EXPECTED_MESSAGE =
  "PDF parsing needs a parser dependency (E8, deferred). Adding one is a stop-and-ask (G6); " +
  "until then, ingest PDFs as extracted markdown/HTML text via the local-filesystem connector.";

/** Run `fn`, return the thrown value; fail loudly if it did NOT throw (proves it never returns a Doc). */
function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected parsePdf to throw, but it returned normally");
}

describe("parsePdf — always throws the deferred-dependency Error", () => {
  it("throws an Error with the EXACT message for a non-empty Buffer and default page", () => {
    const err = capture(() => parsePdf(Buffer.from("%PDF-1.7\n...", "utf8")));
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(EXPECTED_MESSAGE);
  });

  it("throws the SAME exact message for an empty Buffer (empty ≠ 'no content' — it still refuses)", () => {
    const err = capture(() => parsePdf(Buffer.alloc(0)));
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(EXPECTED_MESSAGE);
  });

  it("throws the SAME exact message when an explicit page is supplied (page arg is inert)", () => {
    const err = capture(() => parsePdf(Buffer.from([0x25, 0x50, 0x44, 0x46]), 5));
    expect((err as Error).message).toBe(EXPECTED_MESSAGE);
  });

  it("message carries the operational markers that identify THIS refusal (not some other throw)", () => {
    const msg = (capture(() => parsePdf(Buffer.from("x"))) as Error).message;
    expect(msg).toContain("(E8, deferred)");
    expect(msg).toContain("(G6)");
    expect(msg).toContain("local-filesystem connector");
    // the concatenation seam must be exactly one space — no dropped or doubled space
    expect(msg).toContain("(G6); until then,");
    expect(msg).not.toContain("(G6);  until then");
    expect(msg).not.toContain("(G6);until then");
  });
});

describe("parsePdf — falsification: no input path diverts the throw", () => {
  // A matrix that tries to PROVE the function can behave differently: falsy page (0),
  // negative page, huge page, fractional page, NaN page, undefined page, and byte payloads
  // ranging from empty to large-binary. Every single one must yield the identical Error.
  const bytesCases: ReadonlyArray<readonly [string, Buffer]> = [
    ["empty", Buffer.alloc(0)],
    ["one byte", Buffer.from([0x00])],
    ["ascii text", Buffer.from("hello pdf", "utf8")],
    ["binary header", Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])],
    ["large", Buffer.alloc(100_000, 0xab)],
  ];
  const pageCases: ReadonlyArray<readonly [string, number | undefined]> = [
    ["undefined (default param)", undefined],
    ["zero (falsy)", 0],
    ["one", 1],
    ["negative", -3],
    ["huge", 999_999],
    ["fractional", 1.5],
    ["NaN", Number.NaN],
  ];

  for (const [bName, buf] of bytesCases) {
    for (const [pName, page] of pageCases) {
      it(`bytes=${bName}, page=${pName} → identical Error, never a Doc`, () => {
        const err = capture(() =>
          page === undefined ? parsePdf(buf) : parsePdf(buf, page),
        );
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toBe(EXPECTED_MESSAGE);
      });
    }
  }
});

describe("parsePdf — a fresh Error is constructed on every call", () => {
  it("two calls throw distinct Error instances with equal messages (new Error per call, not a shared singleton)", () => {
    const first = capture(() => parsePdf(Buffer.from("a"))) as Error;
    const second = capture(() => parsePdf(Buffer.from("b"), 2)) as Error;
    expect(first).not.toBe(second);
    expect(first.message).toBe(second.message);
    expect(first.message).toBe(EXPECTED_MESSAGE);
  });

  it("the thrown value has a real stack that names the throw site", () => {
    const err = capture(() => parsePdf(Buffer.from("stack"))) as Error;
    expect(typeof err.stack).toBe("string");
    expect(err.stack as string).toContain("Error");
  });
});
