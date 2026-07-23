import type { RawStatement } from "@/server/knowledge/extraction/types";
import { scoreExtraction, type GoldenTruth, type ExtractionScore } from "@/server/knowledge/extraction/golden";

/**
 * Quality runner (W3, gap 2.8). The scorer (`scoreExtraction`) already exists and is complete;
 * what was missing is a caller that runs it over a real ingest run. `scoreRun` scores ALL of a
 * run's accepted proposals against a hand-authored golden truth over the full source text
 * (grounding is checked against the whole corpus). It RECORDS — it never gates a build (§5.3).
 *
 * Feed it `IngestResult.proposals` + `IngestResult.text` (from `opts.collectProposals`).
 */
export function scoreRun(proposals: RawStatement[], text: string, golden: GoldenTruth): ExtractionScore {
  return scoreExtraction(proposals, golden, text);
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** One-line human summary for the CLI / a milestone report. */
export function formatQuality(s: ExtractionScore): string {
  return `proposed=${s.proposed} truth=${s.truth} matched=${s.matched} · precision=${pct(s.precision)} recall=${pct(s.recall)} grounding=${pct(s.groundingRate)} duplicates=${pct(s.duplicateRate)}`;
}

export type { GoldenTruth, ExtractionScore };
