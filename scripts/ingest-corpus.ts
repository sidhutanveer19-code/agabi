// RAG corpus ingest (MVP Phase 1). Turns a BUILT dataset package (markdown chapters + manifest,
// produced by `npm run dataset:build`) into persisted Source + SourceChunk rows AND a full-text
// index — WITHOUT the slow LLM knowledge-extraction pass. This is the read-only textbook ground the
// A-7 source-grounding path teaches from; it never writes the knowledge graph (W3 + A-7 invariant).
//
//   npm run ingest:corpus -- [dataset-dir]
//
// Prereq: `npm run dataset:build -- "<pdf-dir>"` first (PDF → clean markdown + manifest). Needs a
// live Postgres (DATABASE_URL) with the schema pushed. Idempotent — content-addressed ids, re-run
// upserts the same rows.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/server/db";
import { loadManifest } from "@/server/content/dataset";
import { ingest, type SourceFormat } from "@/server/ingest/pipeline";
import { createPostgresStore } from "@/server/knowledge/store/postgres";
import { sha256 } from "@/server/knowledge/ids";

const DIR = process.argv[2] ?? "datasets/.generated/cbse-class10";

async function main() {
  const t0 = Date.now();
  const manifest = loadManifest(DIR);
  const store = createPostgresStore();
  const author = manifest.attribution?.author ?? "NCERT";

  let sources = 0;
  let chunksTotal = 0;
  for (const src of manifest.sources) {
    const format: SourceFormat = src.format === "html" ? "html" : "markdown"; // RAG ingest is text-only
    const raw = readFileSync(join(DIR, src.ref), "utf8");
    const sourceId = sha256(raw);
    const chunks = ingest(sourceId, raw, format); // parse → clean → normalise → chunk (deterministic)

    const title = [manifest.name, src.subject, src.chapter].filter(Boolean).join(" · ");
    await store.putSource({
      id: sourceId,
      kind: "textbook",
      title,
      publisher: author,
      authority: "CBSE",
      edition: null,
      publishedAt: null,
      uri: `file://${src.ref}`,
      checksum: sha256(raw),
      license: manifest.license,
      licenseUrl: manifest.attribution?.sourceUrl ?? null,
      ingestedAt: new Date(),
    });
    for (const c of chunks) {
      await store.putSourceChunk({ id: c.id, sourceId: c.sourceId, locator: c.locator, text: c.text, ordinal: c.ordinal });
    }
    sources += 1;
    chunksTotal += chunks.length;
    console.log(`  · ${title}  →  ${chunks.length} chunks`);
  }

  // Full-text index (§15 rung 4). Correct without it; this only makes search fast. Idempotent.
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "SourceChunk_fts" ON "SourceChunk" USING gin (to_tsvector('english', "text"))`,
  );

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n=== CORPUS INGEST ===`);
  console.log(`sources:  ${sources}`);
  console.log(`chunks:   ${chunksTotal}`);
  console.log(`fts index: SourceChunk_fts (ready)`);
  console.log(`time:     ${secs}s`);

  // Self-check — prove retrieval works before declaring done. MUST fail loudly on 0 hits (R1 /
  // red-team P1-F9): a self-check that only logs can report a broken index as success.
  const probe = await store.searchChunks("real numbers", { limit: 3 });
  console.log(`\nprobe "real numbers" → ${probe.length} hits` + (probe[0] ? `, top score ${probe[0].score.toFixed(3)}` : ""));
  for (const h of probe) console.log(`   [${h.score.toFixed(3)}] ${h.chunk.text.slice(0, 80)}…`);
  if (chunksTotal > 0 && probe.length === 0) {
    console.error(`\n❌ ingested ${chunksTotal} chunks but retrieval returned 0 hits — index/search is broken. Failing.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
