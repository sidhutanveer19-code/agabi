// Knowledge Package import (Stage 5) — a package directory → a populated store, ID-PRESERVING.
//
//   npm run import:knowledge -- <package-dir> [--force-schema]
//
// Ids are re-inserted verbatim, never re-minted: `mintId()` is time + randomness, so a re-minting
// import would produce a graph that is isomorphic but not identical, and "the restore matched"
// could never be checked — only asserted.
//
// R1: every row that fails to insert is counted AND printed with its table, id and the driver's
// error. A partial restore that reported success would be the worst possible outcome here.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createPostgresStore } from "@/server/knowledge/store/postgres";
import { GRAPH_TABLES, PROVENANCE_TABLES, DATE_FIELDS, fromNdjson, reviveDates, sha256Hex, type PackageManifest, type GraphTable } from "@/server/content/package";
import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import type {
  Concept, ConceptAlias, ConceptTag, Context, Statement, Provenance, Source, SourceChunk,
  DependencyEdge, CompositionEdge, ReinforcementEdge, ReviewEvent, TeachingAsset, AssessmentItem,
  ItemConcept, Program, ProgramNode, Mapping, Release, ReleaseMember,
} from "@/server/knowledge/types";

const dir = process.argv[2];
const forceSchema = process.argv.includes("--force-schema");
if (!dir) {
  console.error("usage: npm run import:knowledge -- <package-dir> [--force-schema]");
  process.exit(2);
}

/** Write one row of a table through the store's own put* method — no direct SQL, no bypass. */
async function writers(store: KnowledgeStore): Promise<Record<GraphTable, (row: never) => Promise<void>>> {
  const releaseMembers: ReleaseMember[] = [];
  return {
    concepts: (r: Concept) => store.putConcept(r),
    contexts: async (r: Context) => { await store.putContext(r.dimensions); }, // id is derived from the dimensions — re-derives identically
    sources: (r: Source) => store.putSource(r),
    sourceChunks: (r: SourceChunk) => store.putSourceChunk(r),
    statements: (r: Statement) => store.putStatement(r),
    provenance: (r: Provenance) => store.putProvenance(r),
    conceptAliases: (r: ConceptAlias) => store.putConceptAlias(r),
    conceptTags: (r: ConceptTag) => store.putConceptTag(r),
    dependencyEdges: (r: DependencyEdge) => store.putDependencyEdge(r),
    compositionEdges: (r: CompositionEdge) => store.putCompositionEdge(r),
    reinforcementEdges: (r: ReinforcementEdge) => store.putReinforcementEdge(r),
    teachingAssets: (r: TeachingAsset) => store.putTeachingAsset(r),
    assessmentItems: (r: AssessmentItem) => store.putAssessmentItem(r),
    itemConcepts: (r: ItemConcept) => store.putItemConcept(r),
    programs: (r: Program) => store.putProgram(r),
    programNodes: (r: ProgramNode) => store.putProgramNode(r),
    mappings: (r: Mapping) => store.putMapping(r),
    // A release is written with its members in one call, so members are buffered and flushed by it.
    releases: async (r: Release) => { await store.putRelease(r, releaseMembers.filter((m) => m.releaseId === r.id)); },
    releaseMembers: async (r: ReleaseMember) => { releaseMembers.push(r); },
    reviewEvents: (r: ReviewEvent) => store.putReviewEvent(r),
  } as Record<GraphTable, (row: never) => Promise<void>>;
}

async function main() {
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error(`no manifest.json in ${dir} — not a knowledge package`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;

  // A restore into a different schema is not a restore. Refuse unless explicitly overridden.
  const localSchema = existsSync("prisma/schema.prisma") ? sha256Hex(readFileSync("prisma/schema.prisma", "utf8")).slice(0, 16) : null;
  if (localSchema && localSchema !== manifest.schemaVersion) {
    const msg = `schema mismatch: package was exported against ${manifest.schemaVersion}, this repo is ${localSchema}`;
    if (!forceSchema) throw new Error(`${msg}\n  → check out the package's git sha (${manifest.gitSha ?? "unknown"}), or re-run with --force-schema if you know the difference is safe`);
    console.log(`[warn] ${msg} — continuing because --force-schema was passed`);
  }

  // Verify every shipped file against its recorded hash BEFORE writing anything.
  const badHashes: string[] = [];
  for (const f of manifest.files) {
    const p = join(dir, f.path);
    if (!existsSync(p)) { badHashes.push(`${f.path}: missing`); continue; }
    const actual = sha256Hex(readFileSync(p, "utf8"));
    if (actual !== f.sha256) badHashes.push(`${f.path}: sha256 ${actual.slice(0, 12)} ≠ recorded ${f.sha256.slice(0, 12)}`);
  }
  if (badHashes.length) throw new Error(`package integrity check FAILED — nothing imported:\n  ${badHashes.join("\n  ")}`);

  const store = createPostgresStore();
  const put = await writers(store);
  const results: { table: GraphTable; rows: number; written: number; failures: { id: string; error: string }[] }[] = [];

  // releaseMembers must be read before releases (a release writes its members with it), and
  // dependencies before dependents — GRAPH_TABLES is already in restore order.
  const order: GraphTable[] = [...GRAPH_TABLES].sort((a, b) => (a === "releaseMembers" ? -1 : b === "releaseMembers" ? 1 : 0));

  for (const table of order) {
    const sub = (PROVENANCE_TABLES as readonly string[]).includes(table) ? "provenance" : "graph";
    const path = join(dir, `${sub}/${table}.ndjson`);
    if (!existsSync(path)) { results.push({ table, rows: 0, written: 0, failures: [{ id: "-", error: "file missing from package" }] }); continue; }

    const raw = fromNdjson<Record<string, unknown>>(readFileSync(path, "utf8"));
    const rows = reviveDates(raw, DATE_FIELDS[table] ?? []);
    const failures: { id: string; error: string }[] = [];
    let written = 0;
    for (const row of rows) {
      try {
        await put[table](row as never);
        written++;
      } catch (e) {
        failures.push({ id: String(row.id ?? JSON.stringify(row).slice(0, 60)), error: e instanceof Error ? e.message.split("\n")[0] : String(e) });
      }
    }
    results.push({ table, rows: rows.length, written, failures });
  }

  console.log("=== KNOWLEDGE PACKAGE IMPORTED ===");
  console.log(`from:   ${dir}`);
  console.log(`format: ${manifest.format}   exported: ${manifest.exportedAt}   prompt: ${manifest.promptVersion}`);
  let totalFail = 0;
  for (const r of results) {
    if (r.rows === 0 && r.failures.length === 0) continue;
    const expected = manifest.counts[r.table] ?? r.rows;
    const flag = r.written === expected ? "" : "  ← MISMATCH";
    console.log(`  ${r.table.padEnd(20)} ${String(r.written).padStart(6)} / ${expected}${flag}`);
    for (const f of r.failures.slice(0, 5)) console.log(`        ! ${f.id}: ${f.error}`);
    if (r.failures.length > 5) console.log(`        … and ${r.failures.length - 5} more failures`);
    totalFail += r.failures.length;
  }
  console.log(totalFail === 0 ? "\nall rows restored" : `\n${totalFail} ROW(S) FAILED — the restore is INCOMPLETE`);
  console.log(`next: npm run verify:graph   and   npm run verify:roundtrip -- ${dir}`);
  process.exit(totalFail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
