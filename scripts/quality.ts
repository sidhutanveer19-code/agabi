// Quality runner CLI (W3). Scores an ingest run's proposals against a golden truth.
// Run: npx tsx scripts/quality.ts <golden.json> <proposals.json> <source.txt>
//   golden.json    → { "statements": [{ "subject","predicate","object" }, ...] }
//   proposals.json → RawStatement[] (an IngestResult.proposals dump, opts.collectProposals)
//   source.txt     → the full normalised source text (IngestResult.text)
// Records, never gates (§5.3).
import { readFileSync } from "node:fs";
import { scoreRun, formatQuality, type GoldenTruth } from "@/server/content/quality";
import type { RawStatement } from "@/server/knowledge/extraction/types";

const [goldenPath, proposalsPath, textPath] = process.argv.slice(2);
if (!goldenPath || !proposalsPath || !textPath) {
  console.error("usage: npx tsx scripts/quality.ts <golden.json> <proposals.json> <source.txt>");
  process.exit(2);
}

const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as GoldenTruth;
const proposals = JSON.parse(readFileSync(proposalsPath, "utf8")) as RawStatement[];
const text = readFileSync(textPath, "utf8");
console.log(formatQuality(scoreRun(proposals, text, golden)));
