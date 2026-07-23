// Knowledge Package export (Stage 5) — the live graph → a directory another machine can restore.
//
//   npm run export:knowledge -- [out-dir] [dataset-dir]
//
// Ships eight things, because a graph without its provenance, its dataset, its hashes, its docs,
// its import scripts and its verification report is not restorable — it is just data:
//
//   manifest.json · graph/ · provenance/ · dataset/ · docs/ · scripts/ · reports/ · HASHES.txt
//
// R1: the run report and the dataset build report travel WITH the package, so the receiving side
// can see exactly what was dropped, rejected or skipped to produce this graph.
import { writeFileSync, mkdirSync, existsSync, readFileSync, cpSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { createPostgresStore } from "@/server/knowledge/store/postgres";
import { integrityReport } from "@/server/knowledge/integrity";
import { corpusCoverage } from "@/server/knowledge/coverage";
import { loadManifest } from "@/server/content/dataset";
import { PROMPT_VERSION } from "@/server/advisors/knowledge/prompts";
import {
  GRAPH_TABLES, PROVENANCE_TABLES, PACKAGE_FORMAT, toNdjson, sha256Hex, countsOf, canonicalJson,
  type PackageManifest, type GraphTable,
} from "@/server/content/package";

const outDir = process.argv[2] ?? "dist/Agabi-Knowledge-v1";
const datasetDir = process.argv[3] ?? "datasets/.generated/cbse-class10";

const DOCS = [
  "docs/phase-2/ARCHITECTURE.md",
  "docs/phase-2/PIPELINE.md",
  "docs/phase-2/CONTENT-IMPORT-SPEC.md",
  "docs/phase-2/EXTENSION-GUIDE.md",
  "docs/phase-2/CONNECTORS.md",
  "docs/phase-2/LIFECYCLE.md",
  "docs/phase-2/AMENDMENTS.md",
  "docs/phase-2/KNOWLEDGE-POPULATION-REPORT.md",
];
const SCRIPTS = ["scripts/import-knowledge.ts", "scripts/verify-graph.ts", "scripts/verify-roundtrip.ts", "scripts/review-export.ts", "scripts/review-submit.ts", "scripts/review-cli.mjs"];

function gitSha(): string | null {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { return null; }
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

async function main() {
  const store = createPostgresStore();
  const dump = await store.dumpAll();

  mkdirSync(join(outDir, "graph"), { recursive: true });
  mkdirSync(join(outDir, "provenance"), { recursive: true });
  mkdirSync(join(outDir, "docs"), { recursive: true });
  mkdirSync(join(outDir, "scripts"), { recursive: true });
  mkdirSync(join(outDir, "reports"), { recursive: true });

  // ── graph/ + provenance/ ──
  const files: PackageManifest["files"] = [];
  for (const table of GRAPH_TABLES) {
    const rows = dump[table] as unknown[];
    const sub = (PROVENANCE_TABLES as readonly string[]).includes(table) ? "provenance" : "graph";
    const rel = `${sub}/${table}.ndjson`;
    const text = toNdjson(rows);
    writeFileSync(join(outDir, rel), text);
    files.push({ path: rel, sha256: sha256Hex(text), bytes: Buffer.byteLength(text), rows: rows.length });
  }

  // ── dataset/ — the canonical markdown + its manifest + the build omission report. NOT the PDFs. ──
  let datasetMeta: PackageManifest["dataset"] = null;
  if (existsSync(join(datasetDir, "manifest.json"))) {
    cpSync(datasetDir, join(outDir, "dataset"), { recursive: true, filter: (src) => !src.includes(".population-report") });
    const m = loadManifest(datasetDir);
    datasetMeta = { id: m.id, name: m.name, version: m.version, license: m.license, sources: m.sources.length };
  }

  // ── reports/ — verification + the R1 ledger ──
  const [integrity, corpus] = await Promise.all([
    integrityReport(store),
    corpusCoverage(store, existsSync(join(datasetDir, "manifest.json")) ? loadManifest(datasetDir).sources.map((s) => s.ref) : []),
  ]);
  writeFileSync(join(outDir, "reports/verification.json"), canonicalJson({ integrity, corpus }));
  const runReport = join(datasetDir, ".population-report.json");
  if (existsSync(runReport)) cpSync(runReport, join(outDir, "reports/population-run.json"));
  const buildReport = join(datasetDir, "build-report.json");
  if (existsSync(buildReport)) cpSync(buildReport, join(outDir, "reports/dataset-build.json"));

  // ── docs/ + scripts/ ──
  for (const d of DOCS) if (existsSync(d)) cpSync(d, join(outDir, "docs", d.split("/").pop()!));
  for (const s of SCRIPTS) if (existsSync(s)) cpSync(s, join(outDir, "scripts", s.split("/").pop()!));
  writeFileSync(join(outDir, "docs/RESTORE.md"), RESTORE_MD);

  // ── manifest.json ──
  const schemaText = readFileSync("prisma/schema.prisma", "utf8");
  const manifest: PackageManifest = {
    format: PACKAGE_FORMAT,
    exportedAt: new Date().toISOString(),
    gitSha: gitSha(),
    schemaVersion: sha256Hex(schemaText).slice(0, 16),
    promptVersion: PROMPT_VERSION,
    models: [...new Set(dump.provenance.map((p) => p.modelId))].sort(),
    dataset: datasetMeta,
    counts: countsOf(dump),
    files,
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  // ── HASHES.txt — every file in the package, so tampering or truncation is detectable ──
  const all = walk(outDir).filter((p) => !p.endsWith("HASHES.txt")).sort();
  const hashes = all.map((p) => `${sha256Hex(readFileSync(p, "utf8"))}  ${relative(outDir, p)}`).join("\n") + "\n";
  writeFileSync(join(outDir, "HASHES.txt"), hashes);

  console.log("=== KNOWLEDGE PACKAGE EXPORTED ===");
  console.log(`out:        ${outDir}`);
  console.log(`format:     ${PACKAGE_FORMAT}   prompt: ${PROMPT_VERSION}   schema: ${manifest.schemaVersion}   git: ${manifest.gitSha?.slice(0, 8) ?? "n/a"}`);
  console.log(`rows:       ${Object.entries(manifest.counts).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(" ") || "(empty graph)"}`);
  console.log(`files:      ${all.length} (${hashes.split("\n").length - 1} hashed)`);
  console.log(`integrity:  ${integrity.ok ? "no error-severity violations" : `${integrity.violations.filter((v) => v.severity === "error").length} ERROR check(s) — see reports/verification.json`}`);
  console.log(`restore:    see ${outDir}/docs/RESTORE.md`);
}

const RESTORE_MD = `# Restoring an Agabi Knowledge Package

This package restores a populated knowledge graph onto a clean machine. It carries its own
provenance (Source + SourceChunk rows), so grounding is re-verifiable **without the original PDFs**.

## What you need

- Node 20+ and the Agabi repository at the git sha in \`manifest.json\` (the schema must match:
  \`manifest.schemaVersion\` is a hash of \`prisma/schema.prisma\`).
- PostgreSQL 16+ with the \`pg_trgm\` extension available (fuzzy concept search uses it).
- **Ollama is NOT required to restore.** It is only needed to *extend* the graph with new content.

## Steps

\`\`\`bash
npm ci
createdb agabi
export DATABASE_URL="postgresql://<user>@localhost:5432/agabi"
export DIRECT_URL="$DATABASE_URL"
npx prisma db push                       # creates the schema; no migration history needed
psql "$DATABASE_URL" -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm;'

npm run import:knowledge -- <this-directory>
npm run verify:graph -- <this-directory>/dataset
\`\`\`

## What "restored correctly" means

Import is **id-preserving**: every id in \`graph/\` and \`provenance/\` is re-inserted verbatim, never
re-minted, so the restored graph is *identical*, not merely isomorphic. Verify it:

\`\`\`bash
npm run verify:roundtrip -- <this-directory>
\`\`\`

That exports the restored graph again and diffs it table by table against this package. Any
difference is reported with the first mismatching row, not as a bare boolean.

## Reading the package

| Path | What it is |
|---|---|
| \`manifest.json\` | format, git sha, schema + prompt version, model ids, row counts, per-file SHA-256 |
| \`graph/*.ndjson\` | concepts, statements, edges, contexts, assets, items, curriculum, releases, review events |
| \`provenance/*.ndjson\` | provenance rows + the Source and SourceChunk they resolve to |
| \`dataset/\` | the canonical markdown corpus + its licence/attribution manifest (not the source PDFs) |
| \`reports/verification.json\` | integrity + coverage at export time |
| \`reports/population-run.json\` | **every** omission of the run that built this graph, each with its reason |
| \`reports/dataset-build.json\` | every source line dropped or repaired during PDF conversion |
| \`HASHES.txt\` | SHA-256 of every file in the package |

Verify the package has not been altered:

\`\`\`bash
cd <this-directory> && shasum -a 256 -c HASHES.txt
\`\`\`

## Licence

The dataset carries the operator's licence assertion in \`dataset/manifest.json\`. Converted textbook
text is included as \`dataset/chapters/*.md\`; check that your use is permitted before redistributing.
Statement \`text\` is written in the model's own words (§27.1) and source quotes are stored for
verification only — they are never served to a learner.
`;

main().catch((e) => { console.error(e); process.exit(1); });
