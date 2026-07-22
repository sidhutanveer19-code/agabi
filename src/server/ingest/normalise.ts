import type { Doc } from "@/server/ingest/spans";

/**
 * Normalisation (§12.1 stage 4, PURE). Produces stable, readable text: NFC, smart quotes
 * to ASCII, whitespace collapsed, trimmed. It deliberately does NOT lowercase — that is
 * V3's job at grounding-compare time (§14.1), applied to both quote and chunk so casing
 * never blocks a match while the stored chunk text stays readable for review.
 *
 * `sourceRange` is preserved on every span: normalisation rewrites text, never offsets.
 * Identical input → identical output, which is what makes chunk ids reproducible (§12.3).
 */
export function normaliseText(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function normaliseDoc(doc: Doc): Doc {
  return doc.map((span) => ({ ...span, text: normaliseText(span.text) }));
}
