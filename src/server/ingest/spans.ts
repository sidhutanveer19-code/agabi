/**
 * Span-preserving document model (§12.2). A Doc is a list of spans, each carrying its
 * character range in the ORIGINAL source. Every pure pipeline stage may drop or transform
 * a span's text but MUST preserve `sourceRange` — that is what lets a quote's character
 * range map back to the original page after cleaning and normalisation, which is what
 * makes grounding (V3) checkable and highlighted review possible. Doing this on plain
 * strings destroys the mapping irrecoverably.
 */
export interface Span {
  text: string;
  sourceRange: [number, number]; // [start, end) offsets into the ORIGINAL source string
  page: number;
}
export type Doc = Span[];

/** The visible text of a doc, spans joined by newline (deterministic). */
export function docText(doc: Doc): string {
  return doc.map((s) => s.text).join("\n");
}

/** The page a span belongs to — first span's page for a range spanning one chunk. */
export function pageOf(spans: Doc): number {
  return spans.length ? spans[0].page : 0;
}

/** The [start,end) source range covered by a group of spans. */
export function rangeOf(spans: Doc): [number, number] {
  if (!spans.length) return [0, 0];
  return [spans[0].sourceRange[0], spans[spans.length - 1].sourceRange[1]];
}
