import type { RawStatement } from "@/server/knowledge/extraction/types";
import { groundQuote, n } from "@/server/knowledge/validators/grounding";

/**
 * Golden-set scoring (§5.3, §29). One chapter hand-authored as ground truth; every
 * extractor / prompt / chunk-size / model change is scored on precision, recall, grounding
 * rate and duplicate rate. Without it, "the extractor improved" is an opinion. This harness
 * RECORDS — it never gates a build (a regression here is a signal for a human, not a red CI
 * light that blocks shipping unrelated work).
 */
export interface GoldenTruth {
  statements: { subject: string; predicate: string; object: string }[];
}

export interface ExtractionScore {
  proposed: number;
  truth: number;
  matched: number;
  precision: number; // matched / proposed
  recall: number; // matched / truth
  groundingRate: number; // grounded / proposed
  duplicateRate: number; // duplicate proposals / proposed
}

const tripleKey = (s: string, p: string, o: string) => `${n(s)}|${n(p)}|${n(o)}`;

export function scoreExtraction(proposed: RawStatement[], truth: GoldenTruth, chunkText: string): ExtractionScore {
  const truthKeys = new Set(truth.statements.map((t) => tripleKey(t.subject, t.predicate, t.object)));

  const seen = new Set<string>();
  let matched = 0;
  let grounded = 0;
  let duplicates = 0;
  const matchedTruth = new Set<string>();

  for (const s of proposed) {
    const key = tripleKey(s.subject ?? "", s.predicate ?? "", s.object ?? s.objectLit ?? "");
    if (seen.has(key)) duplicates++;
    seen.add(key);
    if (truthKeys.has(key) && !matchedTruth.has(key)) {
      matched++;
      matchedTruth.add(key);
    }
    if (groundQuote(chunkText, s.quote).grounded) grounded++;
  }

  const proposedN = proposed.length;
  const safe = (num: number, den: number) => (den === 0 ? 0 : num / den);
  return {
    proposed: proposedN,
    truth: truth.statements.length,
    matched,
    precision: safe(matched, proposedN),
    recall: safe(matched, truth.statements.length),
    groundingRate: safe(grounded, proposedN),
    duplicateRate: safe(duplicates, proposedN),
  };
}
