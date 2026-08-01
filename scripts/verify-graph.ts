// Graph verification (Stage 4) — integrity + coverage over the LIVE database, read-only.
//
//   npm run verify:graph -- [dataset-dir] [--json out.json]
//
// `npm test` proves the checking logic over synthetic fixtures; this checks a run's actual data.
// R1: every violation prints with the ids it stands for, and every metric that misses its target
// prints the number it reached — no green summary hides a shortfall.
import { writeFileSync, existsSync } from "node:fs";
import { createPostgresStore } from "@/server/knowledge/store/postgres";
import { integrityReport } from "@/server/knowledge/integrity";
import { coverageReport, corpusCoverage } from "@/server/knowledge/coverage";
import { detectDuplicates } from "@/server/knowledge/detect/duplicates";
import { loadManifest } from "@/server/content/dataset";
import { POLICIES } from "@/server/knowledge/trust/policy";
import { join } from "node:path";

const dir = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "datasets/.generated/cbse-class10";
const jsonOut = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : undefined;

const TARGETS = {
  subjectAttachment: 0.95,
  provenanceIntegrity: 1.0,
  provenanceResolvability: 1.0,
  sourceCoverage: 0.95,
};

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const mark = (value: number, target: number) => (value >= target ? "PASS" : "MISS");

async function main() {
  const store = createPostgresStore();

  // Declared sources, so "which chapters never got run" is answerable rather than invisible.
  let declared: string[] = [];
  if (existsSync(join(dir, "manifest.json"))) declared = loadManifest(dir).sources.map((s) => s.ref);

  const [integrity, coverage, corpus, duplicates] = await Promise.all([
    integrityReport(store),
    coverageReport(store, "PUBLIC", POLICIES.RND),
    corpusCoverage(store, declared),
    detectDuplicates(store, "PUBLIC"),
  ]);

  console.log("=== GRAPH VERIFICATION ===\n");
  console.log("TOTALS");
  for (const [k, v] of Object.entries(integrity.totals)) console.log(`  ${k.padEnd(14)} ${v}`);

  console.log("\nMETRICS (target — actual)");
  console.log(`  subject attachment       ≥${pct(TARGETS.subjectAttachment)}  ${pct(integrity.metrics.subjectAttachment)}  ${mark(integrity.metrics.subjectAttachment, TARGETS.subjectAttachment)}`);
  console.log(`  provenance integrity      ${pct(TARGETS.provenanceIntegrity)}  ${pct(integrity.metrics.provenanceIntegrity)}  ${mark(integrity.metrics.provenanceIntegrity, TARGETS.provenanceIntegrity)}`);
  console.log(`  provenance resolvability  ${pct(TARGETS.provenanceResolvability)}  ${pct(integrity.metrics.provenanceResolvability)}  ${mark(integrity.metrics.provenanceResolvability, TARGETS.provenanceResolvability)}`);
  if (declared.length) console.log(`  source coverage          ≥${pct(TARGETS.sourceCoverage)}  ${pct(corpus.sourceCoverage)}  ${mark(corpus.sourceCoverage, TARGETS.sourceCoverage)}  (${corpus.ingestedSources}/${corpus.declaredSources} chapters)`);
  console.log(`  chunk coverage           (reported) ${pct(corpus.chunkCoverage)}  — ${corpus.productiveChunks}/${corpus.chunks} chunks produced a statement`);
  console.log(`  concept orphan-rate      (reported) ${pct(coverage.coverageRate)}  — NOT curriculum breadth; ${coverage.coveredConcepts}/${coverage.concepts} concepts carry an assertion`);

  console.log("\nVIOLATIONS");
  if (integrity.violations.length === 0) console.log("  none");
  for (const v of integrity.violations) {
    console.log(`  [${v.severity.toUpperCase()}] ${v.check}: ${v.count} — ${v.reason}`);
    for (const id of v.ids) console.log(`        · ${id}`);
    if (v.count > v.ids.length) console.log(`        … and ${v.count - v.ids.length} more (full list in --json)`);
  }

  if (corpus.missingSources.length) {
    console.log(`\nCHAPTERS NEVER INGESTED: ${corpus.missingSources.length}/${corpus.declaredSources}`);
    for (const id of corpus.missingSources.slice(0, 10)) console.log(`  · ${id}`);
    if (corpus.missingSources.length > 10) console.log(`  … and ${corpus.missingSources.length - 10} more`);
  }
  if (corpus.barrenChunks.length) console.log(`\nBARREN CHUNKS: ${corpus.barrenChunks.length}/${corpus.chunks} — text ingested that yielded no statement`);
  if (duplicates.length) console.log(`\nNEAR-DUPLICATE CONCEPT PAIRS: ${duplicates.length} (review candidates, not errors)`);

  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({ generatedAt: new Date().toISOString(), integrity, coverage, corpus, duplicates }, null, 2));
    console.log(`\nfull report → ${jsonOut}`);
  }

  console.log(`\nRESULT: ${integrity.ok ? "no error-severity violations" : "ERRORS PRESENT"}`);
  process.exit(integrity.ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
