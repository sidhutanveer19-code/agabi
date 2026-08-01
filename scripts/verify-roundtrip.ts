// Round-trip verification (Stage 5) — export → temporary database → import → diff, object by object.
//
//   npm run verify:roundtrip -- [package-dir]
//
// Per the standing decision: production keeps ZERO delete paths. The only thing this destroys is a
// temporary database it created itself, named with a timestamp so it can never collide with a real
// one. The knowledge store's own interface still has no delete method (`no-delete` stays green) —
// the temp database is dropped with an admin command, outside the store.
//
// R1: a difference is reported as the first mismatching ROW per table, never as a bare boolean.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { createPostgresStore } from "@/server/knowledge/store/postgres";
import { diffDumps } from "@/server/content/package";
import type { GraphDump } from "@/server/knowledge/store/KnowledgeStore";

const pkgDir = process.argv[2] ?? "dist/Agabi-Knowledge-v1";
const stamp = process.env.ROUNDTRIP_STAMP ?? String(Date.now());
const TEMP_DB = `agabi_roundtrip_${stamp}`;
const adminUrl = process.env.DATABASE_URL ?? "postgresql://localhost:5432/postgres";
const user = new URL(adminUrl).username || process.env.USER || "postgres";
const host = new URL(adminUrl).hostname || "localhost";
const port = new URL(adminUrl).port || "5432";
const tempUrl = `postgresql://${user}@${host}:${port}/${TEMP_DB}`;

const run = (cmd: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: "pipe", env: { ...process.env, ...env } });

async function dumpFrom(url: string): Promise<GraphDump> {
  // A separate client bound to the temp database — the default `prisma` singleton reads DATABASE_URL.
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    // The store reads through the shared `prisma` singleton (bound to DATABASE_URL), so the temp
    // database is queried through this client directly, using dumpAll's exact ordering.
    const id = { orderBy: { id: "asc" } } as const;
    const [concepts, conceptAliases, conceptTags, contexts, statements, provenance, sources, sourceChunks,
      dependencyEdges, compositionEdges, reinforcementEdges, reviewEvents, teachingAssets,
      assessmentItems, itemConcepts, programs, programNodes, mappings, releases, releaseMembers] = await Promise.all([
      client.concept.findMany(id),
      client.conceptAlias.findMany({ orderBy: [{ conceptId: "asc" }, { alias: "asc" }] }),
      client.conceptTag.findMany({ orderBy: [{ conceptId: "asc" }, { namespace: "asc" }, { value: "asc" }] }),
      client.context.findMany(id),
      client.statement.findMany(id),
      client.provenance.findMany({ orderBy: [{ statementId: "asc" }, { chunkId: "asc" }] }),
      client.source.findMany(id),
      client.sourceChunk.findMany(id),
      client.dependencyEdge.findMany({ orderBy: [{ fromId: "asc" }, { toId: "asc" }, { version: "asc" }] }),
      client.compositionEdge.findMany({ orderBy: [{ partId: "asc" }, { wholeId: "asc" }, { version: "asc" }] }),
      client.reinforcementEdge.findMany({ orderBy: [{ fromId: "asc" }, { toId: "asc" }, { type: "asc" }, { version: "asc" }] }),
      client.reviewEvent.findMany(id),
      client.teachingAsset.findMany(id),
      client.assessmentItem.findMany(id),
      client.itemConcept.findMany({ orderBy: [{ itemId: "asc" }, { conceptId: "asc" }] }),
      client.program.findMany(id),
      client.programNode.findMany(id),
      client.mapping.findMany({ orderBy: [{ programNodeId: "asc" }, { conceptId: "asc" }] }),
      client.release.findMany(id),
      client.releaseMember.findMany({ orderBy: [{ releaseId: "asc" }, { kind: "asc" }, { entityId: "asc" }] }),
    ]);
    return {
      concepts, conceptAliases, conceptTags, contexts, statements, provenance, sources, sourceChunks,
      dependencyEdges, compositionEdges, reinforcementEdges, reviewEvents, teachingAssets,
      assessmentItems, itemConcepts, programs, programNodes, mappings, releases, releaseMembers,
    } as unknown as GraphDump;
  } finally {
    await client.$disconnect();
  }
}

async function main() {
  if (!existsSync(join(pkgDir, "manifest.json"))) throw new Error(`no package at ${pkgDir} — run npm run export:knowledge first`);

  console.log("=== ROUND-TRIP VERIFICATION ===");
  console.log(`package:  ${pkgDir}`);
  console.log(`temp db:  ${TEMP_DB}  (created here, dropped here — the ONLY thing destroyed)`);

  const source = await createPostgresStore().dumpAll();
  console.log(`source:   ${source.concepts.length} concepts, ${source.statements.length} statements, ${source.provenance.length} provenance`);

  let created = false;
  try {
    run("createdb", ["-h", host, "-p", port, "-U", user, TEMP_DB]);
    created = true;
    run("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], { DATABASE_URL: tempUrl, DIRECT_URL: tempUrl });
    console.log("schema:   pushed to the temporary database");

    const out = run("npx", ["tsx", "scripts/import-knowledge.ts", pkgDir], { DATABASE_URL: tempUrl, DIRECT_URL: tempUrl });
    const failed = /ROW\(S\) FAILED/.test(out);
    console.log(out.split("\n").filter((l) => l.includes("MISMATCH") || l.includes("FAILED") || l.includes("all rows restored")).join("\n") || "import: (no anomalies reported)");
    if (failed) console.log("import reported failures — the diff below will show what is missing");

    const restored = await dumpFrom(tempUrl);
    const diffs = diffDumps(source, restored);

    if (diffs.length === 0) {
      console.log("\nDIFF: identical — every table, every row, byte for byte");
    } else {
      console.log(`\nDIFF: ${diffs.length} table(s) differ`);
      for (const d of diffs) {
        console.log(`  ${d.table}: expected ${d.expected} rows, restored ${d.actual}`);
        if (d.firstMismatch) {
          console.log(`     first mismatch at index ${d.firstMismatch.index}`);
          console.log(`       expected: ${d.firstMismatch.expected.slice(0, 300)}`);
          console.log(`       actual:   ${d.firstMismatch.actual.slice(0, 300)}`);
        }
      }
    }
    process.exitCode = diffs.length === 0 ? 0 : 1;
  } finally {
    if (created) {
      try {
        run("dropdb", ["-h", host, "-p", port, "-U", user, "--if-exists", TEMP_DB]);
        console.log(`\ntemp db ${TEMP_DB} dropped. Production has no delete path and was never written to.`);
      } catch (e) {
        console.log(`\n[warn] could not drop ${TEMP_DB}: ${e instanceof Error ? e.message : e} — drop it manually`);
      }
    }
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
