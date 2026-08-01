import { describe, it, expect } from "vitest";
import { chunkDoc, chunkId } from "@/server/ingest/chunk";
import type { Span, Doc } from "@/server/ingest/spans";

/**
 * chunkDoc + chunkId (§12.3) — content-addressed chunking.
 * chunk.ts has NO I/O edge except `createHash` (deterministic), so nothing is
 * mocked: the REAL sha256 output IS the asserted result. Every assertion names the
 * exact chunk objects (id/sourceId/locator/text/ordinal) or an exact hex digest.
 *
 * Branches under test:
 *   - `opts.maxChars ?? 1200`: opts omitted (default 1200) AND custom value AND the
 *     `0` edge (nullish-coalescing keeps 0, does NOT fall back to 1200).
 *   - `if (!bucket.length) return`: empty-doc early return, AND the empty-bucket final
 *     flush after a span exactly fills the budget mid-loop; plus the false (emit) side.
 *   - `if (size >= maxChars) flush()`: true (mid-loop emit) AND false (accumulate).
 *   - loop with zero iterations (empty doc).
 *   - pageOf = first span's page; rangeOf = [first.start, last.end] across the group.
 *   - ordinal = emission order; determinism + the "re-ingestion is a diff" property.
 */

/** Build a Span tersely. */
function sp(text: string, start: number, end: number, page: number): Span {
  return { text, sourceRange: [start, end], page };
}

/** The exact chunk chunkDoc must emit — id is the content-address of these very inputs. */
function expected(
  sourceId: string,
  page: number,
  range: [number, number],
  text: string,
  ordinal: number,
) {
  return {
    id: chunkId(sourceId, { page, range }, text),
    sourceId,
    locator: { page, range },
    text,
    ordinal,
  };
}

describe("chunkId — content-addressed id (§12.3)", () => {
  it("hashes sourceId + canonical JSON(locator) + text to the EXACT sha256 hex", () => {
    // Independently pinned: sha256("src1" + '{"page":1,"range":[0,11]}' + "Hello world").
    expect(chunkId("src1", { page: 1, range: [0, 11] }, "Hello world")).toBe(
      "6e9d4737ca20b31d26409fd46e04d32adc512993d1a8c44d90d67086a9aa4511",
    );
  });

  it("empty sourceId + zero locator + empty text still yields the exact pinned digest", () => {
    expect(chunkId("", { page: 0, range: [0, 0] }, "")).toBe(
      "0cdadfe0ca34a9a31f971bb59995707b8e7d201311601dc87cd18918a44a5051",
    );
  });

  it("locator is canonicalised (page THEN range) regardless of key insertion order", () => {
    const a = chunkId("s", { page: 2, range: [3, 9] }, "t");
    // Same semantic locator, keys inserted range-first — canonical form must be identical.
    const reordered = { range: [3, 9], page: 2 } as unknown as {
      page: number;
      range: [number, number];
    };
    const b = chunkId("s", reordered, "t");
    expect(b).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("any change to sourceId, locator, or text changes the id (collision-free addressing)", () => {
    const base = chunkId("s", { page: 1, range: [0, 4] }, "abcd");
    expect(chunkId("S", { page: 1, range: [0, 4] }, "abcd")).not.toBe(base); // sourceId
    expect(chunkId("s", { page: 2, range: [0, 4] }, "abcd")).not.toBe(base); // page
    expect(chunkId("s", { page: 1, range: [0, 5] }, "abcd")).not.toBe(base); // range
    expect(chunkId("s", { page: 1, range: [0, 4] }, "abce")).not.toBe(base); // text
  });
});

describe("chunkDoc — empty & single-span (default budget)", () => {
  it("empty doc → [] (loop runs zero times, final flush hits the empty-bucket early return)", () => {
    expect(chunkDoc("src1", [])).toEqual([]);
  });

  it("one short span, opts OMITTED → default 1200 budget, one chunk via the FINAL flush", () => {
    const doc: Doc = [sp("Hello world", 0, 11, 1)];
    expect(chunkDoc("src1", doc)).toEqual([
      expected("src1", 1, [0, 11], "Hello world", 0),
    ]);
  });

  it("several sub-budget spans coalesce into ONE chunk: text joined by \\n, range = [first.start,last.end]", () => {
    const doc: Doc = [sp("AB", 10, 12, 2), sp("CDE", 12, 15, 2)];
    // size 2 then 5, never >= 1200 → accumulate (the `size >= maxChars` FALSE branch), then final flush.
    expect(chunkDoc("src1", doc)).toEqual([
      expected("src1", 2, [10, 15], "AB\nCDE", 0),
    ]);
  });

  it("page = FIRST span's page even when the group crosses pages; range spans first→last", () => {
    const doc: Doc = [sp("one", 100, 103, 3), sp("two", 200, 203, 7)];
    expect(chunkDoc("src1", doc)).toEqual([
      expected("src1", 3, [100, 203], "one\ntwo", 0),
    ]);
  });
});

describe("chunkDoc — budget-triggered flushing", () => {
  it("custom maxChars → mid-loop flush emits, trailing span emits via final flush; ordinals increment", () => {
    const doc: Doc = [
      sp("ab", 0, 2, 1), // size 2  (2 >= 3 false → accumulate)
      sp("cd", 2, 4, 1), // size 4  (4 >= 3 TRUE  → flush chunk 0 = [ab,cd])
      sp("e", 4, 5, 1), // size 1  (1 >= 3 false → accumulate) → final flush = chunk 1
    ];
    expect(chunkDoc("src1", doc, { maxChars: 3 })).toEqual([
      expected("src1", 1, [0, 4], "ab\ncd", 0),
      expected("src1", 1, [4, 5], "e", 1),
    ]);
  });

  it("last span exactly fills the budget → mid-loop flush emits, then final flush is the empty-bucket early return", () => {
    const doc: Doc = [sp("wxyz", 0, 4, 5)]; // size 4 >= 4 TRUE → flush; final flush sees empty bucket
    expect(chunkDoc("src1", doc, { maxChars: 4 })).toEqual([
      expected("src1", 5, [0, 4], "wxyz", 0),
    ]);
  });

  it("maxChars: 0 is HONOURED (nullish-coalescing keeps 0, not 1200) → every span its own chunk", () => {
    const doc: Doc = [sp("a", 0, 1, 1), sp("bb", 1, 3, 1)];
    // size 1 >= 0 true → flush [a]; size 2 >= 0 true → flush [bb]; final flush empty.
    expect(chunkDoc("src1", doc, { maxChars: 0 })).toEqual([
      expected("src1", 1, [0, 1], "a", 0),
      expected("src1", 1, [1, 3], "bb", 1),
    ]);
  });
});

describe("chunkDoc — determinism & re-ingestion-is-a-diff (§12.3)", () => {
  it("identical input → byte-identical chunk ids on every run", () => {
    const doc: Doc = [sp("ab", 0, 2, 1), sp("cd", 2, 4, 1), sp("e", 4, 5, 1)];
    const first = chunkDoc("src1", doc, { maxChars: 3 });
    const second = chunkDoc("src1", doc, { maxChars: 3 });
    expect(second.map((c) => c.id)).toEqual(first.map((c) => c.id));
  });

  it("editing one span's text (same offsets) changes ONLY that chunk's id; the untouched chunk keeps its id", () => {
    const before: Doc = [sp("ab", 0, 2, 1), sp("cd", 2, 4, 1), sp("e", 4, 5, 1)];
    const after: Doc = [sp("ab", 0, 2, 1), sp("zz", 2, 4, 1), sp("e", 4, 5, 1)]; // only span 2's text, same length/range
    const a = chunkDoc("src1", before, { maxChars: 3 });
    const b = chunkDoc("src1", after, { maxChars: 3 });

    expect(a).toHaveLength(2);
    expect(b).toHaveLength(2);
    expect(b[0].id).not.toBe(a[0].id); // chunk 0 held the edited span → new id
    expect(b[0].text).toBe("ab\nzz");
    expect(b[1].id).toBe(a[1].id); // chunk 1 ("e") unchanged → identical id (zero downstream work)
  });
});
