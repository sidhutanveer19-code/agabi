import { createHash } from "node:crypto";
import { type Doc, rangeOf, pageOf } from "@/server/ingest/spans";

/**
 * Chunking (§12.3). Content-addressed: `chunkId = sha256(sourceId + JSON(locator) +
 * normalisedText)`. Because identity is content, RE-INGESTION IS A DIFF — an unchanged
 * chapter produces identical ids and zero downstream work; one edited paragraph produces
 * exactly one new id. The `locator` carries page + source range so a later quote maps
 * back for highlighted review (§12.2).
 *
 * Spans accumulate into a chunk until a character budget is exceeded, then the chunk is
 * emitted — deterministic given the input, which the `determinism` test pins.
 */
export interface ChunkLocator {
  page: number;
  range: [number, number]; // [start,end) in the ORIGINAL source
}
export interface Chunk {
  id: string;
  sourceId: string;
  locator: ChunkLocator;
  text: string; // normalised, readable
  ordinal: number;
}

export interface ChunkOptions {
  /** Soft character budget per chunk; a span is never split, so a chunk may exceed it. */
  maxChars?: number;
}

export function chunkDoc(sourceId: string, doc: Doc, opts: ChunkOptions = {}): Chunk[] {
  const maxChars = opts.maxChars ?? 1200;
  const chunks: Chunk[] = [];
  let bucket: Doc = [];
  let size = 0;

  const flush = () => {
    if (!bucket.length) return;
    const locator: ChunkLocator = { page: pageOf(bucket), range: rangeOf(bucket) };
    const text = bucket.map((s) => s.text).join("\n");
    chunks.push({ id: chunkId(sourceId, locator, text), sourceId, locator, text, ordinal: chunks.length });
    bucket = [];
    size = 0;
  };

  for (const span of doc) {
    bucket.push(span);
    size += span.text.length;
    if (size >= maxChars) flush();
  }
  flush();
  return chunks;
}

/** The content-addressed id (§12.3). JSON(locator) uses a fixed key order for stability. */
export function chunkId(sourceId: string, locator: ChunkLocator, normalisedText: string): string {
  const canonicalLocator = JSON.stringify({ page: locator.page, range: locator.range });
  return createHash("sha256").update(sourceId + canonicalLocator + normalisedText, "utf8").digest("hex");
}
