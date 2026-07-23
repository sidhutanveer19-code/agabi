// Population report generator — turns the run's evidence into docs/phase-2/KNOWLEDGE-POPULATION-REPORT.md.
//
//   npm run report:population -- [dataset-dir] [out.md]
//
// The report is ASSEMBLED FROM THE LEDGER, never written from recollection: per-chapter counts come
// from .population-report.json, live metrics from the store, and every omission category is expanded
// into examples with their reasons (R1). A shortfall is printed as the number it reached.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createPostgresStore } from "@/server/knowledge/store/postgres";
import { integrityReport } from "@/server/knowledge/integrity";
import { corpusCoverage } from "@/server/knowledge/coverage";
import { loadManifest } from "@/server/content/dataset";
import { PROMPT_VERSION } from "@/server/advisors/knowledge/prompts";
import type { Omission } from "@/server/content/omissions";

const dir = process.argv[2] ?? "datasets/.generated/cbse-class10";
const out = process.argv[3] ?? "docs/phase-2/KNOWLEDGE-POPULATION-REPORT.md";

interface ChapterRecord {
  ref: string; subject?: string; chapter?: string; status: "ok" | "failed"; seconds: number;
  counts?: Record<string, number>; omissionsByKind?: Record<string, number>; omissions?: Omission[]; error?: string;
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

async function main() {
  const reportPath = join(dir, ".population-report.json");
  const records: ChapterRecord[] = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")) : [];
  const manifest = existsSync(join(dir, "manifest.json")) ? loadManifest(dir) : null;
  const buildReport = existsSync(join(dir, "build-report.json")) ? JSON.parse(readFileSync(join(dir, "build-report.json"), "utf8")) : null;

  const store = createPostgresStore();
  const [integrity, corpus] = await Promise.all([
    integrityReport(store),
    corpusCoverage(store, manifest ? manifest.sources.map((s) => s.ref) : []),
  ]);

  const ok = records.filter((r) => r.status === "ok");
  const failed = records.filter((r) => r.status === "failed");
  const sum = (pick: (r: ChapterRecord) => number) => ok.reduce((n, r) => n + pick(r), 0);
  const allOmissions = ok.flatMap((r) => r.omissions ?? []);
  const byKind: Record<string, number> = {};
  for (const o of allOmissions) byKind[o.kind] = (byKind[o.kind] ?? 0) + 1;

  const totalSeconds = sum((r) => r.seconds);
  const perChapter = ok.length ? totalSeconds / ok.length : 0;
  const remaining = (manifest?.sources.length ?? 0) - ok.length;

  const L: string[] = [];
  const w = (s = "") => L.push(s);

  w("# Knowledge population report");
  w();
  w("Assembled from the run's own evidence — `.population-report.json`, the dataset build report, and");
  w("a live read of the store. Nothing here is written from recollection.");
  w();
  w(`Generated: ${new Date().toISOString()}  ·  prompt: \`${PROMPT_VERSION}\``);
  w();

  w("## Corpus");
  w();
  if (manifest) {
    w(`| | |`);
    w(`|---|---|`);
    w(`| package | \`${manifest.id}\` — ${manifest.name} (${manifest.version}) |`);
    w(`| licence | ${manifest.license}${manifest.attribution ? ` · attributed to ${manifest.attribution.author}` : ""} |`);
    w(`| declared chapters | ${manifest.sources.length} |`);
  }
  if (buildReport) {
    w(`| PDF→markdown drops | ${buildReport.noiseDropped} lines (${Object.entries(buildReport.records.reduce((m: Record<string, number>, r: { drops: { rule: string }[] }) => { for (const d of r.drops) m[d.rule] = (m[d.rule] ?? 0) + 1; return m; }, {})).map(([k, v]) => `${k}=${v}`).join(", ")}) |`);
    w(`| faux-bold repairs | ${buildReport.repairsMade} lines |`);
    w(`| files skipped | ${buildReport.skipped.length}${buildReport.skipped.length ? ` — ${buildReport.skipped.map((s: { file: string; reason: string }) => `${s.file} (${s.reason})`).join("; ")}` : ""} |`);
    w();
    w("Every dropped line and every repair is listed individually in `build-report.json`.");
  }
  w();

  w("## What was populated");
  w();
  w(`| | |`);
  w(`|---|---|`);
  w(`| chapters ingested | **${ok.length} / ${manifest?.sources.length ?? "?"}** |`);
  w(`| chapters failed | ${failed.length} |`);
  for (const [k, v] of Object.entries(integrity.totals)) w(`| ${k} | ${v} |`);
  w();
  if (ok.length) {
    w(`Wall clock: ${(totalSeconds / 60).toFixed(0)} min for ${ok.length} chapter(s) — **${(perChapter / 60).toFixed(1)} min/chapter** measured.`);
    if (remaining > 0) w(`Remaining ${remaining} chapter(s) extrapolate to ≈ **${((perChapter * remaining) / 3600).toFixed(1)} hours** of continuous local compute. The run is checkpointed per chapter and resumable: \`npm run populate\`.`);
    w();
  }

  w("## Metrics");
  w();
  w("| metric | target | actual | |");
  w("|---|---|---|---|");
  w(`| subject attachment | ≥95% | ${pct(integrity.metrics.subjectAttachment)} | ${integrity.metrics.subjectAttachment >= 0.95 ? "PASS" : "MISS"} |`);
  w(`| provenance integrity | 100% | ${pct(integrity.metrics.provenanceIntegrity)} | ${integrity.metrics.provenanceIntegrity >= 1 ? "PASS" : "MISS"} |`);
  w(`| provenance resolvability | 100% | ${pct(integrity.metrics.provenanceResolvability)} | ${integrity.metrics.provenanceResolvability >= 1 ? "PASS" : "MISS"} |`);
  w(`| source coverage | ≥95% | ${pct(corpus.sourceCoverage)} | ${corpus.sourceCoverage >= 0.95 ? "PASS" : "MISS"} |`);
  w(`| chunk coverage | reported | ${pct(corpus.chunkCoverage)} | ${corpus.productiveChunks}/${corpus.chunks} chunks yielded a statement |`);
  w();
  w("`coverageRate` from `knowledge/coverage.ts` is deliberately **not** quoted as coverage here: it is");
  w("an orphan rate (concepts carrying an assertion ÷ concepts) and is satisfiable at 100% by a run");
  w("that ingested one paragraph. Source and chunk coverage are the breadth numbers.");
  w();

  w("## Omissions — everything this run did not keep, and why");
  w();
  w(`Total recorded: **${allOmissions.length}**. Counts below expand into the full ledger in`);
  w("`reports/population-run.json`; every entry there carries its own reason.");
  w();
  if (Object.keys(byKind).length === 0) {
    w("_No omissions recorded yet._");
  } else {
    w("| kind | count | what it means |");
    w("|---|---|---|");
    const MEANING: Record<string, string> = {
      "element-discard": "one proposal failed the trust-boundary schema; the rest of its batch survived (A-6)",
      "batch-discard": "the extractor returned something that was not an array at all",
      "statement-rejected": "a validation gate (V2/V3/V4/V5/V11/V12/V15) killed the proposal",
      "dependency-rejected": "a validation gate (V7/V8/V9/V10) killed the edge",
      "subject-unresolved": "the statement named no subject — persisted, but reachable from no concept",
      "duplicate-skipped": "identical content already present; collapsed into the existing object",
      "barren-chunk": "a chunk of source text produced no statement at all",
      "chapter-failed": "the chapter threw and was NOT marked done — a resume will retry it",
    };
    for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) w(`| \`${k}\` | ${v} | ${MEANING[k] ?? ""} |`);
    w();
    for (const kind of Object.keys(byKind).sort()) {
      const examples = allOmissions.filter((o) => o.kind === kind).slice(0, 3);
      w(`**${kind}** — examples:`);
      w();
      for (const e of examples) w(`- ${e.reason}`);
      w();
    }
  }

  if (failed.length) {
    w("## Chapters that failed");
    w();
    w("Not marked done — a resume retries them.");
    w();
    for (const f of failed) w(`- \`${f.ref}\` — ${f.error}`);
    w();
  }

  if (integrity.violations.length) {
    w("## Integrity violations");
    w();
    for (const v of integrity.violations) {
      w(`**[${v.severity}] ${v.check}** — ${v.count}: ${v.reason}`);
      w();
      for (const id of v.ids.slice(0, 5)) w(`- \`${id}\``);
      if (v.count > 5) w(`- … and ${v.count - 5} more`);
      w();
    }
  }

  w("## Per chapter");
  w();
  w("| chapter | concepts | statements | edges | assets | items | barren | rejected (s/d) | omissions | min |");
  w("|---|---|---|---|---|---|---|---|---|---|");
  for (const r of ok) {
    const c = r.counts ?? {};
    w(`| ${r.subject ?? "?"} / ${r.chapter ?? r.ref} | ${c.concepts ?? 0} | ${c.statements ?? 0} | ${c.edges ?? 0} | ${c.assets ?? 0} | ${c.items ?? 0} | ${c.barrenChunks ?? 0}/${c.chunks ?? 0} | ${c.statementsRejected ?? 0}/${c.dependenciesRejected ?? 0} | ${r.omissions?.length ?? 0} | ${(r.seconds / 60).toFixed(1)} |`);
  }
  w();

  writeFileSync(out, L.join("\n") + "\n");
  console.log(`population report → ${out}  (${ok.length} chapters, ${allOmissions.length} omissions recorded)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
