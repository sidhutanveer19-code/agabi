import { parseMarkdown } from "@/server/ingest/parse/markdown";
import { parseHtml } from "@/server/ingest/parse/html";
import { cleanDoc, type CleanOptions } from "@/server/ingest/clean";
import { normaliseDoc } from "@/server/ingest/normalise";
import { chunkDoc, type Chunk, type ChunkOptions } from "@/server/ingest/chunk";
import type { Doc } from "@/server/ingest/spans";

/**
 * The pure half of the content pipeline (§12.1 stages 2–5): parse → clean → normalise →
 * chunk. Every stage is deterministic — identical bytes produce identical chunk ids on
 * any machine at any time (§12.3). Extraction (the one nondeterministic stage) is M2 and
 * is quarantined behind `Advice<T>`; it is NOT part of this module.
 *
 * W3: this file, and everything under ingest/, never imports the knowledge store — the
 * pipeline produces chunks, it does not write the graph.
 */
export type SourceFormat = "markdown" | "html";

export interface PipelineOptions {
  clean?: CleanOptions;
  chunk?: ChunkOptions;
}

/** Parse raw source bytes-as-text into a span-preserving Doc. */
export function parse(raw: string, format: SourceFormat, page = 1): Doc {
  return format === "markdown" ? parseMarkdown(raw, page) : parseHtml(raw, page);
}

/** Run clean → normalise → chunk over an already-parsed Doc. */
export function process(sourceId: string, doc: Doc, opts: PipelineOptions = {}): Chunk[] {
  const cleaned = cleanDoc(doc, opts.clean);
  const normalised = normaliseDoc(cleaned);
  return chunkDoc(sourceId, normalised, opts.chunk);
}

/** Full pure pipeline from raw text to content-addressed chunks. */
export function ingest(sourceId: string, raw: string, format: SourceFormat, opts: PipelineOptions = {}): Chunk[] {
  return process(sourceId, parse(raw, format), opts);
}
