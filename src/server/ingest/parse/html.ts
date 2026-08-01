import type { Doc, Span } from "@/server/ingest/spans";

/**
 * HTML → Doc (§12.1 stage 2, PURE). Extracts visible text as block spans, dropping tags
 * but keeping each block's [start,end) range measured in the ORIGINAL HTML string — so a
 * quote still maps back to the source byte offsets (§12.2). Deliberately minimal and
 * dependency-free (G6): block-level tags delimit spans; inline markup inside a block is
 * stripped. A real DOM parser is a later, licence-clean dependency if ever needed.
 */
const BLOCK = /<(p|h[1-6]|li|blockquote|pre|section|article|div)\b[^>]*>([\s\S]*?)<\/\1>/gi;
const TAG = /<[^>]+>/g;

export function parseHtml(raw: string, page = 1): Doc {
  const spans: Doc = [];
  let m: RegExpExecArray | null;
  while ((m = BLOCK.exec(raw)) !== null) {
    const inner = m[2];
    const text = decodeEntities(inner.replace(TAG, "").replace(/\s+/g, " ").trim());
    if (!text) continue;
    // Range covers the whole matched block in the ORIGINAL html (tags included) — the
    // conservative, recoverable choice: the block is where this text lives on the page.
    const start = m.index;
    const end = m.index + m[0].length;
    const span: Span = { text, sourceRange: [start, end], page };
    spans.push(span);
  }
  return spans;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}
