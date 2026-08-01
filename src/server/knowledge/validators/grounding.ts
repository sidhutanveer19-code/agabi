import type { RawStatement } from "@/server/knowledge/extraction/types";
import { pass, type ValidationResult } from "@/server/knowledge/validators/types";

/**
 * Grounding gates V3–V5 (§14, §14.1). The load-bearing one is V3: a quote must appear
 * LITERALLY in the source chunk after normalisation — never fuzzy (ADR-3). A model
 * paraphrasing while claiming to quote is exactly the fabrication V3 exists to catch; a
 * similarity threshold would wave it through. V3 also returns the char range, which powers
 * highlighted review (M3/M6).
 */

/** §14.1 grounding normalisation — NFC, quotes, whitespace, lowercased for the compare. */
export function n(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[‘’`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export interface Grounding {
  grounded: boolean;
  range?: [number, number]; // [start,end) in the NORMALISED chunk text
}

/** Exact containment (V3). Returns the match range for highlighting when grounded. */
export function groundQuote(chunkText: string, quote: string): Grounding {
  const nc = n(chunkText);
  const nq = n(quote);
  const idx = nc.indexOf(nq);
  if (idx < 0) return { grounded: false };
  return { grounded: true, range: [idx, idx + nq.length] };
}

/** V3 — grounding: the quote is literally in the chunk. Failure DISCARDS (false positives are unrecoverable). */
export function v3Grounding(statement: RawStatement, chunkText: string): ValidationResult {
  const g = groundQuote(chunkText, statement.quote);
  if (!g.grounded) return { validator: "V3", outcome: "discard", reason: "QUOTE_NOT_IN_SOURCE" };
  return { validator: "V3", outcome: "pass", detail: g.range };
}

/** V4 — quote length 10 ≤ n ≤ 500. Too short is not evidence; too long is a copy. */
export function v4QuoteLength(statement: RawStatement): ValidationResult {
  const len = statement.quote.length;
  if (len < 10 || len > 500) return { validator: "V4", outcome: "discard", reason: `QUOTE_LENGTH_${len}` };
  return pass("V4");
}

/** V5 — originality: the WRITTEN text must not be a substring of the quote (copyright). Flags, not discards. */
export function v5Originality(statement: RawStatement): ValidationResult {
  if (n(statement.quote).includes(n(statement.text))) {
    return { validator: "V5", outcome: "flag", reason: "TEXT_COPIES_SOURCE" };
  }
  return pass("V5");
}
