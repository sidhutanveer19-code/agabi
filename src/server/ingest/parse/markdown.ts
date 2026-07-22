import type { Doc, Span } from "@/server/ingest/spans";

/**
 * Markdown → Doc (§12.1 stage 2, PURE). Splits on blank lines into block spans, each
 * carrying its exact [start,end) range in the original string so offsets survive every
 * later stage (§12.2). No markdown rendering — this preserves source text, it does not
 * interpret it. Identical bytes produce an identical Doc on any machine.
 *
 * Single-document markdown has no page structure, so every span is page 1. A PDF parser
 * (deferred, E8) is where real page numbers enter.
 */
export function parseMarkdown(raw: string, page = 1): Doc {
  const spans: Doc = [];
  const re = /[^\n]+(?:\n[^\n]+)*/g; // runs of non-blank lines = blocks
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const text = m[0];
    const span: Span = { text, sourceRange: [m.index, m.index + text.length], page };
    spans.push(span);
  }
  return spans;
}
