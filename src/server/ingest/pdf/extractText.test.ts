import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * extractPdfText (A-4) — PDF bytes → { text, pages }.
 * The ONLY I/O edge is `pdf-parse`'s PDFParse class; it is stubbed so every
 * assertion below is the module's OWN logic:
 *   - the input-normalization ternary: `bytes instanceof Uint8Array`
 *       true  → the SAME buffer is handed to PDFParse (identity, no re-copy)
 *       false → a FRESH Uint8Array is built from the input's bytes
 *   - `String(r.text ?? "")`   — text present/coerced vs nullish → ""
 *   - `Number(r.total ?? 0)`   — total present/coerced vs nullish → 0, incl. the
 *                                NaN result of a non-numeric string (proves the ??
 *                                LEFT branch, distinct from the → 0 fallback)
 *   - a rejection from getText propagates (module does not swallow).
 * Buffer is itself a Uint8Array subclass, so a Buffer travels the TRUE branch too;
 * the FALSE branch is reached with a plain array-like.
 */

const h = vi.hoisted(() => ({
  getText: (async () => ({}) as unknown) as () => Promise<unknown>,
  ctorArgs: [] as Array<{ data: unknown }>,
}));

vi.mock("pdf-parse", () => ({
  PDFParse: vi.fn(function (opts: { data: unknown }) {
    h.ctorArgs.push(opts);
    return { getText: () => h.getText() };
  }),
}));

const { extractPdfText } = await import("@/server/ingest/pdf/extractText");

beforeEach(() => {
  vi.clearAllMocks();
  h.getText = async () => ({});
  h.ctorArgs = [];
});

describe("extractPdfText — input normalization branch", () => {
  it("Uint8Array input → forwarded as-is (identity branch), exact text+pages returned", async () => {
    const u8 = new Uint8Array([37, 80, 68, 70]); // "%PDF"
    h.getText = async () => ({ text: "Hello world", total: 3 });

    const res = await extractPdfText(u8);

    expect(res).toEqual({ text: "Hello world", pages: 3 });
    expect(h.ctorArgs).toHaveLength(1);
    expect(h.ctorArgs[0].data).toBe(u8); // same reference — not re-wrapped
  });

  it("Buffer input (also a Uint8Array) → forwarded as-is, not re-copied", async () => {
    const buf = Buffer.from([1, 2, 3, 4]);
    h.getText = async () => ({ text: "buf text", total: 1 });

    const res = await extractPdfText(buf);

    expect(res).toEqual({ text: "buf text", pages: 1 });
    expect(h.ctorArgs[0].data).toBe(buf);
  });

  it("non-Uint8Array input → else branch wraps it in a FRESH Uint8Array with identical bytes", async () => {
    const arrayLike = [10, 20, 30] as unknown as Buffer;
    h.getText = async () => ({ text: "x", total: 2 });

    const res = await extractPdfText(arrayLike);

    expect(res).toEqual({ text: "x", pages: 2 });
    const data = h.ctorArgs[0].data;
    expect(data).toBeInstanceOf(Uint8Array);
    expect(data).not.toBe(arrayLike); // a new buffer, not the input
    expect(Array.from(data as Uint8Array)).toEqual([10, 20, 30]);
  });
});

describe("extractPdfText — text/pages coercion branches", () => {
  it("missing text → '' (nullish RIGHT); total present kept", async () => {
    h.getText = async () => ({ total: 4 });
    expect(await extractPdfText(new Uint8Array())).toEqual({ text: "", pages: 4 });
  });

  it("missing total → 0 (nullish RIGHT); text present kept", async () => {
    h.getText = async () => ({ text: "only text" });
    expect(await extractPdfText(new Uint8Array())).toEqual({ text: "only text", pages: 0 });
  });

  it("empty result object → both fall back: { text: '', pages: 0 }", async () => {
    h.getText = async () => ({});
    expect(await extractPdfText(new Uint8Array())).toEqual({ text: "", pages: 0 });
  });

  it("explicit null text/total → nullish-coalesced to '' and 0", async () => {
    h.getText = async () => ({ text: null, total: null });
    expect(await extractPdfText(new Uint8Array())).toEqual({ text: "", pages: 0 });
  });

  it("non-string text and numeric-string total → String()/Number() coercion (?? LEFT)", async () => {
    h.getText = async () => ({ text: 42, total: "7" });
    expect(await extractPdfText(new Uint8Array())).toEqual({ text: "42", pages: 7 });
  });

  it("non-numeric total string → pages is NaN (real coercion, distinct from the → 0 fallback)", async () => {
    h.getText = async () => ({ text: "t", total: "not-a-number" });
    const res = await extractPdfText(new Uint8Array());
    expect(res.text).toBe("t");
    expect(Number.isNaN(res.pages)).toBe(true);
  });
});

describe("extractPdfText — error propagation", () => {
  it("a rejection from getText propagates unchanged (not swallowed)", async () => {
    h.getText = async () => {
      throw new Error("corrupt pdf");
    };
    await expect(extractPdfText(new Uint8Array([1]))).rejects.toThrow("corrupt pdf");
  });
});
