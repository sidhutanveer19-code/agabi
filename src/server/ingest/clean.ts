import type { Doc } from "@/server/ingest/spans";

/**
 * Cleaning (§12.1 stage 3, PURE, §12.2). Drops boilerplate spans — page numbers, empty
 * runs, caller-named headers/footers — while every SURVIVING span keeps its original
 * `sourceRange` untouched. Dropping a span removes that text from the doc but never shifts
 * another span's offsets, so a quote still maps back to its original page (§12.2).
 */
export interface CleanOptions {
  /** Extra boilerplate patterns (repeated headers/footers) to drop. */
  drop?: RegExp[];
}

const PAGE_NUMBER = /^\s*\d{1,4}\s*$/; // a span that is only a page number

export function cleanDoc(doc: Doc, opts: CleanOptions = {}): Doc {
  const drop = opts.drop ?? [];
  return doc.filter((span) => {
    const t = span.text.trim();
    if (t.length === 0) return false;
    if (PAGE_NUMBER.test(t)) return false;
    if (drop.some((re) => re.test(t))) return false;
    return true;
  });
}
